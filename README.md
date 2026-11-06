# Voxy

Wallet recovery using an ENSv2 guardian namespace, with approvals coordinated on Arkiv and
cross-chain revocation from Sepolia to an EIP-8141 devnet. Design: [project bible](final_project_bible.md).

## Status (live on testnets, verified on-chain)

| Layer | What runs | Evidence |
|---|---|---|
| ENSv2 identity (Sepolia) | guardian roster read live, expiry-aware | `RosterPublisher` `0xc133Bd3d…17cA` |
| Cross-chain sync | 2-of-3 attested roster → devnet registry | `verify-sync` returns `match: true` |
| Recovery, ordinary tx (devnet) | guardian quorum, add-only, 180s delay | `VoxyWallet` `0xb7d8…807E`, ran live |
| Recovery, **EIP-8141 VERIFY frame** (devnet) | quorum in validation via `sigparam`, staked alt-mempool admits, canonical rejects | `VoxyWalletFrame` `0x537a…9fD4`, admitted frame tx `0x70cdf88e…` |
| Recovery of an **existing EOA via EIP-7702** (Sepolia) | one signature, funds/address untouched, ENS guardians recover | `VoxyDelegate` `0x7E4C…06feB`, recover tx `0x379fe14e…` |
| Arkiv coordination (Rabdi) | request → approve → assemble, signatures read back and submitted on-chain | loop tx `0xef55c201…` |

Exact addresses and tx hashes: [`deployments.json`](deployments.json). Backend walkthrough: [`docs/BACKEND.md`](docs/BACKEND.md).

Honest limits: the frame/alt-mempool path is **devnet-only** (EIP-8141 is experimental); 7702 recovers key **loss, not theft**; the roster sync trusts **2 of 3 attesters**; we do not claim production-readiness or that we are the first ENS/social-recovery system.

## Run the Arkiv package

