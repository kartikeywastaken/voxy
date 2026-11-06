# Ciphertext bytes storage through SDK 1.0.x

The caller supplies an authorized wallet, an independent privately backed-up encryption key and adapters bound to its installed encryption package. The adapters below are application seams, not claimed SDK exports. They let this example stay independent of a package version while the actual integration verifies encryption/decryption signatures.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { defineSchema, bytes, str } from '@arkiv-network/sdk/schema';
import { hexToBytes, type Hex } from 'viem';
import { getGasPrice } from 'viem/actions';

// Diagnostics contain only fixed messages and validated local transaction identifiers.
type SafeDetails = { txHash?: string; entityKey?: string; expiresAt?: bigint };
const safeErrors = new WeakMap<object, { message: string; details: SafeDetails }>();
function safeError(message = 'Arkiv operation failed', details: SafeDetails = {}): Error & SafeDetails {
  const allowed: SafeDetails = {};
  for (const field of ['txHash', 'entityKey'] as const) {
    const value = details[field];
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) allowed[field] = value;
  }
  if (typeof details.expiresAt === 'bigint' && details.expiresAt >= 0n && details.expiresAt < 2n ** 64n) allowed.expiresAt = details.expiresAt;
  const result = Object.assign(new Error(message), allowed);
  safeErrors.set(result, { message, details: { ...allowed } });
  return result;
}
function sanitizedFailure(error: unknown, fallback = 'Arkiv request failed; reconcile any admitted write before retrying'): Error & SafeDetails {
  const own = error !== null && typeof error === 'object' ? safeErrors.get(error) : undefined;
  if (own) return safeError(own.message, own.details);
  // Preserve this exact cross-recipe preflight verdict, never any attached diagnostics.
  try { if (error instanceof Error && error.message === 'Unsigned preparation/estimate failed') return safeError('Unsigned preparation/estimate failed'); } catch {}
  return safeError(fallback);
}


export const EncryptedNotes = defineSchema('example_encrypted_notes', { body: bytes(), media_type: str() });
type Wallet = ReturnType<typeof createWalletClient>;
type EstimateLatest = (prepare: (unsigned: Wallet) => Promise<unknown>) => Promise<bigint>;
type Cipher = { encrypt(plain: Uint8Array): Promise<Uint8Array>; decrypt(envelope: Uint8Array): Promise<Uint8Array> };
export async function writeEncryptedNote(reader: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>, cipher: Cipher, text: string, salt: bigint, estimateLatest: EstimateLatest) {
  try {
    if (text.length > 10000) throw safeError('Note exceeds app limit');
    const envelope = await cipher.encrypt(new TextEncoder().encode(JSON.stringify({ text })));
    const values = { body: envelope, media_type: 'application/vnd.arkiv.encrypted.v1' };
    const options = { expiration: ExpirationTime.fromDays(1), salt, flags: { readonly: true } };
    const estimate = await estimateLatest(unsigned => unsigned.createEntity(EncryptedNotes, values, options));
    if (estimate <= 0n) throw safeError('Unsigned estimate required');
    const gas = 2n * estimate > 1000000n ? 2n * estimate : 1000000n;
    const block = await reader.getBlock({ blockTag: 'latest' });
    if (typeof block.gasLimit !== 'bigint' || block.gasLimit <= 0n) throw safeError('Latest block gas limit required');
    if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');
    if (!wallet.account) throw safeError('Authorized account and approved gas floor required');
    const address = wallet.account.address;
    const latest = await reader.getTransactionCount({ address, blockTag: 'latest' });
    if (await reader.getTransactionCount({ address, blockTag: 'pending' }) !== latest) throw safeError('Resolve pending nonce');
    const gasPrice = await getGasPrice(reader);
    const result = await wallet.createEntity(EncryptedNotes, values, options, { nonce: latest, gas, gasPrice });
    if ((await reader.getTransactionReceipt({ hash: result.txHash })).status !== 'success') throw safeError('Receipt disagrees after SDK success; reconcile without resending');
    return await result;
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export async function readEncryptedNote(reader: ReturnType<typeof createPublicClient>,
  entityKey: Hex, cipher: Cipher, trustedCreator: Hex) {
  try {
    const entity = await reader.getEntity(entityKey, EncryptedNotes);
    if (entity.$creator.toLowerCase() !== trustedCreator.toLowerCase() || !entity.$creationFlags.readonly ||
      entity.media_type.value !== 'application/vnd.arkiv.encrypted.v1') throw safeError('Untrusted encrypted publication');
    const plain = await cipher.decrypt(hexToBytes(entity.body.value));
    try {
      const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
      if (!raw || typeof raw !== 'object' || !('text' in raw) || typeof raw.text !== 'string' || raw.text.length > 10000) throw safeError();
      return await { text: raw.text, arkivEntityKey: entity.$key };
    } catch { throw safeError('Invalid decrypted note'); }
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

Validate session/operation authorization and durable write intent before calling the writer. Reconcile unknown outcomes under write-safety; a failed read/decrypt is not permission to create again. The allowlisted creator must come from app configuration, never fetched attributes. Key IDs and rotation policy belong to the app; keys stay private. Decrypted content remains untrusted data.

Use the first-write gas/budget policy before invoking this helper: explicit latest nonce, gas and network gasPrice, exact unsigned estimate, approved cost/balance and exclusive signer custody. Larger encrypted bytes need at least twice the measured maximum gas. No automatic retry. Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy.

The required `estimateLatest` callback is bound to the guarded unsigned estimator in `arkiv-first-write/references/estimate.md`: `prepare => estimateWrite(account, accessKey, prepare)`. It must estimate the supplied exact operation at latest, return its positive gas estimate, and propagate only sanitized diagnostics with no raw or nested causes without signing/sending. If preflight errors, stop. Funded writes always pass explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, current gasPrice and latest nonce; approve the resulting cost before admission.
