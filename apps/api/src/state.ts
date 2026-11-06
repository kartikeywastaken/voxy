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

  // Extra deployed addresses the typed loader doesn't declare — read loosely for display only.
  const dd = d as unknown as {
    devnet: { VoxyWalletFrame?: string; frame?: { recoveryFrameTx?: string } };
    sepolia: {
      VoxyDelegate?: string;
      RosterPublisher: string;
      eoa7702Demo?: { recoveredSpendTx?: string };
    };
  };
  const addr = (chain: "devnet" | "sepolia", a?: string) =>
    a ? `${d[chain].explorer}/address/${a}` : undefined;

  return {
    wallet: w,
    chain: { devnet: d.devnet.chainId, sepolia: d.sepolia.chainId },
    explorer: { devnet: d.devnet.explorer, sepolia: d.sepolia.explorer },
    identity: {
      publisher: d.sepolia.RosterPublisher,
      account: d.sepolia.rosterAccount,
      explorer: addr("sepolia", d.sepolia.RosterPublisher),
    },
    surfaces: [
      {
        kind: "ordinary",
        label: "Ordinary transaction",
        chain: "alt-mempool devnet",
        address: d.devnet.VoxyWallet,
        explorer: addr("devnet", d.devnet.VoxyWallet),
        note: "guardian quorum checked in execution",
      },
      {
        kind: "frame",
        label: "EIP-8141 VERIFY frame",
        chain: "alt-mempool devnet",
        address: dd.devnet.VoxyWalletFrame,
        explorer: addr("devnet", dd.devnet.VoxyWalletFrame),
        tx: dd.devnet.frame?.recoveryFrameTx,
        note: "quorum in validation via sigparam, staked admission",
      },
      {
        kind: "eoa7702",
        label: "Existing EOA · EIP-7702",
        chain: "sepolia",
        address: dd.sepolia.VoxyDelegate,
        explorer: addr("sepolia", dd.sepolia.VoxyDelegate),
        tx: dd.sepolia.eoa7702Demo?.recoveredSpendTx,
        note: "recover the wallet you already have, no migration",
      },
    ],
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
