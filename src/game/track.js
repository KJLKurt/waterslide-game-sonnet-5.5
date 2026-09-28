/**
 * Track model.
 *
 * A slide is one or more "paths". Every path is a centerline polyline sampled at a fixed arc-length
 * spacing (ds). Each sample stores position, tangent, right/normal (banked frame), width, curvature
 * and flags. Racers live in (path, s, u) space: s = distance along the centerline, u = lateral offset.
 *
 * The world height under a racer comes from Track.raycastDown(), a vertical ray cast against the very
 * same cross-section the render mesh is built from (bilinear strip patches, found through a 2D grid).
 *
 * This file has no DOM / WebGL dependency so the whole race can be simulated headless in Node.
 */
import { DEG, clamp, lerp, smoothstep, wrapAngle } from './util.js';

export const BOWL = 0.42; // trough depth (m) at the edge of the riding surface
export const RIM_W = 0.7; // visual rim outside the riding surface
export const FLAG_RAMP = 1;
export const FLAG_ROUGH = 2; // white-water rapids: extra drag
export const FLAG_BOOST = 4; // speed strip

const EASE = {
  smooth: smoothstep,
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
};

/** Height of the trough surface above the frame origin along the frame normal. */
export function sectionHeight(u, width) {
  const t = u / (width * 0.5);
  return BOWL * t * t;
}
export function sectionSlope(u, width) {
  const h = width * 0.5;
  return (2 * BOWL * u) / (h * h);
}

export class Frame {
  constructor() {
    this.s = 0;
    this.px = 0; this.py = 0; this.pz = 0;
    this.tx = 0; this.ty = 0; this.tz = 1;
    this.rx = 1; this.ry = 0; this.rz = 0;
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.width = 8;
    this.curv = 0;
    this.bank = 0;
  }
}

export class TrackPath {
  constructor(id, d) {
    this.id = id;
    this.ds = d.ds;
    this.n = d.n;
    this.length = (d.n - 1) * d.ds;
    this.pos = d.pos;
    this.tan = d.tan;
    this.right = d.right;
    this.up = d.up;
    this.width = d.width;
    this.curv = d.curv;
    this.bank = d.bank;
    this.hue = d.hue;
    this.flags = d.flags;
    this.gap = d.gap; // per segment i -> i+1: 1 = no surface
    this.lips = d.lips; // gap start events: { s, gapLen }
    this.ramps = d.ramps; // ramp events: { s0, s1 }
    this.checkpoints = d.checkpoints; // s values
    this.finishS = d.finishS;
    this.index = 0; // set by Track
    this.mainStart = 0; // progress mapping into "main distance"
    this.mainEnd = this.length;
    this.marks = d.marks || {};
    this.endLinks = null; // [{ uMax, to, du }]
    this.endKind = 'end'; // 'link' | 'drop' | 'end'
    this.name = d.name || id;
  }

  /** Progress in main-distance units (S path is mapped onto the main range it bypasses). */
  mainDist(s) {
    return this.mainStart + (clamp(s, 0, this.length) / this.length) * (this.mainEnd - this.mainStart);
  }

  frame(s, o = new Frame()) {
    let f = s / this.ds;
    const max = this.n - 1.0001;
    if (f < 0) f = 0;
    else if (f > max) f = max;
    const i = f | 0;
    const t = f - i;
    const a = i * 3;
    const b = a + 3;
    const P = this.pos, T = this.tan, R = this.right, N = this.up;
    o.s = i * this.ds + t * this.ds;
    o.px = P[a] + (P[b] - P[a]) * t;
    o.py = P[a + 1] + (P[b + 1] - P[a + 1]) * t;
    o.pz = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
    let x = T[a] + (T[b] - T[a]) * t, y = T[a + 1] + (T[b + 1] - T[a + 1]) * t, z = T[a + 2] + (T[b + 2] - T[a + 2]) * t;
    let l = 1 / Math.hypot(x, y, z);
    o.tx = x * l; o.ty = y * l; o.tz = z * l;
    x = R[a] + (R[b] - R[a]) * t; y = R[a + 1] + (R[b + 1] - R[a + 1]) * t; z = R[a + 2] + (R[b + 2] - R[a + 2]) * t;
    l = 1 / Math.hypot(x, y, z);
    o.rx = x * l; o.ry = y * l; o.rz = z * l;
    x = N[a] + (N[b] - N[a]) * t; y = N[a + 1] + (N[b + 1] - N[a + 1]) * t; z = N[a + 2] + (N[b + 2] - N[a + 2]) * t;
    l = 1 / Math.hypot(x, y, z);
    o.nx = x * l; o.ny = y * l; o.nz = z * l;
    o.width = this.width[i] + (this.width[i + 1] - this.width[i]) * t;
    o.curv = this.curv[i] + (this.curv[i + 1] - this.curv[i]) * t;
    o.bank = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    return o;
  }

