---
name: arkiv-app-integration
description: Integrate SDK 1.0.x into authenticated server APIs, read proxies, injected-wallet apps and event-driven caches on Rabdi. Use indexing for persistent projections and lifecycle for entity operations.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Arkiv application integration

Choose the signing boundary before adding endpoints. Target SDK 1.0.x on Rabdi. An RPC access key neither authorizes app users nor pays transaction gas. Read the installed declarations before generating code.

## Server boundary

- Configure `rabdi({ accessKey })` with a server-side `ARKIV_ACCESS_KEY`. The SDK puts the key in the RPC URL path. Keep operator keys out of `NEXT_PUBLIC_*`, browser bundles, logs and returned errors; app reads use bounded server endpoints. Browser-wallet users configure their own RPC credentials.
- Authenticate the session, authorize the exact operation, validate CSRF for cookie writes, apply an attempt limit, stream-bound and validate input, then apply the write budget. Prove denial paths never invoke the writer.
- A shared signer owns/creates the entities. Derive app-user identity from the session and enforce app access server-side; a public user_id column is not authorization.
- Bind a stable operation ID to normalized input, chain/reset identity and signer in a durable registry. Conflicting input returns a conflict. Serialize all writers sharing that signer across processes. Fsync intent and signed bytes/hash before broadcast; return original phase/key/hash after timeouts instead of starting a new create.
- A read proxy allowlists filters, fields and ordering, bounds pages/bytes and rate limits callers. Do not expose arbitrary credentialed JSON-RPC. Preserve upstream failures as failures, never empty successes.
- Use client `cacheTime: 0`, uncached head requests and `http(undefined, { fetchOptions: { cache: 'no-store', redirect: 'error' } })` for fresh server reads. Inspect route, service worker, app and CDN caches separately.
- Return validated narrow DTOs, attach actual `$key` after parsing and convert bigint fields to decimal strings. Bytes columns decode as hex; use explicit UTF-8/JSON decoding and schema validation.

Read [server-boundary](references/server-boundary.md) for the endpoint contract and DTO seam. Supply actual authentication, transactional persistence and attempt/write limits; an in-memory map or fresh create on every callback is not crash recovery.

## Wallet connection

Use an explicit connected EOA account and verify Rabdi `7794095` (`0x76edaf`) before signing. For an unknown chain, add its definition with the user's own access-key URL and `https://rabdi.explorer.arkiv.network`. Read [browser-wallet](references/browser-wallet.md). Wallet network configuration does not authenticate an app session.

Recheck account/chain before each write. On accountsChanged, chainChanged or disconnect, clear pending UI state, switch cache scope and ignore stale asynchronous responses. Remove only listeners registered by the component. A client created for an old address does not automatically follow changes. For installed wagmi/React integrations, inspect their actual exports and call hooks unconditionally in components/custom hooks before gating values.

## Live cache behavior

SDK events are EntityCreated, EntityPatched, ExpiryExtended, OwnershipTransferred and EntityDeleted. They carry operation/key context rather than full values. A live tail at head works; the watcher starts on its first poll, so startup intervals need current-state reconciliation. On Rabdi, a watcher more than about 1,000 blocks (~30 min) behind fails on every poll when its range contains an older block with logs; it cannot backfill or catch up across that gap. After any watcher error, stop it, recreate the watcher at head and reconcile current state with a query. Do not split or retry the range. Natural expiration has no event. See [arkiv#283](https://github.com/Arkiv-Network/arkiv/issues/283).

Fetch unknown patched keys because updates can move them into scope. For owner-filtered collections, fetch unknown incoming transfer keys whose newOwner matches; known keys need prior-scope invalidation for any destination. Re-evaluate all schema, creator/publication, namespace, liveness and collection filters before inclusion. Incoming ownership is not trusted authorship.

Use a bounded serial processing queue, catch async failures, mark the cache unhealthy on overflow/disconnect and stop listeners during cleanup. A late active handler also needs a scope token/abort guard. Sweep expiration and reconcile full current scope periodically. Read [realtime](references/realtime.md) and indexing for persistent projections; do not promise historical replay from SDK 1.0.x.

## Verify the whole path

Test authorization/CSRF, invalid and oversized requests, attempt versus write quotas, duplicate/conflicting operation IDs, uncertain receipts and response failures after confirmation without a second create. Verify creator/readonly policy, malformed bytes/JSON, exact bigint DTOs, wallet rejection, account/chain changes, unknown patched/transfer-in membership and listener cleanup. Trace current RPC → API → DOM and every intervening cache; deterministic fixtures do not certify actual wallets, persistence or provider limits.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
