import "./console.css";
import { api, short } from "./api.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const isGuardianInput = (v) => isAddress(v) || /\.eth$/i.test(v.trim()) || v.trim() === "";
const majorityOf = (n) => (n <= 0 ? 1 : Math.floor(n / 2) + 1);
// Test/placeholder addresses are all one repeated hex char (0x3333…3333, 0x2222…2222).
const isPlaceholder = (a) => /^0x([0-9a-f])\1{39}$/i.test((a || "").trim());
const isZero = (a) => /^0x0+$/.test((a || "").trim());

// Discover injected wallets via EIP-6963 (Rainbow, MetaMask, Rabby, …). Falls back to legacy
// window.ethereum. Returns [{ info:{name,…}, provider }]. No deps — raw browser events.
function discoverWallets(timeout = 300) {
  return new Promise((resolve) => {
    const map = new Map();
    const onAnnounce = (e) => {
      const d = e.detail;
      if (d?.info?.uuid) map.set(d.info.uuid, d);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      let list = [...map.values()];
      if (!list.length && window.ethereum?.request) {
        const w = window.ethereum;
        const name = w.isRainbow ? "Rainbow" : w.isMetaMask ? "MetaMask" : "Injected wallet";
        list = [{ info: { name, uuid: "legacy" }, provider: w }];
      }
      resolve(list);
    }, timeout);
  });
}
async function requestAccount(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const addr = accounts?.[0];
  if (!addr) throw new Error("No account was selected in your wallet.");
  return addr;
}

const ext = (href) =>
  href
    ? `<a class="vc-ext" href="${href}" target="_blank" rel="noopener" aria-label="View on explorer">↗</a>`
    : "";
const chip = (v, title) => `<code class="vc-chip" title="${title ?? v}">${short(v)}</code>`;
const ownerChip = (a) => `${chip(a)}${isPlaceholder(a) ? ' <span class="vc-dim">test</span>' : ""}`;

function row(label, value, cls = "") {
  return `<div class="vc-row"><span class="vc-label">${label}</span><span class="vc-value ${cls}">${value}</span></div>`;
}

const TABS = [
  ["overview", "Overview"],
  ["guardians", "Guardians"],
  ["recover", "Recover"],
  ["surfaces", "Surfaces"],
];

