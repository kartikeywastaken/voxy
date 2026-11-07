import { type Address, type Hex, devnetReader, loadDeployments, rosterRegistryAbi } from "@voxy/chain";
import { encodeRequest, signRecovery, verifyApprovals } from "@voxy/orchestrator";
import { getAddress, isHex } from "viem";
import { prepareRecovery, startRecovery } from "./actions.js";

/**
 * In-memory recovery coordination hub — the "shared place" so nobody copy-pastes JSON:
 *  • a recovery request is posted here,
 *  • each guardian's approval (a signature over the same digest) is collected and verified,
 *  • everyone sees live "N of M approved",
 *  • when the quorum is met it auto-submits on-chain.
 * Demo-grade (resets on restart); the durable version is the Arkiv recovery-request/guardian-approval loop.
 */
type Req = {
  id: string;
  wallet: Address;
  newKey: Address;
  // biome-ignore lint/suspicious/noExplicitAny: the digest/typedData come from the orchestrator
  message: any;
  // biome-ignore lint/suspicious/noExplicitAny: typedData is passed straight to the wallet
  typedData: any;
  created: number;
  signatures: Hex[];
  submitted: boolean;
  txHash?: string;
};

const store = new Map<string, Req>();

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Server missing ${name}`);
  return v;
}

async function rosterGuardians(wallet: Address): Promise<{ guardians: Address[]; threshold: number }> {
  const d = loadDeployments();
  const r = await devnetReader().readContract({
    address: d.devnet.RosterRegistry,
    abi: rosterRegistryAbi,
    functionName: "rosterOf",
    args: [wallet],
  });
  const gs = (r.guardians as readonly Address[]).filter((a) => a && !/^0x0+$/.test(a));
  return { guardians: gs, threshold: Number(r.threshold) };
}

async function statusView(r: Req) {
  const report = await verifyApprovals(r.message, r.signatures);
  const signers = report.checks.filter((c) => c.counted && c.guardian).map((c) => c.guardian);
  return {
    id: r.id,
    wallet: r.wallet,
    newKey: r.newKey,
    approved: report.valid.length,
    threshold: report.threshold,
    signers,
    submitted: r.submitted,
    txHash: r.txHash,
  };
}

/** Post a recovery request to the hub. Returns the digest guardians sign + the shareable id. */
export async function requestRecovery(wallet: Address, newKey: Address) {
  const { message, typedData } = await prepareRecovery(newKey, wallet);
  const id = String(message.requestId);
  const existing = store.get(id);
  const r: Req = existing ?? {
    id,
    wallet,
    newKey,
    message,
    typedData,
    created: Date.now(),
    signatures: [],
    submitted: false,
  };
  store.set(id, r);
  const roster = await rosterGuardians(wallet);
  return { ...(await statusView(r)), typedData, guardians: roster.guardians, created: r.created };
}

export async function getRequest(id: string) {
  const r = store.get(id);
  if (!r) throw new Error("No such recovery request (it may have expired — create a new one)");
  return { ...(await statusView(r)), typedData: r.typedData, created: r.created };
}

/** List open requests this guardian can approve (active guardian, hasn't signed yet). */
export async function pendingForGuardian(guardian: Address) {
  const g = getAddress(guardian).toLowerCase();
  const out = [];
  for (const r of store.values()) {
    if (r.submitted) continue;
    const roster = await rosterGuardians(r.wallet);
    if (!roster.guardians.some((a) => a.toLowerCase() === g)) continue;
    const view = await statusView(r);
    const alreadySigned = view.signers.some((a) => a?.toLowerCase() === g);
    out.push({ ...view, typedData: r.typedData, created: r.created, alreadySigned });
  }
  return out.sort((a, b) => b.created - a.created);
}

/** A guardian submits their signature. Verified against the live roster; auto-submits at quorum. */
export async function approveRecovery(id: string, signature: Hex) {
  const r = store.get(id);
  if (!r) throw new Error("No such recovery request");
  if (r.submitted) return statusView(r);
  // The new signature must be from an active guardian for this exact request.
  const one = await verifyApprovals(r.message, [signature]);
  if (one.valid.length !== 1) {
    throw new Error("That signature is not from an active guardian for this request.");
  }
  if (!r.signatures.includes(signature)) r.signatures.push(signature);
  const report = await verifyApprovals(r.message, r.signatures);
  if (report.valid.length >= report.threshold && !r.submitted) {
    const res = await startRecovery(r.newKey, r.wallet, encodeRequest(r.message), report.valid);
    r.submitted = true;
    r.txHash = res.tx.hash;
  }
  return statusView(r);
}

/** Demo convenience: approve with the server-held demo guardian keys so you can watch the quorum fill. */
export async function demoApprove(id: string) {
  const r = store.get(id);
  if (!r) throw new Error("No such recovery request");
  const envs = ["GUARDIAN_1_PK", "GUARDIAN_2_PK", "GUARDIAN_3_PK"].filter((e) => process.env[e]);
  for (const e of envs) {
    if (r.submitted) break;
    const { signature } = await signRecovery(pk(e), r.message);
    await approveRecovery(id, signature);
  }
  return getRequest(id);
}
