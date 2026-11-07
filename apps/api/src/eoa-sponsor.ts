import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { type Address, type Hex, stringify } from "@voxy/chain";
import { keccak256, parseEther, type SignedAuthorization } from "viem";
import { eoaReader, eoaSponsor, sponsorAccount } from "./eoa-config.js";
import { eoaDB, eoaStateDirectory } from "./eoa-store.js";

export async function operationStatus(id: string) {
  const db = eoaDB();
  const row = db.prepare("SELECT * FROM eoa_operations WHERE id=?").get(id);
  if (!row) throw new Error("Operation not found");
  if (row.hash && row.phase === "submitting") {
    const reader = eoaReader();
    const receipt = await reader
      .getTransactionReceipt({ hash: String(row.hash) as Hex })
      .catch(() => null);
    if (receipt) {
      const [tx, block] = await Promise.all([
        reader.getTransaction({ hash: receipt.transactionHash }),
        reader.getBlock({ blockNumber: receipt.blockNumber }),
      ]);
      const body = JSON.parse(String(row.body));
      if (
        receipt.transactionHash !== row.hash ||
        block.hash !== receipt.blockHash ||
        tx.from.toLowerCase() !== sponsorAccount().address.toLowerCase() ||
        tx.to?.toLowerCase() !== body.to.toLowerCase() ||
        tx.input !== body.data ||
        tx.nonce !== row.nonce
      )
        throw new Error("Transaction receipt does not match the saved operation");
      const phase = receipt.status === "success" ? "confirmed" : "reverted";
      db.prepare("UPDATE eoa_operations SET phase=?, error=? WHERE id=?").run(
        phase,
        receipt.status === "success"
          ? null
          : "The transaction reverted. Inspect its receipt before preparing another operation.",
        id,
      );
      row.phase = phase;
      row.error = receipt.status === "success" ? null : "The transaction reverted";
    }
  }
  return {
    id,
    phase: String(row.phase),
    hash: row.hash ? String(row.hash) : undefined,
    explorer: row.hash ? `https://sepolia.etherscan.io/tx/${row.hash}` : undefined,
    error: row.error ? String(row.error) : undefined,
  };
}

/** Signed bytes and nonce are committed before the single admitted broadcast. */
export async function relay(
  id: string,
  scope: Address,
  input: { to: Address; data: Hex; authorizationList?: SignedAuthorization[] },
) {
  const db = eoaDB();
  const body = stringify(input);
  const prior = db.prepare("SELECT body FROM eoa_operations WHERE id=?").get(id);
  if (prior) {
    if (prior.body !== body)
      throw new Error("Operation ID conflicts with different transaction data");
    return operationStatus(id);
  }
  const path = resolve(eoaStateDirectory(), "sepolia-sponsor.lock");
  const lock = await open(path, "wx", 0o600).catch(() => {
    throw new Error("Sponsor is busy, or a previous signer lock needs reconciliation");
  });
  try {
    const outstanding = db
      .prepare("SELECT id FROM eoa_operations WHERE phase='submitting' ORDER BY created LIMIT 1")
      .get();
    if (outstanding) {
      const status = await operationStatus(String(outstanding.id));
      if (status.phase === "submitting")
        throw new Error(`A sponsor transaction is awaiting confirmation: ${status.hash}`);
    }
    const reader = eoaReader();
    const account = sponsorAccount();
    if ((await reader.getChainId()) !== 11155111) throw new Error("Sponsor RPC is not Sepolia");
    const [latest, pending, balance] = await Promise.all([
      reader.getTransactionCount({ address: account.address, blockTag: "latest" }),
      reader.getTransactionCount({ address: account.address, blockTag: "pending" }),
      reader.getBalance({ address: account.address }),
    ]);
    if (latest !== pending)
      throw new Error("Reconcile pending sponsor transactions before continuing");
    const estimated = await reader.estimateGas({ account, ...input });
    const gas = (estimated * 5n) / 4n;
    const block = await reader.getBlock();
    const maxGas = block.gasLimit / 2n < 16700000n ? block.gasLimit / 2n : 16700000n;
    if (gas > maxGas) throw new Error("Transaction exceeds the sponsored gas limit");
    const prepared = await eoaSponsor().prepareTransactionRequest({ ...input, gas, nonce: latest });
    const fee = gas * (prepared.maxFeePerGas ?? prepared.gasPrice ?? 0n);
    if (
      fee <= 0n ||
      fee > parseEther(process.env.VOXY_SPONSOR_MAX_TX_ETH || "0.005") ||
      fee > balance
    )
      throw new Error("Sponsor fee budget or balance is insufficient");
    const dayStart = Math.floor(Date.now() / 86400000) * 86400000;
    const rows = db.prepare("SELECT fee_cap FROM eoa_operations WHERE created >= ?").all(dayStart);
    const reserved = rows.reduce((sum, row) => sum + BigInt(String(row.fee_cap || "0")), 0n);
    if (reserved + fee > parseEther(process.env.VOXY_SPONSOR_DAILY_ETH || "0.05"))
      throw new Error("Daily sponsorship budget reached");
    const raw = await eoaSponsor().signTransaction(prepared);
    const hash = keccak256(raw);
    db.prepare(
      "INSERT INTO eoa_operations(id,scope,body,phase,hash,raw,nonce,fee_cap,created) VALUES(?,?,?,'submitting',?,?,?,?,?)",
    ).run(id, scope, body, hash, raw, latest, fee.toString(), Date.now());
    try {
      await eoaSponsor().sendRawTransaction({ serializedTransaction: raw });
    } catch {
      /* The saved hash is authoritative; never replace an uncertain send. */
    }
    return operationStatus(id);
  } finally {
    await lock.close();
    await unlink(path);
  }
}
