---
name: arkiv-first-write
description: Set up SDK 1.0.x on Rabdi with an access key, typed schema, authorized signer and verified first entity. Use for quickstarts and idempotent seeds; use arkiv-app-integration for application endpoints.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# First Arkiv write

Target **SDK `^1.0.0`, checked with 1.0.1, Rabdi, chain 7794095 (`0x76edaf`)**. Inspect the application's manifest, lockfile and installed declarations before giving executable SDK code. If evidence is unavailable, obtain it first. Read write-safety before bulk work or an uncertain submission. SDK 1.0.1 adds 25% headroom when `gas` is omitted (padding capped at `2^24`; an already oversized estimate is unchanged), while caller gas is used as is. These recipes deliberately retain the stronger explicit gas floor/headroom and half-block checks; see [write-safety](../arkiv-write-safety/SKILL.md#sdk-101-gas-behavior).

## Prepare inputs and authorization

Use the app's package manager and explain an SDK upgrade before doing it. The SDK requires viem as a peer; do not force peer requirements. Get a free RPC key at [Hub access keys](https://hub.arkiv.network/access-keys) and fund a dedicated development EOA through the [Hub faucet](https://hub.arkiv.network/faucet). Never request a private key in chat. Keep locally held signing keys in the server's secret store.

Configure `rabdi({ accessKey })` and `http()` from viem. The SDK places the encoded access key in the URL path. Missing or non-string keys raise `MissingAccessKeyError`; an explicitly empty key opts into a heavily limited endpoint that can return HTTP 429. Keep operator keys server-side, sanitize transport errors and never expose keyed URLs in logs. Browser wallets use the RPC configured by their user.

Announce network, signer, entity and spend scope before broadcasting. Verify RPC chain ID and signer balance; compare an unsigned exact gas estimate plus current fee cap and margin with both available funds and the approved budget. An access key does not pay gas or authenticate app users. SDK 1.0.x has no public create-estimator method: use [the guarded estimator](references/estimate.md), which blocks signing and broadcast.

## Define and create a note

This module exports helpers and performs no write on import. The caller supplies an authorized wallet, matching reader and explicit retention choice. A `recordIntent` callback must durably register this operation before entry; for process-crash recovery use [the importer](../arkiv-write-safety/references/resumable-import.md), which also captures signed bytes before forwarding.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime, type Expiry, type TxParams } from '@arkiv-network/sdk';
import { defineSchema, str, bytes, u64 } from '@arkiv-network/sdk/schema';
import { eq } from '@arkiv-network/sdk/query';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http, type LocalAccount } from 'viem';
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



