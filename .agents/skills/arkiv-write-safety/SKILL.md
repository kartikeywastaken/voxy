---
name: arkiv-write-safety
description: Submit and reconcile Arkiv writes using bounded batches, exclusive signer queues and durable intent, signed bytes, receipts and verified progress. Use for bulk imports, nonce conflicts and uncertain outcomes.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Arkiv write safety

One authorized account writer submits bounded batches and preserves every known transaction hash. A JavaScript exception does not establish that the chain rejected a write.

## Choose and prepare the write

- Validate stable row IDs, typed column values and duplicate IDs before any wallet call. Freeze input order and intended fields so receipt keys and readback can be matched to the prepared rows.
- At preparation and before every new signature, require the transaction or batch gas to be at most half the latest block gasLimit (`gas <= latestBlock.gasLimit / 2`). Re-estimate at `latest` and require gas to meet the operation floor and `2 × estimate`. If a frozen plan no longer fits either bound, stop and retain its plan and journal for reconciliation; never mutate or replace it automatically. Split unprepared work into smaller batches when necessary.
- For importing 5,000 rows, use multiple `executeBatch({ creates })` transactions with durable per-batch progress. Choose batch sizes from encoded size, gas estimates, provider limits, and an approved spend budget; there is no verified universal 1,000-operation cap.
- One native batch is atomic. The SDK applies creates, patches, deletes, extensions, then ownership changes; property order in the input object does not reorder them. Multiple batches are separate transactions and can leave partial progress.
- Use `arkiv-entity-lifecycle` for permissions and relationship ordering, `arkiv-entity-expiration` for renewal calculations, and `arkiv-security-trust` for signer custody.
- Check configured network, connected account, current permissions, deadline, and GLM balance before submission. Compare an unsigned estimate and fee cap, with a margin, against both balance and approved remaining spend. Estimates spend no GLM, but the provider can still reject balance or fee fields. They do not authorize a funded send.
- Represent media type as an application column when needed; binary/JSON data lives in named bytes columns. The SDK sorts attribute cells by their encoded names; raw ABI callers must do so themselves. An empty batch throws `Error("No operations to perform")`; an empty patch throws `EmptyPatchError`. Skip empty work.
- Keep bytes-column data limits separate from total encoded transaction limits: ABI framing, attributes, and every operation add bytes. Do not present a bytes-column data limit as the transaction limit.

## SDK 1.0.1 gas behavior

SDK 1.0.1 behavior when `gas` is omitted: estimate the exact operation, then use `min(floor(estimate × 125 / 100), 2^24)` when the estimate is at most `2^24`. An estimate already above that cap is left unchanged, so padding does not make oversized work valid. Caller-supplied `gas` is used as is, without the 25% headroom. This is SDK behavior, not the stronger admission policy in these recipes: funded examples keep explicit nonce/current gasPrice/gas, the per-operation floor, `2 × estimate`, approved budget and latest half-block bound. The SDK default does not enforce that half-block bound or the recipe floor. The dedicated small-entity 1.0.1 smoke passed without explicit gas; that single result does not establish safety for larger writes, batches or browser wallets.

SDK 1.0.1 reports an out-of-gas reverted receipt as `EntityMutationError` with an explicit out-of-gas diagnostic. The diagnostic does not authorize another signature; keep it sanitized and apply the exact receipt-based write-safety contract below. An uncertain submission or prior SDK success still blocks another send.

## Nonces, fees, and predictions

Serialize all writes for an account. `Promise.all` over wallet writes can collide on transaction nonces; a queue in one process cannot coordinate another tab, server, wallet application, or process. Use an account-wide coordinator or exclusive custody when correctness depends on ordering.

The transaction nonce orders Ethereum-compatible transactions. The **entity-minting nonce** is a separate counter per creator and advances for each create. Pass the creating signer's address as `owner` in `reader.predictEntityKeys({ owner, count })` or `reader.predictEntityKeys({ owner, salts })`; with `salts`, their length determines the count. This counter is not `getTransactionCount()` and does not follow later ownership transfers. Hold exclusive access to every create between prediction and submission, use exactly the predicted salts, and verify receipt keys. An intervening create can invalidate relationships even if transaction nonce allocation was correct.

