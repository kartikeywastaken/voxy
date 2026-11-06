export const INTRO_DURATION = 2200;

// One continuous shot: scattered identity → assembled name → through the portal.
export function startIntro(canvas, onComplete) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onComplete();
    return () => {};
  }
  const width = (canvas.width = Math.min(1000, window.innerWidth));
  const height = (canvas.height = Math.round((width * window.innerHeight) / window.innerWidth));
  const cx = width / 2,
    cy = height / 2;
  const textSize = Math.min(108, width * 0.16);
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const ink = mask.getContext("2d");
  ink.font = `600 ${textSize}px monospace`;
  ink.textAlign = "center";
  ink.textBaseline = "middle";
  ink.fillText("you.eth", cx, cy);
  const pixels = ink.getImageData(0, 0, width, height).data;
  const particles = [];
  const spacing = Math.max(2, Math.round(width / 270));
  for (
    let y = Math.max(0, Math.floor(cy - textSize));
    y < Math.min(height, cy + textSize);
    y += spacing
  ) {
    for (let x = 0; x < width; x += spacing) {
      if (pixels[(y * width + x) * 4 + 3] < 100) continue;
      const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const random = seed - Math.floor(seed);
      particles.push({
        x,
        y,
        angle: random * Math.PI * 2,
        distance: width * (0.3 + random),
        delay: random * 0.23,
      });
    }
  }
  const start = performance.now();
  let raf = 0,
    stopped = false;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  function draw(now) {
    if (stopped) return;
    const t = Math.min(1, (now - start) / INTRO_DURATION);
    ctx.clearRect(0, 0, width, height);
    const rush = Math.max(0, (t - 0.66) / 0.34) ** 2;
    const scale = Math.min(width, height) * 0.36;
    ctx.save();
    ctx.translate(cx, cy);
    // Depth-spaced elliptical gates expand past the viewer without a spinner loop.
    for (let ring = 17; ring >= 0; ring--) {
      const depth = (ring / 18 + t * 0.28 + rush * 0.8) % 1;
      const radius = scale / (0.22 + depth * 3.6);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.72, -0.17, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = (0.08 + (1 - depth) * 0.25) * Math.min(1, t * 6);
      ctx.lineWidth = ring % 3 === 0 ? 1.2 : 0.5;
      ctx.setLineDash(ring % 3 === 0 ? [1.5, 5] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let i = 0; i < 140; i++) {
      const angle = i * 2.39996;
      const depth = (i * 0.0618 + t * 0.15 + rush) % 1;
      const r = (scale * 0.4) / (0.09 + depth * 2);
      const x = Math.cos(angle) * r,
        y = Math.sin(angle) * r * 0.8;
      ctx.globalAlpha = (1 - depth) * 0.65;
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, depth < 0.2 ? 2 : 1, depth < 0.2 ? 2 : 1);
      if (rush > 0.1) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x * (1 + rush * 0.2), y * (1 + rush * 0.2));
        ctx.stroke();
      }
    }
    ctx.restore();
    for (const particle of particles) {
      const progress = Math.min(1, Math.max(0, (t - particle.delay) / 0.36));
      const scatter = (1 - progress) ** 4;
      const x = particle.x + Math.cos(particle.angle) * particle.distance * scatter;
      const y = particle.y + Math.sin(particle.angle) * particle.distance * scatter;
      const zoom = 1 + rush * 12;
      ctx.globalAlpha = Math.min(1, t * 9) * (1 - rush);
      ctx.fillStyle = particle.delay > 0.17 ? "#ffb485" : accent;
      ctx.fillRect(
        cx + (x - cx) * zoom,
        cy + (y - cy) * zoom,
        spacing * 0.7 * zoom,
        spacing * 0.7 * zoom,
      );
    }
    ctx.globalAlpha = 1;
    if (t < 1) raf = requestAnimationFrame(draw);
    else onComplete();
  }
  raf = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
