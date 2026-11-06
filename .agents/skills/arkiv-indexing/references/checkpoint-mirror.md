# Projection generations and progress

SDK 1.0.x provides current queries and head-following event invalidation. This is a design contract for an application-owned adapter, not a historical-replay implementation.

Persist a generation with chain ID, genesis/reset identity, schema/indexing version, trusted publisher scope, observed blocks, last successful full reconciliation, row deadlines and gaps. Store exact bigints as decimal strings. A number-only checkpoint cannot authenticate old state or distinguish a reset.

Use the [consistent capture helper](../../arkiv-entity-lifecycle/references/backup-restore.md) under coordinated writers when a single-head baseline is required. If a page/head/hash check fails, preserve the old generation and the failed evidence; do not advance progress or silently substitute partial data. If continuous writes prevent a single-head baseline, choose an explicitly eventual current projection or an independently verified snapshot service. That is a product decision, not permission to weaken a required snapshot gate.

For updates, use a bounded serial queue and current reads. Treat native events as invalidations:

- EntityCreated: the creation owner equals creator; a configured creator allowlist can prefilter before fetching.
- EntityPatched: fetch unknown keys too; a patch can move a matching creator's entity into scope.
- OwnershipTransferred: fetch unknown keys when newOwner matches an owner filter; for known keys invalidate previous scope regardless of destination.
- ExpiryExtended: refresh known deadlines; the event owner is not necessarily the extender.
- EntityDeleted: use prior membership to remove the owned projection row; the entity is no longer readable.

Verify each fetched row against schema/publication policy and observed liveness before caching. Catch async failures, bound queued work, mark gaps and stop claiming freshness on overflow/disconnect. Periodic full reconciliation repairs missed live changes; it cannot recover intermediate or expired values. Natural expiration requires periodic deadline checks and refetches, not event-only cleanup.

Atomically commit rows, identities, health state and progress in the application's real transactional store. On reset or unverified lineage freeze the prior generation, build a separate verified current generation, then explicitly switch readers. Do not drop old tables or rewrite prior provenance as a shortcut. Never replay unresolved funded writes to repair a read projection.

Source: [SDK watcher](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/actions/public/watchEntityEvents.ts), [query result semantics](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/query/queryResult.ts).
