# KeyMesh Bible (v3, final)

ETHGlobal Mumbai 2026. Written Nov 6, 2026. Supersedes the earlier "Master Plan and Bible".

**Status tags used everywhere:** `[V]` verified from a source listed in section 17. `[U]` unverified, must be tested. `[D]` a decision we made.

---

## 0. Read this first

1. **Nobody can promise a win.** This document maximises the odds by (a) doing something the live projects are not doing, (b) matching or beating their quality bar, and (c) never claiming anything we have not measured.
2. **The deadline is unconfirmed.** One tracker says submissions close **Sun Nov 8, 09:00 IST**; the earlier plan said Nov 7, 09:00 IST. Confirm on the dashboard in minute 1. If it is Nov 7, build **Tier 1 only** (section 12).
3. **Everything here is new code.** ENSignv2 is credited as a design reference only. Zero copied code, so we stay eligible as a from-scratch project. `[D]`
4. **Three hard external gates decide the design** (section 13): precompiles in validation (ecrecover), recent-root frames on the devnet, and ENSv2 Sepolia addresses. Test them in hour 0-2.

---

## 1. Thesis

**KeyMesh is wallet recovery whose guardian roster is an ENSv2 namespace, enforced inside an EIP-8141 VERIFY frame on the alt mempool, with approvals coordinated on Arkiv and revocation that crosses chains with an explicit, minimised trust model.**

One-line pitch:
> "Your guardians are ENS names. Revoke one on Sepolia and its old approval stops working on a frame-transaction chain, with no sponsor in the submission path."

What we claim: a new layer and trust model for recovery. What we do not claim: better UX than Safe, Argent or ENSign (section 15).

---

## 2. Competitive landscape (what is already public) and how we beat it

Seen at README level only. **Read each repo's code in hour 0 and update this table.** `[U]` on the details.

| Project | What it does | Its strongest quality signal | Gap we exploit |
|---|---|---|---|
| FrameCap (shubham5080) | Daily spend quotas read from another contract in frame validation; canonical reject, staked alt admit | Clean diff demo, dry-run checklist, AI disclosure | One mechanism only (foreign storage read), no identity layer, no recovery |
| Shepherd (Olisehgenesis) | Agent wallet; policy allowlist in another contract; value caps; co-sign for high-risk calls | CROPS section, "what this does not claim", demo map | Policy is owner-controlled, no ENS, no cross-chain, frame key generated in the browser tab |
| Kabuto (nickthelegend) | DEX with Uniswap v4; price/intent checked in VERIFY; sandwich bot comparison | Live deployed app, adversarial demo with real bot | Different domain; sets the bar for a live app plus an attacker demo |
| Lifeboat (ramavats) | Sponsored atomic migration to a quantum-safe account; staked sponsor guardrails | One-command scripted story including an attack case | Arkiv used as an opt-in log; no identity, no recovery |
| ENSignv2 | ERC-4337 recovery with ENS, wallet, email guardians; won ENS Continuity at Lisbon | Mature feature set, 41 tests, live Sepolia stack | 4337 + sponsor-dependent submission; same-chain ENS |
| ENS Subname Manager | ENSv2 UserRegistry subnames on Sepolia | Real use of the factory and roles | Subnames only; no account security |

### The bar we must clear on top of the unique idea

| Quality bar (seen in rivals) | KeyMesh must have |
|---|---|
| Live deployed UI | Public URL, three screens, works from a fresh browser |
| One-command story | `pnpm demo` runs the whole narrative incl. attacks; `pnpm bootstrap` redeploys after a devnet reset |
| Canonical vs alt evidence | Saved admission reports + explorer links for rejected and admitted txs |
| Attack demos | Replay, stale epoch, sibling-frame swap, revoked guardian, 2-guardian collusion vs veto |
| Honest limits | `TRADEOFFS.md`, "What this does not claim" in README |
| Tests | Foundry unit + invariant tests; attack scripts in CI |
| Measured numbers | Gas table for VERIFY paths, both policy-read modes |

