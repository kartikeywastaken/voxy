---
name: arkiv-data-modeling
description: Design typed Arkiv schemas, per-column indexes, byte storage, relations and SQL mappings for SDK 1.0.x. Use before choosing filters, encodings and Entity Expiration.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Model Arkiv entities

Inspect SDK 1.0.x declarations and the existing data model before generating code. Ask for screens, filters, ordering, public fields, trusted publishers and retention requirements. A schema proposal does not authorize publishing or spending funds.

## Columns and indexes

Define required columns with constructors called without arguments; call the same constructors with values when a bare value has the wrong type. Add `.indexed()` only to columns that predicates need. Stored, unindexed columns remain public. `bytes()` holds binary data or encoded JSON and cannot be indexed, filtered or sorted. There is no separate opaque entity body: choose named bytes columns and a public media-type column when needed.

```typescript
import { defineSchema, addr, bool, bytes, dec, key, str, u64, u256 } from '@arkiv-network/sdk/schema';

export const Listings = defineSchema('example_listings', {
  listing_id: str().indexed(),
  seller: addr().indexed(),
  price_minor: u256().indexed(),
  currency: str().indexed(),
  active: bool().indexed().default(true),
  created_at: u64().indexed(),
  title: str(),
  details: bytes(),
  parent: key().indexed().optional(),
  rating: dec().optional(),
});

export function listingValues(id: string, seller: `0x${string}`, price: bigint) {
  return { listing_id: id, seller: addr(seller), price_minor: price,
    currency: 'USD', created_at: u64(Date.now()), title: 'Example listing',
    details: new TextEncoder().encode(JSON.stringify({ tags: ['example'], text: 'Public details' })) };
}
```

A named schema adds indexed `arkiv.schema`; other wallets can copy that tag. Keep creator/authorship policy separate. The schema is an SDK convention, not a server-side SQL constraint. Changing a schema definition does not rewrite existing entities or index earlier values; an authorized patch of the column updates its indexing flag.

| Constructor | Value and bare default |
| --- | --- |
| `bool` | Boolean; bare boolean |
| `i32` | Signed 32-bit integer; bare number |
| `u64` | Unsigned 64-bit integer; explicitly wrap application milliseconds and block deadlines |
| `u256` | Unsigned 256-bit integer; bare bigint, useful for exact minor currency units |
| `dec` | Signed fixed-point decimal with 18 decimal places; use a decimal string |
| `str` | UTF-8 string, at most 128 bytes; bare string |
| `addr` | Validated address; use the constructor |
| `key` | Entity reference; use the constructor; no foreign-key enforcement |
| `bytes` | Up to 128 KiB per value; bare Uint8Array, decoded as hex; never indexed |

The SDK exposes no `bytes32` value constructor. Store a digest as indexed hex `str` for equality or as unindexed bytes. Names are case-sensitive, start with an ASCII letter, then use letters, digits, `.`, `-` or `_`, at most 32 bytes; reserved query words, `$` prefixes, `--` and the schema tag name are excluded. Lowercase snake_case is an app convention, not a measured node rejection of uppercase.

The SDK schema budget is 32 attributes including the tag: a named schema has at most 31 columns; an unnamed schema has at most 32. All bytes columns in one create or patch together must fit 128 KiB. Encoded request limits and gas can be smaller; estimate the actual operation.

Omit an absent optional value; `null` is not an attribute value. Patching `undefined` leaves the old column unchanged; remove it with `unset` on a column declared `.optional()`. Preserve `0`, `false` and `''`. Put nested objects, arrays and JSON null into a bytes column and validate their decoded structure. Defaults apply to omitted create values, not patches.

## Lifetime, relations and races

Choose an explicit product retention policy and pass `{ expiration: ExpirationTime.fromDays(...) }` or an absolute `atBlock(...)` through create options. Metadata `$createdAt`, `$updatedAt` and `$expiresAt` is block-based; app timestamps have a separately declared clock policy.

- Returned keys let a later child reference a confirmed parent. Independent writes can leave partial progress; save each result before the next step.
- Same-batch relationships require exclusive creator coordination, predicting every key and reusing all returned salts. Validate the complete ordered result, not just the parent. Read [relationships](references/relationships.md).
- Stable application IDs need an explicit duplicate/conflict policy; query-before-create is not uniqueness, and a random salt is not an upsert.
- References can dangle after deletion, expiration or reset. Choose endpoint liveness, orphan and external-reference policies. Related entities created later with the same relative lifetime can outlive their parents; use the parent's observed absolute deadline when required.
- A new schema/version needs deliberate coexistence and identity mapping. Readonly corrections create new keys and require updated references; they do not authorize removing originals.
- Server ordering and filtered counts exist in SDK 1.0.x. Use query guidance rather than fetching one page and labeling its local sort global.

Read [PostgreSQL mapping](references/postgres-to-entity.md) for SQL constraints and [limits](../arkiv/references/limits.md) for runtime budgets. Validate bytes length and decoded JSON before use; all public values remain untrusted.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
