# Why Arkiv

Recovery participants need a shared coordination channel that an independent assembler can read.
Arkiv supplies public, queryable, wallet-owned entities with native bounded retention. The intended
product reads are guardian approval progress, owner alerts and assembly inputs, rather than an
append-only audit log.

ENS and the devnet registry remain roster authorities. Arkiv data is untrusted until clients and
contracts verify signatures, membership, epochs and deadlines. Guardians publish using their own
wallets so the operator cannot edit their approval entities. Wallet keys stay outside entity data.

Current evidence includes a funded probe write/readback, a real devnet roster observation persisted
on Rabdi, and a successful live owner-watcher refresh. Request/approval writers and verified progress
are implemented; the full product recovery flow through those writers is not yet verified.
