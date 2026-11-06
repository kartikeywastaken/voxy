# Arkiv friction

## 2026-11-06: writer has no gas funds

Reproduce: `pnpm arkiv:status` after filling the server environment.

Observed live: chain ID 7794095, block 279096; writer
`0x3915753836031a63B6462310f511B4F0E660Ff47`, balance `0` wei tGLM.
The chain and access-key read succeeded. This is a funding blocker, not a successful write.
Fund the writer at https://hub.arkiv.network/faucet, then run `pnpm arkiv:first-write`.

Resolved: a subsequent live check returned 10 tGLM. The real probe transaction
`0xa2be2bef11ca1d5e286e193a9e2f281336d49efaee75c8cdc4fe3c11822a7c4e` succeeded and its
payload/metadata readback matched. Its native expiry was block 281157.

## Native expiry differs from a Unix recovery deadline

SDK 1.0.1 expresses `$expiresAt` as a block height. Its Date conversion uses nominal block time;
it cannot prove expiry at an exact wall-clock deadline. Keep signed Unix deadlines in indexed
u64 columns and reject elapsed deadlines independently. Record native expiry from the receipt.
This finding comes from installed SDK source, not a measured expiry test.

## Environment and tool setup

The root manifest's `workspaces` property alone is insufficient for pnpm; added
`pnpm-workspace.yaml`. Package-registry and RPC access required network permission in this
workspace. Transport errors are suppressed because access keys occur in RPC URL paths.

## 2026-11-06: snapshot provider failure before write admission

The Sepolia observation command encountered `ResourceNotFoundRpcError`. No write journal was
created, so the failure happened before send admission. Do not generalize that finding to errors
after send admission; those must be reconciled from their retained journal and known hash.

Independent Sepolia reads returned the real roster, epoch 1 and matching published hash at block
12075179. An unsigned Arkiv diagnostic succeeded with a 174833 gas estimate for its exact small
diagnostic payload; that estimate is not a measurement of the full snapshot. The live devnet
snapshot path subsequently succeeded as tx
`0xaa1549ce7ab45ec22f5e81ad8b691e753902cc62a5224001bf02dfc5e1d00d74`, using 184595 gas.
The exact root cause of the earlier provider failure remains unconfirmed. No raw keyed URL or
provider diagnostic was published.