export const Notes = defineSchema('example_first_note', {
  seed_id: str().indexed(), created_at: u64(), body: bytes(),
  media_type: str().default('application/json'),
});
export function clients(account: LocalAccount, accessKey: string) {
  try {
    const chain = rabdi({ accessKey });
    const transport = http(undefined, { retryCount: 0, timeout: 10000,
      fetchOptions: { cache: 'no-store', redirect: 'error' } });
    return { reader: createPublicClient({ chain, transport, cacheTime: 0 }),
      wallet: createWalletClient({ account, chain, transport, cacheTime: 0 }) };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export function firstNoteParameters(expiration: Expiry = ExpirationTime.fromDays(1)) {
  return { schema: Notes, values: { seed_id: 'welcome_v1', created_at: u64(Date.now()),
    body: new TextEncoder().encode(JSON.stringify({ text: 'Hello, Arkiv' })) },
    expiration, flags: { readonly: true, permissionlessExtension: false } };
}
type Clients = ReturnType<typeof clients>;
type Wallet = ReturnType<typeof createWalletClient>;
type EstimateLatest = (prepare: (unsigned: Wallet) => Promise<unknown>) => Promise<bigint>;
export async function rabdiTxParams(reader: Clients['reader'], address: LocalAccount['address'],
  approvedMaximumCost: bigint, estimate: bigint, operations = 1): Promise<TxParams> {
  try {
    if (estimate <= 0n || !Number.isSafeInteger(operations) || operations < 1) throw safeError('Valid unsigned estimate and operation count required');
    const floor = 1000000n + 400000n * BigInt(operations - 1);
    const gas = floor > 2n * estimate ? floor : 2n * estimate;
    const block = await reader.getBlock({ blockTag: 'latest' });
    if (typeof block.gasLimit !== 'bigint' || block.gasLimit <= 0n) throw safeError('Latest block gas limit required');
    if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');
    const latest = await reader.getTransactionCount({ address, blockTag: 'latest' });
    if (await reader.getTransactionCount({ address, blockTag: 'pending' }) !== latest) throw safeError('Reconcile pending nonce first');
    const gasPrice = await getGasPrice(reader);
    if (gas * gasPrice > approvedMaximumCost || gas * gasPrice > await reader.getBalance({ address })) throw safeError('Gas cap exceeds budget/balance');
    return await { nonce: latest, gas, gasPrice };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
export async function ensureFirstNote({ reader, wallet }: Clients,
  recordIntent: (txParams: TxParams) => Promise<void>, expiration: Expiry, approvedMaximumCost: bigint,
  estimateLatest: EstimateLatest) {
  try {
    if (await reader.getChainId() !== 7794095 || wallet.chain?.id !== 7794095) throw safeError('Wrong chain');
    const prior = await reader.select({ $key: true, $creator: true, $creationFlags: true, body: true, media_type: true })
      .from(Notes, { onMismatch: 'throw' }).createdBy(wallet.account.address)
      .where(eq('seed_id', 'welcome_v1')).limit(2).fetch();
    if (prior.entities.length > 1) throw safeError('Duplicate seed; reconcile');
    const expected = new TextEncoder().encode(JSON.stringify({ text: 'Hello, Arkiv' }));
    const existing = prior.entities[0];
    if (existing) {
      const expectedHex = '0x' + Array.from(expected, b => b.toString(16).padStart(2, '0')).join('');
      if (!existing.$creationFlags.readonly || existing.$creationFlags.permissionlessExtension ||
        existing.media_type.value !== 'application/json' || existing.body.value !== expectedHex) throw safeError('Seed differs; reconcile');
      return await { entityKey: existing.$key, reused: true as const };
    }
    // Precondition: exclusive writer, sufficient funding, successful unsigned estimate,
    // and no unresolved earlier seed attempt in the durable operation registry.
    const input = { ...firstNoteParameters(expiration), salt: 1n };
    const options = { expiration: input.expiration, flags: input.flags, salt: input.salt };
    const estimate = await estimateLatest(unsigned => unsigned.createEntity(input.schema, input.values, options));
    const txParams = await rabdiTxParams(reader, wallet.account.address, approvedMaximumCost, estimate);
    await recordIntent(txParams);
    const result = await wallet.createEntity(input.schema, input.values,
      options, txParams);
    // Persist returned hash/key immediately in the caller's durable writer.
    try {
      const receipt = await reader.getTransactionReceipt({ hash: result.txHash });
      const entity = await reader.getEntity(result.entityKey, Notes);
      if (receipt.status !== 'success' || !entity.$creationFlags.readonly ||
        entity.$creator.toLowerCase() !== wallet.account.address.toLowerCase() ||
        entity.$expiresAt !== result.expiresAt || entity.created_at.value !== input.values.created_at.value ||
        entity.body.value !== '0x' + Array.from(expected, b => b.toString(16).padStart(2, '0')).join('')) {
        throw safeError('Readback mismatch');
      }
      return await { ...result, reused: false as const };
    } catch (cause) {
      throw safeError('Confirmed write needs reconciliation; do not resend', { txHash: result.txHash, entityKey: result.entityKey, expiresAt: result.expiresAt });
    }
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

Explicit `txParams` are the recommended Rabdi default: latest transaction nonce, `gas` and current network `gasPrice`, under exclusive signer custody. For one operation use at least 1,000,000 gas; for a batch of N operations use at least `1,000,000 + 400,000 × (N − 1)`. Also honor the exact unsigned estimate and approved fee/balance limits. Large bytes/chunk/image writes need measurements and at least twice the measured maximum gas, never below that floor. These are measured Rabdi starting caps, not universal limits; raise the approved cap when the exact operation needs more.

Lane W's 2026-10-30 controls found default estimation gas-exhaustion reverts; explicit nonce/gas/fees passed its tested wallet/account cases. Check `receipt.status === 'success'` before readback. This helper makes no automatic retry. Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy.

Query-before-create prevents routine repeats under an exclusive writer; it is not atomic uniqueness. A missing result after an uncertain send does not authorize recreating. A reset or expired seed creates a new identity; update dependent references. Readonly still allows owner transfer, deletion and Lifetime Extension.

Create uses `(schema, values, options, txParams?)`, patch uses `(schema, entityKey, changes, txParams?)`. Options use `expiration`, while returned flat entity metadata uses `$expiresAt`. `createEntity` returns `entityKey`, `txHash`, receipt-derived `expiresAt`. Keep keys and transaction hashes separate and inspect them in the [Rabdi explorer](https://rabdi.explorer.arkiv.network).

## Project rules and verification

Offer this block for the consumer's AGENTS.md with consent, preserving its existing instructions:

```markdown
## Arkiv rules for this project
- Use SDK 1.0.x on Rabdi (7794095); inspect installed version/declarations before executable SDK code.
- Declare typed schemas; index filter columns explicitly. Store binary/JSON data in named bytes columns, which cannot be filtered.
- Preserve constructor types; use u64 for app milliseconds and expiry-block predicates.
- Configure rabdi({ accessKey }); redact keyed URLs. Operator access/signing keys stay server-side and out of chat/public bundles.
- Pass explicit latest nonce, gas and gasPrice for Rabdi writes; check the receipt and use the measured gas floors from first-write.
- Reconcile uncertain writes before another submission; load the arkiv router for Arkiv tasks.
```

Read [testing](references/testing.md) for deterministic and funded checks. Test missing access keys, schema mismatch, invalid indexing, seed collision, reset identity, insufficient funding, wrong chain and confirmed-read failure. Each key has 100,000,000 quota units; each query costs 10, other calls zero under current policy. A rejected query is not an empty result.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.

The required `estimateLatest` callback is bound to the guarded unsigned estimator in `arkiv-first-write/references/estimate.md`: `prepare => estimateWrite(account, accessKey, prepare)`. It must estimate the supplied exact operation at latest, return its positive gas estimate, and propagate only sanitized diagnostics with no raw or nested causes without signing/sending. If preflight errors, stop. Funded writes always pass explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, current gasPrice and latest nonce; approve the resulting cost before admission.