Requires Node 24, pnpm 10.30.2, and a local `.env` containing `ARKIV_ACCESS_KEY`,
`ARKIV_WRITER_PK` and optionally `ARKIV_WRITER_ADDRESS` and `ARKIV_CHAIN_ID=7794095`.
Never commit `.env` or expose signing keys/RPC access keys in browser bundles.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm arkiv:status
pnpm arkiv:first-write
pnpm --filter @voxy/arkiv query recovery-request --account "$WALLET"
```

Configured Arkiv writer: `0x3915753836031a63B6462310f511B4F0E660Ff47`.
The funded writer completed a [real probe write/readback](https://rabdi.explorer.arkiv.network/tx/0xa2be2bef11ca1d5e286e193a9e2f281336d49efaee75c8cdc4fe3c11822a7c4e)
and a [live devnet roster snapshot](https://rabdi.explorer.arkiv.network/tx/0xaa1549ce7ab45ec22f5e81ad8b691e753902cc62a5224001bf02dfc5e1d00d74).
The probe was separate from recovery activity and has expired; retain its receipt and journal.
Request/approval writers, signature-verified progress and the polling owner watcher are implemented.
Positive recovery/alert delivery through the new writers remains unverified; web and frame submission
are subsequent work. See [live evidence](artifacts/arkiv/coordination-evidence.json).
Default maximum cost: 0.01 tGLM per write. See [Arkiv usage](arkiv/how-you-use-arkiv.md).

## Sovereign recovery — "if Voxy disappears, you still get your wallet back"

Recovery does not depend on any server, website, assembler or Arkiv that we run. Trust lives in one
`verifyApproval` (re-check each signer against the on-chain roster), so **every carrier is an
interchangeable, untrusted `ApprovalSource`** — Arkiv, a file, a QR code, stdin.

**C — Censorship-resistant.** A guardian signs in their own wallet and gets a portable `voxy1:…`
string (also a QR). It carries the request + signature and **nothing secret** — it can't move a
coin alone. The owner collects blobs over any channel and submits with no server in the path:

```sh
pnpm voxy:request --new-key 0x<newkey>        > request.json     # owner: shared request
pnpm voxy:sign    --request request.json --pk-env GUARDIAN_1_PK   # guardian: emits voxy1:… blob
pnpm voxy:sign    --request request.json --pk-env GUARDIAN_2_PK
pnpm voxy:recover --request request.json --blob g1.txt --blob g2.txt   # owner: verify + submit
```

Verified live end-to-end from the **blob files alone** (no Arkiv, no server): `2/2 valid on-chain`.
Each wallet pays its own gas, so no relayer is needed (`RecoveryPaymaster` is the optional path).
Instant guardian revocation without attester sync is available via `VoxyGuardianRegistry.revoke()`.

**O — Open.** MIT licensed; the frontend is a static SPA built reproducibly with a pinned
toolchain + committed lockfile:

```sh
docker build -t voxy-web . && docker run -p 8080:80 voxy-web   # byte-reproducible dist
```

Remaining open step (honest): publishing the `dist` CID to IPFS and pinning it in the parent ENS
name's `contenthash` so users verify the loaded site matches this repo — not yet done.

Honest limit: submitting a *frame* tx still goes through an alt-mempool node (a gatekeeper); the
7702/Sepolia path has no such gatekeeper (any Sepolia RPC works).

## Tests

**50 automated tests across four suites**, plus live-network checks. All test real behaviour — no
mocked RPC or contract responses; the TS EIP-712 suite asserts against the **live deployed**
contracts' domain separators and a `cast`-computed digest golden, and the Foundry suites use real
cryptographic signatures.

| Suite | Count | Command | Covers |
|---|---|---|---|
| Foundry — devnet contracts | 9 | `cd contracts/devnet && forge test` | `VoxyWallet` quorum/add-only/replay/revoked-guardian/add-delay/frozen (7) + ENS→registry integration (2) |
| Foundry — Sepolia contracts | 15 | `cd contracts/sepolia && forge test` | `VoxyDelegate` 7702 EOA recovery incl. real `vm.signAndAttachDelegation` (9) + `VoxyGuardianRegistry` — **non-ENS guardians**, revoke/expiry fail-closed, and end-to-end recovery of a delegate through our own registry (6) |
| TypeScript — packages | 24 | `pnpm test` | `@voxy/chain` EIP-712 vs live contracts + RecoveryDigest golden (6), `@voxy/attester` attestation signing/binding/determinism (4), `@voxy/orchestrator` guardian signing (2) + portable `voxy1:` blob round-trip/validation (4), `@voxy/frame-sdk` + `@voxy/arkiv` parsing/signature/schema (8) |
| Web — `apps/web` | 2 | `cd apps/web && node --test` | ENS input normalization + ASCII portal frames |

Repo-wide gates: `pnpm check` (tsc), `pnpm lint` (Biome). The frame contract builds under the
`frame` Foundry profile (`FOUNDRY_PROFILE=frame forge build`).

Live-network verification (needs `.env`):

```sh
pnpm attester:verify-sync                                   # Sepolia ENS roster == devnet registry
pnpm recover recover --new-key 0x<addr> --dry-run           # orchestrator quorum, no state change
node --env-file=.env --import tsx packages/orchestrator/src/arkiv-loop.ts   # full Arkiv-coordinated recovery
```

## Testnet funding

- Rabdi tGLM: [Arkiv Hub faucet](https://hub.arkiv.network/faucet).
- Sepolia ETH: [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
  or [Chainlink faucet](https://faucets.chain.link/sepolia).
- Frame devnet ETH (1337): Faucet button at [alt-mempool explorer](https://explorer.altmempool.wtf/),
  as documented by the [official workshop](https://github.com/forshtat/mempool-workshop).

## What this does not claim

Voxy is experimental. It is not production-ready, a trustless cross-chain bridge. The planned roster sync trusts 2 of 3 attesters. Guardian
data on Arkiv is public, and expiry cannot retract copies. Testnets may reset. We do not claim
the alt mempool is required, publish gas measurements, or claim a live app until verified.
ENSignv2 is a design reference; no code was copied from it.

