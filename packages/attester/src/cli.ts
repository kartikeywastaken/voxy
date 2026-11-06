import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildAttestation, signAttestation } from "./attest.js";
import { readDevnetRoster, readSepoliaRoster } from "./roster.js";
import { submitRoster } from "./submit.js";
import { verifySync } from "./verify-sync.js";

const out = (value: unknown) =>
  console.log(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

function requirePk(name: string) {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Set ${name} to a 32-byte hex key`);
  return v;
}

const command = process.argv[2];

if (command === "roster") {
  // Show both sides without changing anything.
  const [sep, dev] = await Promise.all([readSepoliaRoster(), readDevnetRoster()]);
  out({ sepolia: sep, devnet: dev });
} else if (command === "verify-sync") {
  const report = await verifySync();
  out(report);
  if (!report.match) process.exitCode = 1;
} else if (command === "sync") {
  // Build one canonical attestation at devnet epoch+1, sign with 2 attesters, submit to devnet.
  const current = await readDevnetRoster();
  const epoch = current.epoch + 1n;
  const attestation = await buildAttestation(epoch);
  const a1 = await signAttestation(requirePk("ATTESTER_1_PK"), attestation);
  const a2 = await signAttestation(requirePk("ATTESTER_2_PK"), attestation);
  const payer = privateKeyToAccount(requirePk("DEVNET_DEPLOYER_PK"));
  const result = await submitRoster(payer, attestation, [a1.signature, a2.signature]);
  const after = await readDevnetRoster();
  out({
    submitted: { epoch: epoch.toString(), rosterHash: attestation.rosterHash },
    signers: [a1.signer, a2.signer],
    tx: result,
    devnetAfter: { epoch: after.epoch.toString(), hash: after.hash },
  });
} else {
  console.error("Commands: roster | verify-sync | sync");
  process.exitCode = 1;
}