### Where we are structurally different (nobody else has all of these)

1. **ENSv2 as the guardian system**, not a lookup: per-user UserRegistry, role separation, expiring non-transferable slots, resource-bound reads.
2. **Cross-chain revocation** Sepolia → devnet with asymmetric timing (weakening is delayed, strengthening is immediate).
3. **Two ways to enforce shared policy in VERIFY**, measured side by side: staked storage read (alt mempool) vs recent-root proof (EIP-8272). Rivals show only the first.
4. **Permissionless assembly via Arkiv** with owner-attached, expiring entities that a watcher reads.
5. **Protocol-native replay protection**: request ID as the EIP-8250 keyed-nonce key.

---

## 3. Sponsor requirements we must satisfy (from the prize page)

### EF, Frame Transaction Alternative Mempool
- Link to an admitted tx on `explorer.altmempool.wtf` or code that submits one; be able to explain design, code, trade-offs. `[V]`
- Judged on creativity, usefulness, practicality, how well it works, relation to alt mempool. `[V]`
- EF places a project in at most one EF prize. `[V]`

### ENS, Best Use of ENSv2 ($7k pool)
- Built on ENSv2 on mainnet or Sepolia; ENSv2 central, not cosmetic; no hard-coded values; live demo link; open source. `[V]`

### Arkiv, Build on Arkiv (from scratch), judged 25% each
- `/arkiv/friction.md`, `/arkiv/reach.md`, `/arkiv/why-arkiv.md`, `/arkiv/how-you-use-arkiv.md`, plus `/arkiv/schema.md`. `[V]`
- README: writer wallet addresses and one runnable query; a user-visible feature that reads from Arkiv; public repo with an open-source licence; AI usage statement; Arkiv used only as a log does not count. `[V]`
- Rabdi testnet, chain ID 7794095. Some Arkiv doc examples import the old `kaolin` chain: do not copy that; use the Rabdi config. `[V]`

(Max three partner picks. Arkiv tracks count as one.)

---

## 4. System overview

```
 SEPOLIA (ENSv2)                    CROSS-CHAIN                     DEVNET chain 1337 (EIP-8141 + alt mempool)
 ┌────────────────────┐   roster   ┌───────────────┐  attested     ┌──────────────────────────────────┐
 │ parent name        │  events    │ 3 attesters   │  roster msg   │ RosterRegistry                   │
 │ UserRegistry/user  │──────────▶️ │ (2-of-3 sign) │─────────────▶️ │  - verifies 2-of-3               │
 │ g1,g2,g3 slots     │            │ verify-sync   │               │  - removals instant, adds delayed│
 │ EAC roles, expiry  │            │ CLI (anyone)  │               │  - writes recent root (Mode B)   │
 │ RosterPublisher    │            └───────────────┘               │ KeyMeshWallet (frame account)    │
 └────────────────────┘                                            │  - owner path / recovery path    │
                                                                   │ RecoveryPaymaster (Tier 2)       │
          ARKIV (Rabdi testnet)                                    └───────────────▲──────────────────┘
 ┌──────────────────────────────────────────┐   read approvals                      │ frame tx
 │ recovery-request  guardian-approval       │◀️──────────── Assembler (anyone) ──────┘
 │ roster-snapshot   (owner-attached, expiry)│◀️──────────── Owner watcher / alerts
 └──────────────────────────────────────────┘
```

Three chains, three jobs: Sepolia holds identity truth, the devnet enforces policy, Arkiv carries ephemeral coordination.

---

## 5. ENSv2 layer (Sepolia)

### 5.1 Structure `[D]`
- A parent name we own (registered through the ENSv2 ETH Registrar, commit-reveal). Register with a **long duration**; expiry of the parent is a risk (section 14).
- One **UserRegistry per user name**, deployed through the **VerifiableFactory** with deterministic CREATE2 addresses. `[V]` (docs: Verifiable Factory, Registry Template)
- Three fixed guardian slot subnames per user: `g1`, `g2`, `g3` under the user's registry.
- Wallet name resolves to the wallet: store the **devnet wallet address under the ENSIP-11 chain-specific coin type** (`0x80000000 | 1337` = 2147484985). `[U]` verify ENSIP-11 in the ENS docs. This is the cross-chain identity, no hard-coded address.
- Policy readable by anyone as text records on the user's Permissioned Resolver: threshold, recovery delay, add delay (record keys `keymesh.*`). `[D]`

