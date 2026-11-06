---
name: arkiv-entity-lifecycle
description: Create, patch, transfer, replace and delete Arkiv entities with SDK 1.0.x. Use for immutable creation flags, ownership, native batches and restoring references; use write-safety for uncertain submissions.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Arkiv entity lifecycle

Use installed SDK 1.0.x declarations and Rabdi. Native operations target `0x4400000000000000000000000000000000000044`; this does not enable arbitrary application contracts. Run mutations only within the user's entity, signer and spending authorization. Read access does not authorize deletion. SDK 1.0.1 adds `ExpirationTime.max()` for create and Lifetime Extension, bounded by exported `MAX_LIFETIME`; see [expiration guidance](../arkiv-entity-expiration/SKILL.md) for the versioned limit and pre-send `InvalidExpiryError`.

## Flags and permissions

| readonly | permissionlessExtension | Patch | Extend | Transfer | Delete |
| --- | --- | --- | --- | --- | --- |
| false | false | Owner | Owner | Owner | Owner |
| false | true | Owner | Anyone | Owner | Owner |
| true | false | Nobody | Owner | Owner | Owner |
| true | true | Nobody | Anyone | Owner | Owner |

Both flags default false and are immutable. They apply to live entities. Readonly protects attributes, including bytes columns; owner operations can still affect availability. Permissionless extension grants no patch, transfer or deletion right, and can postpone an owner's preferred expiration.

