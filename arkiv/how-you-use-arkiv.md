# How Voxy uses Arkiv

The TypeScript package defines request, approval and roster-snapshot schemas and bounded readers.
All reads use fresh Rabdi RPC state with server-side credentials, cacheTime zero and no HTTP cache.
The CLI returns actual entity metadata, skipped row counts and observation block numbers.

```sh
pnpm install
pnpm arkiv:status
pnpm arkiv:first-write
pnpm --filter @voxy/arkiv query recovery-request --account "$WALLET"
```

The first-write command creates a ten-minute connectivity probe, verifies its receipt and reads
its contents back. It does not create a recovery or approval. Its default maximum transaction
cost is 0.01 tGLM; override with server env `ARKIV_MAX_TX_COST_TGLM`.

Writes are serialized by a per-signer local lock under ignored `.voxy/`. Intent and signed bytes
are fsynced before forwarding. Known hashes, receipt confirmation and verified readback are
journaled separately. An existing journal blocks a new create for the same operation. After a
crash, retain the journal and reconcile the original transaction; never delete it merely to retry.
Exclusive signer custody across devices remains an operator responsibility. No automatic resend
or cross-device nonce coordination is implemented.

`packages/arkiv/src/coordination.ts` publishes requests after live domain/epoch/roster checks,
publishes guardian-owned approvals with the request's observed expiry, and calculates verified
progress. It validates the complete signed message, entity metadata, current membership and
distinct signers. The raw query CLI remains discovery data and must not be presented as quorum.

`packages/arkiv/src/snapshot.ts` reads actual deployed source contracts before writing readonly
observations, including the actual source block/hash. The successful live snapshot is a devnet
registry observation with no claimed independent attester signatures.

`pnpm watcher "$WALLET"` runs a fresh-state poll every five seconds. Its CLI writes alerts and
health status as JSON; no external notifier is enabled. Only requests matching the signing data
and current on-chain state are emitted. Coverage gaps remain visible; delivery/checkpoint races
can cause duplicate alerts. A published request is not itself a completed on-chain recovery.

CLI request, approve, progress and snapshot commands and optional guardian signer configuration
are documented in [the handoff](../docs/CODEX_HANDOFF.md). Browser signing, web screens and frame
assembly are subsequent work. Eight security/input tests pass, along with live persistence and
one empty watcher refresh; positive alert delivery and full recovery through these writers have
not yet been exercised.
