import type { RecoveryDigest } from "@voxy/chain";
import { type Address, getAddress, type Hex, isAddress, isHex } from "viem";

/**
 * Portable, self-contained recovery approval — the "nothing from us" artifact.
 *
 * A guardian signs a RecoveryDigest in their own wallet and gets back a `voxy1:` string (also
 * renderable as a QR). It carries the full request + the signature and NOTHING secret — it can't
 * move a coin on its own. The owner collects these over Signal / email / paper / Arkiv and runs
 * `voxy-recover`. No server, assembler, Arkiv or Voxy domain is required to use it.
 */

const PREFIX = "voxy1:";

export interface Approval {
  message: RecoveryDigest;
  guardian: Address;
  signature: Hex;
}

function messageToJson(m: RecoveryDigest) {
  return {
    chainId: m.chainId.toString(),
    wallet: m.wallet,
    newKey: m.newKey,
    ownerEpoch: m.ownerEpoch.toString(),
    rosterEpoch: m.rosterEpoch.toString(),
    rosterHash: m.rosterHash,
    deadline: m.deadline.toString(),
    requestId: m.requestId,
    callHash: m.callHash,
  };
}

const u = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v)) throw new Error("bad integer field");
  return BigInt(v);
};
const h32 = (v: unknown): Hex => {
  if (typeof v !== "string" || !isHex(v) || v.length !== 66) throw new Error("bad bytes32 field");
  return v.toLowerCase() as Hex;
};
const addr = (v: unknown): Address => {
  if (typeof v !== "string" || !isAddress(v)) throw new Error("bad address field");
  return getAddress(v);
};

export function messageFromJson(o: Record<string, unknown>): RecoveryDigest {
  return {
    chainId: u(o.chainId),
    wallet: addr(o.wallet),
    newKey: addr(o.newKey),
    ownerEpoch: u(o.ownerEpoch),
    rosterEpoch: u(o.rosterEpoch),
    rosterHash: h32(o.rosterHash),
    deadline: u(o.deadline),
    requestId: h32(o.requestId),
    callHash: h32(o.callHash),
  };
}

export function encodeApproval(a: Approval): string {
  if (!isHex(a.signature) || a.signature.length !== 132)
    throw new Error("signature must be 65 bytes");
  const json = JSON.stringify({
    m: messageToJson(a.message),
    g: getAddress(a.guardian),
    s: a.signature,
  });
  return PREFIX + Buffer.from(json, "utf8").toString("base64url");
}

export function decodeApproval(blob: string): Approval {
  const trimmed = blob.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error("not a voxy1: approval");
  const body = trimmed.slice(PREFIX.length);
  const json = Buffer.from(body, "base64url").toString("utf8");
  const o = JSON.parse(json) as { m?: Record<string, unknown>; g?: unknown; s?: unknown };
  if (!o.m || typeof o.m !== "object") throw new Error("missing message");
  const signature = o.s;
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) {
    throw new Error("missing/invalid signature");
  }
  return { message: messageFromJson(o.m), guardian: addr(o.g), signature: signature as Hex };
}

/** Serialize a bare recovery request (no signature) for sharing with guardians. */
export const encodeRequest = (m: RecoveryDigest): string =>
  JSON.stringify(messageToJson(m), null, 2);
export const decodeRequest = (json: string): RecoveryDigest =>
  messageFromJson(JSON.parse(json) as Record<string, unknown>);
