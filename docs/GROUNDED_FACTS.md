# Grounded facts (pulled from source, not guessed)

Resolves several `[U]` items in the bible. Source: `ensdomains/contracts-v2` cloned to
`reference/ens-v2/` (gitignored). Re-pull with the deploy JSONs under
`reference/ens-v2/contracts/deployments/sepolia/` if addresses change.

## ENSv2 Sepolia addresses (verified in-repo)

| Contract | Address |
|---|---|
| ETHRegistry | `0x67b728a792e789a8978b30cf1b3b641f19354b43` |
| ETHRegistrar | `0xa4449a0dd2b83007553d9b1d28b583a46a805a30` |
| RootRegistry | `0x11b5bfbe9078d826b1edbdd1cfc12f5828d9f50c` |
| VerifiableFactory | `0x118bc31a50d559f7015a8da26d54b3b030cdb70f` |
| UserRegistryImpl | `0x840fa461059862ea466a711e8c98c8de732061c0` |
| PermissionedResolverImpl | `0x7e4b2d59938930168024201752ee5503df402303` |
| UniversalResolverV2 | `0x85edf8b6b7d4211e2b07aa687506b746357b92cf` |
| PublicResolverV2 | `0xd25f66dd4ff61486c2c5c1e6201a23576698d3df` |

Also present (MockUSDC, MockDAI, ReverseRegistrar, migration controllers) — see the deployments dir.

## EAC role constants (from src/registry/libraries/RegistryRolesLib.sol)

Roles are nybble-packed; each role's admin is the same bit shifted `<< 128`.

| Role | Value | Meaning |
|---|---|---|
| ROLE_REGISTRAR | `1 << 0` | register/reserve names (root only) |
| ROLE_UNREGISTER | `1 << 12` | unregister a name (root or token) |
| ROLE_RENEW | `1 << 16` | extend expiry (root or token) |
| ROLE_SET_SUBREGISTRY | `1 << 20` | change a name's child registry |
| ROLE_SET_RESOLVER | `1 << 24` | change a name's resolver |
| ROLE_CAN_TRANSFER_ADMIN | `(1 << 28) << 128` | gate on whether the token owner may transfer |
| ROLE_UPGRADE | `1 << 124` | UUPS upgrade (root only) |

### How this maps to Voxy guardian slots (resolves bible 5.2)
- **Non-transferable slot:** do NOT grant the guardian `ROLE_CAN_TRANSFER` (it is checked on the
  token owner, not the operator). The slot token then cannot be moved by the guardian.
- **Revocable by cold admin:** cold admin holds `ROLE_UNREGISTER` (+ its admin) → can revoke a slot.
- **Guardian editor:** holds `ROLE_SET_SUBREGISTRY` / `ROLE_SET_RESOLVER` to (re)assign slots, but
  not the admin roles, so it cannot grant itself more power.
- **Expiring:** slot subnames carry an expiry; `ROLE_RENEW` controls extension. The publisher must
  treat expired slots as empty (bible 5.3: `latestOwnerOf()` returns an owner even after expiry).

Pin exact modifiers/ABIs from `src/registry/PermissionedRegistry.sol`, `UserRegistry.sol`, and
`src/access-control/` before writing RosterPublisher.

## Key source files to read before building the ENS layer
- `src/registry/UserRegistry.sol`, `PermissionedRegistry.sol`
- `src/registry/libraries/RegistryRolesLib.sol`
- `src/registry/interfaces/IRegistry.sol`, `IPermissionedRegistry.sol`
- `src/access-control/` (EnhancedAccessControl)
- `lib/verifiable-factory/` (CREATE2 deterministic deploy)
- `src/resolver/` (Permissioned resolver, text records for `voxy.*` policy)

## Still unverified (`[U]` — confirm at the event / in docs)
- ENSIP-11 coin type for chain 1337 = `2147484985` (`0x80000000 | 1337`) — confirm the record key.
- Alt-mempool devnet: precompiles (ecrecover) in validation, 100k staked cap, recent-root frames,
  pay-frame/paymaster support. See bible §13 and the workshop issue.
- viem support for frame tx type `0x06`.
