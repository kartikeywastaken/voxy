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

The browser signing flow, signature-verified progress, watcher and assembler integration are
pending Claude's contract handoff. The raw query CLI must not be presented as verified progress.