### 5.2 Roles and separation of duties (Enhanced Access Control) `[D]`
- **Cold admin**: can revoke guardians, change thresholds, grant roles. Holds the owner's cold key.
- **Guardian editor**: can assign guardian slots to addresses; cannot change the registry, resolver or revoke roles.
- **Guardian (token holder)**: owns the slot token but cannot transfer it, change resolver or edit the registry.
- Slots are **expiring** (lapsed guardians drop out) and **revocable by cold admin**.
- Pin exact role constants and non-transferability mechanics from `ensdomains/contracts-v2` and the ENS docs. `[U]` Do not guess names.

### 5.3 Reading rules (traps from the docs)
- Bind to the name's **resource**, never the tokenId (token IDs regenerate on role changes; ENSign's own warning). `[V]`
- `latestOwnerOf()` returns the recorded owner **even after expiry**. `[V]` The publisher must check expiry explicitly and treat expired slots as empty.
- Resolve the slot owner **at publish time, never cache**.
- Sepolia deployment addresses were "TBD" in one docs version. `[V]` Pull the current ones from the official repo/CLI (`gskril/ens-cli`) in hour 0 and write them to `deployments.json`.

### 5.4 RosterPublisher (Sepolia contract, permissionless) `[D]`
- `publish(account)` reads the three slot owners, their expiries and the threshold record, computes `rosterHash = keccak(guardians, threshold, parentExpiry bucket)`.
- Emits `RosterChanged(account, epoch, rosterHash, guardians[3], threshold, parentExpiry)` **only if the hash changed**; epoch increments by 1.
- Anyone can call it; attesters and the demo UI both do.

---

## 6. Cross-chain sync (the honest bridge)

### 6.1 Why it cannot be trustless here
Unruggable Gateways prove **rollup data against its parent chain**. `[V]` The devnet is not a rollup of Sepolia and has no L1 state root, so a storage-proof bridge into it is not available. The ENS-native L2 pattern (CCIP-Read plus proofs) points the other way. `[V]` We therefore use an **attested** sync, say so everywhere, and shrink the trust.

### 6.2 Protocol `[D]`
1. Three attesters (three different people/machines) watch `RosterChanged`.
2. Each independently recomputes the roster from Sepolia and signs an EIP-712 `RosterAttestation { wallet, epoch, rosterHash, guardians[3], threshold, sepoliaBlockNumber, sepoliaBlockHash, validUntil }`.
3. Anyone submits `RosterRegistry.submitRoster(att, sigs)` on the devnet; it needs **2 of 3** distinct attester signatures, `epoch == stored+1`, `block.timestamp <= validUntil`.
4. **verify-sync CLI**: anyone recomputes the hash from Sepolia and compares to the devnet registry. Output is a pass/fail report we ship in the repo.

### 6.3 Asymmetric timing (our key trust reducer) `[D]`
- **Strengthening applies immediately**: removing a guardian, raising the threshold.
- **Weakening is delayed** by `ADD_DELAY`: adding a guardian, lowering the threshold. New guardians become active after the delay; the owner can freeze during it.
- Result: compromised attesters can add a malicious guardian only after a delay in which the owner is alerted (Arkiv watcher) and can freeze. They can never silently strip protections instantly.
- Demo scale: `ADD_DELAY` = a few minutes. README states production values.

### 6.4 Stretch: optimistic challenge `[D]`
Attesters post a bond; anyone can challenge with an MPT storage proof against the attested Sepolia block hash. This moves trust from "the roster" to "a block header", which is smaller and checkable, but still attested. Only build after Tier 2.

---

## 7. Devnet layer (EIP-8141 / ERC-8421)

