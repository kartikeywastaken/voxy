import { ExpirationTime } from "@arkiv-network/sdk";
import { and, eq } from "@arkiv-network/sdk/query";
import { u64 } from "@arkiv-network/sdk/schema";
import { hexToString } from "viem";
import { arkivClients } from "./client.js";
import { writerAccount } from "./env.js";
import { ConnectionChecks, encodePayload } from "./schema.js";
import { createRecord } from "./write.js";

/** Real connectivity probe, never counted as a request, approval or roster. */
export async function firstWrite() {
  const account = writerAccount();
  const { reader } = arkivClients();
  if ((await reader.getChainId()) !== 7794095) throw new Error("Wrong chain");
  const probeId = "onboarding_v1";
  const existing = await reader
    .select({ $key: true, $creator: true, $creationFlags: true, payload: true })
    .from(ConnectionChecks, { onMismatch: "throw" })
    .createdBy(account.address)
    .where(and(eq("project", "voxy"), eq("probeId", probeId)))
    .limit(2)
    .fetch();
  if (existing.entities.length > 1) throw new Error("Duplicate probes; reconcile existing writes");
  const prior = existing.entities[0];
  const payload = {
    purpose: "Live Rabdi SDK connectivity check",
    project: "voxy",
    chainId: 7794095,
  };
  if (prior) {
    if (
      !prior.$creationFlags.readonly ||
      prior.$creationFlags.permissionlessExtension ||
      hexToString(prior.payload.value) !== JSON.stringify(payload)
    )
      throw new Error("Existing probe differs");
    return { reused: true, entityKey: prior.$key, observedBlock: existing.blockNumber };
  }
  if ((await reader.getBalance({ address: account.address })) === 0n) {
    throw new Error("Arkiv writer has zero tGLM; fund it at https://hub.arkiv.network/faucet");
  }
  const result = await createRecord(
    account,
    probeId,
    ConnectionChecks,
    {
      project: "voxy",
      probeId,
      createdAt: u64(BigInt(Date.now())),
      payload: encodePayload(payload),
    },
    { expiration: ExpirationTime.fromMinutes(10) },
  );
  const direct = await reader.getEntity(result.entityKey, ConnectionChecks);
  if (hexToString(direct.payload.value) !== JSON.stringify(payload))
    throw new Error("Probe payload differs");
  return { ...result, reused: false, payload, verified: true };
}
