import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hashRoster,
  loadDeployments,
  rosterAttestationTypedData,
  rosterRegistryAbi,
  voxyWalletAbi,
} from "@voxy/chain";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { executeRecovery, prepareRecovery, startRecovery } from "./actions.js";
import { isWalletRuntime, walletsForOwner } from "./discovery.js";
import { sponsoredWrite } from "./queue.js";
import { voxyWalletBytecode, voxyWalletRuntime } from "./voxywallet-bytecode.js";
import { createWallet } from "./wallet.js";

const key = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const guardians = [
  privateKeyToAccount(key("1")),
  privateKeyToAccount(key("2")),
  privateKeyToAccount(key("3")),
] as const;

test("runtime verification rejects a different contract and accepts only immutable changes", () => {
  assert.equal(isWalletRuntime(voxyWalletRuntime), true);
  assert.equal(isWalletRuntime("0x"), false);
  assert.equal(isWalletRuntime(`0xff${voxyWalletRuntime.slice(4)}`), false);
});

test("sponsored operations remain serial after a failed operation", async () => {
  const order: number[] = [];
  const first = sponsoredWrite(async () => {
    order.push(1);
    await new Promise((r) => setTimeout(r, 10));
    order.push(2);
    throw new Error("failed");
  });
  const second = sponsoredWrite(async () => {
    order.push(3);
  });
  assert.equal((await Promise.allSettled([first, second]))[0]?.status, "rejected");
  assert.deepEqual(order, [1, 2, 3]);
});

test("chain-backed discovery survives a new reader, reuses accounts, isolates rosters and recovers the selected account", {
  timeout: 90000,
}, async (t) => {
  const port = 18547;
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn("anvil", ["--port", String(port), "--chain-id", "1337", "--silent"], {
    stdio: "ignore",
  });
  t.after(() => {
    anvil.kill();
  });
  process.env.DEVNET_RPC_URL = rpc;
  // Public Anvil development key; never used against a public network.
  process.env.DEVNET_DEPLOYER_PK =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const payer = privateKeyToAccount(process.env.DEVNET_DEPLOYER_PK as Hex);
  const chain = defineChain({
    id: 1337,
    name: "test",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const reader = createPublicClient({
    chain,
    pollingInterval: 50,
    transport: http(rpc, { retryCount: 0 }),
  });
  const writer = createWalletClient({ chain, account: payer, transport: http(rpc) });
  let connected = false;
  for (let i = 0; i < 100; i++) {
    try {
      await reader.getChainId();
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  assert.ok(connected, "Anvil must start");
  const artifact = JSON.parse(
    readFileSync(
      new URL(
        "../../../contracts/devnet/out/RosterRegistry.sol/RosterRegistry.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const deployed = await reader.waitForTransactionReceipt({
    hash: await writer.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [guardians.map((g) => g.address), 0n],
    }),
  });
  assert.ok(deployed.contractAddress);
  const registry = deployed.contractAddress;
  // This process uses an isolated, normally deployed registry; no storage/code injection.
  loadDeployments().devnet.RosterRegistry = registry;
  async function deploy(owner: Address) {
    const receipt = await reader.waitForTransactionReceipt({
      hash: await writer.deployContract({
        abi: [
          {
            type: "constructor",
            stateMutability: "nonpayable",
            inputs: [{ type: "address" }, { type: "address" }, { type: "uint64" }],
          },
        ],
        bytecode: voxyWalletBytecode,
        args: [owner, registry, 0n],
      }),
    });
    assert.ok(receipt.contractAddress);
    return getAddress(receipt.contractAddress);
  }
  const ownerA = guardians[0].address;
  const ownerB = guardians[1].address;
  const a = await deploy(ownerA);
  const a2 = await deploy(ownerA);
  const b = await deploy(ownerB);
  assert.deepEqual(await walletsForOwner(ownerA), [a, a2]);
  assert.deepEqual(await walletsForOwner(ownerB), [b]);
  const nonce = await reader.getTransactionCount({ address: payer.address });
  assert.equal((await createWallet(ownerA)).wallet, a);
  assert.equal(
    await reader.getTransactionCount({ address: payer.address }),
    nonce,
    "Reconnecting must not deploy again",
  );
  // A separate process has no browser or server memory to consult.
  const fresh = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { loadDeployments } from './packages/chain/src/index.ts'; loadDeployments().devnet.RosterRegistry = '${registry}'; const {walletsForOwner} = await import('./apps/api/src/discovery.ts'); console.log(JSON.stringify(await walletsForOwner('${ownerA}')));`,
    ],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let diagnostics = "";
  fresh.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  fresh.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    fresh.on("error", reject);
    fresh.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Fresh reader failed: ${code}: ${diagnostics}`)),
    );
  });
  assert.deepEqual(JSON.parse(output), [a, a2]);
  async function roster(wallet: Address, entries: [Address, Address, Address], threshold: number) {
    const attestation = {
      wallet,
      epoch: 1n,
      rosterHash: hashRoster(entries, threshold),
      guardian0: entries[0],
      guardian1: entries[1],
      guardian2: entries[2],
      threshold,
      sepoliaBlockNumber: 1n,
      sepoliaBlockHash: zeroHash,
      validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const signatures = await Promise.all(
      guardians
        .slice(0, 2)
        .map((g) => g.signTypedData(rosterAttestationTypedData(1337, registry, attestation))),
    );
    await reader.waitForTransactionReceipt({
      hash: await writer.writeContract({
        address: registry,
        abi: rosterRegistryAbi,
        functionName: "submitRoster",
        args: [attestation, signatures],
      }),
    });
  }
  await roster(a, [guardians[0].address, guardians[1].address, zeroAddress], 2);
  await roster(b, [guardians[2].address, zeroAddress, zeroAddress], 1);
  const newOwner = privateKeyToAccount(key("4")).address;
  const prepared = await prepareRecovery(newOwner, a);
  const signatures = await Promise.all(
    guardians.slice(0, 2).map((g) => g.signTypedData(prepared.typedData)),
  );
  const request = JSON.stringify(prepared.message, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  await assert.rejects(startRecovery(newOwner, b, request, signatures), /different account/);
  assert.ok(signatures[0]);
  await assert.rejects(
    startRecovery(newOwner, a, request, [signatures[0], signatures[0]]),
    /Quorum not met/,
  );
  await startRecovery(newOwner, a, request, signatures);
  await executeRecovery(a);
  assert.deepEqual(
    await reader.readContract({ address: a, abi: voxyWalletAbi, functionName: "owners" }),
    [ownerA, newOwner],
  );
  assert.deepEqual(
    await reader.readContract({ address: b, abi: voxyWalletAbi, functionName: "owners" }),
    [ownerB],
  );
  assert.deepEqual(
    await walletsForOwner(newOwner),
    [a],
    "A replacement owner needs no pre-existing Voxy account",
  );
});
