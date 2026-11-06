import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { address } from "@voxy/frame-sdk";
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  type LocalAccount,
  parseAbi,
} from "viem";
import { json } from "./env.js";
import { encodePayload, RosterSnapshots } from "./schema.js";
import { createRecord } from "./write.js";

/** Observe Claude's published Sepolia roster without submitting or modifying its ENS state. */
export async function publishSepoliaSnapshot(
  account: LocalAccount,
  source: {
    account: string;
    publisher: string;
    rpcUrl: string;
  },
) {
  const wallet = address(source.account);
  const publisher = address(source.publisher);
  const reader = createPublicClient({
    transport: http(source.rpcUrl, {
      retryCount: 0,
      timeout: 15_000,
      fetchOptions: { cache: "no-store", redirect: "error" },
    }),
    cacheTime: 0,
  });
  if ((await reader.getChainId()) !== 11155111) throw new Error("Snapshot RPC must be Sepolia");
  const block = await reader.getBlock({ blockTag: "latest" });
  if (!(await reader.getBytecode({ address: publisher, blockNumber: block.number })))
    throw new Error("Publisher is not deployed");
  const base = {
    address: publisher,
    blockNumber: block.number,
    abi: parseAbi([
      "function readRoster(address) view returns (address[3] guardians,uint8 threshold,uint64 parentExpiry)",
      "function epochOf(address) view returns (uint64)",
      "function lastHashOf(address) view returns (bytes32)",
    ]),
    args: [wallet],
  } as const;
  const [[guardians, threshold, parentExpiry], epoch, hash] = await Promise.all([
    reader.readContract({ ...base, functionName: "readRoster" }),
    reader.readContract({ ...base, functionName: "epochOf" }),
    reader.readContract({ ...base, functionName: "lastHashOf" }),
  ]);
  const observedHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint8" }],
      [...guardians, threshold],
    ),
  );
  if (epoch === 0n || observedHash !== hash)
    throw new Error("Live roster has not been published at this epoch");
  return createRecord(
    account,
    `snapshot-sepolia-${wallet.slice(2)}-${epoch}`,
    RosterSnapshots,
    {
      project: "voxy",
      type: "roster-snapshot",
      account: addr(wallet),
      epoch: u64(epoch),
      hash,
      payload: encodePayload(
        JSON.parse(
          json({
            guardians,
            threshold,
            parentExpiry,
            attestationSigs: [],
            source: {
              kind: "sepolia-publisher-observation",
              chainId: 11155111,
              publisher,
              blockNumber: block.number,
              blockHash: block.hash,
            },
            evidence: "published-roster-readback",
          }),
        ),
      ),
    },
    { expiration: ExpirationTime.fromDays(7) },
  );
}

/** Publish an actual registry observation, not a fabricated or independently attested roster. */
export async function publishRosterSnapshot(
  account: LocalAccount,
  source: {
    wallet: string;
    registry: string;
    chainId: number;
    rpcUrl: string;
  },
) {
  const wallet = address(source.wallet);
  const registry = address(source.registry);
  const reader = createPublicClient({
    transport: http(source.rpcUrl, {
      retryCount: 0,
      timeout: 15_000,
      fetchOptions: { cache: "no-store", redirect: "error" },
    }),
    cacheTime: 0,
  });
  if ((await reader.getChainId()) !== source.chainId)
    throw new Error("Snapshot RPC chain mismatch");
  const block = await reader.getBlock({ blockTag: "latest" });
  if (
    !(await reader.getBytecode({ address: wallet, blockNumber: block.number })) ||
    !(await reader.getBytecode({ address: registry, blockNumber: block.number }))
  )
    throw new Error("Snapshot contracts are not deployed");
  const actualRegistry = await reader.readContract({
    address: wallet,
    blockNumber: block.number,
    abi: parseAbi(["function registry() view returns (address)"]),
    functionName: "registry",
  });
  if (address(actualRegistry) !== registry)
    throw new Error("Wallet registry differs from configured snapshot source");
  const roster = await reader.readContract({
    address: registry,
    blockNumber: block.number,
    abi: parseAbi([
      "function rosterOf(address) view returns ((uint64 epoch,uint8 threshold,address[3] guardians,uint64[3] activeAt,bytes32 hash))",
    ]),
    functionName: "rosterOf",
    args: [wallet],
  });
  if (roster.epoch === 0n || roster.threshold < 1 || roster.threshold > 3)
    throw new Error("No valid source roster");
  return createRecord(
    account,
    `snapshot-${source.chainId}-${wallet.slice(2)}-${roster.epoch}`,
    RosterSnapshots,
    {
      project: "voxy",
      type: "roster-snapshot",
      account: addr(wallet),
      epoch: u64(roster.epoch),
      hash: roster.hash,
      payload: encodePayload(
        JSON.parse(
          json({
            guardians: roster.guardians,
            threshold: roster.threshold,
            activeAt: roster.activeAt,
            attestationSigs: [],
            source: {
              chainId: source.chainId,
              registry,
              blockNumber: block.number,
              blockHash: block.hash,
            },
            evidence: "registry-observation",
          }),
        ),
      ),
    },
    { expiration: ExpirationTime.fromDays(7) },
  );
}
