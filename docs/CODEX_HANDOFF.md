# Codex coordination handoff on aak

The user confirmed that “phase 2” means the next Arkiv coordination stage, not Claude’s ENS
phase. No contracts, attester code, deployment manifests or shared interface documents were
changed. No merge or push was performed.

## Available

- `packages/frame-sdk`: RecoveryDigest parsing, EIP-712 hashing/signing and canonical low-s
  signature recovery; live wallet/domain/epoch/roster checks at one observed chain block.
- `packages/arkiv`: request and guardian-owned approval writers; strict payload/metadata checks;
  signature-verified, distinct guardian progress; source-bound roster observation writers.
  Approvals reuse the request’s actual native expiry. Uncertain writes stop at the journal.
- `packages/watcher`: fresh-state polling every five seconds, persisted alert deduplication,
  cancellation and explicit unhealthy/incomplete status. The CLI emits JSON to stdout. No
  Telegram, push service or person was messaged.
- Eight security/input tests using actual cryptographic signatures, without mocked RPC results.

Read ABI and signing domain match main’s reconciled `docs/INTERFACES.md` at `d93414f`.

## Measured evidence

Public receipts/source metadata are saved in `artifacts/arkiv/coordination-evidence.json`,
extracted from receipt-confirmed and readback-verified journals. Private journals stay ignored.

| Operation | Rabdi tx | Receipt and readback |
| --- | --- | --- |
| Probe | `0xa2be2bef11ca1d5e286e193a9e2f281336d49efaee75c8cdc4fe3c11822a7c4e` | Successful; 134663 gas used |
| Live devnet roster snapshot | `0xaa1549ce7ab45ec22f5e81ad8b691e753902cc62a5224001bf02dfc5e1d00d74` | Successful; 184595 gas used; independently discoverable by account query |

Writer: `0x3915753836031a63B6462310f511B4F0E660Ff47`. Its funding blocker is resolved.
The probe expired at native block 281157; retain its receipt and journal rather than recreating it.

Main now supplies wallet `0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E` and registry
`0xEa974EfA1aE7D89f7624E144dA1a444C8250f31C`. Live reads returned chain 1337, owner epoch 1,
roster epoch 1 and threshold 2. The snapshot records actual devnet block 829 and its hash.
The roster hash also matched the live Sepolia publisher at block 12075179. This is a pair of
current observations, not an independent cross-chain proof. `attestationSigs` is explicitly
empty and snapshot `evidence` is `registry-observation`.

`artifacts/arkiv/watcher-refresh.json` records one successful live polling cycle at Rabdi block
282946, with no matching requests. Positive alert delivery was not exercised.

`artifacts/arkiv/local-validation.json` records unchanged main contracts deployed to isolated
Anvil chain 31337 and real rejection of an unconfigured roster, wrong chain and EOA wallet.
No mocked state, storage injection or time warp was used. This is local verification, not
public frame admission or successful on-chain recovery.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm lint
pnpm arkiv:status
pnpm arkiv:query roster-snapshot --account 0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E
node --env-file=.env --import tsx packages/arkiv/src/cli.ts request /path/to/recovery.json
node --env-file=.env --import tsx packages/arkiv/src/cli.ts approve REQUEST_ENTITY_KEY optional-label.eth
node --env-file=.env --import tsx packages/arkiv/src/cli.ts progress REQUEST_ENTITY_KEY
node --env-file=.env --import tsx packages/arkiv/src/cli.ts snapshot /path/to/source.json
node --env-file=.env --import tsx packages/arkiv/src/cli.ts snapshot-sepolia /path/to/source.json
pnpm watcher 0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E
```

Recovery JSON contains all nine RecoveryDigest fields, with integers as decimal strings; the
client computes its digest. Registry source JSON has `wallet`, `registry`, numeric `chainId`;
Sepolia source JSON has `account`, `publisher`. RPC URLs come from server env, never public data.

Optional `ARKIV_APPROVER_PK` selects a locally held guardian signer. Otherwise the approval CLI
uses the configured writer, which must actually be an active guardian. The writer cannot
impersonate another guardian. Browser wallet integration is a subsequent stage.
`ARKIV_ACCESS_KEY` stays server-side. `ARKIV_MAX_TX_COST_TGLM` defaults to `0.01` per write;
`VOXY_STATE_DIR` defaults to root `.voxy/`. Watcher checkpoints default to `.voxy/watchers/`.
Local signer locks do not coordinate other devices; keep exclusive signer custody.

## Limits and remaining integration

Request/approval writers, positive approval progress and positive owner alerts have not yet
been exercised together against the public wallet. No artificial recovery was published just
to display success. Claude can wire the APIs into its real recovery flow and supply the desired
new key and signing accounts.

This EIP-712 path is for the shipped ordinary VoxyWallet. It does not build type-0x06 envelopes,
validate sibling-frame calldata or prove keyed-nonce admission. Main’s additive VoxyWalletFrame
signs the full frame transaction: do not substitute an EIP-712 signature for that signature.
`callHash` is guardian-signed, but the ordinary contract does not enforce sibling-frame binding.

Progress scans at most ten 100-row pages; incomplete scans cannot report quorum. The watcher
has a bounded 100-row request window and reports incomplete coverage when full. These are
current observations, not an atomic historical snapshot. Progress rechecks request and chain
state after scanning. Refresh/delivery failures remain failures. A crash after alert delivery
and before checkpointing can cause a duplicate alert. ENS strings are unverified display labels.

The Sepolia snapshot attempt encountered `ResourceNotFoundRpcError` before write admission;
no journal/transaction was created. Its roster read was independently verified, and persistence
was completed through the live devnet source. No raw provider diagnostics or credentials were saved.

Web screens, external notification transport, frame submission and end-to-end orchestration
remain subsequent work. Existing bootstrap/demo/attacks/measure scripts are not implemented by
this stage. No end-to-end recovery or public frame admission is claimed.
