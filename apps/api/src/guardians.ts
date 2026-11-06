import {
  buildAttestation,
  readDevnetRoster,
  readSepoliaRoster,
  signAttestation,
  submitRoster,
} from "@voxy/attester";
import {
  type Address,
  devnetReader,
  type Hex,
  loadDeployments,
  rosterPublisherAbi,
  sepolia,
  sepoliaReader,
  sepoliaWallet,
  thresholdResolverAbi,
  userRegistryAbi,
  voxyWalletAbi,
} from "@voxy/chain";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  recoverMessageAddress,
  toBytes,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia as canonicalSepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { isVoxyWallet } from "./discovery.js";

const SLOTS = ["g1", "g2", "g3"] as const;

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
  // strict:false so a lowercase / non-checksummed address is still accepted; getAddress checksums it.
  if (isAddress(v, { strict: false })) return getAddress(v);
  if (v.toLowerCase().endsWith(".eth")) {
    const ens = createPublicClient({
      chain: canonicalSepolia,
      transport: http(process.env.SEPOLIA_RPC_URL || loadDeployments().sepolia.rpc),
    });
    const addr = await ens.getEnsAddress({ name: normalize(v) });
    if (!addr || addr === zeroAddress) {
      throw new Error(
        `ENS name "${v}" does not resolve on Sepolia. Only Sepolia-registered names work here — a mainnet name won't. Use a 0x… address instead.`,
      );
    }
    return getAddress(addr);
  }
  throw new Error(`"${v}" is neither a 0x… address nor a .eth name`);
}

export async function rosterSource(wallet: Address) {
  const d = loadDeployments();
  const account =
    wallet.toLowerCase() === d.devnet.VoxyWallet.toLowerCase() ? d.sepolia.rosterAccount : wallet;
  const [registry, resolver, node, configured] = await sepoliaReader().readContract({
    address: d.sepolia.RosterPublisher,
    abi: rosterPublisherAbi,
    functionName: "configOf",
    args: [account],
  });
  return { account, registry, resolver, node, configured };
}

/** Read this account's source, never fall back to another account's guardians. */
export async function guardianConfig(wallet?: Address) {
  const d = loadDeployments();
  const w = wallet ?? d.devnet.VoxyWallet;
  const source = await rosterSource(w);
  const dev = await readDevnetRoster(w);
  const sep = source.configured ? await readSepoliaRoster(source.account) : null;
  const guardians = sep?.guardians ?? [zeroAddress, zeroAddress, zeroAddress];
  return {
    ...source,
    wallet: w,
    slots: SLOTS.map((label, i) => ({ label, guardian: guardians[i] })),
    guardians,
    threshold: sep?.threshold ?? 0,
    rosterHash: sep?.rosterHash ?? null,
    devnetEpoch: Number(dev.epoch),
    devnetGuardians: dev.guardians,
    explorer: d.sepolia.explorer,
    sharedLegacy:
      w.toLowerCase() !== d.devnet.VoxyWallet.toLowerCase() &&
      source.registry.toLowerCase() === d.sepolia.UserRegistry.toLowerCase(),
  };
}

export async function guardianIntent(
  wallet: Address,
  guardians: string[],
  threshold?: number,
  validUntil = Math.floor(Date.now() / 1000) + 300,
) {
  if (!(await isVoxyWallet(wallet))) throw new Error("Select a Voxy account");
  const config = await guardianConfig(wallet);
  return JSON.stringify({
    action: "Set Voxy guardians",
    chainId: loadDeployments().devnet.chainId,
    wallet: getAddress(wallet),
    guardians,
    threshold: threshold ?? null,
    registry: config.registry,
    previousRosterHash: config.rosterHash,
    validUntil,
  });
}

