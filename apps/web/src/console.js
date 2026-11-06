import "./console.css";
import { api, short } from "./api.js";

const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const isGuardianInput = (v) => isAddress(v) || /\.eth$/i.test(v.trim()) || v.trim() === "";
const ext = (href) =>
  href
    ? `<a class="vc-ext" href="${href}" target="_blank" rel="noopener" aria-label="View on explorer">↗</a>`
    : "";
const chip = (v, title) => `<code class="vc-chip" title="${title ?? v}">${short(v)}</code>`;

function row(label, value, cls = "") {
  return `<div class="vc-row"><span class="vc-label">${label}</span><span class="vc-value ${cls}">${value}</span></div>`;
}

/* ---------------------------------------------------------------- panels */

function panelOverview(s) {
  const g = s.roster.guardians.filter((a) => a && !/^0x0+$/.test(a));
  const match = s.roster.crossChainMatch;
  return `
    <div class="vc-grid">
      ${row("Wallet", `${chip(s.wallet)}${ext(`${s.explorer.devnet}/address/${s.wallet}`)}`)}
      ${row("Owners", `${s.owners.map((a) => chip(a)).join(" ")} <span class="vc-dim">(${s.ownerCount})</span>`)}
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

function panelGuardians(gcfg) {
  const slotRow = (slot) => `
    <div class="vc-slot">
      <span class="vc-slot-tag">${slot.label}</span>
      <input class="vc-slot-input" data-slot="${slot.label}" value="${slot.guardian && !/^0x0+$/.test(slot.guardian) ? slot.guardian : ""}" placeholder="0x… address or name.eth" autocomplete="off" spellcheck="false" />
    </div>`;
  const opts = [1, 2, 3]
    .map((n) => `<option value="${n}" ${n === gcfg.threshold ? "selected" : ""}>${n}-of-3</option>`)
    .join("");
  return `
    <p class="vc-fine">Your guardians are ENS subnames. Enter a <b>0x… address</b> or a <b>name.eth</b> (resolved on Sepolia) for each slot. Saving writes real on-chain transactions and syncs the roster cross-chain.</p>
    <form id="vc-gform" class="vc-gform" novalidate>
      ${gcfg.slots.map(slotRow).join("")}
      <div class="vc-slot">
        <span class="vc-slot-tag">M/N</span>
        <select class="vc-slot-input" id="vc-threshold">${opts}</select>
      </div>
      <p id="vc-gerr" class="error" role="alert"></p>
      <button class="button" type="submit">Save guardians</button>
      <p class="vc-fine">Each changed slot is a Sepolia register/unregister, then one attested devnet sync — about 30–60s. Add-delay applies to new guardians; removals take effect immediately.</p>
    </form>
    <div id="vc-gresult"></div>`;
}

function panelRecover(s) {
  if (s.frozen) {
    return `<div class="vc-note vc-warn">This wallet is frozen by its owner. Recovery is paused until it is unfrozen.</div>`;
  }
  if (s.pending) {
    const p = s.pending;
    return `
      <div class="vc-pending">
        <div class="vc-pending-head"><span class="status-dot"></span> Recovery in progress</div>
        ${row("New owner (pending)", chip(p.newKey))}
        ${row("Request ID", chip(p.requestId))}
        <div class="vc-row"><span class="vc-label">Time-lock</span><span class="vc-value" id="vc-countdown">${p.ready ? "Ready" : `${p.secondsRemaining}s remaining`}</span></div>
        <button class="button" id="vc-execute" ${p.ready ? "" : "disabled"}>Finalize recovery (add-only)</button>
        <p class="vc-fine">Add-only: finalizing installs the new owner alongside the existing one. It can never remove owners or move funds.</p>
      </div>`;
  }
  const g = s.roster.guardians.filter((a) => a && !/^0x0+$/.test(a));
  return `
    <form id="vc-start" class="vc-start" novalidate>
      <label for="vc-newkey">Recover to a new owner key</label>
      <input id="vc-newkey" placeholder="0x… new owner address" autocomplete="off" spellcheck="false" />
      <p id="vc-newkey-err" class="error" role="alert"></p>
      <button class="button" type="submit">Start recovery with guardian quorum</button>
      <p class="vc-fine">A ${s.roster.threshold}-of-${g.length} guardian quorum signs the recovery digest. The new key becomes an additional owner after a ${s.recoveryDelaySeconds}s time-lock. Any address works — no ENS required.</p>
    </form>`;
}

function panelSurfaces(s) {
  const surfaces = (s.surfaces || []).filter((x) => x.address);
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

const TABS = [
  ["overview", "Overview"],
  ["guardians", "Guardians"],
  ["recover", "Recover"],
  ["surfaces", "Surfaces"],
];

/* ------------------------------------------------------------ controller */

export function mountConsole(container, mode) {
  const dialog = container.closest("dialog");
  dialog?.classList.add("vc-dialog");
  const view = { tab: mode === "recover" ? "recover" : "overview", wallet: undefined };
  let timer;
  const clearTimer = () => timer && clearInterval(timer);

  async function load() {
    clearTimer();
    container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-loading"><span class="status-dot"></span> Reading live chain state…</div>`;
    let s;
    let gcfg;
    try {
      [s, gcfg] = await Promise.all([api.state(view.wallet), api.guardians()]);
    } catch (err) {
      container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-note vc-warn">Backend unreachable: ${err.message}.<br>Start it with <code>pnpm --filter @voxy/api start</code>.</div><button class="text-button" id="vc-retry">↻ Retry</button>`;
      container.querySelector("#vc-retry")?.addEventListener("click", load);
      return;
    }
    render(s, gcfg);
  }

  function render(s, gcfg) {
    const panel =
      view.tab === "guardians"
        ? panelGuardians(gcfg)
        : view.tab === "recover"
          ? panelRecover(s)
          : view.tab === "surfaces"
            ? panelSurfaces(s)
            : panelOverview(s);

    container.innerHTML = `
      <div class="vc-head">
        <span class="preview-label">VOXY / RECOVERY CONSOLE · LIVE</span>
        <h2 class="vc-title">${mode === "recover" ? "Recover a wallet" : "Your wallet, protected"}</h2>
        <nav class="vc-tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button class="vc-tab ${view.tab === id ? "active" : ""}" data-tab="${id}" role="tab" aria-selected="${view.tab === id}">${label}</button>`).join("")}
        </nav>
      </div>
      <div class="vc-panel">${panel}</div>
      <div class="vc-foot">
        <form id="vc-switch" class="vc-switch">
          <input id="vc-wallet" placeholder="View another wallet · 0x…" value="${view.wallet ?? ""}" autocomplete="off" spellcheck="false" />
          <button class="text-button" type="submit">View ↗</button>
        </form>
        <button class="text-button" id="vc-refresh">↻ Refresh</button>
      </div>
      <p class="vc-livenote">Live reads · Sepolia + alt-mempool devnet · no mocks${view.wallet ? ` · viewing ${short(view.wallet)}` : ""}</p>`;

    // tab switching
    container.querySelectorAll(".vc-tab").forEach((b) =>
      b.addEventListener("click", () => {
        view.tab = b.dataset.tab;
        render(s, gcfg);
      }),
    );
    container.querySelector("#vc-refresh")?.addEventListener("click", load);
    container.querySelector("#vc-switch")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = container.querySelector("#vc-wallet").value.trim();
      view.wallet = v && isAddress(v) ? v : undefined;
      load();
    });

    wireActions(s, gcfg);
    startCountdown(s);
  }

  function wireActions(s, gcfg) {
    // --- guardians save ---
    const gform = container.querySelector("#vc-gform");
    gform?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inputs = [...container.querySelectorAll(".vc-slot-input[data-slot]")];
      const guardians = inputs.map((i) => i.value.trim());
      const threshold = Number(container.querySelector("#vc-threshold").value);
      const err = container.querySelector("#vc-gerr");
      if (!guardians.every(isGuardianInput)) {
        err.textContent = "Each slot must be a 0x… address, a name.eth, or empty.";
        return;
      }
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
          result.innerHTML = `<div class="vc-note vc-ok-note"><b>✓ Roster updated & synced.</b><div class="vc-txlist">${txs.join("")}</div></div>`;
        }
        setTimeout(load, 1200);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "Save guardians";
        result.innerHTML = "";
        err.textContent = e2.message;
      }
    });

    // --- start recovery ---
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
          `<div class="vc-note vc-ok-note"><b>✓ Guardian quorum accepted (${res.quorum}).</b>${row("New owner", chip(res.newKey))}${row("Tx", `<a href="${s.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}<p class="vc-fine">A ${s.recoveryDelaySeconds}s time-lock is now running.</p></div><button class="button" id="vc-continue">View time-lock</button>`;
        container.querySelector("#vc-continue")?.addEventListener("click", load);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "Start recovery with guardian quorum";
        err.textContent = e2.message;
      }
    });

    // --- finalize recovery ---
    const exec = container.querySelector("#vc-execute");
    exec?.addEventListener("click", async () => {
      exec.disabled = true;
      exec.textContent = "Finalizing…";
      try {
        const res = await api.executeRecovery();
        container.querySelector(".vc-panel").innerHTML =
          `<div class="vc-note vc-ok-note"><b>✓ New owner installed.</b>${row("Owners now", res.owners.map((a) => chip(a)).join(" "))}${row("Tx", `<a href="${s.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}</div><button class="button" id="vc-done">Done</button>`;
        container.querySelector("#vc-done")?.addEventListener("click", load);
      } catch (e3) {
        exec.disabled = false;
        exec.textContent = "Finalize recovery (add-only)";
        const n = container.querySelector(".vc-pending");
        if (n) n.insertAdjacentHTML("beforeend", `<p class="error">${e3.message}</p>`);
      }
    });
  }

  function startCountdown(s) {
    if (view.tab === "recover" && s.pending && !s.pending.ready) {
      let remaining = s.pending.secondsRemaining;
      const el = container.querySelector("#vc-countdown");
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearTimer();
          load();
        } else if (el) {
          el.textContent = `${remaining}s remaining`;
        }
      }, 1000);
    }
  }

  load();
  return () => {
    clearTimer();
    dialog?.classList.remove("vc-dialog");
  };
}
