import { readApprovals } from "@voxy/arkiv";
import { type Address, type Hex, hexToString, isHex } from "viem";

export interface CollectedApproval {
  guardian: Address;
  ens: string;
  signature: Hex;
  entityKey: string;
}

/**
 * Pull guardian approvals for a request from Arkiv and extract their signatures. This is the
 * assembler's read step (bible §9.3): it trusts nothing from Arkiv — it only lifts the candidate
 * signatures out. `verifyApprovals`/`assembleAndSubmit` then re-derive the signer and re-check
 * roster membership on-chain, so a forged or spam approval entity simply fails to count.
 */
export async function collectSignaturesFromArkiv(requestId: Hex): Promise<CollectedApproval[]> {
  const result = await readApprovals(requestId);
  const approvals: CollectedApproval[] = [];
  for (const entity of result.entities) {
    try {
      const decoded = JSON.parse(hexToString(entity.payload.value)) as { signature?: unknown };
      if (typeof decoded.signature !== "string" || !isHex(decoded.signature)) continue;
      approvals.push({
        guardian: entity.guardian.value as Address,
        ens: (entity.ens.value as string) ?? "",
        signature: decoded.signature as Hex,
        entityKey: String(entity.$key),
      });
    } catch {
      // A malformed payload is simply ignored; the on-chain quorum is the real gate.
    }
  }
  return approvals;
}
