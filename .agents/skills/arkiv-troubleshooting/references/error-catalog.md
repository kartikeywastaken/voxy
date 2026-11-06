# Source-declared SDK 1.0.x errors

This catalog describes inspected source, not a claim that every error was reproduced on a live node. Use fixed allowlisted diagnostics and validated local transaction identifiers. Never expose or persist raw provider errors or nested causes: the RPC URL path contains a credential. Outer viem or EntityMutationError objects can include that URL in multiple fields.

Native/RPC rows describe observed Rabdi behavior; they are not additional SDK error classes.

| Class | Correction |
| --- | --- |
| MissingAccessKeyError | rabdi requires an options.accessKey string; explicitly empty keys use the heavily limited endpoint |
| SchemaDefinitionError | Use defineSchema, valid columns/names and attribute budget |
| SchemaMismatchError | Inspect required/optional/default values, selected column types and named tag |
| InvalidAttributeNameError | ASCII name grammar, reserved names and 32-byte limit; case is significant |
| InvalidValueError | Preserve declared type, integer/range/byte bounds and decimal string precision |
| MissingValueError | Null is not a value; optional absence is omitted/unset |
| UntypedValueError | Objects/arrays need explicit byte encoding |
| TooManyAttributesError | 32 attributes including a named tag; do not silently drop columns |
| EntityTooLargeError | Aggregate bytes-column budget exceeded; use bounded chunks/external storage |
| ConflictingMutationError | A name cannot be set and unset in the same patch |
| EmptyPatchError | Supply set/unset changes or skip the operation |
| InvalidExpiryError | Correct branded expiry and nominal units; SDK 1.0.1 also rejects durations/deadlines beyond MAX_LIFETIME before send; use ExpirationTime.max() for the longest allowed life |
| ExpiryBeyondMaxLifetime (native revert) | Excessive lifetime from older SDK/raw callers; SDK 1.0.1 rejects it before send with InvalidExpiryError. Use max() on 1.0.1 for the maximum from inclusion; the conservative margin fallback applies only to 1.0.0 |
| InvalidPredicateError | Check indexing/type/system-field rules and single ordering key |
| UnsupportedOperatorError | Operator/type mismatch, such as prefix on non-string |
| QueryError | Inspect kind/code: parse -32001, type -32002, literal -32003, limits -32004 |
| NoEntityFoundError | No current live key; reason may be never-created, deleted, expired, reset or wrong chain |
| EntityMutationError | Preserve txHash if present and reconcile observed send phase/receipt; SDK 1.0.1 explicitly identifies out-of-gas reverts, which do not bypass the write-safety contract |
| Head-only state / -32603 | `arkiv serves state at the chain head only`: use latest/pending instead of safe/finalized or old block-hash state selectors |
| `golemdb segment_range_of(transactions): NotImplemented` / -32603 on `eth_getLogs` | Rabdi fails for blocks with logs about 1,000 blocks (~30 min) behind head. Do not split or retry the range. A live tail at head works; stop the failed watcher, recreate the watcher at head and reconcile current state with an `arkiv_query` or SDK query. No log backfill or catch-up is available across that gap. For a known old transaction, use per-transaction `eth_getTransactionReceipt`. See [arkiv#283](https://github.com/Arkiv-Network/arkiv/issues/283). |
| Revert consuming the gas limit | Use explicit latest nonce/gas/network gasPrice; raise the approved gas cap above the measured Rabdi floor and exact-operation need |

There are no SDK 1.0.x query cursor/block error kinds. HTTP access/quota failures and invalid raw params are separate from those four query errors. Every arkiv_query, including a filtered count, costs 10 units under current provider policy; other methods cost zero and each access key starts with 100,000,000 units. Honor actual Retry-After/reset policy; avoid retry storms or alternate-key quota bypass.

SDK 1.0.1 reports an out-of-gas reverted receipt as `EntityMutationError` with an explicit out-of-gas diagnostic. The diagnostic does not authorize another signature; keep it sanitized and apply the exact receipt-based write-safety contract below. An uncertain submission or prior SDK success still blocks another send.

## Phase-aware recovery

```typescript
import { EntityMutationError, MissingAccessKeyError } from '@arkiv-network/sdk';
import { QueryError } from '@arkiv-network/sdk/query';
export function recoveryFor(error: unknown, sendAdmission: 'not_reached' | 'reached' | 'unknown' = 'unknown') {
  if (error instanceof EntityMutationError) {
    return { action: error.txHash || sendAdmission !== 'not_reached' ? 'reconcile_write' : 'inspect_presend_failure',
      transactionHash: error.txHash };
  }
  if (error instanceof MissingAccessKeyError) return { action: 'configure_access_key' };
  if (error instanceof QueryError) return { action: 'fix_query', kind: error.kind, code: error.code };
  return { action: 'inspect_sanitized_evidence' };
}
export function createResultDto(result: { entityKey: `0x${string}`; txHash: `0x${string}`; expiresAt: bigint }) {
  return { arkivEntityKey: result.entityKey, transactionHash: result.txHash, expiresAtBlock: result.expiresAt.toString() };
}
```

Set not_reached only from trusted instrumented send-admission evidence, never inferred from absent hashes, error text or unchanged nonces. A decode failure or later serialization/read error can follow a successful transaction. Store original hash/signed intent before formatting responses; fix verification without resubmission. Cross-bundle instanceof can fail, so preserve structured safe discriminants at the real boundary.

For HTTP 413 measure the exact request rather than only binary data size. Keep evidence of whether signing/forwarding occurred. A pre-send validation/unsigned-estimate failure and a paid reverted receipt are different outcomes. Explicit gas can skip estimation. Native revert names can be decoded from inspected versioned ABI/cause data; they are not guaranteed outer JavaScript class names.

Explicit transaction fields are the recommended Rabdi default. A successful receipt followed by a decode/read failure must never be retried. Allow at most one retry per operation, only after an authoritative reverted receipt proves gas exhaustion (`gasUsed === gasLimit`) and the SDK did not report success. Obtain a fresh unsigned estimate at `latest`; require the corrected gas to meet the operation floor and `2 × estimate`, at least double the previous gas cap, and satisfy `gas <= latestBlock.gasLimit / 2`. Use a fresh nonce and current network gasPrice, exclusive signer custody and approved balance/spend. Never resend after SDK success or an uncertain submission, even if a later receipt lookup is missing or disagrees. Non-gas reverts are terminal under this policy. These recovery helpers do not send or retry.

Sources: [SDK errors](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/errors.ts), [schema errors](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/schema/errors.ts), [query errors](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/query/errors.ts).

SDK 1.0.1 changes: [gas and out-of-gas handling](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/utils/arkivTransactions.ts), [expiry validation](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/entity/expiry.ts).
