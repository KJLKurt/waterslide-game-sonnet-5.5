// Generates the PWA icons (PNG) + favicon.svg without any image dependencies.  Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePNG } from './png.mjs';

const OUT = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// slide centreline (normalised coordinates)
const curve = [];
for (let i = 0; i <= 90; i++) {
  const t = i / 90;
  curve.push({ x: 0.1 + 0.8 * t, y: 0.86 - 0.62 * t - 0.1 * Math.sin(t * Math.PI * 2.1), w: 0.115 - 0.05 * t, t });
}
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

function nearestOnCurve(x, y) {
  let best = 1e9, bw = 0, bt = 0;
  for (const p of curve) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < best) { best = d; bw = p.w; bt = p.t; }
  }
  return { d: best, w: bw, t: bt };
}

function shade(u, v, maskable) {
  if (maskable) { u = (u - 0.5) / 0.8 + 0.5; v = (v - 0.5) / 0.8 + 0.5; }
  // background
  let c = mix(hex(0x2f7bff), hex(0x22cbff), Math.min(1, Math.max(0, v * 1.1)));
  c = mix(c, hex(0xffffff), 0.16 * Math.max(0, 1 - Math.hypot(u - 0.3, v - 0.2) * 2.2));
  // sun
  if (Math.hypot(u - 0.8, v - 0.2) < 0.085) c = hex(0xffd23f);
  // ribbon (rim -> white -> water channel)
  const n = nearestOnCurve(u, v);
  if (n.d < n.w + 0.03) {
    c = n.d < n.w ? (n.d > n.w - 0.022 ? hex(0xff6f7d) : mix(hex(0xffffff), hex(0x9fdcff), Math.min(1, (n.w - n.d) / n.w) * 0.85)) : hex(0xffffff);
    if (n.d >= n.w) c = mix(c, hex(0x1a5fbf), 0.35);
  }
  // rider: head + body on the slide near t=0.6
  const rp = curve[54];
  const hx = rp.x, hy = rp.y - 0.155;
  if (Math.hypot(u - hx, v - hy) < 0.052) c = hex(0xffd0a8);
  if (Math.hypot(u - hx, v - (hy - 0.012)) < 0.056 && v < hy - 0.018) c = hex(0x3a2412);
  // torso capsule
  const bx = hx, by0 = hy + 0.05, by1 = hy + 0.125;
  const dy = Math.max(by0 - v, 0, v - by1);
  if (Math.hypot(u - bx, dy) < 0.05) c = hex(0xffb81c);
  // arms up
  for (const s of [-1, 1]) {
    const ax = bx + s * 0.05, ay = by0 + 0.02;
    const tx = bx + s * 0.11, ty = by0 - 0.065;
    const dx = tx - ax, dyy = ty - ay;
    const k = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dyy) / (dx * dx + dyy * dyy)));
    if (Math.hypot(u - (ax + dx * k), v - (ay + dyy * k)) < 0.019) c = hex(0xffd0a8);
  }
  // legs forward on the slide
  if (Math.hypot(u - (bx + 0.055), v - (by1 + 0.004)) < 0.036 && u > bx) c = hex(0x2b7bff);
  return c;
}

function render(size, { maskable = false, rounded = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
          let inside = true;
          if (rounded && !maskable) {
            const rad = 0.22;
            const qx = Math.abs(u - 0.5) - (0.5 - rad), qy = Math.abs(v - 0.5) - (0.5 - rad);
            inside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= rad;
          }
          if (!inside) continue;
          const c = shade(u, v, maskable);
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const cnt = a / 255 || 1;
      px[o] = r / cnt; px[o + 1] = g / cnt; px[o + 2] = b / cnt; px[o + 3] = a / n;
    }
  }
  return encodePNG(size, size, px);
}

writeFileSync(`${OUT}icon-192.png`, render(192));
writeFileSync(`${OUT}icon-512.png`, render(512));
writeFileSync(`${OUT}icon-maskable-512.png`, render(512, { maskable: true }));
writeFileSync(`${OUT}apple-touch-icon.png`, render(180, { rounded: false, maskable: false }));

writeFileSync(`${OUT}favicon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7bff"/><stop offset="1" stop-color="#22cbff"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <circle cx="80" cy="20" r="8.5" fill="#ffd23f"/>
  <path d="M10 86 C 30 70, 42 92, 58 60 S 78 30, 90 24" fill="none" stroke="#ff6f7d" stroke-width="15" stroke-linecap="round"/>
  <path d="M10 86 C 30 70, 42 92, 58 60 S 78 30, 90 24" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
  <circle cx="58" cy="44" r="5.2" fill="#ffd0a8"/>
  <rect x="53.5" y="50" width="9" height="12" rx="4.5" fill="#ffb81c"/>
</svg>
`);
console.log('icons written to', OUT);
