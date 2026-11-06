import { readFile } from "node:fs/promises";
import type { Address, Hex } from "viem";
import { collectSignaturesFromArkiv } from "./arkiv-bridge.js";
import { decodeApproval } from "./blob.js";

/**
 * Trust lives in `verifyApproval` (on-chain roster re-check), so every carrier is equally
 * untrusted: Arkiv, files, QR blobs and stdin are interchangeable `ApprovalSource`s.
 */
export interface SignedApproval {
  guardian: Address;
  signature: Hex;
}

export interface ApprovalSource {
  name: string;
  collect(requestId: Hex): Promise<SignedApproval[]>;
}

/** Only keep blob approvals that are for THIS request (defence in depth; chain re-checks anyway). */
function matching(blobs: string[], requestId: Hex): SignedApproval[] {
  const out: SignedApproval[] = [];
  for (const raw of blobs) {
    try {
      const a = decodeApproval(raw);
      if (a.message.requestId.toLowerCase() === requestId.toLowerCase()) {
        out.push({ guardian: a.guardian, signature: a.signature });
      }
    } catch {
      // ignore malformed blobs
    }
  }
  return out;
}

/** `voxy1:` strings passed inline. */
export const blobSource = (blobs: string[]): ApprovalSource => ({
  name: "blobs",
  collect: async (requestId) => matching(blobs, requestId),
});

/** Files, each containing one `voxy1:` string (QR scans, Signal pastes, printed pages). */
export const fileSource = (paths: string[]): ApprovalSource => ({
  name: "files",
  collect: async (requestId) => {
    const contents = await Promise.all(paths.map((p) => readFile(p, "utf8")));
    return matching(contents, requestId);
  },
});

/** Arkiv — a convenience carrier, not a requirement. */
export const arkivSource = (): ApprovalSource => ({
  name: "arkiv",
  collect: async (requestId) => {
    const collected = await collectSignaturesFromArkiv(requestId);
    return collected.map((c) => ({ guardian: c.guardian, signature: c.signature }));
  },
});

/** Merge several sources, de-duplicating by signature. */
export async function gather(sources: ApprovalSource[], requestId: Hex): Promise<SignedApproval[]> {
  const seen = new Set<string>();
  const out: SignedApproval[] = [];
  for (const s of sources) {
    const approvals = await s.collect(requestId).catch(() => [] as SignedApproval[]);
    for (const a of approvals) {
      const k = a.signature.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
  }
  return out;
}
