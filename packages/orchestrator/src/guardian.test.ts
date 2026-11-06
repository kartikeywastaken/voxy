import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecoveryDigest } from "@voxy/chain";
import { recoveryDigestTypedData } from "@voxy/chain";
import { type Address, type Hex, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signRecovery } from "./guardian.js";

// A fixed test key (well-known anvil account #0) — only used to round-trip signing locally.
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const WALLET: Address = "0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E";

const message: RecoveryDigest = {
  chainId: 1337n,
  wallet: WALLET,
  newKey: "0x1111111111111111111111111111111111111111",
  ownerEpoch: 0n,
  rosterEpoch: 1n,
  rosterHash: "0x63a497e5a622b6f0a06128e7fc8068a9a891fc005dd09ecbf41593c445665320",
  deadline: 9999999999n,
  requestId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  callHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

test("signRecovery produces a signature that recovers to the guardian (same digest the wallet uses)", async () => {
  const expected = privateKeyToAccount(PK).address;
  const { guardian, signature } = await signRecovery(PK, message);
  assert.equal(guardian, expected);

  const recovered = await recoverTypedDataAddress({
    ...recoveryDigestTypedData(1337, WALLET, message),
    signature,
  });
  assert.equal(recovered, expected);
});

test("a tampered newKey makes the recovered signer differ (binding holds)", async () => {
  const { signature } = await signRecovery(PK, message);
  const recovered = await recoverTypedDataAddress({
    ...recoveryDigestTypedData(1337, WALLET, {
      ...message,
      newKey: "0x2222222222222222222222222222222222222222",
    }),
    signature,
  });
  assert.notEqual(recovered, privateKeyToAccount(PK).address);
});
