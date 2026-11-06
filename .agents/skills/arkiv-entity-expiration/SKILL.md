---
name: arkiv-entity-expiration
description: Choose and verify Entity Expiration and Lifetime Extension on Rabdi. Use for relative lifetimes, absolute block deadlines, renewal races and missing entities; use lifecycle for mutation permissions.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Entity Expiration and Lifetime Extension

SDK 1.0.x uses **`expiration`** in create/extension inputs; flat entity reads expose **`$expiresAt`**. Returned create/extend results expose receipt-derived **`expiresAt`**. Deadlines are block heights, separate from application milliseconds.

| Helper | Meaning |
| --- | --- |
| `fromSeconds/Minutes/Hours/Days/Weeks` | Relative lifetime floor from inclusion |
| `fromMonths/Years` | 30-day months / 365-day years before conversion |
| `fromBlocks(n)` | Positive block floor |
| `atBlock(n)` | Absolute block deadline |
| `atDate(date)` | Deadline resolved using the SDK's clock/head conversion |
| `atBlock/atDate` with `{ atLeast }` | Absolute deadline plus a relative minimum floor |
| `max()` (SDK 1.0.1+) | Maximum relative lifetime from inclusion; also valid for Lifetime Extension |
| `permanent()` | Unavailable; no unlimited lifetime |

Nominal conversion uses two seconds per block; converted seconds must be positive whole multiples of two. These are SDK conversion rules, not a wall-clock service promise. The engine resolves `max(absolute, inclusion + floor)`; an absolute target can become dead before inclusion.

## Rabdi maximum lifetime

SDK 1.0.1 adds `ExpirationTime.max()` at the package root. Its `MAX_LIFETIME = 7_884_000n` constant is exported from both `@arkiv-network/sdk/entity` and the package root. The maximum is counted from the block the create or extension lands in, not from the observed head or the existing deadline. `max()` needs no manually subtracted inclusion margin: a successful create expires at `landingBlock + MAX_LIFETIME`, and a successful extension with `max()` sets expiry to its new inclusion block plus `MAX_LIFETIME`. Revalidate network compatibility after a reset or upgrade; this exported SDK constant is not a live node-parameter getter.

In SDK 1.0.1, a duration above `MAX_LIFETIME` (for example `ExpirationTime.fromYears(1)`) or an absolute deadline beyond the SDK's allowed maximum throws `InvalidExpiryError` before sending. Constructing `fromYears(1)` alone does not send or validate a transaction; the write path resolves and rejects it. Rabdi still rejects excessive lifetime from older SDK/raw callers with `ExpiryBeyondMaxLifetime`.

For SDK 1.0.0 compatibility, `max()` and `MAX_LIFETIME` are unavailable; retain the dated measured bound and a conservative below-maximum choice such as `fromBlocks(7_883_970)`. Do not carry that manual margin advice over to `max()` on SDK 1.0.1. Longer-lived data requires successful Lifetime Extension before expiry, recurring monitoring and an available authorized payer. There is no unlimited lifetime or `permanent()` helper.

Historical SDK 1.0.0 behavior: [SDK 1.0.0 behavior: expiration helpers](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/utils/expirationTime.ts) and [SDK 1.0.0 behavior: expiry resolution](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/entity/expiry.ts) support the compatibility fallback above.

## Add time versus ensure remaining life

These absolute-deadline examples retain a conservative SDK 1.0.0 compatibility margin. It is not required by `ExpirationTime.max()` on SDK 1.0.1+, which needs no manual subtraction.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime, type TxParams } from '@arkiv-network/sdk';
import type { Hex } from 'viem';
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


