import { getAddress, type Hex, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in your server environment`);
  return value;
}

export function writerAccount() {
  const key = required("ARKIV_WRITER_PK");
  if (!isHex(key) || key.length !== 66) throw new Error("ARKIV_WRITER_PK must be 32 bytes");
  const account = privateKeyToAccount(key as Hex);
  const expected = process.env.ARKIV_WRITER_ADDRESS;
  if (expected && getAddress(expected) !== account.address) {
    throw new Error("ARKIV_WRITER_ADDRESS does not match the configured signer");
  }
  return account;
}

export function json(value: unknown): string {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}
