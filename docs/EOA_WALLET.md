# EIP-7702 wallet on branch back

The public product flow now protects a normal Sepolia EOA at its existing address. It does not
create a replacement smart-account address, keep user keys on the API, sign for guardians, fund
visitors automatically, or run a prearranged recovery. The old server-custodied 7702 runner and
in-memory recovery coordinator have been removed from the API.

## User flow

1. Create an EOA in the browser, or import a testnet-only private key locally. Save the encrypted
   backup. The browser stores a password-encrypted vault in IndexedDB; no key/password/vault is
   uploaded to the API. Passwords use PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM with fresh
   salts/nonces and address-bound associated data. An unlocked key is held only in the browser
   session and is discarded on close or after five idle minutes.
2. Fund that exact address with Sepolia ETH using a faucet or another wallet. The normal wallet
   can send ETH before enrollment, paying its own network fee.
3. Choose one to three distinct guardians, by address or a name resolved independently on
   Sepolia. Review the majority threshold and three-minute waiting period. The EOA signs an
   EIP-7702 authorization and a separate, fully bound enrollment. A gas sponsor relays the
   transaction. Address, balance and history stay at the EOA.
4. After losing access, open the original address and connect/unlock a DIFFERENT replacement
   wallet. It signs the recovery request. The API publishes the request on Arkiv Rabdi and
   returns a shareable request link that binds the digest.
5. Each guardian opens that link or their approval inbox and signs the SAME recovery digest
   with their own wallet. Guardians need neither Voxy enrollment nor ETH to sign an approval.
   The operator relays the signature into an explicitly relay-owned Arkiv entity; the recovered
   EIP-712 signer, not the entity publisher, authenticates the guardian. Quorum is assembled
   from actual Arkiv readback and rechecked against the live ENS roster.
6. A valid quorum starts the actual on-chain three-minute waiting period. Finalization adds the
   replacement controller at the SAME account. No funds move during recovery.
7. The replacement controller reviews and signs a separate transfer. The sponsor can relay that
   exact action, but cannot choose a different recipient/value. A MetaMask controller may move
   the original EOA's ETH into its own address and see the real Sepolia balance there.

Controllers can also pause/unpause recovery, cancel a pending request, and change/renew the
ENS guardians. One-year guardian expiry is shown in the wallet. An invalidated pending request
can be replaced by a quorum for the new roster without permanently blocking the account.

## Contracts and signing boundary

`VoxyEnsRoster` creates one genuine ENSv2 UserRegistry proxy for EACH calling account through
the manifest's VerifiableFactory and UserRegistry implementation. Guardian subnames are
non-transferable, expiring ENS slots. No operator can edit another account's roster: account
execution calls the source as that EOA. The contract exposes the threshold through the standard
text-record read shape and reads active ENS slots every time recovery is checked.

`VoxyRecoveryAccount` is the shared EIP-7702 implementation. It uses a dedicated storage namespace,
owner-signed initial enrollment, low-s ECDSA, per-request replay protection, owner epochs,
roster-bound recovery and nonce/deadline-bound controller execution. Enrollment binds the
account, implementation, all guardian addresses, threshold, expiry and delay. A relayer cannot
front-run the bare delegation authorization with its own guardian configuration. Recovery
checks the live roster again at finalization; freezing/cancellation invalidates pending recovery.

The browser pins the reviewed implementation/source/code hashes in `wallet/deployment.js`,
checks their bytecode through its public RPC, and constructs signing domains/types locally.
Enrollment fields and execution calldata hashes must match the human's chosen action. It does
not blindly sign typed data supplied by the API. Request links bind the recovery digest.

Existing prototype `VoxyDelegate` deployments are not overwritten or silently migrated. Their
first-call configuration rule was too permissive for the new enrollment path. The new deployment
manifest is separate: `deployments/eoa-sepolia.json`. Existing smart-account contracts, SDKs and
historical evidence remain in the repository, but are not the new web wallet's runtime path.

## Persistence, sponsorship and failure handling

- Account configuration, guardians, controller permissions, epochs, pending recovery and balances
  are on Sepolia. Browser storage is never an account directory or source of recovery authority.
- Public request/approval payloads are immutable, publisher-scoped Arkiv v2 entities, separate from
  the ordinary wallet's nine-field digest schemas. Approvals use the request's actual native
  expiry. Records are signature-verified and must match the current chain state. Expiry or
  network failures are failures, not empty or successful responses. Requests normally last 24 hours.
