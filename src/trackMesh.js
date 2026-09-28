import * as THREE from 'three';
import { BOWL, FLAG_RAMP, FLAG_ROUGH } from './game/track.js';

const TOP_T = [-1, -0.86, -0.7, -0.52, -0.34, -0.17, 0, 0.17, 0.34, 0.52, 0.7, 0.86, 1];

/** Closed cross-section ring: [lateral offset, normal offset, kind (0 water,1 rim,2 hull)] */
function profile(hw) {
  const pts = [];
  for (const t of TOP_T) pts.push([t * hw, BOWL * t * t, 0]);
  const e = BOWL;
  pts.push([hw + 0.16, e + 0.3, 1], [hw + 0.44, e + 0.4, 1], [hw + 0.68, e + 0.16, 1]);
  pts.push([hw + 0.74, e - 0.28, 2], [hw * 0.72, -0.72, 2], [hw * 0.26, -0.98, 2]);
  pts.push([-hw * 0.26, -0.98, 2], [-hw * 0.72, -0.72, 2], [-hw - 0.74, e - 0.28, 2]);
  pts.push([-hw - 0.68, e + 0.16, 1], [-hw - 0.44, e + 0.4, 1], [-hw - 0.16, e + 0.3, 1]);
  return pts;
}
const K = profile(4).length;

const _c = new THREE.Color();
const _w = new THREE.Color(1, 1, 1);
const CORAL = new THREE.Color(0xff6f7d);
const HULL = new THREE.Color(0x9fb9d6);
const ORANGE_A = new THREE.Color(1.0, 0.66, 0.12);
const ORANGE_B = new THREE.Color(1.0, 0.86, 0.3);

