import {
  type Address,
  type Hex,
  devnetReader,
  devnetWallet,
  loadDeployments,
  rosterPublisherAbi,
  sepoliaReader,
  sepoliaWallet,
} from "@voxy/chain";
import {
  buildAttestation,
  readDevnetRoster,
  signAttestation,
  submitRoster,
} from "@voxy/attester";
import { getAddress, isAddress, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { voxyWalletBytecode } from "./voxywallet-bytecode.js";

const NODE = keccak256(toBytes("voxy.eth"));
const CTOR_ABI = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "initialOwner", type: "address" },
      { name: "registry_", type: "address" },
      { name: "recoveryDelay_", type: "uint64" },
    ],
  },
] as const;

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`Server missing ${name}`);
  return v as Hex;
}

/**
 * Deploy a fresh Voxy smart-account on the devnet owned by `owner`, wire it to the shared ENS
 * guardian roster (configure → publish on Sepolia), and sync that roster to the devnet registry so
 * the new wallet is immediately recoverable. This is the "smart-account" protection path — it does
 * NOT touch the owner's existing EOA (that would need an EIP-7702 delegation the wallet must sign).
 * Every step is a real transaction. Returns the new wallet address and all tx links.
 */
export async function createWallet(ownerRaw: string, delaySeconds = 60) {
  if (!isAddress(ownerRaw, { strict: false })) throw new Error("owner must be a 0x… address");
  const owner = getAddress(ownerRaw);
  const d = loadDeployments();
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const dreader = devnetReader();

  // 1. Deploy VoxyWallet(owner, RosterRegistry, delay) on the devnet.
  const deployHash = await devnetWallet(payer).deployContract({
    abi: CTOR_ABI,
    bytecode: voxyWalletBytecode as Hex,
    args: [owner, d.devnet.RosterRegistry as Address, BigInt(delaySeconds)],
  });
  const deployReceipt = await dreader.waitForTransactionReceipt({ hash: deployHash });
  if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
    throw new Error(`wallet deploy reverted: ${deployHash}`);
  }
  const wallet = getAddress(deployReceipt.contractAddress);

  // 2. Point its roster at the shared ENS guardian subnames, and publish, on Sepolia.
  const sadmin = privateKeyToAccount(pk("SEPOLIA_DEPLOYER_PK"));
  const swallet = sepoliaWallet(sadmin);
  const sreader = sepoliaReader();
  const cfgHash = await swallet.writeContract({
    address: d.sepolia.RosterPublisher as Address,
    abi: rosterPublisherAbi,
    functionName: "configure",
    args: [wallet, d.sepolia.UserRegistry as Address, d.sepolia.ThresholdResolver as Address, NODE],
  });
  await sreader.waitForTransactionReceipt({ hash: cfgHash });
  const pubHash = await swallet.writeContract({
    address: d.sepolia.RosterPublisher as Address,
    abi: rosterPublisherAbi,
    functionName: "publish",
    args: [wallet],
  });
  await sreader.waitForTransactionReceipt({ hash: pubHash });

  // 3. Attest the roster (2-of-3) and submit it to the devnet registry for the new wallet.
  const current = await readDevnetRoster(wallet);
  const epoch = current.epoch + 1n;
  const attestation = await buildAttestation(epoch, { account: wallet });
  const a1 = await signAttestation(pk("ATTESTER_1_PK"), attestation);
  const a2 = await signAttestation(pk("ATTESTER_2_PK"), attestation);
  const sync = await submitRoster(payer, attestation, [a1.signature, a2.signature]);

  return {
    wallet,
    owner,
    recoveryDelaySeconds: delaySeconds,
    deployTx: { hash: deployHash, explorer: `${d.devnet.explorer}/tx/${deployHash}` },
    configureTx: { hash: cfgHash, explorer: `${d.sepolia.explorer}/tx/${cfgHash}` },
    publishTx: { hash: pubHash, explorer: `${d.sepolia.explorer}/tx/${pubHash}` },
    syncTx: { ...sync, epoch: Number(epoch) },
  };
}
