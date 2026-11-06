# Bounded current graph inputs

Use a server-side Rabdi client configured with the operator's access key and return narrow DTOs through the app's read endpoint. Check a graph package's actual SDK 1.0 row adapter before handing it SDK flat rows. This sample supplies native typed edge inputs and makes no claim about uninspected package exports.

```typescript
import { createPublicClient } from '@arkiv-network/sdk';
import { defineSchema, key, str } from '@arkiv-network/sdk/schema';
import { asc, eq, gt } from '@arkiv-network/sdk/query';
import type { Address, Hex } from 'viem';

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


export const Follows = defineSchema('example_follows', {
  project: str().indexed(), source_key: key().indexed(), target_key: key().indexed(),
});
export async function readFollowPage(reader: ReturnType<typeof createPublicClient>,
  creator: Address, project: string, after?: Hex) {
  try {
    const query = reader.select({ $key: true, $expiresAt: true, source_key: true, target_key: true })
      .from(Follows, { onMismatch: 'throw' }).createdBy(creator).where(eq('project', project))
      .orderBy(asc('$key')).limit(100);
    if (after) query.where(gt('$key', key(after)));
    const page = await query.fetch();
    return await { observedBlock: page.blockNumber.toString(), edges: page.entities.map(row => ({
      id: row.$key, source: row.source_key.value, target: row.target_key.value,
      expiresAtBlock: row.$expiresAt.toString(),
    })), lastKey: page.entities.at(-1)?.$key };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

One page is partial when it fills the limit; a complete walk needs bounded keyset continuation and explicit completion. Each page is a current observation, not one snapshot. Define separate policies for duplicate source/target pairs and edge identities, self-joins, missing/truncated endpoints and business-ID collisions. Resolve additional endpoint scopes deliberately; placeholders prove no endpoint history.

Refetch on create/patch/transfer/delete/extension and periodically reconcile/sweep expiry. Events lack full values and have startup/disconnect gaps. Guard late results when chain/account/scope changes. An owner-filtered feed needs prior-membership invalidation and unknown incoming-transfer reads; creator alone does not authenticate mutable content.

Use indexing guidance for persistent generations. A one-shot graph helper installs no checkpoint, timer or authorization layer. Verify actual React rendering and browser behavior separately from core graph construction.
