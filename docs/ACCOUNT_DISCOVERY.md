# Account discovery and personal guardian setup

The connected address and the recovery account are different addresses. The console's create
flow deploys a `VoxyWallet` owned by the connected address; it does not delegate or protect that
address's existing EOA. Assets in the EOA remain outside this smart account's recovery policy.

## Persistence

`OwnerAdded` events, deployed wallet bytecode, `isOwner`, and the configured `RosterRegistry`
provide the account directory. The API rebuilds the owner's account list from chain history,
including wallets created before the discovery fix and additional owners installed by recovery.
A bytecode template with the compiler's immutable offsets excludes unrelated event emitters.
RPC errors fail the lookup rather than being treated as an account without recovery.

Creation checks this directory before deploying. Sponsored API operations run in one signer
queue, and creation refuses to submit while the sponsor has an unresolved pending nonce.
Run one API writer process per set of sponsor keys; this queue does not coordinate replicas.
The small devnet is scanned in 2,000-block RPC pages. A persistent event index is appropriate
when history grows; chain state must remain the authority for ownership and account validity.
The URL's `voxy` parameter only identifies the account/owner to load after refresh. No browser
storage contains the account directory or guardian settings. Devnet resets can still erase
chain state; this is not production persistence.

## Guardians

New accounts begin with no guardians. Each personal account's first guardian save deploys its
own ENSv2 UserRegistry proxy through the manifest's VerifiableFactory, with its own threshold
text-record node, and configures the RosterPublisher for that account. Reads and attestations
use this account's source rather than the demo roster. Account creation and setup are separate,
so a failed setup can be resumed without deploying another recovery account.

Older personal accounts that point at the shared demo UserRegistry are marked in the UI.
Their editor starts empty. The owner must choose and sign their desired guardians once to
migrate to a separate namespace; the old on-chain roster is displayed honestly until then.
No existing guardian roster is silently cleared. A failure before the publisher configuration
is confirmed can leave an unused ENS proxy; retry may deploy another proxy. After configuration,
the on-chain pointer is reused, changed slots are reconciled, and an incomplete sync is retried
even when the source entries already match.

The API verifies an owner signature over the exact requested guardian inputs, account, chain,
previous source roster hash and registry, with a five-minute authorization deadline. Duplicate
resolved guardian addresses and zero-address entries are rejected. This improves API-level
authorization; it does not change the existing contracts' trust model: the publisher's
`configure` function is permissionless, source administration is sponsored/server-held, and
devnet synchronization trusts two attesters. These contracts are still experimental.

## Recovery

Every API action receives the selected recovery account. Server-held demo guardian keys are
used only for the demo. Personal accounts use the existing EIP-712 digest and assembler: create
or paste a shared JSON request, have the active guardians sign it in their own wallets, collect
the signatures, and submit the quorum. Requests and signatures are portable artifacts; keep
copies to resume collection after refresh or share between devices. This console path does not
automatically publish approval collection to Arkiv. The existing Arkiv and sovereign CLI paths
remain available; account discovery does not depend on expiring Arkiv entities.

The replacement owner needs no Voxy account. Guardians need no Voxy account or ENS name, but
must be active members of this account's roster and control the signing keys. Distinct guardian
signatures count toward quorum. Finalization adds an owner after the wallet's on-chain delay;
it does not remove the original owner. Personal-account cancellation is submitted by the
connected owner, not by the sponsor pretending to be an owner.

## Verification

- `pnpm check` includes the API, which was previously omitted from TypeScript checking.
- `pnpm test` runs the existing package tests.
- `pnpm test:api` builds the ordinary wallet contracts and runs account discovery, a fresh-process
  lookup, repeat-create reuse, signature/quorum and selected-account recovery tests on isolated
  Anvil. No public-chain writes, code injection or storage injection are used.
- `pnpm --filter @voxy/web test` and `pnpm --filter @voxy/web build` verify the web package.
- `pnpm test:ens` additionally requires access to the public Sepolia RPC. It forks the real ENSv2
  factory and implementation into local Anvil, deploys isolated Voxy contracts, and checks empty
  initial guardians, owner authorization, separate namespaces/thresholds, cross-chain sync,
  no-op retries and stale-authorization rejection. Its upstream proxy rejects write RPCs; all
  transactions target loopback. It uses fresh guardian keys and the public Anvil sponsor key.
