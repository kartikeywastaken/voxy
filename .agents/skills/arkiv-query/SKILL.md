---
name: arkiv-query
description: Read Arkiv entities using typed schemas, indexed predicates, narrow flat projections, ordering, keyset or offset pagination and filtered counts on Rabdi. Use arkiv-troubleshooting first for an existing error.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Query Arkiv entities on Rabdi

Inspect the installed SDK 1.0.x declarations and the write schema. Use modeling when encodings/indexes are undecided and troubleshooting for an existing error. Only indexed columns support predicates; bytes columns are selectable but cannot be filtered or sorted.

## Typed filters and flat rows

```typescript
import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { defineSchema, str, bytes, u64, u256, key } from '@arkiv-network/sdk/schema';
import { asc, gt, gte } from '@arkiv-network/sdk/query';
import { http, type Address, type Hex } from 'viem';

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



export const Listings = defineSchema('example_listings', {
  listing_id: str().indexed(), price_minor: u256().indexed(),
  created_at: u64().indexed(), title: str(), details: bytes(),
});
export function queryClient(accessKey: string) {
  try {
    return createPublicClient({ chain: rabdi({ accessKey }), cacheTime: 0,
      transport: http(undefined, { timeout: 8000, retryCount: 0,
        fetchOptions: { cache: 'no-store', redirect: 'error' } }) });
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
type Reader = ReturnType<typeof queryClient>;

export async function cheapestPage(client: Reader, creator: Address) {
  try {
    const page = await client.select({ $key: true, title: true, price_minor: true })
      .from(Listings).createdBy(creator).where(gte('price_minor', u256(0n)))
      .orderBy(asc('price_minor')).withCount().limit(20).offset(0).fetch();
    return await { entities: page.entities, block: page.blockNumber, count: page.count, skipped: page.skipped };
  } catch (error) {
    throw sanitizedFailure(error);
  }
}

// Bounded traversal of current observations, not an atomic snapshot.
export async function fetchAllListings(client: Reader, creator: Address, maxPages = 50) {
  try {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw safeError('Invalid page budget');
    const entities = [];
    const blocks: bigint[] = [];
    let last: Hex | undefined;
    for (let index = 0; index < maxPages; index++) {
      const builder = client.select({ $key: true, title: true, price_minor: true })
        .from(Listings, { onMismatch: 'throw' }).createdBy(creator)
        .orderBy(asc('$key')).limit(100);
      if (last) builder.where(gt('$key', key(last)));
      const page = await builder.fetch();
      blocks.push(page.blockNumber);
      entities.push(...page.entities);
      if (page.entities.length < 100) return await { entities, observedBlocks: blocks };
      const next = page.entities.at(-1)?.$key;
      if (!next || (last && next.toLowerCase() <= last.toLowerCase())) throw safeError('Keyset did not advance');
      last = next;
    }
    throw safeError('Page budget exhausted; discard incomplete traversal');
  } catch (error) {
    throw sanitizedFailure(error);
  }
}
```

Write selection objects inline or `as const`; widened boolean fields make result fields optional. Rows are flat: `$key` and the selected typed column values, such as `row.price_minor.value`. Select `$attributes` for the typed map of all attributes, or `$attributeSchema` for name/type/indexing without large values. The latter is never included automatically by `select('*')`.

`from(schema)` verifies only selected columns. The default mismatch mode skips nonmatching entities and reports `page.skipped`. A page can be empty even when later matches exist. For offset traversal advance by `entities.length + skipped`, not only returned rows; a page covering fewer than the explicit limit is the end. Keyset traversal needs `{ onMismatch: 'throw' }` so a skipped page cannot hide its continuation key.

## Ordering, pages and counts

- `orderBy(asc(...))` or `desc(...)` accepts one key; another call replaces it. Any non-bytes schema column can be sorted, even when unindexed. Queryable system sort keys are `$key`, `$owner`, `$creator`, `$expiresAt`; not creation/update blocks or flags. Without a schema supply the attribute type to the order helper.
- `limit` is 1–100; `offset` is a nonnegative safe integer. Sorting is across the matched set. Ties have node-defined order; use `$key` when stable identity order matters.
- Every request reads latest state; there is no SDK snapshot/block argument, opaque cursor, `next()` or historical query. Inserts/deletes shift offsets. Keyset traversal avoids repeating prior keys but can miss new keys below its boundary, and values/deletions can change between pages. For a certified backup, pause/co-ordinate writers and verify an unchanged source head or use an independently authenticated snapshot service.
- `client.count().from(schema).where(...).fetch()` returns a filtered bigint. `withCount()` returns that total in the same page request. Counts include matching entities skipped for schema mismatch; they are observations at that request's block, not a retained snapshot or count of validated rows.

## Predicate behavior

Use `eq`, `gt/gte/lt/lte`, `between`, `startsWith`, `exists`, `hasType`, `and` and `or` from the query subpath. SDK 1.0.x does not export `not` or `ne`. Ordered comparisons work on every indexable type; `startsWith` requires `str`. `between` requires both bounds with the same type. Match write constructors; a bare timestamp becomes an invalid i32, and a bigint predicate defaults to u256 rather than u64.

System predicates cover `$key: key`, `$owner: addr`, `$creator: addr`, `$expiresAt: u64`. Selection is broader than filtering. A named schema supplies its own tag filter; an unnamed schema still needs a deliberate `where`, `ownedBy` or `createdBy`. Repeated owner/creator scopes replace their respective scope; use an explicit `or(eq('$creator', addr(a)), ...)` for alternatives. Namespaces/schema tags are not authentication.

SDK rendering escapes apostrophes by doubling them. Build expressions through constructors rather than interpolating user strings. Raw decimal literals are unquoted `dec(3.5)`; booleans are bare `true`/`false`. See [raw RPC](references/json-rpc.md).

## Errors and budgets

`QueryError.kind` covers `parse`, `type`, `literal`, `limits` (codes -32001 through -32004). Narrow unknown diagnostic data and sanitize literal values. Invalid filters are not empty successful results. Check wrong chain, exact name/case, stored type, indexing flag, creator/current owner and expiration before broadening scope.

Every `arkiv_query`, including a count, costs 10 quota units under current provider policy; each access key has 100,000,000 units. Missing keys fail SDK construction unless explicitly empty; keyless calls can return HTTP 429. Preserve HTTP status and honor Retry-After; do not return empty results or loop through keys to bypass quota. Never log keyed URLs or raw provider errors.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
