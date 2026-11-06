import "./console.css";
import { api, short } from "./api.js";

const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());

function row(label, value, cls = "") {
  return `<div class="vc-row"><span class="vc-label">${label}</span><span class="vc-value ${cls}">${value}</span></div>`;
}

function renderState(state, mode) {
  const g = state.roster.guardians.filter((a) => a && !/^0x0+$/.test(a));
  const match = state.roster.crossChainMatch;
  const guardianList = g
    .map((a) => `<code class="vc-chip" title="${a}">${short(a)}</code>`)
    .join("");
  const ownerList = state.owners
    .map((a) => `<code class="vc-chip" title="${a}">${short(a)}</code>`)
    .join("");

  let action = "";
  if (state.frozen) {
    action = `<div class="vc-note vc-warn">This wallet is frozen by its owner. Recovery is paused until it is unfrozen.</div>`;
  } else if (state.pending) {
    const p = state.pending;
    action = `
      <div class="vc-pending">
        <div class="vc-pending-head"><span class="status-dot"></span> Recovery in progress</div>
        ${row("New owner (pending)", `<code class="vc-chip" title="${p.newKey}">${short(p.newKey)}</code>`)}
        ${row("Request ID", `<code class="vc-chip" title="${p.requestId}">${short(p.requestId)}</code>`)}
        <div class="vc-row"><span class="vc-label">Time-lock</span><span class="vc-value" id="vc-countdown">${p.ready ? "Ready" : `${p.secondsRemaining}s remaining`}</span></div>
        <button class="button" id="vc-execute" ${p.ready ? "" : "disabled"}>Finalize recovery (add-only)</button>
        <p class="vc-fine">Add-only: finalizing installs the new owner alongside the existing one. It can never remove owners or move funds.</p>
      </div>`;
  } else {
    action = `
      <form id="vc-start" class="vc-start" novalidate>
        <label for="vc-newkey">Recover to a new owner key</label>
        <input id="vc-newkey" placeholder="0x… new owner address" autocomplete="off" spellcheck="false" />
        <p id="vc-newkey-err" class="error" role="alert"></p>
        <button class="button" type="submit">Start recovery with guardian quorum</button>
        <p class="vc-fine">A ${state.roster.threshold}-of-${g.length} guardian quorum signs the recovery digest. The new key becomes an additional owner after a ${state.recoveryDelaySeconds}s time-lock.</p>
      </form>`;
  }

  return `
    <span class="preview-label">VOXY / RECOVERY CONSOLE · LIVE</span>
    <h2>${mode === "recover" ? "Recover this wallet" : "Your wallet, protected"}</h2>
    <div class="vc-grid">
      ${row("Wallet", `<code class="vc-chip" title="${state.wallet}">${short(state.wallet)}</code>`)}
      ${row("Owners", `${ownerList} <span class="vc-dim">(${state.ownerCount})</span>`)}
      ${row("Owner epoch", state.ownerEpoch)}
      ${row("Guardians", `${guardianList} <span class="vc-dim">· ${state.roster.threshold}-of-${g.length}</span>`)}
      ${row("Roster epoch", state.roster.epoch)}
      ${row("ENS ↔ devnet sync", match ? "✓ matched" : "✗ mismatch", match ? "vc-ok" : "vc-bad")}
    </div>
    <div class="vc-action">${action}</div>
    <div class="vc-foot">
      <button class="text-button" id="vc-refresh">↻ Refresh live state</button>
      <span class="vc-dim">Reads from Sepolia + alt-mempool devnet. No mocks.</span>
    </div>`;
}

/**
 * Mount the live recovery console into `container`. Returns a cleanup function that stops the
 * countdown timer. Every number shown is read from chain; every action is a real transaction.
 */
export function mountConsole(container, mode) {
  let timer;
  const clear = () => timer && clearInterval(timer);

  async function load() {
    clear();
    container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-loading"><span class="status-dot"></span> Reading live chain state…</div>`;
    let state;
    try {
      state = await api.state();
    } catch (err) {
      container.innerHTML = `<span class="preview-label">VOXY / RECOVERY CONSOLE</span><div class="vc-note vc-warn">Backend unreachable: ${err.message}.<br>Start it with <code>pnpm --filter @voxy/api start</code>.</div><button class="text-button" id="vc-retry">↻ Retry</button>`;
      container.querySelector("#vc-retry")?.addEventListener("click", load);
      return;
    }

    container.innerHTML = renderState(state, mode);
    container.querySelector("#vc-refresh")?.addEventListener("click", load);

    // Start recovery
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
        container.innerHTML = `<span class="preview-label">RECOVERY REQUESTED · LIVE</span><div class="dialog-symbol success">✓</div><h2>Guardian quorum accepted</h2>${row("Quorum", res.quorum)}${row("New owner", `<code class="vc-chip">${short(res.newKey)}</code>`)}${row("Tx", `<a href="${state.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}<p class="vc-fine">A ${state.recoveryDelaySeconds}s time-lock is now running.</p><button class="button" id="vc-continue">View time-lock</button>`;
        container.querySelector("#vc-continue")?.addEventListener("click", load);
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = "Start recovery with guardian quorum";
        err.textContent = e2.message;
      }
    });

    // Execute / finalize
    const exec = container.querySelector("#vc-execute");
    exec?.addEventListener("click", async () => {
      exec.disabled = true;
      exec.textContent = "Finalizing…";
      try {
        const res = await api.executeRecovery();
        container.innerHTML = `<span class="preview-label">RECOVERY COMPLETE · LIVE</span><div class="dialog-symbol success">✓</div><h2>New owner installed</h2>${row("Owners now", res.owners.map((a) => `<code class="vc-chip">${short(a)}</code>`).join(" "))}${row("Tx", `<a href="${state.explorer.devnet}/tx/${res.tx.hash}" target="_blank" rel="noopener">${short(res.tx.hash)} ↗</a>`)}<button class="button" id="vc-done">Done</button>`;
        container.querySelector("#vc-done")?.addEventListener("click", load);
      } catch (e3) {
        exec.disabled = false;
        exec.textContent = "Finalize recovery (add-only)";
        const n = container.querySelector(".vc-pending");
        if (n) n.insertAdjacentHTML("beforeend", `<p class="error">${e3.message}</p>`);
      }
    });

    // Live countdown
    if (state.pending && !state.pending.ready) {
      let remaining = state.pending.secondsRemaining;
      const el = container.querySelector("#vc-countdown");
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clear();
          load();
        } else if (el) {
          el.textContent = `${remaining}s remaining`;
        }
      }, 1000);
    }
  }

  load();
  return clear;
}
