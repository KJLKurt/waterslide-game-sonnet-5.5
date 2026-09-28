import * as THREE from 'three';
import { makeRng } from './game/util.js';
import { sectionHeight } from './game/track.js';

const FOG_COLOR = 0xcdeeff;

function gradientTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([t, col]) => grad.addColorStop(t, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bannerTexture(text, bg, fg, checker = false) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  if (checker) {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16 + (y ? 96 : 0), 16, 16);
    }
  }
  g.fillStyle = fg;
  g.font = '900 68px "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#101820' : '#ffffff';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function seaTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const rng = makeRng(7);
  for (let i = 0; i < 90; i++) {
    const x = rng() * 128, y = rng() * 128, w = 6 + rng() * 14;
    g.strokeStyle = `rgba(120,200,235,${0.15 + rng() * 0.25})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x - w, y); g.quadraticCurveTo(x, y - 3, x + w, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(220, 220);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Frame-aligned flat strip (used for start/finish line decals). */
function lineDecal(path, s0, len, tex) {
  const steps = Math.max(2, Math.round(len / path.ds));
  const pos = [], uv = [], idx = [];
  const f = path.frame(0);
  for (let i = 0; i <= steps; i++) {
    path.frame(s0 + (i * len) / steps, f);
    const hw = f.width * 0.5;
    for (const side of [-1, 1]) {
      const u = side * hw;
      const h = sectionHeight(u, f.width) + 0.05;
      pos.push(f.px + f.rx * u + f.nx * h, f.py + f.ry * u + f.ny * h, f.pz + f.rz * u + f.nz * h);
      uv.push(side < 0 ? 0 : hw / 1.5, i / steps);
    }
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return new THREE.Mesh(geo, mat);
}

function archAt(path, s, textures, label, bg, fg) {
  const f = path.frame(s);
  const hw = f.width * 0.5 + 0.9;
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const postGeo = new THREE.CylinderGeometry(0.28, 0.34, 8, 10);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * hw, 4, 0);
    g.add(post);
  }
  const tex = bannerTexture(label, bg, fg, label === 'FINISH');
  textures.push(tex);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hw * 0.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  banner.position.set(0, 8.2, 0);
  banner.rotation.y = Math.PI; // face the riders coming from behind
  g.add(banner);
  // orient: local x = right, y = up, z = forward
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.rx, f.ry, f.rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.tx, 0, f.tz).normalize());
  g.setRotationFromMatrix(m);
  g.position.set(f.px, f.py, f.pz);
  return g;
}

function signAt(path, s, side, text, bg, textures) {
  const f = path.frame(s);
  const off = f.width * 0.5 + 1.6;
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  post.position.set(0, 2.5, 0);
  g.add(post);
  const tex = bannerTexture(text, bg, '#ffffff');
  textures.push(tex);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.set(0, 5.4, 0);
  board.rotation.y = Math.PI;
  g.add(board);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.rx, f.ry, f.rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.tx, 0, f.tz).normalize());
  g.setRotationFromMatrix(m);
  g.position.set(f.px + f.rx * off * side, f.py + f.ry * off * side, f.pz + f.rz * off * side);
  return g;
}

export function createWorld(scene, track, quality) {
  const rng = makeRng(2024);
  const textures = [];
  const root = new THREE.Group();
  scene.add(root);

  // ---- sky, fog, lights
  const sky = gradientTexture([[0, '#3b8cff'], [0.45, '#78c6ff'], [0.75, '#c4ecff'], [1, '#eafaff']]);
  textures.push(sky);
  scene.background = sky;
  scene.fog = new THREE.Fog(FOG_COLOR, 90, 560);

  const hemi = new THREE.HemisphereLight(0xe4f4ff, 0x4fb0c8, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
  sun.position.set(-60, 120, 40);
  sun.castShadow = false;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 320;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  // ---- centroid & extents of the course
  let cx = 0, cz = 0, cnt = 0;
  const samples = [];
  for (const p of track.paths) {
    for (let i = 0; i < p.n; i += 4) {
      const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
      samples.push([x, y, z]);
      cx += x; cz += z; cnt++;
    }
  }
  cx /= cnt; cz /= cnt;
  const seaY = track.seaY;
  const nearTrack = (x, y, z, r) => samples.some(([sx, sy, sz]) => (sx - x) ** 2 + (sy - y) ** 2 + (sz - z) ** 2 < r * r);
  const nearTrackXZ = (x, z, r) => samples.some(([sx, , sz]) => (sx - x) ** 2 + (sz - z) ** 2 < r * r);

  // ---- sea
  const seaTex = seaTexture();
  textures.push(seaTex);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshLambertMaterial({ color: 0x3fc8e0, map: seaTex }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(cx, seaY, cz);
  root.add(sea);

  // ---- islands + palms (instanced)
  const islandCount = 30;
  const islandGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const islandMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const islands = new THREE.InstancedMesh(islandGeo, islandMat, islandCount);
  const sand = new THREE.Color(0xf6dc9b), grass = new THREE.Color(0x63c76b), rock = new THREE.Color(0x9aa7b5);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const palmSpots = [];
  let placed = 0;
  for (let tries = 0; placed < islandCount && tries < 600; tries++) {
    const ang = rng() * Math.PI * 2;
    const dist = 90 + rng() * 950;
    const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
    const rxz = 14 + rng() * 55, ry = 4 + rng() * 22;
    if (nearTrackXZ(x, z, rxz + 42)) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    m4.compose(v3.set(x, seaY - 1.5, z), q, s3.set(rxz, ry, rxz * (0.7 + rng() * 0.5)));
    islands.setMatrixAt(placed, m4);
    islands.setColorAt(placed, ry > 16 ? rock : rng() < 0.5 ? sand : grass);
    if (ry < 16) for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
      const a = rng() * 6.28, d = rng() * rxz * 0.55;
      palmSpots.push([x + Math.cos(a) * d, seaY - 1.5 + ry * (1 - (d / rxz) ** 2 * 0.9) * 0.9, z + Math.sin(a) * d]);
    }
    placed++;
  }
  islands.count = placed;
  islands.instanceMatrix.needsUpdate = true;
  if (islands.instanceColor) islands.instanceColor.needsUpdate = true;
  root.add(islands);

  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 7, 6);
  trunkGeo.translate(0, 3.5, 0);
  const crownGeo = new THREE.ConeGeometry(3.6, 2.2, 7);
  crownGeo.translate(0, 8.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x9a6a3a }), palmSpots.length || 1);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x2fae5a, flatShading: true }), palmSpots.length || 1);
  palmSpots.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    const sc2 = 0.8 + rng() * 0.7;
    m4.compose(v3.set(p[0], p[1], p[2]), q, s3.set(sc2, sc2, sc2));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
  });
  trunks.count = crowns.count = palmSpots.length;
  root.add(trunks, crowns);

  // ---- clouds
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);
  const puffs = new THREE.InstancedMesh(puffGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xa9bfd8, flatShading: true }), 150);
  let pc = 0;
  for (let tries = 0; pc < 140 && tries < 400; tries++) {
    const ang = rng() * 6.28, dist = 40 + rng() * 800;
    const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
    const y = seaY + 30 + rng() * (track.maxY - seaY + 60);
    if (nearTrack(x, y, z, 55)) continue;
    const size = 9 + rng() * 14;
    const n = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < n && pc < 150; k++) {
      m4.compose(
        v3.set(x + (k - n / 2) * size * 0.9, y + (rng() - 0.5) * size * 0.3, z + (rng() - 0.5) * size * 0.5),
        q.identity(),
        s3.set(size * (0.7 + rng() * 0.5), size * 0.5, size * 0.7),
      );
      puffs.setMatrixAt(pc++, m4);
    }
  }
  puffs.count = pc;
  root.add(puffs);

  // ---- support pillars (skipped where another slide is underneath)
  const pillarGeo = new THREE.CylinderGeometry(0.6, 0.75, 1, 10);
  pillarGeo.translate(0, -0.5, 0);
  const pillarList = [];
  const f = track.T.frame(0);
  for (const path of track.paths) {
    const step = path.id === 'S' ? 20 : 22;
    for (let s = 6; s < path.length - 3; s += step) {
      if (path.isGapAt(s) || path.isGapAt(s + 2) || path.isGapAt(s - 2)) continue;
      path.frame(s, f);
      const topY = f.py - 0.95;
      // anything under the pillar? then don't drop a pillar through it
      const hit = track.raycastDown(f.px, topY - 0.5, f.pz, topY - seaY + 20, 0.2);
      if (hit) continue;
      pillarList.push([f.px, topY, f.pz, topY - seaY]);
    }
  }
  const pillars = new THREE.InstancedMesh(pillarGeo, new THREE.MeshLambertMaterial({ color: 0xf3f7fb }), Math.max(1, pillarList.length));
  pillarList.forEach((p, i) => {
    m4.compose(v3.set(p[0], p[1], p[2]), q.identity(), s3.set(1, p[3], 1));
    pillars.setMatrixAt(i, m4);
  });
  pillars.count = pillarList.length;
  root.add(pillars);

  // ---- gates, signs, lines
  const T = track.T, M = track.M, S = track.S;
  const startS = 24;
  const gates = new THREE.Group();
  gates.add(archAt(T, startS + 1, textures, 'START', '#1e88ff', '#ffffff'));
  gates.add(archAt(M, M.finishS, textures, 'FINISH', '#ffffff', '#101820'));
  gates.add(signAt(T, T.length - 34, -1, 'SHORTCUT: JUMP!', '#ff7a1a', textures));
  gates.add(signAt(T, T.length - 34, 1, 'MAIN ROUTE', '#1e88ff', textures));
  root.add(gates);
  const ctex = checkerTexture();
  textures.push(ctex);
  root.add(lineDecal(T, startS, 1.6, ctex));
  root.add(lineDecal(M, M.finishS, 1.6, ctex));

  // splash pool at the end of the run-out
  const poolEnd = M.frame(M.length);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(20, 32),
    new THREE.MeshLambertMaterial({ color: 0x4fd8f0, transparent: true, opacity: 0.85 }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(poolEnd.px + poolEnd.tx * 12, poolEnd.py - 0.6, poolEnd.pz + poolEnd.tz * 12);
  root.add(pool);

  return {
    root, sun, hemi, sea, seaTex, textures,
    update(dt, focus) {
      seaTex.offset.x += dt * 0.004;
      seaTex.offset.y += dt * 0.002;
      if (focus) {
        sun.position.set(focus.x - 70, focus.y + 110, focus.z + 45);
        sun.target.position.set(focus.x, focus.y, focus.z);
        sun.target.updateMatrixWorld();
      }
    },
  };
}
