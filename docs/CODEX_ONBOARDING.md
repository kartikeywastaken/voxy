# Codex onboarding (run on the other device)

Codex builds the "Coordination & Experience" lane (see `docs/WORK_SPLIT.md`). Get the same repo +
tooling + Arkiv skills, then start on Phase 0 (B) and Phase 3.

## 1. Get the repo
Clone the voxy repo on the other device (same code Kartik has). Then `cd` into it.

## 2. Install the toolchain
```sh
# Foundry (forge/anvil/cast) — needed to read ABIs and talk to anvil
brew install foundry            # macOS; or: curl -L https://foundry.paradigm.xyz | bash && foundryup
# Node + pnpm (project uses pnpm workspaces)
corepack enable && corepack prepare pnpm@10.30.2 --activate
pnpm install
```

## 3. Install the Arkiv skills (IMPORTANT — the Phase 3 knowledge)
These install in the universal format, so they work for Codex too (not just Claude Code):
```sh
npx --yes skills add Arkiv-Network/skills --skill "*"
```
That drops ~17 `arkiv-*` skills into `.agents/skills/`. The key ones for our build:
`arkiv-first-write`, `arkiv-data-modeling`, `arkiv-query`, `arkiv-entity-expiration`,
`arkiv-write-safety`, `arkiv-app-integration`, `arkiv-indexing`.

> The `claude plugin marketplace add Arkiv-Network/ai-plugin` + `claude plugin install arkiv@arkiv`
> commands are **Claude Code only** — Codex does not use Claude plugins, so skip them. Codex gets
> everything it needs from the `npx skills add` step above plus the `@arkiv-network/sdk` npm package.

## 4. Arkiv SDK + credentials
```sh
pnpm add @arkiv-network/sdk viem   # inside packages/arkiv
```
Fill these in `.env` (Kartik shares the file or you make your own test wallet):
- `ARKIV_RPC_URL=https://rpc.rabdi.db-chain.testnet.arkiv.network`
- `ARKIV_ACCESS_KEY=` (free from https://hub.arkiv.network/access-keys)
- `ARKIV_WRITER_PK=` (a wallet funded with tGLM from https://hub.arkiv.network/faucet)

## 5. Read before coding
1. `docs/WORK_SPLIT.md` — your lane + the 16-hour schedule.
2. `docs/INTERFACES.md` — the frozen contract between A and B (ABIs, the 2 EIP-712 structs, Arkiv schema).
3. `docs/VERIFICATION.md` — how your work will be checked (NO MOCKS — real Arkiv writes/reads).
4. Your phase docs: `docs/implementation/00` (B scaffold), `03` (Arkiv + web), `05` (docs).

## 6. Build against REAL contracts (no mocks)
Claude deploys `RosterRegistry` + `VoxyWallet` to a local anvil and commits `deployments.local.json`
(gitignored, so Kartik/Claude shares the addresses). Use those real addresses + the ABIs in
`contracts/devnet/out/`. If a contract you need is not deployed yet, build a part that does not need
it — never stub it.

## 7. First task (Phase 0 B)
Wire the pnpm workspace, make `packages/arkiv` do one real `arkiv-first-write` to Rabdi and read it
back (proves credentials + SDK), and create the Arkiv doc stubs in `arkiv/`.
