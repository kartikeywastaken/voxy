import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { eoaRecoveryHash } from "@voxy/chain/eoa";
import { enrollmentData, executionData, recoveryData } from "./protocol.js";
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const deadline = () => String(Math.floor(Date.now() / 1000) + 600);

test("wallet signatures reject an API substitution of enrollment, transfer or shared recovery", () => {
  const account = fresh(), implementation = fresh(), guardians = [fresh(), fresh(), fresh()];
  const enrollment = { account, implementation, guardian0: guardians[0], guardian1: guardians[1], guardian2: guardians[2], threshold: 2, delay: "180", expiresAt: String(Math.floor(Date.now() / 1000) + 365 * 86400), deadline: deadline() };
  assert.equal(enrollmentData({ message: enrollment }, account, guardians, implementation).primaryType, "Enrollment");
  assert.throws(() => enrollmentData({ message: { ...enrollment, guardian0: fresh() } }, account, guardians, implementation), /differs/);
  assert.throws(() => enrollmentData({ message: { ...enrollment, implementation: fresh() } }, account, guardians, implementation), /differs/);
  assert.throws(() => enrollmentData({ message: { ...enrollment, delay: "0" } }, account, guardians, implementation), /differs/);
  const calls = [{ to: fresh(), value: 10n, data: "0x" }];
  const type = [{ type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }];
  const execution = { account, callsHash: keccak256(encodeAbiParameters(type, [calls])), nonce: "0", deadline: deadline() };
  assert.equal(executionData({ message: execution, typedData: { primaryType: "Permit" } }, account, calls).primaryType, "Execution");
  assert.throws(() => executionData({ message: execution }, account, [{ ...calls[0], to: fresh() }]), /differ/);
  const request = { chainId: "11155111", account, newController: fresh(), ownerEpoch: "0", rosterHash: generatePrivateKey(), deadline: deadline(), requestId: generatePrivateKey() };
  const canonical = recoveryData(request, account, request.newController);
  const digest = eoaRecoveryHash(canonical.message);
  assert.equal(recoveryData(request, account, request.newController, digest).domain.version, "2");
  assert.throws(() => recoveryData({ ...request, newController: fresh() }, account, undefined, digest), /differs/);
  assert.throws(() => recoveryData({ ...request, chainId: "1" }, account), /differs/);
});