export async function authorizeGuardians(input: {
  wallet: Address;
  guardians: string[];
  threshold?: number;
  message: string;
  signature: `0x${string}`;
}) {
  const intent = JSON.parse(input.message);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(intent.validUntil) ||
    intent.validUntil < now ||
    intent.validUntil > now + 300
  )
    throw new Error("Guardian authorization expired; sign again");
  if (
    input.message !==
    (await guardianIntent(input.wallet, input.guardians, input.threshold, intent.validUntil))
  )
    throw new Error("Roster changed or authorization does not match");
  const signer = await recoverMessageAddress({
    message: input.message,
    signature: input.signature,
  });
  if (
    !(await devnetReader().readContract({
      address: input.wallet,
      abi: voxyWalletAbi,
      functionName: "isOwner",
      args: [signer],
    }))
  )
    throw new Error("Only an account owner can change guardians");
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
export async function setGuardians(input: {
  guardians: string[];
  threshold?: number;
  wallet?: string;
}) {
  const d = loadDeployments();
  if (!input.wallet || !isAddress(input.wallet, { strict: false }))
    throw new Error("wallet is required");
  const syncWallet = getAddress(input.wallet);
  if (!(await isVoxyWallet(syncWallet))) throw new Error("Not a Voxy account");
  let source = await rosterSource(syncWallet);
  const demo = syncWallet.toLowerCase() === d.devnet.VoxyWallet.toLowerCase();
  const publisher = d.sepolia.RosterPublisher;
  if (!Array.isArray(input.guardians) || input.guardians.length !== 3) {
    throw new Error('guardians must be an array of 3 entries (address, name.eth, or "")');
  }

  // 1. Resolve every input to an address (or null to clear).
  const resolved = await Promise.all(input.guardians.map((g) => resolveGuardian(String(g ?? ""))));
  const nonEmpty = resolved.filter((a) => a).length;
  const unique = new Set(
    resolved.filter((a): a is Address => a !== null).map((a) => a.toLowerCase()),
  );
  if (unique.size !== nonEmpty) throw new Error("Each guardian must be a different address");
  if (resolved.some((a) => a === zeroAddress))
    throw new Error("Use an empty slot instead of the zero address");
  // Default to a majority of the configured guardians (2-of-3, 3-of-5, …) so the user never has
  // to pick a quorum; an explicit threshold still wins.
  const majority = nonEmpty <= 0 ? 1 : Math.floor(nonEmpty / 2) + 1;
  const threshold = input.threshold ?? majority;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 3)
    throw new Error("threshold must be 1..3");
  if (threshold > nonEmpty) throw new Error(`threshold ${threshold} exceeds ${nonEmpty} guardians`);

  // Each account gets its own ENSv2 namespace. Legacy shared demo pointers are detached.
  if (
    !source.configured ||
    (!demo && source.registry.toLowerCase() === d.sepolia.UserRegistry.toLowerCase())
  ) {
    const implementation = d.sepolia.ensv2.UserRegistryImpl;
    const factory = d.sepolia.ensv2.VerifiableFactory;
    if (!implementation || !factory) throw new Error("ENSv2 factory deployment is missing");
    const factoryAbi = [
      {
        type: "function",
        name: "deployProxy",
        stateMutability: "nonpayable",
        inputs: [
          { type: "address", name: "implementation" },
          { type: "uint256", name: "salt" },
          { type: "bytes", name: "data" },
        ],
        outputs: [{ type: "address" }],
      },
    ] as const;
    const baseRoles = (1n << 0n) | (1n << 12n) | (1n << 16n) | (1n << 20n) | (1n << 24n);
    const data = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "initialize",
          stateMutability: "nonpayable",
          inputs: [{ type: "address" }, { type: "uint256" }],
          outputs: [],
        },
      ],
      functionName: "initialize",
      args: [admin().address, baseRoles | (baseRoles << 128n)],
    });
    const args = [
      implementation,
      BigInt(keccak256(toBytes(`voxy:${syncWallet}:${Date.now()}`))),
      data,
    ] as const;
    const simulated = await sepoliaReader().simulateContract({
      address: factory,
      abi: factoryAbi,
      functionName: "deployProxy",
      args,
      account: admin(),
    });
    await sendSepolia("deploy user registry", simulated.request);
    const node = keccak256(toBytes(`voxy:${syncWallet}`));
    await sendSepolia("initialize threshold", {
      address: d.sepolia.ThresholdResolver,
      abi: thresholdResolverAbi,
      functionName: "setText",
      args: [node, "voxy.threshold", "1"],
    });
    await sendSepolia("configure account roster", {
      address: publisher,
      abi: rosterPublisherAbi,
      functionName: "configure",
      args: [syncWallet, simulated.result, d.sepolia.ThresholdResolver, node],
    });
    source = await rosterSource(syncWallet);
  }
  const { registry, resolver, node, account } = source;
  const current = await readSepoliaRoster(account);
  const reader = sepoliaReader();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const sepoliaTxs: Array<{ op: string; slot: string; hash: string; explorer: string }> = [];

  // 2. Apply only the slots that actually change.
  for (const [i, label] of SLOTS.entries()) {
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
      args: [node, "voxy.threshold", String(threshold)],
    });
  }

  if (!sepoliaTxs.length && !thresholdTx) {
    const synced = await readDevnetRoster(syncWallet);
    if (synced.hash.toLowerCase() === current.rosterHash.toLowerCase()) {
      return {
        changed: false,
        message: "Guardians are already saved and synced.",
        ...(await guardianConfig(syncWallet)),
      };
    }
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
  const currentDevnet = await readDevnetRoster(syncWallet);
  const epoch = currentDevnet.epoch + 1n;
  const attestation = await buildAttestation(epoch, {
    account: syncWallet,
    sourceAccount: account,
  });
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
    ...(await guardianConfig(syncWallet)),
  };
}
