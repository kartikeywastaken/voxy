import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { loadDeployments } from "./deployments.js";

/**
 * viem chain + client factories for the two EVM chains the backend drives. RPC URLs come from
 * deployments.json (overridable by env), never hardcoded in callers.
 */

const d = loadDeployments();

export const sepolia: Chain = defineChain({
  id: d.sepolia.chainId,
  name: "sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.SEPOLIA_RPC_URL || d.sepolia.rpc] } },
  blockExplorers: { default: { name: "etherscan", url: d.sepolia.explorer } },
});

export const devnet: Chain = defineChain({
  id: d.devnet.chainId,
  name: "altmempool-devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.DEVNET_RPC_URL || d.devnet.rpc] } },
  blockExplorers: { default: { name: "altmempool", url: d.devnet.explorer } },
});

export function sepoliaReader() {
  return createPublicClient({ chain: sepolia, transport: http() });
}

export function devnetReader() {
  return createPublicClient({ chain: devnet, transport: http() });
}

export function devnetWallet(account: Account) {
  // --legacy equivalent: the devnet rejected EIP-1559 fields in earlier testing.
  return createWalletClient({ chain: devnet, transport: http(), account });
}

export function sepoliaWallet(account: Account) {
  return createWalletClient({ chain: sepolia, transport: http(), account });
}
