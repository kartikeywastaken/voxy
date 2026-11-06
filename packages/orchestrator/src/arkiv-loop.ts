import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { createRecord, encodePayload, GuardianApprovals, publishRequest } from "@voxy/arkiv";
import { loadDeployments } from "@voxy/chain";
import { type Address, type Hex, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { collectSignaturesFromArkiv } from "./arkiv-bridge.js";
import { assembleAndSubmit, verifyApprovals } from "./assemble.js";
import { buildRecoveryDigest } from "./digest.js";
import { signRecovery } from "./guardian.js";

/**
 * End-to-end Arkiv-coordinated recovery (closes the loop): publish a recovery-request to Arkiv,
 * relay each guardian's signed approval to Arkiv, then read the signatures BACK FROM ARKIV and
 * submit the on-chain recovery assembled only from what Arkiv returned. The devnet wallet
 * re-verifies every signer + roster membership, so Arkiv is coordination, never authority.
 *
 * Demo note: approvals are relayed by the funded writer (payload carries the guardian's signature).
 * The production form has each guardian OWN its approval entity (needs each guardian funded with
 * tGLM on Rabdi); the on-chain quorum check is identical either way.
 */
const out = (v: unknown) =>
  console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Set ${name} to a 32-byte hex key`);
  return v;
}

async function main() {
  const d = loadDeployments();
  const devnetRpc = process.env.DEVNET_RPC_URL || d.devnet.rpc;
  const writer = privateKeyToAccount(pk("ARKIV_WRITER_PK"));
  const newKey = "0x3333333333333333333333333333333333333333" as Address;

  // 1. Build the exact RecoveryDigest from live devnet state.
  const { message } = await buildRecoveryDigest(newKey);
  const rid = message.requestId.slice(2);
  console.log("1. built recovery digest; requestId:", message.requestId);

  // 2. Publish the recovery-request to Arkiv (writer = initiator).
  const req = await publishRequest(writer, message, devnetRpc);
  console.log("2. recovery-request on Arkiv:", req.entityKey, req.explorer);

  // 3. Relay each guardian's signed approval to Arkiv.
  const guardianEnvs = ["GUARDIAN_1_PK", "GUARDIAN_2_PK"];
  let n = 0;
  for (const env of guardianEnvs) {
    const { guardian, signature } = await signRecovery(pk(env), message);
    await createRecord(
      writer,
      `approval-${rid}-${n}`,
      GuardianApprovals,
      {
        project: "voxy",
        type: "guardian-approval",
        requestId: message.requestId,
        guardian: addr(guardian),
        ens: `guardian${n + 1}.voxy.eth`,
        deadline: u64(message.deadline),
        payload: encodePayload({ signature }),
      },
      { expiration: ExpirationTime.fromMinutes(55) },
    );
    console.log(`3.${n + 1} relayed approval from guardian ${guardian}`);
    n++;
  }

  // 4. Read the signatures BACK FROM ARKIV and verify them against the live roster.
  const collected = await collectSignaturesFromArkiv(message.requestId);
  console.log(`4. read ${collected.length} approval(s) back from Arkiv`);
  const signatures = collected.map((c) => c.signature);
  const report = await verifyApprovals(message, signatures);
  console.log(`   on-chain re-verify: ${report.valid.length}/${report.threshold} valid guardians`);

  // 5. Submit the on-chain recovery assembled only from Arkiv-sourced signatures.
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const result = await assembleAndSubmit(payer, message, signatures);
  out({
    requestId: message.requestId,
    arkivRequest: req.entityKey,
    arkivApprovals: collected.map((c) => ({ guardian: c.guardian, entityKey: c.entityKey })),
    onchain: result,
  });
}

main().catch((e) => {
  console.error("arkiv-loop failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
