import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExpirationTime } from "@arkiv-network/sdk";
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk/entity";
import { and, asc, eq, gt, or } from "@arkiv-network/sdk/query";
import { addr, bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import {
  type EOARecovery,
  eoaRecoveryHash,
  type Hex,
  hex,
  parseEOARecovery,
  recoveryTypedData,
  stringify,
} from "@voxy/chain";
import {
  getAddress,
  hexToBytes,
  keccak256,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  recoverTypedDataAddress,
} from "viem";
import { arkivClients } from "./client.js";
import { writerAccount } from "./env.js";
import { createRecord } from "./write.js";

export const EOARequests = defineSchema("voxy_eoa_request_v2", {
  project: str().indexed(),
  chain_id: u64().indexed(),
  request_id: str().indexed(),
  account: addr().indexed(),
  controller: addr().indexed(),
  guardian0: addr().indexed(),
  guardian1: addr().indexed(),
  guardian2: addr().indexed(),
  deadline: u64().indexed(),
  payload: bytes(),
});
// These are explicitly relay-owned records, authenticated by the guardian's EIP-712 signature.
export const EOAApprovals = defineSchema("voxy_eoa_relayed_approval_v2", {
  project: str().indexed(),
  request_id: str().indexed(),
  guardian: addr().indexed(),
  deadline: u64().indexed(),
  payload: bytes(),
});
const encoder = new TextEncoder();
const zero = "0x0000000000000000000000000000000000000000";
function cell(row: Record<string, unknown>, name: string) {
  return (row[name] as { value: unknown }).value;
}
function trusted(row: Record<string, unknown>) {
  const writer = writerAccount().address;
  const flags = row.$creationFlags as { readonly: boolean; permissionlessExtension: boolean };
  if (
    String(row.$creator).toLowerCase() !== writer.toLowerCase() ||
    String(row.$owner).toLowerCase() !== writer.toLowerCase() ||
    !flags.readonly ||
    flags.permissionlessExtension ||
    cell(row, "project") !== "voxy"
  )
    throw new Error("Untrusted recovery coordination record");
}
function payload(row: Record<string, unknown>) {
  const raw = cell(row, "payload");
  if (typeof raw !== "string" || raw.length > 32768)
    throw new Error("Invalid coordination payload");
  return JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(hexToBytes(raw as Hex)),
  ) as Record<string, unknown>;
}

/** Recover a known admitted create from its signed bytes and native receipt, never by resending. */
async function priorEntity(operationId: string, expectedSchema: string, values: unknown) {
  const writer = writerAccount();
  const dir = resolve(
    process.env.VOXY_STATE_DIR || fileURLToPath(new URL("../../../.voxy/", import.meta.url)),
  );
  const prior = await readFile(
    resolve(dir, `${writer.address.toLowerCase()}-${operationId}.jsonl`),
    "utf8",
  ).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  if (!prior) return undefined;
  const lines = prior
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const plan = lines.find((line) => line.phase === "prepared");
  const sent = lines.find((line) => line.phase === "submitting");
  if (
    !plan ||
    plan.schema !== expectedSchema ||
    plan.signer !== writer.address.toLowerCase() ||
    plan.chainId !== 7794095 ||
    stringify(plan.values) !== stringify(values)
  )
    throw new Error("Prior Arkiv intent conflicts; operator reconciliation required");
  if (
    !sent?.raw ||
    keccak256(sent.raw) !== sent.txHash ||
    (await recoverTransactionAddress({ serializedTransaction: sent.raw })) !== writer.address
  )
    throw new Error(
      "Prior Arkiv intent is unsigned or uncertain; reconcile it before creating another entity",
    );
  const transaction = parseTransaction(sent.raw);
  if (
    transaction.chainId !== 7794095 ||
    transaction.to?.toLowerCase() !== "0x4400000000000000000000000000000000000044" ||
    transaction.nonce !== plan.nonce
  )
    throw new Error("Invalid admitted Arkiv transaction");
  const { reader } = arkivClients();
  const receipt = await reader.getTransactionReceipt({ hash: sent.txHash });
  const block = await reader.getBlock({ blockNumber: receipt.blockNumber });
  if (receipt.status !== "success" || block.hash !== receipt.blockHash)
    throw new Error("Prior Arkiv transaction is not canonically confirmed");
  const logs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === "0x4400000000000000000000000000000000000044",
  );
  const creates = parseEventLogs({ abi: ENTITY_EVENTS_ABI, logs, eventName: "EntityCreated" });
  if (creates.length !== 1 || creates[0]!.args.owner !== writer.address)
    throw new Error("Unexpected prior Arkiv create receipt");
  return creates[0]!.args.entityKey;
}

