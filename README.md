# Voxy

Wallet recovery using an ENSv2 guardian namespace, with approvals coordinated on Arkiv and
cross-chain revocation from Sepolia to an EIP-8141 devnet. Design: [project bible](final_project_bible.md).

This is the `aak` coordination branch. Claude integrates the chain contracts and attesters.
Implementation status and contract handoff issues are in [CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md).
No end-to-end recovery or admitted frame transaction is claimed on this branch yet.

## Run the Arkiv package

Requires Node 24, pnpm 10.30.2, and a local `.env` containing `ARKIV_ACCESS_KEY`,
`ARKIV_WRITER_PK` and optionally `ARKIV_WRITER_ADDRESS` and `ARKIV_CHAIN_ID=7794095`.
Never commit `.env` or expose signing keys/RPC access keys in browser bundles.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm arkiv:status
pnpm arkiv:first-write
pnpm --filter @voxy/arkiv query recovery-request --account "$WALLET"
```

Configured Arkiv writer: `0x3915753836031a63B6462310f511B4F0E660Ff47`.
The funded writer completed a [real probe write/readback](https://rabdi.explorer.arkiv.network/tx/0xa2be2bef11ca1d5e286e193a9e2f281336d49efaee75c8cdc4fe3c11822a7c4e)
and a [live devnet roster snapshot](https://rabdi.explorer.arkiv.network/tx/0xaa1549ce7ab45ec22f5e81ad8b691e753902cc62a5224001bf02dfc5e1d00d74).
The probe was separate from recovery activity and has expired; retain its receipt and journal.
Request/approval writers, signature-verified progress and the polling owner watcher are implemented.
Positive recovery/alert delivery through the new writers remains unverified; web and frame submission
are subsequent work. See [live evidence](artifacts/arkiv/coordination-evidence.json).
Default maximum cost: 0.01 tGLM per write. See [Arkiv usage](arkiv/how-you-use-arkiv.md).

## Testnet funding

- Rabdi tGLM: [Arkiv Hub faucet](https://hub.arkiv.network/faucet).
- Sepolia ETH: [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
  or [Chainlink faucet](https://faucets.chain.link/sepolia).
- Frame devnet ETH (1337): Faucet button at [alt-mempool explorer](https://explorer.altmempool.wtf/),
  as documented by the [official workshop](https://github.com/forshtat/mempool-workshop).

## What this does not claim

Voxy is experimental. It is not production-ready, a trustless cross-chain bridge, or the first
social recovery/ENS guardian system. The planned roster sync trusts 2 of 3 attesters. Guardian
data on Arkiv is public, and expiry cannot retract copies. Testnets may reset. We do not claim
the alt mempool is required, publish gas measurements, or claim a live app until verified.
ENSignv2 is a design reference; no code was copied from it.

## AI usage and licence

Codex assists the coordination package, configuration and documentation; Claude develops the
chain core separately. All claims require actual chain evidence. Project licence: MIT.
