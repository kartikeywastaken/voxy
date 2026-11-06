import {
  devnetReader,
  devnetWallet,
  loadDeployments,
  type RosterAttestation,
  rosterRegistryAbi,
} from "@voxy/chain";
import type { Account, Hex } from "viem";

/**
 * Submit a roster attestation with its collected signatures to the devnet RosterRegistry.
 * Anyone can submit (it is permissionless); `payer` just funds the gas. The contract enforces
 * 2-of-3 distinct attester signatures, epoch == stored+1, and validUntil.
 */
export async function submitRoster(
  payer: Account,
  attestation: RosterAttestation,
  signatures: Hex[],
): Promise<{ txHash: Hex; explorer: string }> {
  const d = loadDeployments();
  const wallet = devnetWallet(payer);
  const reader = devnetReader();

  const { request } = await reader.simulateContract({
    address: d.devnet.RosterRegistry,
    abi: rosterRegistryAbi,
    functionName: "submitRoster",
    args: [attestation, signatures],
    account: payer,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`submitRoster reverted: ${txHash}`);
  return { txHash, explorer: `${d.devnet.explorer}/tx/${txHash}` };
}
