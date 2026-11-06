# Work split: Claude (A) and Codex (B)

Two agents build in parallel. The split is **contract-first**: we agree the interfaces in
`docs/INTERFACES.md` up front, then each side builds against them. Codex starts cold (no shared
context), so every task below points at a standalone phase doc.

## The line between us

- **Claude = "Chain Core"** — all Solidity, the EIP-8141 frame mechanics, the cross-chain trust
  (attesters + registry), and their tests. The trust-critical, novel core.
- **Codex = "Coordination & Experience"** — Arkiv layer, the TS frame-SDK consumers, the three web
  screens, the orchestration scripts, and all sponsor docs. The parts a judge sees and runs.

They meet only at: contract ABIs, the two EIP-712 structs (RosterAttestation + binding Digest),
the Arkiv entity schema, and `deployments.json`. All frozen in `docs/INTERFACES.md`.

## Claude (A) owns

| Area | Deliverables | Phase doc |
|---|---|---|
| Phase 0 gates | frame-tx admitted/rejected proof, ecrecover-in-validation test, sibling-frame introspection test, write `docs/GATES.md` | `00-phase0-setup-and-gates.md` |
| Devnet contracts | `KeyMeshWallet.sol`, `RosterRegistry.sol`, `lib/Digest.sol`; owner + 2-of-3 recovery, add-only, epochs, cancel/freeze | `01-phase1-devnet-core.md` |
| ENS contracts + sync | `RosterPublisher.sol` (Sepolia), ENSv2 setup (parent, UserRegistry via factory, 3 slots, roles/expiry), 3 attesters, `RosterRegistry.submitRoster`, verify-sync CLI | `02-phase2-ensv2-crosschain.md` |
| Protocol hardening | keyed-nonce replay (EIP-8250), Mode B recent-root (EIP-8272), RecoveryPaymaster, Foundry unit + invariant tests, the full attack list | `04-phase4-tier2-hardening.md` |

## Codex (B) owns

| Area | Deliverables | Phase doc |
|---|---|---|
| Phase 0 scaffold | pnpm workspace wiring, tsconfig, biome/lint, `.env` plumbing, README skeleton, Arkiv doc stubs | `00-phase0-setup-and-gates.md` |
| frame-sdk (TS) | `packages/frame-sdk`: build/encode/sign/send frame txs, capture admission reports — against Claude's ABIs + the workshop helpers | `01-phase1-devnet-core.md` (B section) |
| Arkiv layer | `packages/arkiv` (3 entity types, writers/readers), `packages/watcher` (owner alerts + notifier), the 5 Arkiv markdown files | `03-phase3-arkiv-web.md` |
| Web | `apps/web` three screens (owner dashboard, guardian page, assembler), public deploy | `03-phase3-arkiv-web.md` |
| Scripts + docs | `scripts/{bootstrap,demo,attacks,measure}.ts`, `TRADEOFFS.md`, `THREAT_MODEL.md`, README, submission forms | `05-phase5-docs-polish.md` |

## Timeline (who is active when; hours from build start)

```
H0 ─── H2 ──── H8 ───── H16 ──── H22 ──── H28 ──── H33 ── submit
A: [gates][devnet core.....][ENS + attesters....][hardening...][support demo]
B: [scaffold][frame-sdk + Arkiv schema......][Arkiv + web............][scripts + docs]
            └ B builds against mock ABIs until A ships real ones (~H8), then swaps.
```

Critical handoffs:
- **H2:** INTERFACES.md frozen (both sign off) — before either writes real code against the other.
- **~H8:** A publishes `KeyMeshWallet` + `RosterRegistry` ABIs → B swaps mocks for real in frame-sdk.
- **~H16:** A's attester emits `roster-snapshot` shape → B's Arkiv reader consumes it.
- **H22+:** both converge on `scripts/demo.ts` (B writes, A's contracts drive it).

## Coordination rules

- Edit only files inside your lane unless you flag it. Shared: `docs/INTERFACES.md`,
  `deployments.json`, `.env.example` — change via a note to the other, never silently.
- Commit small and often; no giant single commit. Neither agent pushes or force-updates the
  other's branch. (Kartik reviews via `git diff` and manages git himself.)
- If a gate in §13 fails (e.g. ecrecover blocked), A updates `docs/GATES.md` immediately and both
  fall back per the bible — B does not wait on a blocked path.

## Solo / fallback

If Codex is unavailable: Claude ships Tier 1 as scripts + one web page, skips the notifier and
Tier 2, per the bible's "Solo" role.
