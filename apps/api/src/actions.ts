import {
  type Address,
  devnetReader,
  devnetWallet,
  type Hex,
  loadDeployments,
  voxyWalletAbi,
} from "@voxy/chain";
import { assembleAndSubmit, buildRecoveryDigest, signRecovery } from "@voxy/orchestrator";
import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
export async function startRecovery(newKey: Address) {
  const { message } = await buildRecoveryDigest(newKey);
  const guardianEnvs = ["GUARDIAN_1_PK", "GUARDIAN_2_PK", "GUARDIAN_3_PK"].filter(
    (e) => process.env[e],
  );
  const signed = await Promise.all(guardianEnvs.map((e) => signRecovery(pk(e), message)));
  const payer = privateKeyToAccount(pk("DEVNET_DEPLOYER_PK"));
  const result = await assembleAndSubmit(
    payer,
    message,
    signed.map((s) => s.signature),
  );
  return {
    requestId: message.requestId,
    newKey,
    signers: signed.map((s) => s.guardian),
    quorum: `${result.valid}/${result.threshold}`,
    tx: { hash: result.txHash, explorer: result.explorer },
  };
}

/** Cancel the pending recovery. Owner-gated; the server's devnet deployer key is an owner. */
export async function cancelRecovery() {
  const d = loadDeployments();
  const wallet = d.devnet.VoxyWallet as Address;
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
export async function executeRecovery() {
  const d = loadDeployments();
  const wallet = d.devnet.VoxyWallet as Address;
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
