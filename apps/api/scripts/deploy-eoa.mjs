import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifestFile = resolve(
  process.env.VOXY_EOA_DEPLOYMENTS || `${root}/deployments/eoa-sepolia.json`,
);
const existing = await readFile(manifestFile, "utf8").catch((e) => {
  if (e.code === "ENOENT") return "";
  throw e;
});
const deployments = JSON.parse(await readFile(`${root}/deployments.json`, "utf8"));
const reader = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL || deployments.sepolia.rpc, {
    retryCount: 0,
    timeout: 15000,
  }),
});
if ((await reader.getChainId()) !== 11155111) throw new Error("Deployment RPC is not Sepolia");
const key = process.env.SEPOLIA_DEPLOYER_PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(key || ""))
  throw new Error("Set SEPOLIA_DEPLOYER_PK locally; never paste it in chat");
const signer = privateKeyToAccount(key);
const wallet = createWalletClient({
  chain: sepolia,
  account: signer,
  transport: http(process.env.SEPOLIA_RPC_URL || deployments.sepolia.rpc, { retryCount: 0 }),
});
const artifact = async (name) =>
  JSON.parse(await readFile(`${root}/contracts/sepolia/out/${name}.sol/${name}.json`, "utf8"));
const sourceArtifact = await artifact("VoxyEnsRoster"),
  accountArtifact = await artifact("VoxyRecoveryAccount");
const factory = getAddress(deployments.sepolia.ensv2.VerifiableFactory),
  implementation = getAddress(deployments.sepolia.ensv2.UserRegistryImpl);
for (const address of [factory, implementation])
  if (!(await reader.getCode({ address }))) throw new Error("ENSv2 deployment is unavailable");
const nonce = await reader.getTransactionCount({ address: signer.address, blockTag: "latest" });
if (nonce !== (await reader.getTransactionCount({ address: signer.address, blockTag: "pending" })))
  throw new Error("Reconcile pending sponsor transactions first");
const balance = await reader.getBalance({ address: signer.address });
const fee = await reader.estimateFeesPerGas();
const gas = await reader.estimateGas({
  account: signer,
  data: encodeDeployData({
    abi: sourceArtifact.abi,
    bytecode: sourceArtifact.bytecode.object,
    args: [factory, implementation],
  }),
});
const block = await reader.getBlock();
const perTransactionCeiling = block.gasLimit / 2n < 16700000n ? block.gasLimit / 2n : 16700000n;
const sourceGas = (gas * 5n) / 4n;
if (sourceGas > perTransactionCeiling)
  throw new Error("Source deployment exceeds the transaction gas ceiling");
const conservativeMaximum = (sourceGas + perTransactionCeiling) * fee.maxFeePerGas;
console.log(
  JSON.stringify(
    {
      chain: "Sepolia",
      sponsor: signer.address,
      balanceETH: formatEther(balance),
      sourceEstimatedGas: gas.toString(),
      twoContractGasCeiling: (sourceGas + perTransactionCeiling).toString(),
      maximumEstimatedETH: formatEther(conservativeMaximum),
      manifestFile,
      existingDeployment: !!existing,
    },
    null,
    2,
  ),
);
if (!process.argv.includes("--broadcast")) process.exit(0);
if (existing)
  throw new Error(
    "A deployment manifest already exists; verify it instead of deploying another pair",
  );
const approved = parseEther(process.env.VOXY_DEPLOY_MAX_ETH || "0.005");
if (conservativeMaximum > approved || conservativeMaximum > balance)
  throw new Error("Deployment exceeds the approved budget or balance");
const directory = resolve(process.env.VOXY_STATE_DIR || `${root}/.voxy`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const journalPath = resolve(directory, "eoa-deployment.jsonl");
if (
  await readFile(journalPath, "utf8").catch((e) => {
    if (e.code === "ENOENT") return "";
    throw e;
  })
)
  throw new Error("A deployment is already journaled. Reconcile its known hashes; do not redeploy");
async function journal(value) {
  const file = await open(journalPath, "a", 0o600);
  try {
    await file.writeFile(JSON.stringify(value) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
}
async function deploy(name, artifact, args, nonce) {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const estimated = await reader.estimateGas({ account: signer, data });
  const gasLimit = (estimated * 5n) / 4n;
  if (gasLimit > perTransactionCeiling)
    throw new Error("Deployment exceeds the per-transaction gas ceiling");
  const prepared = await wallet.prepareTransactionRequest({
    data,
    gas: gasLimit,
    nonce,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  });
  const raw = await wallet.signTransaction(prepared),
    hash = keccak256(raw);
  await journal({ phase: "submitting", name, chainId: 11155111, nonce, hash, raw });
  await wallet.sendRawTransaction({ serializedTransaction: raw });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`Deployment reverted: ${hash}`);
  const code = await reader.getCode({ address: receipt.contractAddress });
  if (!code || code === "0x") throw new Error("Deployment bytecode readback failed");
  await journal({
    phase: "confirmed",
    name,
    address: receipt.contractAddress,
    hash,
    codeHash: keccak256(code),
  });
  return { address: getAddress(receipt.contractAddress), hash, codeHash: keccak256(code) };
}
const source = await deploy("VoxyEnsRoster", sourceArtifact, [factory, implementation], nonce);
const account = await deploy("VoxyRecoveryAccount", accountArtifact, [source.address], nonce + 1);
const manifest = {
  version: 2,
  chainId: 11155111,
  rosterSource: source.address,
  implementation: account.address,
  implementationCodeHash: account.codeHash,
  rosterCodeHash: source.codeHash,
  ensFactory: factory,
  ensImplementation: implementation,
  sourceTx: source.hash,
  implementationTx: account.hash,
  delaySeconds: 180,
};
await mkdir(resolve(manifestFile, ".."), { recursive: true });
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(manifest, null, 2));

await writeFile(
  `${root}/apps/web/src/wallet/deployment.js`,
  `// Pinned to the verified Sepolia deployment. Public addresses only.\nexport const approvedDeployment = ${JSON.stringify({ ...manifest, rpc: deployments.sepolia.rpc }, null, 2)};\n`,
);
