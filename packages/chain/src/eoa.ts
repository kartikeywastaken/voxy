import { type Address, getAddress, type Hex, hashTypedData, isAddress, isHex } from "viem";

export const eoaChainId = 11155111;
export const eoaDomain = (account: Address) =>
  ({
    name: "VoxyRecovery",
    version: "2",
    chainId: eoaChainId,
    verifyingContract: account,
  }) as const;
export const eoaTypes = {
  Enrollment: [
    { name: "account", type: "address" },
    { name: "implementation", type: "address" },
    { name: "guardian0", type: "address" },
    { name: "guardian1", type: "address" },
    { name: "guardian2", type: "address" },
    { name: "threshold", type: "uint8" },
    { name: "delay", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
  RecoveryDigest: [
    { name: "chainId", type: "uint256" },
    { name: "account", type: "address" },
    { name: "newController", type: "address" },
    { name: "ownerEpoch", type: "uint64" },
    { name: "rosterHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "requestId", type: "bytes32" },
  ],
  Execution: [
    { name: "account", type: "address" },
    { name: "callsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;
export const domainFields = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected an object");
  return input as Record<string, unknown>;
}
export function address(input: unknown, zero = false): Address {
  if (typeof input !== "string" || !isAddress(input, { strict: false }))
    throw new Error("Invalid wallet address");
  const value = getAddress(input);
  if (!zero && /^0x0{40}$/.test(value)) throw new Error("Zero address is not allowed");
  return value;
}
export function uint(input: unknown, bits = 64): bigint {
  if (typeof input !== "string" || !/^(0|[1-9][0-9]*)$/.test(input))
    throw new Error("Integer fields must be decimal strings");
  const value = BigInt(input);
  if (value >= 1n << BigInt(bits)) throw new Error("Integer is out of range");
  return value;
}
export function hex(input: unknown, bytes: number): Hex {
  if (typeof input !== "string" || !isHex(input) || input.length !== 2 + bytes * 2)
    throw new Error(`Expected ${bytes} bytes`);
  return input.toLowerCase() as Hex;
}
export function parseEnrollment(input: unknown) {
  const r = record(input);
  const threshold = Number(uint(String(r.threshold), 8));
  return {
    account: address(r.account),
    implementation: address(r.implementation),
    guardian0: address(r.guardian0, true),
    guardian1: address(r.guardian1, true),
    guardian2: address(r.guardian2, true),
    threshold,
    delay: uint(r.delay),
    expiresAt: uint(r.expiresAt),
    deadline: uint(r.deadline),
  };
}
export function parseEOARecovery(input: unknown) {
  const r = record(input);
  return {
    chainId: uint(r.chainId, 256),
    account: address(r.account),
    newController: address(r.newController),
    ownerEpoch: uint(r.ownerEpoch),
    rosterHash: hex(r.rosterHash, 32),
    deadline: uint(r.deadline),
    requestId: hex(r.requestId, 32),
  };
}
export type EOARecovery = ReturnType<typeof parseEOARecovery>;
export const recoveryTypedData = (message: EOARecovery) => ({
  domain: eoaDomain(message.account),
  types: { RecoveryDigest: eoaTypes.RecoveryDigest },
  primaryType: "RecoveryDigest" as const,
  message,
});
export const eoaRecoveryHash = (message: EOARecovery) => hashTypedData(recoveryTypedData(message));
export const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
