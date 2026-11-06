import { readDevnetRoster, signAttestation, submitRoster } from "@voxy/attester";
import { hashRoster, loadDeployments, type RosterAttestation } from "@voxy/chain";
import { type Address, type Hex, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const wallet = process.env.FRAME_WALLET as Address;
const pk = (n: string): Hex => {
  const v = process.env[n]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Set ${n}`);
  return v;
};

const d = loadDeployments();
const current = await readDevnetRoster(wallet);
if (current.epoch > 0n) {
  console.log("roster already set:", { epoch: current.epoch.toString(), hash: current.hash });
} else {
  const g = d.sepolia.guardians as [Address, Address, Address];
  const threshold = d.sepolia.rosterThreshold;
  const attestation: RosterAttestation = {
    wallet,
    epoch: 1n,
    rosterHash: hashRoster(g, threshold),
    guardian0: g[0],
    guardian1: g[1],
    guardian2: g[2],
    threshold,
    sepoliaBlockNumber: 0n,
    sepoliaBlockHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const a1 = await signAttestation(pk("ATTESTER_1_PK"), attestation);
  const a2 = await signAttestation(pk("ATTESTER_2_PK"), attestation);
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const res = await submitRoster(payer, attestation, [a1.signature, a2.signature]);
  console.log("submitted:", res);
}
const after = await readDevnetRoster(wallet);
console.log("roster now:", {
  epoch: after.epoch.toString(),
  threshold: after.threshold,
  hash: after.hash,
  guardians: after.guardians,
  activeAt: after.activeAt.map(String),
});
