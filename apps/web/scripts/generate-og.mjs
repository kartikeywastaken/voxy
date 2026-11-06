// Generates public/og.png (1200x630) with zero dependencies.
// Brand-accurate to DESIGN.md: charcoal void, signal-orange ring ladder, pixel-drawn "you.eth".
// Re-run with `npm run og`. Deterministic: same bytes every run.
import fs from 'node:fs';
import zlib from 'node:zlib';

const W = 1200, H = 630;
const px = new Uint8Array(W * H * 4);

const BG = [25, 18, 15];           // oklch(19% .012 45) — the void
const IVORY = [244, 243, 235];     // oklch(96% .012 96)
const ORANGE_LADDER = [[113, 54, 33], [171, 71, 42], [231, 93, 49], [255, 140, 80], [255, 208, 160]];

function fill() {
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255;
  }
}
function set(x, y, c, a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = Math.round(px[i] * (1 - a) + c[0] * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a);
}

// Bayer-dither field: the same ordered dithering the site's texture strip uses.
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];
const DITHER = [36, 28, 24];
function ditherField() {
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const dx = x - W * .72, dy = y - H * .5;
    const glow = Math.max(0, 1 - Math.hypot(dx, dy) / (W * .48));
    if (glow * 64 > BAYER[y % 8][x % 8]) {
      const tone = 1 + .35 * glow;
      set(x + 1, y + 1, DITHER.map(v => Math.min(255, v * tone)), .55);
    }
  }
}

// Elliptical gates, imported from the intro's depth grammar.
function rings() {
  const cx = W * .78, cy = H * .5, scale = Math.min(W, H) * .36;
  for (let ring = 17; ring >= 0; ring--) {
    const depth = (ring / 18 + .18) % 1;
    const radius = scale / (.22 + depth * 3.6);
    const tilt = -.17;
    const shade = ORANGE_LADDER[Math.min(4, Math.floor((1 - depth) * 4.2))];
    const alpha = .10 + (1 - depth) * .3;
    const lw = ring % 3 === 0 ? 2 : 1;
    for (let step = 0; step < 1400; step++) {
      const t = (step / 1400) * Math.PI * 2;
      const x0 = Math.cos(t) * radius, y0 = Math.sin(t) * radius * .72;
      const x = cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt);
      const y = cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt);
      set(Math.round(x), Math.round(y), shade, alpha);
      if (lw > 1) set(Math.round(x) + 1, Math.round(y), shade, alpha * .7);
    }
  }
}

// 5x7 bitmap glyphs, drawn in pure pixels — no font, no image library.
const FONT = {
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'V': ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  'X': ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'N': ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
function text(str, x, y, size, color, spacing = 1) {
  let cursor = x;
  for (const ch of str) {
    const glyph = FONT[ch];
    if (!glyph) { cursor += size * 3; continue; }
    for (let ry = 0; ry < 7; ry++) for (let rx = 0; rx < glyph[ry].length; rx++) {
      if (glyph[ry][rx] === '#') for (let sy = 0; sy < size; sy++) for (let sx = 0; sx < size; sx++)
        set(cursor + rx * size + sx, y + ry * size + sy, color);
    }
    cursor += (6 + spacing) * size;
  }
  return cursor;
}function encodePng() {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
  }
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))]);
}

// Compose
fill();
ditherField();
rings();
let cursor = text('YOU', 150, 240, 16, IVORY);
cursor = text('.', cursor, 240, 16, ORANGE_LADDER[2]);
text('ETH', cursor, 240, 16, ORANGE_LADDER[2]);
text('A NAME. A WAY BACK.', 150, 384, 4, [168, 155, 138]);
text('VOXY', W - 150 - 4 * 28, H - 116, 4, ORANGE_LADDER[3]);

fs.writeFileSync('public/og.png', encodePng());
console.log('wrote public/og.png', fs.statSync('public/og.png').size, 'bytes');
