# Verify a first write

Check installed SDK 1.0.x version/declarations first. Deterministic transport tests exercise actual schema encoding and receipt decoding; they cannot prove funding, provider limits or wallet UI.

Before a funded Rabdi test, authorize the dedicated signer, operation and spend budget. Read access/signing keys from a local secret store; never print them or raw transport errors. Confirm chain 7794095, genesis/reset identity, balance and an exact unsigned estimate. Keep a durable intent/signed-hash journal before forwarding a write.

Require successful receipt, returned key, creator/owner, flags, typed column values and observed `$expiresAt`. Query by the schema's indexed application ID and the configured creator. Repeat an idempotent seed and prove zero new signing/broadcasts. A reset or expired seed needs a new identity and dependent-reference repair.

Test denial paths: wrong chain, missing/non-string key, duplicate seed, schema mismatch, bytes filtering, wrong constructor type, missing required field, invalid deadline, insufficient funds and readback failure after confirmation. For that final case retain the hash and repair verification without repeating the create.

The repository's live entrypoint is `node --experimental-vm-modules --test tests/live/live.test.mjs`, using the environment and SDK workspace documented in tests/README.md. Its seed is `node --experimental-vm-modules scripts/seed-rabdi.mjs`. These commands require explicit local secret configuration and never fund another signer.
