import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { loadDeployments } from "@voxy/chain";

/**
 * Live EIP-7702 recovery demo for a REAL EOA — no MetaMask, no simulation.
 *  1. create: generate a wallet, fund it with real Sepolia ETH.
 *  2. protect: the wallet signs an EIP-7702 authorization delegating itself to VoxyDelegate, and a
 *     sponsor submits it + configures the ENS guardian roster. The EOA keeps its address and funds.
 *  3. recover: guardians sign; requestRecovery + executeRecovery add a new controller; the new
 *     controller moves the EOA's funds to a destination you pick (e.g. your MetaMask), which you
 *     then see arrive on Sepolia. Every step is a real transaction with an explorer link.
 */

const d = loadDeployments();
const RPC = process.env.SEPOLIA_RPC_URL || (d.sepolia.rpc as string);
const DELEGATE = getAddress(d.sepolia.VoxyDelegate as string);
const PUBLISHER = getAddress(d.sepolia.RosterPublisher as string);
const ROSTER = getAddress(d.sepolia.rosterAccount as string);
const EX = d.sepolia.explorer as string;
const link = (hash: string) => ({ hash, explorer: `${EX}/tx/${hash}` });

const transport = () => http(RPC);
const pub = () => createPublicClient({ chain: sepolia, transport: transport() });
function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`Server missing ${name}`);
  return v as Hex;
}
const sponsor = () => privateKeyToAccount(pk("SEPOLIA_DEPLOYER_PK"));
const sponsorWallet = () => createWalletClient({ account: sponsor(), chain: sepolia, transport: transport() });

// in-memory key custody for the demo wallets (reset on restart)
const keys = new Map<string, Hex>();

const delegateAbi = [
  { type: "function", name: "configure", stateMutability: "nonpayable", inputs: [{ name: "source", type: "address" }, { name: "account", type: "address" }, { name: "delay", type: "uint64" }], outputs: [] },
  { type: "function", name: "ownerEpoch", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "requestRecovery", stateMutability: "nonpayable", inputs: [{ name: "d", type: "tuple", components: [{ name: "chainId", type: "uint256" }, { name: "account", type: "address" }, { name: "newController", type: "address" }, { name: "ownerEpoch", type: "uint64" }, { name: "rosterHash", type: "bytes32" }, { name: "deadline", type: "uint64" }, { name: "requestId", type: "bytes32" }] }, { name: "guardianSigs", type: "bytes[]" }], outputs: [] },
  { type: "function", name: "executeRecovery", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }], outputs: [] },
] as const;
const publisherAbi = [
  { type: "function", name: "readRoster", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "address[3]" }, { type: "uint8" }, { type: "uint64" }] },
] as const;

