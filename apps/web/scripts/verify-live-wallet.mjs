import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, formatEther, http, keccak256, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = process.env.VOXY_VERIFY_WEB_URL || "http://127.0.0.1:5181";
const maxFunding = parseEther("0.0001");
if (!process.argv.includes("--public-write-approved")) throw new Error("This check sends real testnet transactions. Obtain approval, then pass --public-write-approved.");
const deployment = JSON.parse(await readFile(`${root}/deployments/eoa-sepolia.json`, "utf8"));
assert.equal(deployment.chainId, 11155111);
const config = JSON.parse(await readFile(`${root}/deployments.json`, "utf8"));
const rpc = process.env.SEPOLIA_RPC_URL || config.sepolia.rpc;
const reader = createPublicClient({ chain: sepolia, transport: http(rpc, { retryCount: 0, timeout: 15000 }) });
assert.equal(await reader.getChainId(), 11155111);
const key = process.env.SEPOLIA_DEPLOYER_PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(key || "")) throw new Error("Set the sponsor key locally");
const sponsor = privateKeyToAccount(key);
const funder = createWalletClient({ account: sponsor, chain: sepolia, transport: http(rpc, { retryCount: 0 }) });
await mkdir(`${root}/.voxy`, { recursive: true, mode: 0o700 });
const privateDirectory = await mkdtemp(`${root}/.voxy/browser-verification-`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
const errors = [];
const privatePasswords = [];
const transactions = new Set();
async function wallet(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    const body = request.postData() || "";
    assert.ok(!/"(?:privateKey|password|ciphertext)"\s*:/.test(body), "No wallet secret or encrypted vault may be uploaded to the API");
    assert.ok(privatePasswords.every((password) => !body.includes(password)), "Password must stay in the browser");
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/")) return;
    try { const data = await response.json(); if (data.hash) transactions.add(data.hash); if (data.operation?.hash) transactions.add(data.operation.hash); } catch { /* Only collect JSON transaction evidence. */ }
  });
  await page.goto(base);
  await page.locator('[data-open="protect"]').first().click();
  await page.getByRole("button", { name: "Create wallet", exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  const password = randomBytes(24).toString("base64url"); privatePasswords.push(password);
  await page.locator("#vw-password").fill(password); await page.locator("#vw-password-again").fill(password);
  await page.getByRole("button", { name: "Create encrypted wallet", exact: true }).click();
  await page.getByRole("button", { name: "Download encrypted backup", exact: true }).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
  const backup = JSON.parse(await readFile(await (await download).path(), "utf8"));
  // Test client recovery material stays private and is never part of the server or public evidence.
  await writeFile(`${privateDirectory}/${name}.json`, JSON.stringify({ backup, password }), { mode: 0o600 });
  await page.locator("#vw-saved").check();
  await page.getByRole("button", { name: "Open my wallet", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).waitFor({ timeout: 60000 });
  return { context, page, address: backup.address, password };
}
async function fund(address) {
  const latest = await reader.getTransactionCount({ address: sponsor.address, blockTag: "latest" });
  assert.equal(latest, await reader.getTransactionCount({ address: sponsor.address, blockTag: "pending" }), "Reconcile pending sponsor transactions before funding");
  const prepared = await funder.prepareTransactionRequest({ to: address, value: maxFunding, nonce: latest });
  const fee = prepared.gas * (prepared.maxFeePerGas || prepared.gasPrice);
  assert.ok(fee <= parseEther("0.001"));
  const raw = await funder.signTransaction(prepared), hash = keccak256(raw);
  const journal = await open(`${privateDirectory}/funding.jsonl`, "a", 0o600);
  try { await journal.writeFile(JSON.stringify({ address, amount: maxFunding.toString(), hash, raw }) + "\n"); await journal.sync(); } finally { await journal.close(); }
  await funder.sendRawTransaction({ serializedTransaction: raw });
  const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 180000 });
  assert.equal(receipt.status, "success"); transactions.add(hash); return hash;
}
try {
  console.log("Creating independent client-side wallets in separate browser contexts…");
  const original = await wallet("original"), g1 = await wallet("guardian-1"), g2 = await wallet("guardian-2"), replacement = await wallet("replacement");
  const fundingHash = await fund(original.address);
  assert.equal(await reader.getBalance({ address: original.address }), maxFunding);
  console.log(`Protecting ${original.address}; guardian EOAs remain unprotected and do not need gas.`);
  await original.page.getByRole("button", { name: "Refresh", exact: true }).click();
  await original.page.getByRole("button", { name: "Choose recovery guardians", exact: true }).click();
  await original.page.locator("#vw-g0").fill(g1.address); await original.page.locator("#vw-g1").fill(g2.address);
  await original.page.getByRole("button", { name: "Review recovery setup", exact: true }).click();
  await original.page.getByRole("button", { name: "Sign and enable recovery", exact: true }).click();
  await original.page.getByText("Recovery enabled", { exact: true }).waitFor({ timeout: 180000 });
  assert.equal(await reader.getCode({ address: original.address }), `0xef0100${deployment.implementation.slice(2).toLowerCase()}`);
  assert.equal(await reader.getBalance({ address: original.address }), maxFunding);
  await original.page.reload();
  await original.page.getByText("Recovery enabled", { exact: true }).waitFor({ timeout: 60000 });
  await original.page.screenshot({ path: `${privateDirectory}/protected.png` });
  await original.context.close(); // No original key or session is used after this point.
  console.log("Original signing context closed. Replacement controller publishes its own signed request…");
  await replacement.page.getByRole("button", { name: "Recover access", exact: true }).click();
  await replacement.page.locator("#vw-lost").fill(original.address);
  await replacement.page.getByRole("button", { name: "Review recovery request", exact: true }).click();
  await replacement.page.getByRole("button", { name: "Sign and share with guardians", exact: true }).click();
  await replacement.page.getByRole("button", { name: "Copy guardian request link", exact: true }).waitFor({ timeout: 180000 });
  const requestURL = replacement.page.url();
  const requestId = new URL(requestURL).searchParams.get("recovery");
  const digest = new URL(requestURL).searchParams.get("digest");
  assert.match(requestId, /^0x[0-9a-f]{64}$/);
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  async function approve(guardian) {
    await guardian.page.getByRole("button", { name: "Guardian approvals", exact: true }).click();
    await guardian.page.locator("#vw-request-id").fill(requestURL);
    await guardian.page.getByRole("button", { name: "Open request", exact: true }).click();
    await guardian.page.getByRole("button", { name: "Approve this recovery", exact: true }).waitFor({ timeout: 60000 });
    await guardian.page.getByRole("button", { name: "Approve this recovery", exact: true }).click();
  }
  console.log("Independent guardians approve the shared request through their actual local wallet keys…");
  await approve(g1);
  await replacement.page.getByText("1 of 2 approvals", { exact: true }).waitFor({ timeout: 180000 });
  await approve(g2);
  await replacement.page.getByRole("heading", { name: "Recovery waiting period", exact: true }).waitFor({ timeout: 180000 });
  assert.equal(await reader.getBalance({ address: original.address }), maxFunding);
  await replacement.page.screenshot({ path: `${privateDirectory}/waiting-period.png` });
  console.log("Waiting for the real three-minute on-chain timelock…");
  await replacement.page.getByRole("button", { name: "Restore access", exact: true }).waitFor({ timeout: 240000 });
  await replacement.page.getByRole("button", { name: "Restore access", exact: true }).click();
  await replacement.page.getByRole("heading", { name: "Your wallet", exact: true }).waitFor({ timeout: 180000 });
  // Unlock only the replacement controller if the five-minute local lock elapsed.
  if (!await replacement.page.locator("#vw-transfer-form").count()) {
    await replacement.page.getByRole("button", { name: "Choose another wallet", exact: true }).click();
    await replacement.page.locator("[data-vault]").first().click();
    await replacement.page.locator("#vw-unlock-password").fill(replacement.password);
    await replacement.page.getByRole("button", { name: "Unlock on this device", exact: true }).click();
    await replacement.page.getByRole("button", { name: "Choose another wallet", exact: true }).click();
    await replacement.page.locator("#vw-address").fill(original.address);
    await replacement.page.getByRole("button", { name: "Open account", exact: true }).click();
  }
  assert.equal(await reader.getBalance({ address: original.address }), maxFunding);
  await replacement.page.locator("#vw-to").fill(replacement.address);
  await replacement.page.getByRole("button", { name: "Use available balance", exact: true }).click();
  await replacement.page.getByRole("button", { name: "Review transfer", exact: true }).click();
  await replacement.page.getByRole("button", { name: "Sign and send ETH", exact: true }).click();
  for (let i = 0; i < 90; i++) {
    if (await reader.getBalance({ address: replacement.address }) === maxFunding) break;
    await new Promise((done) => setTimeout(done, 2000));
  }
  assert.equal(await reader.getBalance({ address: original.address }), 0n);
  assert.equal(await reader.getBalance({ address: replacement.address }), maxFunding);
  await replacement.page.screenshot({ path: `${privateDirectory}/recovered-transfer.png` });
  await replacement.page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await replacement.page.locator("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth));
  assert.deepEqual(errors, []);
  const evidence = { verifiedAt: new Date().toISOString(), chainId: 11155111, original: original.address, replacement: replacement.address, guardians: [g1.address, g2.address], requestId, digest, transferredETH: formatEther(maxFunding), fundingHash, transactionHashes: [...transactions], originalKeyUsedAfterEnrollment: false, apiReceivedWalletSecrets: false, originalBalanceAfter: "0", replacementBalanceAfter: maxFunding.toString() };
  await mkdir(`${root}/artifacts/eoa`, { recursive: true });
  await writeFile(`${root}/artifacts/eoa/live-verification.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS: independent browser wallets, same-address 7702 recovery, real Arkiv approvals, actual waiting period, explicit controller-signed transfer and refresh persistence.");
} finally { await browser.close(); }
