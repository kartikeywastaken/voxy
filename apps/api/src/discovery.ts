import { type Address, devnetReader, type Hex, loadDeployments, voxyWalletAbi } from "@voxy/chain";
import { getAddress, parseAbiItem } from "viem";
import { voxyWalletRuntime, walletImmutableRanges } from "./voxywallet-bytecode.js";

export function isWalletRuntime(code: Hex) {
  let normalized = code.toLowerCase();
  for (const { start, length } of walletImmutableRanges) {
    const offset = 2 + start * 2;
    normalized =
      normalized.slice(0, offset) + "0".repeat(length * 2) + normalized.slice(offset + length * 2);
  }
  return normalized === voxyWalletRuntime.toLowerCase();
}

export async function isVoxyWallet(wallet: Address) {
  const reader = devnetReader();
  const code = await reader.getCode({ address: wallet });
  if (!code || !isWalletRuntime(code)) return false;
  const registry = await reader.readContract({
    address: wallet,
    abi: [
      {
        type: "function",
        name: "registry",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address" }],
      },
    ],
    functionName: "registry",
  });
  return registry.toLowerCase() === loadDeployments().devnet.RosterRegistry.toLowerCase();
}

// shortcut: scan the devnet history in bounded RPC pages; add a persistent event index when the chain grows.
/** Rebuild ownership from chain history, including accounts deployed before this fix. */
export async function walletsForOwner(owner: Address) {
  const reader = devnetReader();
  const head = await reader.getBlockNumber({ cacheTime: 0 });
  const candidates = new Set<Address>();
  for (let fromBlock = 0n; fromBlock <= head; fromBlock += 2000n) {
    const logs = await reader.getLogs({
      event: parseAbiItem("event OwnerAdded(address indexed wallet, address owner)"),
      fromBlock,
      // biome-ignore lint/complexity/useMathMinMax: Math.min does not accept bigint.
      toBlock: fromBlock + 1999n > head ? head : fromBlock + 1999n,
      strict: true,
    });
    for (const log of logs) {
      if (
        log.args.owner.toLowerCase() === owner.toLowerCase() &&
        log.address.toLowerCase() === log.args.wallet.toLowerCase()
      ) {
        candidates.add(getAddress(log.address));
      }
    }
  }
  const wallets: Address[] = [];
  for (const wallet of candidates) {
    if (!(await isVoxyWallet(wallet))) continue;
    if (
      await reader.readContract({
        address: wallet,
        abi: voxyWalletAbi,
        functionName: "isOwner",
        args: [owner],
      })
    )
      wallets.push(wallet);
  }
  return wallets;
}
