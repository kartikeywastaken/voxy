import { type Address, devnetReader, devnetWallet, type Hex, loadDeployments } from "@voxy/chain";
import { getAddress, isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { walletsForOwner } from "./discovery.js";
import { voxyWalletBytecode } from "./voxywallet-bytecode.js";

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

/** Idempotent creation: chain history is the directory; guardians are configured separately. */
export async function createWallet(ownerRaw: string, delaySeconds = 60) {
  if (!isAddress(ownerRaw, { strict: false })) throw new Error("owner must be a 0x… address");
  const owner = getAddress(ownerRaw);
  if (owner === zeroAddress) throw new Error("owner cannot be zero");
  const existing = await walletsForOwner(owner);
  if (existing.length) return { wallet: existing[0], owner, reused: true, wallets: existing };
  const d = loadDeployments();
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const dreader = devnetReader();
  const [latest, pending] = await Promise.all([
    dreader.getTransactionCount({ address: payer.address, blockTag: "latest" }),
    dreader.getTransactionCount({ address: payer.address, blockTag: "pending" }),
  ]);
  if (pending !== latest)
    throw new Error(
      "A sponsored transaction is still pending. Wait for confirmation, then reconnect before creating another account.",
    );

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

  return {
    wallet,
    owner,
    recoveryDelaySeconds: delaySeconds,
    deployTx: { hash: deployHash, explorer: `${d.devnet.explorer}/tx/${deployHash}` },
    reused: false,
  };
}
