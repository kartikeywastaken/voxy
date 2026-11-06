import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type LocalAccount } from "viem";
import { required } from "./env.js";

export function arkivClients(account?: LocalAccount) {
  if (process.env.ARKIV_CHAIN_ID && process.env.ARKIV_CHAIN_ID !== "7794095") {
    throw new Error("ARKIV_CHAIN_ID must be 7794095 (Rabdi)");
  }
  const chain = rabdi({ accessKey: required("ARKIV_ACCESS_KEY") });
  const transport = http(undefined, {
    retryCount: 0,
    timeout: 15_000,
    fetchOptions: { cache: "no-store", redirect: "error" },
  });
  return {
    chain,
    reader: createPublicClient({ chain, transport, cacheTime: 0 }),
    wallet: account ? createWalletClient({ chain, transport, account, cacheTime: 0 }) : undefined,
  };
}

export async function networkStatus() {
  const { reader } = arkivClients();
  const [chainId, block] = await Promise.all([
    reader.getChainId(),
    reader.getBlock({ blockTag: "latest" }),
  ]);
  if (chainId !== 7794095) throw new Error("RPC is not Rabdi");
  return { chainId, blockNumber: block.number, blockTimestamp: block.timestamp };
}
