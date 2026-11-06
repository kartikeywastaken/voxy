import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseRecovery, recoverGuardian, recoveryHash, signDigest } from "./digest.js";

const guardian = privateKeyToAccount(generatePrivateKey());
const newOwner = privateKeyToAccount(generatePrivateKey());
const wallet = privateKeyToAccount(generatePrivateKey());
const message = parseRecovery({
  chainId: "1337",
  wallet: wallet.address,
  newKey: newOwner.address,
  ownerEpoch: "0",
  rosterEpoch: "1",
  rosterHash: `0x${"ab".repeat(32)}`,
  deadline: "2000000000",
  requestId: `0x${"cd".repeat(32)}`,
  callHash: `0x${"ef".repeat(32)}`,
});

test("real EIP-712 signatures bind every recovery field and the signing domain", async () => {
  const signature = await signDigest(guardian, message);
  assert.equal(await recoverGuardian(message, signature), guardian.address);
  const substitutions = [
    { chainId: 1338n },
    { wallet: guardian.address },
    { newKey: wallet.address },
    { ownerEpoch: 1n },
    { rosterEpoch: 2n },
    { rosterHash: `0x${"aa".repeat(32)}` as const },
    { deadline: message.deadline + 1n },
    { requestId: `0x${"bb".repeat(32)}` as const },
    { callHash: `0x${"cc".repeat(32)}` as const },
  ];
  for (const change of substitutions) {
    const modified = { ...message, ...change };
    assert.notEqual(recoveryHash(modified), recoveryHash(message));
    assert.notEqual(await recoverGuardian(modified, signature), guardian.address);
  }
});

test("contract-incompatible v and high-s signatures are rejected", async () => {
  const signature = await signDigest(guardian, message);
  await assert.rejects(recoverGuardian(message, `${signature.slice(0, -2)}00`), /canonical/);
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (n - BigInt(`0x${signature.slice(66, 130)}`)).toString(16).padStart(64, "0");
  const v = signature.endsWith("1b") ? "1c" : "1b";
  await assert.rejects(
    recoverGuardian(message, `${signature.slice(0, 66)}${highS}${v}`),
    /canonical/,
  );
  await assert.rejects(recoverGuardian(message, "0x1234"), /65-byte/);
});

test("JSON boundary rejects lossy numeric fields, overflow and zero new owner", () => {
  assert.throws(() => parseRecovery({ ...message, chainId: 1337 }), /decimal strings/);
  assert.throws(() => parseRecovery({ ...message, ownerEpoch: 2n ** 64n }), /out of range/);
  assert.throws(() => parseRecovery({ ...message, deadline: "-1" }), /decimal strings/);
  assert.throws(
    () => parseRecovery({ ...message, newKey: `0x${"00".repeat(20)}` }),
    /Zero address/,
  );
});
