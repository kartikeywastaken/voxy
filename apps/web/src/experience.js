import { createPortalRenderer, ASCII_RAMP, PORTAL_COLUMNS, PORTAL_ROWS } from './portal.js';
import { startIntro, INTRO_DURATION } from './intro.js';
import './intro.css';

export function mountExperience({ lenis, reducedMotion }) {
  const root = document.documentElement;
  const app = document.querySelector('#app');
  const canvas = document.querySelector('#portal');
  const ctx = canvas.getContext('2d');
  const scene = document.querySelector('.portal-scene');
  const card = document.querySelector('.identity-card');
  const pause = document.querySelector('#motion-toggle');
  const render = createPortalRenderer();
  const cellWidth = 9, cellHeight = 14;
  canvas.width = PORTAL_COLUMNS * cellWidth;
  canvas.height = PORTAL_ROWS * cellHeight;
  const glyphColors = ['#713621', '#ab472a', '#e75d31', '#ff8c50', '#ffd0a0'];
  let paused = false, visible = true, previous = 0, elapsed = 0, raf = 0;
  let pointerX = 0, pointerY = 0, intro = null, stopIntro;

  function draw() {
    if (!ctx) return;
    const characters = render(elapsed, pointerX, pointerY);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < characters.length; i++) {
      const level = characters[i];
      if (!level) continue;
      ctx.fillStyle = glyphColors[Math.min(4, Math.floor(level / 2))];
      ctx.fillText(ASCII_RAMP[level], (i % PORTAL_COLUMNS + .5) * cellWidth, (Math.floor(i / PORTAL_COLUMNS) + .5) * cellHeight);
    }
  }
  function tick(now) {
    raf = 0;
    if (document.hidden || paused || reducedMotion.matches || (!visible && !intro)) { previous = 0; return; }
    if (now - previous >= 1000 / 24) {
      elapsed += previous ? Math.min((now - previous) / 1000, .08) : .04;
      previous = now;
      draw();
    }
    raf = requestAnimationFrame(tick);
  }
  function restart() { if (!raf) raf = requestAnimationFrame(tick); }
  draw(); restart();
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) restart(); }).observe(scene);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) restart(); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { finishIntro(); clearTextTimer(); if (ensType) ensType.textContent = 'you.eth'; draw(); } else restart(); });
  pause.addEventListener('click', () => {
    paused = !paused;
    root.classList.toggle('motion-paused', paused);
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = paused ? '▷ Resume motion' : 'Ⅱ Pause motion';
    if (paused) { clearTextTimer(); if (ensType) ensType.textContent = 'you.eth'; }
    else restart();
  });
  scene.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return; // touch scroll must not tilt the card
    if (paused || reducedMotion.matches) return;
    const bounds = scene.getBoundingClientRect();
    pointerX = (event.clientX - bounds.left) / bounds.width - .5;
    pointerY = (event.clientY - bounds.top) / bounds.height - .5;
    card.style.transform = `perspective(800px) rotateX(${-pointerY * 12}deg) rotateY(${pointerX * 16}deg) rotate(-7deg)`;
  });
  scene.addEventListener('pointerleave', () => { pointerX = pointerY = 0; card.style.transform = ''; });

  // Terminal typing: the explorer's ENS name re-types for its panel's activation.
  const ensType = document.querySelector('.recovery-ens');
  let typeTimer = 0;
  function typeEns() {
    if (!ensType || paused || reducedMotion.matches) return;
    clearTextTimer();
    let i = 0;
    ensType.textContent = '';
    typeTimer = setInterval(() => {
      ensType.textContent = 'you.eth'.slice(0, ++i);
      if (i >= 7) clearTextTimer();
    }, 70);
  }
  function clearTextTimer() { clearInterval(typeTimer); typeTimer = 0; }

  // Magnetic CTAs: attract only on fine pointers, never under reduced motion.
  const magneticButtons = [...document.querySelectorAll('.button, .text-button')];
  const finePointer = matchMedia('(pointer: fine)');
  magneticButtons.forEach(button => {
    button.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !finePointer.matches) return;
      const bounds = button.getBoundingClientRect();
      button.style.translate = `${((event.clientX - bounds.left) / bounds.width - .5) * 9}% ${((event.clientY - bounds.top) / bounds.height - .5) * 13}%`;
    });
    button.addEventListener('pointerleave', () => { button.style.translate = ''; });
  });

  const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('in-view'); reveal.unobserve(entry.target);
  }), { threshold: .12 });
  document.querySelectorAll('.why-art, .final-cta').forEach(element => { element.classList.add('motion-reveal'); reveal.observe(element); });

  const tabs = [...document.querySelectorAll('.recovery-tabs [role="tab"]')];
  function selectStep(tab) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
    if (tab.id === 'step-name') typeEns();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectStep(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); selectStep(tabs[next]); tabs[next].focus();
    });
  });

  let introTimer, removalTimer, returnFocus;
  function finishIntro() {
    if (!intro) return;
    clearTimeout(introTimer);
    const departing = intro;
    stopIntro?.();
    intro = null;
    app.inert = false;
    lenis.start();
    root.classList.remove('intro-active');
    root.classList.add('experience-ready');
    departing.classList.add('intro-exit');
    if (departing.contains(document.activeElement)) (returnFocus || document.querySelector('#replay-intro')).focus({ preventScroll: true });
    removalTimer = setTimeout(() => departing.remove(), reducedMotion.matches ? 0 : 420);
  }
  function playIntro(trigger) {
    if (intro || reducedMotion.matches) return;
    clearTimeout(removalTimer);
    document.querySelector('.portal-intro')?.remove();
    returnFocus = trigger;
    intro = document.createElement('aside');
    intro.className = 'portal-intro';
    intro.setAttribute('aria-label', 'Voxy opening animation');
    intro.setAttribute('data-lenis-prevent', '');
    intro.innerHTML = `<div class="intro-top"><span class="intro-signature">v<span>voxy</span></span><button class="intro-skip">Skip intro ↗</button></div><canvas class="identity-tunnel" aria-hidden="true"></canvas><div class="intro-center"><span class="intro-bracket intro-bracket-left" aria-hidden="true">[</span><span class="intro-bracket intro-bracket-right" aria-hidden="true">]</span><span class="intro-caption">A name. A way back.</span></div><div class="intro-bottom"><span class="mono">ENS-BASED RECOVERY</span><span class="mono">ENTER YOUR ORBIT ↗</span></div>`;
    document.body.append(intro);
    intro.querySelector('button').addEventListener('click', finishIntro);
    app.inert = true;
    lenis.stop();
    root.classList.add('intro-active');
    root.classList.remove('experience-ready');
    if (trigger) intro.querySelector('button').focus({ preventScroll: true });
    stopIntro = startIntro(intro.querySelector('canvas'), finishIntro);
    restart();
    // A watchdog restores the page even when animation frames are suspended.
    introTimer = setTimeout(finishIntro, INTRO_DURATION + 400);
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && intro) finishIntro(); });
  document.querySelector('#replay-intro').addEventListener('click', event => playIntro(event.currentTarget));
  if (!reducedMotion.matches) playIntro();
  else root.classList.add('experience-ready');

  // Vite hot updates must not leave a second render loop or an inert page behind.
  if (import.meta.hot) import.meta.hot.dispose(() => { finishIntro(); cancelAnimationFrame(raf); clearTextTimer(); reveal.disconnect(); });
}
