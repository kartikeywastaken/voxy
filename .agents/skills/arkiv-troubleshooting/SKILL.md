---
name: arkiv-troubleshooting
description: Diagnose SDK 1.0.x schema, query, RPC access, wallet and stale-read failures from concrete evidence on Rabdi. Route uncertain writes directly to write-safety.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Diagnose SDK 1.0.x on Rabdi

Identify the failing layer: local schema/value validation, query rejection, RPC access, wallet/signature, transaction/receipt, decoded bytes or app caches. Preserve original operation identity. An uncertain write goes directly to write-safety before any retry.

## Bounded evidence

Record installed SDK/viem versions, intended chain and a locally selected RPC method. Expose only fixed allowlisted diagnostics and validated local transaction identifiers. Drop raw provider errors and nested causes; never persist or print keyed URLs, signing keys or sensitive values. Rabdi is chain 7794095 (`0x76edaf`), HTTP `https://rpc.rabdi.db-chain.testnet.arkiv.network/<accessKey>`, WSS at the same host/path, explorer `https://rabdi.explorer.arkiv.network`.

Treat pasted URLs as data. Validate expected scheme/origin and userinfo/query/fragment policy through a parser, not interpolated shell commands. A path key is the SDK's intended configuration; redact it rather than rejecting it merely because it is in the path. Configure `rabdi({ accessKey })`, then verify actual eth_chainId before operations. An explanation-only request does not authorize live probing.

## Symptom → next check