### 7.1 KeyMeshWallet (frame account) `[D]`
State: `owners` (set), `ownerEpoch`, `registry` address, `pending {key, readyAt, requestId}`, `frozen`.

Two VERIFY paths:
- **Owner path**: signature from an owner. Always works (liveness escape if attesters vanish).
- **Recovery path**: guardian quorum from the RosterRegistry.

Recovery is **add-only**: installs a pending key that becomes an *additional* owner after `RECOVERY_DELAY`. It cannot remove owners, move funds, or change the roster.

Owner controls: `cancelRecovery()`, `freeze()` (blocks recovery path until unfrozen via cold admin).

### 7.2 Recovery transaction layout
1. `expiry_verify` frame (deadline). Unique and first; the only place a clock bound is allowed in the validation prefix. `[V]`
2. `VERIFY` frame on the wallet: reads roster, checks quorum, recomputes digest from the next frame's data, then `APPROVE`.
3. `SENDER` frame: `wallet.requestRecovery(newKey)`.

Second tx after the delay: `executeRecovery()` as a SENDER frame (the `block.timestamp >= readyAt` check lives in execution, not validation). `[V]` timestamps are restricted in validation. The exact delay/cancel flow inside frames is `[U]`; **fallback: ship add-only without the delay and say so.**

### 7.3 Binding digest `[D]`
Guardians sign an EIP-712-style digest committing to: `chainId, wallet, newKey, ownerEpoch, rosterEpoch, rosterHash, deadline, requestId, callHash`, where `callHash = keccak(nextFrame.target, nextFrame.data)`.

VERIFY reads the sibling frame through `FRAMEPARAM / FRAMEDATALOAD / FRAMEDATACOPY` and recomputes the digest. `[V]` that these opcodes exist and that the tx signature hash already covers the full frame list; `[U]` that our toolchain exposes them.

Also enforce: distinct signers, signers active in the roster at read time, epochs match exactly, `requestId` single-use.

### 7.4 Replay protection via keyed nonces `[D]`
`requestId` (or a hash of it) is the EIP-8250 nonce key with `nonce_seq == 0`, so a second attempt with the same request is rejected at admission, and different requests can be pending side by side. `[V]` EIP-8250 and the EIP-8369 nullifier example; the workshop has a keyed-nonce bonus step. `[U]` that our wallet flow works with it.

### 7.5 RosterRegistry (devnet) `[D]`
```solidity
struct Roster { uint64 epoch; uint8 threshold; address[3] guardians; uint64[3] activeAt; bytes32 hash; }
function submitRoster(Attestation calldata a, bytes[] calldata sigs) external;
function rosterOf(address wallet) external view returns (Roster memory);
function isActiveGuardian(address wallet, address g) external view returns (bool);
```
Also writes the roster Merkle root to the recent-root system contract for Mode B (section 8).

### 7.6 RecoveryPaymaster (Tier 2) `[D]`
A staked paymaster that sponsors **only** frames matching the recovery shape *and* carrying a valid quorum, so a stranger can fund recoveries without a sponsor-run relayer. Reads the registry (non-sender state), which is the alt-mempool case (b). `[U]` that devnet pay-frame flows work for this.

---

## 8. Policy-read modes (our measured differentiator)

| | Mode A: staked storage read | Mode B: recent-root proof |
|---|---|---|
| How VERIFY gets the roster | `staticcall` RosterRegistry in VERIFY | Merkle proof against a declared recent root |
| Mempool | Rejected canonically, admitted by alt mempool once staked | Eligible for the public mempool via the recent-root frame |
| Revocation lag | Immediate (live storage) | Bounded by the root window `[U]` measure |
| Needs stake | Yes | No |

- Mode B background: EIP-8272 lets apps publish roots to a system contract and a tx declare `(source_id, slot, root)` references; its abstract names wallet authorization roots as an intended use. `[V]` The public mempool admits the recent-root verifier frame. `[V]`
- Deliverable: a **gas + admission + revocation-lag table** for both modes, generated by `scripts/measure.ts` and committed.
- Honest framing: if Mode B shows the roster can be enforced without the alt mempool, we say that. It is a finding, not a failure.
- **Never claim "requires the alt mempool"** unless the staged test proves it.

