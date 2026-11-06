# Codex handoff on aak

Read onboarding from `origin/main` commit `f93bca2`. Work stays on `aak`; no contracts,
attester logic, deployment addresses or shared interface docs were modified.

## Available

- pnpm workspace, TypeScript and Biome configuration; installed Arkiv SDK 1.0.1.
- Official Arkiv skill downloaded and compared with the existing installed copy: identical.
- `packages/arkiv`: three coordination schemas, bounded readers, live network/balance CLI,
  guarded unsigned estimation and a journaled first-write/readback command.
- Five Arkiv documents that distinguish implementation from measured live evidence.

## Live evidence and blockers

Rabdi RPC returned chain 7794095 and block 279096. Configured writer
`0x3915753836031a63B6462310f511B4F0E660Ff47` had zero tGLM. No write was broadcast at that check.
Fund it using https://hub.arkiv.network/faucet before the real onboarding write/readback.

The real indexed request query returned an empty page at block 279393, with zero skipped rows.
This proves the reader can reach the index; it does not prove writing, expiry or recovery.
The first-write command exited unsuccessfully while unfunded, before any journal or send.
Recorded read evidence: `artifacts/arkiv/read-check.json`.

`deployments.local.json` is absent on this checkout. Main's deployment manifest does not yet
contain usable devnet wallet and registry addresses. No local deployment was fabricated.

## Contract handoff discrepancy

`docs/INTERFACES.md` declares `requestRecovery(address newKey, bytes32 requestId)` after a VERIFY
frame. In `origin/main` at `f93bca2`, the actual Solidity entrypoint is
`requestRecovery(RecoveryDigest d, bytes[] guardianSigs)`. It checks quorum in execution and has
no implemented frame VERIFY entrypoint. The domain is EIP-712 `Voxy`, version `1`, using live
chainId and wallet as verifyingContract. No frame admission or ABI compatibility is claimed.

Claude should provide the final entrypoints, compiled ABIs and live deployment manifest before
the TS frame SDK/web consumes them. This branch does not change the contracts or resolve that
protocol decision. The onboarding document permits independent Arkiv work while contracts wait.

## Reproducible commands

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm lint
pnpm arkiv:status
pnpm arkiv:first-write
```

`ARKIV_ACCESS_KEY` stays server-side. `ARKIV_RPC_URL` is retained in the shared environment but
the SDK derives Rabdi's keyed URL from `rabdi({ accessKey })` so a bare RPC URL cannot silently
omit the configured access key. Optional settings documented here require no shared env edits:
`ARKIV_MAX_TX_COST_TGLM` defaults to `0.01`; `VOXY_STATE_DIR` defaults to root `.voxy/`.

Validation: TypeScript check, Biome check and three schema/input validation tests passed.
The tests contain no mocked network or contract responses. Funded create/readback and expiry
are unverified; web, watcher, frame submission and orchestration are pending subsequent work.

No merge, push, website publication, submission or message to another person was performed.
