import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";

/**
 * TypeScript reproductions of the exact hashing done inside RosterRegistry.sol and VoxyWallet.sol.
 * Verified byte-for-byte against the Solidity in `eip712.test.ts` (golden vectors produced with
 * `cast` / the contracts themselves). If these ever diverge from the contracts, the attester and
 * orchestrator would produce signatures the chain rejects — so the test is the contract.
 */

export const VOXY_DOMAIN_NAME = "Voxy";
export const VOXY_DOMAIN_VERSION = "1";

// --- roster hash (plain abi.encode, NOT EIP-712) -------------------------------------------------
// Solidity: keccak256(abi.encode(guardians[0], guardians[1], guardians[2], threshold))

export function hashRoster(
  guardians: readonly [Address, Address, Address],
  threshold: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint8" }],
      [guardians[0], guardians[1], guardians[2], threshold],
    ),
  );
}

// --- RosterAttestation (attesters sign; RosterRegistry verifies) ---------------------------------

export interface RosterAttestation {
  wallet: Address;
  epoch: bigint;
  rosterHash: Hex;
  guardian0: Address;
  guardian1: Address;
  guardian2: Address;
  threshold: number;
  sepoliaBlockNumber: bigint;
  sepoliaBlockHash: Hex;
  validUntil: bigint;
}

export const rosterAttestationTypes = {
  RosterAttestation: [
    { name: "wallet", type: "address" },
    { name: "epoch", type: "uint64" },
    { name: "rosterHash", type: "bytes32" },
    { name: "guardian0", type: "address" },
    { name: "guardian1", type: "address" },
    { name: "guardian2", type: "address" },
    { name: "threshold", type: "uint8" },
    { name: "sepoliaBlockNumber", type: "uint256" },
    { name: "sepoliaBlockHash", type: "bytes32" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

/** Domain for the devnet RosterRegistry (chainId = 1337, verifyingContract = registry). */
export function registryDomain(chainId: number, registry: Address) {
  return {
    name: VOXY_DOMAIN_NAME,
    version: VOXY_DOMAIN_VERSION,
    chainId,
    verifyingContract: registry,
  };
}

export function rosterAttestationTypedData(
  chainId: number,
  registry: Address,
  message: RosterAttestation,
) {
  return {
    domain: registryDomain(chainId, registry),
    types: rosterAttestationTypes,
    primaryType: "RosterAttestation" as const,
    message,
  };
}

// --- RecoveryDigest (guardians sign; VoxyWallet verifies) ----------------------------------------

export interface RecoveryDigest {
  chainId: bigint;
  wallet: Address;
  newKey: Address;
  ownerEpoch: bigint;
  rosterEpoch: bigint;
  rosterHash: Hex;
  deadline: bigint;
  requestId: Hex;
  callHash: Hex;
}

export const recoveryDigestTypes = {
  RecoveryDigest: [
    { name: "chainId", type: "uint256" },
    { name: "wallet", type: "address" },
    { name: "newKey", type: "address" },
    { name: "ownerEpoch", type: "uint64" },
    { name: "rosterEpoch", type: "uint64" },
    { name: "rosterHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "requestId", type: "bytes32" },
    { name: "callHash", type: "bytes32" },
  ],
} as const;

/** Domain for a VoxyWallet (chainId = wallet's chain, verifyingContract = wallet). */
export function walletDomain(chainId: number, wallet: Address) {
  return {
    name: VOXY_DOMAIN_NAME,
    version: VOXY_DOMAIN_VERSION,
    chainId,
    verifyingContract: wallet,
  };
}

export function recoveryDigestTypedData(chainId: number, wallet: Address, message: RecoveryDigest) {
  return {
    domain: walletDomain(chainId, wallet),
    types: recoveryDigestTypes,
    primaryType: "RecoveryDigest" as const,
    message,
  };
}
