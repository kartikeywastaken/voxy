# SDK 1.0.x limits and units

These are source-checked SDK budgets, not a universal promise about every RPC ingress.

| Surface | Limit or rule | Source |
| --- | --- | --- |
| Schema attributes | 32 including a named schema's `arkiv.schema` tag; thus 31 named columns | `src/schema/schema.ts` |
| Names | ASCII letter first; letters/digits/`.`/`-`/`_` afterward; case-sensitive; 32 bytes; no `$`, reserved keywords or `--` | `src/schema/names.ts` |
| Strings | 128 UTF-8 bytes, validated by `str` | `src/schema/values.ts` |
| Binary values | 128 KiB per bytes value and aggregate bytes budget per create/patch | `src/schema/values.ts`, `attributes.ts` |
| Filters | Indexed columns only; no bytes; fixed system fields `$key/$owner/$creator/$expiresAt` | `src/query/expression.ts` |
| Ordering | One non-bytes key; schema columns need not be indexed to sort | `src/query/order.ts` |
| Query pages | 1–100, offset is a nonnegative safe integer; current state only | `src/query/engine.ts` |
| Numeric types | i32 signed; u64/u256 unsigned; dec fixed-point with 18 decimal places | `src/schema/values.ts` |
| Lifetimes | Absolute blocks or relative block floors; nominal conversion is 2 seconds/block | `src/utils/expirationTime.ts`, `src/entity/expiry.ts` |
| Rabdi maximum lifetime | SDK 1.0.1: MAX_LIFETIME = 7,884,000 blocks from create/extension inclusion; ExpirationTime.max() needs no manual margin | `src/consts.ts`, `src/entity/expiry.ts`; verified Rabdi create and extension |
| Access quota | 100,000,000 per key; each arkiv_query costs 10; other calls zero under current provider policy | [Access keys](https://hub.arkiv.network/access-keys) |

Byte encoding adds ABI and JSON-RPC overhead. Estimate the exact proposed operation; a value fitting the SDK limit need not fit a provider request/response cap. Bound scans, request size, gas and total spend. No universal operation-per-batch or ingress-size maximum is certified here.

SDK 1.0.1 adds `ExpirationTime.max()` at the package root. Its `MAX_LIFETIME = 7_884_000n` constant is exported from both `@arkiv-network/sdk/entity` and the package root. The maximum is counted from the block the create or extension lands in, not from the observed head or the existing deadline. `max()` needs no manually subtracted inclusion margin: a successful create expires at `landingBlock + MAX_LIFETIME`, and a successful extension with `max()` sets expiry to its new inclusion block plus `MAX_LIFETIME`. Revalidate network compatibility after a reset or upgrade; this exported SDK constant is not a live node-parameter getter.

In SDK 1.0.1, a duration above `MAX_LIFETIME` (for example `ExpirationTime.fromYears(1)`) or an absolute deadline beyond the SDK's allowed maximum throws `InvalidExpiryError` before sending. Constructing `fromYears(1)` alone does not send or validate a transaction; the write path resolves and rejects it. Rabdi still rejects excessive lifetime from older SDK/raw callers with `ExpiryBeyondMaxLifetime`.

For SDK 1.0.0 compatibility, `max()` and `MAX_LIFETIME` are unavailable; retain the dated measured bound and a conservative below-maximum choice such as `fromBlocks(7_883_970)`. Do not carry that manual margin advice over to `max()` on SDK 1.0.1. Longer-lived data requires successful Lifetime Extension before expiry, recurring monitoring and an available authorized payer. There is no unlimited lifetime or `permanent()` helper. A deadline is not a wall-clock guarantee or secure-erasure mechanism; resets can invalidate existing entity keys.

Sources: [versioned schema](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/schema/), [query engine](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/query/engine.ts).
