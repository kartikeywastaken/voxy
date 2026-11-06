import {
  devnetReader,
  hashRoster,
  loadDeployments,
  rosterPublisherAbi,
  rosterRegistryAbi,
  sepoliaReader,
} from "@voxy/chain";
import type { Address, Hex } from "viem";

/** A roster read live from one chain, in the canonical positional form the contracts hash. */
export interface RosterView {
  guardians: [Address, Address, Address];
  threshold: number;
  rosterHash: Hex;
}

/**
 * Read the roster live from the Sepolia RosterPublisher (expiry-aware ENSv2 read). This is the
 * source of truth the attesters sign over. `account` defaults to the configured roster account.
 */
export async function readSepoliaRoster(
  account?: Address,
): Promise<RosterView & { parentExpiry: bigint }> {
  const d = loadDeployments();
  const acct = account ?? (d.sepolia.rosterAccount as Address);
  const [guardians, threshold, parentExpiry] = await sepoliaReader().readContract({
    address: d.sepolia.RosterPublisher,
    abi: rosterPublisherAbi,
    functionName: "readRoster",
    args: [acct],
  });
  const g = guardians as readonly [Address, Address, Address];
  return {
    guardians: [g[0], g[1], g[2]],
    threshold: Number(threshold),
    rosterHash: hashRoster(g, Number(threshold)),
    parentExpiry: parentExpiry as bigint,
  };
}

/** Read the currently-stored roster for a wallet from the devnet RosterRegistry. */
export async function readDevnetRoster(wallet?: Address) {
  const d = loadDeployments();
  const w = wallet ?? (d.devnet.VoxyWallet as Address);
  const r = await devnetReader().readContract({
    address: d.devnet.RosterRegistry,
    abi: rosterRegistryAbi,
    functionName: "rosterOf",
    args: [w],
  });
  const guardians = r.guardians as readonly [Address, Address, Address];
  return {
    epoch: r.epoch as bigint,
    threshold: Number(r.threshold),
    guardians: [guardians[0], guardians[1], guardians[2]] as [Address, Address, Address],
    activeAt: r.activeAt as readonly [bigint, bigint, bigint],
    hash: r.hash as Hex,
  };
}
