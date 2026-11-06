# A resumable Node importer

Explicit transaction nonce, gas and fees are required for funded Rabdi writes. This importer preflights the exact batch unsigned at latest, stops on errors, then computes `gas = max(1,000,000 + 400,000 × (N − 1), 2 × estimate)` for N creates. This cap must fit `gasCeiling`, balance, the frozen total spend cap and half the latest block's gasLimit. Before every new signature, re-estimate the exact batch at latest and require the frozen gas to still meet that formula and `gas <= latestBlock.gasLimit / 2`. If either bound fails, stop and retain the original plan and journal for reconciliation; never mutate or replace the plan automatically. The former minimumGas override is refused rather than silently changing this formula. Previously signed plans retain their original intent and must only be reconciled, never recalculated or resubmitted automatically.

Copy the JavaScript block to `resumable-import.mjs` in your application. It uses public SDK 1.0.x APIs and Node built-ins. Supply a local account from your existing signer custody and a provider `request({ method, params })` configured without automatic retries. Neither entrypoint reads keys, creates an HTTP transport, or runs on import.

Call `prepareImport(options)` once, retain its `planSha256` in a trusted job record, then call `runImport({ ...options, planSha256 })`. On restart, call **only** `runImport` with that original hash and the original files. Preparation requires `rows`, `jobId`, `batchSize`, `fees`, `gasCeiling`, and `maxTotalCost`. Each row is `{ id, schema, values, salt: bigint, expiresAt: bigint, flags? }`. Use `defineSchema` and typed constructors from `@arkiv-network/sdk/schema`; only explicitly indexed columns can be filtered, and bytes columns cannot be indexed. The plan preserves each schema's tag, column types, indexing, optional/default choices and normalized typed values. All expiry targets are absolute; the SDK may reject a deadline that is no longer live. New plans require `fees: { gasPrice: bigint }` obtained from `eth_gasPrice`; preparation checks the current network value. Existing signed fee intent is reconciled exactly as stored, without rewriting or resending it. An unsigned legacy fee plan cannot admit a new send. Common options are `account`, `chain`, `request`, `planPath`, and `journalPath`; their parent directories must already exist.

All writers sharing this signer must use this coordinator on the same host, or you must retain exclusive signer custody. The loopback listener is a mutex, not an HTTP service: it closes incoming sockets and the OS releases it on process exit. A port collision refuses admission. This does not coordinate signers on different machines or wallet applications that bypass it. The plan captures the account, chain ID and genesis hash, port, starting transaction nonce, predicted entity keys, ordered rows, exact SDK calldata, gas, fees, and total spend cap.

The journal saves `prepared` intent before the wallet call, then signed bytes and their hash in `submitting` **before** forwarding a send. After authenticating the transaction, canonical receipt and ordered create events against the frozen plan, it saves `receipt_confirmed` **before** reading entity fields. Only a matching readback of that batch's rows earns `verified` and admits the next batch. For 60 rows in batches of 20, each batch verifies its own 20 rows; the job completes after all three batches are verified. Keep the journal private: signed bytes can be rebroadcast by someone who obtains them, and calldata exposes the entity values. Never print it or commit it. Every append calls `FileHandle.sync()`.

A torn record, altered plan, uncertain send, failed save, changed nonce, missing receipt, reverted receipt, reorg, or mismatching readback stops the job. A readback or verified-checkpoint failure leaves the earlier `receipt_confirmed` entry available; a receipt-checkpoint failure leaves `submitting` available. Restart authenticates that original hash and repairs verification without resending. If a crash happened between durable capture and provider admission, a missing receipt still requires operator reconciliation; an empty query is not permission to create again. This helper writes journal version 3 and explicitly refuses older journals, including version-2 plans and the former combined `confirmed` state. Retain those files and reconcile with the original importer; do not rename states or clear the journal to bypass this check.

This is process-crash recovery over an existing durable filesystem, not a guarantee against storage loss or machine power failure. Provision and back up the job directory before starting; this example does not fsync its parent directory or provide distributed locking. Confirmed batches are authenticated again on restart. If entities have expired or been changed since confirmation, this conservative example stops instead of recreating them.

