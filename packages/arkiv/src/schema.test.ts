import assert from "node:assert/strict";
import test from "node:test";
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, str, u64 } from "@arkiv-network/sdk/schema";
import { bytes32 } from "./read.js";
import {
  ConnectionChecks,
  encodePayload,
  GuardianApprovals,
  RecoveryRequests,
  RosterSnapshots,
} from "./schema.js";

test("request IDs accept only 32-byte hex and normalize case", () => {
  assert.equal(bytes32(`0x${"AB".repeat(32)}`), `0x${"ab".repeat(32)}`);
  for (const value of ["", "0x", `0x${"aa".repeat(31)}`, `0x${"gg".repeat(32)}`]) {
    assert.throws(() => bytes32(value));
  }
});

test("query fields use indexed SDK types and payloads remain bytes", () => {
  assert.equal(RecoveryRequests.columns.deadline.type, u64().type);
  assert.equal(RecoveryRequests.columns.account.type, addr().type);
  assert.equal(GuardianApprovals.columns.requestId.type, str().type);
  assert.equal(RecoveryRequests.columns.deadline.isIndexed, true);
  assert.equal(RosterSnapshots.columns.epoch.isIndexed, true);
  assert.equal(GuardianApprovals.columns.guardian.isIndexed, true);
  assert.equal(RecoveryRequests.columns.payload.isIndexed, false);
  assert.notEqual(ConnectionChecks.name, RecoveryRequests.name);
});

test("payload is explicit UTF-8 JSON and native lifetime is a block duration", () => {
  const value = { purpose: "Connectivity check", chainId: 7794095 };
  assert.deepEqual(JSON.parse(new TextDecoder().decode(encodePayload(value))), value);
  assert.equal(ExpirationTime.fromMinutes(10).minLifetime, 300n);
  assert.throws(() => u64(-1n));
  assert.throws(() => u64(2n ** 64n));
});
