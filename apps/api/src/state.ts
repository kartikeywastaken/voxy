import { verifySync } from "@voxy/attester";
import { type Address, devnetReader, loadDeployments, voxyWalletAbi } from "@voxy/chain";

/**
 * The full live state the UI shows for a wallet: roster (cross-chain verified), ownership, and any
 * pending recovery. Everything is read from chain at call time — no cache, no mock.
 */
export async function walletState(wallet?: Address) {
  const d = loadDeployments();
  const w = wallet ?? (d.devnet.VoxyWallet as Address);
  const reader = devnetReader();
  const base = { address: w, abi: voxyWalletAbi } as const;

  const [owners, ownerEpoch, frozen, recoveryDelay, pending, sync] = await Promise.all([
    reader.readContract({ ...base, functionName: "owners" }),
    reader.readContract({ ...base, functionName: "ownerEpoch" }),
    reader.readContract({ ...base, functionName: "frozen" }),
    reader.readContract({ ...base, functionName: "recoveryDelay" }),
    reader.readContract({ ...base, functionName: "pending" }),
    verifySync(undefined, w),
  ]);

  const [pendingKey, readyAt, requestId] = pending;
  const now = Math.floor(Date.now() / 1000);
  const hasPending = pendingKey !== "0x0000000000000000000000000000000000000000";

  return {
    wallet: w,
    chain: { devnet: d.devnet.chainId, sepolia: d.sepolia.chainId },
    explorer: { devnet: d.devnet.explorer, sepolia: d.sepolia.explorer },
    owners: owners as Address[],
    ownerCount: (owners as Address[]).length,
    ownerEpoch: Number(ownerEpoch),
    frozen,
    recoveryDelaySeconds: Number(recoveryDelay),
    roster: {
      account: sync.account,
      epoch: Number(sync.devnet.epoch),
      threshold: sync.devnet.threshold,
      guardians: sync.devnet.guardians,
      rosterHash: sync.devnet.rosterHash,
      crossChainMatch: sync.match,
      mismatches: sync.mismatches,
      sepoliaRosterHash: sync.sepolia.rosterHash,
    },
    pending: hasPending
      ? {
          newKey: pendingKey,
          readyAt: Number(readyAt),
          requestId,
          secondsRemaining: Math.max(0, Number(readyAt) - now),
          ready: now >= Number(readyAt),
        }
      : null,
  };
}

export type WalletState = Awaited<ReturnType<typeof walletState>>;
