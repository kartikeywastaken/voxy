# Phase 3 (H16–H22): Arkiv coordination + web

**Goal:** from a fresh browser, complete request → approvals → assembly → admitted tx, reading
coordination only from Arkiv. All Codex (B); Arkiv schema work starts at H4.

Read first: `docs/INTERFACES.md` §4 (entity schema), Arkiv docs (`docs.arkiv.network`). Use the
**Rabdi** testnet config (chain 7794095) — do NOT copy the old `kaolin` examples (bible §3).

## 3a. Arkiv layer (`packages/arkiv/`)
Writers + readers for the 3 entity types. Rules (bible 9.2): Arkiv is never an authority — every
reader verifies signature + roster membership + epoch before showing anything; the chain verifies
again. Only the owner wallet can edit its entity. Entity expiry = request deadline (stale approvals
vanish natively). Keep keys, roster truth, and signature verification OFF Arkiv.

User-visible reads (bible 9.3), all required by the Arkiv track (a log-only use does NOT count):
- approval progress "2 of 3 guardians approved"
- owner-watch alert "recovery started on your wallet" + cancel
- assembler pulls approvals → builds the frame tx
- verify-sync history from `roster-snapshot`

## 3b. watcher (`packages/watcher/`)
Query Arkiv by account; on a new `recovery-request` for a watched wallet, fire a notifier
(Telegram or web push) with a cancel link. This is the owner's defense during ADD_DELAY.

## 3c. web (`apps/web/`) — three screens, deployed to a public URL
1. **Owner dashboard:** roster as ENS names, epoch, sync status, pending recovery, cancel/freeze.
2. **Guardian page:** show **deterministically decoded** fields (wallet, newKey, delay, "cannot
   move funds") next to the digest being signed. No AI in the trust path.
3. **Assembler:** collect approvals from Arkiv, build + submit the tx, show admission result +
   explorer link.

## 3d. Arkiv markdown (write as you build, not at the end)
`arkiv/{schema,friction,reach,why-arkiv,how-you-use-arkiv}.md`. README gets writer wallet
addresses + one runnable query. AI-usage statement required.

Done when: a clean browser runs the whole flow reading coordination from Arkiv, deployed publicly.
