import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import {
  address,
  hash32,
  object,
  parseRecovery,
  readRecoveryState,
  recoverGuardian,
  recoveryHash,
  uint,
} from "@voxy/frame-sdk";
import { type Hex, hexToBytes, type LocalAccount } from "viem";
import { arkivClients } from "./client.js";
import { json } from "./env.js";
import { readApprovals } from "./read.js";
import { encodePayload, GuardianApprovals, RecoveryRequests } from "./schema.js";
import { createRecord } from "./write.js";

function cell(row: Record<string, unknown>, name: string) {
  return object(row[name]).value;
}

function payload(input: unknown) {
  if (typeof input !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(input) || input.length > 262146) {
    throw new Error("Invalid entity payload");
  }
  return object(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(input as Hex))),
  );
}

function metadata(row: Record<string, unknown>) {
  const flags = object(row.$creationFlags);
  if (flags.readonly !== true || flags.permissionlessExtension !== false)
    throw new Error("Unsupported entity flags");
  return {
    entityKey: hash32(row.$key),
    owner: address(row.$owner),
    creator: address(row.$creator),
    expiresAt: uint(row.$expiresAt),
  };
}

export function parseRequestRow(input: unknown) {
  const row = object(input);
  if (cell(row, "project") !== "voxy" || cell(row, "type") !== "recovery-request")
    throw new Error("Unexpected request scope");
  const meta = metadata(row);
  const body = payload(cell(row, "payload"));
  const message = parseRecovery(body);
  const digest = recoveryHash(message);
  if (
    hash32(body.digest) !== digest ||
    address(cell(row, "account")) !== message.wallet ||
    hash32(cell(row, "requestId")) !== message.requestId ||
    uint(cell(row, "rosterEpoch")) !== message.rosterEpoch ||
    uint(cell(row, "deadline")) !== message.deadline ||
    cell(row, "status") !== "pending"
  ) {
    throw new Error("Request attributes and digest disagree");
  }
  return { ...meta, message, digest };
}

export async function readRequest(entityKey: string) {
  const { reader } = arkivClients();
  const row = await reader.getEntity(hash32(entityKey), RecoveryRequests);
  const request = parseRequestRow(row);
  const head = await reader.getBlockNumber({ cacheTime: 0 });
  if (
    request.expiresAt <= head ||
    request.message.deadline <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new Error("Request expired");
  }
  return request;
}

export async function publishRequest(account: LocalAccount, input: unknown, devnetRpcUrl: string) {
  const message = parseRecovery(input);
  await readRecoveryState(devnetRpcUrl, message);
  const deadline = new Date(Number(message.deadline) * 1000);
  if (!Number.isFinite(deadline.getTime()))
    throw new Error("Deadline outside supported date range");
  return createRecord(
    account,
    `request-${message.requestId.slice(2)}`,
    RecoveryRequests,
    {
      project: "voxy",
      type: "recovery-request",
      account: addr(message.wallet),
      requestId: message.requestId,
      rosterEpoch: u64(message.rosterEpoch),
      deadline: u64(message.deadline),
      status: "pending",
      payload: encodePayload(JSON.parse(json({ ...message, digest: recoveryHash(message) }))),
    },
    { expiration: ExpirationTime.atDate(deadline) },
  );
}

export async function publishApproval(
  account: LocalAccount,
  requestKey: string,
  signature: Hex,
  ens: string,
  devnetRpcUrl: string,
) {
  const request = await readRequest(requestKey);
  const guardian = await recoverGuardian(request.message, signature);
  if (guardian !== account.address)
    throw new Error("Approval must be written by its actual guardian signer");
  const state = await readRecoveryState(devnetRpcUrl, request.message);
  if (!state.activeGuardians.has(guardian)) throw new Error("Signer is not an active guardian");
  return createRecord(
    account,
    `approval-${request.message.requestId.slice(2)}`,
    GuardianApprovals,
    {
      project: "voxy",
      type: "guardian-approval",
      requestId: request.message.requestId,
      guardian: addr(guardian),
      ens,
      deadline: u64(request.message.deadline),
      payload: encodePayload({ signature }),
    },
    { expiration: ExpirationTime.atBlock(request.expiresAt) },
  );
}

export async function verifyApprovalRow(
  input: unknown,
  request: Awaited<ReturnType<typeof readRequest>>,
  activeGuardians: ReadonlySet<string>,
) {
  const row = object(input);
  if (cell(row, "project") !== "voxy" || cell(row, "type") !== "guardian-approval")
    throw new Error("Unexpected approval scope");
  const meta = metadata(row);
  const guardian = address(cell(row, "guardian"));
  if (
    hash32(cell(row, "requestId")) !== request.message.requestId ||
    uint(cell(row, "deadline")) !== request.message.deadline ||
    meta.expiresAt !== request.expiresAt ||
    meta.creator !== guardian ||
    meta.owner !== guardian ||
    !activeGuardians.has(guardian)
  ) {
    throw new Error("Approval metadata does not match this recovery");
  }
  const body = payload(cell(row, "payload"));
  const signer = await recoverGuardian(request.message, body.signature);
  if (signer !== guardian) throw new Error("Approval signature does not match its guardian");
  const ens = cell(row, "ens");
  if (typeof ens !== "string") throw new Error("Invalid guardian name");
  // ENS text is a label, not proof of identity. Membership comes from the live registry.
  return { ...meta, guardian, ens, signature: body.signature as Hex };
}

export async function approvalProgress(requestKey: string, devnetRpcUrl: string) {
  const request = await readRequest(requestKey);
  const state = await readRecoveryState(devnetRpcUrl, request.message);
  const accepted = new Map<string, Awaited<ReturnType<typeof verifyApprovalRow>>>();
  let invalid = 0;
  let duplicate = 0;
  let skipped = 0;
  let after: Hex | undefined;
  let complete = false;
  let observedBlock = 0n;
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page = await readApprovals(request.message.requestId, after);
    observedBlock = page.blockNumber;
    skipped += page.skipped;
    for (const row of page.entities) {
      try {
        const approval = await verifyApprovalRow(row, request, state.activeGuardians);
        if (accepted.has(approval.guardian)) duplicate++;
        else accepted.set(approval.guardian, approval);
      } catch {
        invalid++;
      }
    }
    if (page.entities.length + page.skipped < 100) {
      complete = true;
      break;
    }
    // A full schema-mismatch page offers no safe key boundary; disclose incompleteness.
    if (page.skipped > 0) break;
    after = page.entities.at(-1)?.$key;
    if (!after) break;
  }
  // Recheck after the scan. Pages are current observations, not an atomic snapshot.
  await readRequest(requestKey);
  const fresh = await readRecoveryState(devnetRpcUrl, request.message);
  const approvals = [...accepted.values()].filter((item) =>
    fresh.activeGuardians.has(item.guardian),
  );
  return {
    request,
    approvals,
    approved: approvals.length,
    threshold: fresh.roster.threshold,
    quorum: complete && approvals.length >= fresh.roster.threshold,
    complete,
    invalid,
    duplicate,
    skipped,
    arkivBlock: observedBlock,
    devnetBlock: fresh.blockNumber,
    devnetBlockHash: fresh.blockHash,
  };
}
