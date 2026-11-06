# Voxy backend (chain-core TypeScript services)

The backend ties the three chains together. It is pure viem + the Arkiv SDK, no mocks: every
address comes from `deployments.json` and every hashing path is verified byte-for-byte against the
**live deployed contracts**.

## Packages

### `@voxy/chain` — shared foundation
- `deployments.ts` — typed, validated loader over the root `deployments.json` (single source of truth).
- `abis.ts` — authoritative minimal ABIs for the exact entrypoints the backend calls
  (`RosterRegistry`, `VoxyWallet`, `RosterPublisher`). These are the final ABIs the web/frame-SDK
  should consume (full compiled JSON stays under `contracts/devnet/out/`).
- `eip712.ts` — TypeScript reproductions of the contracts' hashing: `hashRoster` (plain abi.encode),
  `RosterAttestation` and `RecoveryDigest` EIP-712 typed data. Domain is `Voxy` / `1`.
- `clients.ts` — viem chain + reader/wallet factories for Sepolia and the alt-mempool devnet.
- **Test (`eip712.test.ts`):** asserts the TS domain separators equal the `DOMAIN_SEPARATOR()`
  read **live** from the deployed `VoxyWallet` and `RosterRegistry`, and that `hashRoster` matches a
  `cast` golden. If TS ever drifts from the contracts, this fails.

### `@voxy/attester` — the honest cross-chain bridge (bible §6)
- `roster.ts` — reads the roster live from the Sepolia `RosterPublisher` (expiry-aware ENSv2 read)
  and from the devnet `RosterRegistry`.
- `attest.ts` — `buildAttestation(epoch)` builds ONE canonical attestation from a single Sepolia
  block; `signAttestation(pk, attestation)` is each attester's EIP-712 signature over that exact
  struct (so 2-of-3 signatures hash to the digest the registry recomputes).
- `submit.ts` — permissionless `submitRoster(attestation, sigs)` to the devnet registry.
- `verify-sync.ts` — re-reads both chains and reports any mismatch. Pure reads, no trust.
- CLI: `pnpm attester:roster | attester:verify-sync | attester:sync`.

### `@voxy/orchestrator` — the permissionless assembler (bible §9.3)
- `digest.ts` — `buildRecoveryDigest(newKey)` reads ownerEpoch / rosterEpoch / rosterHash LIVE so a
  stale value can't slip in.
- `guardian.ts` — a guardian's EIP-712 signature over the `RecoveryDigest`. One artifact is used
  both as the Arkiv `guardian-approval` and the on-chain quorum signature.
- `assemble.ts` — `verifyApprovals` recovers each signer, requires `isActiveGuardian` on-chain, and
  dedups (exactly as the wallet does); `assembleAndSubmit` simulates then submits `requestRecovery`.
- `arkiv-bridge.ts` — reads guardian approvals from Arkiv (`@voxy/arkiv`) and lifts out candidate
  signatures; it trusts nothing — the on-chain quorum is the gate.
- CLI: `pnpm recover digest|recover|assemble --new-key <addr> [--dry-run]`.

## Final contract entrypoints (answering the aak handoff)

```solidity
// devnet RosterRegistry
function submitRoster(RosterAttestation a, bytes[] sigs);      // 2-of-3 attesters
function rosterOf(address wallet) view returns (Roster);
function isActiveGuardian(address wallet, address g) view returns (bool);

// devnet VoxyWallet  (direct path — the frame-native VERIFY variant is additive, same digest)
function requestRecovery(RecoveryDigest d, bytes[] guardianSigs); // quorum checked in execution
function executeRecovery();                                       // after delay, ADD-ONLY
```
EIP-712 domain: name `Voxy`, version `1`, live chainId, verifyingContract = the contract.
Live addresses: see `deployments.json`.

## Live evidence captured during build (2026-11-06)
- `verify-sync` returned `match: true`: Sepolia roster hash `0x63a4…5320` == devnet registry epoch 1.
- Orchestrator `recover --dry-run` against the live devnet: both guardian signatures recovered to
  active guardians, quorum 2/2 met (no state change).

## Run
```sh
pnpm install
pnpm check && pnpm test && pnpm lint   # 9 tests, incl. live-contract domain-separator checks
pnpm attester:verify-sync
pnpm recover recover --new-key 0x<addr> --dry-run
```
Server-side env: `ATTESTER_1_PK..3`, `GUARDIAN_1_PK..3`, `DEVNET_DEPLOYER_PK`, RPC overrides optional.
