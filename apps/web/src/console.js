import "./console.css";
import { createPublicClient, encodeFunctionData, getAddress, hashTypedData, http, isAddress, keccak256, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { ensRosterAbi, recoveryAccountAbi } from "@voxy/chain/eoa-abis";
import { approvedDeployment } from "./wallet/deployment.js";
import { authorizationData, enrollmentData, executionData, recoveryData, validateExpiry } from "./wallet/protocol.js";
import { eoaDomain, eoaTypes, eoaRecoveryHash, parseEOARecovery } from "@voxy/chain/eoa";
import { api, short } from "./api.js";
import { downloadVault, encryptWallet, listVaults, saveVault, unlockWallet, validateVault } from "./wallet/vault.js";
import { prepareNativeTransfer, sendNativeTransfer } from "./wallet/native.js";
import { connectProvider, discoverProviders, signBrowser } from "./wallet/signing.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const addressChip = (value) => `<code class="vc-chip" title="${escape(value)}">${escape(short(value))}</code>`;
const fullAddress = (value) => `<code class="vw-address">${escape(value)}</code>`;
const txLink = (operation) => operation?.explorer ? `<a href="${escape(operation.explorer)}" target="_blank" rel="noopener noreferrer">View transaction ${escape(short(operation.hash))}</a>` : "";
const errorMessage = (error) => error?.shortMessage || error?.message || "The operation could not be verified.";

export function mountConsole(container, mode) {
  const dialog = container.closest("dialog");
  dialog?.classList.add("vc-dialog");
  let alive = true;
  let sequence = 0;
  let poll;
  let local = null;
  let connection = null;
  let network;
  let activeAccount;
  let providerCleanup;
  let idle;
  const url = () => new URL(location.href);
  const stop = () => { clearTimeout(poll); sequence++; };
  const setURL = (changes) => { const next = url(); for (const [key, value] of Object.entries(changes)) value ? next.searchParams.set(key, value) : next.searchParams.delete(key); history.replaceState(null, "", next); };
  const go = (page) => { stop(); setURL({ "voxy-mode": page, recovery: null, digest: null, operation: null, native: null }); if (page === "recover") recoveryEntry(); else if (page === "guardian") guardianEntry(); else walletHome(); };
  function frame(title, html, selected = "wallet") {
    if (!alive) return;
    container.innerHTML = `<div class="vc-head"><span class="preview-label">Voxy · Sepolia</span><h2 class="vc-title">${title}</h2><nav class="vc-tabs" aria-label="Wallet sections">${[["wallet", "Wallet"], ["recover", "Recover access"], ["guardian", "Guardian approvals"]].map(([id, label]) => `<button type="button" class="vc-tab ${selected === id ? "active" : ""}" data-page="${id}" ${selected === id ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav></div><div class="vc-panel">${html}</div><div class="vc-foot"><span class="vc-dim">Sepolia testnet only</span><span class="vc-dim">Keys stay on your device</span></div>`;
    container.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => go(button.dataset.page)));
  }
  function touch() { clearTimeout(idle); idle = setTimeout(() => { if (!local) return; local = null; if (alive) notice(new Error("The local wallet locked after five minutes. Unlock it before signing another action.")); }, 5 * 60 * 1000); }
  container.addEventListener("pointerdown", touch);
  container.addEventListener("keydown", touch);
  function notice(message) { const node = container.querySelector("#vw-error"); if (node) { node.textContent = errorMessage(message); node.setAttribute("role", "alert"); } }
  async function action(button, label, work) {
    const old = button.textContent; button.disabled = true; button.textContent = label;
    try { await work(); } catch (error) { notice(error); }
    finally { if (button.isConnected) { button.disabled = false; button.textContent = old; } }
  }
  function connectionLabel() { return connection ? `${escape(connection.name)}: ${addressChip(connection.address)}` : "No signing wallet connected"; }
  async function connect(button, next) {
    await action(button, "Finding wallets…", async () => {
      const providers = await discoverProviders();
      if (!providers.length) throw new Error("Install a browser wallet for guardian approvals, or use an unlocked Voxy wallet.");
      const choose = async (choice) => {
        const account = await connectProvider(choice.provider);
        providerCleanup?.();
        connection = { ...choice, name: choice.info.name, address: account };
        const changed = (accounts) => { if (connection?.provider !== choice.provider) return; connection.address = accounts[0] || ""; if (!connection.address) connection = null; };
        const disconnected = () => { if (connection?.provider === choice.provider) connection = null; };
        choice.provider.on?.("accountsChanged", changed); choice.provider.on?.("disconnect", disconnected);
        providerCleanup = () => { choice.provider.removeListener?.("accountsChanged", changed); choice.provider.removeListener?.("disconnect", disconnected); };
        await next();
      };
      if (providers.length === 1) return choose(providers[0]);
      const picker = container.querySelector("#vw-picker");
      picker.innerHTML = `<div class="vc-wallets-list">${providers.map((provider, i) => `<button type="button" class="vc-wallet-pick" data-provider="${i}">${escape(provider.info.name)}</button>`).join("")}</div>`;
      picker.querySelectorAll("[data-provider]").forEach((item) => item.addEventListener("click", () => action(item, "Connecting…", () => choose(providers[Number(item.dataset.provider)]))));
    });
  }
  async function resolveGuardians(values) {
    const reader = createPublicClient({ chain: sepolia, transport: http(network.rpcUrls[0]) });
    return Promise.all(values.map(async (value) => {
      if (isAddress(value, { strict: false })) return getAddress(value);
      if (!value.toLowerCase().endsWith(".eth")) throw new Error("Enter a wallet address or Sepolia ENS name.");
      const address = await reader.getEnsAddress({ name: normalize(value) });
      if (!address) throw new Error("That ENS name does not resolve on Sepolia.");
      return getAddress(address);
    }));
  }
  function guardianCalls(prepared, account, guardians) {
    if (prepared.actionInput.account.toLowerCase() !== account.toLowerCase() || prepared.actionInput.action !== "guardians" || prepared.actionInput.guardians.length !== guardians.length || prepared.actionInput.guardians.some((g, i) => getAddress(g) !== getAddress(guardians[i]))) throw new Error("The guardian update differs from your chosen addresses.");
    const values = [...guardians]; while (values.length < 3) values.push("0x0000000000000000000000000000000000000000");
    const expiresAt = validateExpiry(prepared.actionInput.expiresAt);
    return [{ to: approvedDeployment.rosterSource, value: 0n, data: encodeFunctionData({ abi: ensRosterAbi, functionName: "setGuardians", args: [values, Math.floor(guardians.length / 2) + 1, expiresAt] }) }];
  }
  async function sign(typedData, account) {
    touch();
    if (local?.address.toLowerCase() === account.toLowerCase()) return local.signTypedData(typedData);
    if (connection?.address?.toLowerCase() !== account.toLowerCase()) throw new Error("Connect the wallet that must sign this action.");
    return signBrowser(connection.provider, typedData, account, network);
  }
  function signerAddress() { return connection?.address || local?.address; }
  function accountSigner(account) { return local?.address.toLowerCase() === account.toLowerCase() ? local.address : signerAddress(); }

  async function walletHome() {
    stop();
    if (activeAccount) return showAccount(activeAccount);
    let vaults;
    try { vaults = await listVaults(); } catch (error) { frame("Your wallet", `<p class="vc-note vc-warn">${escape(errorMessage(error))}</p><div id="vw-error" class="error"></div>`); return; }
    frame("Your wallet", `<div class="vc-section-intro"><h3>Your address. Your recovery.</h3><p>Create a normal Ethereum account here, or import a Sepolia key locally. Adding recovery keeps the same address and funds.</p></div>${vaults.length ? `<div class="vw-vaults">${vaults.map((vault, index) => `<button type="button" class="vw-vault" data-vault="${index}"><span>${addressChip(vault.address)}</span><span>${local?.address === vault.address ? "Unlocked" : "Unlock wallet"}</span></button>`).join("")}</div>` : ""}<div class="vc-enter-actions"><button type="button" class="button" id="vw-create">Create wallet</button><button type="button" class="text-button" id="vw-import-key">Import Sepolia key</button></div><label class="vw-file">Restore encrypted backup<input type="file" id="vw-import-backup" accept="application/json,.json" /></label><form id="vw-open" class="vc-gform"><label for="vw-address">Open a protected account by address</label><input id="vw-address" placeholder="0x…" autocomplete="off" spellcheck="false" /><button class="text-button" type="submit">Open account</button></form><p id="vw-error" class="error" role="alert"></p>`);
    container.querySelectorAll("[data-vault]").forEach((button) => button.addEventListener("click", () => unlockScreen(vaults[Number(button.dataset.vault)])));
    container.querySelector("#vw-create").onclick = () => createScreen(false);
    container.querySelector("#vw-import-key").onclick = () => createScreen(true);
    container.querySelector("#vw-import-backup").onchange = async (event) => {
      try { const file = event.target.files?.[0]; if (!file) return; if (file.size > 10000) throw new Error("This backup file is too large."); const vault = validateVault(JSON.parse(await file.text())); await saveVault(vault); unlockScreen(vault); } catch (error) { notice(error); }
    };
    container.querySelector("#vw-open").onsubmit = (event) => { event.preventDefault(); const account = container.querySelector("#vw-address").value.trim(); if (!isAddress(account, { strict: false })) return notice(new Error("Enter a valid wallet address.")); activeAccount = account; showAccount(account); };
  }
  function createScreen(importing) {
    stop();
    frame(importing ? "Import a Sepolia wallet" : "Create your wallet", `<form id="vw-create-form" class="vc-gform"><p class="vc-fine">The private key is generated or imported on this device. Voxy’s API receives only public addresses and signed actions.</p>${importing ? '<label for="vw-private-key">Sepolia private key</label><input id="vw-private-key" type="password" autocomplete="off" spellcheck="false" /><p class="vc-fine">Use a testnet-only key. Never import a key that secures real assets.</p>' : ""}<label for="vw-password">Encryption password</label><input id="vw-password" type="password" minlength="12" autocomplete="new-password" required /><label for="vw-password-again">Confirm password</label><input id="vw-password-again" type="password" autocomplete="new-password" required /><p class="vc-fine">At least 12 characters. This password encrypts your backup; Voxy cannot reset it.</p><p id="vw-error" class="error" role="alert"></p><button class="button" type="submit">${importing ? "Encrypt and import" : "Create encrypted wallet"}</button></form>`);
    container.querySelector("#vw-create-form").onsubmit = (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button"); action(button, "Encrypting on your device…", async () => {
      const password = container.querySelector("#vw-password").value;
      if (password !== container.querySelector("#vw-password-again").value) throw new Error("The passwords do not match.");
      const created = await encryptWallet(password, importing ? container.querySelector("#vw-private-key").value.trim() : undefined);
      await saveVault(created.vault); local = created.account; activeAccount = local.address;
      backupScreen(created.vault);
    }); };
  }
  function backupScreen(vault) {
    frame("Save your wallet backup", `<div class="vc-section-intro"><h3>Keep this encrypted file somewhere safe</h3><p>You will need its password to unlock it. Your encrypted vault is also saved in this browser.</p></div>${fullAddress(vault.address)}<div class="vc-enter-actions"><button class="button" id="vw-download">Download encrypted backup</button></div><label class="vw-check"><input type="checkbox" id="vw-saved" /> I saved my encrypted backup.</label><p id="vw-error" class="error"></p><button class="button" id="vw-continue" disabled>Open my wallet</button>`);
    container.querySelector("#vw-download").onclick = () => downloadVault(vault);
    container.querySelector("#vw-saved").onchange = (event) => { container.querySelector("#vw-continue").disabled = !event.target.checked; };
    container.querySelector("#vw-continue").onclick = () => showAccount(vault.address);
  }
  function unlockScreen(vault) {
    frame("Unlock your wallet", `<form id="vw-unlock-form" class="vc-gform">${fullAddress(vault.address)}<label for="vw-unlock-password">Encryption password</label><input id="vw-unlock-password" type="password" autocomplete="current-password" required /><p id="vw-error" class="error" role="alert"></p><button class="button" type="submit">Unlock on this device</button><button class="text-button" id="vw-download" type="button">Download encrypted backup</button></form>`);
    container.querySelector("#vw-download").onclick = () => downloadVault(vault);
    container.querySelector("#vw-unlock-form").onsubmit = (event) => { event.preventDefault(); action(event.currentTarget.querySelector("button"), "Unlocking…", async () => { local = await unlockWallet(vault, container.querySelector("#vw-unlock-password").value); activeAccount = local.address; await showAccount(activeAccount); }); };
  }
  async function showAccount(account) {
    stop(); const version = sequence;
    activeAccount = account; setURL({ account, recovery: null, digest: null, operation: null, native: null, "voxy-mode": "wallet" });
    frame("Your wallet", '<div class="vc-loading">Reading the account on Sepolia…</div>');
    try {
      const state = await api.account(account, accountSigner(account));
      if (!alive || version !== sequence) return;
      const usable = state.configured && !state.frozen && state.guardians.filter((g) => !/^0x0+$/.test(g)).length >= state.threshold;
      const canSign = local?.address.toLowerCase() === account.toLowerCase() || state.controls;
      frame("Your wallet", `<section class="vc-summary"><div><span class="vc-state ${usable ? "vc-ok" : ""}">${state.configured ? state.frozen ? "Recovery paused" : usable ? "Recovery enabled" : "Guardians need renewal" : state.otherDelegation ? "Different delegation detected" : "Recovery not enabled"}</span><div class="vw-balance">${escape(state.balanceETH)} <small>Sepolia ETH</small></div></div></section>${fullAddress(state.account)}<div class="vc-enter-actions"><button class="text-button" id="vw-copy">Copy address</button><a href="${escape(state.explorer)}" target="_blank" rel="noopener noreferrer">View on Etherscan</a><button class="text-button" id="vw-refresh">Refresh</button>${local ? '<button class="text-button" id="vw-lock">Lock local wallet</button>' : '<button class="text-button" id="vw-unlock-local">Unlock local wallet</button>'}</div>${state.configured ? `<div class="vc-roster-summary"><h3>Recovery guardians</h3><p class="vc-fine">${state.threshold} approvals · ${state.delay / 60}-minute waiting period</p><div class="vc-guardian-list">${state.guardians.filter((g) => !/^0x0+$/.test(g)).map((g, i) => `<div><span>Guardian ${i + 1}</span>${addressChip(g)}</div>`).join("")}</div><p class="vc-fine">Guardian slots expire ${escape(new Date(Number(state.expiresAt) * 1000).toLocaleDateString())}. Renew them before that date.</p>${canSign ? `<div class="vc-enter-actions"><button class="text-button" id="vw-edit-guardians">Manage guardians</button><button class="text-button" id="vw-freeze">${state.frozen ? "Resume recovery" : "Pause recovery"}</button>${state.pending ? '<button class="text-button" id="vw-cancel-recovery">Cancel pending recovery</button>' : ""}</div>` : ""}<p class="vc-fine">Your address and funds remain here. Recovery adds a controller; the original key remains authoritative.</p></div>` : `<p class="vc-fine">Fund this address with Sepolia ETH from a faucet or another wallet. Voxy sponsors recovery enrollment gas.</p>`}${!state.configured && !state.otherDelegation && local?.address.toLowerCase() === account.toLowerCase() ? '<div class="vc-enter-actions"><button class="button" id="vw-protect">Choose recovery guardians</button></div>' : ""}${state.otherDelegation ? '<p class="vc-note vc-warn">Enrollment will not replace another account delegation.</p>' : ""}${state.configured || local?.address.toLowerCase() === account.toLowerCase() ? `<div class="vw-transfer"><h3>Send Sepolia ETH</h3><p class="vc-fine">${canSign ? "Review a transfer, then sign it with a controller. The sponsor cannot move funds without that signature." : "Connect a controller of this account to authorize a transfer."}</p><p class="vc-fine">${connectionLabel()}</p><button class="text-button" id="vw-connect-controller">Connect a controller</button><div id="vw-picker"></div>${canSign ? '<form id="vw-transfer-form" class="vc-gform"><label for="vw-to">Recipient address</label><input id="vw-to" placeholder="0x…" autocomplete="off" spellcheck="false" /><label for="vw-amount">Amount in ETH</label><input id="vw-amount" inputmode="decimal" autocomplete="off" /><button class="text-button" id="vw-max" type="button">Use available balance</button><button class="button" type="submit">Review transfer</button></form>' : ""}</div>` : ""}<p id="vw-error" class="error" role="alert"></p><button class="text-button" id="vw-other">Choose another wallet</button>`);
      container.querySelector("#vw-copy").onclick = () => navigator.clipboard.writeText(state.account).catch(notice);
      container.querySelector("#vw-refresh").onclick = () => showAccount(account);
      container.querySelector("#vw-lock")?.addEventListener("click", () => { local = null; activeAccount = null; setURL({ account: null }); walletHome(); });
      container.querySelector("#vw-other").onclick = () => { activeAccount = null; setURL({ account: null }); walletHome(); };
      container.querySelector("#vw-unlock-local")?.addEventListener("click", (event) => action(event.currentTarget, "Finding encrypted wallet…", async () => { const vault = (await listVaults()).find((item) => item.address.toLowerCase() === account.toLowerCase()); if (!vault) throw new Error("No local vault was found. Choose another wallet and restore your encrypted backup."); unlockScreen(vault); }));
      container.querySelector("#vw-edit-guardians")?.addEventListener("click", () => enrollmentScreen(account, true));
      container.querySelector("#vw-freeze")?.addEventListener("click", (event) => action(event.currentTarget, "Preparing action…", () => controllerReview(account, state.frozen ? "unfreeze" : "freeze")));
      container.querySelector("#vw-cancel-recovery")?.addEventListener("click", (event) => action(event.currentTarget, "Preparing cancellation…", () => controllerReview(account, "cancel")));
      container.querySelector("#vw-protect")?.addEventListener("click", () => enrollmentScreen(account));
      container.querySelector("#vw-connect-controller")?.addEventListener("click", (event) => connect(event.currentTarget, () => showAccount(account)));
      container.querySelector("#vw-max")?.addEventListener("click", () => { container.querySelector("#vw-amount").value = state.balanceETH; });
      container.querySelector("#vw-transfer-form")?.addEventListener("submit", (event) => { event.preventDefault(); const to = container.querySelector("#vw-to").value.trim(); const amount = container.querySelector("#vw-amount").value.trim(); action(event.currentTarget.querySelector('button[type="submit"]'), "Preparing transfer…", () => transferReview(account, to, amount, !state.configured)); });
    } catch (error) { if (version === sequence) frame("Account unavailable", `<p class="vc-note vc-warn">${escape(errorMessage(error))}</p><button class="text-button" id="vw-retry">Retry</button>`); container.querySelector("#vw-retry")?.addEventListener("click", () => showAccount(account)); }
  }
  function enrollmentScreen(account, updating = false) {
    stop();
    frame(updating ? "Manage guardians" : "Add recovery", `<div class="vc-section-intro"><h3>Choose people you trust</h3><p>Guardians can approve a replacement controller after a three-minute waiting period. They cannot move your funds through a recovery approval.</p></div><form id="vw-guardians" class="vc-gform">${[0, 1, 2].map((i) => `<label for="vw-g${i}">Guardian ${i + 1}${i ? " (optional)" : ""}</label><input id="vw-g${i}" placeholder="0x… address or Sepolia name.eth" autocomplete="off" spellcheck="false" />`).join("")}<p class="vc-fine">A majority must approve. Your account cannot be its own guardian. These addresses and approvals are public.</p><p id="vw-error" class="error" role="alert"></p><button class="button" type="submit">Review recovery setup</button></form>`);
    container.querySelector("#vw-guardians").onsubmit = (event) => { event.preventDefault(); action(event.currentTarget.querySelector("button"), "Checking guardian addresses…", async () => {
      const guardians = await resolveGuardians([0, 1, 2].map((i) => container.querySelector(`#vw-g${i}`).value.trim()).filter(Boolean));
      const prepared = updating ? await api.prepareController({ account, guardians, action: "guardians" }) : await api.prepareEnrollment(account, guardians);
      const message = updating ? { ...prepared.message, threshold: prepared.threshold, guardian0: prepared.actionInput.guardians[0], guardian1: prepared.actionInput.guardians[1] || "0x0000000000000000000000000000000000000000", guardian2: prepared.actionInput.guardians[2] || "0x0000000000000000000000000000000000000000" } : prepared.message;
      frame("Review recovery setup", `${fullAddress(account)}<div class="vc-grid"><div class="vc-row"><span>Approvals required</span><strong>${message.threshold} of ${guardians.length}</strong></div><div class="vc-row"><span>Waiting period</span><strong>3 minutes</strong></div></div><div class="vc-guardian-list">${[message.guardian0, message.guardian1, message.guardian2].filter((g) => !/^0x0+$/.test(g)).map((g, i) => `<div><span>Guardian ${i + 1}</span>${addressChip(g)}</div>`).join("")}</div><p class="vc-fine">${updating ? "This updates this account’s ENS guardian roster and invalidates recovery approvals for the previous roster." : "This delegates your existing EOA to Voxy recovery and creates its ENS guardian roster."} Your address and funds stay the same. Guardian slots expire in one year.</p><p id="vw-error" class="error" role="alert"></p><button class="button" id="vw-enroll">${updating ? "Sign and save guardians" : "Sign and enable recovery"}</button>`);
      container.querySelector("#vw-enroll").onclick = (click) => action(click.currentTarget, "Signing on this device…", async () => {
        if (updating) {
          const signer = accountSigner(account); if (!signer) throw new Error("Connect a controller before changing guardians.");
          const signature = await sign(executionData(prepared, account, guardianCalls(prepared, account, guardians)), signer);
          const operation = await api.controller({ actionInput: prepared.actionInput, message: prepared.message, signature });
          return watchOperation(operation.id, account);
        }
        if (!local || local.address.toLowerCase() !== account.toLowerCase()) throw new Error("Unlock this account locally before enrolling it.");
        const signing = enrollmentData(prepared, account, guardians, approvedDeployment.implementation);
        const reader = createPublicClient({ chain: sepolia, transport: http(network.rpcUrls[0]) });
        const code = await reader.getCode({ address: account });
        if (code && code !== "0x" && code.toLowerCase() !== `0xef0100${approvedDeployment.implementation.slice(2).toLowerCase()}`) throw new Error("The account delegates elsewhere; enrollment will not replace it.");
        const signature = await local.signTypedData(signing);
        const authorization = await local.signAuthorization(authorizationData(prepared, approvedDeployment.implementation));
        const id = `enroll-${hashTypedData({ domain: eoaDomain(message.account), types: { Enrollment: eoaTypes.Enrollment }, primaryType: "Enrollment", message })}`;
        setURL({ account, operation: native ? null : id, native: native ? id : null });
        await api.enroll({ message, signature, authorization });
        watchOperation(id, account);
      });
    }); };
  }
  async function controllerReview(account, actionName) {
    const prepared = await api.prepareController({ account, action: actionName });
    const labels = { freeze: "Pause recovery", unfreeze: "Resume recovery", cancel: "Cancel pending recovery" };
    frame(labels[actionName], `<p class="vc-fine">This controller-signed action applies to:</p>${fullAddress(account)}<p class="vc-fine">${actionName === "cancel" || actionName === "freeze" ? "It invalidates pending recovery and collected approvals for the current owner epoch." : "Guardian recovery will be available again."}</p><p id="vw-error" class="error" role="alert"></p><button class="button" id="vw-control-sign">Sign and confirm</button>`);
    container.querySelector("#vw-control-sign").onclick = (event) => action(event.currentTarget, "Waiting for signature…", async () => {
      const signer = accountSigner(account); if (!signer) throw new Error("Connect a controller first.");
      const call = actionName === "cancel" ? encodeFunctionData({ abi: recoveryAccountAbi, functionName: "cancelRecovery" }) : encodeFunctionData({ abi: recoveryAccountAbi, functionName: "setFrozen", args: [actionName === "freeze"] });
      const signature = await sign(executionData(prepared, account, [{ to: account, value: 0n, data: call }]), signer);
      const operation = await api.controller({ actionInput: prepared.actionInput, message: prepared.message, signature });
      watchOperation(operation.id, account);
    });
  }
  async function transferReview(account, to, amount, native = false) {
    if (!isAddress(to, { strict: false }) || to.toLowerCase() === account.toLowerCase()) throw new Error("Enter another valid recipient address.");
    if (native) {
      if (!local || local.address.toLowerCase() !== account.toLowerCase()) throw new Error("Unlock this wallet to sign a native ETH transfer.");
      const balance = (await api.account(account)).balanceETH;
      const prepared = await prepareNativeTransfer(local, network, to, amount, amount === balance);
      frame("Review transfer", `<h3>${escape(prepared.amount)} Sepolia ETH</h3><p class="vc-fine">To:</p>${fullAddress(to)}<p class="vc-fine">Network fee up to ${escape(prepared.maximumFee)} ETH, paid by this wallet.</p><p id="vw-error" class="error" role="alert"></p><button class="button" id="vw-native-send">Sign and send ETH</button>`);
      container.querySelector("#vw-native-send").onclick = (event) => action(event.currentTarget, "Signing on this device…", async () => {
        if (!local || local.address.toLowerCase() !== account.toLowerCase()) throw new Error("The wallet was locked. Unlock and review the transfer again.");
        const hash = await sendNativeTransfer(local, network, prepared);
        setURL({ account, native: hash, operation: null });
        watchOperation(hash, account, true);
      });
      return;
    }
    const prepared = await api.prepareTransfer({ account, to, amount });
    const signer = accountSigner(account);
    if (!signer) throw new Error("Unlock or connect a controller first.");
    frame("Review transfer", `<div class="vc-section-intro"><h3>${escape(amount)} Sepolia ETH</h3><p>From ${addressChip(account)} to:</p>${fullAddress(to)}<p>The funds leave the original account only after you sign this transfer.</p></div><p id="vw-error" class="error" role="alert"></p><button class="button" id="vw-send">Sign and send ETH</button>`);
    container.querySelector("#vw-send").onclick = (event) => action(event.currentTarget, "Waiting for your signature…", async () => {
      const signature = await sign(executionData(prepared, account, [{ to: getAddress(to), value: parseEther(amount), data: "0x" }]), signer);
      const message = prepared.message;
      const id = `send-${message.account}-${message.nonce}-${message.callsHash}`;
      setURL({ account, operation: native ? null : id, native: native ? id : null });
      await api.transfer({ account, to, amount, message, signature });
      watchOperation(id, account);
    });
  }
  function watchOperation(id, account, native = false) {
    stop(); const version = sequence;
    setURL({ account, operation: native ? null : id, native: native ? id : null });
    frame("Transaction status", '<div class="vc-loading" role="status">Checking the saved transaction…</div><p id="vw-error" class="error" role="alert"></p>');
    const check = async () => {
      try {
        const operation = native ? await api.nativeStatus(id) : await api.operation(id);
        if (!alive || version !== sequence) return;
        if (operation.phase === "confirmed") { setURL({ operation: null, native: null }); return showAccount(account); }
        frame(operation.phase === "reverted" ? "Transaction reverted" : "Waiting for confirmation", `<p class="vc-fine">${operation.phase === "reverted" ? escape(operation.error) : "The submitted transaction is saved. You can refresh this page and resume checking its original hash."}</p><div class="vc-txlist">${txLink(operation)}</div><p id="vw-error" class="error" role="alert"></p><button class="text-button" id="vw-check-account">Check account state</button>`);
        container.querySelector("#vw-check-account").onclick = () => showAccount(account);
        if (operation.phase !== "reverted") poll = setTimeout(check, 3000);
      } catch (error) { if (version === sequence) { notice(error); poll = setTimeout(check, 5000); } }
    };
    check();
  }
  function recoveryEntry() {
    stop();
    frame("Recover access", `<div class="vc-section-intro"><h3>Return to the same address</h3><p>Enter the protected EOA’s address. You do not need its original key. Connect a replacement controller you own, then ask your guardians to approve it.</p></div><form id="vw-recover-form" class="vc-gform"><label for="vw-lost">Protected account address</label><input id="vw-lost" placeholder="0x…" value="${escape(activeAccount || "")}" autocomplete="off" spellcheck="false" /><p class="vc-fine">${connectionLabel()}${local ? ` · Local wallet: ${addressChip(local.address)}` : ""}</p><button type="button" class="text-button" id="vw-connect">Connect replacement wallet</button><div id="vw-picker"></div><p class="vc-fine">If no browser wallet is connected, your unlocked local wallet will be the replacement controller.</p><p id="vw-error" class="error" role="alert"></p><button class="button" type="submit">Review recovery request</button></form>`, "recover");
    container.querySelector("#vw-connect").onclick = (event) => { activeAccount = container.querySelector("#vw-lost").value.trim(); connect(event.currentTarget, recoveryEntry); };
    container.querySelector("#vw-recover-form").onsubmit = (event) => { event.preventDefault(); const account = container.querySelector("#vw-lost").value.trim(); action(event.currentTarget.querySelector('button[type="submit"]'), "Checking recovery state…", async () => {
      const controller = signerAddress(); if (!controller) throw new Error("Connect a replacement wallet, or unlock a different local wallet.");
      const prepared = await api.prepareRecovery(account, controller);
      frame("Review recovery request", `<p class="vc-fine">Recover this account:</p>${fullAddress(account)}<p class="vc-fine">Add this replacement controller:</p>${fullAddress(controller)}<p class="vc-fine">${prepared.threshold} guardians must approve. Then the account enforces a three-minute waiting period. This request and guardian approvals are published on Arkiv Rabdi.</p><p id="vw-error" class="error" role="alert"></p><button class="button" id="vw-publish">Sign and share with guardians</button>`, "recover");
      container.querySelector("#vw-publish").onclick = (click) => action(click.currentTarget, "Publishing your signed request…", async () => {
        const request = recoveryData(prepared.message, account, controller);
        const proof = await sign(request, controller);
        const digest = eoaRecoveryHash(request.message);
        setURL({ recovery: prepared.message.requestId, digest, "voxy-mode": "recover", operation: null });
        await api.requestRecovery(prepared.message, proof);
        watchRecovery(prepared.message.requestId, digest);
      });
    }); };
  }
  function guardianEntry() {
    stop();
    frame("Guardian approvals", `<div class="vc-section-intro"><h3>Approve someone’s way back</h3><p>Connect the address they chose as a guardian. Review the protected account and replacement controller before signing.</p></div><p class="vc-fine">${connectionLabel()}</p><button class="button" id="vw-guardian-connect">Connect guardian wallet</button><div id="vw-picker"></div>${local ? '<button class="text-button" id="vw-local-guardian">Use unlocked local wallet</button>' : ""}<form id="vw-request-link" class="vc-gform"><label for="vw-request-id">Or open a shared request ID or link</label><input id="vw-request-id" autocomplete="off" spellcheck="false" /><button class="text-button" type="submit">Open request</button></form><div id="vw-requests"></div><p id="vw-error" class="error" role="alert"></p>`, "guardian");
    const load = async (guardian) => { const result = await api.requests("guardian", guardian); const node = container.querySelector("#vw-requests"); if (!node) return; node.innerHTML = result.requests.length ? result.requests.map((r, i) => `<button class="vw-vault" data-request="${i}"><span>${addressChip(r.account)} → ${addressChip(r.newController)}</span><span>${r.approved}/${r.threshold} approvals</span></button>`).join("") : '<p class="vc-note">No active requests were found for this guardian.</p>'; if (!result.complete) node.innerHTML += '<p class="vc-note vc-warn">This list is incomplete. Open the direct request link to find a specific recovery.</p>'; node.querySelectorAll("[data-request]").forEach((button) => button.onclick = () => watchRecovery(result.requests[Number(button.dataset.request)].id, eoaRecoveryHash(parseEOARecovery(result.requests[Number(button.dataset.request)].typedData.message)))); };
    container.querySelector("#vw-guardian-connect").onclick = (event) => connect(event.currentTarget, () => load(connection.address));
    container.querySelector("#vw-local-guardian")?.addEventListener("click", (event) => action(event.currentTarget, "Finding requests…", () => load(local.address)));
    container.querySelector("#vw-request-link").onsubmit = (event) => { event.preventDefault(); try { let value = container.querySelector("#vw-request-id").value.trim(); let digest; if (value.startsWith("http")) { const link = new URL(value); value = link.searchParams.get("recovery"); digest = link.searchParams.get("digest"); } if (!/^0x[0-9a-f]{64}$/i.test(value || "")) throw new Error("Enter a valid request ID or Voxy request link."); watchRecovery(value, digest); } catch (error) { notice(error); } };
  }
  function watchRecovery(id, expectedDigest) {
    stop(); const version = sequence;
    setURL({ recovery: id, digest: expectedDigest || null, operation: null, "voxy-mode": "recover" });
    frame("Recovery progress", '<div class="vc-loading">Reading the request and account state…</div><p id="vw-error" class="error"></p>', "recover");
    let signing = false;
    const check = async () => {
      try {
        const state = await api.recovery(id);
        const parsed = parseEOARecovery(state.typedData.message);
        const digest = eoaRecoveryHash(parsed);
        if (expectedDigest && expectedDigest !== digest) throw new Error("The recovery differs from the request link. Do not sign it.");
        if (parsed.account !== getAddress(state.account) || parsed.newController !== getAddress(state.newController)) throw new Error("The request display does not match its signing data.");
        expectedDigest = digest;
        setURL({ digest });
        if (!alive || version !== sequence || signing) return;
        const titles = { publishing: "Publishing your request", "awaiting-approvals": "Waiting for your guardians", "quorum-ready": "Guardian quorum reached", submitting: "Submitting guardian approvals", "waiting-period": "Recovery waiting period", ready: "Ready to restore access", recovered: "Access restored", invalidated: "This request is no longer valid" };
        const signer = signerAddress();
        const eligible = signer && state.guardians.some((g) => g.toLowerCase() === signer.toLowerCase());
        const signed = signer && state.signers.some((g) => g.toLowerCase() === signer.toLowerCase());
        frame(titles[state.phase] || "Recovery progress", `<div class="vc-summary"><div><span class="vc-state ${state.finalized ? "vc-ok" : ""}">${state.finalized ? "Same account. Restored control." : state.phase === "waiting-period" || state.phase === "ready" ? `Ready after ${escape(new Date(state.pending.readyAt * 1000).toLocaleTimeString())}` : `${state.approved} of ${state.threshold} approvals`}</span><h3>${state.finalized ? "Your funds are still at the original address" : "Your guardians approve the replacement controller"}</h3></div></div><p class="vc-fine">Protected account</p>${fullAddress(state.account)}<p class="vc-fine">Replacement controller</p>${fullAddress(state.newController)}<div class="vc-guardian-list">${state.guardians.filter((g) => !/^0x0+$/.test(g)).map((g) => `<div>${addressChip(g)}<span>${state.signers.some((s) => s.toLowerCase() === g.toLowerCase()) ? "Approved" : state.pending || state.finalized ? "Quorum accepted on-chain" : "Awaiting approval"}</span></div>`).join("")}</div>${state.phase === "waiting-period" ? '<p class="vc-fine">The three-minute waiting period is enforced by the contract. The original controller can cancel before it finishes.</p>' : ""}${state.operation ? `<div class="vc-txlist">${txLink(state.operation)}</div>` : ""}<p class="vc-fine">${connectionLabel()}</p><div class="vc-enter-actions"><button class="text-button" id="vw-share">Copy guardian request link</button>${!state.finalized && state.phase !== "invalidated" ? '<button class="text-button" id="vw-connect-guardian">Connect signing wallet</button>' : ""}${eligible && !signed && state.phase === "awaiting-approvals" ? '<button class="button" id="vw-approve">Approve this recovery</button>' : ""}${state.phase === "quorum-ready" ? '<button class="button" id="vw-submit">Submit approved recovery</button>' : ""}${state.phase === "ready" ? '<button class="button" id="vw-finalize">Restore access</button>' : ""}${state.finalized ? '<button class="button" id="vw-open-restored">Open recovered account</button>' : ""}</div><div id="vw-picker"></div><p id="vw-error" class="error" role="alert"></p>${!state.complete ? '<p class="vc-note vc-warn">The approval scan is incomplete. Quorum cannot be claimed.</p>' : ""}`, "recover");
        container.querySelector("#vw-share").onclick = () => { const link = url(); link.search = ""; link.searchParams.set("recovery", id); link.searchParams.set("digest", expectedDigest); link.searchParams.set("voxy-mode", "guardian"); navigator.clipboard.writeText(link.href).catch(notice); };
        container.querySelector("#vw-connect-guardian")?.addEventListener("click", (event) => { signing = true; clearTimeout(poll); connect(event.currentTarget, () => { signing = false; check(); }).finally(() => { signing = false; if (alive && version === sequence) poll = setTimeout(check, 5000); }); });
        container.querySelector("#vw-approve")?.addEventListener("click", (event) => { signing = true; clearTimeout(poll); action(event.currentTarget, "Signing guardian approval…", async () => { const signature = await sign(recoveryData(state.typedData.message, state.account, state.newController, expectedDigest), signer); await api.approve(id, signature); }).finally(() => { signing = false; check(); }); });
        container.querySelector("#vw-submit")?.addEventListener("click", (event) => action(event.currentTarget, "Submitting…", async () => { await api.submit(id); check(); }));
        container.querySelector("#vw-finalize")?.addEventListener("click", (event) => { signing = true; clearTimeout(poll); action(event.currentTarget, "Submitting finalization…", async () => { const op = await api.finalize(state.account); watchOperation(op.id, state.account); }).finally(() => { signing = false; }); });
        container.querySelector("#vw-open-restored")?.addEventListener("click", () => showAccount(state.account));
        if (!state.finalized && state.phase !== "invalidated") poll = setTimeout(check, 5000);
      } catch (error) { if (alive && version === sequence) { notice(error); poll = setTimeout(check, 8000); } }
    };
    check();
  }
  async function boot() {
    frame("Opening your wallet", '<div class="vc-loading">Verifying the Sepolia recovery deployment…</div>');
    try {
      const config = await api.config();
      if (!approvedDeployment || config.implementation.toLowerCase() !== approvedDeployment.implementation.toLowerCase() || config.rosterSource.toLowerCase() !== approvedDeployment.rosterSource.toLowerCase()) throw new Error("This recovery deployment is not approved by the wallet release.");
      network = { chainId: "0xaa36a7", chainName: "Sepolia", rpcUrls: [approvedDeployment.rpc], nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://sepolia.etherscan.io"] };
      const reader = createPublicClient({ chain: sepolia, transport: http(approvedDeployment.rpc) });
      const [implementation, source] = await Promise.all([reader.getCode({ address: approvedDeployment.implementation }), reader.getCode({ address: approvedDeployment.rosterSource })]);
      if (!implementation || !source || keccak256(implementation) !== approvedDeployment.implementationCodeHash || keccak256(source) !== approvedDeployment.rosterCodeHash) throw new Error("The public recovery bytecode does not match this wallet release.");
      if (!alive) return;
      const params = url().searchParams;
      const request = params.get("recovery");
      const account = params.get("account");
      const operation = params.get("operation");
      const native = params.get("native");
      if (request && /^0x[0-9a-f]{64}$/i.test(request)) return watchRecovery(request, params.get("digest"));
      if (account && isAddress(account, { strict: false })) { activeAccount = account; if (native) return watchOperation(native, account, true); if (operation) return watchOperation(operation, account); return showAccount(account); }
      const page = params.get("voxy-mode") || (mode === "recover" ? "recover" : "wallet");
      go(page);
    } catch (error) { frame("Recovery is unavailable", `<p class="vc-note vc-warn">${escape(errorMessage(error))}</p><p class="vc-fine">Your keys and existing on-chain funds remain yours. Try again when the recovery service is available.</p><button class="text-button" id="vw-boot-retry">Retry</button>`); container.querySelector("#vw-boot-retry").onclick = boot; }
  }
  touch();
  boot();
  return () => { alive = false; local = null; stop(); clearTimeout(idle); providerCleanup?.(); container.removeEventListener("pointerdown", touch); container.removeEventListener("keydown", touch); dialog?.classList.remove("vc-dialog"); };
}
