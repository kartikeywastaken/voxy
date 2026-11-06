import { loadDeployments } from "@voxy/chain";
import type { Address } from "viem";
import { readDevnetRoster, readSepoliaRoster } from "./roster.js";

export interface VerifySyncReport {
  account: Address;
  wallet: Address;
  sepolia: { rosterHash: string; threshold: number; guardians: Address[] };
  devnet: { epoch: string; rosterHash: string; threshold: number; guardians: Address[] };
  match: boolean;
  mismatches: string[];
}

/**
 * The honest-bridge auditor (bible §6.2). Independently re-reads the roster from Sepolia and
 * compares it to what the devnet RosterRegistry currently stores. Anyone can run this to detect
 * an attester set that signed something other than the live ENS truth. Pure reads; no trust.
 */
export async function verifySync(account?: Address, wallet?: Address): Promise<VerifySyncReport> {
  const d = loadDeployments();
  const acct = account ?? (d.sepolia.rosterAccount as Address);
  const w = wallet ?? (d.devnet.VoxyWallet as Address);

  const [sep, dev] = await Promise.all([readSepoliaRoster(acct), readDevnetRoster(w)]);

  const mismatches: string[] = [];
  if (sep.rosterHash.toLowerCase() !== dev.hash.toLowerCase()) {
    mismatches.push(`rosterHash: sepolia ${sep.rosterHash} != devnet ${dev.hash}`);
  }
  if (sep.threshold !== dev.threshold) {
    mismatches.push(`threshold: sepolia ${sep.threshold} != devnet ${dev.threshold}`);
  }
  for (let i = 0; i < 3; i++) {
    if (sep.guardians[i]?.toLowerCase() !== dev.guardians[i]?.toLowerCase()) {
      mismatches.push(`guardian[${i}]: sepolia ${sep.guardians[i]} != devnet ${dev.guardians[i]}`);
    }
  }

  return {
    account: acct,
    wallet: w,
    sepolia: { rosterHash: sep.rosterHash, threshold: sep.threshold, guardians: sep.guardians },
    devnet: {
      epoch: dev.epoch.toString(),
      rosterHash: dev.hash,
      threshold: dev.threshold,
      guardians: dev.guardians,
    },
    match: mismatches.length === 0,
    mismatches,
  };
}
