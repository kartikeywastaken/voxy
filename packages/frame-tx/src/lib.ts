import { toWire as libToWire } from "@forshtat/hegota-support/rpc";
import type { Frame, FrameTx } from "@forshtat/hegota-support/tx";
import * as lib from "@forshtat/hegota-support/tx";
import { type Address, encodeFunctionData, type Hex } from "viem";
import { profile } from "./profile.js";

/** One frame of the given mode. `target: null` targets the tx sender. */
export function frame(
  mode: "VERIFY" | "SENDER",
  scope: string | undefined,
  target: Address | null,
  execution: bigint,
  opts: { value?: bigint; data?: Hex; state?: bigint } = {},
): Frame {
  return lib.frame(profile, mode, {
    scope,
    target,
    execution,
    state: opts.state,
    value: opts.value,
    data: opts.data,
  });
}

const placeholder = (signer?: Hex) => lib.secp256k1Placeholder(profile, signer);

export const toWire = libToWire;
export const encodeRawFrameTx = (tx: FrameTx): Hex => lib.encodeTx(profile, tx);
export const txHash = (tx: FrameTx): Hex => lib.txHash(profile, tx);

const ADD_STAKE_ABI = [
  {
    type: "function",
    name: "addStake",
    stateMutability: "payable",
    inputs: [{ type: "uint32" }],
    outputs: [],
  },
] as const;

const REQUEST_RECOVERY_ABI = [
  {
    type: "function",
    name: "requestRecoveryFrame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newKey", type: "address" },
      { name: "requestId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/**
 * The wallet stakes itself: VERIFY (owner path) approves, then a SENDER frame calls the staking
 * registry's `addStake` as the wallet. One owner signature.
 */
export function buildStakeTx(a: {
  wallet: Address;
  owner: Address;
  registry: Address;
  amount: bigint;
  unstakeDelaySec: number;
  nonce: bigint;
  chainId: number;
  maxFeePerGas: bigint;
}): FrameTx {
  return lib.newTx({
    chainId: a.chainId,
    sender: a.wallet,
    nonceSeq: a.nonce,
    frames: [
      frame("VERIFY", "EXECUTION_AND_PAYMENT", null, 95_000n, { data: "0x01" }),
      frame("SENDER", undefined, a.registry, 200_000n, {
        value: a.amount,
        state: 400_000n,
        data: encodeFunctionData({
          abi: ADD_STAKE_ABI,
          functionName: "addStake",
          args: [a.unstakeDelaySec],
        }),
      }),
    ],
    signatures: [placeholder(a.owner)],
    fees: { maxFeePerGas: a.maxFeePerGas },
  });
}

/**
 * The guardian-quorum recovery frame tx. VERIFY (on the wallet) reads each guardian's resolved
 * signer via sigparam and checks the quorum against RosterRegistry (a FOREIGN storage read — the
 * canonical mempool rejects it, the staked alt-mempool admits it). SENDER then calls
 * `requestRecoveryFrame(newKey, requestId)` on the wallet, gated by the transient VERIFY flag.
 * One placeholder signature per guardian.
 */
export function buildRecoveryTx(a: {
  wallet: Address;
  newKey: Address;
  requestId: Hex;
  guardians: Address[];
  nonce: bigint;
  chainId: number;
  maxFeePerGas: bigint;
}): FrameTx {
  // One placeholder per guardian, signer set to that guardian's address (the protocol verifies
  // each signature against it and exposes it as RESOLVED_SIGNER). Keys must be signed in the same
  // order via signWith.
  const signatures = a.guardians.map((g) => placeholder(g));
  return lib.newTx({
    chainId: a.chainId,
    sender: a.wallet,
    nonceSeq: a.nonce,
    frames: [
      frame("VERIFY", "EXECUTION_AND_PAYMENT", null, 95_000n, { data: "0x01" }),
      frame("SENDER", undefined, a.wallet, 200_000n, {
        state: 400_000n,
        data: encodeFunctionData({
          abi: REQUEST_RECOVERY_ABI,
          functionName: "requestRecoveryFrame",
          args: [a.newKey, a.requestId],
        }),
      }),
    ],
    signatures,
    fees: { maxFeePerGas: a.maxFeePerGas },
  });
}

/** Sign signature entry `i` with each guardian/owner key, in order. */
export async function signWith(tx: FrameTx, keys: Hex[]): Promise<FrameTx> {
  let signed = tx;
  for (let i = 0; i < keys.length; i++) {
    signed = await lib.signTx(profile, signed, keys[i] as Hex, i);
  }
  return signed;
}

// --- gateway RPC ---

const GATEWAY = "https://altmempoolgateway.forshtat.com/rpc";

export async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

/** Submit to the standard alt-mempool. */
export const sendFrameTx = (tx: FrameTx) =>
  rpc("eth_sendFrameTransaction", [toWire(tx)]) as Promise<Hex>;
/** Submit the raw 0x06 tx to the canonical mempool (gateway forwards to ethrex). */
export const sendRawFrameTx = (tx: FrameTx) =>
  rpc("eth_sendRawTransaction", [encodeRawFrameTx(tx)]) as Promise<Hex>;
export const frameStatus = (hash: Hex) => rpc("skandha_frameTransactionStatus", [hash]);
export const explorerTx = (hash: Hex) => rpc("skandha_explorer_getTransaction", [hash]);
export const accountNonce = async (addr: Address) =>
  BigInt((await rpc("eth_getTransactionCount", [addr, "latest"])) as Hex);

export async function waitReceipt(
  hash: Hex,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = (await rpc("eth_getTransactionReceipt", [hash]).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (r) return r;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`receipt timeout for ${hash}`);
}
