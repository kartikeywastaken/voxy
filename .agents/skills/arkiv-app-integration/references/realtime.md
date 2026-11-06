# Events and current cache reconciliation

`watchEntityEvents` in SDK 1.0.x exposes EntityCreated, EntityPatched, ExpiryExtended, OwnershipTransferred and EntityDeleted, plus onEvent/onError. Context contains blockNumber, transactionHash and logIndex; it is not a historical state snapshot or checkpoint hash. Extension owner is not necessarily the extender.

This bounded queue is for UI invalidation. It does not establish durable replay or guarantee delivery during startup/disconnection.

```typescript
import type { PublicArkivClient } from '@arkiv-network/sdk';
import type { EntityEvent } from '@arkiv-network/sdk/types';

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


export function watchSerially(client: Pick<PublicArkivClient, 'watchEntityEvents'>,
  handle: (event: EntityEvent) => Promise<void>, report: (error: unknown) => void,
  options: { maxQueued?: number; pollingInterval?: number } = {}) {
  try {
    const { maxQueued = 256, pollingInterval = 1000 } = options;
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || !Number.isSafeInteger(pollingInterval) || pollingInterval < 1) throw safeError('Invalid watcher bounds');
    let stopped = false, queued = 0;
    let unwatch = () => {};
    let tail = Promise.resolve();
    const fail = (error: unknown) => { stopped = true; try { unwatch(); } catch {} try { report(sanitizedFailure(error)); } catch {} };
    unwatch = client.watchEntityEvents({ pollingInterval, onEvent: event => {
      if (stopped) return;
      if (++queued > maxQueued) { fail(safeError('Queue overflow; reconcile cache')); return; }
      tail = tail.then(async () => { try { if (!stopped) await handle(event); } finally { queued--; } }).catch(fail);
    }, onError: fail });
    if (stopped) unwatch();
    return () => { stopped = true; try { unwatch(); } catch (error) { throw sanitizedFailure(error); } };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

Start the listener before the initial current query and tolerate overlap. A live tail at head works, but the listener becomes active only on its first poll, so starting it is not an acknowledgment of complete coverage. On Rabdi, a watcher more than about 1,000 blocks (~30 min) behind fails on every poll when its range contains an older block with logs; it cannot backfill or catch up across that gap. After any watcher error, stop it, recreate the watcher at head and reconcile current state with a query. Do not split or retry the range. Periodically reconcile scope and mark freshness unavailable after errors/gaps. No historical replay parameter exists on this watcher. See [arkiv#283](https://github.com/Arkiv-Network/arkiv/issues/283).

For EntityCreated a creator allowlist may prefilter the event's creation owner before a read. For EntityPatched fetch unknown keys as well; the new values can move them into scope. For OwnershipTransferred fetch unknown keys only when the new owner matches the selected owner, but always invalidate known keys' prior scope. Verify actual schema/publication/liveness filters before caching. Deletion needs prior membership because current lookup no longer returns the entity.

Invalidate detail plus affected collection caches. Keep cache keys scoped by chain/reset identity, account/trusted publisher, schema, filters and pagination. Guard late requests with a generation token; unwatch cannot cancel an already active handler. A quiet stream does not prove continuity.

Natural Entity Expiration emits no event. Sweep exact block deadlines against a fresh head and refetch extensions. A current query can repair current membership but cannot recover deleted/expired intermediate versions. A persistent mirror must expose gaps and follow [projection generation guidance](../../arkiv-indexing/references/checkpoint-mirror.md).

Source: [SDK watcher implementation](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/actions/public/watchEntityEvents.ts).