Pass `TxParams` last: fourth after `createEntity(schema, values, options)` or `patchEntity(schema, key, changes)`, second for `executeBatch(batch)` and descriptor-based lifecycle methods. Every new Rabdi write requires `{ nonce: latest, gas, gasPrice }` with gasPrice from current `eth_gasPrice`. Use at least 1,000,000 gas for one operation and add 400,000 per extra batch operation; raise it for the exact estimate and at least twice measured maximum gas for large bytes. Check latest/pending under exclusive signer custody and approve balance/total spend before signing. Refresh nonce/fees for every new transaction; never reuse one nonce across batches. SDK types also describe EIP-1559 fields; this guide retains them only to authenticate and reconcile already-signed intent, without rewriting or resending it. Newly prepared plans require gasPrice.

On Rabdi, always pass explicit `gas` to the funded write. First run an exact unsigned `eth_estimateGas` or simulation at `latest`, using the guarded estimator below. If it errors, stop before signing and surface only fixed sanitized diagnostics, without raw or nested causes. Otherwise use `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, subject to approved cost/balance ceilings. An explicit cap skips automatic estimation; it never replaces this unsigned preflight. See [rendered funding/permission errors](../arkiv-troubleshooting/references/error-catalog.md); neither their message nor a missing hash proves the send phase.

SDK 1.0.x `executeBatch` returns created keys but no expiration deadlines. Decode each canonical `EntityCreated` log's `entityKey`/`expiresAt`, or read current entity state and retain its observation block. The durable importer below validates those event fields against its frozen plan; do not infer expiries from the batch result.

## Reconcile before another submission

| Observed state | Action |
| --- | --- |
| Validation, unsigned estimate, or checkpoint failed; instrumented send admission was never reached | No broadcast occurred through that guarded path. Fix inputs, gas/funding, or persistence before retrying. |
| Send admission was reached, or an uninstrumented wallet call failed without a known hash | Outcome is uncertain. Stop automatic resubmission and authenticate signer/nonce/provider history. An unchanged nonce or empty query does not prove rejection. |
| Raw bytes/hash were durably captured but forwarding may not have begun | Retain the original bytes/hash and nonce; reconcile first. Never re-sign or allocate a replacement nonce automatically. |
| Known hash; receipt unavailable | Keep the hash and wait/reconcile. An RPC lookup error does not mean the transaction disappeared. |
| Receipt successful; SDK event decoding/count failed | The batch applied. `EntityMutationError.txHash` preserves the hash. Recover identities from receipt logs and matching input order; never recreate automatically. |
| Receipt reverted | Stop and preserve the hash. Non-gas reverts are terminal under this policy. Only authoritative gas exhaustion before any SDK success may qualify for the single bounded retry described below. |
| Authenticated canonical receipt; later read/checkpoint failed | Preserve receipt-confirmed keys/hash separately from verified progress. Repair this batch's verification or checkpoint without resending; block the next batch. |

RPC transport retries and submitting a new transaction are different actions. Do not convert a transport retry policy into application retries around `createEntity()` or `executeBatch()`. An application `row_id` helps reconciliation but is not protocol uniqueness or automatic idempotency.

Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy. The durable importer stops on every revert for operator reconciliation and never retries automatically.

## Durable batch progress

Apply these rules before choosing an importer:

- Save prepared/submitting intent durably **before** the wallet call. Freeze the current batch's ordered rows and intended fields; a successful estimate is not saved intent.
- Preserve every known hash immediately. When local signing exposes raw bytes, authenticate and save those bytes/hash **before** forwarding them to the provider. If that save fails, do not forward the send.
- Separate `receipt_confirmed` from `verified`. Authenticate the signed intent, provider transaction, canonical successful receipt and ordered keys/events, then durably save receipt-confirmed progress **before** field readback or a later checkpoint. An arbitrary successful receipt or event count does not authenticate the planned batch.
- Read back only the current batch's rows at their individually observed current query blocks and require their bytes-column data, typed attributes and metadata to match before saving `verified` or admitting the next batch. For 60 rows split into three batches of 20, verify each batch's 20 rows; the whole job completes after all three are verified.
- Stop on uncertain sends, readback failures and save failures. Preserve partial progress: the prior `submitting` or `receipt_confirmed` entry remains the recovery source. Restart with the original plan/hash/files, authenticate the known transaction and repair verification without resending it.

## Worked resumable importer

Use [the resumable Node importer](references/resumable-import.md) for a complete create-only workflow. Its executable helper prepares and loads an immutable plan, coordinates processes on one host, captures signed bytes/hash before forwarding, checkpoints authenticated receipt confirmation, then verifies this batch's fresh fields before checkpointing verified progress.

1. Prepare one plan under exclusive signer custody. Freeze row order, salts, absolute expirations, account/chain/genesis, batch numbers, transaction nonces, SDK calldata, gas, fees, and spend cap. Retain the returned plan hash in a trusted job entry.
2. Fsync the plan and journal before admission, and save `prepared` intent before entering the wallet call. Each raw send authenticates the local signature and exact frozen intent, then fsyncs `submitting` signed bytes and their hash **before** the provider request. If this save fails, the wrapper does not forward the send.
3. Stop after any uncertain send, receipt/verification failure, or checkpoint failure. The pre-send journal survives receipt-wait crashes and lost responses even when `EntityMutationError.txHash` is absent.
4. Restart with the original plan hash and files. Load durable state, authenticate every captured hash before continuing, repair incomplete verification, and skip resubmission of verified batches. This conservative helper also rechecks their fresh fields. Do not infer batch numbers from the current result-array length or restart the original rows.
5. Save `receipt_confirmed` after matching sender, nonce, native address, input, fee fields, canonical receipt block/provenance, event order and predicted keys. Then read this batch's entities and save `verified` only after matching fields. A failed receipt save leaves `submitting` available; a failed readback or verified save leaves `receipt_confirmed` available. The helper writes journal version 3 and fails closed on older journals; retain them and reconcile with the original importer rather than renaming their combined `confirmed` state.

The helper never rebroadcasts or retries. Preserve signed bytes/hash and nonce for reconciliation; a successful or uncertain submission never authorizes another send, including the same signed bytes. Expired or changed entities cause this conservative example to stop, never recreate.

`EntityMutationError` without a hash, including "Execution error without revert data", can follow a lost send response. Classify recovery by observed phase and durable admission evidence, not the exception class or message. A reverted receipt establishes failure; an unsigned estimate rejection does not establish a mined revert. Supplying explicit gas can bypass estimation and produce a paid revert.

For older uninstrumented jobs, use the saved start block and pinned signer/nonce to locate candidate transactions. Authenticate the complete intended input and receipt before adopting one. A consumed nonce can belong to a different transaction. Keep unresolved work stopped if the hash or intended transaction cannot be established.

## Verification and sources

The repository's controlled regressions exercise SDK 1.0.x encoding/receipt decoding, a lost raw-send response, failed durable appends/checkpoints, authenticated input/receipt/key order, typed readback and refusal of incompatible journals. Journal-version-3 cases require receipt confirmation before reads, batch-local verification, and recovery without resubmission. These checks do not certify real provider limits, distributed custody, cross-process crashes or machine power-loss durability. The separate authorized Rabdi smoke supplies actual network write/readback evidence.

- [SDK 1.0.1 native encoding, send and receipt handling](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/utils/arkivTransactions.ts).
- [SDK 1.0.1 executeBatch result](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/actions/wallet/executeBatch.ts), [TxParams](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/types/txParams.ts), and [entity-key prediction](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/actions/public/predictEntityKeys.ts).
- [Native mutations, events, and reverts](https://docs.arkiv.network/json-rpc/mutating-entities/).

## SDK 1.0.x schema inputs

Each batch create is `{ schema, values, expiration, flags?, salt? }`; each patch is `{ schema, entityKey, set?, unset? }`. Use typed constructors/defineSchema from the schema subpath and explicit per-column indexing. Only indexed scalars filter; bytes columns are never indexed. Current readback uses `$key`, `$owner`, `$creator`, `$expiresAt`, `$attributes` and `$attributeSchema`, without historical block options. The importer freezes schema/indexing choices in plan version 2, writes journal version 3 and refuses incompatible earlier files.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.

SDK 1.0.1 changes: [gas and out-of-gas handling](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/utils/arkivTransactions.ts), [expiry validation](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/entity/expiry.ts).
