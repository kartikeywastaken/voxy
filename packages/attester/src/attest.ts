import {
  loadDeployments,
  type RosterAttestation,
  rosterAttestationTypedData,
  sepoliaReader,
} from "@voxy/chain";
import { type Address, type Hex, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readSepoliaRoster } from "./roster.js";

export function attesterAccount(pk: string) {
  const key = pk.trim();
  if (!isHex(key) || key.length !== 66) throw new Error("Attester key must be a 32-byte hex value");
  return privateKeyToAccount(key);
}

/**
 * Build ONE canonical attestation struct from the live Sepolia roster. Every attester must sign
 * this exact struct (same Sepolia block) so their signatures hash to the same digest the registry
 * recomputes. `epoch` MUST equal the devnet registry's stored epoch + 1.
 */
export async function buildAttestation(
  epoch: bigint,
  opts: { account?: Address; validForSeconds?: number } = {},
): Promise<RosterAttestation> {
  const d = loadDeployments();
  const wallet = opts.account ?? (d.devnet.VoxyWallet as Address);
  const roster = await readSepoliaRoster(opts.account);
  const block = await sepoliaReader().getBlock({ blockTag: "latest" });
  const now = Math.floor(Date.now() / 1000);
  return {
    wallet,
    epoch,
    rosterHash: roster.rosterHash,
    guardian0: roster.guardians[0],
    guardian1: roster.guardians[1],
    guardian2: roster.guardians[2],
    threshold: roster.threshold,
    sepoliaBlockNumber: block.number,
    sepoliaBlockHash: block.hash as Hex,
    validUntil: BigInt(now + (opts.validForSeconds ?? 3600)),
  };
}

/** One attester's EIP-712 signature over a given (shared) attestation struct. */
export async function signAttestation(
  attesterPk: string,
  attestation: RosterAttestation,
): Promise<{ signer: Address; signature: Hex }> {
  const d = loadDeployments();
  const account = attesterAccount(attesterPk);
  const signature = await account.signTypedData(
    rosterAttestationTypedData(d.devnet.chainId, d.devnet.RosterRegistry, attestation),
  );
  return { signer: account.address, signature };
}