const recoveryTypes = {
  RecoveryDigest: [
    { name: "chainId", type: "uint256" },
    { name: "account", type: "address" },
    { name: "newController", type: "address" },
    { name: "ownerEpoch", type: "uint64" },
    { name: "rosterHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "requestId", type: "bytes32" },
  ],
} as const;

async function wait(hash: Hex) {
  const r = await pub().waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
}

/** 1. Generate a real wallet and fund it with Sepolia ETH. */
export async function create7702() {
  const key = generatePrivateKey();
  const eoa = privateKeyToAccount(key);
  keys.set(eoa.address.toLowerCase(), key);
  const fundHash = await sponsorWallet().sendTransaction({ to: eoa.address, value: parseEther("0.004") });
  await wait(fundHash);
  const balance = await pub().getBalance({ address: eoa.address });
  return { address: eoa.address, balance: formatEther(balance), fundTx: link(fundHash) };
}

/** 2. Delegate the EOA to VoxyDelegate (EIP-7702) and configure its guardian roster. */
export async function protect7702(addressRaw: string) {
  const address = getAddress(addressRaw);
  const key = keys.get(address.toLowerCase());
  if (!key) throw new Error("Create the wallet first (its key is held for the demo).");
  const eoa = privateKeyToAccount(key);
  const nonce = await pub().getTransactionCount({ address: eoa.address });
  const auth = await eoa.signAuthorization({ contractAddress: DELEGATE, chainId: sepolia.id, nonce });
  const data = encodeFunctionData({ abi: delegateAbi, functionName: "configure", args: [PUBLISHER, ROSTER, 0n] });
  const hash = await sponsorWallet().sendTransaction({ to: eoa.address, data, authorizationList: [auth] });
  await wait(hash);
  const code = await pub().getCode({ address: eoa.address });
  const [guardians, threshold] = (await pub().readContract({ address: PUBLISHER, abi: publisherAbi, functionName: "readRoster", args: [ROSTER] })) as [Address[], number, bigint];
  return {
    protectTx: link(hash),
    delegatedTo: DELEGATE,
    code,
    guardians: guardians.filter((a) => a && !/^0x0+$/.test(a)),
    threshold: Number(threshold),
  };
}

/** 3. Guardians recover the account and move its funds to `destination` (your MetaMask). */
export async function recover7702(addressRaw: string, destinationRaw: string) {
  const address = getAddress(addressRaw);
  if (!isAddress(destinationRaw, { strict: false })) throw new Error("destination must be a 0x… address");
  const destination = getAddress(destinationRaw);
  if (!keys.get(address.toLowerCase())) throw new Error("Unknown wallet; create + protect it first.");

  const [guardians, threshold] = (await pub().readContract({ address: PUBLISHER, abi: publisherAbi, functionName: "readRoster", args: [ROSTER] })) as [Address[], number, bigint];
  const rosterHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint8" }],
      [guardians[0], guardians[1], guardians[2], Number(threshold)],
    ),
  );
  const ownerEpoch = (await pub().readContract({ address, abi: delegateAbi, functionName: "ownerEpoch" })) as bigint;

  const newController = privateKeyToAccount(generatePrivateKey());
  const message = {
    chainId: BigInt(sepolia.id),
    account: address,
    newController: newController.address,
    ownerEpoch,
    rosterHash,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    requestId: generatePrivateKey(), // random 32 bytes
  } as const;
  const domain = { name: "Voxy", version: "1", chainId: sepolia.id, verifyingContract: address } as const;

  // guardians (server-held demo keys) sign the digest — real ECDSA, verified on-chain
  const guardianKeys = ["GUARDIAN_1_PK", "GUARDIAN_2_PK", "GUARDIAN_3_PK"]
    .map((n) => process.env[n]?.trim())
    .filter((v): v is string => !!v && /^0x[0-9a-fA-F]{64}$/.test(v))
    .map((v) => privateKeyToAccount(v as Hex))
    .filter((acc) => guardians.some((g) => g.toLowerCase() === acc.address.toLowerCase()));
  const sigs: Hex[] = [];
  for (const g of guardianKeys) {
    if (sigs.length >= Number(threshold)) break;
    sigs.push(await g.signTypedData({ domain, types: recoveryTypes, primaryType: "RecoveryDigest", message }));
  }
  if (sigs.length < Number(threshold)) throw new Error("Not enough server-held guardians match the roster");

  const reqHash = await sponsorWallet().writeContract({ address, abi: delegateAbi, functionName: "requestRecovery", args: [message, sigs] });
  await wait(reqHash);
  const execHash = await sponsorWallet().writeContract({ address, abi: delegateAbi, functionName: "executeRecovery", args: [] });
  await wait(execHash);

  // the recovered (new) controller needs a little gas to operate the account, then moves the funds
  const gasFund = await sponsorWallet().sendTransaction({ to: newController.address, value: parseEther("0.0006") });
  await wait(gasFund);
  const balance = await pub().getBalance({ address });
  const destBefore = await pub().getBalance({ address: destination });
  const ncWallet = createWalletClient({ account: newController, chain: sepolia, transport: transport() });
  const moveHash = await ncWallet.writeContract({ address, abi: delegateAbi, functionName: "execute", args: [[{ to: destination, value: balance, data: "0x" }]] });
  await wait(moveHash);
  const destAfter = await pub().getBalance({ address: destination });

  return {
    newController: newController.address,
    requestTx: link(reqHash),
    executeTx: link(execHash),
    moveTx: link(moveHash),
    moved: formatEther(balance),
    destination,
    destinationBefore: formatEther(destBefore),
    destinationAfter: formatEther(destAfter),
  };
}

/** One call for the website: create a funded wallet, 7702-protect it, recover it, sweep to `destination`. */
export async function runDemo(destination: string) {
  const created = await create7702();
  const protect = await protect7702(created.address);
  const recover = await recover7702(created.address, destination);
  return { created, protect, recover };
}
