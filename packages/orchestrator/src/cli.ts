import type { Address, Hex } from "viem";
import { isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { collectSignaturesFromArkiv } from "./arkiv-bridge.js";
import { assembleAndSubmit, verifyApprovals } from "./assemble.js";
import { buildRecoveryDigest } from "./digest.js";
import { signRecovery } from "./guardian.js";

const out = (value: unknown) =>
  console.log(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function requirePk(name: string) {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Set ${name} to a 32-byte hex key`);
  return v;
}
function requireAddr(name: string, v?: string): Address {
  if (!v || !isAddress(v)) throw new Error(`--${name} must be an address`);
  return v;
}

const command = process.argv[2];

if (command === "digest") {
  // Build + print the digest guardians must sign (read-only).
  const newKey = requireAddr("new-key", flag("new-key"));
  const { message } = await buildRecoveryDigest(newKey, { requestId: flag("request-id") as Hex });
  out(message);
} else if (command === "recover") {
  // Full live backend path: build digest, sign with the given guardian keys, verify, submit.
  const newKey = requireAddr("new-key", flag("new-key"));
  const keyEnvs = (flag("guardians") ?? "GUARDIAN_1_PK,GUARDIAN_2_PK").split(",");
  const dryRun = process.argv.includes("--dry-run");

  const { message } = await buildRecoveryDigest(newKey, { requestId: flag("request-id") as Hex });
  const signed = await Promise.all(keyEnvs.map((e) => signRecovery(requirePk(e.trim()), message)));
  const signatures = signed.map((s) => s.signature);

  const report = await verifyApprovals(message, signatures);
  if (dryRun) {
    out({ message, signers: signed.map((s) => s.guardian), report });
  } else {
    const payer = privateKeyToAccount(requirePk("DEVNET_DEPLOYER_PK"));
    const result = await assembleAndSubmit(payer, message, signatures);
    out({ requestId: message.requestId, newKey, signers: signed.map((s) => s.guardian), result });
  }
} else if (command === "assemble") {
  // Arkiv-driven path: collect approvals for a request from Arkiv, verify, submit.
  const newKey = requireAddr("new-key", flag("new-key"));
  const requestId = flag("request-id");
  if (!requestId || !isHex(requestId)) throw new Error("--request-id must be a 32-byte hex id");
  const { message } = await buildRecoveryDigest(newKey, { requestId });
  const collected = await collectSignaturesFromArkiv(requestId);
  const signatures = collected.map((c) => c.signature);
  const report = await verifyApprovals(message, signatures);
  if (process.argv.includes("--dry-run")) {
    out({ collected, report });
  } else {
    const payer = privateKeyToAccount(requirePk("DEVNET_DEPLOYER_PK"));
    out(await assembleAndSubmit(payer, message, signatures));
  }
} else {
  console.error(
    "Commands: digest --new-key <addr> | recover --new-key <addr> [--dry-run] | assemble --new-key <addr> --request-id <hex> [--dry-run]",
  );
  process.exitCode = 1;
}
