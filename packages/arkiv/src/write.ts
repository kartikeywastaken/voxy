import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateEntityOptions } from "@arkiv-network/sdk";
import { createWalletClient } from "@arkiv-network/sdk";
import { randomSalt } from "@arkiv-network/sdk/entity";
import { eq } from "@arkiv-network/sdk/query";
import type { CreateEntityValues, Schema } from "@arkiv-network/sdk/schema";
import { key } from "@arkiv-network/sdk/schema";
import { bytesToHex, custom, type Hex, http, keccak256, type LocalAccount, parseEther } from "viem";
import { getGasPrice } from "viem/actions";
import { arkivClients } from "./client.js";
import { required } from "./env.js";
import { estimateWrite } from "./estimate.js";

const stateDirectory = () =>
  resolve(process.env.VOXY_STATE_DIR || fileURLToPath(new URL("../../../.voxy/", import.meta.url)));

async function appendJournal(path: string, event: unknown) {
  const file = await open(path, "a", 0o600);
  try {
    await file.writeFile(
      `${JSON.stringify(event, (_, v) => (typeof v === "bigint" ? v.toString() : v))}\n`,
    );
    await file.sync();
  } finally {
    await file.close();
  }
}

/** One host/process family per signer; no automatic resend after send admission. */
export async function createRecord<S extends Schema>(
  account: LocalAccount,
  operationId: string,
  schema: S,
  values: CreateEntityValues<S>,
  options: CreateEntityOptions,
) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) throw new Error("Invalid operation ID");
  const directory = stateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const signer = account.address.toLowerCase();
  const lockPath = resolve(directory, `${signer}.lock`);
  const lock = await open(lockPath, "wx", 0o600);
  try {
    const journalPath = resolve(directory, `${signer}-${operationId}.jsonl`);
    // A journal with an admitted send is never automatically replayed, even after a crash.
    const prior = await readFile(journalPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (prior)
      throw new Error(
        "Operation already journaled; reconcile its original transaction before retrying",
      );
    const { chain, reader } = arkivClients(account);
    if ((await reader.getChainId()) !== chain.id) throw new Error("Wrong chain");
    const approvedMaximumCost = parseEther(process.env.ARKIV_MAX_TX_COST_TGLM || "0.01");
    if (approvedMaximumCost <= 0n) throw new Error("A positive write budget is required");
    const salt = options.salt ?? randomSalt();
    const frozenOptions: CreateEntityOptions = {
      ...options,
      salt,
      flags: { readonly: true, permissionlessExtension: false },
    };
    const estimate = await estimateWrite(account, required("ARKIV_ACCESS_KEY"), (wallet) =>
      wallet.createEntity(schema, values, frozenOptions),
    );
    const gas = 2n * estimate > 1_000_000n ? 2n * estimate : 1_000_000n;
    const [block, nonce, pending, gasPrice, balance] = await Promise.all([
      reader.getBlock({ blockTag: "latest" }),
      reader.getTransactionCount({ address: account.address, blockTag: "latest" }),
      reader.getTransactionCount({ address: account.address, blockTag: "pending" }),
      getGasPrice(reader),
      reader.getBalance({ address: account.address }),
    ]);
    if (nonce !== pending) throw new Error("Reconcile pending signer transactions first");
    if (
      gas > block.gasLimit / 2n ||
      gas * gasPrice > approvedMaximumCost ||
      gas * gasPrice > balance
    ) {
      throw new Error("Write exceeds the block limit, approved budget or signer balance");
    }
    await appendJournal(journalPath, {
      phase: "prepared",
      chainId: chain.id,
      signer,
      operationId,
      schema: schema.name,
      values,
      options: frozenOptions,
      nonce,
      gas,
      gasPrice,
    });
    const rpc = http(undefined, {
      retryCount: 0,
      timeout: 15_000,
      fetchOptions: { cache: "no-store", redirect: "error" },
    })({ chain });
    let sent = false;
    const transport = custom(
      {
        async request(args) {
          if (args.method === "eth_sendTransaction") throw new Error("Local raw signing required");
          if (args.method === "eth_sendRawTransaction") {
            if (sent) throw new Error("Repeated broadcast blocked");
            const raw = args.params?.[0];
            if (typeof raw !== "string" || !/^0x[0-9a-f]+$/i.test(raw))
              throw new Error("Invalid raw transaction");
            await appendJournal(journalPath, {
              phase: "submitting",
              raw,
              txHash: keccak256(raw as Hex),
            });
            sent = true;
          }
          return rpc.request(args);
        },
      },
      { retryCount: 0 },
    );
    const wallet = createWalletClient({ chain, transport, account, cacheTime: 0 });
    const result = await wallet.createEntity(schema, values, frozenOptions, {
      nonce,
      gas,
      gasPrice,
    });
    const receipt = await reader.getTransactionReceipt({ hash: result.txHash });
    if (receipt.status !== "success")
      throw new Error("Receipt failed; reconcile without resending");
    await appendJournal(journalPath, {
      phase: "receipt_confirmed",
      ...result,
      blockNumber: receipt.blockNumber,
    });
    const metadata = await reader
      .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, $creationFlags: true })
      .where(eq("$key", key(result.entityKey)))
      .limit(1)
      .fetch();
    const entity = metadata.entities[0];
    if (
      !entity ||
      entity.$creator.toLowerCase() !== signer ||
      entity.$owner.toLowerCase() !== signer ||
      entity.$expiresAt !== result.expiresAt ||
      !entity.$creationFlags.readonly ||
      entity.$creationFlags.permissionlessExtension
    ) {
      throw new Error("Metadata readback failed; reconcile without resending");
    }
    const record = (await reader.getEntity(result.entityKey, schema)) as Record<string, unknown>;
    for (const [column, input] of Object.entries(values)) {
      const actual = record[column] as { value?: unknown } | undefined;
      let expected = input && typeof input === "object" && "value" in input ? input.value : input;
      if (expected instanceof Uint8Array) expected = bytesToHex(expected);
      if (actual?.value !== expected)
        throw new Error("Column readback failed; reconcile without resending");
    }
    await appendJournal(journalPath, { phase: "verified", ...result });
    return {
      ...result,
      writer: account.address,
      gasUsed: receipt.gasUsed,
      explorer: `${chain.blockExplorers.default.url}/tx/${result.txHash}`,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
