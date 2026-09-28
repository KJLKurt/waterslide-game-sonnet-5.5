import * as THREE from 'three';
import { clamp, damp } from './game/util.js';
import { State } from './game/racer.js';

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Smooth chase camera with look-ahead. Distance / height / FOV adapt to portrait vs landscape and to speed.
 * Also provides menu-orbit and countdown fly-in modes.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.fov = 60;
    this.shake = 0;
    this.orbit = 0;
    this.aspect = 1;
    this.snap = true;
    this.viewShift = { x: 0, y: 0, tx: 0, ty: 0 };
    this.lastTarget = new THREE.Vector3();
  }

  setAspect(a) { this.aspect = a; }

  /** Camera framing parameters for the current aspect ratio. */
  params(speed01) {
    const portrait = this.aspect < 0.85;
    const wide = this.aspect > 1.9;
    return {
      dist: (portrait ? 8.6 : wide ? 8.0 : 8.2) + speed01 * 2.2,
      height: portrait ? 4.5 : 4.5,
      ahead: portrait ? 13 : 12,
      fov: (portrait ? 63 : wide ? 50 : 54) + speed01 * 7,
      lookUp: 1.0,
    };
  }

  jolt(a) { this.shake = Math.max(this.shake, a); }

  chase(dt, r, time) {
    const speed01 = clamp(r.speed / 30, 0, 1);
    const p = this.params(speed01);
    if (r.state === State.FALLING || r.state === State.OUT) {
      // stop following; watch the racer drop away
      _look.set(r.x, r.y, r.z);
      this.look.lerp(_look, 1 - Math.exp(-dt * 4));
      this.place(dt, p);
      return;
    }
    _v.set(r.fx, r.fy * 0.6, r.fz);
    if (r.state === State.AIRBORNE) _v.set(r.vx, 0, r.vz);
    if (_v.lengthSq() < 1e-5) _v.set(0, 0, 1);
    _v.normalize();
    if (this.snap) this.fwd.copy(_v);
    this.fwd.lerp(_v, 1 - Math.exp(-dt * 3.4)).normalize();

    // banked "up": follow the surface a little for a lively feel in turns
    _up.set(r.nx, r.ny, r.nz);
    if (r.state === State.AIRBORNE) _up.lerp(WORLD_UP, 0.7);
    this.up.lerp(_up.lerp(WORLD_UP, 0.72), 1 - Math.exp(-dt * 4)).normalize();

    const dist = p.dist, h = p.height;
    const dx = r.x - this.fwd.x * dist, dz = r.z - this.fwd.z * dist;
    let dy = r.y - this.fwd.y * dist + h;
    if (this.snap) this.pos.set(dx, dy, dz);
    // horizontal follows tightly, vertical a bit softer (calmer on jumps)
    this.pos.x = damp(this.pos.x, dx, 7.5, dt);
    this.pos.z = damp(this.pos.z, dz, 7.5, dt);
    this.pos.y = damp(this.pos.y, dy, r.state === State.AIRBORNE ? 3.2 : 6.5, dt);

    _look.set(r.x + this.fwd.x * p.ahead, r.y + this.fwd.y * p.ahead + p.lookUp, r.z + this.fwd.z * p.ahead);
    if (this.snap) this.look.copy(_look);
    this.look.x = damp(this.look.x, _look.x, 9, dt);
    this.look.y = damp(this.look.y, _look.y, 6, dt);
    this.look.z = damp(this.look.z, _look.z, 9, dt);
    this.snap = false;
    this.place(dt, p);
    this.lastTarget.set(r.x, r.y, r.z);
  }

  place(dt, p) {
    const cam = this.camera;
    this.fov = damp(this.fov, p.fov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.35;
    }
    cam.up.copy(this.up);
    cam.lookAt(this.look);
  }

  /** Slow orbit around a point (menu / spectate). */
  orbitAround(dt, target, radius, height, speed = 0.35, lookYOffset = 0.9) {
    this.orbit += dt * speed;
    const px = target.x + Math.sin(this.orbit) * radius;
    const pz = target.z + Math.cos(this.orbit) * radius;
    const py = target.y + height;
    if (this.snap) { this.pos.set(px, py, pz); }
    this.pos.x = damp(this.pos.x, px, 4, dt);
    this.pos.y = damp(this.pos.y, py, 4, dt);
    this.pos.z = damp(this.pos.z, pz, 4, dt);
    this.look.set(target.x, target.y + lookYOffset, target.z);
    this.up.set(0, 1, 0);
    this.snap = false;
    const p = { fov: this.aspect < 0.85 ? 42 : 34 };
    this.place(dt, p);
  }

  /** Countdown fly-in: ease from an elevated front view to the chase view. `k` goes 0 -> 1. */
  flyIn(dt, r, k, time) {
    this.chase(dt, r, time);
    const e = 1 - Math.pow(1 - clamp(k, 0, 1), 3);
    const c = this.camera;
    c.position.y += (1 - e) * 5;
    c.position.x += Math.sin(time * 0.4) * (1 - e) * 4;
    c.lookAt(this.look);
  }

  /** Off-centre framing so the menu card and the character don't overlap. */
  applyViewOffset(w, h, dt) {
    const v = this.viewShift;
    v.x = damp(v.x, v.tx, 5, dt);
    v.y = damp(v.y, v.ty, 5, dt);
    if (Math.abs(v.x) < 0.5 && Math.abs(v.y) < 0.5 && !this.camera.view) return;
    if (Math.abs(v.x) < 0.5 && Math.abs(v.y) < 0.5) { this.camera.clearViewOffset(); return; }
    this.camera.setViewOffset(w, h, v.x, v.y, w, h);
  }
}