  /** World point on the riding surface at (s, u). */
  point(s, u, out, f = this._f || (this._f = new Frame())) {
    this.frame(s, f);
    const h = sectionHeight(u, f.width);
    out.x = f.px + f.rx * u + f.nx * h;
    out.y = f.py + f.ry * u + f.ny * h;
    out.z = f.pz + f.rz * u + f.nz * h;
    return out;
  }

  lipAt(s) {
    for (const l of this.lips) if (s >= l.s - 0.01 && s <= l.s + l.gapLen + 1) return l;
    return null;
  }

  isGapAt(s) {
    const i = Math.min(this.n - 2, Math.max(0, Math.floor(s / this.ds)));
    return this.gap[i] === 1;
  }

  /** Next lip (gap start) strictly ahead of s within `maxDist`, or null. */
  lipAhead(s, maxDist) {
    for (let k = 0; k < this.lips.length; k++) {
      const d = this.lips[k].s - s;
      if (d > -0.5 && d < maxDist) return this.lips[k];
      if (d >= maxDist) break;
    }
    return null;
  }
}

/**
 * Turtle-style path builder. Pieces:
 *  { len, turn(deg, +right), pitch(deg, end pitch), width, hue, bank(scale), ramp, gap, checkpoint, finish, ease }
 *  { type:'connect', target:{x,y,z,yaw}, pitch, width, hue }  Hermite-connects to a target frame.
 */
