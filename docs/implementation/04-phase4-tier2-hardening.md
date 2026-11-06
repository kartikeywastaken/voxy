# Phase 4 (H22–H28): Tier 2 and hardening

**Goal:** the measured differentiators and the full attack suite. Build only after Tier 1 ships.
If the deadline is Nov 7, SKIP this phase. Mostly Claude (A); Codex (B) wires measurement output
into the demo + docs.

## Claude (A)
1. **Keyed-nonce replay (EIP-8250):** use `requestId` as the nonce key with `nonce_seq == 0`, so a
   repeat request is rejected at admission and distinct requests can be pending side by side.
   Test: same `requestId` twice → rejected at admission.
2. **Mode B recent-root (EIP-8272):** VERIFY reads the roster via a Merkle proof against a declared
   recent root instead of a staked storage read, so the tx is eligible for the *public* mempool.
   `RosterRegistry` writes the roster root to the recent-root system contract. Only if Gate 3
   passed; else document that Mode A (staked) is required and why.
3. **RecoveryPaymaster.sol:** staked paymaster that sponsors ONLY frames matching the recovery
   shape AND carrying a valid quorum — lets a stranger fund a recovery without a relayer.
4. **Second wallet** on the same `RosterRegistry` (proves the registry is multi-tenant).
5. **Foundry invariant tests + `scripts/attacks.ts`** covering the complete bible §12 list,
   including attester-from-non-attester rejected, Mode B unknown-root rejected, threshold
   lower=delayed / raise=immediate.

## Codex (B)
- **`scripts/measure.ts`:** generate the gas + admission + revocation-lag table for Mode A vs
  Mode B (bible §8). Commit to `docs/measurements.md`. Honest framing: if Mode B shows the alt
  mempool isn't required, say so — it's a finding, not a failure.
- Wire the attack demos into `scripts/demo.ts` so the video can show replay / stale-epoch /
  sibling-swap / revoked-guardian live.

Done when: both policy-read modes measured in a committed table, paymaster works, every attack in
the list is a passing (rejecting) test.
