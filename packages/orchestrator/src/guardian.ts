import { loadDeployments, type RecoveryDigest, recoveryDigestTypedData } from "@voxy/chain";
import { type Address, type Hex, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export function guardianAccount(pk: string) {
  const key = pk.trim();
  if (!isHex(key) || key.length !== 66) throw new Error("Guardian key must be a 32-byte hex value");
  return privateKeyToAccount(key);
}

/**
 * A guardian's EIP-712 signature over a RecoveryDigest. This exact signature is what both the
 * Arkiv `guardian-approval` entity carries AND what the on-chain quorum counts — one artifact,
 * verified independently off-chain (assembler) and on-chain (wallet).
 */
export async function signRecovery(
  guardianPk: string,
  message: RecoveryDigest,
): Promise<{ guardian: Address; signature: Hex }> {
  const d = loadDeployments();
  const account = guardianAccount(guardianPk);
  const signature = await account.signTypedData(
    recoveryDigestTypedData(d.devnet.chainId, message.wallet, message),
  );
  return { guardian: account.address, signature };
}
