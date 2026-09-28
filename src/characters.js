/**
 * Procedural cartoon humanoids built from primitives (capsules, spheres, tori, cylinders).
 * All racers share ONE geometry + material per body part; every part type is a single InstancedMesh
 * (per-instance colour), so 13 people cost ~12 draw calls. Poses are computed on the CPU each frame.
 */
import * as THREE from 'three';
import { PALETTES, NPC_LOOKS, NPC_ACCENTS } from './cosmetics.js';
import { State } from './game/racer.js';
import { clamp, damp } from './game/util.js';

const CS = 1.18; // character scale

function toonGradient() {
  const data = new Uint8Array([120, 185, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _y = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _body = new THREE.Matrix4();
const _root = new THREE.Matrix4();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _color = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function makeNpcLook(index, accessory) {
  const l = NPC_LOOKS[index % NPC_LOOKS.length];
  return { ...l, accent: NPC_ACCENTS[(index * 5 + 1) % NPC_ACCENTS.length], accessory };
}

export function makePlayerLook(paletteIndex, accessory) {
  const p = PALETTES[paletteIndex] || PALETTES[0];
  return { shirt: p.shirt, shorts: p.shorts, skin: p.skin, hair: p.hair, accent: p.accent, accessory };
}

export class CharacterPool {
  constructor(scene, capacity = 13) {
    this.capacity = capacity;
    this.looks = new Array(capacity).fill(null);
    this.anim = Array.from({ length: capacity }, (_, i) => ({
      lean: 0, air: 0, phase: i * 1.7, up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1), ready: false, tumble: 0,
    }));

    const gradient = toonGradient();
    this.material = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient });
    const shiny = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, emissive: 0x111111 });

    const geo = {
      torso: new THREE.CapsuleGeometry(0.27, 0.34, 4, 10),
      head: new THREE.SphereGeometry(0.25, 14, 10),
      arm: new THREE.CapsuleGeometry(0.08, 0.42, 3, 6),
      leg: new THREE.CapsuleGeometry(0.125, 0.5, 3, 8),
      hair: new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
      eye: new THREE.SphereGeometry(0.036, 6, 5),
      strap: new THREE.TorusGeometry(0.256, 0.03, 5, 14),
      lens: new THREE.SphereGeometry(0.085, 8, 6),
      ring: new THREE.TorusGeometry(0.46, 0.15, 8, 18),
      capDome: new THREE.SphereGeometry(0.29, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      capBrim: new THREE.CylinderGeometry(0.2, 0.2, 0.035, 12),
      blob: new THREE.CircleGeometry(0.9, 16),
    };
    geo.blob.rotateX(-Math.PI / 2);

    const defs = {
      torso: [geo.torso, capacity, this.material],
      head: [geo.head, capacity, this.material],
      arm: [geo.arm, capacity * 2, this.material],
      leg: [geo.leg, capacity * 2, this.material],
      hair: [geo.hair, capacity, this.material],
      eye: [geo.eye, capacity * 2, this.material],
      strap: [geo.strap, capacity, shiny],
      lens: [geo.lens, capacity * 2, shiny],
      ring: [geo.ring, capacity, shiny],
      capDome: [geo.capDome, capacity, shiny],
      capBrim: [geo.capBrim, capacity, shiny],
    };
    this.parts = {};
    for (const [name, [g, cap, mat]] of Object.entries(defs)) {
      const mesh = new THREE.InstancedMesh(g, mat, cap);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.name = `char-${name}`;
      scene.add(mesh);
      this.parts[name] = mesh;
    }
    this.blob = new THREE.InstancedMesh(
      geo.blob,
      new THREE.MeshBasicMaterial({ color: 0x0b2a44, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      capacity,
    );
    this.blob.frustumCulled = false;
    this.blob.count = capacity;
    scene.add(this.blob);
    this.slot = {}; // per part: array of instance indices per racer
    this.blobsVisible = true;
    this.solo = null; // when set, only this racer index is drawn (character preview)
  }

  setBlobShadows(on) {
    this.blobsVisible = on;
    this.blob.visible = on;
  }

  setShadowCasting(on) {
    for (const m of Object.values(this.parts)) m.castShadow = on;
  }

  setLook(i, look) {
    this.looks[i] = look;
    this.rebuild();
  }

  /** Assign instance slots + colours. Called when looks change (rare). */
  rebuild() {
    const counts = {};
    const P = this.parts;
    for (const k of Object.keys(P)) counts[k] = 0;
    this.slot = {};
    const alloc = (name, i, n = 1) => {
      const list = (this.slot[name] ||= []);
      list[i] = counts[name];
      counts[name] += n;
    };
    this.looks.forEach((look, i) => {
      if (!look) return;
      for (const name of ['torso', 'head', 'arm', 'leg', 'eye']) alloc(name, i, name === 'arm' || name === 'leg' || name === 'eye' ? 2 : 1);
      if (look.accessory !== 3) alloc('hair', i);
      if (look.accessory === 1) { alloc('strap', i); alloc('lens', i, 2); }
      if (look.accessory === 2) alloc('ring', i);
      if (look.accessory === 3) { alloc('capDome', i); alloc('capBrim', i); }
    });
    for (const [name, mesh] of Object.entries(P)) mesh.count = counts[name];
    const setC = (name, idx, hex) => {
      _color.setHex(hex);
      P[name].setColorAt(idx, _color);
    };
    this.looks.forEach((look, i) => {
      if (!look) return;
      setC('torso', this.slot.torso[i], look.shirt);
      setC('head', this.slot.head[i], look.skin);
      for (let k = 0; k < 2; k++) {
        setC('arm', this.slot.arm[i] + k, look.skin);
        setC('leg', this.slot.leg[i] + k, look.shorts);
        setC('eye', this.slot.eye[i] + k, 0x1b2230);
      }
      if (this.slot.hair?.[i] != null) setC('hair', this.slot.hair[i], look.hair);
      if (this.slot.strap?.[i] != null) { setC('strap', this.slot.strap[i], look.accent); for (let k = 0; k < 2; k++) setC('lens', this.slot.lens[i] + k, 0x7fe9ff); }
      if (this.slot.ring?.[i] != null) setC('ring', this.slot.ring[i], look.accent);
      if (this.slot.capDome?.[i] != null) { setC('capDome', this.slot.capDome[i], look.accent); setC('capBrim', this.slot.capBrim[i], look.accent); }
    });
    for (const mesh of Object.values(P)) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  _put(name, idx, px, py, pz, quat, sx, sy, sz) {
    _m.compose(_v.set(px, py, pz), quat, _s.set(sx, sy, sz));
    _m.premultiply(_body);
    this.parts[name].setMatrixAt(idx, _m);
  }

  _hide(i) {
    for (const [name, list] of Object.entries(this.slot)) {
      const base = list[i];
      if (base == null) continue;
      const n = name === 'arm' || name === 'leg' || name === 'eye' || name === 'lens' ? 2 : 1;
      for (let k = 0; k < n; k++) this.parts[name].setMatrixAt(base + k, ZERO);
    }
    this.blob.setMatrixAt(i, ZERO);
  }

  /**
   * Pose racer i. `ground` = { x,y,z,nx,ny,nz,h } (surface under the racer) for the blob shadow.
   */
  pose(i, r, dt, time, ground) {
    const look = this.looks[i];
    if (!look) return;
    if (r.state === State.OUT || (this.solo != null && i !== this.solo) || (r.invuln > 0 && Math.floor(time * 14) % 2 === 0)) {
      this._hide(i);
      return;
    }
    const a = this.anim[i];
    const speed01 = clamp(r.speed / 28, 0, 1);
    const airTarget = r.state === State.AIRBORNE ? 1 : r.state === State.FALLING ? 1 : 0;
    a.air = damp(a.air, airTarget, 14, dt);

    // orientation basis: forward from the racer, up from the surface (blended to world-up in the air)
    _f.set(r.fx, r.fy, r.fz);
    if (r.state === State.FALLING) _f.set(r.vx, 0, r.vz);
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
    _f.normalize();
    _u.set(r.nx, r.ny, r.nz);
    if (r.state === State.AIRBORNE) _u.lerp(_y, 0.7).normalize();
    if (r.state === State.FALLING) _u.copy(_y);
    if (!a.ready) { a.up.copy(_u); a.fwd.copy(_f); a.ready = true; }
    const k = 1 - Math.exp(-dt * 16);
    a.up.lerp(_u, k).normalize();
    a.fwd.lerp(_f, 1 - Math.exp(-dt * 20)).normalize();
    _r.crossVectors(a.fwd, a.up).normalize();
    _u.crossVectors(_r, a.fwd).normalize();
    _f.crossVectors(_u, _r).normalize();
    _root.makeBasis(_r, _u, _f).setPosition(r.x, r.y, r.z);

    // animation parameters
    const leanTarget = clamp(-(r.steer * 0.28 + r.uVel * 0.022), -0.55, 0.55);
    a.lean = damp(a.lean, leanTarget, 9, dt);
    let roll = a.lean;
    let pitch = a.air * -clamp(r.vy * 0.028, -0.7, 0.7);
    let twist = clamp(r.uVel * 0.02, -0.3, 0.3);
    const bob = r.state === State.SLIDING ? Math.sin(time * 11 + a.phase) * 0.025 * speed01 - r.landed * 0.1 : 0;
    if (r.state === State.FALLING) {
      a.tumble += dt * 7;
      pitch = a.tumble * 1.2;
      roll = a.tumble * 0.8 * (r.fellSide || 1);
    } else a.tumble = 0;
    if (r.bump > 0) roll += Math.sin(time * 40) * 0.12 * r.bump;

    _e.set(pitch, twist, roll, 'ZXY');
    _q.setFromEuler(_e);
    _m.compose(_v.set(0, bob + (r.state === State.FALLING ? 0.4 : 0), 0), _q, _s.set(CS, CS, CS));
    _body.multiplyMatrices(_root, _m);

    const finished = r.state === State.FINISHED;
    const wobble = Math.sin(time * 7.5 + a.phase) * (0.45 + 0.55 * speed01); // idle riders still wave a little
    const air = a.air;
    // ---- torso & head
    _q.setFromEuler(_e.set(-0.32 + 0.25 * air, 0, 0));
    this._put('torso', this.slot.torso[i], 0, 0.56, -0.1, _q, 1, 1, 1);
    _q.identity();
    const headY = 1.17, headZ = -0.26 + 0.05 * air;
    this._put('head', this.slot.head[i], 0, headY + bob * 0.5, headZ, _q, 1, 1, 1);
    for (let s = -1; s <= 1; s += 2) {
      this._put('eye', this.slot.eye[i] + (s < 0 ? 0 : 1), s * 0.095, headY + 0.035, headZ + 0.225, _q, 1, 1.1, 0.7);
    }
    // ---- limbs (aim capsule Y axis along a direction)
    const armBase = 1.0 + wobble * 0.13 * speed01 + (finished ? 1.1 + wobble * 0.3 : 0) + air * 1.3;
    for (let s = -1; s <= 1; s += 2) {
      const ang = armBase + (s < 0 ? -1 : 1) * a.lean * 0.9;
      _dir.set(s * Math.sin(ang), Math.cos(ang), 0.35 - air * 0.25).normalize();
      _q.setFromUnitVectors(_y, _dir);
      this._put('arm', this.slot.arm[i] + (s < 0 ? 0 : 1), s * 0.3 + _dir.x * 0.29, 0.82 + _dir.y * 0.29, -0.16 + _dir.z * 0.29, _q, 1, 1, 1);
      const tuck = 0.16 + air * 0.6 + (s < 0 ? 1 : -1) * a.lean * 0.05;
      _dir.set(s * 0.06, Math.sin(tuck), Math.cos(tuck)).normalize();
      _q.setFromUnitVectors(_y, _dir);
      const lz = 0.05 + _dir.z * 0.375 - air * 0.06;
      this._put('leg', this.slot.leg[i] + (s < 0 ? 0 : 1), s * 0.16, 0.2 + _dir.y * 0.375, lz, _q, 1, 1, 1);
    }
    // ---- accessories
    _q.setFromEuler(_e.set(-0.4, 0, 0));
    if (this.slot.hair?.[i] != null) this._put('hair', this.slot.hair[i], 0, headY + 0.01, headZ - 0.005, _q, 1.06, 1.06, 1.06);
    if (this.slot.strap?.[i] != null) {
      _q.setFromEuler(_e.set(Math.PI / 2 - 0.15, 0, 0));
      this._put('strap', this.slot.strap[i], 0, headY + 0.06, headZ, _q, 1, 1, 1);
      _q.identity();
      for (let s = -1; s <= 1; s += 2) this._put('lens', this.slot.lens[i] + (s < 0 ? 0 : 1), s * 0.105, headY + 0.07, headZ + 0.215, _q, 1, 0.85, 0.55);
    }
    if (this.slot.ring?.[i] != null) {
      _q.setFromEuler(_e.set(Math.PI / 2, 0, 0));
      this._put('ring', this.slot.ring[i], 0, 0.2, -0.12, _q, 1, 1, 1);
    }
    if (this.slot.capDome?.[i] != null) {
      _q.setFromEuler(_e.set(-0.18, 0, 0));
      this._put('capDome', this.slot.capDome[i], 0, headY + 0.03, headZ, _q, 1, 1, 1);
      _q.setFromEuler(_e.set(0.2, 0, 0));
      this._put('capBrim', this.slot.capBrim[i], 0, headY + 0.1, headZ + 0.27, _q, 1, 1, 1.1);
    }

    // ---- blob shadow
    if (this.blobsVisible && ground) {
      const sc = clamp(1 - ground.h / 14, 0.3, 1) * 1.05;
      _u.set(ground.nx, ground.ny, ground.nz);
      _f.set(r.fx, 0, r.fz);
      if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1);
      _r.crossVectors(_f, _u).normalize();
      _f.crossVectors(_u, _r);
      _m.makeBasis(_r, _u, _f).setPosition(ground.x + ground.nx * 0.06, ground.y + ground.ny * 0.06, ground.z + ground.nz * 0.06);
      _m.scale(_s.set(sc, sc, sc * 1.2));
      this.blob.setMatrixAt(i, _m);
    } else this.blob.setMatrixAt(i, ZERO);
  }

  commit() {
    for (const mesh of Object.values(this.parts)) mesh.instanceMatrix.needsUpdate = true;
    this.blob.instanceMatrix.needsUpdate = true;
  }
}
