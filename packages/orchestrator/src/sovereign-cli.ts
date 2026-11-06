import { readFile } from "node:fs/promises";
import { type Address, type Hex, isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assembleAndSubmit, verifyApprovals } from "./assemble.js";
import { decodeRequest, encodeApproval, encodeRequest } from "./blob.js";
import { buildRecoveryDigest } from "./digest.js";
import { signRecovery } from "./guardian.js";
import { arkivSource, fileSource, gather } from "./sources.js";

const out = (v: unknown) =>
  console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (n: string) =>
  args.reduce<string[]>((a, v, i) => (v === `--${n}` ? [...a, args[i + 1]!] : a), []);
const has = (n: string) => args.includes(`--${n}`);

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Set ${name} to a 32-byte hex key`);
  return v;
}

const command = args[0];

if (command === "request") {
  // Owner (or anyone) builds the shared recovery request from live chain state.
  const newKey = flag("new-key");
  if (!newKey || !isAddress(newKey)) throw new Error("--new-key must be an address");
  const { message } = await buildRecoveryDigest(newKey as Address);
  console.log(encodeRequest(message));
} else if (command === "sign") {
  // A guardian signs the request IN THEIR OWN WALLET and emits a portable voxy1: blob.
  const requestJson = await readFile(flag("request") ?? "", "utf8");
  const message = decodeRequest(requestJson);
  const { guardian, signature } = await signRecovery(
    pk(flag("pk-env") ?? "GUARDIAN_1_PK"),
    message,
  );
  console.error(`signed by guardian ${guardian}`);
  console.log(encodeApproval({ message, guardian, signature }));
} else if (command === "recover") {
  // Owner collects blobs from ANY carrier (files/QR/Arkiv) and submits — no server, no assembler.
  const requestJson = await readFile(flag("request") ?? "", "utf8");
  const message = decodeRequest(requestJson);
  const sources = [fileSource(flags("blob")), ...(has("arkiv") ? [arkivSource()] : [])];
  const approvals = await gather(sources, message.requestId);
  const signatures = approvals.map((a) => a.signature);
  const report = await verifyApprovals(message, signatures);
  console.error(
    `collected ${signatures.length} approval(s) from [${sources.map((s) => s.name).join(", ")}]; ` +
      `${report.valid.length}/${report.threshold} valid on-chain`,
  );
  if (has("dry-run")) {
    out({ message, report });
  } else {
    const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
    out(await assembleAndSubmit(payer, message, signatures));
  }
} else {
  console.error(
    "Commands:\n" +
      "  request --new-key <addr>                     # owner: print the shared request JSON\n" +
      "  sign --request <file> [--pk-env GUARDIAN_1_PK] # guardian: emit a voxy1: approval blob\n" +
      "  recover --request <file> --blob <file>... [--arkiv] [--dry-run]  # owner: verify + submit, no server",
  );
  process.exitCode = 1;
}
