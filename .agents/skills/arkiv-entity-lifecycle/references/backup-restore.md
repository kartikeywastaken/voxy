# Authenticated backup and restore

SDK 1.0.x queries current entity state only. A multi-page export is normally a series of observations. The helper below fails unless every page is observed at the same unchanged head; use an exclusive writer/maintenance window and bound retries outside this helper. It does not request historical state or recover expired entities.

```typescript
import { createPublicClient } from '@arkiv-network/sdk';
import { key, str } from '@arkiv-network/sdk/schema';
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



export async function captureSnapshot(reader: ReturnType<typeof createPublicClient>,
  schemaName: string, trustedCreator: Address, maxPages = 20) {
  try {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw safeError('Invalid page budget');
    const head = await reader.getBlockNumber({ cacheTime: 0 });
    const header = await reader.getBlock({ blockNumber: head });
    const genesis = await reader.getBlock({ blockNumber: 0n });
    if (!header.hash || !genesis.hash) throw safeError('Missing source identity');
    const entities = [];
    let last: Hex | undefined;
    let complete = false;
    for (let n = 0; n < maxPages; n++) {
      const query = reader.select({ $key: true, $owner: true, $creator: true,
        $createdAt: true, $updatedAt: true, $expiresAt: true, $creationFlags: true,
        $attributes: true, $attributeSchema: true }).where(eq('arkiv.schema', str(schemaName)))
        .createdBy(trustedCreator).orderBy(asc('$key')).limit(100);
      if (last) query.where(gt('$key', key(last)));
      const page = await query.fetch();
      if (page.blockNumber !== head) throw safeError('Source changed during export; keep incomplete export unpublished');
      entities.push(...page.entities);
      if (page.entities.length < 100) { complete = true; break; }
      const next = page.entities.at(-1)?.$key;
      if (!next || (last && next.toLowerCase() <= last.toLowerCase())) throw safeError('Keyset did not advance');
      last = next;
    }
    if (!complete) throw safeError('Export page budget exhausted');
    const finalHead = await reader.getBlockNumber({ cacheTime: 0 });
    const finalHeader = await reader.getBlock({ blockNumber: head });
    if (finalHead !== head || finalHeader.hash !== header.hash) throw safeError('Source changed during export');
    return await JSON.parse(JSON.stringify({ format: 1, chainId: reader.chain?.id,
      genesisHash: genesis.hash, observedBlock: head, observedHash: header.hash,
      schemaName, trustedCreator, entities }, (_, v) => typeof v === 'bigint' ? v.toString() : v)) as unknown;
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

Persist only a successful complete export. Keep an independently authenticated manifest binding source chain/genesis/head/hash, scope, each original key, typed values, indexing, creation flags, creator/owner and content checksums. A file's own checksum does not authenticate its claims. Before a trusted signer restores, authenticate each source publication: readonly by an independently trusted creator, an exact version signed by an authorized publisher, or complete authenticated mutation provenance. Creator plus current owner is insufficient for mutable content.

At capture, verify the chain data and publication policy; sign/store the manifest through the application's existing trusted channel. A later restore cannot re-read that old state with SDK 1.0.x. If no independently authenticated capture or authorized signed version exists, exclude/quarantine the entry. Never silently substitute head data for the original source version. Version signatures must bind chain, key, typed values and schema/indexing context; freshness needs an independently trusted monotonic version policy.

## Restore new identities

1. Validate the entire manifest, typed fields, indexing flags, app JSON schemas and publication policy before choosing the restoring signer. Excluded/quarantined targets still need an explicit relationship policy.
2. Choose authorized signer, public destination values, immutable flags, retention and optional post-create transfers. System creator/creation block cannot be rewritten; restoration signs under the new creator.
3. Build SDK schemas preserving column types/indexing and the chosen schema-name policy. Respect the 32-attribute budget including a named tag; do not silently drop fields, change types or flatten bytes into strings. Defaults/optional choices are SDK policy that the exporter may need to retain separately from wire state.
4. Persist progress and `oldKey → newKey` from every authenticated result. Multiple batches can leave partial progress; reconcile unknown outcomes before continuing.
5. Remap typed key relationships and documented references inside decoded bytes/application indexes. Do not rewrite every hex-looking value. Handle external/excluded targets through explicit preserve/replace/quarantine choices.
6. DAGs can use confirmed parent keys; cycles and readonly same-batch references require exclusive creator coordination, predictions and exact salts. Validate every returned key in order.
7. Verify destination keys, exact typed values, indexing flags, owners/creator, readonly flags, observed deadlines, relationships and consuming application reads before changing readers.

A reset or expired original needs new keys. A missing entity is not proof of why it disappeared. Preserve original provenance in the manifest and old resources unless removal is separately authorized. Deletion/expiration cannot retract copies already read.
