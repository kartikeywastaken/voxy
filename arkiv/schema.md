# Arkiv schema

Implementation: `packages/arkiv/src/schema.ts`, SDK 1.0.1, Rabdi chain 7794095.
All coordination schemas have indexed `project = "voxy"` and `type` attributes, plus a
public, unindexed `payload` bytes column containing UTF-8 JSON. Schema tags are not authentication.

| Schema | Indexed columns in addition to project/type | Payload |
| --- | --- | --- |
| `voxy_recovery_request_v1` | account (address), requestId (string), rosterEpoch (u64), deadline (u64 Unix seconds), status (string) | newKey, ownerEpoch, rosterHash, digest, callHash |
| `voxy_guardian_approval_v1` | requestId (string), guardian (address), ens (string), deadline (u64 Unix seconds) | signature over RecoveryDigest |
| `voxy_roster_snapshot_v1` | account (address), epoch (u64), hash (string) | guardians, threshold, attestationSigs |

Request IDs and hashes use normalized 32-byte hex strings. Native expiry is a block height;
the signed Unix deadline must also be enforced by readers and the wallet. SDK `atDate` conversion
does not guarantee disappearance at the exact wall-clock second. Approval creation should reuse
the request's observed absolute native expiry rather than create a new relative lifetime.

Writers use readonly creation and disable permissionless extension. Readonly does not prevent
the owner transferring, deleting or extending an entity. The creating EOA owns the entity:
guardian approvals must be created by each guardian's wallet, not the shared operator writer.
Readers must independently validate payloads, signatures, current roster membership and epochs
before counting approvals. Raw query results are discovery data, not a verified approval count.

`voxy_connection_check_v1` is a separate onboarding probe with project, probeId, createdAt and
payload. It has a ten-minute nominal lifetime and is never shown as recovery activity.

Queries are bounded to 100 rows, ordered by entity key, and return the actual observation block.
They are current-state pages, not complete historical archives. Malformed schema rows are skipped
with the SDK's `skipped` count; upstream errors remain failures.