type Reader = ReturnType<typeof createPublicClient>;
type Wallet = ReturnType<typeof createWalletClient>;
type EstimateLatest = (prepare: (unsigned: Wallet) => Promise<unknown>) => Promise<bigint>;
const HOUR = 1800n;
async function params(reader: Reader, wallet: Wallet, estimate: bigint): Promise<TxParams> {
  const gas = 2n * estimate > 1000000n ? 2n * estimate : 1000000n;
  const block = await reader.getBlock({ blockTag: 'latest' });
  if (typeof block.gasLimit !== 'bigint' || block.gasLimit <= 0n) throw safeError('Latest block gas limit required');
  if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');
  if (!wallet.account || estimate <= 0n) throw safeError('Authorized account and gas floor required');
  const address = wallet.account.address;
  const latest = await reader.getTransactionCount({ address, blockTag: 'latest' });
  if (await reader.getTransactionCount({ address, blockTag: 'pending' }) !== latest) throw safeError('Resolve pending nonce');
  return { nonce: latest, gas, gasPrice: await getGasPrice(reader) };
}
async function confirmed<T extends { txHash: Hex }>(reader: Reader, result: T): Promise<T> {
  if ((await reader.getTransactionReceipt({ hash: result.txHash })).status !== 'success') throw safeError('Receipt disagrees after SDK success; reconcile without resending');
  return result;
}
// maxLifetime comes from current network configuration: a published getter, or dated measured fallback.
export async function addOneHour(reader: Reader, wallet: Wallet, entityKey: Hex, maxLifetime: bigint, estimateLatest: EstimateLatest) {
  try {
    const entity = await reader.getEntity(entityKey);
    const head = await reader.getBlockNumber({ cacheTime: 0 });
    const target = entity.$expiresAt + HOUR;
    if (entity.$expiresAt <= head || maxLifetime <= HOUR + 30n || target > head + maxLifetime - 30n) throw safeError('Deadline outside live renewal window');
    const operation = { entityKey, expiration: ExpirationTime.atBlock(target) };
    const estimate = await estimateLatest(unsigned => unsigned.extendEntity(operation));
    return await confirmed(reader, await wallet.extendEntity(operation, await params(reader, wallet, estimate)));
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export async function ensureOneHourRemains(reader: Reader, wallet: Wallet, entityKey: Hex, maxLifetime: bigint, estimateLatest: EstimateLatest) {
  try {
    const entity = await reader.getEntity(entityKey);
    const head = await reader.getBlockNumber({ cacheTime: 0 });
    if (entity.$expiresAt <= head || maxLifetime <= HOUR + 30n) throw safeError('Invalid live renewal window');
    if (entity.$expiresAt >= head + HOUR) return await { status: 'already_sufficient' as const, expiresAt: entity.$expiresAt };
    const operation = { entityKey, expiration: ExpirationTime.atBlock(head + HOUR, { atLeast: ExpirationTime.fromHours(1) }) };
    const estimate = await estimateLatest(unsigned => unsigned.extendEntity(operation));
    const result = await confirmed(reader, await wallet.extendEntity(operation, await params(reader, wallet, estimate)));
    return await { status: 'extended' as const, ...result };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

The first helper adds to the observed deadline; a concurrent extension can race it. The second ensures a floor from inclusion and skips already sufficient life. It does not automatically add an hour after an uncertain send. Use low-water/refill thresholds for heartbeats rather than paying to renew every block. Re-read actual receipt-derived deadlines and verify fresh entity state.

Before these helpers, apply first-write's exact unsigned estimate, balance/spend approval and exclusive signer custody. Explicit nonce/gas/gasPrice is the Rabdi default; these single-operation examples use the measured 1,000,000 gas starting cap. They do not retry. Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy.

An extension sets a target, not a delta. A shorter effective target is rejected; an equal target need not add lifetime. Do not infer receipt status from equality alone. Owner or immutable permissionless-extension policy determines who can renew. Expired entities cannot be revived; create a new identity only under the authorized recovery policy.

## Monitoring and absence

Use an indexed system predicate such as `lte('$expiresAt', u64(cutoff))` with explicit schema/creator scope, bounded pages and current-state pagination from query guidance. Natural expiration emits no event; sweep prior known deadlines against a fresh head and refetch extensions before acting on cached liveness.

`NoEntityFoundError` alone cannot distinguish never-created, deleted, expired, wrong chain or reset. Check known creation/extension receipts, correct key and network/reset identity. SDK 1.0.x cannot query old state or recover complete missed history; preserve gaps explicitly rather than substituting head as a historical answer.

A lifetime is neither a mutex nor an app authorization lease. A coordination protocol needs a writer/fencing policy and must reject expired state before its protected action. Permissionless extension can prolong data availability. Deletion or expiration cannot retract already read copies.

Read write-safety for `EntityMutationError`, nonce uncertainty or readback failure after confirmation. No absent hash or unchanged nonce proves a send never occurred.

Sources: [SDK 1.0.1 expiry validation](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/entity/expiry.ts), [expiration helpers](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/utils/expirationTime.ts), [SDK diff](https://github.com/Arkiv-Network/arkiv-sdk-js/compare/v1.0.0...v1.0.1). Inspect the installed declarations before adapting executable examples.

The required `estimateLatest` callback is bound to the guarded unsigned estimator in `arkiv-first-write/references/estimate.md`: `prepare => estimateWrite(account, accessKey, prepare)`. It must estimate the supplied exact operation at latest, return its positive gas estimate, and propagate only sanitized diagnostics with no raw or nested causes without signing/sending. If preflight errors, stop. Funded writes always pass explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, current gasPrice and latest nonce; approve the resulting cost before admission.