---

## 9. Arkiv layer (Rabdi)

### 9.1 Entities `[D]`
All entities carry a project attribute so queries are scoped.

| Entity | Owner wallet | Expires | Attributes (queryable) | Payload |
|---|---|---|---|---|
| `recovery-request` | initiator | at `deadline` | `type`, `account`, `requestId`, `rosterEpoch`, `deadline` (numeric), `status` | newKey, ownerEpoch, rosterHash, digest, callHash |
| `guardian-approval` | the guardian | at `deadline` | `type`, `requestId`, `guardian`, `ens` | signature |
| `roster-snapshot` | publisher | long TTL | `type`, `account`, `epoch` (numeric), `hash` | guardians, threshold, attestation sigs |

Entity expiry = request deadline, natively, so stale approvals vanish.

### 9.2 Rules
- **Arkiv is never an authority.** Clients verify signatures, roster membership and epoch before showing progress; the chain verifies again.
- Only the owner wallet can edit its entity, so nobody can delete a guardian's approval. Anyone can spam fake approvals; clients filter by roster membership and signature validity.
- Entities are public: guardian addresses are exposed (README limit).
- Kept **off** Arkiv: roster truth (Sepolia + devnet), signature verification (devnet), keys.

### 9.3 Features that read Arkiv (all user-visible)
- Approval progress "2 of 3 guardians approved" for a request.
- **Owner watch**: query by account; "recovery started on your wallet" alert with a cancel button, plus a notifier (Telegram or web push).
- Assembler pulls approvals and builds the frame tx; anyone can run it.
- verify-sync history from `roster-snapshot`.

### 9.4 Required markdown (write as we build, not at the end)
`arkiv/schema.md`, `friction.md` (log real friction as it happens, with repro steps), `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`. README carries writer addresses and one runnable query.

---

## 10. Clients and tooling

- `packages/frame-sdk`: build, encode, sign and send frame txs; capture admission reports. Starts from the workshop's TypeScript helpers. `[U]` viem support for type 0x06 was a draft PR; do not rely on it.
- **Three screens** (public URL):
  1. Owner dashboard: roster (ENS names), epoch, sync status, pending recovery, cancel/freeze.
  2. Guardian page: shows **deterministically decoded** fields (wallet, new key, delay, "cannot move funds") next to the digest they sign. No AI in the trust path.
  3. Assembler: collects approvals from Arkiv, builds the tx, shows admission result and explorer link.
- Scripts: `bootstrap` (deploy everything, regenerate `deployments.json`), `demo` (the full story), `attacks`, `measure`.

---

## 11. Security model

| Threat | Defence | Residual risk |
|---|---|---|
| One guardian compromised | Quorum M of 3, distinct signers | None alone |
| Two guardians collude | Add-only + delay + owner cancel/freeze + Arkiv alert | Depends on owner noticing |
| Attesters (2-of-3) collude | Weakening delayed, owner freeze, verify-sync detects mismatch | Can delay-add a guardian; owner must react |
| Attesters go offline | Owner path always works; roster stays at last epoch | No new roster changes until back |
| Replay / cross-wallet / cross-chain | Digest binds chainId, wallet, epochs, requestId, callHash; keyed nonce | None known |
| Sibling-frame substitution | `callHash` recomputed in VERIFY from the next frame | Fails if introspection unavailable (Gate 2) |
| Stale approval after revocation | Epoch/rosterHash must match; removals instant | Mode B has a lag window |
| Parent ENS name expires and is re-registered | Publisher emits paused state near expiry; long duration at registration | Operational |
| Guardian slot transferred away | Non-transferable, revocable by cold admin | Depends on ENSv2 role mechanics `[U]` |
| Arkiv spam / fake approvals | Client and chain verify; owner-only edits | UX noise |
| Devnet reset | `bootstrap` redeploys; Sepolia state persists; attesters resync | Demo must be re-run |
| Recovery tries to drain | Wallet has no code path to move funds or remove owners; Tier 3 adds a 7906 assertion `[U]` | None known |

