---
name: arkiv-social-graph
description: Model directed follows, likes and entity references with explicit creator scope, duplicate policy and missing-endpoint handling. Check the installed arkiv-graph release for SDK 1.0 compatibility.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Social relationships and graph projections

Choose endpoint identity, direction, trusted creator scope, public attributes, duplicate policy and Entity Expiration before rendering a graph. Follow/like entities are explicit relationships; the SDK does not enforce foreign keys, uniqueness or cascading deletion.

Use named schemas and indexed key columns, for example source_key/target_key and indexed relationship kind. Only indexed scalar columns can be queried. Store unqueried labels/structured data in bytes as needed. Distinguish unique semantic pairs from backing edge-entity counts and from node degree. A directed follow is source → target; symmetric relations require an explicit product choice.

## Package gate

Before adopting `arkiv-graph`, inspect the installed version's public declarations, SDK peer range, consumer guide, Rabdi chain support and flat-row adapter. Use only a source-verified SDK 1.0-compatible release. A package's presence or wider peer text alone does not establish compatibility. Do not bypass peers or invent changed API names. The React entrypoint and dependency tree require separate integration checks; core Node verification does not certify a browser view.

Use `arkiv-graph` 1.1.1; its SDK peer is `^1.0.0`, verified by the package with 1.0.1. The published package provides separate root and `arkiv-graph/react` entrypoints; inspect their declarations before choosing core processing or browser rendering.

Read [fetch-and-refresh](references/fetch-and-refresh.md) for scoped current queries and invalidation. Use explicit field names matching your model rather than relying on a package's type-attribute defaults. Use `https://rabdi.explorer.arkiv.network` for entity links and verify the library's actual URL option before code generation.

## Missing and changing endpoints

Prefer entity keys for endpoints. Business IDs need type-specific matching, uniqueness and collision rules. Key references may be dangling because an endpoint is absent from scope, expired, deleted or reset; a placeholder does not prove which. Creator-filtered edge fetches may omit profiles by other creators. Fetch approved endpoint scopes separately and merge by actual entity key rather than broadening into an unbounded network scan.

Keep exact bigint metadata for liveness/transactions; display-number conversions and approximate dates are not authoritative deadlines. Do not report whole-network or unique follower counts from a truncated graph. Namespace/schema tags locate public data but do not authenticate publishers. Apply security/trust policy before privileged use and render labels as escaped text.

Events invalidate projections, and natural expiration requires periodic sweeps. Fetch unknown patched keys and owner-filtered incoming transfers; invalidate old scopes for known keys. SDK 1.0.x has no historical entity queries, so missed transient edges cannot be reconstructed from head. Persistent projections must expose gaps/reset generations under indexing guidance.

Verify direction, duplicates, self-links, missing endpoints, stable-ID collisions, truncation, empty/error states, transfer, reset and expiration. Browser rendering needs its own loading/error/partial/ghost and wallet-rejection checks. Optional delete/extension callbacks require exact entity and spending authorization; graph display grants no mutation permission.

Sources: [arkiv-graph 1.1.1 release guide](https://unpkg.com/arkiv-graph@1.1.1/README.md), [graph declarations](https://unpkg.com/arkiv-graph@1.1.1/dist/index.d.ts), [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