async function parseRequestEntity(row: Record<string, unknown>, key: Hex, head: bigint) {
  trusted(row);
  const body = payload(row);
  const message = parseEOARecovery(body.message);
  const proof = hex(body.proof, 65);
  if (
    cell(row, "chain_id") !== 11155111n ||
    cell(row, "request_id") !== message.requestId ||
    cell(row, "account") !== message.account ||
    cell(row, "controller") !== message.newController ||
    cell(row, "deadline") !== message.deadline ||
    eoaRecoveryHash(message) !== body.digest ||
    (await recoverTypedDataAddress({ ...recoveryTypedData(message), signature: proof })) !==
      message.newController
  )
    throw new Error("Recovery request data or controller proof does not match");
  if (
    BigInt(String(row.$expiresAt)) <= head ||
    message.deadline <= BigInt(Math.floor(Date.now() / 1000))
  )
    throw new Error("Recovery request expired");
  const guardians = [0, 1, 2].map((i) => String(cell(row, `guardian${i}`)));
  return {
    entityKey: key,
    message,
    guardians,
    proof,
    expiresAt: BigInt(String(row.$expiresAt)),
    created: Number(body.created),
  };
}

export async function readEOARequest(key: Hex) {
  const { reader } = arkivClients();
  const [row, head] = await Promise.all([
    reader.getEntity(key, EOARequests),
    reader.getBlockNumber({ cacheTime: 0 }),
  ]);
  return parseRequestEntity(row as Record<string, unknown>, key, head);
}

export async function publishEOARequest(
  message: EOARecovery,
  proof: Hex,
  guardians: readonly string[],
) {
  const writer = writerAccount();
  if (
    (await recoverTypedDataAddress({ ...recoveryTypedData(message), signature: proof })) !==
    message.newController
  )
    throw new Error("Replacement controller must sign the request");
  const operationId = `eoa-request-${message.requestId.slice(2)}`;
  // created is the signed deadline minus the fixed request lifetime, stable across retry/restart.
  const created = (Number(message.deadline) - 86400) * 1000;
  const values = {
    project: "voxy",
    chain_id: u64(11155111n),
    request_id: message.requestId,
    account: addr(message.account),
    controller: addr(message.newController),
    guardian0: addr(getAddress(guardians[0] || zero)),
    guardian1: addr(getAddress(guardians[1] || zero)),
    guardian2: addr(getAddress(guardians[2] || zero)),
    deadline: u64(message.deadline),
    payload: encoder.encode(
      stringify({ message, proof, digest: eoaRecoveryHash(message), created }),
    ),
  };
  const prior = await priorEntity(operationId, EOARequests.name ?? "voxy_eoa_request_v2", values);
  const key =
    prior ??
    (
      await createRecord(writer, operationId, EOARequests, values, {
        expiration: ExpirationTime.atDate(new Date(Number(message.deadline) * 1000)),
      })
    ).entityKey;
  return readEOARequest(key);
}

