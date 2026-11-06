import {
  type Address,
  getAddress,
  type Hex,
  hashTypedData,
  isHex,
  type LocalAccount,
  recoverTypedDataAddress,
  zeroAddress,
} from "viem";

export const recoveryTypes = {
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

export type RecoveryDigest = {
  chainId: bigint;
  wallet: Address;
  newKey: Address;
  ownerEpoch: bigint;
  rosterEpoch: bigint;
  rosterHash: Hex;
  deadline: bigint;
  requestId: Hex;
  callHash: Hex;
};

export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected an object");
  return input as Record<string, unknown>;
}

export function uint(input: unknown, bits = 64): bigint {
  if (
    typeof input !== "bigint" &&
    (typeof input !== "string" || !/^(0|[1-9][0-9]*)$/.test(input))
  ) {
    throw new Error("Unsigned integers must be bigint or decimal strings");
  }
  const value = BigInt(input);
  if (value < 0n || value >= 2n ** BigInt(bits)) throw new Error("Unsigned integer out of range");
  return value;
}

export function hash32(input: unknown): Hex {
  if (typeof input !== "string" || !isHex(input) || !/^0x[0-9a-f]{64}$/i.test(input)) {
    throw new Error("Expected a 32-byte hash");
  }
  return input.toLowerCase() as Hex;
}

export function address(input: unknown): Address {
  if (typeof input !== "string") throw new Error("Expected an address");
  const value = getAddress(input);
  if (value === zeroAddress) throw new Error("Zero address is not permitted");
  return value;
}

export function parseRecovery(input: unknown): RecoveryDigest {
  const value = object(input);
  const result = {
    chainId: uint(value.chainId, 256),
    wallet: address(value.wallet),
    newKey: address(value.newKey),
    ownerEpoch: uint(value.ownerEpoch),
    rosterEpoch: uint(value.rosterEpoch),
    rosterHash: hash32(value.rosterHash),
    deadline: uint(value.deadline),
    requestId: hash32(value.requestId),
    callHash: hash32(value.callHash),
  };
  if (result.chainId === 0n || result.rosterEpoch === 0n)
    throw new Error("Chain and roster epoch must be positive");
  return result;
}

export function recoveryTypedData(input: RecoveryDigest) {
  const message = parseRecovery(input);
  return {
    domain: {
      name: "Voxy",
      version: "1",
      chainId: message.chainId,
      verifyingContract: message.wallet,
    },
    types: recoveryTypes,
    primaryType: "RecoveryDigest" as const,
    message,
  };
}

export const recoveryHash = (message: RecoveryDigest) => hashTypedData(recoveryTypedData(message));
export const signDigest = (account: LocalAccount, message: RecoveryDigest) =>
  account.signTypedData(recoveryTypedData(message));

/** Match Solidity's 65-byte, low-s, v=27/28 signature gate before accepting progress. */
export async function recoverGuardian(message: RecoveryDigest, input: unknown): Promise<Address> {
  if (typeof input !== "string" || !/^0x[0-9a-f]{130}$/i.test(input))
    throw new Error("Expected a 65-byte signature");
  const s = BigInt(`0x${input.slice(66, 130)}`);
  const v = Number.parseInt(input.slice(130, 132), 16);
  if (
    s === 0n ||
    s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
    (v !== 27 && v !== 28)
  ) {
    throw new Error("Non-canonical signature");
  }
  return getAddress(
    await recoverTypedDataAddress({ ...recoveryTypedData(message), signature: input as Hex }),
  );
}
