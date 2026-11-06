import assert from "node:assert/strict";
import { test } from "node:test";
import { type Address, hashDomain, hashTypedData } from "viem";
import {
  hashRoster,
  type RecoveryDigest,
  recoveryDigestTypedData,
  registryDomain,
  walletDomain,
} from "./eip712.js";

const EIP712DOMAIN_TYPE = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

const domainSeparator = (domain: ReturnType<typeof walletDomain>) =>
  hashDomain({ domain: { ...domain, chainId: BigInt(domain.chainId) }, types: EIP712DOMAIN_TYPE });

/**
 * Golden vectors. ROSTER_HASH was produced independently with `cast` (abi.encode + keccak).
 * WALLET_DS and REGISTRY_DS are the DOMAIN_SEPARATOR values read LIVE from the deployed
 * VoxyWallet (0xb7d8…807E) and RosterRegistry (0xEa97…f31C) on the alt-mempool devnet.
 * These tests fail the moment the TS hashing drifts from what the on-chain contracts verify.
 */
const GUARDIANS: readonly [Address, Address, Address] = [
  "0x6d3E1f382A6A059904F9a608eE53efA891a77aC8",
  "0xc24D0902DBF77CE2111c7128925E9276aB77424A",
  "0x7017ff35EC300e336D3fB5FFBC9A5a80A81a7C71",
];
const WALLET: Address = "0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E";
const REGISTRY: Address = "0xEa974EfA1aE7D89f7624E144dA1a444C8250f31C";

const ROSTER_HASH = "0x63a497e5a622b6f0a06128e7fc8068a9a891fc005dd09ecbf41593c445665320";
const WALLET_DS = "0xc7a57071bf1851ac0211e47e00bd42a15629721fa1e52919f0c89ca02965ecf0";
const REGISTRY_DS = "0x780925d8482c3fcef374806e9688137505148a15060c9e3236e883132efe19c8";

test("hashRoster matches cast abi.encode+keccak golden", () => {
  assert.equal(hashRoster(GUARDIANS, 2), ROSTER_HASH);
});

test("wallet EIP-712 domain separator matches the live deployed VoxyWallet", () => {
  assert.equal(domainSeparator(walletDomain(1337, WALLET)), WALLET_DS);
});

test("registry EIP-712 domain separator matches the live deployed RosterRegistry", () => {
  assert.equal(domainSeparator(registryDomain(1337, REGISTRY)), REGISTRY_DS);
});

test("roster hash is order-sensitive (guardian slots are positional)", () => {
  const swapped: [Address, Address, Address] = [GUARDIANS[1], GUARDIANS[0], GUARDIANS[2]];
  assert.notEqual(hashRoster(swapped, 2), ROSTER_HASH);
});

// Full EIP-712 RecoveryDigest hash (0x1901 || domainSep || structHash), computed independently
// with `cast` against the live VoxyWallet domain. This is the exact digest guardians sign and the
// contract recomputes — the most security-critical hash in the system.
const RECOVERY_DIGEST_GOLDEN = "0x42899ecdead4d2837cd1e40b33b18b10e9c79ecbf47a9f5981c1dfc66c1612a1";

const SAMPLE_RECOVERY: RecoveryDigest = {
  chainId: 1337n,
  wallet: WALLET,
  newKey: "0x1111111111111111111111111111111111111111",
  ownerEpoch: 1n,
  rosterEpoch: 1n,
  rosterHash: ROSTER_HASH,
  deadline: 2000000000n,
  requestId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  callHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

test("full RecoveryDigest EIP-712 hash matches the cast golden (the digest guardians sign)", () => {
  const typed = recoveryDigestTypedData(1337, WALLET, SAMPLE_RECOVERY);
  assert.equal(hashTypedData(typed), RECOVERY_DIGEST_GOLDEN);
});

test("any changed recovery field changes the digest (binding holds)", () => {
  const base = hashTypedData(recoveryDigestTypedData(1337, WALLET, SAMPLE_RECOVERY));
  const mutations: Partial<RecoveryDigest>[] = [
    { newKey: "0x2222222222222222222222222222222222222222" },
    { ownerEpoch: 2n },
    { rosterEpoch: 2n },
    { deadline: 2000000001n },
    { requestId: "0x0000000000000000000000000000000000000000000000000000000000000002" },
  ];
  for (const m of mutations) {
    const mutated = hashTypedData(
      recoveryDigestTypedData(1337, WALLET, { ...SAMPLE_RECOVERY, ...m }),
    );
    assert.notEqual(mutated, base);
  }
});
