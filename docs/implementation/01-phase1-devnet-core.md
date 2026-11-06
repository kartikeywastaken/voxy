# Phase 1 (H2–H8): devnet core

**Goal:** a 2-of-3 recovery tx is admitted and included on the devnet, and every bad case is
rejected. This is the heart of the project.

## Claude (A) — contracts (Foundry, `contracts/devnet/`)

Read first: `reference/ens-v2` is NOT needed here; this is devnet-only. Use the workshop's
frame account as the starting shape for the validation entrypoint.

1. **`lib/Digest.sol`** — EIP-712 hashing of `RecoveryDigest` (see INTERFACES.md §1). Pure lib.
2. **`RosterRegistry.sol`** — `submitRoster` verifies 2-of-3 distinct attester sigs, `epoch ==
   stored+1`, `validUntil`. Stores `Roster`. `isActiveGuardian` checks `activeAt <= now`.
   (Attester set is fixed at deploy; 3 known keys from `.env`.)
3. **`KeyMeshWallet.sol`** — state `{owners, ownerEpoch, registry, pending, frozen}`. Two VERIFY
   paths:
   - **Owner path:** signature from a current owner. Always valid (liveness escape).
   - **Recovery path:** reads `RosterRegistry.rosterOf(this)`, checks quorum of guardian sigs over
     the `RecoveryDigest`, distinct signers, epochs match, `requestId` unused, recomputes
     `callHash` from the sibling frame (Gate 2), then APPROVE.
   - `requestRecovery(newKey, requestId)` sets `pending{key, readyAt = now+RECOVERY_DELAY, requestId}`.
   - `executeRecovery()` adds `pending.key` as an **additional** owner after `readyAt`. Add-only:
     no removing owners, no moving funds, no roster writes.
   - `cancelRecovery()` / `freeze()` owner-only.
4. **Foundry tests** (`contracts/devnet/test/`) — cover the full invariant list in bible §12:
   fewer-than-M rejected, duplicate signer counts once, wrong wallet/chain/newKey/deadline
   rejected, stale epoch rejected, sibling-frame swap rejected (if Gate 2 passed), execute-before-
   readyAt reverts, cancel during delay works, add-only enforced.

Fallbacks: if ecrecover-in-validation is blocked (Gate 1), demo owner-path + registry flows and
mark the quorum path blocked in GATES.md — do NOT fake it. If Gate 2 failed, drop the callHash
binding and note the limitation.

Done when: admitted+included 2-of-3 recovery on devnet; all reject cases pass in Foundry.

## Codex (B) — frame-sdk (`packages/frame-sdk/`)

Build against the ABIs in INTERFACES.md; mock `RosterRegistry`/`KeyMeshWallet` until A ships (~H8).

1. `buildRecoveryTx(...)`: assemble the 3-frame recovery tx (expiry_verify → VERIFY → SENDER)
   per bible §7.2, using the workshop's TS helpers. Do not rely on viem 0x06 support (bible §10).
2. `signDigest(...)`: EIP-712 sign a `RecoveryDigest` as a guardian.
3. `submit(...)`: send via the alt-mempool bundler; capture and save the **admission report**
   (rejected-unstaked vs admitted-staked) to `artifacts/` for the demo.
4. A tiny CLI so A can drive frame txs during contract testing without the UI.

Done when: the SDK can build+sign+submit a recovery against A's deployed contracts and save the
admission report.
