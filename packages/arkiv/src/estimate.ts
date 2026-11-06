// Guarded unsigned estimator from the installed official Arkiv skill.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { custom, http, type LocalAccount, MethodNotFoundRpcError } from "viem";

// Diagnostics contain only fixed messages and validated local transaction identifiers.
type SafeDetails = { txHash?: string; entityKey?: string; expiresAt?: bigint };
const safeErrors = new WeakMap<object, { message: string; details: SafeDetails }>();
function safeError(
  message = "Arkiv operation failed",
  details: SafeDetails = {},
): Error & SafeDetails {
  const allowed: SafeDetails = {};
  for (const field of ["txHash", "entityKey"] as const) {
    const value = details[field];
    if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) allowed[field] = value;
  }
  if (
    typeof details.expiresAt === "bigint" &&
    details.expiresAt >= 0n &&
    details.expiresAt < 2n ** 64n
  )
    allowed.expiresAt = details.expiresAt;
  const result = Object.assign(new Error(message), allowed);
  safeErrors.set(result, { message, details: { ...allowed } });
  return result;
}
function sanitizedFailure(
  error: unknown,
  fallback = "Arkiv request failed; reconcile any admitted write before retrying",
): Error & SafeDetails {
  const own = error !== null && typeof error === "object" ? safeErrors.get(error) : undefined;
  if (own) return safeError(own.message, own.details);
  // Preserve this exact cross-recipe preflight verdict, never any attached diagnostics.
  try {
    if (error instanceof Error && error.message === "Unsigned preparation/estimate failed")
      return safeError("Unsigned preparation/estimate failed");
  } catch {}
  return safeError(fallback);
}

export async function estimateWithRequest(
  account: LocalAccount,
  chain: ReturnType<typeof rabdi>,
  rpc: Parameters<typeof custom>[0],
  prepare: (wallet: ReturnType<typeof createWalletClient>) => Promise<unknown>,
): Promise<bigint> {
  try {
    if (BigInt((await rpc.request({ method: "eth_chainId" })) as string) !== 7794095n)
      throw safeError("Wrong chain");
    const reads = new Set([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getBlockByNumber",
      "eth_getTransactionCount",
      "eth_gasPrice",
      "eth_maxPriorityFeePerGas",
      "eth_estimateGas",
    ]);
    const reader = createPublicClient({
      chain,
      cacheTime: 0,
      transport: custom(rpc, { retryCount: 0 }),
    });
    let estimate: bigint | undefined;
    const stop = safeError("Unsigned estimate captured");
    const oversized = safeError("Gas exceeds half the latest block limit; split unprepared work");
    const transport = custom(
      {
        async request(args) {
          if (args.method === "eth_fillTransaction")
            throw new MethodNotFoundRpcError(safeError("Use guarded estimate path"));
          if (!reads.has(args.method)) throw safeError("Unexpected or mutating RPC blocked");
          const result = await rpc.request(
            args.method === "eth_estimateGas"
              ? { method: "eth_estimateGas", params: [args.params?.[0], "latest"] }
              : args,
          );
          if (args.method === "eth_estimateGas") {
            if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result))
              throw safeError("Invalid estimate");
            estimate = BigInt(result);
            if (estimate <= 0n) throw safeError("Invalid estimate");
            const gas = 2n * estimate > 1000000n ? 2n * estimate : 1000000n;
            const block = await reader.getBlock({ blockTag: "latest" });
            if (typeof block.gasLimit !== "bigint" || block.gasLimit <= 0n)
              throw safeError("Latest block gas limit required");
            if (gas > block.gasLimit / 2n) throw oversized;
            throw stop;
          }
          return result;
        },
      },
      { retryCount: 0 },
    );
    const unsigned = {
      ...account,
      signTransaction: async () => {
        throw safeError("Signing blocked");
      },
    };
    const wallet = createWalletClient({ account: unsigned, chain, transport });
    try {
      await prepare(wallet);
    } catch (error) {
      let cause: unknown = error;
      for (let depth = 0; cause && depth < 24; depth++) {
        if (cause === oversized) throw oversized;
        if (cause === stop && estimate !== undefined) return await estimate;
        cause = typeof cause === "object" ? (cause as { cause?: unknown }).cause : undefined;
      }
      throw safeError("Unsigned preparation/estimate failed");
    }
    throw safeError("Callback skipped estimation or swallowed the guard");
  } catch (error) {
    throw sanitizedFailure(error, "Unsigned preparation/estimate failed");
  }
}
export function estimateWrite(
  account: LocalAccount,
  accessKey: string,
  prepare: (wallet: ReturnType<typeof createWalletClient>) => Promise<unknown>,
) {
  try {
    const chain = rabdi({ accessKey });
    const rpc = http(undefined, {
      retryCount: 0,
      timeout: 10000,
      fetchOptions: { cache: "no-store", redirect: "error" },
    })({ chain });
    return estimateWithRequest(account, chain, rpc, prepare);
  } catch (error) {
    throw sanitizedFailure(error, "Unsigned preparation/estimate failed");
  }
}
