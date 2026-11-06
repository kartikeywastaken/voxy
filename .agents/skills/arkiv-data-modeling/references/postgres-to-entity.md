# Map PostgreSQL to Arkiv schemas

Use schema-only DDL and actual query requirements. Do not request database credentials for a model. The mapping does not import entities, enforce SQL constraints or authorize writes.

| PostgreSQL concept | SDK 1.0.x mapping | Required decision |
| --- | --- | --- |
| Table | Named `defineSchema` | Creator scope, public fields, lifetime |
| Primary/foreign key | Indexed str source ID or resolved key column | Uniqueness, missing targets and remapping |
| Boolean | bool column | Preserve false versus absent |
| Integer | i32 if fitting; unsigned u64/u256 for declared nonnegative ranges | Reject overflow; never parse unsafe JS numbers |
| Signed BIGINT | Exact string in bytes, or dec(sourceIntegerString) for numeric filters | Signed range and precision |
| Numeric/money | dec string up to 18 decimal places, or exact minor units | Currency, scale and rounding |
| Timestamp | u64 epoch milliseconds when nonnegative, original meaning in bytes | Timezone and pre-epoch encoding |
| Bounded text | str, at most 128 UTF-8 bytes | Index only if filtering; no silent truncation |
| Long text/JSON/arrays | Named bytes columns with declared encoding | Schema validation, nulls/order/duplicates |
| NULL | Optional column omitted; unset on a later transition to absence | Undefined patch values leave prior values alone |
| UNIQUE/CHECK/FK | App validation and coordinated writer | No native SQL constraint guarantee |
| JOIN/aggregate | Explicit relationship model or external projection | Bounded traversal, freshness and cardinality |
| ORDER BY/count | SDK one-key ordering / filtered count | Types, mismatch and pagination policy |

Index scalar columns used in predicates. Bytes cannot be filtered or sorted. A named schema adds an indexed public `arkiv.schema` tag and has at most 31 declared columns under the SDK's 32-attribute budget. All bytes in one create/patch share the 128 KiB SDK budget; encoded transactions have additional overhead.

Preserve source-to-destination mapping and explicit Entity Expiration for every type. Nullable optional values retain `0`, `false` and empty strings. Arrays needing membership queries require separate indexed relationships, with an ordinal when order or duplicates matter.

Use `postgres-to-entity` 1.0.2; its SDK peer is `^1.0.0`, verified by the package with 1.0.1. Inspect the installed README, public declarations and generated schema before integrating. Its model-only converter is distinct from importing SQL data. Preserve `needs-input` and `blocked` outcomes. A schema model cannot certify SQL constraints, data privacy or a live migration.

postgres-to-entity keeps format `arkiv-entity-model/3` with `sdkVersion: "1.0.0"` as the format's minimum compatible SDK baseline (not the installed or latest SDK). Format /3's 7,883,970-block cap is its own lifetime policy, distinct from the SDK/chain maximum of 7,884,000 blocks.

Sources: [SDK 1.0.1 schemas](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/schema/), [postgres-to-entity 1.0.2 release guide](https://unpkg.com/postgres-to-entity@1.0.2/README.md), [converter declarations](https://unpkg.com/postgres-to-entity@1.0.2/dist/postgres.d.ts).
