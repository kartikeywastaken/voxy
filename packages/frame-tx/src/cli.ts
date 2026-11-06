import {
  type Address,
  decodeAbiParameters,
  encodeFunctionData,
  type Hex,
  isAddress,
  isHex,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  accountNonce,
  buildRecoveryTx,
  buildStakeTx,
  explorerTx,
  frameStatus,
  rpc,
  sendFrameTx,
  sendRawFrameTx,
  signWith,
  txHash,
  waitReceipt,
} from "./lib.js";

const CHAIN_ID = 1337;
const MAX_FEE = parseGwei("2");
const STAKING_REGISTRY = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f" as Address;
const STAKE_AMOUNT = 12_000_000_000_000_000n; // 0.012 ETH (min is 0.01)
const UNSTAKE_DELAY = 86_400;

const out = (v: unknown) =>
  console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Set ${name} to a 32-byte hex key`);
  return v;
}
function addr(name: string): Address {
  const v = process.env[name]?.trim();
  if (!v || !isAddress(v)) throw new Error(`Set ${name} to an address`);
  return v;
}

async function getStake(a: Address) {
  const data = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "getDepositInfo",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }],
      },
    ],
    functionName: "getDepositInfo",
    args: [a],
  });
  const hex = (await rpc("eth_call", [{ to: STAKING_REGISTRY, data }, "latest"])) as Hex;
  if (hex.length < 2 + 192) return { amount: 0n, unstakeDelay: 0 };
  const [amount, unstakeDelay] = decodeAbiParameters(
    [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }],
    hex,
  );
  return { amount, unstakeDelay };
}

async function walletReads(wallet: Address) {
  const call = (name: string, outputs: { type: string }[]) =>
    rpc("eth_call", [
      {
        to: wallet,
        data: encodeFunctionData({
          abi: [{ type: "function", name, stateMutability: "view", inputs: [], outputs }],
          functionName: name,
        }),
      },
      "latest",
    ]).then((h) => decodeAbiParameters(outputs, h as Hex));
  const [ownerCount] = (await call("ownerCount", [{ type: "uint256" }]).catch(() => [0n])) as [
    bigint,
  ];
  const pending = (await call("pending", [
    { type: "address" },
    { type: "uint64" },
    { type: "bytes32" },
  ]).catch(() => null)) as [Address, bigint, Hex] | null;
  return {
    ownerCount,
    pending: pending
      ? { key: pending[0], readyAt: Number(pending[1]), requestId: pending[2] }
      : null,
  };
}

const command = process.argv[2];
const flag = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (command === "getstake") {
  out(await getStake(addr("FRAME_WALLET")));
} else if (command === "stake") {
  const wallet = addr("FRAME_WALLET");
  const owner = privateKeyToAccount(pk("FRAME_OWNER_PK"));
  const nonce = await accountNonce(wallet);
  let tx = buildStakeTx({
    wallet,
    owner: owner.address,
    registry: STAKING_REGISTRY,
    amount: STAKE_AMOUNT,
    unstakeDelaySec: UNSTAKE_DELAY,
    nonce,
    chainId: CHAIN_ID,
    maxFeePerGas: MAX_FEE,
  });
  tx = await signWith(tx, [pk("FRAME_OWNER_PK")]);
  console.log("stake frame tx hash (pre-submit):", txHash(tx));
  const hash = await sendFrameTx(tx);
  console.log("submitted via eth_sendFrameTransaction:", hash);
  const receipt = await waitReceipt(hash);
  out({
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    stake: await getStake(wallet),
  });
} else if (command === "recover") {
  const wallet = addr("FRAME_WALLET");
  const newKey = (flag("new-key") ?? "0x1111111111111111111111111111111111111111") as Address;
  if (!isAddress(newKey)) throw new Error("--new-key must be an address");
  const requestId = (flag("request-id") ??
    `0x${Buffer.from(`voxy-frame-${Date.now()}`.padEnd(32, "\0")).toString("hex").slice(0, 64)}`) as Hex;
  const guardianKeys = [pk("GUARDIAN_1_PK"), pk("GUARDIAN_2_PK")];
  const guardians = guardianKeys.map((k) => privateKeyToAccount(k).address);
  const nonce = await accountNonce(wallet);

  let tx = buildRecoveryTx({
    wallet,
    newKey,
    requestId,
    guardians,
    nonce,
    chainId: CHAIN_ID,
    maxFeePerGas: MAX_FEE,
  });
  tx = await signWith(tx, guardianKeys);
  const hash = txHash(tx);
  console.log("recovery frame tx:", { hash, newKey, requestId, guardians: guardianKeys.length });

  // First prove the canonical mempool REJECTS it (foreign storage read in validation).
  if (process.argv.includes("--show-canonical-reject")) {
    try {
      const raw = await sendRawFrameTx(tx);
      console.log("canonical ACCEPTED (unexpected):", raw);
    } catch (e) {
      console.log("canonical mempool REJECTED (expected):", (e as Error).message.slice(0, 200));
    }
  }

  const submitted = await sendFrameTx(tx);
  console.log("submitted via eth_sendFrameTransaction (alt-mempool):", submitted);
  const receipt = await waitReceipt(submitted);
  out({
    hash: submitted,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    frameStatus: await frameStatus(submitted).catch(() => null),
    wallet: await walletReads(wallet),
    explorer: `https://explorer.altmempool.wtf (search ${submitted})`,
  });
} else if (command === "status") {
  const hash = process.argv[3] as Hex;
  out({
    frameStatus: await frameStatus(hash).catch((e) => String(e)),
    explorerTx: await explorerTx(hash).catch((e) => String(e)),
  });
} else {
  console.error(
    "Commands: stake | recover [--new-key 0x..] [--show-canonical-reject] | getstake | status <hash>",
  );
  process.exitCode = 1;
}