export function mountConsole(container, mode) {
  const dialog = container.closest("dialog");
  dialog?.classList.add("vc-dialog");
  const view = {
    tab: mode === "recover" ? "recover" : "overview",
    wallet: undefined,
    walletName: undefined,
    loaded: false,
    draft: null,
    provider: null,
    owner: null,
    recovery: null,
  };
  let timer;
  let S;
  let G;
  const clearTimer = () => timer && clearInterval(timer);
  const draftFrom = (gcfg) => {
    if (gcfg.sharedLegacy) return [""];
    const live = gcfg.slots.map((s) => s.guardian).filter((a) => a && !isZero(a));
    return live.length ? live : [""];
  };

  // Connect flow shared by the entry gate and the EOA screen: discover wallets, connect one
  // (or show a picker when several are installed), then hand back the address.
  async function doConnect(btn, errEl, pickerEl, onAddr) {
    const label = btn.textContent;
    const reset = () => {
      btn.disabled = false;
      btn.textContent = label;
    };
    btn.disabled = true;
    btn.textContent = "Connecting…";
    if (errEl) errEl.textContent = "";
    if (pickerEl) pickerEl.innerHTML = "";
    const wallets = await discoverWallets().catch(() => []);
    if (!wallets.length) {
      if (errEl) errEl.textContent = "No browser wallet found. Install Rainbow, MetaMask, or another wallet.";
      reset();
      return;
    }
    const connect = async (w) => {
      try {
        const addr = await requestAccount(w.provider);
        view.walletName = w.info.name;
        view.provider = w.provider;
        view.owner = addr;
        await onAddr(addr);
      } catch (e) {
        if (errEl) errEl.textContent = e.message;
        reset();
      }
    };
    if (wallets.length === 1) {
      await connect(wallets[0]);
      return;
    }
    reset();
    if (pickerEl) {
      pickerEl.innerHTML = `<p class="vc-fine">Choose a wallet:</p><div class="vc-wallets-list">${wallets
        .map((w, i) => `<button type="button" class="vc-wallet-pick" data-i="${i}">${escape(w.info.name)}</button>`)
        .join("")}</div>`;
      pickerEl
        .querySelectorAll(".vc-wallet-pick")
        .forEach((b) => b.addEventListener("click", () => connect(wallets[Number(b.dataset.i)])));
    }
  }

  async function switchToDevnet() {
    const chain = S.ownerActions.chain;
    const current = await view.provider.request({ method: "eth_chainId" });
    if (current.toLowerCase() === chain.chainId.toLowerCase()) return;
    try {
      await view.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await view.provider.request({ method: "wallet_addEthereumChain", params: [chain] });
      await view.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
    }
  }

  /* ---------------------------------------------------------- entry gate */
  function renderEntry() {
    clearTimer();
    container.innerHTML = `
      <div class="vc-head">
        <span class="preview-label">Voxy recovery</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Protect a wallet"}</h2>
      </div>
      <form id="vc-enter" class="vc-enter" novalidate>
        <label for="vc-wallet">${mode === "recover" ? "Which wallet do you want to recover?" : "Which wallet do you want to protect?"}</label>
        <button type="button" class="button" id="vc-connect">Connect wallet</button>
        <div id="vc-wallets" class="vc-wallets"></div>
        <div class="vc-or"><span>or enter an address</span></div>
        <div class="vc-walletbar-row">
          <input id="vc-wallet" placeholder="0x… address or name.eth" autocomplete="off" spellcheck="false" />
          <button class="button button-small" type="submit">Load</button>
        </div>
        <p id="vc-wallet-err" class="error" role="alert"></p>
        <button type="button" class="text-button" id="vc-demo">Use the live demo wallet →</button>
        <p class="vc-fine">Connect your wallet or enter any address to read its live on-chain state. This testnet demo signs guardian &amp; recovery actions for the demo wallet, whose keys the server holds.</p>
      </form>
      <div class="vc-foot">
        <span class="vc-dim">Live reads · Sepolia + alt-mempool devnet</span>
      </div>`;
    const go = (wallet) => {
      view.wallet = wallet;
      view.loaded = true;
      load();
    };
    container.querySelector("#vc-enter").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = container.querySelector("#vc-wallet").value.trim();
      const err = container.querySelector("#vc-wallet-err");
      if (!v || !isGuardianInput(v)) {
        err.textContent = "Enter a 0x… address or a name.eth.";
        return;
      }
      go(v);
    });
    container.querySelector("#vc-connect").addEventListener("click", (e) =>
      doConnect(
        e.currentTarget,
        container.querySelector("#vc-wallet-err"),
        container.querySelector("#vc-wallets"),
        (addr) => go(addr),
      ),
    );
    container.querySelector("#vc-demo").addEventListener("click", () => go(undefined));
  }

  /* -------------------------------------------------------------- loader */
  async function load() {
    clearTimer();
    container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-loading"><span class="status-dot"></span> Reading live chain state…</div>`;
    try {
      const previous = S?.wallet;
      S = await api.state(view.wallet);
      G = S.guardianConfig;
      if (previous?.toLowerCase() !== S.wallet.toLowerCase()) { view.draft = null; view.recovery = null; }
      const url = new URL(location.href);
      url.searchParams.set("voxy", view.wallet ?? S.wallet);
      history.replaceState(null, "", url);
    } catch (err) {
      container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-note vc-warn">Couldn't load that wallet: ${escape(err.message)}.</div><button class="text-button" id="vc-retry">← Choose another wallet</button>`;
      container.querySelector("#vc-retry")?.addEventListener("click", () => {
        view.loaded = false;
        view.wallet = undefined;
        renderEntry();
      });
      return;
    }
    if (!view.draft) view.draft = G ? draftFrom(G) : [""];
    if (S.isVoxyWallet === false) {
      renderNotVoxy();
      return;
    }
    render();
  }

  /* ----------------------------------------- not a Voxy wallet (an EOA) */
  function renderNotVoxy() {
    clearTimer();
    const s = S;
    container.innerHTML = `
      <div class="vc-head">
        <span class="preview-label">Voxy recovery</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Protect a wallet"}</h2>
        <form id="vc-switch" class="vc-walletbar">
          <label for="vc-wallet">${mode === "recover" ? "Wallet to recover" : "Wallet to protect"}</label>
          <div class="vc-walletbar-row">
            <input id="vc-wallet" value="${escape(view.wallet ?? "")}" placeholder="0x… address or name.eth" autocomplete="off" spellcheck="false" />
            <button class="button button-small" type="submit">Load</button>
          </div>
          <p id="vc-wallet-err" class="error" role="alert"></p>
        </form>
      </div>
      <div class="vc-panel">
        <section class="vc-setup">
          <span class="vc-connected">${view.walletName ? `Connected with ${escape(view.walletName)}` : "Account checked on-chain"}</span>
          <h3>Add a recovery account</h3>
          <p>No Voxy account was found for ${chip(s.wallet)}. Create one owned by this address, then choose the people who can help you recover it.</p>
          <div class="vc-setup-details"><span>Gas sponsored</span><span>Your choice of guardians</span><span>Saved on-chain</span></div>
          <p class="vc-fine">This creates a separate smart account. Recovery protects that account; assets in your existing wallet stay in your existing wallet.</p>
        </section>
        <div class="vc-enter-actions">
          <button class="button" id="vc-create">Create recovery account</button>
          <button class="text-button" id="vc-connect">Connect a different wallet</button>
          <button class="text-button" id="vc-usedemo">Use the demo wallet →</button>
        </div>
        <div id="vc-wallets2" class="vc-wallets"></div>
        <div id="vc-createresult"></div>
      </div>
      <div class="vc-foot">
        <span class="vc-dim">Live reads · Sepolia + alt-mempool devnet</span>
      </div>`;
    container.querySelector("#vc-switch")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = container.querySelector("#vc-wallet").value.trim();
      const err = container.querySelector("#vc-wallet-err");
      if (v && !isGuardianInput(v)) {
        if (err) err.textContent = "Enter a 0x… address or a name.eth.";
        return;
      }
      view.wallet = v && v.toLowerCase() !== s.demoWallet.toLowerCase() ? v : undefined;
      load();
    });
    container.querySelector("#vc-connect")?.addEventListener("click", (e) =>
      doConnect(
        e.currentTarget,
        container.querySelector("#vc-wallet-err"),
        container.querySelector("#vc-wallets2"),
        (addr) => {
          view.wallet = addr;
          load();
        },
      ),
    );
    container.querySelector("#vc-usedemo")?.addEventListener("click", () => {
      view.wallet = undefined;
      load();
    });
    container.querySelector("#vc-create")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Creating account…";
      const result = container.querySelector("#vc-createresult");
      result.innerHTML = `<div class="vc-note"><span class="status-dot"></span> Creating your account on-chain. Keep this window open; if it closes, reconnect to find your account.</div>`;
      try {
        const res = await api.createWallet(s.wallet);
        view.wallet = res.wallet;
        view.draft = null;
        view.tab = "guardians";
        load();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Create recovery account";
        result.innerHTML = `<div class="vc-note vc-warn">${escape(err.message)}</div>`;
      }
    });
  }

  /* -------------------------------------------------------------- panels */
  function panelOverview() {
    const s = S;
    const g = s.roster.guardians.filter((a) => a && !isZero(a));
    const ready = g.length >= s.roster.threshold && s.roster.threshold > 0 && s.roster.crossChainMatch && !G?.sharedLegacy;
    return `
      <section class="vc-summary">
        <div><span class="vc-state ${s.frozen ? "vc-bad" : ready ? "vc-ok" : ""}">${s.frozen ? "Recovery frozen" : ready ? "Recovery enabled" : G?.sharedLegacy ? "Replace demo guardians" : "Choose your guardians"}</span>
        <h3>${ready ? `${s.roster.threshold} approvals protect this account` : "One more step to protect your account"}</h3>
        <p>${ready ? `A new owner can be added after a ${s.recoveryDelaySeconds}-second waiting period.` : "Add trusted people in Guardians. Your account is already saved on-chain."}</p></div>
        <div class="vc-quorum"><strong>${g.length}</strong><span>guardians</span></div>
      </section>
      <div class="vc-grid">
        ${row("Recovery account", `${chip(s.wallet)}${ext(`${s.explorer.devnet}/address/${s.wallet}`)}`)}
        ${row("Owner addresses", s.owners.map(ownerChip).join(" "))}
        ${row("Recovery delay", `${s.recoveryDelaySeconds} seconds`)}
      </div>
      <section class="vc-roster-summary"><h3>${G?.sharedLegacy ? "Current demo guardian roster" : "Guardian roster"}</h3>
        ${g.length ? `<div class="vc-guardian-list">${g.map((a, i) => `<div><span>Guardian ${i + 1}</span>${chip(a)}</div>`).join("")}</div>` : `<p class="vc-fine">No guardians configured. Add your own addresses or Sepolia ENS names.</p>`}
        <details class="vc-chain-details"><summary>On-chain verification <span class="${s.roster.crossChainMatch ? "vc-ok" : ""}">${s.roster.crossChainMatch ? "In sync" : s.roster.configured ? "Sync needed" : "Awaiting setup"}</span></summary>
          ${row("Sepolia roster hash", chip(s.roster.sepoliaRosterHash))}
          ${row("Devnet roster hash", chip(s.roster.rosterHash))}
          ${row("Roster version", s.roster.epoch)}
        </details>
      </section>`;
  }

  function panelGuardians() {
    const draft = view.draft;
    const nonEmpty = draft.filter((v) => v.trim() !== "").length;
    const rows = draft
      .map(
        (val, i) => `
      <div class="vc-slot">
        <label class="vc-slot-tag" for="vc-guardian-${i}">Guardian ${i + 1}</label>
        <input id="vc-guardian-${i}" class="vc-slot-input" data-gi="${i}" value="${escape(val)}" placeholder="0x… address or name.eth" autocomplete="off" spellcheck="false" />
        <button type="button" class="vc-slot-x" data-rm="${i}" aria-label="Remove guardian ${i + 1}" ${draft.length <= 1 ? "disabled" : ""}>×</button>
      </div>`,
      )
      .join("");
    return `
      <div class="vc-section-intro"><h3>People you trust</h3><p>Choose up to three guardians. They only need a wallet they control; a Voxy account is not required.</p></div>
      ${G?.sharedLegacy ? '<p class="vc-note vc-warn">This account still uses the shared demo roster. Save your own guardians to give this account a separate roster.</p>' : ''}
      <button class="text-button" id="vc-signconnect" type="button">${view.owner ? `Signing wallet: ${short(view.owner)} · Change` : "Connect the owner wallet to save changes"}</button><div id="vc-signwallets"></div>
      <form id="vc-gform" class="vc-gform" novalidate>
        ${rows}
        <button type="button" class="vc-addg" id="vc-addg" ${draft.length >= 3 ? "disabled" : ""}>+ Add guardian${draft.length >= 3 ? " · max 3" : ""}</button>
        <div class="vc-majority"><span>Approvals needed</span><b id="vc-maj">${nonEmpty ? `${majorityOf(nonEmpty)} of ${nonEmpty}` : "Not set"}</b><span class="vc-dim">majority of your guardians</span></div>
        <p id="vc-gerr" class="error" role="alert"></p>
        <button class="button" type="submit">Save guardians</button>
        <p class="vc-fine">Use a wallet address or a name registered on Sepolia. The owner signs the change; Voxy sponsors the on-chain update.</p>
      </form>
      <div id="vc-gresult"></div>`;
  }

  function panelRecover() {
    const s = S;
    if (s.frozen) {
      return `<div class="vc-note vc-warn">This wallet is frozen by its owner. Recovery is paused until it is unfrozen.</div>`;
    }
    if (s.pending) {
      const p = s.pending;
      return `
        <div class="vc-pending">
          <div class="vc-pending-head"><span class="status-dot"></span> Recovery in progress</div>
          ${row("New owner (pending)", ownerChip(p.newKey))}
          ${row("Request ID", chip(p.requestId))}
          <div class="vc-row"><span class="vc-label">Time-lock</span><span class="vc-value" id="vc-countdown">${p.ready ? "Ready" : `${p.secondsRemaining}s remaining`}</span></div>
          <button class="button" id="vc-execute" ${p.ready ? "" : "disabled"}>Finalize recovery (add-only)</button>
          <button class="text-button vc-cancel" id="vc-cancel">Cancel this recovery</button>
          <button class="text-button" id="vc-signconnect">Connect the owner wallet</button><div id="vc-signwallets"></div>
          <p class="vc-fine">Add-only: finalizing installs the new owner alongside the existing one. It can never remove owners or move funds. The owner can cancel any time before finalizing.</p>
        </div>`;
    }
    if (s.roster.threshold < 1) {
      return `<div class="vc-section-intro"><h3>Set up guardians first</h3><p>This account is saved on-chain. Choose your guardians before you can start a recovery.</p><button class="button" id="vc-setup-guardians">Choose guardians</button></div>`;
    }
    const g = s.roster.guardians.filter((a) => a && !isZero(a));
    return `
      <form id="vc-start" class="vc-start" novalidate>
        <h3>Add a replacement owner</h3>
        <p class="vc-fine">The new address does not need a Voxy account. Your guardians approve it before the waiting period begins.</p>
        <label for="vc-newkey">New owner address</label>
        <input id="vc-newkey" placeholder="0x… address of your new wallet" autocomplete="off" spellcheck="false" />
        <p id="vc-newkey-err" class="error" role="alert"></p>
        <button class="button" type="submit">${s.wallet.toLowerCase() === s.demoWallet.toLowerCase() ? "Start demo recovery" : "Create recovery request"}</button>
        <p class="vc-fine">A ${s.roster.threshold}-of-${g.length} guardian quorum signs the recovery digest. The new key becomes an additional owner after a ${s.recoveryDelaySeconds}s time-lock.</p>
      </form>
      ${s.wallet.toLowerCase() !== s.demoWallet.toLowerCase() ? `<div class="vc-recovery-approvals">
        <label for="vc-request">Shared recovery request</label>
        <textarea id="vc-request" rows="4" placeholder="Create a request above, or paste the JSON shared with your guardians.">${escape(view.recovery?.requestText ?? (view.recovery?.message ? JSON.stringify(view.recovery.message) : ""))}</textarea>
        <p class="vc-fine">Copy this request to share it with every guardian. Keep a copy to resume after a refresh.</p>
        <button class="text-button" id="vc-signconnect">Connect a guardian wallet</button><div id="vc-signwallets"></div>
        <button class="button" id="vc-approve">Sign guardian approval</button>
        <label for="vc-signatures">Guardian signatures (one per line)</label>
        <textarea id="vc-signatures" rows="3" placeholder="0x…">${escape(view.recovery?.signaturesText ?? view.recovery?.signatures?.join("\n") ?? "")}</textarea>
        <p class="vc-fine">Each guardian signs the same request and shares their signature here. Only distinct, active guardians count.</p>
        <button class="button" id="vc-submit-approvals">Submit guardian approvals</button>
        <p id="vc-approval-error" class="error" role="alert"></p>
      </div>` : ""}`;
  }

  function panelSurfaces() {
    const surfaces = (S.surfaces || []).filter((x) => x.address);
    if (!surfaces.length) return `<p class="vc-fine">No enforcement surfaces reported.</p>`;
    return `<div class="vc-surfaces">${surfaces
      .map(
        (x) => `
        <div class="vc-surface">
          <div class="vc-surface-top"><span class="vc-surface-name">${x.label}</span><span class="vc-dim">${x.chain}</span></div>
          <div class="vc-surface-addr">${chip(x.address)}${ext(x.explorer)}</div>
          <p class="vc-fine">${x.note}</p>
        </div>`,
      )
      .join("")}</div>
      <p class="vc-fine">These are the enforcement surfaces deployed for the selected account on testnets.</p>`;
  }

  /* --------------------------------------------------------- full render */
  function render() {
    const s = S;
    const demo = s.wallet.toLowerCase() === (s.demoWallet || "").toLowerCase();
    const panel =
      view.tab === "guardians"
        ? panelGuardians()
        : view.tab === "recover"
          ? panelRecover()
          : view.tab === "surfaces"
            ? panelSurfaces()
            : panelOverview();

    container.innerHTML = `
      <div class="vc-head">
        <span class="preview-label">Voxy recovery</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Protect a wallet"}${demo ? ' <span class="vc-badge">demo</span>' : ""}</h2>
        <form id="vc-switch" class="vc-walletbar">
          <label for="vc-wallet">${mode === "recover" ? "Wallet to recover" : "Wallet to protect"}</label>
          <div class="vc-walletbar-row">
            <input id="vc-wallet" value="${escape(view.wallet ?? s.wallet)}" autocomplete="off" spellcheck="false" />
            <button class="button button-small" type="submit">Load</button>
          </div>
          <p id="vc-wallet-err" class="error" role="alert"></p>
          <p class="vc-fine vc-walletnote">${
            demo
              ? "Demo wallet — the server holds its keys, so every action here runs live."
              : `Owned by <code>${short(s.owners?.[0] || s.wallet)}</code>. Account and guardian settings are read from chain.`
          }</p>
        </form>
        ${(s.accounts?.length ?? 0) > 1 ? `<label class="vc-account-select">Your recovery accounts<select id="vc-account">${s.accounts.map((a) => `<option value="${a}" ${a.toLowerCase() === s.wallet.toLowerCase() ? "selected" : ""}>${a}</option>`).join("")}</select></label>` : ""}
        <nav class="vc-tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button class="vc-tab ${view.tab === id ? "active" : ""}" data-tab="${id}" role="tab" aria-selected="${view.tab === id}">${label}</button>`).join("")}
        </nav>
      </div>
      <div class="vc-panel">${panel}</div>
      <div class="vc-foot">
        <button class="text-button" id="vc-refresh">↻ Refresh live state</button>
        <span class="vc-dim">Live reads · Sepolia + alt-mempool devnet</span>
      </div>`;

    container.querySelectorAll(".vc-tab").forEach((b) =>
      b.addEventListener("click", () => {
        view.tab = b.dataset.tab;
        render();
      }),
    );
    container.querySelector("#vc-refresh")?.addEventListener("click", load);
    container.querySelector("#vc-switch")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = container.querySelector("#vc-wallet").value.trim();
      const err = container.querySelector("#vc-wallet-err");
      if (v && !isGuardianInput(v)) {
        if (err) err.textContent = "Enter a 0x… address or a name.eth.";
        return;
      }
      view.wallet = v && v.toLowerCase() !== s.demoWallet.toLowerCase() ? v : undefined;
      load();
    });

    container.querySelector("#vc-account")?.addEventListener("change", (e) => { view.wallet = e.target.value; view.draft = null; load(); });
    wireActions();
    startCountdown();
  }

  /* ----------------------------------------------------------- actions */
  function wireActions() {
    const rememberRecoveryDraft = () => {
      view.recovery = { ...view.recovery, requestText: container.querySelector("#vc-request").value, signaturesText: container.querySelector("#vc-signatures").value };
    };
    container.querySelectorAll("#vc-request, #vc-signatures").forEach((input) => input.addEventListener("input", rememberRecoveryDraft));
    container.querySelector("#vc-setup-guardians")?.addEventListener("click", () => { view.tab = "guardians"; render(); });
    container.querySelector("#vc-signconnect")?.addEventListener("click", (e) => doConnect(e.currentTarget, container.querySelector("#vc-gerr, #vc-approval-error, .vc-pending .error"), container.querySelector("#vc-signwallets"), () => { e.target.textContent = `Signing wallet: ${short(view.owner)}`; }));

    // guardians: live majority, add/remove rows, save
    container.querySelectorAll(".vc-slot-input[data-gi]").forEach((i) =>
      i.addEventListener("input", () => {
        view.draft[Number(i.dataset.gi)] = i.value;
        const n = view.draft.filter((v) => v.trim() !== "").length;
        const el = container.querySelector("#vc-maj");
        if (el) el.textContent = n ? `${majorityOf(n)} of ${n}` : "Not set";
      }),
    );
    container.querySelectorAll(".vc-slot-x[data-rm]").forEach((b) =>
      b.addEventListener("click", () => {
        // keep inputs' current text before re-render
        container
          .querySelectorAll(".vc-slot-input[data-gi]")
          .forEach((i) => (view.draft[Number(i.dataset.gi)] = i.value));
        view.draft.splice(Number(b.dataset.rm), 1);
        if (!view.draft.length) view.draft = [""];
        render();
      }),
    );
    container.querySelector("#vc-addg")?.addEventListener("click", () => {
      container
        .querySelectorAll(".vc-slot-input[data-gi]")
        .forEach((i) => (view.draft[Number(i.dataset.gi)] = i.value));
      if (view.draft.length < 3) view.draft.push("");
      render();
    });

    const gform = container.querySelector("#vc-gform");
    gform?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inputs = [...container.querySelectorAll(".vc-slot-input[data-gi]")];
      const entries = inputs.map((i) => i.value.trim());
      const err = container.querySelector("#vc-gerr");
      if (!entries.every(isGuardianInput)) {
        err.textContent = "Each guardian must be a 0x… address or a name.eth.";
        return;
      }
      const filled = entries.filter((v) => v !== "");
      if (!filled.length) {
        err.textContent = "Add at least one guardian.";
        return;
      }
      const guardians = [entries[0] || "", entries[1] || "", entries[2] || ""];
      const threshold = majorityOf(filled.length);
      const btn = gform.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Writing roster on-chain… (~30–60s)";
      err.textContent = "";
      const result = container.querySelector("#vc-gresult");
      result.innerHTML = `<div class="vc-note"><span class="status-dot"></span> Registering guardians on Sepolia, then syncing to devnet…</div>`;
      try {
        if (view.provider) view.owner = await requestAccount(view.provider);
        if (!view.provider || !view.owner || !S.owners.some((a) => a.toLowerCase() === view.owner.toLowerCase())) throw new Error("Connect an owner of this account before saving guardians.");
        const { message } = await api.guardianIntent(guardians, threshold, S.wallet);
        const hex = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("")}`;
        const signature = await view.provider.request({ method: "personal_sign", params: [hex, view.owner] });
        const res = await api.setGuardians(guardians, threshold, S.wallet, { message, signature });
        if (res.changed === false) {
          result.innerHTML = `<div class="vc-note vc-warn">${res.message}</div>`;
        } else {
          const txs = [
            ...(res.sepoliaTxs || []).map(
              (t) => `<a href="${t.explorer}" target="_blank" rel="noopener">${t.op} ${t.slot} ${short(t.hash)} ↗</a>`,
            ),
            res.thresholdTx
              ? `<a href="${res.thresholdTx.explorer}" target="_blank" rel="noopener">threshold ${short(res.thresholdTx.hash)} ↗</a>`
              : "",
            res.syncTx
              ? `<a href="${res.syncTx.explorer}" target="_blank" rel="noopener">devnet sync (epoch ${res.syncTx.epoch}) ${short(res.syncTx.hash)} ↗</a>`
              : "",
          ].filter(Boolean);
          result.innerHTML = `<div class="vc-note vc-ok-note"><b>✓ Roster updated &amp; synced.</b><div class="vc-txlist">${txs.join("")}</div></div>`;
        }
        view.draft = null;
        setTimeout(load, 1200);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "Save guardians";
        result.innerHTML = "";
        err.textContent = e2.message;
      }
    });

    // start recovery
    const form = container.querySelector("#vc-start");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = container.querySelector("#vc-newkey");
      const err = container.querySelector("#vc-newkey-err");
      if (!isAddress(input.value)) {
        err.textContent = "Enter a valid 0x… address (40 hex chars).";
        return;
      }
      const btn = form.querySelector("button");
      btn.disabled = true;
      btn.textContent = "Submitting guardian quorum…";
      try {
        if (S.wallet.toLowerCase() !== S.demoWallet.toLowerCase()) {
          const prepared = await api.prepareRecovery(input.value.trim(), S.wallet);
          view.recovery = { ...prepared, signatures: [] };
          render();
          return;
        }
        const res = await api.startRecovery(input.value.trim(), S.wallet);
        container.querySelector(".vc-panel").innerHTML =
          `<div class="vc-note vc-ok-note"><b>✓ Guardian quorum accepted (${res.quorum}).</b>${row("New owner", chip(res.newKey))}${row("Tx", `<a href="${S.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}<p class="vc-fine">A ${S.recoveryDelaySeconds}s time-lock is now running.</p></div><button class="button" id="vc-continue">View time-lock</button>`;
        container.querySelector("#vc-continue")?.addEventListener("click", load);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "Start recovery with guardian quorum";
        err.textContent = e2.message;
      }
    });

    container.querySelector("#vc-approve")?.addEventListener("click", async (e) => {
      const err = container.querySelector("#vc-approval-error");
      e.target.disabled = true;
      try {
        if (!view.provider) throw new Error("Connect a guardian wallet first.");
        view.owner = await requestAccount(view.provider);
        if (!S.roster.guardians.some((a) => a.toLowerCase() === view.owner.toLowerCase())) throw new Error("This signing wallet is not a guardian of this account.");
        const message = JSON.parse(container.querySelector("#vc-request").value);
        if (message.wallet.toLowerCase() !== S.wallet.toLowerCase()) throw new Error("This request is for a different account.");
        const prepared = await api.prepareRecovery(message.newKey, S.wallet);
        const typedData = { ...prepared.typedData, message };
        await switchToDevnet();
        const signature = await view.provider.request({ method: "eth_signTypedData_v4", params: [view.owner, JSON.stringify(typedData)] });
        const signatures = container.querySelector("#vc-signatures");
        signatures.value = [signatures.value.trim(), signature].filter(Boolean).join("\n");
        rememberRecoveryDraft();
        err.textContent = "Approval signed. Copy your signature to share it with the person collecting approvals.";
      } catch (e2) { err.textContent = e2.message; }
      finally { e.target.disabled = false; }
    });
    container.querySelector("#vc-submit-approvals")?.addEventListener("click", async (e) => {
      const err = container.querySelector("#vc-approval-error");
      e.target.disabled = true;
      try {
        const request = container.querySelector("#vc-request").value;
        const message = JSON.parse(request);
        const signatures = container.querySelector("#vc-signatures").value.split(/\s+/).filter(Boolean);
        await api.startRecovery(message.newKey, S.wallet, request, signatures);
        view.recovery = null;
        await load();
      } catch (e2) { err.textContent = e2.message; e.target.disabled = false; }
    });

    // finalize recovery
    const exec = container.querySelector("#vc-execute");
    exec?.addEventListener("click", async () => {
      exec.disabled = true;
      exec.textContent = "Finalizing…";
      try {
        const res = await api.executeRecovery(S.wallet);
        container.querySelector(".vc-panel").innerHTML =
          `<div class="vc-note vc-ok-note"><b>✓ New owner installed.</b>${row("Owners now", res.owners.map(ownerChip).join(" "))}${row("Tx", `<a href="${S.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}</div><button class="button" id="vc-done">Done</button>`;
        container.querySelector("#vc-done")?.addEventListener("click", load);
      } catch (e3) {
        exec.disabled = false;
        exec.textContent = "Finalize recovery (add-only)";
        const n = container.querySelector(".vc-pending");
        if (n) n.insertAdjacentHTML("beforeend", `<p class="error">${escape(e3.message)}</p>`);
      }
    });

    // cancel recovery
    const cancel = container.querySelector("#vc-cancel");
    cancel?.addEventListener("click", async () => {
      cancel.disabled = true;
      cancel.textContent = "Cancelling…";
      try {
        if (S.wallet.toLowerCase() === S.demoWallet.toLowerCase()) {
          await api.cancelRecovery(S.wallet);
        } else {
          if (!view.provider) throw new Error("Connect the owner wallet first.");
          const [owner] = await view.provider.request({ method: "eth_requestAccounts" });
          if (!S.owners.some((a) => a.toLowerCase() === owner?.toLowerCase())) throw new Error("Only an account owner can cancel recovery.");
          await switchToDevnet();
          const hash = await view.provider.request({ method: "eth_sendTransaction", params: [{ from: owner, ...S.ownerActions.cancel }] });
          cancel.textContent = "Waiting for confirmation…";
          let receipt;
          for (let i = 0; i < 60; i++) {
            receipt = await view.provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
            if (receipt) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          if (!receipt) throw new Error(`Transaction ${hash} is pending. Refresh live state to check it.`);
          if (receipt.status !== "0x1") throw new Error("The cancellation transaction reverted.");
        }
        load();
      } catch (e4) {
        cancel.disabled = false;
        cancel.textContent = "Cancel this recovery";
        const n = container.querySelector(".vc-pending");
        if (n) n.insertAdjacentHTML("beforeend", `<p class="error">${escape(e4.message)}</p>`);
      }
    });
  }

  function startCountdown() {
    if (view.tab === "recover" && S.pending && !S.pending.ready) {
      let remaining = S.pending.secondsRemaining;
      const el = container.querySelector("#vc-countdown");
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          // Elapsed: flip to "Ready" in place — never re-trigger the loading flash.
          clearTimer();
          if (el) el.textContent = "Ready";
          const exec = container.querySelector("#vc-execute");
          if (exec) exec.disabled = false;
          if (S.pending) S.pending.ready = true;
        } else if (el) {
          el.textContent = `${remaining}s remaining`;
        }
      }, 1000);
    }
  }

  const remembered = new URL(location.href).searchParams.get("voxy");
  if (remembered && isGuardianInput(remembered)) {
    view.wallet = remembered;
    load();
  } else {
    renderEntry();
  }
  return () => {
    clearTimer();
    dialog?.classList.remove("vc-dialog");
  };
}
