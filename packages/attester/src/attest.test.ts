import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDeployments, type RosterAttestation, rosterAttestationTypedData } from "@voxy/chain";
import { type Hex, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { attesterAccount, signAttestation } from "./attest.js";

// Well-known anvil key #0 — only used to round-trip signing locally.
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const ATTESTATION: RosterAttestation = {
  wallet: "0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E",
  epoch: 1n,
  rosterHash: "0x63a497e5a622b6f0a06128e7fc8068a9a891fc005dd09ecbf41593c445665320",
  guardian0: "0x6d3E1f382A6A059904F9a608eE53efA891a77aC8",
  guardian1: "0xc24D0902DBF77CE2111c7128925E9276aB77424A",
  guardian2: "0x7017ff35EC300e336D3fB5FFBC9A5a80A81a7C71",
  threshold: 2,
  sepoliaBlockNumber: 12345678n,
  sepoliaBlockHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  validUntil: 2000000000n,
};

const d = loadDeployments();
const typed = (a: RosterAttestation) =>
  rosterAttestationTypedData(d.devnet.chainId, d.devnet.RosterRegistry, a);

test("signAttestation signs the exact RosterAttestation digest the registry verifies", async () => {
  const { signer, signature } = await signAttestation(PK, ATTESTATION);
  assert.equal(signer, privateKeyToAccount(PK).address);
  const recovered = await recoverTypedDataAddress({ ...typed(ATTESTATION), signature });
  assert.equal(recovered, signer);
});

test("signing is deterministic (RFC-6979) — same struct, same signature", async () => {
  const a = await signAttestation(PK, ATTESTATION);
  const b = await signAttestation(PK, ATTESTATION);
  assert.equal(a.signature, b.signature);
});

test("a tampered attestation field no longer recovers to the attester (binding holds)", async () => {
  const { signer, signature } = await signAttestation(PK, ATTESTATION);
  for (const m of [
    { epoch: 2n },
    { threshold: 3 },
    { rosterHash: `0x${"ab".repeat(32)}` as Hex },
  ]) {
    const recovered = await recoverTypedDataAddress({
      ...typed({ ...ATTESTATION, ...m }),
      signature,
    });
    assert.notEqual(recovered, signer);
  }
});

test("attesterAccount rejects malformed keys", () => {
  assert.throws(() => attesterAccount("0xnotakey"));
  assert.throws(() => attesterAccount("deadbeef"));
});
