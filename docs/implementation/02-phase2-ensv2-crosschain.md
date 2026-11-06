# Phase 2 (H8–H16): ENSv2 identity + cross-chain sync

**Goal:** revoking a guardian slot on Sepolia produces a new epoch on the devnet within the demo
window, and `verify-sync` passes. All Claude (A); Sepolia contract work can start at H2 in parallel.

Read first: `docs/GROUNDED_FACTS.md` (real addresses + role constants) and in `reference/ens-v2`:
`src/registry/{UserRegistry,PermissionedRegistry}.sol`, `RegistryRolesLib.sol`,
`src/access-control/`, `lib/verifiable-factory/`, `src/resolver/`.

## 2a. Sepolia setup (scripts, `contracts/sepolia/script/`)
1. Register parent `voxy.eth` via the ETHRegistrar (commit-reveal), **long duration**.
2. Deploy a per-user `UserRegistry` via `VerifiableFactory` (deterministic CREATE2).
3. Create 3 guardian slot subnames `g1/g2/g3`. Grant the guardian the slot token WITHOUT
   `ROLE_CAN_TRANSFER` (→ non-transferable); cold admin keeps `ROLE_UNREGISTER` (→ revocable);
   set an expiry (→ expiring). See GROUNDED_FACTS mapping.
4. Store the devnet wallet address under the ENSIP-11 chain coin type (`2147484985` — `[U]`, verify)
   on the user's Permissioned resolver. Store policy as `voxy.*` text records (threshold,
   recovery delay, add delay). No hardcoded values anywhere.

## 2b. RosterPublisher.sol (Sepolia)
`publish(account)` reads the 3 slot owners + expiries + threshold record, treats expired slots as
empty (bible 5.3 — `latestOwnerOf` returns owner past expiry), computes `rosterHash`, and emits
`RosterChanged` only when the hash changes, incrementing epoch. Permissionless.

## 2c. Attesters (`packages/attester/` — A owns the trust logic)
Three independent signers watch `RosterChanged`, each recomputes the roster from Sepolia and signs
a `RosterAttestation` (INTERFACES §1). Anyone submits `RosterRegistry.submitRoster(att, sigs)` on
the devnet (2-of-3).

**Asymmetric timing (bible 6.3):** strengthening (remove guardian / raise threshold) applies
immediately; weakening (add guardian / lower threshold) sets `activeAt = now + ADD_DELAY`. The
registry enforces this from the diff vs the previous roster.

## 2d. verify-sync CLI
Anyone recomputes the Sepolia roster and compares to the devnet registry; prints a pass/fail
report shipped in the repo. Also emits a `roster-snapshot` for Codex's Arkiv reader (INTERFACES §4).

Fallback (bible §6.1): the sync is **attested**, not trustless — the devnet is not a rollup of
Sepolia so no storage-proof bridge exists. Say so everywhere (bible §15). Optimistic-challenge is
Tier 3 only.

Done when: revoke on Sepolia → publish → attest → submit → devnet epoch bumps and the old guardian
is inactive; verify-sync passes; a `roster-snapshot` lands in Arkiv.
