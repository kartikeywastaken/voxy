import assert from "node:assert/strict";
import test from "node:test";
import { parseRecovery, recoveryHash, signDigest } from "@voxy/frame-sdk";
import { stringToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseRequestRow, verifyApprovalRow } from "./coordination.js";

const guardian = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const message = parseRecovery({
  chainId: "1337",
  wallet: other.address,
  newKey: guardian.address,
  ownerEpoch: "0",
  rosterEpoch: "1",
  rosterHash: `0x${"ab".repeat(32)}`,
  deadline: "2000000000",
  requestId: `0x${"cd".repeat(32)}`,
  callHash: `0x${"ef".repeat(32)}`,
});
const metadata = {
  $key: `0x${"11".repeat(32)}`,
  $owner: guardian.address,
  $creator: guardian.address,
  $expiresAt: 1000n,
  $creationFlags: { readonly: true, permissionlessExtension: false },
};
const encode = (value: unknown) =>
  stringToHex(
    JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
const requestRow = {
  project: { value: "voxy" },
  type: { value: "recovery-request" },
  ...metadata,
  account: { value: message.wallet },
  requestId: { value: message.requestId },
  rosterEpoch: { value: 1n },
  deadline: { value: message.deadline },
  status: { value: "pending" },
  payload: { value: encode({ ...message, digest: recoveryHash(message) }) },
};

test("request decoding rejects mismatched indexed attributes and substituted signing data", () => {
  assert.equal(parseRequestRow(requestRow).digest, recoveryHash(message));
  assert.throws(
    () => parseRequestRow({ ...requestRow, account: { value: guardian.address } }),
    /disagree/,
  );
  assert.throws(
    () =>
      parseRequestRow({
        ...requestRow,
        payload: {
          value: encode({ ...message, newKey: other.address, digest: recoveryHash(message) }),
        },
      }),
    /disagree/,
  );
  assert.throws(() => parseRequestRow({ ...requestRow, payload: { value: "0xff" } }));
});

test("signature alone cannot impersonate the entity creator, transferred owner or active roster", async () => {
  const signature = await signDigest(guardian, message);
  const row = {
    project: { value: "voxy" },
    type: { value: "guardian-approval" },
    ...metadata,
    guardian: { value: guardian.address },
    requestId: { value: message.requestId },
    deadline: { value: message.deadline },
    ens: { value: "unverified-label.eth" },
    payload: { value: encode({ signature }) },
  };
  const request = parseRequestRow(requestRow);
  const active = new Set([guardian.address]);
  assert.equal((await verifyApprovalRow(row, request, active)).guardian, guardian.address);
  await assert.rejects(verifyApprovalRow({ ...row, $creator: other.address }, request, active));
  await assert.rejects(verifyApprovalRow({ ...row, $owner: other.address }, request, active));
  await assert.rejects(verifyApprovalRow(row, request, new Set()));
  await assert.rejects(verifyApprovalRow({ ...row, $expiresAt: 1001n }, request, active));
  await assert.rejects(
    verifyApprovalRow(
      { ...row, payload: { value: encode({ signature: await signDigest(other, message) }) } },
      request,
      active,
    ),
  );
});
