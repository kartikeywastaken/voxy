import {
  findEOARequests,
  publishEOAApproval,
  publishEOARequest,
  readEOAApprovals,
} from "@voxy/arkiv";
import {
  type Address,
  address,
  eoaRecoveryHash,
  type Hex,
  hex,
  parseEOARecovery,
  recoveryTypedData,
  stringify,
} from "@voxy/chain";
import { recoverTypedDataAddress } from "viem";
import {
  accountState,
  browserTypedData,
  liveRecovery,
  submitEOARecovery,
  verifiedSignatures,
} from "./eoa-chain.js";
import { operationStatus } from "./eoa-sponsor.js";
import { eoaDB, reserveArkiv, saveRequest, storedRequest } from "./eoa-store.js";

async function loadRequest(id: string) {
  hex(id, 32);
  let local: ReturnType<typeof storedRequest>;
  try {
    local = storedRequest(id);
  } catch {
    const found = await findEOARequests({ id });
    if (!found.complete || found.requests.length !== 1)
      throw new Error("Recovery request was not found or its publication is ambiguous");
    const req = found.requests[0]!;
    local = saveRequest({
      id: req.message.requestId,
      account: req.message.account,
      controller: req.message.newController,
      message: req.message,
      guardians: req.guardians,
      deadline: Number(req.message.deadline),
    });
    eoaDB().prepare("UPDATE eoa_requests SET arkiv_key=? WHERE id=?").run(req.entityKey, id);
    local.arkivKey = req.entityKey;
  }
  return local;
}
export async function createRecoveryRequest(input: Record<string, unknown>) {
  const message = parseEOARecovery(input.message);
  const proof = hex(input.proof, 65);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (
    message.deadline <= now ||
    message.deadline > now + 86400n ||
    (await recoverTypedDataAddress({ ...recoveryTypedData(message), signature: proof })) !==
      message.newController
  )
    throw new Error("Replacement controller must sign an unexpired recovery request");
  const state = await liveRecovery(message);
  if (state.pending && !state.pending.invalidated)
    throw new Error("This account already has a pending recovery");
  const saved = saveRequest({
    id: message.requestId,
    account: message.account,
    controller: message.newController,
    message,
    guardians: [...state.guardians],
    deadline: Number(message.deadline),
  });
  if (!saved.arkivKey) {
    reserveArkiv(`request-${message.requestId}`);
    const published = await publishEOARequest(message, proof, state.guardians);
    eoaDB()
      .prepare("UPDATE eoa_requests SET arkiv_key=? WHERE id=?")
      .run(published.entityKey, message.requestId);
  }
  return recoveryStatus(message.requestId);
}
export async function recoveryStatus(id: string) {
  const saved = await loadRequest(id);
  const message = parseEOARecovery(saved.message);
  const state = await accountState(message.account, message.newController);
  const txRow = eoaDB().prepare("SELECT id FROM eoa_operations WHERE id=?").get(`recover-${id}`);
  const operation = txRow ? await operationStatus(String(txRow.id)) : undefined;
  const base = {
    id,
    account: message.account,
    newController: message.newController,
    deadline: Number(message.deadline),
    typedData: browserTypedData(recoveryTypedData(message)),
    created: saved.created,
    guardians: saved.guardians,
    threshold: state.configured ? state.threshold : 0,
    approved: 0,
    signers: [] as string[],
    operation,
    pending: state.configured ? state.pending : null,
    finalized: state.configured && state.controls === true,
    arkivKey: saved.arkivKey,
    complete: true,
    phase: "awaiting-approvals",
  };
  if (base.finalized) return { ...base, phase: "recovered" };
  if (state.configured && state.pending?.requestId === id && !state.pending.invalidated)
    return {
      ...base,
      phase: state.timestamp >= state.pending.readyAt ? "ready" : "waiting-period",
    };
  if (
    !state.configured ||
    state.frozen ||
    state.ownerEpoch !== message.ownerEpoch.toString() ||
    state.rosterHash !== message.rosterHash ||
    message.deadline <= BigInt(state.timestamp)
  )
    return { ...base, phase: "invalidated" };
  if (!saved.arkivKey) {
    const found = await findEOARequests({ id });
    if (!found.complete || found.requests.length > 1)
      throw new Error("Ambiguous recovery publication");
    if (!found.requests.length) return { ...base, phase: "publishing" };
    eoaDB()
      .prepare("UPDATE eoa_requests SET arkiv_key=? WHERE id=?")
      .run(found.requests[0]!.entityKey, id);
    saved.arkivKey = found.requests[0]!.entityKey;
  }
  const published = await readEOAApprovals(saved.arkivKey as Hex);
  if (eoaRecoveryHash(published.request.message) !== eoaRecoveryHash(message))
    throw new Error("Published request does not match the saved recovery");
  const checked = await verifiedSignatures(
    message,
    published.approvals.map((a) => a.signature),
  );
  const approved = checked.approvals.length;
  return {
    ...base,
    arkivKey: saved.arkivKey,
    complete: published.complete,
    approved,
    signers: checked.approvals.map((a) => a.guardian),
    phase:
      operation?.phase === "submitting"
        ? "submitting"
        : published.complete && approved >= state.threshold
          ? "quorum-ready"
          : "awaiting-approvals",
  };
}
export async function approveEOARequest(id: string, signature: Hex) {
  const saved = await loadRequest(id);
  const message = parseEOARecovery(saved.message);
  const { approvals } = await verifiedSignatures(message, [signature]);
  if (!saved.arkivKey) throw new Error("Wait for the request to finish publishing");
  const guardian = approvals[0]!.guardian;
  const db = eoaDB();
  db.prepare(
    "INSERT OR IGNORE INTO eoa_approvals(request_id,guardian,signature) VALUES(?,?,?)",
  ).run(id, guardian, signature);
  const row = db
    .prepare("SELECT signature,arkiv_key FROM eoa_approvals WHERE request_id=? AND guardian=?")
    .get(id, guardian)!;
  if (!row.arkiv_key) {
    reserveArkiv(`approval-${id}-${guardian}`);
    const published = await publishEOAApproval(
      saved.arkivKey as Hex,
      guardian,
      String(row.signature) as Hex,
    );
    db.prepare("UPDATE eoa_approvals SET arkiv_key=? WHERE request_id=? AND guardian=?").run(
      published.entityKey,
      id,
      guardian,
    );
  }
  const status = await recoveryStatus(id);
  if (status.phase === "quorum-ready") await submitPublishedRecovery(id);
  return recoveryStatus(id);
}
export async function submitPublishedRecovery(id: string) {
  const saved = await loadRequest(id);
  if (!saved.arkivKey) throw new Error("Request is not published yet");
  const readback = await readEOAApprovals(saved.arkivKey as Hex);
  if (!readback.complete) throw new Error("Approval scan is incomplete; quorum cannot be claimed");
  return submitEOARecovery(
    readback.request.message,
    readback.approvals.map((a) => a.signature),
  );
}
export async function requestsFor(input: { account?: Address; guardian?: Address }) {
  const found = await findEOARequests(input);
  const requests = [];
  for (const req of found.requests) {
    if (!eoaDB().prepare("SELECT id FROM eoa_requests WHERE id=?").get(req.message.requestId)) {
      saveRequest({
        id: req.message.requestId,
        account: req.message.account,
        controller: req.message.newController,
        message: req.message,
        guardians: req.guardians,
        deadline: Number(req.message.deadline),
      });
      eoaDB()
        .prepare("UPDATE eoa_requests SET arkiv_key=? WHERE id=?")
        .run(req.entityKey, req.message.requestId);
    }
    const status = await recoveryStatus(req.message.requestId);
    if (status.phase !== "invalidated" && status.phase !== "recovered") requests.push(status);
  }
  return { requests, complete: found.complete };
}
