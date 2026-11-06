import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecoveryDigest } from "@voxy/chain";
import type { Address, Hex } from "viem";
import {
  type Approval,
  decodeApproval,
  decodeRequest,
  encodeApproval,
  encodeRequest,
} from "./blob.js";

const MESSAGE: RecoveryDigest = {
  chainId: 1337n,
  wallet: "0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E" as Address,
  newKey: "0x1111111111111111111111111111111111111111" as Address,
  ownerEpoch: 1n,
  rosterEpoch: 1n,
  rosterHash: "0x63a497e5a622b6f0a06128e7fc8068a9a891fc005dd09ecbf41593c445665320" as Hex,
  deadline: 2000000000n,
  requestId: "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex,
  callHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
};
const SIG = `0x${"ab".repeat(65)}` as Hex;
const APPROVAL: Approval = {
  message: MESSAGE,
  guardian: "0x6d3E1f382A6A059904F9a608eE53efA891a77aC8" as Address,
  signature: SIG,
};

test("approval blob round-trips (voxy1:) with all fields intact", () => {
  const blob = encodeApproval(APPROVAL);
  assert.ok(blob.startsWith("voxy1:"));
  const d = decodeApproval(blob);
  assert.equal(d.message.chainId, MESSAGE.chainId);
  assert.equal(d.message.wallet, MESSAGE.wallet);
  assert.equal(d.message.newKey, MESSAGE.newKey);
  assert.equal(d.message.deadline, MESSAGE.deadline);
  assert.equal(d.message.requestId, MESSAGE.requestId);
  assert.equal(d.guardian, APPROVAL.guardian);
  assert.equal(d.signature, SIG);
});

test("request JSON round-trips", () => {
  const r = decodeRequest(encodeRequest(MESSAGE));
  assert.equal(r.requestId, MESSAGE.requestId);
  assert.equal(r.ownerEpoch, MESSAGE.ownerEpoch);
  assert.equal(r.rosterHash, MESSAGE.rosterHash);
});

test("decodeApproval rejects junk", () => {
  assert.throws(() => decodeApproval("not-a-blob"));
  assert.throws(() => decodeApproval("voxy1:!!!notbase64!!!"));
});

test("encodeApproval rejects a non-65-byte signature", () => {
  assert.throws(() => encodeApproval({ ...APPROVAL, signature: "0x1234" as Hex }));
});