export async function publishEOAApproval(requestKey: Hex, guardian: `0x${string}`, signature: Hex) {
  const request = await readEOARequest(requestKey);
  if (
    (await recoverTypedDataAddress({ ...recoveryTypedData(request.message), signature })) !==
    guardian
  )
    throw new Error("Guardian signature mismatch");
  const operationId = `eoa-approval-${request.message.requestId.slice(2, 34)}-${guardian.slice(2)}`;
  const values = {
    project: "voxy",
    request_id: request.message.requestId,
    guardian: addr(guardian),
    deadline: u64(request.message.deadline),
    payload: encoder.encode(stringify({ signature })),
  };
  const prior = await priorEntity(
    operationId,
    EOAApprovals.name ?? "voxy_eoa_relayed_approval_v2",
    values,
  );
  const key =
    prior ??
    (
      await createRecord(writerAccount(), operationId, EOAApprovals, values, {
        expiration: ExpirationTime.atBlock(request.expiresAt),
      })
    ).entityKey;
  const row = (await arkivClients().reader.getEntity(key, EOAApprovals)) as Record<string, unknown>;
  trusted(row);
  if (
    cell(row, "guardian") !== guardian ||
    cell(row, "request_id") !== request.message.requestId ||
    payload(row).signature !== signature
  )
    throw new Error("Approval readback failed");
  return { entityKey: key, signature, guardian };
}

const metadata = {
  $key: true,
  $owner: true,
  $creator: true,
  $creationFlags: true,
  $expiresAt: true,
  project: true,
  payload: true,
} as const;
export async function findEOARequests(input: { id?: string; account?: string; guardian?: string }) {
  const scope = input.id
    ? eq("request_id", hex(input.id, 32))
    : input.account
      ? eq("account", addr(getAddress(input.account)))
      : input.guardian
        ? or(
            eq("guardian0", addr(getAddress(input.guardian))),
            eq("guardian1", addr(getAddress(input.guardian))),
            eq("guardian2", addr(getAddress(input.guardian))),
          )
        : undefined;
  if (!scope) throw new Error("A request, account or guardian filter is required");
  const filters = and(
    eq("project", "voxy"),
    eq("$creator", addr(writerAccount().address)),
    eq("chain_id", u64(11155111n)),
    gt("deadline", u64(BigInt(Math.floor(Date.now() / 1000)))),
    scope,
  );
  const page = await arkivClients()
    .reader.select({
      ...metadata,
      chain_id: true,
      request_id: true,
      account: true,
      controller: true,
      guardian0: true,
      guardian1: true,
      guardian2: true,
      deadline: true,
    })
    .from(EOARequests)
    .where(filters)
    .orderBy(asc("$key"))
    .limit(100)
    .fetch();
  const requests = [];
  const head = await arkivClients().reader.getBlockNumber({ cacheTime: 0 });
  for (const row of page.entities)
    requests.push(await parseRequestEntity(row as Record<string, unknown>, row.$key, head));
  return { requests, complete: page.entities.length < 100 && page.skipped === 0 };
}
export async function readEOAApprovals(requestKey: Hex) {
  const request = await readEOARequest(requestKey);
  const page = await arkivClients()
    .reader.select({ ...metadata, request_id: true, guardian: true, deadline: true })
    .from(EOAApprovals)
    .where(
      and(
        eq("project", "voxy"),
        eq("$creator", addr(writerAccount().address)),
        eq("request_id", request.message.requestId),
        gt("deadline", u64(BigInt(Math.floor(Date.now() / 1000)))),
      ),
    )
    .orderBy(asc("$key"))
    .limit(100)
    .fetch();
  const approvals = new Map<string, { guardian: `0x${string}`; signature: Hex; entityKey: Hex }>();
  for (const row of page.entities) {
    trusted(row as Record<string, unknown>);
    const guardian = getAddress(String(cell(row as Record<string, unknown>, "guardian")));
    const signature = hex(payload(row as Record<string, unknown>).signature, 65);
    if (
      cell(row as Record<string, unknown>, "deadline") !== request.message.deadline ||
      BigInt(String(row.$expiresAt)) !== request.expiresAt ||
      (await recoverTypedDataAddress({ ...recoveryTypedData(request.message), signature })) !==
        guardian
    )
      throw new Error("Approval does not authenticate this guardian and request");
    approvals.set(guardian, { guardian, signature, entityKey: row.$key });
  }
  return {
    request,
    approvals: [...approvals.values()],
    complete: page.entities.length < 100 && page.skipped === 0,
  };
}
