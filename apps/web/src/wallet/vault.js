import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";

const VERSION = "voxy-encrypted-wallet-v1";
const ITERATIONS = 600000;
const encoder = new TextEncoder();
const encode = (bytes) => btoa(String.fromCharCode(...bytes));
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const metadata = (vault) => encoder.encode(JSON.stringify({ format: vault.format, address: vault.address, iterations: vault.iterations }));
async function encryptionKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptWallet(password, importedKey) {
  if (!crypto.subtle) throw new Error("Open this wallet over HTTPS or localhost.");
  if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
  const privateKey = importedKey ? (importedKey.startsWith("0x") ? importedKey : `0x${importedKey}`) : generatePrivateKey();
  if (!/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new Error("Enter a valid Sepolia wallet private key.");
  const account = privateKeyToAccount(privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const vault = { format: VERSION, address: account.address, iterations: ITERATIONS, salt: encode(salt), iv: encode(iv), created: Date.now() };
  const plaintext = encoder.encode(privateKey);
  try {
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: metadata(vault) }, await encryptionKey(password, salt), plaintext);
    return { vault: { ...vault, ciphertext: encode(new Uint8Array(encrypted)) }, account };
  } finally { plaintext.fill(0); }
}
export function validateVault(input) {
  if (!input || input.format !== VERSION || input.iterations !== ITERATIONS || typeof input.ciphertext !== "string" || input.ciphertext.length > 512 || typeof input.salt !== "string" || typeof input.iv !== "string") throw new Error("Unsupported encrypted wallet backup.");
  const address = getAddress(input.address);
  if (decode(input.salt).length !== 32 || decode(input.iv).length !== 12 || decode(input.ciphertext).length !== 82) throw new Error("Encrypted wallet backup is malformed.");
  return { format: VERSION, address, iterations: ITERATIONS, ciphertext: input.ciphertext, salt: input.salt, iv: input.iv, created: Number(input.created) };
}
export async function unlockWallet(input, password) {
  const vault = validateVault(input);
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(vault.iv), additionalData: metadata(vault) }, await encryptionKey(password, decode(vault.salt)), decode(vault.ciphertext)));
    const account = privateKeyToAccount(new TextDecoder().decode(plaintext));
    if (account.address !== vault.address) throw new Error("Wallet address mismatch");
    return account;
  } catch { throw new Error("Incorrect password or damaged wallet backup."); }
  finally { plaintext?.fill(0); }
}
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voxy-encrypted-wallets", 2);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("vaults")) request.result.createObjectStore("vaults", { keyPath: "address" }); if (!request.result.objectStoreNames.contains("transactions")) request.result.createObjectStore("transactions", { keyPath: "hash" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser wallet storage is unavailable. Download your backup before closing."));
  });
}
export async function saveVault(input) {
  const vault = validateVault(input);
  const db = await database();
  try { await new Promise((resolve, reject) => { const tx = db.transaction("vaults", "readwrite"); tx.objectStore("vaults").put(vault); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
export async function listVaults() {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const req = db.transaction("vaults").objectStore("vaults").getAll(); req.onsuccess = () => resolve(req.result.map(validateVault)); req.onerror = () => reject(req.error); }); }
  finally { db.close(); }
}
export function downloadVault(vault) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(validateVault(vault), null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `voxy-${vault.address}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveSignedTransaction(transaction) {
  const db = await database();
  try { await new Promise((resolve, reject) => { const tx = db.transaction("transactions", "readwrite"); tx.objectStore("transactions").put(transaction); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
