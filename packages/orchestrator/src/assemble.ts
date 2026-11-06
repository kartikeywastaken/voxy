import {
  devnetReader,
  devnetWallet,
  loadDeployments,
  type RecoveryDigest,
  recoveryDigestTypedData,
  rosterRegistryAbi,
  voxyWalletAbi,
} from "@voxy/chain";
import { type Account, type Address, type Hex, recoverTypedDataAddress } from "viem";

export interface ApprovalCheck {
  signature: Hex;
  guardian: Address | null;
  activeGuardian: boolean;
  counted: boolean;
  reason?: string;
}

/**
 * Verify a batch of guardian signatures over ONE RecoveryDigest the same way the wallet does:
 * recover the signer, require it to be an active guardian in the devnet registry, and dedup.
 * Returns a per-signature report plus the distinct valid signatures ready for submission.
 */
export async function verifyApprovals(
  message: RecoveryDigest,
  signatures: Hex[],
): Promise<{ checks: ApprovalCheck[]; valid: Hex[]; threshold: number }> {
  const d = loadDeployments();
  const reader = devnetReader();
  const typed = recoveryDigestTypedData(d.devnet.chainId, message.wallet, message);

  const roster = await reader.readContract({
    address: d.devnet.RosterRegistry,
    abi: rosterRegistryAbi,
    functionName: "rosterOf",
    args: [message.wallet],
  });

  const checks: ApprovalCheck[] = [];
  const valid: Hex[] = [];
  const seen = new Set<string>();

  for (const signature of signatures) {
    let guardian: Address | null = null;
    try {
      guardian = await recoverTypedDataAddress({ ...typed, signature });
    } catch {
      checks.push({
        signature,
        guardian: null,
        activeGuardian: false,
        counted: false,
        reason: "bad signature",
      });
      continue;
    }
    const active = await reader.readContract({
      address: d.devnet.RosterRegistry,
      abi: rosterRegistryAbi,
      functionName: "isActiveGuardian",
      args: [message.wallet, guardian],
    });
    const dup = seen.has(guardian.toLowerCase());
    const counted = active && !dup;
    if (counted) {
      seen.add(guardian.toLowerCase());
      valid.push(signature);
    }
    checks.push({
      signature,
      guardian,
      activeGuardian: active,
      counted,
      reason: !active ? "not an active guardian" : dup ? "duplicate signer" : undefined,
    });
  }

  return { checks, valid, threshold: Number(roster.threshold) };
}

/**
 * Assemble a quorum and submit `requestRecovery` to the devnet wallet. Anyone can run this (it is
 * the permissionless assembler of bible §9.3). Reverts locally (via simulate) if the quorum is not
 * met, before spending any gas.
 */
export async function assembleAndSubmit(
  payer: Account,
  message: RecoveryDigest,
  signatures: Hex[],
): Promise<{ txHash: Hex; explorer: string; valid: number; threshold: number }> {
  const d = loadDeployments();
  const { valid, threshold } = await verifyApprovals(message, signatures);
  if (valid.length < threshold) {
    throw new Error(`Quorum not met: ${valid.length} valid of ${threshold} required`);
  }

  const reader = devnetReader();
  const { request } = await reader.simulateContract({
    address: message.wallet,
    abi: voxyWalletAbi,
    functionName: "requestRecovery",
    args: [message, valid],
    account: payer,
  });
  const txHash = await devnetWallet(payer).writeContract(request);
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`requestRecovery reverted: ${txHash}`);
  return { txHash, explorer: `${d.devnet.explorer}/tx/${txHash}`, valid: valid.length, threshold };
}
