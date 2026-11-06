# Arkiv friction

## 2026-11-06: writer has no gas funds

Reproduce: `pnpm arkiv:status` after filling the server environment.

Observed live: chain ID 7794095, block 279096; writer
`0x3915753836031a63B6462310f511B4F0E660Ff47`, balance `0` wei tGLM.
The chain and access-key read succeeded. This is a funding blocker, not a successful write.
Fund the writer at https://hub.arkiv.network/faucet, then run `pnpm arkiv:first-write`.

## Native expiry differs from a Unix recovery deadline

SDK 1.0.1 expresses `$expiresAt` as a block height. Its Date conversion uses nominal block time;
it cannot prove expiry at an exact wall-clock deadline. Keep signed Unix deadlines in indexed
u64 columns and reject elapsed deadlines independently. Record native expiry from the receipt.
This finding comes from installed SDK source, not a measured expiry test.

## Environment and tool setup

The root manifest's `workspaces` property alone is insufficient for pnpm; added
`pnpm-workspace.yaml`. Package-registry and RPC access required network permission in this
workspace. Transport errors are suppressed because access keys occur in RPC URL paths.
