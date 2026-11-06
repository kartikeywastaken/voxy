import {
  devnetReader,
  loadDeployments,
  type RecoveryDigest,
  recoveryDigestTypedData,
  rosterRegistryAbi,
  voxyWalletAbi,
} from "@voxy/chain";
import { type Address, type Hex, keccak256, stringToHex } from "viem";

/**
 * Build the exact RecoveryDigest the guardians must sign, reading all epoch/roster values LIVE
 * from the devnet wallet + registry so a stale value can never slip in. `requestId` is any unique
 * 32-byte id (single-use on-chain); `callHash` defaults to the empty-call hash for the direct
 * (non-frame) `requestRecovery` path.
 */
export async function buildRecoveryDigest(
  newKey: Address,
  opts: { deadlineSeconds?: number; requestId?: Hex; callHash?: Hex; wallet?: Address } = {},
): Promise<{ message: RecoveryDigest; typedData: ReturnType<typeof recoveryDigestTypedData> }> {
  const d = loadDeployments();
  const wallet = opts.wallet ?? (d.devnet.VoxyWallet as Address);
  const reader = devnetReader();

  const [ownerEpoch, roster] = await Promise.all([
    reader.readContract({ address: wallet, abi: voxyWalletAbi, functionName: "ownerEpoch" }),
    reader.readContract({
      address: d.devnet.RosterRegistry,
      abi: rosterRegistryAbi,
      functionName: "rosterOf",
      args: [wallet],
    }),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const requestId =
    opts.requestId ?? (keccak256(stringToHex(`voxy-recovery-${Date.now()}`)) as Hex);
  const callHash = opts.callHash ?? (keccak256("0x") as Hex);

  const message: RecoveryDigest = {
    chainId: BigInt(d.devnet.chainId),
    wallet,
    newKey,
    ownerEpoch: ownerEpoch as bigint,
    rosterEpoch: roster.epoch as bigint,
    rosterHash: roster.hash as Hex,
    deadline: BigInt(now + (opts.deadlineSeconds ?? 3600)),
    requestId,
    callHash,
  };

  return { message, typedData: recoveryDigestTypedData(d.devnet.chainId, wallet, message) };
}
