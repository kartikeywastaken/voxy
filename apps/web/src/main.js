import Lenis from "lenis";
import "lenis/dist/lenis.css";
import "./style.css";
import { mountConsole } from "./console.js";
import { mountExperience } from "./experience.js";
import "./experience.css";
import "./refinement.css";

const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  diagonal: '<path d="M6 18 18 6M6 6h12v12"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const logo =
  '<span class="brand-mark" aria-hidden="true"><i></i><i></i></span><span>voxy<span class="brand-dot">®</span></span>';

document.querySelector("#app").innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header shell">
    <a class="brand" href="#" aria-label="Voxy home">${logo}</a>
    <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#why-voxy">Why Voxy</a><a href="#faq">FAQs</a></nav>
    <button class="button button-small" data-open="protect">Protect my wallet ${icon("diagonal")}</button>
  </header>
  <main id="main">
    <section class="hero shell" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow"><span class="status-dot"></span> Your wallet. Your name. Your way back.</div>
        <h1 id="hero-title"><span class="headline-line">Lose your keys.</span><span class="headline-line">Keep your</span><span class="headline-line title-last">crypto<span class="asterisk">✳</span></span></h1>
        <p class="hero-description">Life happens. Your crypto shouldn’t disappear.<br>Meet wallet recovery built around your ENS name.<br>Set it up once, on a calm day — for the bad one.</p>
        <div class="hero-actions"><button class="button" data-open="protect">Protect my wallet ${icon("diagonal")}</button><button class="text-button" data-open="recover">I need to recover ${icon("arrow")}</button></div>
        <p class="hero-footnote"><b>✳</b>Because "I'll write it down later" isn't a backup plan.</p>
        <div class="hero-note">${icon("shield")} Your keys stay yours. Always.</div>
      </div>
      <div class="portal-scene" aria-label="An animated ASCII portal surrounds an illustrative ENS recovery card">
        <span class="coordinate coordinate-top">VOXY / RECOVERY PORTAL / V.01</span>
        <canvas id="portal" aria-hidden="true"></canvas>
        <div class="portal-orbit orbit-one"></div><div class="portal-orbit orbit-two"></div>
        <span class="cross cross-one">+</span><span class="cross cross-two">+</span>
        <div class="identity-card">
          <div class="identity-top"><span class="identity-avatar">v</span><span class="mono">YOUR WAY BACK</span>${icon("diagonal")}</div>
          <div class="ens-name">you.eth<span class="ens-tag" aria-hidden="true">◈</span></div>
          <div class="identity-bottom"><span><i class="status-dot"></i> Recovery, reimagined.</span>${icon("lock")}</div>
        </div>
        <div class="portal-caption"><span class="tiny-box"></span> A name you remember.<br><span class="caption-indent">A wallet you don’t lose.</span></div>
        <div class="portal-controls"><button id="motion-toggle" aria-pressed="false">Ⅱ Pause motion</button><button id="replay-intro">↻ Replay intro</button></div>
      </div>
      <div class="hero-footer"><span>Built around <b class="ens-symbol">◈</b> <strong>ENS</strong><span class="ethereum">◆</span> Ethereum</span></div>
    </section>
    <section class="recovery-section shell" id="how-it-works" aria-labelledby="recovery-heading">
      <div class="recovery-heading"><span class="section-kicker">Recovery, in three moves</span><h2 id="recovery-heading">Your name is<br>the beginning.</h2><p>A plan made in advance beats one made in panic.</p></div>
      <div class="recovery-workspace">
        <div class="recovery-tabs" role="tablist" aria-label="Explore recovery steps" aria-orientation="vertical">
          <button role="tab" id="step-name" aria-controls="panel-name" aria-selected="true" tabindex="0"><span class="step-index">01</span><span><strong>A name you know.</strong><small>Start with your ENS identity.</small></span><span class="step-arrow" aria-hidden="true">↗</span></button>
          <button role="tab" id="step-plan" aria-controls="panel-plan" aria-selected="false" tabindex="-1"><span class="step-index">02</span><span><strong>A plan you choose.</strong><small>Prepare your recovery path.</small></span><span class="step-arrow" aria-hidden="true">↗</span></button>
          <button role="tab" id="step-home" aria-controls="panel-home" aria-selected="false" tabindex="-1"><span class="step-index">03</span><span><strong>A way back to you.</strong><small>Follow your configured plan.</small></span><span class="step-arrow" aria-hidden="true">↗</span></button>
        </div>
        <div class="recovery-stage">
          <div class="recovery-stage-top"><span class="mono">VOXY / RECOVERY EXPLORER</span><span class="explorer-preview">Concept preview</span></div>
          <div id="panel-name" class="recovery-panel" role="tabpanel" aria-labelledby="step-name" tabindex="0"><div class="recovery-art art-name" aria-hidden="true"><span class="ascii-bracket">[</span><span class="recovery-ens">you.eth</span><span class="ascii-bracket">]</span></div><div class="panel-copy"><span class="mono">01 / IDENTITY</span><h3>Less hexadecimal.<br>More human.</h3><p>Your ENS name is a familiar starting point for your wallet. Recovery still requires a compatible wallet and an authorized recovery method.</p></div></div>
          <div id="panel-plan" class="recovery-panel" role="tabpanel" aria-labelledby="step-plan" tabindex="0" hidden><div class="recovery-art art-plan" aria-hidden="true"><span>[ you ]</span><span class="ascii-path">······</span><span class="plan-symbol">{ key }</span><span class="ascii-path">······</span><span>[ plan ]</span></div><div class="panel-copy"><span class="mono">02 / PREPARATION</span><h3>A little foresight.<br>A lot less panic.</h3><p>Choose and authorize a recovery method before you need it. Know what’s required to regain access, while you still have access.</p></div></div>
          <div id="panel-home" class="recovery-panel" role="tabpanel" aria-labelledby="step-home" tabindex="0" hidden><div class="recovery-art art-home" aria-hidden="true"><span class="home-orbit">(</span><span class="home-symbol">&gt;_</span><span class="home-orbit">)</span></div><div class="panel-copy"><span class="mono">03 / RETURN</span><h3>New keys.<br>Same you.</h3><p>Start with your name, complete your configured verification, and authorize your recovery. Your identity is the starting point, never a substitute for proof.</p></div></div>
          <div class="recovery-stage-bottom"><span>Explore the flow. No transactions.</span><button class="text-button" data-open="recover">Preview recovery ${icon("arrow")}</button></div>
        </div>
      </div>
    </section>
    <section class="why-section" id="why-voxy"><div class="shell why-layout"><div class="why-art" aria-hidden="true"><span class="pixel-key">✳</span><span class="mono">A BACKUP PLAN.<br>NOT A COMPROMISE.</span></div><div class="why-copy"><span class="section-kicker">OWNERSHIP SHOULD FEEL LIKE THIS</span><h2>Your wallet.<br>Your life.<br>Your way back.</h2><p>Web3 handed you ownership, then handed you a sleepless night to go with it. Voxy is exploring what comes next: recovery a person can actually follow.</p><div class="benefit">${icon("globe")} <span>A name, not a string of characters.</span></div><div class="benefit">${icon("key")} <span>You keep the keys. We design the way back.</span></div><div class="benefit">${icon("shield")} <span>A recovery path in plain words.</span></div><button class="text-button" data-open="protect">Protect my wallet ${icon("arrow")}</button></div></div></section>
    <section class="faq-section shell section" id="faq"><div><span class="section-kicker">GOOD QUESTIONS.</span><h2>A little clarity.<br>A lot less worry.</h2><p>Because peace of mind starts with understanding.</p></div><div class="faq-list">
      <details><summary>What is Voxy?<span>+</span></summary><p>Voxy is ENS-based wallet recovery. Your guardian roster is an ENSv2 namespace on Sepolia, enforced on an EIP-8141 alt-mempool devnet, with recovery requests coordinated on Arkiv.</p></details>
      <details><summary>Can I recover a wallet with only an ENS name?<span>+</span></summary><p>No. An ENS name can identify an account, but it does not authorize recovery. A compatible wallet needs a recovery mechanism configured in advance, with its required verification.</p></details>
      <details><summary>Does Voxy need my seed phrase?<span>+</span></summary><p>This preview never requests a seed phrase or private key. The production recovery design should verify authorization through the wallet’s configured recovery mechanism.</p></details>
      <details><summary>Can I use it with my wallet today?<span>+</span></summary><p>The recovery console is wired to live contracts: an ENSv2 guardian roster on Sepolia and a VoxyWallet on the EIP-8141 alt-mempool devnet. Starting a recovery submits a real guardian-quorum transaction.</p></details>
    </div></section>
    <section class="final-cta shell"><span class="section-kicker">FOR ALL THE “JUST IN CASE” MOMENTS.</span><h2>Give your wallet<br>a way home<span>✳</span></h2><button class="button" data-open="protect">Protect my wallet ${icon("diagonal")}</button><div class="cta-dots" aria-hidden="true"></div></section>
  </main>
  <footer class="site-footer shell"><a class="brand" href="#" aria-label="Voxy home">${logo}</a><span>A name. A way back.</span><a href="#faq">Questions? Start here ${icon("diagonal")}</a><span class="copyright">© ${new Date().getFullYear()} Voxy</span></footer>
  <dialog id="recovery-dialog" data-lenis-prevent><button class="dialog-close" aria-label="Close recovery preview">${icon("close")}</button><div id="dialog-content"></div></dialog>
`;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const lenis = new Lenis({
  autoRaf: true,
  duration: 1.15,
  smoothWheel: !reducedMotion.matches,
  anchors: true,
});
reducedMotion.addEventListener("change", () => {
  lenis.options.smoothWheel = !reducedMotion.matches;
});

const dialog = document.querySelector("#recovery-dialog");
let lastTrigger;
let consoleCleanup;
function showConsole(mode, trigger) {
  lastTrigger = trigger;
  const content = document.querySelector("#dialog-content");
  content.innerHTML = "";
  dialog.showModal();
  lenis.stop();
  consoleCleanup?.();
  consoleCleanup = mountConsole(content, mode);
}

document
  .querySelectorAll("[data-open]")
  .forEach((button) =>
    button.addEventListener("click", () => showConsole(button.dataset.open, button)),
  );
document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener("close", () => {
  lenis.start();
  lastTrigger?.focus();
  consoleCleanup?.();
  consoleCleanup = null;
});

mountExperience({ lenis, reducedMotion });
