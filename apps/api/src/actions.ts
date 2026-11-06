import {
  type Address,
  devnetReader,
  devnetWallet,
  type Hex,
  loadDeployments,
  voxyWalletAbi,
} from "@voxy/chain";
import {
  assembleAndSubmit,
  buildRecoveryDigest,
  decodeRequest,
  signRecovery,
  verifyApprovals,
} from "@voxy/orchestrator";
import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isVoxyWallet } from "./discovery.js";

async function selectedWallet(wallet?: Address) {
  const w = wallet ?? loadDeployments().devnet.VoxyWallet;
  if (!(await isVoxyWallet(w))) throw new Error("Select a Voxy account");
  return w;
}

export async function prepareRecovery(newKey: Address, wallet: Address) {
  const { message, typedData } = await buildRecoveryDigest(newKey, {
    wallet: await selectedWallet(wallet),
  });
  return {
    message,
    typedData: {
      ...typedData,
      domain: { ...typedData.domain, chainId: BigInt(typedData.domain.chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ] as const,
        ...typedData.types,
      },
    },
  };
}

function pk(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !isHex(v) || v.length !== 66) throw new Error(`Server missing ${name}`);
  return v;
}

/**
 * Start a real recovery. For the demo the three guardian keys are held server-side (honest label:
 * in production each guardian signs in their own wallet). Signs with as many as are configured,
 * then submits the quorum on-chain via the orchestrator. Everything here is a real transaction.
 */
export async function startRecovery(
  newKey: Address,
  wallet?: Address,
  request?: string,
  signatures?: Hex[],
) {
  const w = await selectedWallet(wallet);
  if (w.toLowerCase() !== loadDeployments().devnet.VoxyWallet.toLowerCase() && !request) {
    throw new Error("Your guardians must sign the recovery request in their own wallets");
  }
  const message = request
    ? decodeRequest(request)
    : (await buildRecoveryDigest(newKey, { wallet: w })).message;
  if (
    message.wallet.toLowerCase() !== w.toLowerCase() ||
    message.newKey.toLowerCase() !== newKey.toLowerCase()
  )
    throw new Error("Recovery request targets a different account or new owner");
  const guardianEnvs = ["GUARDIAN_1_PK", "GUARDIAN_2_PK", "GUARDIAN_3_PK"].filter(
    (e) => process.env[e],
  );
  const signed = request
    ? []
    : await Promise.all(guardianEnvs.map((e) => signRecovery(pk(e), message)));
  const approvals = signatures ?? signed.map((s) => s.signature);
  const report = await verifyApprovals(message, approvals);
  if (report.threshold < 1) throw new Error("Configure guardians before recovering");
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const result = await assembleAndSubmit(payer, message, approvals);
  return {
    requestId: message.requestId,
    newKey,
    signers: signed.map((s) => s.guardian),
    quorum: `${result.valid}/${result.threshold}`,
    tx: { hash: result.txHash, explorer: result.explorer },
  };
}

/** Cancel the pending recovery. Owner-gated; the server's devnet deployer key is an owner. */
export async function cancelRecovery(selected?: Address) {
  const d = loadDeployments();
  const wallet = await selectedWallet(selected);
  const owner = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const reader = devnetReader();
  const { request } = await reader.simulateContract({
    address: wallet,
    abi: voxyWalletAbi,
    functionName: "cancelRecovery",
    account: owner,
  });
  const txHash = await devnetWallet(owner).writeContract(request);
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`cancelRecovery reverted: ${txHash}`);
  return { tx: { hash: txHash, explorer: `${d.devnet.explorer}/tx/${txHash}` } };
}

/** Finalise a pending recovery (add-only) after the on-chain delay has elapsed. */
export async function executeRecovery(selected?: Address) {
  const d = loadDeployments();
  const wallet = await selectedWallet(selected);
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const reader = devnetReader();
  const { request } = await reader.simulateContract({
    address: wallet,
    abi: voxyWalletAbi,
    functionName: "executeRecovery",
    account: payer,
  });
  const txHash = await devnetWallet(payer).writeContract(request);
  const receipt = await reader.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`executeRecovery reverted: ${txHash}`);
  const owners = await reader.readContract({
    address: wallet,
    abi: voxyWalletAbi,
    functionName: "owners",
  });
  return { tx: { hash: txHash, explorer: `${d.devnet.explorer}/tx/${txHash}` }, owners };
}