export function buildPath(id, { start, pieces, ds = 1, name }) {
  let x = start.x, y = start.y, z = start.z;
  let yaw = start.yaw || 0;
  let pitch = (start.pitch || 0) * DEG;
  let width = start.width;
  let hue = start.hue ?? 0.55;
  const X = [x], Y = [y], Z = [z], W = [width], H = [hue], FL = [0], GAP = [0], BS = [1];
  const lips = [], ramps = [], checkpoints = [], marks = {};
  let finishS = -1;
  const idx = () => X.length - 1;

  for (const p of pieces) {
    const startIndex = idx();
    if (p.checkpoint) checkpoints.push(startIndex * ds);
    if (p.finish) finishS = startIndex * ds;
    if (p.mark) marks[p.mark] = startIndex * ds;
    const w0 = width, w1 = p.width ?? width;
    const h0 = hue, h1 = p.hue ?? hue;
    const isRamp = (p.ramp ? FLAG_RAMP : 0) | (p.rough ? FLAG_ROUGH : 0) | (p.boost ? FLAG_BOOST : 0);
    const bankScale = p.bank ?? 1;

    if (p.type === 'connect') {
      const t = typeof p.target === 'function' ? p.target({ x, y, z, yaw, pitch }) : p.target;
      const chord = Math.hypot(t.x - x, t.z - z);
      const k = chord * (p.tension ?? 1);
      const m0x = Math.sin(yaw) * k, m0z = Math.cos(yaw) * k;
      const m1x = Math.sin(t.yaw) * k, m1z = Math.cos(t.yaw) * k;
      const p1 = (p.pitch ?? 0) * DEG;
      const m0y = Math.tan(pitch) * chord, m1y = Math.tan(p1) * chord;
      const N = 600;
      const pts = [];
      let acc = 0;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
        const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
        const px = h00 * x + h10 * m0x + h01 * t.x + h11 * m1x;
        const pz = h00 * z + h10 * m0z + h01 * t.z + h11 * m1z;
        const py = h00 * y + h10 * m0y + h01 * t.y + h11 * m1y;
        if (i > 0) {
          const q = pts[i - 1];
          acc += Math.hypot(px - q.x, py - q.y, pz - q.z);
        }
        pts.push({ x: px, y: py, z: pz, c: acc });
      }
      const n = Math.max(1, Math.round(acc / ds));
      let j = 0;
      for (let k2 = 1; k2 <= n; k2++) {
        const target = (acc * k2) / n;
        while (j < N - 1 && pts[j + 1].c < target) j++;
        const a = pts[j], b = pts[j + 1];
        const f = (target - a.c) / Math.max(1e-6, b.c - a.c);
        X.push(lerp(a.x, b.x, f)); Y.push(lerp(a.y, b.y, f)); Z.push(lerp(a.z, b.z, f));
        const tt = smoothstep(k2 / n);
        W.push(lerp(w0, w1, tt)); H.push(lerp(h0, h1, tt));
        FL.push(isRamp); GAP.push(0); BS.push(bankScale);
      }
      x = t.x; y = t.y; z = t.z; yaw = t.yaw; pitch = p1; width = w1; hue = h1;
      continue;
    }

    const n = Math.max(1, Math.round(p.len / ds));
    const p0 = pitch, p1 = p.pitch != null ? p.pitch * DEG : pitch;
    const turn = (p.turn || 0) * DEG;
    const f = p.turnEase ?? 0.25;
    const ease = EASE[p.ease || 'smooth'];
    if (p.gap) lips.push({ s: startIndex * ds, gapLen: n * ds, kick: p.kick ?? 0 });
    if (p.ramp) ramps.push({ s0: startIndex * ds, s1: (startIndex + n) * ds });
    for (let k = 0; k < n; k++) {
      const tm = (k + 0.5) / n, t1 = (k + 1) / n;
      const pitchM = lerp(p0, p1, ease(tm));
      const wgt = tm < f ? tm / f : tm > 1 - f ? (1 - tm) / f : 1;
      const dyaw = turn === 0 ? 0 : (-turn * wgt) / (1 - f) / n;
      const yawM = yaw + dyaw * 0.5;
      const cp = Math.cos(pitchM);
      x += Math.sin(yawM) * cp * ds;
      y += Math.sin(pitchM) * ds;
      z += Math.cos(yawM) * cp * ds;
      yaw += dyaw;
      X.push(x); Y.push(y); Z.push(z);
      const tt = smoothstep(t1);
      W.push(lerp(w0, w1, tt)); H.push(lerp(h0, h1, tt));
      FL.push(isRamp); GAP.push(0); BS.push(bankScale);
      GAP[GAP.length - 2] = p.gap ? 1 : 0;
    }
    pitch = p1; width = w1; hue = h1;
  }

  const n = X.length;
  const pos = new Float32Array(n * 3);
  const tan = new Float32Array(n * 3);
  const right = new Float32Array(n * 3);
  const up = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = X[i]; pos[i * 3 + 1] = Y[i]; pos[i * 3 + 2] = Z[i]; }

  // tangents from central differences of the polyline
  const yawArr = new Float32Array(n);
  let prevYaw = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    tan[i * 3] = dx; tan[i * 3 + 1] = dy; tan[i * 3 + 2] = dz;
    let yw = Math.atan2(dx, dz);
    if (i > 0) yw = prevYaw + wrapAngle(yw - prevYaw);
    yawArr[i] = yw;
    prevYaw = yw;
  }

  // signed horizontal curvature (positive = turning right), lightly smoothed
  const kRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    kRaw[i] = (-(yawArr[b] - yawArr[a]) / ((b - a) * ds)) * 1;
  }
  const curv = boxBlur(kRaw, 2, 2);

  // banking follows curvature, then gets smoothed so it eases in and out
  const BANK_GAIN = 21, MAX_BANK = 36 * DEG;
  const bankRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) bankRaw[i] = clamp(Math.atan(BANK_GAIN * curv[i]), -MAX_BANK, MAX_BANK) * BS[i];
  const bank = boxBlur(bankRaw, 9, 2);

  for (let i = 0; i < n; i++) {
    const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
    // right0 = normalize(cross(T, worldUp))
    let rx = -tz, ry = 0, rz = tx; // cross((tx,ty,tz),(0,1,0)) = (-tz, 0, tx)
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // up0 = cross(right0, T)
    let ux = ry * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - ry * tx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const cb = Math.cos(bank[i]), sb = Math.sin(bank[i]);
    right[i * 3] = rx * cb - ux * sb; right[i * 3 + 1] = ry * cb - uy * sb; right[i * 3 + 2] = rz * cb - uz * sb;
    up[i * 3] = ux * cb + rx * sb; up[i * 3 + 1] = uy * cb + ry * sb; up[i * 3 + 2] = uz * cb + rz * sb;
  }

  return new TrackPath(id, {
    ds, n, pos, tan, right, up, name,
    width: Float32Array.from(W), curv, bank,
    hue: Float32Array.from(H), flags: Uint8Array.from(FL), gap: Uint8Array.from(GAP),
    lips, ramps, checkpoints, finishS, marks,
  });
}

function boxBlur(src, radius, passes) {
  const n = src.length;
  let a = Float32Array.from(src);
  let b = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j >= 0 && j < n) { sum += a[j]; c++; }
      }
      b[i] = sum / c;
    }
    [a, b] = [b, a];
  }
  return a;
}

const CELL = 8;
const cellKey = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);

