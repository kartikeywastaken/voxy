import { readDevnetRoster, verifySync } from "@voxy/attester";
import { type Address, devnetReader, loadDeployments, voxyWalletAbi } from "@voxy/chain";
import { encodeFunctionData } from "viem";
import { isVoxyWallet, walletsForOwner } from "./discovery.js";
import { guardianConfig } from "./guardians.js";

/**
 * The full live state the UI shows for a wallet: roster (cross-chain verified), ownership, and any
 * pending recovery. Everything is read from chain at call time — no cache, no mock.
 */
export async function walletState(wallet?: Address) {
  const d = loadDeployments();
  const requested = wallet ?? d.devnet.VoxyWallet;
  const direct = await isVoxyWallet(requested);
  const accounts = direct ? [requested] : await walletsForOwner(requested);
  const w = accounts[0] ?? requested;
  const reader = devnetReader();
  const base = { address: w, abi: voxyWalletAbi } as const;

  // A VoxyWallet is a contract on the devnet. A plain EOA (e.g. a MetaMask address) has no code
  // there, so the wallet reads would throw "returned no data". Detect that and return cleanly.
  if (!accounts.length) {
    return {
      wallet: w,
      accounts,
      demoWallet: d.devnet.VoxyWallet,
      isVoxyWallet: false,
      chain: { devnet: d.devnet.chainId, sepolia: d.sepolia.chainId },
      explorer: { devnet: d.devnet.explorer, sepolia: d.sepolia.explorer },
    } as const;
  }

  const config = await guardianConfig(w);
  const dev = await readDevnetRoster(w);
  const syncReport = config.configured ? await verifySync(config.account, w) : null;
  const [owners, ownerEpoch, frozen, recoveryDelay, pending] = await Promise.all([
    reader.readContract({ ...base, functionName: "owners" }),
    reader.readContract({ ...base, functionName: "ownerEpoch" }),
    reader.readContract({ ...base, functionName: "frozen" }),
    reader.readContract({ ...base, functionName: "recoveryDelay" }),
    reader.readContract({ ...base, functionName: "pending" }),
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
    requestedAddress: requested,
    accounts,
    guardianConfig: config,
    ownerActions: {
      cancel: {
        to: w,
        data: encodeFunctionData({ abi: voxyWalletAbi, functionName: "cancelRecovery" }),
      },
      chain: {
        chainId: `0x${d.devnet.chainId.toString(16)}`,
        chainName: "Voxy devnet",
        rpcUrls: [d.devnet.rpc],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrls: [d.devnet.explorer],
      },
    },
    demoWallet: d.devnet.VoxyWallet,
    isVoxyWallet: true,
    chain: { devnet: d.devnet.chainId, sepolia: d.sepolia.chainId },
    explorer: { devnet: d.devnet.explorer, sepolia: d.sepolia.explorer },
    identity: {
      publisher: d.sepolia.RosterPublisher,
      account: config.account,
      registry: config.configured ? config.registry : null,
      explorer: addr("sepolia", d.sepolia.RosterPublisher),
    },
    surfaces: [
      {
        kind: "ordinary",
        label: "Ordinary transaction",
        chain: "alt-mempool devnet",
        address: w,
        explorer: addr("devnet", w),
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
    ].filter(
      (surface) =>
        surface.kind === "ordinary" || w.toLowerCase() === d.devnet.VoxyWallet.toLowerCase(),
    ),
    owners: owners as Address[],
    ownerCount: (owners as Address[]).length,
    ownerEpoch: Number(ownerEpoch),
    frozen,
    recoveryDelaySeconds: Number(recoveryDelay),
    roster: {
      account: config.account,
      epoch: Number(dev.epoch),
      threshold: dev.threshold,
      guardians: dev.guardians,
      rosterHash: dev.hash,
      configured: config.configured,
      crossChainMatch: syncReport?.match ?? false,
      mismatches: syncReport?.mismatches ?? [],
      sepoliaRosterHash: syncReport?.sepolia.rosterHash ?? null,
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
