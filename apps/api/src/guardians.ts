import {
  type Address,
  type Hex,
  loadDeployments,
  rosterPublisherAbi,
  sepolia,
  sepoliaReader,
  sepoliaWallet,
  thresholdResolverAbi,
  userRegistryAbi,
} from "@voxy/chain";
import {
  buildAttestation,
  readDevnetRoster,
  readSepoliaRoster,
  signAttestation,
  submitRoster,
} from "@voxy/attester";
import { createPublicClient, http, isAddress, keccak256, toBytes, getAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia as canonicalSepolia } from "viem/chains";
import { normalize } from "viem/ens";

const SLOTS = ["g1", "g2", "g3"] as const;
// The text-record node the RosterPublisher reads the threshold from (matches EnsSetup: a plain
// keccak of the string, NOT a namehash).
const NODE = keccak256(toBytes("voxy.eth"));

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`Server missing ${name}`);
  return v as Hex;
}

const admin = () => privateKeyToAccount(pk("SEPOLIA_DEPLOYER_PK"));

/** Resolve a guardian input (a 0x… address or a `name.eth`) to a checksummed address; "" clears. */
export async function resolveGuardian(value: string): Promise<Address | null> {
  const v = value.trim();
  if (!v) return null;
  if (isAddress(v)) return getAddress(v);
  if (v.toLowerCase().endsWith(".eth")) {
    const ens = createPublicClient({
      chain: canonicalSepolia,
      transport: http(process.env.SEPOLIA_RPC_URL || loadDeployments().sepolia.rpc),
    });
    const addr = await ens.getEnsAddress({ name: normalize(v) });
    if (!addr || addr === zeroAddress) {
      throw new Error(`ENS name "${v}" does not resolve to an address on Sepolia`);
    }
    return getAddress(addr);
  }
  throw new Error(`"${v}" is neither a 0x… address nor a .eth name`);
}

/** Current guardian roster as the live ENS layer reports it, plus the devnet-synced epoch. */
export async function guardianConfig() {
  const d = loadDeployments();
  const acct = d.sepolia.rosterAccount as Address;
  const [sep, dev] = await Promise.all([readSepoliaRoster(acct), readDevnetRoster()]);
  return {
    account: acct,
    registry: d.sepolia.UserRegistry,
    slots: SLOTS.map((label, i) => ({ label, guardian: sep.guardians[i] })),
    guardians: sep.guardians,
    threshold: sep.threshold,
    rosterHash: sep.rosterHash,
    devnetEpoch: Number(dev.epoch),
    devnetGuardians: dev.guardians,
    explorer: d.sepolia.explorer,
  };
}

async function sendSepolia(
  label: string,
  // biome-ignore lint/suspicious/noExplicitAny: viem write args are per-call
  params: any,
): Promise<{ hash: Hex; explorer: string }> {
  const d = loadDeployments();
  const wallet = sepoliaWallet(admin());
  const hash = (await wallet.writeContract({ chain: sepolia, ...params })) as Hex;
  const receipt = await sepoliaReader().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  return { hash, explorer: `${d.sepolia.explorer}/tx/${hash}` };
}

/**
 * Set the guardian roster on the live ENSv2 layer, then sync it cross-chain to the devnet so the
 * recovery wallet enforces it. `guardians` is the full desired roster (3 entries; each a 0x…
 * address, a name.eth, or "" to clear a slot). Only changed slots are written. Every step is a
 * real transaction: Sepolia (register/unregister/threshold/publish) then an attested devnet sync.
 */
export async function setGuardians(input: { guardians: string[]; threshold?: number }) {
  const d = loadDeployments();
  const registry = d.sepolia.UserRegistry as Address;
  const resolver = d.sepolia.ThresholdResolver as Address;
  const publisher = d.sepolia.RosterPublisher as Address;
  const account = d.sepolia.rosterAccount as Address;

  if (!Array.isArray(input.guardians) || input.guardians.length !== 3) {
    throw new Error("guardians must be an array of 3 entries (address, name.eth, or \"\")");
  }

  // 1. Resolve every input to an address (or null to clear).
  const resolved = await Promise.all(input.guardians.map((g) => resolveGuardian(String(g ?? ""))));
  const nonEmpty = resolved.filter((a) => a).length;
  const current = await readSepoliaRoster(account);
  const threshold = input.threshold ?? current.threshold;
  if (threshold < 1 || threshold > 3) throw new Error("threshold must be 1..3");
  if (threshold > nonEmpty) throw new Error(`threshold ${threshold} exceeds ${nonEmpty} guardians`);

  const reader = sepoliaReader();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const sepoliaTxs: Array<{ op: string; slot: string; hash: string; explorer: string }> = [];

  // 2. Apply only the slots that actually change.
  for (let i = 0; i < 3; i++) {
    const label = SLOTS[i];
    const want = resolved[i];
    const have = current.guardians[i];
    const haveSet = have && have !== zeroAddress;
    if ((want ?? zeroAddress).toLowerCase() === (have ?? zeroAddress).toLowerCase()) continue;

    if (haveSet) {
      const tokenId = (await reader.readContract({
        address: registry,
        abi: userRegistryAbi,
        functionName: "findTokenId",
        args: [label],
      })) as bigint;
      const r = await sendSepolia(`unregister ${label}`, {
        address: registry,
        abi: userRegistryAbi,
        functionName: "unregister",
        args: [tokenId],
      });
      sepoliaTxs.push({ op: "unregister", slot: label, ...r });
    }
    if (want) {
      const r = await sendSepolia(`register ${label}`, {
        address: registry,
        abi: userRegistryAbi,
        functionName: "register",
        args: [label, want, zeroAddress, resolver, 0n, expiry],
      });
      sepoliaTxs.push({ op: "register", slot: label, ...r });
    }
  }

  // 3. Threshold policy (text record) if it changed.
  let thresholdTx: { hash: string; explorer: string } | undefined;
  if (threshold !== current.threshold) {
    thresholdTx = await sendSepolia("setText threshold", {
      address: resolver,
      abi: thresholdResolverAbi,
      functionName: "setText",
      args: [NODE, "voxy.threshold", String(threshold)],
    });
  }

  if (!sepoliaTxs.length && !thresholdTx) {
    return { changed: false, message: "Roster already matches the requested guardians.", ...(await guardianConfig()) };
  }

  // 4. Emit a real RosterChanged (best-effort; the sync below reads the live roster regardless).
  let publishTx: { hash: string; explorer: string } | undefined;
  try {
    publishTx = await sendSepolia("publish", {
      address: publisher,
      abi: rosterPublisherAbi,
      functionName: "publish",
      args: [account],
    });
  } catch {
    /* publish is advisory; a no-op/revert must not block the sync */
  }

  // 5. Attested cross-chain sync so the devnet recovery wallet sees the new roster.
  const currentDevnet = await readDevnetRoster();
  const epoch = currentDevnet.epoch + 1n;
  const attestation = await buildAttestation(epoch);
  const a1 = await signAttestation(pk("ATTESTER_1_PK"), attestation);
  const a2 = await signAttestation(pk("ATTESTER_2_PK"), attestation);
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const sync = await submitRoster(payer, attestation, [a1.signature, a2.signature]);

  return {
    changed: true,
    resolved: input.guardians.map((input, i) => ({ input, address: resolved[i] })),
    sepoliaTxs,
    thresholdTx,
    publishTx,
    syncTx: { ...sync, epoch: Number(epoch) },
    ...(await guardianConfig()),
  };
}