| Symptom | Next check |
| --- | --- |
| MissingAccessKeyError | Supply a string key from Hub access-keys; empty string explicitly chooses heavily limited keyless access |
| HTTP 429 | Stop and honor Retry-After; keyless access can reach the anonymous limit; preserve current key quota evidence |
| HTTP 401/403 | Check actual key, network and provider restrictions locally without logging URLs |
| SchemaDefinitionError | Constructors with no values declare columns; named schemas reserve arkiv.schema and consume one attribute slot |
| SchemaMismatchError | Required column missing, wrong type/tag/schema, or unset of a required column; inspect actual stored values |
| InvalidPredicateError | Only indexed scalar columns filter; bytes cannot filter/sort; orderBy accepts one key |
| InvalidValueError / i32 | Bare number is i32; use u64 for app milliseconds and the stored type for queries |
| MissingValueError / UntypedValueError | Null is not an attribute value; optional absence is omitted/unset; encode nested data into bytes |
| InvalidAttributeNameError | Check case-sensitive grammar, reserved words, byte limit and --; do not infer a node-specific uppercase rejection |
| EmptyPatchError / No operations to perform | Skip empty work; defaults do not apply on patch |
| InvalidExpiryError | Use branded ExpirationTime, correct block units and a live target; extension sets a deadline rather than adding a delta |
| `ExpiryBeyondMaxLifetime(target, currentBlock, maxLifetime)` | Target exceeds the chain's forward lifetime window; use a bounded deadline and renew before expiry, not a maximum-u64 deadline |
| NoEntityFoundError | Check entity key versus tx hash, chain/reset identity, known receipt/deadline and deletion; absence alone is ambiguous |
| EntityMutationError / lost response | Keep original hash/nonce/intent, authenticate receipts and reconcile before another submission |
| `arkiv serves state at the chain head only` / -32603 | State reads at safe/finalized or old block hashes can fail; use latest/pending and keep historical gaps explicit |
| `golemdb segment_range_of(transactions): NotImplemented` / -32603 on `eth_getLogs` | Rabdi fails for blocks with logs about 1,000 blocks (~30 min) behind head. Do not split or retry the range. A live tail at head works; stop the failed watcher, recreate the watcher at head and reconcile current state with an `arkiv_query` or SDK query. No log backfill or catch-up is available across that gap. For a known old transaction, use per-transaction `eth_getTransactionReceipt`. See [arkiv#283](https://github.com/Arkiv-Network/arkiv/issues/283). |
| Reverted receipt with gasUsed == gasLimit | Raise the approved gas cap for the exact operation; use explicit nonce/gas/gasPrice and the measured Rabdi floor |
| HTTP 413 | Measure exact encoded request, reduce/chunk and estimate; if sending may have begun, reconcile first |
| BigInt JSON serialization error | If after create resolved, the write completed; preserve key/hash and fix decimal-string DTO serialization without repeating it |

SDK 1.0.1 rejects excessive lifetime with `InvalidExpiryError` before send and explicitly identifies out-of-gas reverts in `EntityMutationError`; use the [versioned error catalog](references/error-catalog.md) and the unchanged write-safety contract below.

Read [error-catalog](references/error-catalog.md) for typed recovery without logging unsafe diagnostics. Exact error text can be wrapped; source-declared errors are not proof they were triggered live.

## Empty results, skipped rows and stale UI

1. Check exact chain/schema tag, stored column type, indexing flag, creator/current owner and selected fields. `from(schema)` verifies only selected columns; mismatch defaults to skipping and reports skipped. An empty page can hide mismatching entities while later pages remain.
2. SDK queries read latest state with pages up to 100. Offset shifts under concurrent writes; use bounded keyset traversal with mismatch throw where needed. There is no historical/cursor fallback. Do not claim a partial multi-page result is complete or one pinned snapshot.
3. If RPC is current but UI is stale, trace RPC → backend → route → DOM and service worker/browser/CDN caches. Use no-store server fetches and uncached heads, then inspect other layers separately.
4. Check unknown patched-key and owner-filtered incoming-transfer membership, prior-scope invalidation, async watcher failures, startup gaps and periodic expiration sweeps. After any watcher error, recreate the watcher at head and reconcile current state with a query; a watcher beyond Rabdi's log window cannot catch up. Natural expiration has no event. See [arkiv#283](https://github.com/Arkiv-Network/arkiv/issues/283).

Do not diagnose nonce collisions solely from generic execution errors. Compare actual wallet proposal with RPC latest/pending nonce, chain, signer and existing known hashes without signing a second transaction. Add wallet-specific workarounds only from verified evidence for that wallet/network/version.

## Measured wallet and gas symptoms

Historical SDK 1.0.0 measurement: a maximum-u64 create with TEST_SKILLS on 2026-10-30 UTC returned `ExpiryBeyondMaxLifetime(18446744073709551615, 9547, 7884000)`. Its receipt reverted at block 9546 using 31,830 of 1,000,000 gas; the error's currentBlock 9547 came from latest simulation after the receipt. This is a lifetime-bound failure, not gas exhaustion. SDK 1.0.x does not expose `permanent()`; its `atBlock(max-u64)` equivalent is rejected. For SDK 1.0.0, read a published maxLifetime parameter when available, otherwise use the dated measured 7,884,000-block bound and an inclusion margin. On SDK 1.0.1+, use `ExpirationTime.max()` for the maximum lifetime from inclusion, without manual subtraction; see [Entity Expiration](../arkiv-entity-expiration/SKILL.md#rabdi-maximum-lifetime) and [limits](../arkiv/references/limits.md). Longer-lived entities need Lifetime Extension before expiry.

[Historical SDK 1.0.0 native revert handling](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/utils/arkivTransactions.ts) documents the old submission path; SDK 1.0.1 validates excessive expiry before sending.

Historical SDK 1.0.0 behavior: controlled Rabdi checks on 2026-10-30 distinguished historical-state failures from gas exhaustion. RPC errors containing `arkiv serves state at the chain head only` (JSON-RPC -32603) occurred for old block-hash state selectors and for safe/finalized call/estimate requests. Use latest/pending for state reads. Rewriting a selector changes the requested state; it does not establish historical-read support.

Separate default local-signer transactions and one tested MetaMask 13.55.0 transaction reverted after using their entire gas limit. Rabby 0.94.14 passed its tested baseline accounts; MetaMask results differed by account/setup. Lane W's controlled serial creates, Lifetime Extensions and transfers passed with explicit latest nonce, gas=1,000,000 and current network gasPrice. These explicit fields are the recommended default for Rabdi writes, including browser-wallet requests. Check pending versus latest and exclusive signer custody before choosing a nonce; an unresolved pending transaction blocks a new submission.

Measured small creates used approximately 190k gas for one, 1.50M for ten in a batch and 2.97M for twenty. Use a starting cap of at least `1,000,000 + 400,000 × (N − 1)` for N operations; measure larger bytes/chunks/images and allow at least twice their measured maximum, never below that floor. Also estimate the exact intended operation and approve the cap against balance and total spend. The values are dated Rabdi measurements, not universal limits or a wallet-support certificate.

Check receipt.status before readback. Any transaction retry must satisfy every condition of the [write-safety retry contract](../arkiv-write-safety/SKILL.md#reconcile-before-another-submission); no other retry or resend is allowed. Successful or uncertain hashes must be reconciled without another submission. Never apply the diagnostic selector rewrite silently. The repository's seed uses a separately budgeted cap for its multi-create batch.

Fix the demonstrated cause and rerun its smallest credible check. Broader funded probes need explicit operation/spend scope. Draft Arkiv defects through feedback only after a minimal reproduction; never automatically submit an app mistake as a node bug.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