---

## 12. Implementation plan

Hours are from the moment you start building. **If the deadline is Nov 7 09:00 IST, do Tier 1 only. If Nov 8 09:00 IST, do Tiers 1-2 and Tier 3 only with spare time.** Stop building 3 hours before the deadline; the final 3 hours are video, README, submission. No new features then.

### Tiers
- **Tier 1 (must ship):** admitted frame tx; wallet with owner + 2-of-3 recovery path; RosterRegistry with attested sync; ENSv2 names + RosterPublisher on Sepolia; Arkiv entities + approval-progress + owner watch; one revocation demo; all docs.
- **Tier 2:** asymmetric add-delay, keyed-nonce replay protection, Mode B measurement table, delay + cancel, RecoveryPaymaster, second wallet on the same registry.
- **Tier 3:** optimistic challenge, 7906 assertion, ENSIP-11 name-to-wallet resolution polish, EOA default-code recovery `[U]`.
- **Never:** zkEmail, passkeys, cross-chain claims beyond Sepolia → devnet, AI agents as guardians.

### Phases

**Phase 0 (H0-2): recon and gates**
- Confirm deadline, track registration, video rules on the dashboard.
- Run the workshop quickstart: faucet, first frame tx, explorer. Find Pierre and Alex.
- Ask them: precompiles (ecrecover) in validation? recent-root frame support on the sidecar? root retention window? pay-frame/paymaster support?
- Pull current ENSv2 Sepolia addresses.
- Create repo (licence, README skeleton, Arkiv stubs). Commit early, commit often (no single giant commit).
- *Done when:* an admitted frame tx exists; the three gate answers are written in `docs/GATES.md`.

**Phase 1 (H2-8): devnet core** (Protocol lead)
- Deploy a validation-frame wallet that reads a separate contract (workshop steps 4-8). Capture canonical rejection and staked admission reports.
- Prove sibling-frame introspection (Gate 2).
- Implement `KeyMeshWallet` owner path + recovery path with quorum, digest, epoch checks, add-only.
- Foundry tests for every invariant in section 11 and below.
- *Done when:* a 2-of-3 recovery tx is admitted and included, and fewer-than-M, duplicate, wrong-epoch and swapped-frame cases are rejected.

**Phase 2 (H8-16): ENSv2 + cross-chain** (ENS lead, in parallel from H2 for the Sepolia part)
- Sepolia: register parent, deploy UserRegistry via factory, set roles/expiry, create three slots, deploy RosterPublisher.
- Attester service x3 + `RosterRegistry` + `verify-sync`.
- *Done when:* revoking a slot on Sepolia produces a new epoch on the devnet within the demo window, and `verify-sync` passes.

**Phase 3 (H16-22): Arkiv + web** (Arkiv lead, Frontend lead; Arkiv schema work starts at H4)
- Writers/readers, approval progress, owner watcher + notifier, assembler.
- Three screens, deployed to a public URL.
- *Done when:* a fresh browser completes request → approvals → assembly → admitted tx, reading only from Arkiv.

**Phase 4 (H22-28): Tier 2 and hardening** (all)
- Asymmetric delay, keyed nonce, Mode B + measurement table, delay/cancel, paymaster, second wallet.
- `scripts/attacks.ts` with all attack cases; Foundry invariant tests; CI.

**Phase 5 (H28-33): docs and polish**
- `TRADEOFFS.md`, `THREAT_MODEL.md`, Arkiv markdown files finalised, README, `deployments.json` with tx hashes.

**Final 3 hours:** record the video fresh from a clean state, fill the submission forms for three partners, AI usage statement, double-check links and licence.

