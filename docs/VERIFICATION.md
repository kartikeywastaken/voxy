# Voxy — manual verification (prove it's real, not mocked)

Audience: Kartik, checking by hand that each phase actually works. You should not have to trust
either agent's word. Every check below is something a **mock or hardcoded stub cannot pass** —
because it crosses to an external explorer, a second chain, or a fresh-state rerun.

## The no-mock rule (applies to both Claude and Codex)
- No mock contracts, no stubbed return values, no hardcoded "fake success", no `TODO: real impl`
  in a path the demo touches. If something isn't built yet, it must visibly not work — never fake.
- Everything runs against **real deployed contracts** (local anvil counts as real; a JS object that
  returns `{owners:[...]}` does not) and **real testnet transactions** with explorer links.

## Fast fakery smell-test (run anytime, ~2 min)
```bash
cd /Users/kartik/Desktop/ETH
# 1. No mock/stub/fake left in demo paths:
grep -rinE 'mock|stub|faker|hardcode|dummy|FIXME|TODO' contracts packages apps scripts --include='*.sol' --include='*.ts' | grep -viE 'test/|\.test\.|//.*no mock' || echo "clean"
# 2. The UI/scripts point at REAL addresses, not literals:
grep -rinE '0x0{6,}|return true;?\s*//|return \{ *owners' packages apps | head
# 3. deployments file has real addresses + tx hashes, not placeholders:
cat deployments.json 2>/dev/null | grep -iE '0x\.\.|TODO|FIXME' && echo "!! placeholders present" || echo "no placeholders"
```
A clean project: check 1 prints `clean` (or only test-file hits), checks 2–3 find nothing.

---

## Phase 0 — setup + gates
**Do:** open `docs/GATES.md`; click the admitted-frame-tx link it records.
**Expect:** the tx opens on the PUBLIC alt-mempool explorer (`explorer.altmempool.wtf`) and shows
as included. A second link shows an UNSTAKED attempt rejected with a real error string.
**It's fake if:** the "explorer" is localhost, the tx hash 404s on the public explorer, or
GATES.md just says "works" with no link. Gates must have real yes/no answers + error text.

## Phase 1 — devnet core (the wallet)
Against the REAL deployed `VoxyWallet` (address from `deployments.local.json` / `deployments.json`):
```bash
WALLET=<VoxyWallet addr>; RPC=$DEVNET_RPC_URL
cast call $WALLET "owners()(address[])" --rpc-url $RPC        # note the starting owner set
# run the real recovery flow via the SDK/script, then BEFORE the delay:
cast call $WALLET "pending()(address,uint64,bytes32)" --rpc-url $RPC   # key set, readyAt in future
cast send $WALLET "executeRecovery()" --rpc-url $RPC --private-key $X   # should REVERT (too early)
# after RECOVERY_DELAY:
cast send $WALLET "executeRecovery()" --rpc-url $RPC --private-key $X   # succeeds
cast call $WALLET "owners()(address[])" --rpc-url $RPC        # new key now present, old owners intact
```
**Expect:** owners change ONLY after a real on-chain delay; the new key is ADDED (old owners still
there — add-only); a 2nd tx with the same `requestId` is rejected; `forge test` passes against the
compiled contracts.
**It's fake if:** `owners()` changes instantly with no delay, an owner was removed, `executeRecovery`
succeeds before `readyAt`, or the same requestId can replay. Also run `forge test -vvv` yourself —
tests must call the real contract, not assert on literals.
**Anti-mock proof:** fewer-than-threshold guardian sigs MUST revert on-chain. Try submitting a
recovery with 1 signature → the node rejects it. A mock would accept.

## Phase 2 — ENSv2 + cross-chain (the headline check)
This is the strongest anti-mock test: it spans TWO chains and TWO explorers.
```bash
# 1. On Sepolia, revoke guardian slot g2 (real tx):
#    → open the tx on sepolia.etherscan.io, confirm the slot owner is now empty/expired.
# 2. Run publish + attesters + submitRoster (real txs on the devnet).
# 3. On the devnet, read the registry:
cast call $ROSTER_REGISTRY "rosterOf(address)(...)" $WALLET --rpc-url $DEVNET_RPC_URL
cast call $ROSTER_REGISTRY "isActiveGuardian(address,address)(bool)" $WALLET $G2 --rpc-url $DEVNET_RPC_URL
# 4. Replay g2's OLD approval in a recovery → must be rejected.
```
**Expect:** the devnet epoch increments, `isActiveGuardian(g2)` flips to `false`, and the stale
approval is rejected — all traceable to a real Sepolia tx hash. `verify-sync` prints PASS by
independently recomputing from Sepolia.
**It's fake if:** the roster changes on the devnet with no corresponding Sepolia tx, `verify-sync`
is hardcoded to PASS, or a NEW guardian becomes active instantly (must wait `ADD_DELAY`).
**Anti-mock proof:** change a guardian on Sepolia yourself and watch the devnet follow. One mock
cannot span two independent chains with matching hashes.

## Phase 3 — Arkiv + web
```bash
# Query Arkiv DIRECTLY (not through the app) for the live recovery request:
# (use the Arkiv SDK/JSON-RPC from packages/arkiv — Rabdi chain 7794095)
pnpm --filter @voxy/arkiv query recovery-request --account $WALLET
```
**Do:** open the deployed public URL in a FRESH incognito window. Start a recovery; watch
"2 of 3 approved" update.
**Expect:** the number the UI shows MATCHES the entities the direct Arkiv query returns. Now stop
the app's own backend/server process — the approval data still resolves because it lives on Arkiv.
Entities expire at the deadline (query again later → gone).
**It's fake if:** approval progress comes from app memory/localStorage (survives with the backend
killed? then it's Arkiv; disappears and was never on Arkiv? fake), the URL is localhost only, or the
direct Arkiv query returns nothing while the UI shows progress.
**Anti-mock proof:** the guardian page must decode the signing fields deterministically from the
digest — change one byte of the digest and the decoded `newKey` must change.

## Phase 4 — Tier 2 (only if time; skip if deadline is tight)
**Do:** open `docs/measurements.md`; rerun `pnpm measure`.
**Expect:** the gas/admission/revocation-lag numbers regenerate (not static text); a Mode B proof
against an UNKNOWN root is rejected on-chain; `RecoveryPaymaster` sponsors a recovery from a 3rd
party with no owner key.
**It's fake if:** `measurements.md` never changes when you rerun, or numbers aren't tied to a tx.

## Phase 5 — end-to-end from scratch (the final gate)
```bash
# Wipe local state and rebuild everything from nothing:
pnpm bootstrap     # redeploys all contracts, regenerates deployments.json
pnpm demo          # runs the full narrative incl. attacks, from a fresh state
```
**Expect:** both run clean on a machine with only `.env` filled — no leftover state, no manual
patching. The demo you record must be the output of `pnpm demo`, not a hand-walked happy path.
**It's fake if:** `bootstrap` depends on pre-existing deployed state, or `demo` only works after
manual setup steps not in the script.

---

## One-line standard
If a check above can pass with the network cable unplugged, it's mocked. Every green check here
should require a real chain, a real explorer, or a real fresh-state rebuild.
