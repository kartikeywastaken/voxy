import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = async (contract) =>
  JSON.parse(
    await readFile(new URL(`contracts/sepolia/out/${contract}.sol/${contract}.json`, root), "utf8"),
  );
const account = await read("VoxyRecoveryAccount");
const roster = await read("VoxyEnsRoster");
const text = `// Generated from Solidity artifacts by apps/api/scripts/build-eoa-artifacts.mjs.\nexport const recoveryAccountAbi = ${JSON.stringify(account.abi, null, 2)} as const;\nexport const ensRosterAbi = ${JSON.stringify(roster.abi, null, 2)} as const;\n`;
await writeFile(new URL("packages/chain/src/eoa-abis.ts", root), text);
console.log("Updated the browser-safe recovery ABIs.");