### Roles
- **Protocol lead:** wallet, registry, frames, alt-mempool gates, measurement.
- **ENS lead:** Sepolia contracts, publisher, attesters, verify-sync.
- **Arkiv lead:** schema, SDK, watcher, the five markdown files.
- **Frontend and demo lead:** three screens, scripts, video, README.
- **Floater/QA:** invariant tests, attacks, `deployments.json`, submission checklist.
- **Two people:** Protocol + ENS split Phases 1-2; the other does Arkiv + a single-page UI; skip Tier 2.
- **Solo:** Tier 1 as scripts plus one page; skip the notifier.

### Repo layout
```
keymesh/
  contracts/devnet/    KeyMeshWallet.sol  RosterRegistry.sol  RecoveryPaymaster.sol  lib/Digest.sol  test/
  contracts/sepolia/   RosterPublisher.sol  script/ (ENSv2 setup)
  packages/frame-sdk/  packages/attester/  packages/arkiv/  packages/watcher/
  apps/web/
  scripts/             bootstrap.ts  demo.ts  attacks.ts  measure.ts
  arkiv/               schema.md friction.md reach.md why-arkiv.md how-you-use-arkiv.md
  docs/                BIBLE.md  GATES.md  TRADEOFFS.md  THREAT_MODEL.md  measurements.md
  deployments.json  .env.example  LICENSE (MIT)  README.md
```

### Invariant and attack test list
- Fewer than M guardians rejected; duplicate signature counts once.
- Wrong wallet, chain, newKey, deadline rejected.
- Stale `rosterEpoch` or `ownerEpoch` rejected.
- Sibling-frame substitution rejected (if introspection works).
- Recovery cannot remove owners, move funds or change the roster.
- Cancel during delay works; execute before `readyAt` reverts.
- Guardian removed on Sepolia, synced: old approval rejected.
- Guardian added: inactive until `ADD_DELAY`.
- Lower threshold: delayed; higher threshold: immediate.
- Same `requestId` twice rejected at admission (keyed nonce).
- Unstaked rejected, staked admitted and included (Mode A).
- Mode B proof accepted for current root, rejected for unknown root.
- Arkiv entity expiry equals the deadline.
- Second wallet recovers via the same registry.
- Attester signature from a non-attester, or a duplicate attester, rejected.

---

## 13. Gates, risks, fallbacks

| Gate / risk | Why it matters | Test | Fallback |
|---|---|---|---|
| **Precompiles in validation** | Guardian ECDSA needs `ecrecover`. A devnet issue filed on Nov 6 says the sidecar reports an empty precompile list and rejects such calls `[V]` | Ask Alex; try a minimal VERIFY with ecrecover | If still blocked, owner-path and registry flows still demo; the quorum path waits on the fix. Do not invent a workaround we cannot measure |
| Staked validation cap | The same issue reports a 100k shared cap for staked entities while the spec says 1M `[V]` | Measure the quorum VERIFY gas | 3 signatures + reads should be well under 100k `[U]` measure |
| Frame introspection exposed | Sibling-frame binding | Gate 2 | Drop the binding claim, state the limitation |
| Recent-root frame on sidecar | Mode B | Ask EF; try the workshop bonus flow | Drop Mode B, keep Mode A, say so |
| Delay/cancel inside frame flow | Tier 2 | Prototype in Phase 1 | Ship add-only without delay and say so |
| ENSv2 Sepolia addresses / role mechanics | Whole ENS layer | Hour 0 | Use official CLI/repo as source of truth; ask ENS staff |
| Devnet resets | Demo breakage | `bootstrap` | Re-run; record video from a fresh state |
| Cross-chain eats the time | Highest scope risk | Keep Sepolia side minimal | Scripts over UI |
| Deadline sooner than assumed | Unknown | Confirm now | Tier 1 only |

---

## 14. Demo script (target 2:30, human voice, desktop recording, no sped-up footage)

1. **0:00-0:20** Problem and thesis in two sentences. State plainly that social recovery and ENS guardians are prior art (Safe, ENSign).
2. **0:20-0:50** Unstaked wallet: rejected with the exact reason on the explorer. Stake: admitted.
3. **0:50-1:30** Guardians approve through Arkiv (live query). Anyone assembles and submits. Included. New key pending, delay shown, cancel button visible.
4. **1:30-2:10** Revoke a guardian slot on Sepolia. Sync. Replay the old approval: rejected. Show an added guardian staying pending until the delay.
5. **2:10-2:30** Trade-offs on screen: attested sync (2-of-3), devnet can reset, experimental, no cross-chain beyond this hop. Show the Mode A vs Mode B table.