export class Track {
  constructor(paths, meta) {
    this.paths = paths;
    paths.forEach((p, i) => (p.index = i));
    Object.assign(this, meta);
    this._hit = { path: null, s: 0, u: 0, y: 0, lam: 0, nx: 0, ny: 1, nz: 0, width: 0 };
    this._buildGrid();
    let minY = Infinity, maxY = -Infinity;
    for (const p of paths) {
      for (let i = 0; i < p.n; i++) {
        const y = p.pos[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    this.minY = minY;
    this.maxY = maxY;
  }

  _buildGrid() {
    this.grid = new Map();
    this.paths.forEach((p, pi) => {
      for (let i = 0; i < p.n - 1; i++) {
        if (p.gap[i]) continue;
        const a = i * 3, b = a + 3;
        const r = Math.max(p.width[i], p.width[i + 1]) * 0.5 + 1.2;
        const x0 = Math.min(p.pos[a], p.pos[b]) - r, x1 = Math.max(p.pos[a], p.pos[b]) + r;
        const z0 = Math.min(p.pos[a + 2], p.pos[b + 2]) - r, z1 = Math.max(p.pos[a + 2], p.pos[b + 2]) + r;
        const code = (pi << 20) | i;
        for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
          for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
            const k = cellKey(ix, iz);
            let list = this.grid.get(k);
            if (!list) this.grid.set(k, (list = []));
            list.push(code);
          }
        }
      }
    });
  }

  /**
   * Vertical ray from (ox,oy,oz) downward against the slide surface (all paths).
   * Returns the highest surface within [-maxUp, maxDown] below the origin, or null.
   */
  raycastDown(ox, oy, oz, maxDown = 3, maxUp = 0.3, out = this._hit) {
    const list = this.grid.get(cellKey(Math.floor(ox / CELL), Math.floor(oz / CELL)));
    if (!list) return null;
    let best = Infinity;
    for (let k = 0; k < list.length; k++) {
      const code = list[k];
      const p = this.paths[code >> 20];
      const i = code & 0xfffff;
      const P = p.pos, R = p.right, N = p.up, Wd = p.width;
      const a = i * 3, b = a + 3;
      const mx = (P[a] + P[b]) * 0.5 - ox, mz = (P[a + 2] + P[b + 2]) * 0.5 - oz;
      const rr = (Wd[i] + Wd[i + 1]) * 0.25 + p.ds * 0.5 + 0.4;
      if (mx * mx + mz * mz > rr * rr) continue;
      const dxs = P[b] - P[a], dys = P[b + 1] - P[a + 1], dzs = P[b + 2] - P[a + 2];
      const inv = 1 / (dxs * dxs + dys * dys + dzs * dzs);
      let lam = 0, fr = 0, u = 0, e = 0, w = 0, f = 0, rx = 0, ry = 0, rz = 0, nx = 0, ny = 1, nz = 0;
      for (let it = 0; it < 4; it++) {
        const qy = oy - lam;
        fr = ((ox - P[a]) * dxs + (qy - P[a + 1]) * dys + (oz - P[a + 2]) * dzs) * inv;
        f = fr < 0 ? 0 : fr > 1 ? 1 : fr;
        const px = P[a] + dxs * f, py = P[a + 1] + dys * f, pz = P[a + 2] + dzs * f;
        rx = R[a] + (R[b] - R[a]) * f; ry = R[a + 1] + (R[b + 1] - R[a + 1]) * f; rz = R[a + 2] + (R[b + 2] - R[a + 2]) * f;
        let l = 1 / Math.hypot(rx, ry, rz); rx *= l; ry *= l; rz *= l;
        nx = N[a] + (N[b] - N[a]) * f; ny = N[a + 1] + (N[b + 1] - N[a + 1]) * f; nz = N[a + 2] + (N[b + 2] - N[a + 2]) * f;
        l = 1 / Math.hypot(nx, ny, nz); nx *= l; ny *= l; nz *= l;
        w = Wd[i] + (Wd[i + 1] - Wd[i]) * f;
        const dx = ox - px, dy = qy - py, dz = oz - pz;
        u = dx * rx + dy * ry + dz * rz;
        const n = dx * nx + dy * ny + dz * nz;
        const t = u / (w * 0.5);
        e = n - BOWL * t * t;
        if (it < 3) lam += e / Math.max(0.35, ny);
      }
      if (fr < -0.002 || fr > 1.002) continue;
      if (u < -w * 0.5 - 0.02 || u > w * 0.5 + 0.02) continue;
      if (e > 0.06 || e < -0.06) continue;
      if (lam < -maxUp || lam > maxDown || lam >= best) continue;
      best = lam;
      out.path = p;
      out.s = (i + f) * p.ds;
      out.u = u;
      out.y = oy - lam;
      out.lam = lam;
      out.width = w;
      const sl = sectionSlope(u, w);
      let hx = nx - rx * sl, hy = ny - ry * sl, hz = nz - rz * sl;
      const hl = 1 / Math.hypot(hx, hy, hz);
      out.nx = hx * hl; out.ny = hy * hl; out.nz = hz * hl;
    }
    return best === Infinity ? null : out;
  }

  /** Normalised race progress [0..1] for a position on a path. */
  progress(path, s) {
    return clamp(path.mainDist(s) / this.mainLength, 0, 1);
  }
}
