import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Transport,
} from "viem";
import { loadDeployments } from "./deployments.js";

/**
 * viem chain + client factories for the two EVM chains the backend drives. RPC URLs come from
 * deployments.json (overridable by env), never hardcoded in callers.
 *
 * Hardening: public RPCs (e.g. publicnode) lag and drop requests, which bit the live flows. Every
 * transport here retries, times out, and supports a comma-separated list of URLs with automatic
 * failover, so a single flaky endpoint can't fail the pipeline.
 */

const d = loadDeployments();

/** Build a resilient transport from one or more comma-separated RPC URLs. */
function transportFor(urls: string): Transport {
  const [first, ...rest] = urls
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => http(u, { retryCount: 4, retryDelay: 400, timeout: 20_000 }));
  if (!first) throw new Error("No RPC URL configured");
  return rest.length > 0 ? fallback([first, ...rest], { retryCount: 1 }) : first;
}

const sepoliaTransport = () => transportFor(process.env.SEPOLIA_RPC_URL || d.sepolia.rpc);
const devnetTransport = () => transportFor(process.env.DEVNET_RPC_URL || d.devnet.rpc);

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
  return createPublicClient({ chain: sepolia, transport: sepoliaTransport() });
}

export function devnetReader() {
  return createPublicClient({ chain: devnet, transport: devnetTransport() });
}

export function devnetWallet(account: Account) {
  return createWalletClient({ chain: devnet, transport: devnetTransport(), account });
}

export function sepoliaWallet(account: Account) {
  return createWalletClient({ chain: sepolia, transport: sepoliaTransport(), account });
}
