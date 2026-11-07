import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, address, eoaChainId, type Hex, loadDeployments } from "@voxy/chain";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const manifestPath = () =>
  resolve(
    process.env.VOXY_EOA_DEPLOYMENTS ||
      fileURLToPath(new URL("../../../deployments/eoa-sepolia.json", import.meta.url)),
  );
export function eoaConfig() {
  const manifest = JSON.parse(readFileSync(manifestPath(), "utf8"));
  if (manifest.chainId !== eoaChainId || manifest.version !== 2)
    throw new Error("Unsupported recovery deployment");
  return {
    implementation: address(manifest.implementation),
    rosterSource: address(manifest.rosterSource),
    implementationCodeHash: String(manifest.implementationCodeHash),
    rosterCodeHash: String(manifest.rosterCodeHash),
    delay: 180,
    explorer: "https://sepolia.etherscan.io",
    chainId: eoaChainId,
  };
}
const transport = () =>
  http(process.env.SEPOLIA_RPC_URL || loadDeployments().sepolia.rpc, {
    retryCount: 0,
    timeout: 15000,
    fetchOptions: { redirect: "error", cache: "no-store" },
  });
export const eoaReader = () =>
  createPublicClient({ chain: sepolia, transport: transport(), cacheTime: 0 });
export function sponsorAccount() {
  const key = process.env.SEPOLIA_DEPLOYER_PK?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error("Sepolia sponsor is not configured");
  return privateKeyToAccount(key as Hex);
}
export const eoaSponsor = () =>
  createWalletClient({ chain: sepolia, transport: transport(), account: sponsorAccount() });
export function publicNetwork() {
  const rpc = loadDeployments().sepolia.rpc;
  return {
    chainId: "0xaa36a7",
    chainName: "Sepolia",
    rpcUrls: [rpc],
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  };
}
export type EOAAddress = Address;
