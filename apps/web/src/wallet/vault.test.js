import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptWallet, unlockWallet, validateVault } from "./vault.js";

test("encrypted backups survive serialization and refuse wrong passwords or altered identity", async () => {
  const privateKey = generatePrivateKey();
  const password = "an independent test password 2026";
  const created = await encryptWallet(password, privateKey);
  assert.equal(created.account.address, privateKeyToAccount(privateKey).address);
  const backup = JSON.stringify(created.vault);
  assert.equal(backup.includes(privateKey), false);
  const restored = await unlockWallet(JSON.parse(backup), password);
  assert.equal(restored.address, created.account.address);
  await assert.rejects(unlockWallet(created.vault, "a different password"), /Incorrect password/);
  await assert.rejects(unlockWallet({ ...created.vault, address: privateKeyToAccount(generatePrivateKey()).address }, password), /damaged/);
  const changed = { ...created.vault, ciphertext: (created.vault.ciphertext[0] === "A" ? "B" : "A") + created.vault.ciphertext.slice(1) };
  await assert.rejects(unlockWallet(changed, password), /damaged/);
  assert.throws(() => validateVault({ ...created.vault, iterations: 1 }), /Unsupported/);
  await assert.rejects(encryptWallet("short"), /12 characters/);
});