export function buildPathGeometry(path) {
  const n = path.n;
  const nv = n * K;
  const pos = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = [];
  const P = path.pos, R = path.right, N = path.up;

  for (let i = 0; i < n; i++) {
    const hw = path.width[i] * 0.5;
    const prof = profile(hw);
    const s = i * path.ds;
    const flags = path.flags[i];
    const hue = path.hue[i];
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    const rx = R[i * 3], ry = R[i * 3 + 1], rz = R[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    for (let k = 0; k < K; k++) {
      const [du, dn, kind] = prof[k];
      const v = i * K + k;
      pos[v * 3] = px + rx * du + nx * dn;
      pos[v * 3 + 1] = py + ry * du + ny * dn;
      pos[v * 3 + 2] = pz + rz * du + nz * dn;
      if (kind === 0) {
        const t = du / hw;
        _c.setHSL(hue, 0.82, 0.55 + 0.05 * (1 - t * t) - 0.04 * t * t);
        if (flags & FLAG_RAMP) {
          _c.copy(Math.floor(s / 2.4) % 2 ? ORANGE_A : ORANGE_B);
        } else if (flags & FLAG_ROUGH) {
          const foam = 0.5 + 0.5 * Math.sin(s * 1.9 + du * 2.3) * Math.cos(s * 0.7 - du * 1.3);
          _c.lerp(_w, 0.25 + foam * 0.55);
        } else if (Math.abs(t) < 0.035 && Math.floor(s / 4) % 2 === 0) {
          _c.lerp(_w, 0.55);
        }
        uv[v * 2] = s / 9;
        uv[v * 2 + 1] = ((t + 1) * 0.5) * 0.45;
      } else if (kind === 1) {
        _c.copy(Math.floor(s / 5) % 2 ? CORAL : _w);
        uv[v * 2] = s / 9;
        uv[v * 2 + 1] = 0.75;
      } else {
        _c.copy(HULL).multiplyScalar(0.72 + 0.28 * Math.min(1, (dn + 1) / 1.2));
        uv[v * 2] = s / 9;
        uv[v * 2 + 1] = 0.75;
      }
      col[v * 3] = _c.r; col[v * 3 + 1] = _c.g; col[v * 3 + 2] = _c.b;
    }
  }

  const solid = (i) => i >= 0 && i < n - 1 && !path.gap[i];
  for (let i = 0; i < n - 1; i++) {
    if (!solid(i)) continue;
    for (let k = 0; k < K; k++) {
      const a = i * K + k, b = i * K + ((k + 1) % K), c = (i + 1) * K + ((k + 1) % K), d = (i + 1) * K + k;
      idx.push(a, b, c, a, c, d);
    }
  }

  // smooth normals for the body
  const nor = new Float32Array(nv * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { nor[o] += fx; nor[o + 1] += fy; nor[o + 2] += fz; }
  }
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) || 1;
    nor[v * 3] /= l; nor[v * 3 + 1] /= l; nor[v * 3 + 2] /= l;
  }

  // end caps (start of the path, both sides of every gap, end of the path)
  const capPos = [], capNor = [], capCol = [], capUv = [], capIdx = [];
  let base = nv;
  const addCap = (i, dir) => {
    const cx = P[i * 3] + N[i * 3] * -0.45, cy = P[i * 3 + 1] + N[i * 3 + 1] * -0.45, cz = P[i * 3 + 2] + N[i * 3 + 2] * -0.45;
    const tx = path.tan[i * 3] * dir, ty = path.tan[i * 3 + 1] * dir, tz = path.tan[i * 3 + 2] * dir;
    const first = base;
    for (let k = 0; k < K; k++) {
      const v = i * K + k;
      capPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      capNor.push(tx, ty, tz);
      capCol.push(0.85, 0.9, 0.96);
      capUv.push(0, 0.75);
    }
    capPos.push(cx, cy, cz); capNor.push(tx, ty, tz); capCol.push(0.85, 0.9, 0.96); capUv.push(0, 0.75);
    const center = first + K;
    for (let k = 0; k < K; k++) {
      const a = first + k, b = first + ((k + 1) % K);
      // choose winding so the geometric normal faces `dir`
      const ax = capPos[(a - nv) * 3], ay = capPos[(a - nv) * 3 + 1], az = capPos[(a - nv) * 3 + 2];
      const bx = capPos[(b - nv) * 3], by = capPos[(b - nv) * 3 + 1], bz = capPos[(b - nv) * 3 + 2];
      const ox = capPos[(center - nv) * 3], oy = capPos[(center - nv) * 3 + 1], oz = capPos[(center - nv) * 3 + 2];
      const ux = ax - ox, uy = ay - oy, uz = az - oz, vx = bx - ox, vy = by - oy, vz = bz - oz;
      const nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
      if (nxx * tx + nyy * ty + nzz * tz >= 0) capIdx.push(center, a, b);
      else capIdx.push(center, b, a);
    }
    base += K + 1;
  };
  for (let i = 0; i < n; i++) {
    const startsRun = solid(i) && !solid(i - 1);
    const endsRun = solid(i - 1) && !solid(i);
    if (startsRun) addCap(i, -1);
    if (endsRun) addCap(i, 1);
  }

  const geo = new THREE.BufferGeometry();
  const fullPos = new Float32Array(pos.length + capPos.length);
  fullPos.set(pos); fullPos.set(capPos, pos.length);
  const fullNor = new Float32Array(nor.length + capNor.length);
  fullNor.set(nor); fullNor.set(capNor, nor.length);
  const fullCol = new Float32Array(col.length + capCol.length);
  fullCol.set(col); fullCol.set(capCol, col.length);
  const fullUv = new Float32Array(uv.length + capUv.length);
  fullUv.set(uv); fullUv.set(capUv, uv.length);
  geo.setAttribute('position', new THREE.BufferAttribute(fullPos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(fullNor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(fullCol, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(fullUv, 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array([...idx, ...capIdx]), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function makeWaterTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f6fa';
  g.fillRect(0, 0, 256, 256);
  // top-surface region is v in [0, .45] (lower part of the canvas in texture space = flipped Y)
  for (let i = 0; i < 46; i++) {
    const y = 256 - Math.random() * 0.45 * 256;
    const amp = 1 + Math.random() * 3;
    const ph = Math.random() * 6.28;
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(150,190,235,0.16)';
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) {
      const yy = y + Math.sin((x / 256) * Math.PI * 2 * 2 + ph) * amp;
      x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

export function createTrackMeshes(track, renderer) {
  const waterTex = makeWaterTexture(renderer);
  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    map: waterTex,
    shininess: 90,
    specular: new THREE.Color(0x8fb8ff),
    emissive: new THREE.Color(0x0b1a30),
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  const meshes = [];
  for (const path of track.paths) {
    const mesh = new THREE.Mesh(buildPathGeometry(path), mat);
    mesh.name = `slide-${path.id}`;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    meshes.push(mesh);
  }
  return { group, material: mat, waterTex, meshes };
}
