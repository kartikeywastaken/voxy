import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Address, getAddress } from "viem";

/**
 * Typed, validated view over the repo-root `deployments.json`. This is the single
 * source of truth for every live address; nothing in the backend hardcodes one.
 */
export interface Deployments {
  sepolia: {
    chainId: number;
    explorer: string;
    rpc: string;
    RosterPublisher: Address;
    UserRegistry: Address;
    ThresholdResolver: Address;
    rosterAccount: Address;
    guardians: Address[];
    rosterThreshold: number;
    ensv2: Record<string, Address>;
  };
  devnet: {
    chainId: number;
    rpc: string;
    explorer: string;
    RosterRegistry: Address;
    VoxyWallet: Address;
    stakingRegistry: Address;
    entryPoint: Address;
  };
  arkiv: {
    chainId: number;
    rpc: string;
    explorer: string;
    writer: Address;
  };
}

const PATH = fileURLToPath(new URL("../../../deployments.json", import.meta.url));

let cached: Deployments | undefined;

export function loadDeployments(): Deployments {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(PATH, "utf8")) as Deployments;

  // Fail loud if an address the backend depends on is missing or malformed.
  getAddress(raw.sepolia.RosterPublisher);
  getAddress(raw.devnet.RosterRegistry);
  getAddress(raw.devnet.VoxyWallet);
  if (raw.devnet.chainId !== 1337) throw new Error("devnet chainId must be 1337");
  if (raw.sepolia.chainId !== 11155111) throw new Error("sepolia chainId must be 11155111");

  cached = raw;
  return raw;
}