`$owner` is current authority; `$creator` is the creating wallet. A transfer needs no recipient consent. Creator plus current owner cannot authenticate mutable values after a transfer away/edit/transfer back. Follow the [publication policy](../arkiv-security-trust/SKILL.md#trust-a-publication-not-a-namespace).

## Exact write signatures

```typescript
import { createWalletClient, createPublicClient, ExpirationTime, type Expiry, type TxParams } from '@arkiv-network/sdk';
import { defineSchema, str, bytes, u64 } from '@arkiv-network/sdk/schema';
import { isAddressEqual, zeroAddress, type Address, type Hex } from 'viem';
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



export const Notes = defineSchema('example_notes', {
  status: str().indexed(), created_at: u64(), body: bytes(),
  draft_reason: str().optional(),
});
type Wallet = ReturnType<typeof createWalletClient>;
type Reader = ReturnType<typeof createPublicClient>;
type EstimateLatest = (prepare: (unsigned: Wallet) => Promise<unknown>) => Promise<bigint>;
async function txParams(reader: Reader, wallet: Wallet, estimate: bigint): Promise<TxParams> {
  const gas = 2n * estimate > 1000000n ? 2n * estimate : 1000000n;
  const block = await reader.getBlock({ blockTag: 'latest' });
  if (typeof block.gasLimit !== 'bigint' || block.gasLimit <= 0n) throw safeError('Latest block gas limit required');
  if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');
  if (estimate <= 0n || !wallet.account) throw safeError('Authorized account and Rabdi gas floor required');
  const address = wallet.account.address;
  const latest = await reader.getTransactionCount({ address, blockTag: 'latest' });
  if (await reader.getTransactionCount({ address, blockTag: 'pending' }) !== latest) throw safeError('Resolve pending nonce');
  return { nonce: latest, gas, gasPrice: await getGasPrice(reader) };
}
async function checked<T extends { txHash: Hex }>(reader: Reader, result: T): Promise<T> {
  const receipt = await reader.getTransactionReceipt({ hash: result.txHash });
  if (receipt.status !== 'success') throw safeError('Receipt disagrees after SDK success; reconcile without resending', { txHash: result.txHash });
  return result;
}
export async function publish(reader: Reader, wallet: Wallet, expiration: Expiry, salt: bigint, estimateLatest: EstimateLatest) {
  try {
    const values = { status: 'published', created_at: u64(Date.now()), body: new TextEncoder().encode('Public example') };
    const options = { expiration, salt, flags: { readonly: true } };
    const estimate = await estimateLatest(unsigned => unsigned.createEntity(Notes, values, options));
    return await checked(reader, await wallet.createEntity(Notes, values, options, await txParams(reader, wallet, estimate)));
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export async function patchDraft(reader: Reader, wallet: Wallet, entityKey: Hex, estimateLatest: EstimateLatest) {
  try {
    const estimate = await estimateLatest(unsigned => unsigned.patchEntity(Notes, entityKey, { set: { status: 'published' }, unset: ['draft_reason'] }));
    return await checked(reader, await wallet.patchEntity(Notes, entityKey, { set: { status: 'published' }, unset: ['draft_reason'] }, await txParams(reader, wallet, estimate)));
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export async function transferAndInspect(reader: Reader, wallet: Wallet, entityKey: Hex, newOwner: Address, estimateLatest: EstimateLatest) {
  try {
    const before = await reader.getEntity(entityKey, Notes);
    if (isAddressEqual(newOwner, zeroAddress) || isAddressEqual(newOwner, before.$owner)) throw safeError('Choose another nonzero owner');
    const estimate = await estimateLatest(unsigned => unsigned.changeOwnership({ entityKey, newOwner }));
    const transferred = await checked(reader, await wallet.changeOwnership({ entityKey, newOwner }, await txParams(reader, wallet, estimate)));
    try {
      const after = await reader.getEntity(entityKey, Notes);
      return await { ...transferred, ownerAtRead: after.$owner,
        creatorUnchanged: isAddressEqual(before.$creator, after.$creator) };
    } catch { return await { ...transferred, status: 'confirmed_read_failed' as const }; }
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export async function extend(reader: Reader, wallet: Wallet, entityKey: Hex, deadline: bigint, estimateLatest: EstimateLatest) {
  try {
    const operation = { entityKey, expiration: ExpirationTime.atBlock(deadline) };
    const estimate = await estimateLatest(unsigned => unsigned.extendEntity(operation));
    return await checked(reader, await wallet.extendEntity(operation, await txParams(reader, wallet, estimate)));
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
// Only invoke when deletion of this exact entity is independently authorized.
export async function remove(reader: Reader, wallet: Wallet, entityKey: Hex, estimateLatest: EstimateLatest) {
  try {
    const estimate = await estimateLatest(unsigned => unsigned.deleteEntity({ entityKey }));
    return await checked(reader, await wallet.deleteEntity({ entityKey }, await txParams(reader, wallet, estimate)));
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

`patchEntity(schema, key, { set, unset }, txParams?)` changes only named columns. Unmentioned or undefined values remain. `unset` accepts only optional columns; required ones must keep a value. Defaults apply to creates only. Patch cannot change identity, owner, flags or expiration and has no compare-and-set. Coordinate same-owner writers.

Create uses `(schema, values, { expiration, flags?, salt? }, txParams?)`. Batches place `{ schema, values, expiration, flags?, salt? }` in `creates`, and `{ schema, entityKey, set?, unset? }` in `patches`. The SDK orders creates → patches → deletes → extensions → ownership changes. One batch is atomic regardless of object property order; multiple batches are independent. Deleting then extending the same key fails the whole native batch.

For Rabdi, explicit nonce/gas/gasPrice is the recommended default for every operation. Before these helpers, authorize the exact mutation, estimate it unsigned and compare the chosen gas × current gasPrice with the approved spend and balance. Single-operation floor: 1,000,000; N-operation batch floor: `1,000,000 + 400,000 × (N − 1)`. Large bytes require at least twice the measured maximum gas as well. Fresh latest/pending nonce checks require exclusive signer custody; they do not reserve a nonce across processes.

The helpers do not retry. Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy.

## Corrections and identity

Readonly corrections require a new entity and old-to-new mapping. Validate source provenance, preserve original creator/ownership history in an independently authenticated manifest and update authorized app references. A correction never authorizes deleting the original. New creates initially belong to and identify the restoring signer, not the old creator.

Same-batch key references require exclusive coordination of all creates from that signer, exact predicted salts and complete ordered key validation. Read [relationships](../arkiv-data-modeling/references/relationships.md). On a mismatch after confirmation retain the actual keys/hash and reconcile instead of resending.

Deletion and natural expiration remove live availability, not copies already read. A missing entity can also mean wrong key/network or reset. An expired entity cannot be revived under its original key. Read [backup/restore](references/backup-restore.md) for authenticated capture and reference remapping and expiration guidance for deadlines.

Verify successful receipts and fresh selected fields after each operation. A later read is a head observation, not necessarily the transaction's block state. Any ambiguous send or decoding failure goes to write-safety before another mutation.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.

The required `estimateLatest` callback is bound to the guarded unsigned estimator in `arkiv-first-write/references/estimate.md`: `prepare => estimateWrite(account, accessKey, prepare)`. It must estimate the supplied exact operation at latest, return its positive gas estimate, and propagate only sanitized diagnostics with no raw or nested causes without signing/sending. If preflight errors, stop. Funded writes always pass explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, current gasPrice and latest nonce; approve the resulting cost before admission.
