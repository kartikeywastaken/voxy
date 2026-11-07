import { randomBytes } from "node:crypto";
import {
  type Address,
  address,
  domainFields,
  type EOARecovery,
  ensRosterAbi,
  eoaChainId,
  eoaDomain,
  eoaRecoveryHash,
  eoaTypes,
  type Hex,
  hashRoster,
  hex,
  parseEnrollment,
  parseEOARecovery,
  record,
  recoveryAccountAbi,
  recoveryTypedData,
  stringify,
  uint,
} from "@voxy/chain";
import {
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  hashTypedData,
  keccak256,
  parseEther,
  recoverTypedDataAddress,
  type SignedAuthorization,
  zeroAddress,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { eoaConfig, eoaReader, publicNetwork, sponsorAccount } from "./eoa-config.js";
import { relay } from "./eoa-sponsor.js";
import { eoaDB } from "./eoa-store.js";
import { resolveGuardian } from "./guardians.js";

export async function verifiedDeployment() {
  const cfg = eoaConfig();
  const reader = eoaReader();
  const [chainId, implementation, source] = await Promise.all([
    reader.getChainId(),
    reader.getCode({ address: cfg.implementation }),
    reader.getCode({ address: cfg.rosterSource }),
  ]);
  if (
    chainId !== eoaChainId ||
    !implementation ||
    !source ||
    keccak256(implementation) !== cfg.implementationCodeHash ||
    keccak256(source) !== cfg.rosterCodeHash
  )
    throw new Error("Recovery deployment or chain does not match its verified manifest");
  return cfg;
}
export async function accountState(account: Address, controller?: Address) {
  const cfg = await verifiedDeployment();
  const reader = eoaReader();
  const [balance, code, block] = await Promise.all([
    reader.getBalance({ address: account }),
    reader.getCode({ address: account }),
    reader.getBlock(),
  ]);
  const delegated = code?.toLowerCase() === `0xef0100${cfg.implementation.slice(2).toLowerCase()}`;
  const base = {
    account,
    balance: balance.toString(),
    balanceETH: formatEther(balance),
    delegated,
    otherDelegation: !!code && code !== "0x" && !delegated,
    explorer: `${cfg.explorer}/address/${account}`,
    observedBlock: block.number.toString(),
    timestamp: Number(block.timestamp),
    configured: false as const,
    chain: publicNetwork(),
  };
  if (!delegated) return base;
  const contract = { address: account, abi: recoveryAccountAbi } as const;
  const configured = await reader.readContract({ ...contract, functionName: "configured" });
  if (!configured) return base;
  const [roster, registry, ownerEpoch, delay, frozen, pending, executionNonce, controls] =
    await Promise.all([
      reader.readContract({
        address: cfg.rosterSource,
        abi: ensRosterAbi,
        functionName: "readRoster",
        args: [account],
      }),
      reader.readContract({
        address: cfg.rosterSource,
        abi: ensRosterAbi,
        functionName: "registryOf",
        args: [account],
      }),
      reader.readContract({ ...contract, functionName: "ownerEpoch" }),
      reader.readContract({ ...contract, functionName: "recoveryDelay" }),
      reader.readContract({ ...contract, functionName: "frozen" }),
      reader.readContract({ ...contract, functionName: "pending" }),
      reader.readContract({ ...contract, functionName: "executionNonce" }),
      controller
        ? reader.readContract({ ...contract, functionName: "isController", args: [controller] })
        : Promise.resolve(false),
    ]);
  const [guardians, threshold, expiresAt] = roster;
  return {
    ...base,
    configured: true as const,
    guardians,
    threshold,
    expiresAt: expiresAt.toString(),
    registry,
    ownerEpoch: ownerEpoch.toString(),
    delay: Number(delay),
    frozen,
    rosterHash: hashRoster(guardians, threshold),
    executionNonce: executionNonce.toString(),
    controls,
    pending:
      pending.key !== zeroAddress
        ? {
            controller: pending.key,
            requestId: pending.requestId,
            readyAt: Number(pending.readyAt),
            rosterHash: pending.rosterHash,
            invalidated:
              pending.rosterHash !== hashRoster(guardians, threshold) ||
              pending.ownerEpoch !== ownerEpoch,
          }
        : null,
  };
}
export function browserTypedData(input: ReturnType<typeof recoveryTypedData>) {
  return { ...input, types: { EIP712Domain: domainFields, ...input.types } };
}
export async function prepareEnrollment(input: Record<string, unknown>) {
  const cfg = await verifiedDeployment();
  const account = address(input.account);
  const state = await accountState(account);
  if (state.otherDelegation)
    throw new Error(
      "This account already delegates to another implementation; enrollment will not replace it",
    );
  if (state.configured) throw new Error("This account already has recovery enabled");
  if (
    !Array.isArray(input.guardians) ||
    input.guardians.length < 1 ||
    input.guardians.length > 3 ||
    input.guardians.some((g) => typeof g !== "string")
  )
    throw new Error("Choose one to three guardians");
  const resolved = await Promise.all(input.guardians.map((g) => resolveGuardian(String(g))));
  if (
    resolved.some((g) => !g || g === account || g === zeroAddress) ||
    new Set(resolved).size !== resolved.length
  )
    throw new Error("Guardians must be different, nonzero addresses other than this account");
  const guardians = [...resolved] as Address[];
  const threshold = Math.floor(guardians.length / 2) + 1;
  while (guardians.length < 3) guardians.push(zeroAddress);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const message = {
    account,
    implementation: cfg.implementation,
    guardian0: guardians[0]!,
    guardian1: guardians[1]!,
    guardian2: guardians[2]!,
    threshold,
    delay: BigInt(cfg.delay),
    expiresAt: now + 365n * 86400n,
    deadline: now + 600n,
  };
  const nonce =
    (await eoaReader().getTransactionCount({ address: account, blockTag: "pending" })) +
    (sponsorAccount().address === account ? 1 : 0);
  return {
    message,
    typedData: {
      domain: eoaDomain(account),
      types: { EIP712Domain: domainFields, Enrollment: eoaTypes.Enrollment },
      primaryType: "Enrollment",
      message,
    },
    authorization: { address: cfg.implementation, chainId: eoaChainId, nonce },
  };
}
export async function enrollAccount(input: Record<string, unknown>) {
  const cfg = await verifiedDeployment();
  const message = parseEnrollment(input.message);
  const signature = hex(input.signature, 65);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (
    message.implementation !== cfg.implementation ||
    message.delay !== 180n ||
    message.deadline < now ||
    message.deadline > now + 900n ||
    message.expiresAt < now + 86400n ||
    message.expiresAt > now + 367n * 86400n
  )
    throw new Error("Enrollment expired or does not match the requested recovery policy");
  const data = {
    domain: eoaDomain(message.account),
    types: { Enrollment: eoaTypes.Enrollment },
    primaryType: "Enrollment" as const,
    message,
  };
  if ((await recoverTypedDataAddress({ ...data, signature })) !== message.account)
    throw new Error("The protected account must sign its enrollment");
  const auth = record(input.authorization);
  const signed: SignedAuthorization = {
    address: address(auth.address),
    chainId: Number(uint(String(auth.chainId))),
    nonce: Number(uint(String(auth.nonce))),
    yParity: Number(uint(String(auth.yParity), 8)),
    r: hex(auth.r, 32),
    s: hex(auth.s, 32),
  };
  if (
    signed.address !== cfg.implementation ||
    signed.chainId !== eoaChainId ||
    !Number.isSafeInteger(signed.nonce) ||
    (signed.yParity !== 0 && signed.yParity !== 1) ||
    (await recoverAuthorizationAddress({ authorization: signed })) !== message.account
  )
    throw new Error("Invalid EIP-7702 owner authorization");
  const id = `enroll-${hashTypedData(data)}`;
  // relay() returns an existing operation before checking its now-consumed authorization nonce.
  const tx = {
    to: message.account,
    data: encodeFunctionData({
      abi: recoveryAccountAbi,
      functionName: "enroll",
      args: [message, signature],
    }),
    authorizationList: [signed],
  };
  return relay(id, message.account, tx);
}
export async function prepareEOARecovery(account: Address, newController: Address) {
  const state = await accountState(account, newController);
  if (
    !state.configured ||
    !state.rosterHash ||
    state.frozen ||
    (state.pending && !state.pending.invalidated) ||
    state.controls ||
    state.guardians.filter((g) => g !== zeroAddress).length < state.threshold
  )
    throw new Error(
      "Recovery cannot start: check protection, current controller and pending recovery state",
    );
  const message = {
    chainId: BigInt(eoaChainId),
    account,
    newController,
    ownerEpoch: BigInt(state.ownerEpoch!),
    rosterHash: state.rosterHash,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
    requestId: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  return {
    message,
    typedData: browserTypedData(recoveryTypedData(message)),
    guardians: state.guardians,
    threshold: state.threshold,
  };
}
export async function liveRecovery(message: EOARecovery) {
  const state = await accountState(message.account, message.newController);
  if (
    !state.configured ||
    message.chainId !== BigInt(eoaChainId) ||
    message.ownerEpoch.toString() !== state.ownerEpoch ||
    message.rosterHash !== state.rosterHash ||
    message.deadline < BigInt(state.timestamp) ||
    state.controls ||
    state.frozen
  )
    throw new Error("Recovery request is stale, expired or no longer matches the account");
  return state;
}
export async function verifiedSignatures(message: EOARecovery, signatures: Hex[]) {
  const state = await liveRecovery(message);
  const valid = new Map<Address, Hex>();
  for (const signature of signatures) {
    const signer = await recoverTypedDataAddress({ ...recoveryTypedData(message), signature });
    if (!state.guardians?.includes(signer))
      throw new Error("Signature is not from an active guardian of this account");
    valid.set(signer, signature);
  }
  return { state, approvals: [...valid].map(([guardian, signature]) => ({ guardian, signature })) };
}
export async function submitEOARecovery(message: EOARecovery, signatures: Hex[]) {
  const { state, approvals } = await verifiedSignatures(message, signatures);
  if (approvals.length < state.threshold!) throw new Error("Guardian quorum has not been reached");
  return relay(`recover-${message.requestId}`, message.account, {
    to: message.account,
    data: encodeFunctionData({
      abi: recoveryAccountAbi,
      functionName: "requestRecovery",
      args: [message, approvals.map((a) => a.signature)],
    }),
  });
}
export async function finalizeEOA(account: Address) {
  const state = await accountState(account);
  if (
    !state.configured ||
    !(state.pending && !state.pending.invalidated) ||
    state.frozen ||
    state.timestamp < state.pending.readyAt
  )
    throw new Error("The on-chain recovery waiting period is not finished");
  return relay(`finalize-${state.pending.requestId}`, account, {
    to: account,
    data: encodeFunctionData({ abi: recoveryAccountAbi, functionName: "executeRecovery" }),
  });
}
const callType = [
  {
    type: "tuple[]",
    components: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;
type AccountCall = { to: Address; value: bigint; data: Hex };
async function executionPlan(account: Address, calls: AccountCall[]) {
  const state = await accountState(account);
  if (!state.configured) throw new Error("Recovery is not enabled for this account");
  const message = {
    account,
    callsHash: keccak256(encodeAbiParameters(callType, [calls])),
    nonce: BigInt(state.executionNonce),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  return {
    calls,
    message,
    typedData: {
      domain: eoaDomain(account),
      types: { EIP712Domain: domainFields, Execution: eoaTypes.Execution },
      primaryType: "Execution",
      message,
    },
  };
}
async function executePlan(account: Address, calls: AccountCall[], input: Record<string, unknown>) {
  const sent = record(input.message);
  const message = {
    account: address(sent.account),
    callsHash: hex(sent.callsHash, 32),
    nonce: uint(sent.nonce, 256),
    deadline: uint(sent.deadline),
  };
  const signature = hex(input.signature, 65);
  if (
    message.account !== account ||
    message.callsHash !== keccak256(encodeAbiParameters(callType, [calls]))
  )
    throw new Error("The signed action does not match its calls");
  const id = `send-${message.account}-${message.nonce}-${message.callsHash}`;
  const transaction = {
    to: account,
    data: encodeFunctionData({
      abi: recoveryAccountAbi,
      functionName: "executeSigned",
      args: [calls, message.nonce, message.deadline, signature],
    }),
  };
  if (eoaDB().prepare("SELECT id FROM eoa_operations WHERE id=?").get(id))
    return relay(id, account, transaction);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (message.deadline < now || message.deadline > now + 900n)
    throw new Error("The action signature expired; review it again");
  const signer = await recoverTypedDataAddress({
    domain: eoaDomain(account),
    types: { Execution: eoaTypes.Execution },
    primaryType: "Execution",
    message,
    signature,
  });
  const state = await accountState(account, signer);
  if (!state.configured || !state.controls || BigInt(state.executionNonce) !== message.nonce)
    throw new Error("Only a current controller can sign the next account action");
  return relay(id, account, transaction);
}
function transferCall(input: Record<string, unknown>) {
  const account = address(input.account),
    to = address(input.to);
  if (
    to === account ||
    typeof input.amount !== "string" ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(input.amount)
  )
    throw new Error("Enter a valid destination and ETH amount");
  const value = parseEther(input.amount);
  if (value <= 0n || value >= 1n << 256n) throw new Error("Invalid ETH amount");
  return { account, calls: [{ to, value, data: "0x" as Hex }] };
}
export async function prepareTransfer(input: Record<string, unknown>) {
  const { account, calls } = transferCall(input);
  const state = await accountState(account);
  if (calls[0]!.value > BigInt(state.balance))
    throw new Error("The transfer exceeds the account balance");
  return executionPlan(account, calls);
}
export async function sendTransfer(input: Record<string, unknown>) {
  const { account, calls } = transferCall(input);
  return executePlan(account, calls, input);
}
async function controllerCalls(input: Record<string, unknown>) {
  const account = address(input.account);
  if (input.action === "cancel" || input.action === "freeze" || input.action === "unfreeze") {
    const data =
      input.action === "cancel"
        ? encodeFunctionData({ abi: recoveryAccountAbi, functionName: "cancelRecovery" })
        : encodeFunctionData({
            abi: recoveryAccountAbi,
            functionName: "setFrozen",
            args: [input.action === "freeze"],
          });
    return {
      account,
      calls: [{ to: account, value: 0n, data }],
      actionInput: { account, action: input.action },
    };
  }
  if (
    input.action !== "guardians" ||
    !Array.isArray(input.guardians) ||
    input.guardians.length < 1 ||
    input.guardians.length > 3 ||
    input.guardians.some((g) => typeof g !== "string")
  )
    throw new Error("Choose one to three guardians");
  const resolved = await Promise.all(input.guardians.map((g) => resolveGuardian(String(g))));
  if (
    resolved.some((g) => !g || g === account || g === zeroAddress) ||
    new Set(resolved).size !== resolved.length
  )
    throw new Error("Guardians must be distinct addresses other than the account");
  const threshold = Math.floor(resolved.length / 2) + 1;
  const guardians = [...resolved] as Address[];
  while (guardians.length < 3) guardians.push(zeroAddress);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = input.expiresAt ? uint(input.expiresAt) : now + 365n * 86400n;
  if (expiresAt < now + 86400n || expiresAt > now + 367n * 86400n)
    throw new Error("Guardian expiry must be within the next year");
  const cfg = await verifiedDeployment();
  const data = encodeFunctionData({
    abi: ensRosterAbi,
    functionName: "setGuardians",
    args: [guardians as [Address, Address, Address], threshold, expiresAt],
  });
  return {
    account,
    calls: [{ to: cfg.rosterSource, value: 0n, data }],
    actionInput: {
      account,
      action: "guardians",
      guardians: resolved,
      expiresAt: expiresAt.toString(),
    },
    threshold,
  };
}
export async function prepareControllerAction(input: Record<string, unknown>) {
  const result = await controllerCalls(input);
  return {
    ...(await executionPlan(result.account, result.calls)),
    actionInput: result.actionInput,
    threshold: result.threshold,
  };
}
export async function sendControllerAction(input: Record<string, unknown>) {
  const result = await controllerCalls(record(input.actionInput));
  return executePlan(result.account, result.calls, input);
}
