import "./console.css";
import { api, short } from "./api.js";

const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const isGuardianInput = (v) => isAddress(v) || /\.eth$/i.test(v.trim()) || v.trim() === "";
const majorityOf = (n) => (n <= 0 ? 1 : Math.floor(n / 2) + 1);
// Test/placeholder addresses are all one repeated hex char (0x3333…3333, 0x2222…2222).
const isPlaceholder = (a) => /^0x([0-9a-f])\1{39}$/i.test((a || "").trim());
const isZero = (a) => /^0x0+$/.test((a || "").trim());

// Connect an injected wallet (MetaMask etc.) and return the selected address. No deps — raw EIP-1193.
async function connectWallet() {
  const eth = window.ethereum;
  if (!eth?.request) {
    throw new Error("No browser wallet found. Install MetaMask (or another EIP-1193 wallet) to connect.");
  }
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  const addr = accounts?.[0];
  if (!addr) throw new Error("No account was selected.");
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
    loaded: false,
    draft: null,
  };
  let timer;
  let S;
  let G;
  const clearTimer = () => timer && clearInterval(timer);
  const draftFrom = (gcfg) => {
    const live = gcfg.slots.map((s) => s.guardian).filter((a) => a && !isZero(a));
    return live.length ? live : [""];
  };

  /* ---------------------------------------------------------- entry gate */
  function renderEntry() {
    clearTimer();
    container.innerHTML = `
      <div class="vc-head">
        <span class="preview-label">VOXY / RECOVERY CONSOLE · LIVE</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Protect a wallet"}</h2>
      </div>
      <form id="vc-enter" class="vc-enter" novalidate>
        <label for="vc-wallet">${mode === "recover" ? "Which wallet do you want to recover?" : "Which wallet do you want to protect?"}</label>
        <button type="button" class="button" id="vc-connect">Connect wallet</button>
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
    container.querySelector("#vc-connect").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const err = container.querySelector("#vc-wallet-err");
      btn.disabled = true;
      btn.textContent = "Connecting…";
      try {
        go(await connectWallet());
      } catch (ce) {
        btn.disabled = false;
        btn.textContent = "Connect wallet";
        err.textContent = ce.message;
      }
    });
    container.querySelector("#vc-demo").addEventListener("click", () => go(undefined));
  }

  /* -------------------------------------------------------------- loader */
  async function load() {
    clearTimer();
    container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-loading"><span class="status-dot"></span> Reading live chain state…</div>`;
    try {
      [S, G] = await Promise.all([api.state(view.wallet), api.guardians()]);
    } catch (err) {
      container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-note vc-warn">Couldn't load that wallet: ${err.message}.</div><button class="text-button" id="vc-retry">← Choose another wallet</button>`;
      container.querySelector("#vc-retry")?.addEventListener("click", () => {
        view.loaded = false;
        view.wallet = undefined;
        renderEntry();
      });
      return;
    }
    if (!view.draft) view.draft = draftFrom(G);
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
        <span class="preview-label">VOXY / RECOVERY CONSOLE · LIVE</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Protect a wallet"}</h2>
        <form id="vc-switch" class="vc-walletbar">
          <label for="vc-wallet">${mode === "recover" ? "Wallet to recover" : "Wallet to protect"}</label>
          <div class="vc-walletbar-row">
            <input id="vc-wallet" value="${view.wallet ?? ""}" placeholder="0x… address or name.eth" autocomplete="off" spellcheck="false" />
            <button class="button button-small" type="submit">Load</button>
          </div>
          <p id="vc-wallet-err" class="error" role="alert"></p>
        </form>
      </div>
      <div class="vc-panel">
        <div class="vc-note vc-warn"><b>${short(s.wallet)}</b> is a regular Ethereum account (EOA), not a Voxy-managed wallet on the alt-mempool devnet — so there is no recovery state to show here.
          <p class="vc-fine">This testnet demo reads and runs live recovery for Voxy wallets. Protecting your own MetaMask wallet would set up a Voxy recovery for it — a deployed smart-account, or an EIP-7702 delegation of your EOA — which isn't wired for arbitrary wallets in this demo.</p>
        </div>
        <div class="vc-enter-actions">
          <button class="button" id="vc-connect">Connect a different wallet</button>
          <button class="text-button" id="vc-usedemo">Use the live demo wallet →</button>
        </div>
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
    container.querySelector("#vc-connect")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Connecting…";
      try {
        view.wallet = await connectWallet();
        load();
      } catch (ce) {
        btn.disabled = false;
        btn.textContent = "Connect a different wallet";
        container.querySelector("#vc-wallet-err").textContent = ce.message;
      }
    });
    container.querySelector("#vc-usedemo")?.addEventListener("click", () => {
      view.wallet = undefined;
      load();
    });
  }

  /* -------------------------------------------------------------- panels */
  function panelOverview() {
    const s = S;
    const g = s.roster.guardians.filter((a) => a && !isZero(a));
    const match = s.roster.crossChainMatch;
    return `
      <div class="vc-grid">
        ${row("Wallet", `${chip(s.wallet)}${ext(`${s.explorer.devnet}/address/${s.wallet}`)}`)}
        ${row("Owners", `${s.owners.map(ownerChip).join(" ")} <span class="vc-dim">(${s.ownerCount})</span>`)}
        ${row("Owner epoch", s.ownerEpoch)}
        ${row("Status", s.frozen ? "Frozen" : "Active", s.frozen ? "vc-bad" : "vc-ok")}
      </div>
      <div class="vc-seclabel"><span class="vc-secn">↔</span>Cross-chain, one roster</div>
      <div class="vc-grid">
        ${row("Guardians", `${g.map((a) => chip(a)).join(" ")} <span class="vc-dim">· ${s.roster.threshold}-of-${g.length}</span>`)}
        ${row("Sepolia ENS roster", `${chip(s.roster.sepoliaRosterHash)}${ext(s.identity && s.identity.explorer)}`)}
        ${row("Devnet registry", chip(s.roster.rosterHash))}
        ${row("Sync", match ? "✓ one identity, two chains" : "✗ mismatch", match ? "vc-ok" : "vc-bad")}
      </div>`;
  }

  function panelGuardians() {
    const draft = view.draft;
    const nonEmpty = draft.filter((v) => v.trim() !== "").length;
    const rows = draft
      .map(
        (val, i) => `
      <div class="vc-slot">
        <span class="vc-slot-tag">g${i + 1}</span>
        <input class="vc-slot-input" data-gi="${i}" value="${val}" placeholder="0x… address or name.eth" autocomplete="off" spellcheck="false" />
        <button type="button" class="vc-slot-x" data-rm="${i}" aria-label="Remove guardian ${i + 1}" ${draft.length <= 1 ? "disabled" : ""}>×</button>
      </div>`,
      )
      .join("");
    return `
      <p class="vc-fine">Enter a <b>0x… address</b> or a <b>name.eth</b> (resolved on Sepolia) for each guardian. Saving writes real on-chain transactions and syncs the roster cross-chain.</p>
      <form id="vc-gform" class="vc-gform" novalidate>
        ${rows}
        <button type="button" class="vc-addg" id="vc-addg" ${draft.length >= 3 ? "disabled" : ""}>+ Add guardian${draft.length >= 3 ? " · max 3" : ""}</button>
        <div class="vc-majority"><span>Approvals needed</span><b id="vc-maj">${majorityOf(nonEmpty)} of ${nonEmpty}</b><span class="vc-dim">majority of your guardians</span></div>
        <p id="vc-gerr" class="error" role="alert"></p>
        <button class="button" type="submit">Save guardians</button>
        <p class="vc-fine">Up to 3 guardians (a fixed 3-slot roster). Each changed slot is a Sepolia register/unregister, then one attested devnet sync — about 30–60s.</p>
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
          <p class="vc-fine">Add-only: finalizing installs the new owner alongside the existing one. It can never remove owners or move funds. The owner can cancel any time before finalizing.</p>
        </div>`;
    }
    const g = s.roster.guardians.filter((a) => a && !isZero(a));
    return `
      <form id="vc-start" class="vc-start" novalidate>
        <label for="vc-newkey">Recover to a new owner key</label>
        <input id="vc-newkey" placeholder="0x… address of your new wallet" autocomplete="off" spellcheck="false" />
        <p id="vc-newkey-err" class="error" role="alert"></p>
        <button class="button" type="submit">Start recovery with guardian quorum</button>
        <p class="vc-fine">A ${s.roster.threshold}-of-${g.length} guardian quorum signs the recovery digest. The new key becomes an additional owner after a ${s.recoveryDelaySeconds}s time-lock.</p>
      </form>`;
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
      <p class="vc-fine">Same wallet, three ways to enforce the guardian roster: an ordinary transaction, an EIP-8141 VERIFY frame on the alt-mempool, and an existing EOA via EIP-7702. All live on testnets.</p>`;
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
        <span class="preview-label">VOXY / RECOVERY CONSOLE · LIVE</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Protect a wallet"}${demo ? ' <span class="vc-badge">demo</span>' : ""}</h2>
        <form id="vc-switch" class="vc-walletbar">
          <label for="vc-wallet">${mode === "recover" ? "Wallet to recover" : "Wallet to protect"}</label>
          <div class="vc-walletbar-row">
            <input id="vc-wallet" value="${view.wallet ?? s.wallet}" autocomplete="off" spellcheck="false" />
            <button class="button button-small" type="submit">Load</button>
          </div>
          <p id="vc-wallet-err" class="error" role="alert"></p>
          <p class="vc-fine vc-walletnote">${
            demo
              ? "Demo wallet — the server holds its keys, so guardian &amp; recovery actions run live here."
              : `Viewing <code>${short(s.wallet)}</code> read-only. Guardian &amp; recovery actions run against the demo wallet.`
          }</p>
        </form>
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

    wireActions();
    startCountdown();
  }

  /* ----------------------------------------------------------- actions */
  function wireActions() {
    // guardians: live majority, add/remove rows, save
    container.querySelectorAll(".vc-slot-input[data-gi]").forEach((i) =>
      i.addEventListener("input", () => {
        view.draft[Number(i.dataset.gi)] = i.value;
        const n = view.draft.filter((v) => v.trim() !== "").length;
        const el = container.querySelector("#vc-maj");
        if (el) el.textContent = `${majorityOf(n)} of ${n}`;
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
        const res = await api.setGuardians(guardians, threshold);
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
        const res = await api.startRecovery(input.value.trim());
        container.querySelector(".vc-panel").innerHTML =
          `<div class="vc-note vc-ok-note"><b>✓ Guardian quorum accepted (${res.quorum}).</b>${row("New owner", chip(res.newKey))}${row("Tx", `<a href="${S.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}<p class="vc-fine">A ${S.recoveryDelaySeconds}s time-lock is now running.</p></div><button class="button" id="vc-continue">View time-lock</button>`;
        container.querySelector("#vc-continue")?.addEventListener("click", load);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "Start recovery with guardian quorum";
        err.textContent = e2.message;
      }
    });

    // finalize recovery
    const exec = container.querySelector("#vc-execute");
    exec?.addEventListener("click", async () => {
      exec.disabled = true;
      exec.textContent = "Finalizing…";
      try {
        const res = await api.executeRecovery();
        container.querySelector(".vc-panel").innerHTML =
          `<div class="vc-note vc-ok-note"><b>✓ New owner installed.</b>${row("Owners now", res.owners.map(ownerChip).join(" "))}${row("Tx", `<a href="${S.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}</div><button class="button" id="vc-done">Done</button>`;
        container.querySelector("#vc-done")?.addEventListener("click", load);
      } catch (e3) {
        exec.disabled = false;
        exec.textContent = "Finalize recovery (add-only)";
        const n = container.querySelector(".vc-pending");
        if (n) n.insertAdjacentHTML("beforeend", `<p class="error">${e3.message}</p>`);
      }
    });

    // cancel recovery
    const cancel = container.querySelector("#vc-cancel");
    cancel?.addEventListener("click", async () => {
      cancel.disabled = true;
      cancel.textContent = "Cancelling…";
      try {
        await api.cancelRecovery();
        load();
      } catch (e4) {
        cancel.disabled = false;
        cancel.textContent = "Cancel this recovery";
        const n = container.querySelector(".vc-pending");
        if (n) n.insertAdjacentHTML("beforeend", `<p class="error">${e4.message}</p>`);
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

  renderEntry();
  return () => {
    clearTimer();
    dialog?.classList.remove("vc-dialog");
  };
}
