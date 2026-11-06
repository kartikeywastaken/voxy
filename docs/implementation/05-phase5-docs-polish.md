# Phase 5 (H28–H33) + final 3h: docs, polish, submission

**Goal:** everything a judge reads/runs is clean and honest. Mostly Codex (B); Claude (A) supplies
the threat model and verifies every technical claim is measured.

## Codex (B)
1. `README.md`: bible one-liner, architecture diagram, **"What this does NOT claim"** (bible §15),
   live demo URL, writer wallet addresses + one runnable Arkiv query, AI-usage statement, MIT.
2. `docs/TRADEOFFS.md`: attested sync (2-of-3), devnet can reset, experimental, no cross-chain
   beyond Sepolia→devnet, Mode B lag window.
3. Finalize `arkiv/*.md` (schema, friction with real repro steps, reach, why-arkiv,
   how-you-use-arkiv) — the Arkiv track scores these 25% each.
4. `deployments.json` with real addresses + tx hashes (INTERFACES §5).
5. `pnpm bootstrap` (redeploy after a devnet reset) and `pnpm demo` (full story incl. attacks) must
   run clean from a fresh state.

## Claude (A)
1. `docs/THREAT_MODEL.md` from bible §11 — every threat, defense, residual risk.
2. Verify no claim exceeds what was measured (bible §15). Scrub any "requires the alt mempool"
   unless the staged test proved it. No unmeasured gas numbers.
3. `docs/GATES.md` final answers to the §18 open questions.

## Final 3 hours (both)
- Record the demo from a **fresh state**, human voice, no sped-up footage, target 2:30, under 3:00
  (bible §14). Film the exact 5 beats in §14.
- Fill submission forms for the 3 partners (EF Frame Alt Mempool, ENS ENSv2, Arkiv from-scratch).
  EF allows only one EF prize per project. Max 3 partner picks total.
- Double-check all links, licence, open-source, no third-party trackers (EF CROPS-style hygiene).
- STOP building 3h before the deadline. No new features.