Film from a fresh state with no preloaded data. Keep under 3 minutes (some EF prizes cap there; verify the general rule on the dashboard).

---

## 15. What not to claim

Not "first social recovery", not "first ENS guardians", not "better than ENSign, Safe or Argent", not "trustless" (the sync is attested), not "requires the alt mempool" unless the staged test proves it, no gas number we have not measured, no "production ready", no claim of novelty without checking the showcase.

---

## 16. Judge Q&A

- **"Isn't this ENSignv2?"** It shares the ENS-guardian idea and we credit it. Its account is ERC-4337 and sponsor-submitted; ours enforces the roster in an EIP-8141 VERIFY frame, with ENSv2 role separation and anyone-can-submit. We did not rebuild its passkeys, email guardians or UX.
- **"Why ENSv2 specifically?"** Per-user registries, role separation, expiring non-transferable slots and resource binding are what make the roster safe. Show a role revocation live.
- **"Why Arkiv, not a relayer?"** A relayer controls coordination. Arkiv gives public, owner-attached, expiring approvals anyone can read and assemble. We kept roster truth and signature checks on-chain.
- **"Why the alt mempool?"** Mode A reads shared state, rejected canonically and admitted when staked. Mode B shows the alternative. We report both honestly.
- **"What if the attesters collude?"** Weakening is delayed, the owner is alerted and can freeze, verify-sync exposes mismatches. They cannot strip protections instantly.
- **"What if two guardians collude?"** Add-only, delay, cancel, freeze. They cannot remove owners or move funds.
- **"Is it better than Safe?"** No, not today. We explore recovery at the protocol validation layer.

---

## 17. Sources

- Prize page: https://ethglobal.com/events/mumbai/prizes
- Alt mempool workshop: https://github.com/forshtat/mempool-workshop and sidecar: https://github.com/forshtat/mempool-workshop-sidecar
- Open devnet issue (precompiles, 100k cap): https://github.com/forshtat/mempool-workshop/issues/1
- EIP-8272 recent roots: https://eips.ethereum.org/EIPS/eip-8272
- EIP-8250 keyed nonces: https://eips.ethereum.org/EIPS/eip-8250
- EIP-8369 (Profile 2, nullifier as keyed nonce): https://eips.ethereum.org/EIPS/eip-8369
- EIP-7906 transaction assertions: https://eips.ethereum.org/EIPS/eip-7906
- ENSv2 docs: https://docs.ens.domains/ensv2/overview , `/permissioned-registry` , `/registry-template` , `/verifiable-factory`
- ENS L2 / CCIP-Read: https://docs.ens.domains/learn/ccip
- Unruggable Gateways: https://github.com/unruggable-labs/unruggable-gateways
- ENSignv2 showcase: https://ethglobal.com/showcase/ensignv2-34544
- Rivals: https://github.com/shubham5080/FrameCap , https://github.com/Olisehgenesis/shepherd_wallet , https://github.com/nickthelegend/kabuto , https://github.com/ramavats/lifeboat
- Arkiv docs: https://docs.arkiv.network

---

## 18. Open questions (write answers into `docs/GATES.md`)

1. Real submission deadline and your registered track.
2. Precompiles in validation: fixed yet?
3. Recent-root frame supported by the sidecar? Retention window?
4. Pay-frame / paymaster support for a recovery sponsor?
5. Does the devnet expose EIP-7906 assertion frames?
6. Current ENSv2 Sepolia addresses and the exact EAC role constants for non-transferable, revocable slots.
7. Does a viem/ethers helper for type 0x06 exist, or do we use the workshop's scripts?
8. Is ENSIP-11 coin type 2147484985 the right record key for chain 1337?
