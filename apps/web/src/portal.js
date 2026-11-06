export const ASCII_RAMP = " .:-=+*#%@";
export const PORTAL_COLUMNS = 112;
export const PORTAL_ROWS = 72;

const points = [];
for (let u = 0; u < Math.PI * 2; u += 0.027) {
  for (let v = 0; v < Math.PI * 2; v += 0.05) {
    const radius = 0.59 + 0.205 * Math.cos(v);
    points.push([
      radius * Math.cos(u),
      radius * Math.sin(u),
      0.205 * Math.sin(v),
      Math.cos(v) * Math.cos(u),
      Math.cos(v) * Math.sin(u),
      Math.sin(v),
    ]);
  }
}

export function createPortalRenderer(columns = PORTAL_COLUMNS, rows = PORTAL_ROWS) {
  const characters = new Uint8Array(columns * rows);
  const depth = new Float32Array(columns * rows);
  return function render(time = 0, pointerX = 0, pointerY = 0) {
    characters.fill(0);
    depth.fill(-Infinity);
    const tilt = 0.5 + Math.sin(time * 0.3) * 0.22 + pointerY * 0.2;
    const turn = -0.35 + time * 0.12 + pointerX * 0.2;
    const ct = Math.cos(tilt),
      st = Math.sin(tilt),
      cr = Math.cos(turn),
      sr = Math.sin(turn);
    for (const [x, y, z, nx, ny, nz] of points) {
      const yy = y * ct - z * st,
        zz = y * st + z * ct;
      const rx = x * cr - yy * sr,
        ry = x * sr + yy * cr;
      const column = Math.round(columns * (0.5 + rx * 0.53));
      const row = Math.round(rows * (0.5 + ry * 0.53));
      if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
      const index = row * columns + column;
      if (zz < depth[index]) continue;
      depth[index] = zz;
      const light = Math.max(
        0,
        nx * -0.35 + (ny * ct - nz * st) * -0.4 + (ny * st + nz * ct) * 0.85,
      );
      characters[index] = 1 + Math.round(light * (ASCII_RAMP.length - 2));
    }
    return characters;
  };
}
