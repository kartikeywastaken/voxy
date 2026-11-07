import { createPublicClient, createWalletClient, formatEther, http, keccak256, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { saveSignedTransaction } from "./vault.js";

export async function prepareNativeTransfer(account, network, to, amount, max = false) {
  const transport = http(network.rpcUrls[0], { retryCount: 0, timeout: 15000 });
  const reader = createPublicClient({ chain: sepolia, transport, cacheTime: 0 });
  if (await reader.getChainId() !== 11155111) throw new Error("The wallet RPC is not Sepolia.");
  const [nonce, pending, balance, fees] = await Promise.all([reader.getTransactionCount({ address: account.address, blockTag: "latest" }), reader.getTransactionCount({ address: account.address, blockTag: "pending" }), reader.getBalance({ address: account.address }), reader.estimateFeesPerGas()]);
  if (nonce !== pending) throw new Error("Wait for the account’s pending transaction before sending again.");
  if (!max && !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(amount)) throw new Error("Enter a valid ETH amount.");
  let value = max ? 1n : parseEther(amount);
  const gas = (await reader.estimateGas({ account: account.address, to, value })) * 5n / 4n;
  const fee = gas * fees.maxFeePerGas;
  if (max) value = balance - fee;
  if (value <= 0n || value + fee > balance) throw new Error("The balance must cover the transfer and its network fee.");
  return { transaction: { chainId: 11155111, to, value, gas, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: "eip1559" }, amount: formatEther(value), maximumFee: formatEther(fee) };
}
export async function sendNativeTransfer(account, network, prepared) {
  const client = createWalletClient({ account, chain: sepolia, transport: http(network.rpcUrls[0], { retryCount: 0, timeout: 15000 }) });
  const raw = await account.signTransaction(prepared.transaction);
  const hash = keccak256(raw);
  await saveSignedTransaction({ hash, raw, account: account.address, chainId: 11155111, created: Date.now() });
  try { await client.sendRawTransaction({ serializedTransaction: raw }); }
  catch { /* A lost response is not permission to sign or send a replacement. */ }
  return hash;
}
