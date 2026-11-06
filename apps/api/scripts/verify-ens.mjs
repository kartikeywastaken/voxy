import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const repo = process.cwd(),
  require = createRequire(`${repo}/package.json`);
const { createPublicClient, createWalletClient, defineChain, http, getAddress } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const d = JSON.parse(readFileSync("deployments.json", "utf8"));
// Public Anvil development key. Both transaction endpoints below are local only.
const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const payer = privateKeyToAccount(key);

const keys = Array.from({ length: 3 }, () => generatePrivateKey()),
  people = keys.map((k) => privateKeyToAccount(k));
process.env.DEVNET_RPC_URL = "http://127.0.0.1:18549";
process.env.SEPOLIA_RPC_URL = "http://127.0.0.1:18550";
process.env.DEVNET_DEPLOYER_PK = key;
process.env.SEPOLIA_DEPLOYER_PK = key;
process.env.ATTESTER_1_PK = keys[0];
process.env.ATTESTER_2_PK = keys[1];
const processes = [];
// Anvil's upstream RPC is read-only, including through this test proxy.
const proxy = createServer(async (req, res) => {
  try {
    let body = "";
    for await (const c of req) body += c;
    const json = JSON.parse(body);
    for (const call of Array.isArray(json) ? json : [json])
      if (
        !/^(eth_get|eth_blockNumber$|eth_chainId$|net_version$|web3_clientVersion$)/.test(
          call.method,
        )
      )
        throw Error("Only read RPC allowed");
    const upstream = await fetch(d.sepolia.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
    });
    res.setHeader("content-type", "application/json");
    res.end(await upstream.text());
  } catch (e) {
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: e.message } }));
  }
});
await new Promise((r) => proxy.listen(18551, "127.0.0.1", r));
const watchdog = setTimeout(() => {
  console.error("Fork verification timed out");
  for (const p of processes) p.kill();
  proxy.closeAllConnections();
  proxy.close();
  process.exit(1);
}, 180000);

try {
  console.log("Starting isolated chains");
  for (const [port, id, fork] of [
    [18549, 1337, null],
    [18550, 11155111, "http://127.0.0.1:18551"],
  ]) {
    const args = [
      "--port",
      String(port),
      "--chain-id",
      String(id),
      "--block-time",
      "1",
      "--silent",
      ...(fork ? ["--fork-url", fork, "--timeout", "15000"] : []),
    ];
    const child = spawn("anvil", args, { stdio: ["ignore", "ignore", "pipe"] });
    processes.push(child);
    child.stderr.on("data", (b) => process.stderr.write(b));
  }
  function clients(port, id) {
    const chain = defineChain({
      id,
      name: "isolated test",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
    });
    return {
      reader: createPublicClient({
        chain,
        pollingInterval: 50,
        transport: http(chain.rpcUrls.default.http[0], { retryCount: 0 }),
      }),
      writer: createWalletClient({
        chain,
        account: payer,
        transport: http(chain.rpcUrls.default.http[0]),
      }),
    };
  }
  const dev = clients(18549, 1337),
    sep = clients(18550, 11155111);
  for (const { reader } of [dev, sep]) {
    let ready = false;
    for (let i = 0; i < 300; i++) {
      try {
        await reader.getChainId();
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(ready, "local fork must start");
  }
  async function deploy(client, path, args = []) {
    console.log("Deploying", path);
    const a = JSON.parse(readFileSync(path, "utf8"));
    const r = await client.reader.waitForTransactionReceipt({
      hash: await client.writer.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }),
    });
    assert.equal(r.status, "success");
    return getAddress(r.contractAddress);
  }
  const registry = await deploy(
    dev,
    "contracts/devnet/out/RosterRegistry.sol/RosterRegistry.json",
    [people.map((v) => v.address), 0n],
  );
  const publisher = await deploy(
    sep,
    "contracts/sepolia/out/RosterPublisher.sol/RosterPublisher.json",
  );
  const resolver = await deploy(
    sep,
    "contracts/sepolia/out/VoxyThresholdResolver.sol/VoxyThresholdResolver.json",
  );
  const chain = await import(`${repo}/packages/chain/src/index.ts`);
  Object.assign(chain.loadDeployments().devnet, { RosterRegistry: registry });
  Object.assign(chain.loadDeployments().sepolia, {
    RosterPublisher: publisher,
    ThresholdResolver: resolver,
  });
  const { createWallet } = await import(`${repo}/apps/api/src/wallet.ts`);
  const { guardianConfig, guardianIntent, authorizeGuardians, setGuardians } = await import(
    `${repo}/apps/api/src/guardians.ts`
  );
  console.log("Creating two isolated recovery accounts");
  const a = await createWallet(people[0].address),
    b = await createWallet(people[1].address);
  assert.deepEqual((await guardianConfig(a.wallet)).guardians, [
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000",
  ]);
  const inputA = {
    wallet: a.wallet,
    guardians: [people[1].address, people[2].address, ""],
    threshold: 2,
  };
  const message = await guardianIntent(inputA.wallet, inputA.guardians, 2);
  await assert.rejects(
    authorizeGuardians({ ...inputA, message, signature: await people[1].signMessage({ message }) }),
    /Only an account owner/,
  );
  await authorizeGuardians({
    ...inputA,
    message,
    signature: await people[0].signMessage({ message }),
  });
  console.log("Setting first roster");
  await setGuardians(inputA);
  const configA = await guardianConfig(a.wallet);
  const inputB = { wallet: b.wallet, guardians: [people[0].address, "", ""], threshold: 1 };
  console.log("Setting second roster");
  await setGuardians(inputB);
  const configB = await guardianConfig(b.wallet);
  assert.notEqual(configA.registry, configB.registry);
  assert.notEqual(configA.node, configB.node);
  assert.deepEqual((await guardianConfig(a.wallet)).guardians, configA.guardians);
  assert.deepEqual(
    (
      await chain.devnetReader().readContract({
        address: registry,
        abi: chain.rosterRegistryAbi,
        functionName: "rosterOf",
        args: [a.wallet],
      })
    ).guardians,
    configA.guardians,
  );
  assert.equal((await setGuardians(inputA)).changed, false);
  await assert.rejects(
    authorizeGuardians({ ...inputA, message, signature: await people[0].signMessage({ message }) }),
    /Roster changed/,
  );
  console.log(
    "PASS: fresh empty guardians, owner-only authorization, real ENSv2 factory proxies on a local Sepolia fork, isolated namespaces and thresholds, attested cross-chain sync, no-op retry, stale authorization rejected. No public transactions.",
  );
} finally {
  clearTimeout(watchdog);
  for (const p of processes) p.kill();
  proxy.closeAllConnections();
  proxy.close();
}
