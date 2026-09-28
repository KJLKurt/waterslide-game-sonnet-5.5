// Prints track statistics and writes top-down / elevation debug PNGs.
import { writeFileSync } from 'node:fs';
import { Raster } from './png.mjs';
import { buildTrack } from '../src/game/trackData.js';

const out = process.argv[2] || 'track-map.png';
const track = buildTrack();
const colors = { T: [40, 110, 230, 255], M: [30, 170, 80, 255], S: [230, 60, 60, 255] };

console.log('main length', track.mainLength.toFixed(0), 'finishDist', track.finishDist.toFixed(0), 'y range', track.minY.toFixed(1), track.maxY.toFixed(1));
for (const p of track.paths) {
  let maxK = 0, maxB = 0;
  for (let i = 0; i < p.n; i++) { maxK = Math.max(maxK, Math.abs(p.curv[i])); maxB = Math.max(maxB, Math.abs(p.bank[i])); }
  const y0 = p.pos[1], y1 = p.pos[(p.n - 1) * 3 + 1];
  console.log(`${p.id}: len ${p.length.toFixed(0)} drop ${(y0 - y1).toFixed(1)} minRadius ${(1 / maxK).toFixed(1)} maxBank ${(maxB * 180 / Math.PI).toFixed(1)}deg lips ${JSON.stringify(p.lips.map(l => [Math.round(l.s), l.gapLen]))}`);
}
const { T, M, S } = track;
const rf = M.frame(track.rejoinS);
const se = S.frame(S.length);
console.log('rejoin M at', rf.px.toFixed(1), rf.py.toFixed(1), rf.pz.toFixed(1), ' S end at', se.px.toFixed(1), se.py.toFixed(1), se.pz.toFixed(1), 'S len', S.length.toFixed(0), 'M dist to rejoin', track.paths[1].mainDist(track.rejoinS) - T.length);

// Vertical clearance where different paths overlap in XZ (excluding fork start zone).
function clearance(a, b, skipA = 0, skipB = 0) {
  let min = Infinity, at = null;
  for (let i = Math.ceil(skipA / a.ds); i < a.n; i++) {
    const x = a.pos[i * 3], y = a.pos[i * 3 + 1], z = a.pos[i * 3 + 2];
    for (let j = Math.ceil(skipB / b.ds); j < b.n; j++) {
      const dx = x - b.pos[j * 3], dz = z - b.pos[j * 3 + 2];
      const rr = (a.width[i] + b.width[j]) * 0.5 + 1.5;
      if (dx * dx + dz * dz < rr * rr) {
        const dy = Math.abs(y - b.pos[j * 3 + 1]);
        if (dy < min) { min = dy; at = [a.id, (i * a.ds).toFixed(0), b.id, (j * b.ds).toFixed(0)]; }
      }
    }
  }
  return { min, at };
}
console.log('clearance T vs M (skip fork area):', JSON.stringify(clearance(T, M, 0, 0)));
console.log('clearance S vs M (skip S end 14m):', JSON.stringify(clearance({ ...S, n: S.n - 14 }, M, 0, 0)));
console.log('clearance T vs S:', JSON.stringify(clearance(T, S, 0, 0)));
console.log('clearance M vs M (self, far apart in s):');
{
  let min = Infinity, at = null;
  for (let i = 0; i < M.n; i += 2) for (let j = i + 40; j < M.n; j += 2) {
    const dx = M.pos[i * 3] - M.pos[j * 3], dz = M.pos[i * 3 + 2] - M.pos[j * 3 + 2];
    const rr = (M.width[i] + M.width[j]) * 0.5 + 1.5;
    if (dx * dx + dz * dz < rr * rr) {
      const dy = Math.abs(M.pos[i * 3 + 1] - M.pos[j * 3 + 1]);
      if (dy < min) { min = dy; at = [i, j]; }
    }
  }
  console.log('  min vertical clearance', min.toFixed(1), at);
}
{
  let min = Infinity, at = null;
  for (let i = 0; i < T.n; i += 2) for (let j = i + 40; j < T.n; j += 2) {
    const dx = T.pos[i * 3] - T.pos[j * 3], dz = T.pos[i * 3 + 2] - T.pos[j * 3 + 2];
    const rr = (T.width[i] + T.width[j]) * 0.5 + 1.5;
    if (dx * dx + dz * dz < rr * rr) {
      const dy = Math.abs(T.pos[i * 3 + 1] - T.pos[j * 3 + 1]);
      if (dy < min) { min = dy; at = [i, j]; }
    }
  }
  console.log('T self clearance', min.toFixed(1), at);
}

// ---------- top-down map
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const p of track.paths) for (let i = 0; i < p.n; i++) {
  x0 = Math.min(x0, p.pos[i * 3]); x1 = Math.max(x1, p.pos[i * 3]);
  z0 = Math.min(z0, p.pos[i * 3 + 2]); z1 = Math.max(z1, p.pos[i * 3 + 2]);
}
const pad = 30, scale = 2.2;
const W = Math.ceil((x1 - x0 + pad * 2) * scale), H = Math.ceil((z1 - z0 + pad * 2) * scale);
const r = new Raster(W, H + 260);
const mx = (x) => (x - x0 + pad) * scale;
const mz = (z) => (z1 - z + pad) * scale;
for (const p of track.paths) {
  const c = colors[p.id];
  for (let i = 0; i < p.n; i++) {
    const hw = p.width[i] * 0.5;
    const rx = p.right[i * 3], rz = p.right[i * 3 + 2];
    const cx = p.pos[i * 3], cz = p.pos[i * 3 + 2];
    const gap = p.gap[Math.min(i, p.n - 2)];
    const col = gap ? [255, 160, 0, 255] : c;
    r.line(mx(cx + rx * hw), mz(cz + rz * hw), mx(cx - rx * hw), mz(cz - rz * hw), gap ? col : [c[0] + (255 - c[0]) * 0.65, c[1] + (255 - c[1]) * 0.65, c[2] + (255 - c[2]) * 0.65, 255]);
    r.px(mx(cx), mz(cz), col);
    if (i % 50 === 0) r.disc(mx(cx), mz(cz), 3, [0, 0, 0, 255]);
  }
}
r.disc(mx(T.pos[0]), mz(T.pos[2]), 6, [255, 200, 0, 255]);

// ---------- elevation profile (main distance vs y)
const baseY = H + 250;
const ys = track.maxY - track.minY;
const sx = (W - 20) / track.mainLength;
const sy = 230 / ys;
for (const p of track.paths) {
  const c = colors[p.id];
  for (let i = 0; i < p.n; i++) {
    const d = p.mainDist(i * p.ds);
    r.disc(10 + d * sx, baseY - (p.pos[i * 3 + 1] - track.minY) * sy, 1, p.gap[Math.min(i, p.n - 2)] ? [255, 160, 0, 255] : c);
  }
}
writeFileSync(out, r.png());
console.log('wrote', out, W, H);
