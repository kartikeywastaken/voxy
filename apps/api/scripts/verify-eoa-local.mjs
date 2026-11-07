import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const deployment = JSON.parse(await readFile(`${root}/deployments.json`, "utf8"));
const directory = await mkdtemp(resolve(tmpdir(), "voxy-eoa-verification-"));
const upstream = process.env.SEPOLIA_RPC_URL || deployment.sepolia.rpc;
const rpc = "http://127.0.0.1:18554";
// Public Anvil development key. It is used only on the loopback fork.
const sponsorKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const sponsor = privateKeyToAccount(sponsorKey);
const wallet = createWalletClient({ account: sponsor, chain: sepolia, transport: http(rpc) });
const reader = createPublicClient({
  chain: sepolia,
  pollingInterval: 100,
  transport: http(rpc, { retryCount: 0 }),
});
const proxy = createServer(async (req, res) => {
  try {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    for (const call of Array.isArray(body) ? body : [body])
      if (
        !/^(eth_get|eth_blockNumber$|eth_chainId$|net_version$|web3_clientVersion$)/.test(
          call.method,
        )
      )
        throw new Error("Only upstream read RPCs are allowed");
    const result = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      signal: AbortSignal.timeout(20000),
    });
    res.setHeader("content-type", "application/json");
    res.end(await result.text());
  } catch {
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Read-only fork upstream is unavailable" },
      }),
    );
  }
});
await new Promise((ready) => proxy.listen(18555, "127.0.0.1", ready));
const anvil = spawn(
  "anvil",
  [
    "--port",
    "18554",
    "--chain-id",
    "11155111",
    "--block-time",
    "1",
    "--fork-url",
    "http://127.0.0.1:18555",
    "--timeout",
    "25000",
    "--silent",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
anvil.stderr.on("data", (line) => process.stderr.write(line));
const timeout = setTimeout(() => {
  console.error("Isolated verification exceeded ten minutes");
  anvil.kill();
  proxy.closeAllConnections();
  proxy.close();
  process.exit(1);
}, 600000);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      await reader.getChainId();
      ready = true;
      break;
    } catch {
      await pause(100);
    }
  }
  assert.ok(ready, "The isolated Sepolia fork must start");
  process.env.SEPOLIA_RPC_URL = rpc;
  process.env.SEPOLIA_DEPLOYER_PK = sponsorKey;
  process.env.VOXY_STATE_DIR = directory;
  process.env.VOXY_EOA_DEPLOYMENTS = `${directory}/deployment.json`;
  const sourceArtifact = JSON.parse(
    await readFile(`${root}/contracts/sepolia/out/VoxyEnsRoster.sol/VoxyEnsRoster.json`, "utf8"),
  );
  const accountArtifact = JSON.parse(
    await readFile(
      `${root}/contracts/sepolia/out/VoxyRecoveryAccount.sol/VoxyRecoveryAccount.json`,
      "utf8",
    ),
  );
  async function deploy(artifact, args) {
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args,
    });
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 120000 });
    assert.equal(receipt.status, "success");
    assert.ok(receipt.contractAddress);
    return getAddress(receipt.contractAddress);
  }
  console.log("Deploying the actual recovery contracts against the forked ENSv2 factory…");
  const source = await deploy(sourceArtifact, [
    deployment.sepolia.ensv2.VerifiableFactory,
    deployment.sepolia.ensv2.UserRegistryImpl,
  ]);
  const implementation = await deploy(accountArtifact, [source]);
  await writeFile(
    process.env.VOXY_EOA_DEPLOYMENTS,
    JSON.stringify({
      version: 2,
      chainId: 11155111,
      rosterSource: source,
      implementation,
      rosterCodeHash: keccak256(await reader.getCode({ address: source })),
      implementationCodeHash: keccak256(await reader.getCode({ address: implementation })),
    }),
  );
  const protocol = await import(`${root}/packages/chain/src/eoa.ts`);
  const engine = await import(`${root}/apps/api/src/eoa-chain.ts`);
  const { operationStatus } = await import(`${root}/apps/api/src/eoa-sponsor.ts`);
  const { eoaDB } = await import(`${root}/apps/api/src/eoa-store.ts`);
  const original = privateKeyToAccount(generatePrivateKey()),
    replacement = privateKeyToAccount(generatePrivateKey());
  const guardians = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const fund = await wallet.sendTransaction({ to: original.address, value: parseEther("0.001") });
  assert.equal((await reader.waitForTransactionReceipt({ hash: fund })).status, "success");
  const initial = await reader.getBalance({ address: original.address });
  async function confirmed(operation) {
    for (let i = 0; i < 100; i++) {
      const state = await operationStatus(operation.id);
      if (state.phase === "confirmed") return state;
      assert.notEqual(state.phase, "reverted");
      await pause(300);
    }
    throw new Error("Transaction did not confirm");
  }
  console.log("Checking owner-bound enrollment, then sending a real type-4 authorization…");
  const enrollment = await engine.prepareEnrollment({
    account: original.address,
    guardians: guardians.map((g) => g.address),
  });
  const signature = await original.signTypedData(enrollment.typedData);
  const authorization = await original.signAuthorization(enrollment.authorization);
  const input = JSON.parse(
    protocol.stringify({ message: enrollment.message, signature, authorization }),
  );
  await assert.rejects(
    engine.enrollAccount({
      ...input,
      signature: await replacement.signTypedData(enrollment.typedData),
    }),
    /must sign/,
  );
  await confirmed(await engine.enrollAccount(input));
  const nonce = await reader.getTransactionCount({ address: sponsor.address });
  assert.equal((await engine.enrollAccount(input)).phase, "confirmed");
  assert.equal(
    await reader.getTransactionCount({ address: sponsor.address }),
    nonce,
    "A repeated enrollment must not submit again",
  );
  const state = await engine.accountState(original.address, original.address);
  assert.equal(state.configured, true);
  assert.equal(state.delay, 180);
  assert.equal(state.controls, true);
  assert.equal(
    await reader.getCode({ address: original.address }),
    `0xef0100${implementation.slice(2).toLowerCase()}`,
  );
  assert.equal(
    await reader.getBalance({ address: original.address }),
    initial,
    "Enrollment preserves the EOA address and funds",
  );
  console.log(
    "Checking cancellation, stale signatures, distinct guardian quorum and the real waiting period…",
  );
  const first = await engine.prepareEOARecovery(original.address, replacement.address);
  const firstSignatures = await Promise.all(
    guardians.slice(0, 2).map((g) => g.signTypedData(first.typedData)),
  );
  await assert.rejects(
    engine.submitEOARecovery(first.message, [firstSignatures[0], firstSignatures[0]]),
    /quorum/,
  );
  await confirmed(await engine.submitEOARecovery(first.message, firstSignatures));
  await assert.rejects(engine.finalizeEOA(original.address), /waiting period/);
  const cancel = await engine.prepareControllerAction({
    account: original.address,
    action: "cancel",
  });
  await confirmed(
    await engine.sendControllerAction(
      JSON.parse(
        protocol.stringify({
          actionInput: cancel.actionInput,
          message: cancel.message,
          signature: await original.signTypedData(cancel.typedData),
        }),
      ),
    ),
  );
  await assert.rejects(engine.submitEOARecovery(first.message, firstSignatures), /stale/);
  const revoked = await engine.prepareEOARecovery(original.address, replacement.address);
  await confirmed(
    await engine.submitEOARecovery(
      revoked.message,
      await Promise.all(guardians.slice(0, 2).map((g) => g.signTypedData(revoked.typedData))),
    ),
  );
  const fourthGuardian = privateKeyToAccount(generatePrivateKey());
  const update = await engine.prepareControllerAction({
    account: original.address,
    action: "guardians",
    guardians: [guardians[0].address, guardians[1].address, fourthGuardian.address],
  });
  await confirmed(
    await engine.sendControllerAction(
      JSON.parse(
        protocol.stringify({
          actionInput: update.actionInput,
          message: update.message,
          signature: await original.signTypedData(update.typedData),
        }),
      ),
    ),
  );
  assert.equal((await engine.accountState(original.address)).pending.invalidated, true);
  await assert.rejects(engine.finalizeEOA(original.address), /waiting period/);
  // The changed roster can replace its invalidated request without the original owner signing again.
  const recovery = await engine.prepareEOARecovery(original.address, replacement.address);
  const signatures = await Promise.all(
    guardians.slice(0, 2).map((g) => g.signTypedData(recovery.typedData)),
  );
  await confirmed(await engine.submitEOARecovery(recovery.message, signatures));
  const waiting = await engine.accountState(original.address);
  console.log(
    `Waiting until ${new Date(waiting.pending.readyAt * 1000).toISOString()}; no time warp, code injection or storage injection.`,
  );
  for (;;) {
    const block = await reader.getBlock();
    if (Number(block.timestamp) >= waiting.pending.readyAt) break;
    await pause(1000);
  }
  await confirmed(await engine.finalizeEOA(original.address));
  const recovered = await engine.accountState(original.address, replacement.address);
  assert.equal(recovered.controls, true);
  assert.equal(recovered.account, original.address);
  assert.equal(
    await reader.getBalance({ address: original.address }),
    initial,
    "Recovery itself does not move assets",
  );
  console.log(
    "The replacement controller signs the transfer; checking balances and restart-safe replay…",
  );
  const transferInput = { account: original.address, to: recipient, amount: "0.001" };
  const transfer = await engine.prepareTransfer(transferInput);
  const transferSignature = await replacement.signTypedData(transfer.typedData);
  const transferBody = JSON.parse(
    protocol.stringify({
      ...transferInput,
      message: transfer.message,
      signature: transferSignature,
    }),
  );
  await confirmed(await engine.sendTransfer(transferBody));
  assert.equal(await reader.getBalance({ address: original.address }), 0n);
  assert.equal(await reader.getBalance({ address: recipient }), initial);
  const after = await reader.getTransactionCount({ address: sponsor.address });
  assert.equal((await engine.sendTransfer(transferBody)).phase, "confirmed");
  assert.equal(await reader.getTransactionCount({ address: sponsor.address }), after);
  assert.ok(
    eoaDB()
      .prepare("SELECT raw FROM eoa_operations WHERE phase='confirmed'")
      .all()
      .every((row) => String(row.raw).startsWith("0x")),
  );
  const requestId = `0x${"ab".repeat(32)}`;
  const store = await import(`${root}/apps/api/src/eoa-store.ts`);
  store.saveRequest({
    id: requestId,
    account: original.address,
    controller: replacement.address,
    message: { requestId },
    guardians: guardians.map((g) => g.address),
    deadline: Math.floor(Date.now() / 1000) + 100,
  });
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {storedRequest} from ${JSON.stringify(`${root}/apps/api/src/eoa-store.ts`)}; console.log(storedRequest(${JSON.stringify(requestId)}).id);`,
    ],
    { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error("Fresh process could not load the request")),
    );
  });
  assert.equal(output.trim(), requestId);
  console.log(
    "PASS: actual 7702 enrollment, per-account ENS, guardian signatures, cancellation, replay refusal, three-minute timelock, same-address recovery, controller-authorized ETH transfer and durable restart lookup.",
  );
  console.log(
    "This was isolated chain verification. No public-chain writes or Arkiv entities were created.",
  );
} finally {
  clearTimeout(timeout);
  anvil.kill();
  proxy.closeAllConnections();
  proxy.close();
}