```javascript
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import {
  createPublicClient, createWalletClient, ENTITY_EVENTS_ABI, ExpirationTime,
  MAX_ENTITY_BYTES, addr, bool, bytes, dec, decUnits, defineSchema, i32, key, str,
  toValue, u64, u256,
} from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import {
  custom, decodeEventLog, decodeFunctionData,
  keccak256, parseAbi, parseTransaction, recoverTransactionAddress,
} from "viem";

// Only errors made here have trusted fixed messages; external causes are dropped.
const safeErrors = new WeakMap();
function safeError(message) {
  const result = new Error(message);
  safeErrors.set(result, message);
  return result;
}
function sanitizedFailure(error) {
  const message = error !== null && typeof error === 'object' ? safeErrors.get(error) : undefined;
  return safeError(message ?? 'Provider operation failed; reconcile durable intent before retrying');
}



const NATIVE = "0x4400000000000000000000000000000000000044";
const EXECUTE = parseAbi(["function execute((uint8 operation, bytes operationData)[] ops)"]);
const READS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionCount",
  "eth_estimateGas", "eth_getBalance", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_call", "arkiv_query",
]);
const digest = (s) => createHash("sha256").update(s).digest("hex");
const json = (x) => JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v);
const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const check = (ok, why) => { if (!ok) throw safeError(why); };
const errorName = (_error) => "ProviderError";
const scalar = { addr, bool, bytes, dec, i32, key, str, u64, u256 };
const bigintTypes = new Set(["u64", "u256"]);
const typed = (v) => {
  const constructor = scalar[v.type];
  check(typeof constructor === "function", "Unsupported persisted attribute type");
  return constructor(bigintTypes.has(v.type) ? BigInt(v.value) : v.value);
};
function canonicalValue(v) {
  const x = toValue(v);
  return { type: x.type, value: x.type === "dec" ? decUnits(x).toString()
    : x.type === "addr" ? x.value.toLowerCase() : typeof x.value === "bigint" ? x.value.toString() : x.value };
}
function hydrate(row) {
  const columns = Object.fromEntries(Object.entries(row.schema.columns).map(([name, spec]) => {
    const constructor = scalar[spec.type];
    check(typeof constructor === "function", "Unsupported schema column type");
    let column = constructor();
    if (spec.indexed) column = column.indexed();
    if (spec.optional) column = column.optional();
    if (spec.defaultValue !== undefined) column = column.default(typed(spec.defaultValue));
    return [name, column];
  }));
  const schema = row.schema.tag === undefined ? defineSchema(columns) : defineSchema(row.schema.tag, columns);
  return { schema, values: Object.fromEntries(Object.entries(row.values).map(([n, v]) => [n, typed(v)])),
    salt: BigInt(row.salt), expiration: ExpirationTime.atBlock(BigInt(row.expiresAt)), flags: row.flags };
}
function freezeRow(row) {
  check(typeof row.id === "string" && row.id.length > 0, "Stable row ID required");
  check(typeof row.salt === "bigint" && typeof row.expiresAt === "bigint", "Explicit salt and absolute expiry required");
  check(row.schema?.columns && row.values && typeof row.values === "object", "Schema and values required");
  const normalize = (v) => JSON.parse(json(toValue(v)));
  const values = Object.fromEntries(Object.entries(row.values).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([n, v]) => [n, normalize(v)]));
  const columns = Object.fromEntries(Object.entries(row.schema.columns).map(([n, c]) => {
    if (!Object.hasOwn(values, n) && c.defaultValue !== undefined) values[n] = normalize(c.defaultValue);
    return [n, { type: c.type, indexed: c.isIndexed, optional: c.isOptional,
      ...(c.defaultValue === undefined ? {} : { defaultValue: normalize(c.defaultValue) }) }];
  }));
  const size = Object.values(values).filter(v => v.type === "bytes").reduce((n, v) => n + (v.value.length - 2) / 2, 0);
  check(size <= MAX_ENTITY_BYTES, "Bytes columns exceed SDK aggregate limit");
  return { id: row.id, schema: { ...(row.schema.tag ? { tag: row.schema.tag.value } : {}), columns },
    values, salt: row.salt.toString(), expiresAt: row.expiresAt.toString(),
    flags: { readonly: row.flags?.readonly ?? false, permissionlessExtension: row.flags?.permissionlessExtension ?? false } };
}
function portFor(chainId, address) {
  return 20000 + Number.parseInt(digest(`${chainId}:${address.toLowerCase()}`).slice(0, 8), 16) % 30000;
}
async function withCustody(account, chain, task) {
  check(account?.type === "local" && typeof account.address === "string", "Local account required; external wallets need their own durable capture");
  check(Number.isSafeInteger(chain?.id) && chain.id > 0, "Explicit chain required");
  const port = portFor(chain.id, account.address);
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  try { return await task(port); }
  finally { await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
}
function clients(account, chain, request) {
  const read = async (r) => {
    check(READS.has(r.method), "Unexpected provider method");
    return request(r);
  };
  return { read, reader: createPublicClient({ chain, cacheTime: 0, transport: custom({ request: read }, { retryCount: 0 }) }) };
}
async function createFile(path, text) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(text, "utf8"); await file.sync(); }
  finally { await file.close(); }
}
async function loadJournal(path, planSha256) {
  const text = await readFile(path, "utf8");
  check(text.endsWith("\n"), "Torn journal; reconcile without new writes");
  const entries = text.trimEnd().split("\n").map((s) => JSON.parse(s));
  let previous = "";
  for (const record of entries) {
    const { hash, ...body } = record;
    check(body.planSha256 === planSha256 && body.previous === previous && hash === digest(json(body)), "Journal integrity failure");
    previous = hash;
  }
  check(entries[0]?.state === "initialized", "Journal header missing");
  check(entries[0].journalVersion === 3, "Legacy or unsupported importer journal; retain original files and reconcile with the original importer");
  return entries;
}
async function append(path, entries, planSha256, event) {
  const body = { planSha256, previous: entries.at(-1)?.hash ?? "", ...event };
  const record = { ...body, hash: digest(json(body)) };
  const file = await open(path, "a", 0o600);
  try { await file.writeFile(`${json(record)}\n`, "utf8"); await file.sync(); }
  finally { await file.close(); }
  entries.push(record);
}
const feesFrom = (f) => Object.fromEntries(Object.entries(f).map(([n, v]) => [n, BigInt(v)]));
function requiredGas(estimate, operations, chainId) {
  check(typeof estimate === "bigint" && estimate > 0n, "Positive unsigned estimate required");
  const floor = chainId === 7794095 ? 1000000n + 400000n * BigInt(operations - 1) : 0n;
  return estimate * 2n > floor ? estimate * 2n : floor;
}
async function checkHalfBlock(reader, gas) {
  const block = await reader.getBlock({ blockTag: "latest" });
  check(typeof block.gasLimit === "bigint" && block.gasLimit > 0n, "Latest block gas limit required");
  check(gas <= block.gasLimit / 2n, "Gas exceeds half the latest block limit; retain intent and reconcile; split only unprepared work");
}
async function sdkCalldata(account, chain, read, creates, nonce, gas, fees) {
  let captured;
  const unsignedAccount = { ...account, signTransaction: async (r) => { captured = r; throw safeError("Unsigned SDK capture complete"); } };
  const wallet = createWalletClient({ account: unsignedAccount, chain, transport: custom({ request: read }, { retryCount: 0 }) });
  try { await wallet.executeBatch({ creates }, { nonce, gas, ...fees }); }
  catch (e) { if (!captured) throw e; }
  check(captured?.data && sameAddress(captured.to, NATIVE) && captured.nonce === nonce, "SDK capture did not match native create intent");
  return captured.data;
}

export async function prepareImport(options) {
  try {
    const { account, chain, request, rows, jobId, batchSize, planPath, journalPath, gasCeiling, maxTotalCost, fees } = options;
    return await withCustody(account, chain, async (custodyPort) => {
      check(typeof jobId === "string" && jobId.length > 0, "Job ID required");
      check(Number.isSafeInteger(batchSize) && batchSize > 0 && Array.isArray(rows) && rows.length > 0, "Nonempty rows and positive batch size required");
      check(typeof gasCeiling === "bigint" && gasCeiling > 0n && typeof maxTotalCost === "bigint" && maxTotalCost > 0n, "Approved gas and spend caps required");
      check(options.minimumGas === undefined, "Legacy minimumGas override refused; gas is computed from the exact unsigned estimate");
      const frozen = rows.map(freezeRow);
      check(new Set(frozen.map((r) => r.id)).size === frozen.length, "Duplicate row IDs");
      const names = Object.keys(fees ?? {}).sort().join(",");
      check(names === "gasPrice", "New writes require gasPrice from eth_gasPrice");
      check(Object.values(fees).every((v) => typeof v === "bigint" && v >= 0n), "Invalid fees");
      const feeCap = fees.gasPrice ?? fees.maxFeePerGas;
      check(feeCap > 0n && (fees.maxPriorityFeePerGas ?? 0n) <= feeCap, "Invalid fee cap");
      const { reader, read } = clients(account, chain, request);
      check(await reader.getChainId() === chain.id, "Provider chain mismatch");
      check(fees.gasPrice === BigInt(await read({ method: "eth_gasPrice" })), "Prepare with the current eth_gasPrice");
      const genesis = await reader.getBlock({ blockNumber: 0n });
      check(/^0x[0-9a-fA-F]{64}$/.test(genesis.hash), "Missing genesis identity");
      const latest = await reader.getTransactionCount({ address: account.address, blockTag: "latest" });
      const pending = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
      check(latest === pending, "Resolve existing pending transactions first");
      const startBlock = await reader.getBlockNumber({ cacheTime: 0 });
      const predicted = await reader.predictEntityKeys({ owner: account.address, salts: frozen.map((r) => BigInt(r.salt)) });
      frozen.forEach((r, i) => { r.expectedKey = predicted[i].key; });
      const batches = [];
      let totalCap = 0n;
      for (let start = 0; start < frozen.length; start += batchSize) {
        const index = batches.length, slice = frozen.slice(start, start + batchSize), nonce = latest + index;
        check(Number.isSafeInteger(nonce), "Nonce exceeds safe integer range");
        const creates = slice.map(hydrate);
        const input = await sdkCalldata(account, chain, read, creates, nonce, gasCeiling, fees);
        const estimate = await reader.estimateGas({ account: account.address, to: NATIVE, data: input, blockTag: "latest", ...fees });
        const gas = requiredGas(estimate, slice.length, chain.id);
        check(gas <= gasCeiling, "Estimated gas exceeds approved ceiling");
        await checkHalfBlock(reader, gas);
        totalCap += gas * feeCap;
        batches.push({ index, nonce, gas: gas.toString(), input, rows: slice });
      }
      check(totalCap <= maxTotalCost && await reader.getBalance({ address: account.address }) >= totalCap, "Insufficient balance or approved budget");
      const plan = { schema: 2, jobId, chainId: chain.id, genesisHash: genesis.hash, account: account.address.toLowerCase(), custodyPort,
        startBlock: startBlock.toString(), firstNonce: latest, fees: JSON.parse(json(fees)), maxTotalCost: maxTotalCost.toString(), batches };
      const text = `${json(plan)}\n`, planSha256 = digest(text);
      await createFile(planPath, text);
      const header = { planSha256, previous: "", state: "initialized", journalVersion: 3 };
      await createFile(journalPath, `${json({ ...header, hash: digest(json(header)) })}\n`);
      return { planSha256, batches: batches.length, maximumCost: totalCap.toString() };
    });
  } catch (error) {
    throw sanitizedFailure(error);
  }
}

async function authenticateRaw(raw, plan, batch) {
  const tx = parseTransaction(raw);
  check(sameAddress(await recoverTransactionAddress({ serializedTransaction: raw }), plan.account), "Signed sender mismatch");
  check(tx.chainId === plan.chainId && tx.nonce === batch.nonce && sameAddress(tx.to, NATIVE)
    && (tx.value ?? 0n) === 0n && tx.data === batch.input && tx.gas === BigInt(batch.gas), "Signed transaction differs from plan");
  const legacy = plan.fees.gasPrice !== undefined;
  check(legacy ? tx.type === "legacy" && tx.gasPrice === BigInt(plan.fees.gasPrice)
    : tx.type === "eip1559" && tx.maxFeePerGas === BigInt(plan.fees.maxFeePerGas)
      && tx.maxPriorityFeePerGas === BigInt(plan.fees.maxPriorityFeePerGas), "Signed fees differ from plan");
  check(!tx.accessList?.length && !tx.authorizationList?.length && !tx.blobVersionedHashes?.length, "Unexpected transaction extensions");
  const decoded = decodeFunctionData({ abi: EXECUTE, data: tx.data });
  check(decoded.functionName === "execute" && decoded.args[0].length === batch.rows.length
    && decoded.args[0].every((op) => op.operation === 1), "Only the planned creates are admitted");
  return keccak256(raw);
}
async function authenticateReceipt(reader, plan, batch, captured) {
  check(captured.nonce === batch.nonce, "Captured nonce differs from plan");
  check(await authenticateRaw(captured.raw, plan, batch) === captured.txHash, "Captured hash mismatch");
  const tx = await reader.getTransaction({ hash: captured.txHash });
  check(tx.hash === captured.txHash && sameAddress(tx.from, plan.account) && sameAddress(tx.to, NATIVE)
    && tx.nonce === batch.nonce && tx.input === batch.input && tx.value === 0n
    && tx.gas === BigInt(batch.gas) && tx.chainId === plan.chainId, "Provider transaction differs from signed intent");
  check(plan.fees.gasPrice !== undefined ? tx.gasPrice === BigInt(plan.fees.gasPrice)
    : tx.maxFeePerGas === BigInt(plan.fees.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(plan.fees.maxPriorityFeePerGas), "Provider fee fields differ");
  const receipt = await reader.getTransactionReceipt({ hash: captured.txHash });
  check(receipt.status === "success" && receipt.transactionHash === captured.txHash
    && sameAddress(receipt.from, plan.account) && sameAddress(receipt.to, NATIVE)
    && /^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) && receipt.blockNumber >= BigInt(plan.startBlock)
    && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber
    && tx.transactionIndex === receipt.transactionIndex, "Receipt does not authenticate a successful inclusion");
  const feeCap = BigInt(plan.fees.gasPrice ?? plan.fees.maxFeePerGas);
  check(receipt.gasUsed >= 0n && receipt.gasUsed <= BigInt(batch.gas)
    && receipt.effectiveGasPrice >= 0n && receipt.effectiveGasPrice <= feeCap, "Receipt gas or price exceeds signed intent");
  const block = await reader.getBlock({ blockNumber: receipt.blockNumber });
  check(block.hash === receipt.blockHash && block.transactions.includes(captured.txHash), "Receipt block is no longer canonical");
  const nativeLogs = receipt.logs.filter((l) => sameAddress(l.address, NATIVE));
  check(nativeLogs.length === batch.rows.length, "Unexpected native event count");
  let previousIndex = -1;
  const keys = nativeLogs.map((log, i) => {
    check(log.transactionHash === captured.txHash && log.blockHash === receipt.blockHash && !log.removed
      && log.logIndex > previousIndex, "Event provenance/order mismatch");
    previousIndex = log.logIndex;
    const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data, topics: log.topics });
    const row = batch.rows[i];
    check(event.eventName === "EntityCreated" && sameAddress(event.args.owner, plan.account)
      && event.args.entityKey === row.expectedKey && event.args.expiresAt === BigInt(row.expiresAt)
      && event.args.creationFlags === ((row.flags.readonly ? 1 : 0) | (row.flags.permissionlessExtension ? 2 : 0)), "Created key/order/flags/expiry mismatch");
    return event.args.entityKey;
  });
  return { keys, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString() };
}
async function verifyReadback(reader, plan, batch, inclusion) {
  const firstHead = await reader.getBlockNumber({ cacheTime: 0 });
  check(firstHead >= BigInt(inclusion.blockNumber), "Readback provider is behind the receipt");
  const observedBlocks = [];
  for (let i = 0; i < batch.rows.length; i++) {
    const row = batch.rows[i];
    const page = await reader.select({ $key: true, $owner: true, $creator: true, $createdAt: true,
      $expiresAt: true, $creationFlags: true, $attributes: true, $attributeSchema: true })
      .where(eq("$key", key(inclusion.keys[i]))).limit(1).fetch();
    check(page.blockNumber >= BigInt(inclusion.blockNumber), "Readback query is behind receipt");
    observedBlocks.push(page.blockNumber.toString());
    const entity = page.entities[0];
    check(entity !== undefined, "Created entity is absent at the current readback");
    check(entity.$key === inclusion.keys[i] && sameAddress(entity.$creator, plan.account) && sameAddress(entity.$owner, plan.account)
      && entity.$createdAt === BigInt(inclusion.blockNumber) && entity.$expiresAt === BigInt(row.expiresAt)
      && entity.$creationFlags.readonly === row.flags.readonly
      && entity.$creationFlags.permissionlessExtension === row.flags.permissionlessExtension, "Entity readback mismatch");
    const expectedValues = { ...row.values };
    if (row.schema.tag !== undefined) expectedValues["arkiv.schema"] = { type: "str", value: row.schema.tag };
    const expected = Object.entries(expectedValues).map(([n, v]) => [n, canonicalValue(typed(v))]).sort();
    const actual = Object.entries(entity.$attributes).map(([n, v]) => [n, canonicalValue(v)]).sort();
    check(json(actual) === json(expected), "Typed attributes/order mismatch");
    const indexing = Object.fromEntries(Object.entries(expectedValues).map(([n, v]) => [n, {
      type: v.type, indexed: n === "arkiv.schema" ? true : row.schema.columns[n].indexed,
    }]));
    check(json(Object.entries(entity.$attributeSchema).sort()) === json(Object.entries(indexing).sort()), "Column indexing mismatch");
  }
  // Current per-key observations, never presented as one pinned historical snapshot.
  return observedBlocks;
}

export async function runImport({ account, chain, request, planPath, journalPath, planSha256 }) {
  try {
    return await withCustody(account, chain, async (custodyPort) => {
      const text = await readFile(planPath, "utf8");
      check(digest(text) === planSha256, "Plan tampered or wrong trusted job hash");
      const plan = JSON.parse(text), entries = await loadJournal(journalPath, planSha256);
      check(plan.schema === 2 && plan.chainId === chain.id && sameAddress(plan.account, account.address)
        && plan.custodyPort === custodyPort && Array.isArray(plan.batches), "Plan account/chain/custody mismatch");
      const { reader, read } = clients(account, chain, request);
      check(await reader.getChainId() === plan.chainId, "Provider chain mismatch");
      check((await reader.getBlock({ blockNumber: 0n })).hash === plan.genesisHash, "Chain genesis changed; this plan belongs to another network epoch");
      for (const batch of plan.batches) {
        check(batch.index === plan.batches.indexOf(batch) && batch.nonce === plan.firstNonce + batch.index, "Unstable batch numbering");
        const history = entries.filter((r) => r.index === batch.index);
        let prepared = false, captured, receiptConfirmed, verified;
        for (const record of history) {
          check(record.state !== "confirmed", "Legacy confirmed state is incompatible; retain original files and reconcile with the original importer");
          if (record.state === "prepared") {
            check(!captured, "Prepared intent cannot follow submission");
            prepared = true;
          } else if (record.state === "submitting") {
            check(prepared && !captured, "Submission requires one prior prepared intent");
            captured = record;
          } else {
            check(captured && record.txHash === captured.txHash, "Checkpoint lacks its durable submission hash");
            if (record.state === "uncertain") check(!receiptConfirmed && !verified, "Uncertain state cannot follow receipt confirmation");
            else if (record.state === "receipt_confirmed") {
              check(!receiptConfirmed && !verified, "Duplicate or out-of-order receipt confirmation");
              receiptConfirmed = record;
            } else if (record.state === "verified") {
              check(receiptConfirmed && !verified, "Verification requires one prior receipt confirmation");
              verified = record;
            } else check(false, "Invalid batch journal state");
          }
        }
        const finishBatch = async () => {
          const inclusion = await authenticateReceipt(reader, plan, batch, captured);
          if (receiptConfirmed) check(json(receiptConfirmed.receipt) === json(inclusion), "Receipt checkpoint differs from current authenticated inclusion");
          else {
            await append(journalPath, entries, planSha256, { index: batch.index, state: "receipt_confirmed", txHash: captured.txHash, receipt: inclusion });
          }
          // This durable receipt checkpoint precedes every field read and verified save.
          if (verified) check(json(verified.receipt) === json(inclusion), "Verified checkpoint differs from current authenticated inclusion");
          const observedBlocks = await verifyReadback(reader, plan, batch, inclusion);
          if (!verified) await append(journalPath, entries, planSha256, { index: batch.index, state: "verified", txHash: captured.txHash, receipt: inclusion, observedBlocks });
        };
        if (captured) { await finishBatch(); continue; }
        check(Object.keys(plan.fees).join(",") === "gasPrice", "Legacy fee intent permits signed reconciliation only; no new send");
        check(BigInt(plan.fees.gasPrice) === BigInt(await read({ method: "eth_gasPrice" })), "Network gasPrice changed; retain intent and reconcile before any new plan");
        const nonce = await reader.getTransactionCount({ address: account.address, blockTag: "latest" });
        const pending = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
        check(nonce === batch.nonce && pending === batch.nonce, "Account nonce changed; do not create a replacement");
        const fees = feesFrom(plan.fees), gas = BigInt(batch.gas);
        check(await reader.getBalance({ address: account.address }) >= gas * (fees.gasPrice ?? fees.maxFeePerGas), "Insufficient balance before submission");
        const creates = batch.rows.map(hydrate);
        check(await sdkCalldata(account, chain, read, creates, batch.nonce, gas, fees) === batch.input, "Current SDK encoding differs from frozen plan");
        const estimate = await reader.estimateGas({ account: account.address, to: NATIVE, data: batch.input, blockTag: "latest", ...fees });
        check(gas >= requiredGas(estimate, batch.rows.length, chain.id), "Frozen gas no longer meets latest headroom; retain intent and reconcile");
        await checkHalfBlock(reader, gas);
        await append(journalPath, entries, planSha256, { index: batch.index, state: "prepared" });
        const guarded = async (r) => {
          if (r.method !== "eth_sendRawTransaction") return read(r);
          check(!captured && r.params?.length === 1, "Duplicate send or malformed submission refused");
          const raw = r.params[0], txHash = await authenticateRaw(raw, plan, batch);
          const record = { index: batch.index, state: "submitting", nonce: batch.nonce, txHash, raw };
          await append(journalPath, entries, planSha256, record);
          captured = record; // This assignment occurs only after the durable save.
          const acknowledged = await request(r);
          check(acknowledged === txHash, "Provider acknowledged another hash");
          return txHash;
        };
        const wallet = createWalletClient({ account, chain, transport: custom({ request: guarded }, { retryCount: 0 }) });
        try {
          const result = await wallet.executeBatch({ creates }, { nonce: batch.nonce, gas, ...fees });
          check(captured && result.txHash === captured.txHash && json(result.createdEntities) === json(batch.rows.map((r) => r.expectedKey)), "SDK result differs from planned key order");
        } catch (e) {
          // Phase evidence decides recovery, not instanceof or the SDK's message.
          if (captured) {
            await append(journalPath, entries, planSha256, { index: batch.index, state: "uncertain", txHash: captured.txHash, errorName: errorName(e) });
            return { state: "needs_reconciliation", index: batch.index, txHash: captured.txHash };
          }
          throw safeError("Stopped before durable send admission; inspect journal before retrying");
        }
        await finishBatch();
      }
      return { state: "complete", planSha256, confirmedBatches: plan.batches.length, verifiedBatches: plan.batches.length };
    });
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

`executeBatch` itself does not expose a pre-broadcast callback. This example supplies a transport wrapper and accepts local signing only, so its first network mutation is the guarded raw send. It refuses `eth_sendTransaction`, wallet signing RPCs, and unknown provider methods. Keep provider request deadlines bounded and retries disabled in the supplied adapter too. A receipt timeout returns a known hash; an exception while persisting a post-send checkpoint may propagate, but the earlier `submitting` or `receipt_confirmed` record remains the restart source. Receipt confirmation proves authenticated inclusion of this batch, not matching fresh fields (at their individually observed current blocks) or completion of the whole job. No other batch is admitted until this batch is `verified`.

The plan hash is a trusted input, not an authenticity claim made by an editable JSON file. The journal hash chain detects torn or inconsistent entries; it is not a substitute for filesystem access control or a trusted external job entry. Do not edit a plan, clear a journal, select a new nonce, or start a second job to escape an uncertain result. A nonce scan from the captured `startBlock` is a separate operator recovery path when adopting an older importer that never captured a hash. Authenticate the recovered sender, nonce, native address, input, receipt, and entity order before saving confirmation. A consumed nonce alone does not prove that your intended create succeeded.

Sources: [SDK 1.0.1 batch encoding, send and receipt handling](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/utils/arkivTransactions.ts), [SDK 1.0.1 executeBatch](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/actions/wallet/executeBatch.ts), [native operation ABI](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/entity/operations.ts), [entity key prediction](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/actions/public/predictEntityKeys.ts), and [TxParams](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/types/txParams.ts). The helper is tested with SDK 1.0.1; the declared skill range does not certify future releases.

SDK 1.0.x reads current state only. The helper verifies each key at its returned query block, not a single historical snapshot. Plans are version 2 and journals version 3; preserve incompatible older files and reconcile them with their original implementation. Rabdi resets require a new genesis-bound plan after all old outcomes are reconciled. Never use a reset as permission to replay an unresolved old job.
