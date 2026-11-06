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
| Devnet contracts | `VoxyWallet.sol`, `RosterRegistry.sol`, `lib/Digest.sol`; owner + 2-of-3 recovery, add-only, epochs, cancel/freeze | `01-phase1-devnet-core.md` |
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
            └ B builds against a SHARED LOCAL ANVIL with A real contracts deployed hour 1. NO MOCKS.
```

Critical handoffs:
- **H2:** INTERFACES.md frozen (both sign off) — before either writes real code against the other.
- **~H1:** A deploys `VoxyWallet` + `RosterRegistry` to a shared local anvil + `deployments.local.json` → B builds frame-sdk against the REAL ABIs. No mocks at any point.
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

---

## 16-HOUR REALITY (operative plan — overrides the 33h bible timeline)

Start: Nov 6. Budget: **16 hours**. This is Tier-1-only. Stop building at H13, last 3h = demo +
docs + submission. Everything real, nothing mocked (`docs/VERIFICATION.md`).

| Hrs | Claude (A) | Codex (B) |
|---|---|---|
| H0–H1 | deploy a stub-free `RosterRegistry` + `VoxyWallet` skeleton to **local anvil**, write `deployments.local.json` | pnpm workspace + `packages/arkiv` connects to Rabdi, write 1 real entity + read it back |
| H1–H5 | `VoxyWallet` full: owner + 2-of-3 recovery, add-only, delay, cancel/freeze + Foundry tests | `frame-sdk` builds/signs/submits a real frame tx vs anvil; capture admission report |
| H5–H9 | Sepolia: parent `voxy.eth`, UserRegistry via factory, 3 slots, `RosterPublisher`; 3 attesters + `submitRoster` | Arkiv 3 entity types live; watcher alert; start `apps/web` owner + guardian screens |
| H9–H13 | cross-chain: revoke on Sepolia → devnet epoch bumps; `verify-sync` PASS; help wire `demo.ts` | assembler screen; `scripts/bootstrap.ts` + `demo.ts` run end-to-end; deploy web public |
| H13–H16 | THREAT_MODEL, verify no claim exceeds measurement, run `docs/VERIFICATION.md` top to bottom | README, TRADEOFFS, Arkiv 5 md files, record demo, submit 3 tracks |

If anything slips: keep the **two-chain revocation demo** (Phase 2) — it's the headline and the
hardest thing for judges to see elsewhere. Drop Tier 2 entirely.
