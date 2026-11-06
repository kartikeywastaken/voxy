import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { address, type RecoveryDigest } from "./digest.js";

// Read entrypoints checked against origin/main contracts at 6b848b0. No guessed frame entrypoint.
const walletAbi = parseAbi([
  "function registry() view returns (address)",
  "function ownerEpoch() view returns (uint64)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function frozen() view returns (bool)",
  "function usedRequestId(bytes32) view returns (bool)",
]);
const rosterAbi = parseAbi([
  "function rosterOf(address) view returns ((uint64 epoch,uint8 threshold,address[3] guardians,uint64[3] activeAt,bytes32 hash))",
]);

export class RecoveryValidationError extends Error {}

export async function readRecoveryState(rpcUrl: string, message: RecoveryDigest) {
  const reader = createPublicClient({
    transport: http(rpcUrl, {
      retryCount: 0,
      timeout: 15_000,
      fetchOptions: { cache: "no-store", redirect: "error" },
    }),
    cacheTime: 0,
  });
  const chainId = await reader.getChainId();
  if (BigInt(chainId) !== message.chainId)
    throw new RecoveryValidationError("Recovery RPC chain mismatch");
  const block = await reader.getBlock({ blockTag: "latest" });
  const base = { address: message.wallet, abi: walletAbi, blockNumber: block.number };
  if (!(await reader.getBytecode({ address: message.wallet, blockNumber: block.number })))
    throw new RecoveryValidationError("Wallet is not deployed");
  const [registry, ownerEpoch, domain, frozen, used] = await Promise.all([
    reader.readContract({ ...base, functionName: "registry" }),
    reader.readContract({ ...base, functionName: "ownerEpoch" }),
    reader.readContract({ ...base, functionName: "DOMAIN_SEPARATOR" }),
    reader.readContract({ ...base, functionName: "frozen" }),
    reader.readContract({ ...base, functionName: "usedRequestId", args: [message.requestId] }),
  ]);
  const registryAddress = address(registry);
  if (!(await reader.getBytecode({ address: registryAddress, blockNumber: block.number })))
    throw new RecoveryValidationError("Registry is not deployed");
  const expectedDomain = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(
          stringToHex(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        keccak256(stringToHex("Voxy")),
        keccak256(stringToHex("1")),
        message.chainId,
        message.wallet,
      ],
    ),
  );
  if (domain !== expectedDomain)
    throw new RecoveryValidationError("Wallet signing domain mismatch");
  const roster = await reader.readContract({
    address: registryAddress,
    abi: rosterAbi,
    functionName: "rosterOf",
    args: [message.wallet],
    blockNumber: block.number,
  });
  if (
    frozen ||
    used ||
    message.deadline <= block.timestamp ||
    message.deadline <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new RecoveryValidationError("Recovery is frozen, already used or expired");
  }
  if (
    ownerEpoch !== message.ownerEpoch ||
    roster.epoch !== message.rosterEpoch ||
    roster.hash !== message.rosterHash
  ) {
    throw new RecoveryValidationError("Recovery epochs or roster hash are stale");
  }
  if (roster.threshold < 1 || roster.threshold > 3)
    throw new RecoveryValidationError("No valid roster");
  const activeGuardians = new Set<Address>();
  for (let i = 0; i < roster.guardians.length; i++) {
    const guardian = roster.guardians[i];
    const activeAt = roster.activeAt[i];
    if (guardian && activeAt && activeAt <= block.timestamp) activeGuardians.add(address(guardian));
  }
  return {
    chainId,
    wallet: message.wallet,
    registry: registryAddress,
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
    ownerEpoch,
    roster,
    activeGuardians,
  };
}

export type RecoveryState = Awaited<ReturnType<typeof readRecoveryState>>;