- SQLite under `VOXY_STATE_DIR` persists local lookup indexes, signatures, operation IDs, rate
  limits and conservative gas reservations. WAL and full synchronous commits are enabled.
  Requests can also be rediscovered from Arkiv if the index is lost. An on-chain pending or
  completed recovery remains authoritative after the coordination entity expires.
- Signed sponsor transactions and their exact hashes are committed BEFORE a single admitted
  broadcast. A lost response is reconciled by its original receipt. Duplicate/conflicting
  operations do not silently allocate a new nonce or transfer funds twice. Sponsor nonces are
  checked at latest AND pending. A filesystem lock enforces exclusive local writer custody.
- Native user-paid sends record signed bytes in the browser before broadcasting. There is no
  automatic replacement after an uncertain response.
- Per-IP attempt limits and persisted Sepolia/Arkiv spending reservations bound public API use.
  Defaults: 0.005 ETH maximum per sponsored transaction, 0.05 ETH per UTC admission day, and
  0.1 tGLM per admission day (each Arkiv write also has the existing 0.01 tGLM cap).
- Deploy one API writer with exclusive sponsor keys and a durable, backed-up disk for
  `VOXY_STATE_DIR`. An ephemeral/serverless filesystem is not adequate. Multiple replicas with
  separate disks are not supported. An interrupted signer lock or uncertain native write must
  be reconciled by the operator before new admission; never delete journals just to retry.

## Run and deploy

Node 24, pnpm and Foundry are required. Never put wallet/sponsor/RPC keys into VITE-prefixed
variables. Configure server-only `SEPOLIA_DEPLOYER_PK`, `SEPOLIA_RPC_URL`, `ARKIV_ACCESS_KEY`,
`ARKIV_WRITER_PK`, `ARKIV_WRITER_ADDRESS` and an absolute, persistent `VOXY_STATE_DIR`.
`GUARDIAN_*_PK`, devnet signers and attester keys are NOT used by this flow.

```sh
pnpm install --frozen-lockfile
pnpm eoa:build
pnpm check
pnpm test
pnpm test:api
pnpm test:eoa
pnpm --filter @voxy/web test
pnpm --filter @voxy/web build
pnpm eoa:deploy:plan
```

The plan is read-only. After explicit approval for the concrete Sepolia gas budget:

```sh
pnpm eoa:deploy
pnpm --filter @voxy/api dev
pnpm --filter @voxy/web dev -- --port 5181
```

The deploy script fsyncs signed bytes before broadcast, writes the verified public manifest and
updates the frontend's pinned release addresses/code hashes. An existing manifest or deployment
journal prevents a second deployment. Reconcile an interrupted deployment rather than removing
its journal. Rebuild/redeploy the frontend after updating its pins.

Set `VOXY_WEB_ORIGINS` to your real frontend origin(s) in production. Prefer same-origin `/api`
rewriting; for a split API host, add its exact origin to the web CSP's `connect-src`. Only public
RPC URLs belong in the frontend release pins. Vercel headers prohibit third-party scripts,
framing and object embeds; the API limits origins, body size and caches no wallet state.

`pnpm test:eoa` is isolated chain verification: it forks the actual ENS deployment and runs real
contract calls and EIP-7702 transactions locally, including the full wall-clock waiting period.
It does not use mocked RPC state, storage/code injection or a time warp, and creates no public
entities. It is NOT evidence of public Sepolia admission or real users' extension-wallet approvals.

The separately authorized `pnpm test:eoa:live` uses actual public Sepolia and Rabdi. It creates
independent browser wallet contexts, exports their encrypted backups, funds only one fresh EOA
with 0.0001 Sepolia ETH, enrolls it, closes its signing context, collects actual approvals from
other client-side keys, waits, and transfers the funds only after the replacement controller
signs. Test recovery material is kept privately under ignored `.voxy/`; public evidence contains
only addresses, transaction hashes and balances. No existing user's roster or wallet is changed.

## Limits

This release is Sepolia-only and not externally audited. Do not use it for real assets.
EIP-7702 recovers key LOSS: the original raw EOA key stays authoritative and can remove the
delegation. It does not revoke a stolen key. A web wallet also trusts its served JavaScript and
its device while unlocked. Keep the encrypted backup independently; an app domain or a cleared
browser must not be your only copy. Guardian expirations require renewal before they lapse.
A three-minute waiting period is deliberately short for Sepolia testing, not a mainnet policy.
