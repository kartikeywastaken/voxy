# Phase 0 (H0–H2): setup and gates

**Goal:** an admitted frame tx exists, the three external gates are answered in `docs/GATES.md`,
and the repo scaffold runs. Nothing downstream is safe to build until the gates are known.

## Claude (A) — gates

1. **Confirm the event basics** (bible §0): real submission deadline (Nov 7 vs Nov 8 09:00 IST),
   track registration, video length cap. If Nov 7 → Tier 1 only.
2. **Run the alt-mempool workshop quickstart**: faucet → first frame tx → see it on
   `explorer.altmempool.wtf`. Repo: `github.com/forshtat/mempool-workshop` (+ `-sidecar`).
3. **Gate 1 — precompiles in validation:** write a minimal VERIFY frame that calls `ecrecover`.
   Does the sidecar admit it? (Open issue says precompile list may be empty — bible §13.)
4. **Gate 2 — sibling-frame introspection:** confirm `FRAMEPARAM / FRAMEDATALOAD / FRAMEDATACOPY`
   are exposed by the toolchain, so VERIFY can recompute `callHash` from the next frame.
5. **Gate 3 — recent-root frames (Mode B):** does the sidecar accept an EIP-8272 recent-root
   reference? What is the retention window? (If no → drop Mode B, keep Mode A, say so.)
6. **Write every answer into `docs/GATES.md`** with the exact error text and a link to the admitted
   or rejected tx. Fallbacks per bible §13. This file gates A's Phase 1 and B's measurement.

Done when: an admitted frame tx link exists and `docs/GATES.md` has all three answers.

## Codex (B) — scaffold

1. Wire the pnpm workspace (root `package.json` already exists): add `tsconfig.base.json`, biome
   config, `tsx` + `viem` + `typescript` as dev deps at root.
2. Stub each package with a `package.json` + `src/index.ts`: `frame-sdk`, `attester`, `arkiv`,
   `watcher`. Stub `apps/web` (Vite or Next — your call, keep it light).
3. Create the Arkiv doc stubs: `arkiv/{schema,friction,reach,why-arkiv,how-you-use-arkiv}.md`
   (headings only). Start logging real friction in `friction.md` from now.
4. README skeleton with the bible's one-liner, the "what this does NOT claim" block (bible §15),
   and placeholders for the demo URL + writer addresses.
5. `.env` plumbing: a tiny `packages/*/src/env.ts` that reads `.env` with documented defaults.

Done when: `pnpm install` succeeds and each package builds empty.

## Shared, by H2
- Both review and **freeze `docs/INTERFACES.md`**. No real cross-boundary code before this.
- Commit early, commit often. Small commits.
