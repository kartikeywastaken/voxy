import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { eoaRecoveryHash, parseEOARecovery, recoveryTypedData, stringify } from "./eoa.js";

test("EOA recovery proofs bind the replacement controller, original account and every policy field", async () => {
  const controller = privateKeyToAccount(generatePrivateKey());
  const message = {
    chainId: 11155111n,
    account: privateKeyToAccount(generatePrivateKey()).address,
    newController: controller.address,
    ownerEpoch: 0n,
    rosterHash: generatePrivateKey(),
    deadline: 1900000000n,
    requestId: generatePrivateKey(),
  };
  const proof = await controller.signTypedData(recoveryTypedData(message));
  assert.equal(
    await recoverTypedDataAddress({ ...recoveryTypedData(message), signature: proof }),
    controller.address,
  );
  assert.deepEqual(parseEOARecovery(JSON.parse(stringify(message))), message);
  for (const field of ["chainId", "ownerEpoch", "deadline"] as const) {
    const changed = { ...message, [field]: message[field] + 1n };
    assert.notEqual(eoaRecoveryHash(changed), eoaRecoveryHash(message));
    assert.notEqual(
      await recoverTypedDataAddress({ ...recoveryTypedData(changed), signature: proof }),
      controller.address,
    );
  }
  const json = JSON.parse(stringify(message));
  assert.throws(() => parseEOARecovery({ ...json, ownerEpoch: 0 }), /decimal strings/);
  assert.throws(() => parseEOARecovery({ ...json, ownerEpoch: (1n << 64n).toString() }), /range/);
  assert.throws(() => parseEOARecovery({ ...json, requestId: "0x12" }), /32 bytes/);
});
