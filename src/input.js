/**
 * Input: floating thumb joystick + jump button (Pointer Events, each control tracks its own pointerId so
 * steering and jumping work at the same time), plus keyboard (A/D or arrows, Space). The horizontal
 * stick axis is the only steering signal.
 */
import { clamp } from './game/util.js';

export class Input {
  constructor() {
    this.sensitivity = 1;
    this.joyId = null;
    this.joyRaw = 0;
    this.keySteer = 0;
    this.keyTarget = 0;
    this.keys = new Set();
    this.jumpBuffer = 0;
    this.enabled = false;
    this.onPause = null;
    this.onAnyKey = null;
    this._bindKeys();
  }

  /** Attach the on-screen controls created by the UI. */
  attach({ zone, base, thumb, jumpBtn }) {
    this.zone = zone; this.base = base; this.thumb = thumb; this.jumpBtn = jumpBtn;
    const R = () => this.joyRadius();

    zone.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null || !this.enabled) return;
      e.preventDefault();
      this.joyId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const rect = zone.getBoundingClientRect();
      const r = R();
      this.ox = clamp(e.clientX, rect.left + r + 6, rect.right - r - 6);
      this.oy = clamp(e.clientY, rect.top + r + 6, rect.bottom - r - 6);
      base.style.left = `${this.ox - rect.left}px`;
      base.style.top = `${this.oy - rect.top}px`;
      base.classList.add('active');
      this._move(e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) { e.preventDefault(); this._move(e); }
    });
    const end = (e) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyRaw = 0;
      base.classList.remove('active');
      thumb.style.transform = 'translate(-50%, -50%)';
      base.style.left = '';
      base.style.top = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);

    let jumpId = null;
    jumpBtn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      jumpId = e.pointerId;
      try { jumpBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      jumpBtn.classList.add('pressed');
      this.jumpBuffer = 0.16;
    });
    const jEnd = (e) => {
      if (e.pointerId !== jumpId) return;
      jumpId = null;
      jumpBtn.classList.remove('pressed');
    };
    jumpBtn.addEventListener('pointerup', jEnd);
    jumpBtn.addEventListener('pointercancel', jEnd);
    jumpBtn.addEventListener('lostpointercapture', jEnd);
    for (const el of [zone, jumpBtn]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  joyRadius() {
    return this.base ? this.base.offsetWidth * 0.5 : 60;
  }

  _move(e) {
    const r = this.joyRadius() * 0.92;
    let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
    const len = Math.hypot(dx, dy);
    if (len > r) { dx = (dx / len) * r; dy = (dy / len) * r; }
    this.joyRaw = dx / r;
    this.thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _bindKeys() {
    const steerKeys = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 };
    const block = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    window.addEventListener('keydown', (e) => {
      if (this.enabled && block.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code in steerKeys) this.keys.add(e.code);
      if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') && this.enabled) this.jumpBuffer = 0.16;
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      this.onAnyKey?.(e);
      this.keyTarget = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.keyTarget = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.keyTarget = 0; });
  }

  reset() {
    this.joyRaw = 0; this.keys.clear(); this.keyTarget = 0; this.keySteer = 0; this.jumpBuffer = 0;
    if (this.base) { this.base.classList.remove('active'); this.base.style.left = ''; this.base.style.top = ''; }
    if (this.thumb) this.thumb.style.transform = 'translate(-50%, -50%)';
    this.joyId = null;
  }

  update(dt) {
    // keyboard steering ramps up/down so tapping A/D feels analogue
    const rate = this.keyTarget !== 0 ? 9 : 12;
    this.keySteer += (this.keyTarget - this.keySteer) * Math.min(1, dt * rate);
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
  }

  get steer() {
    let j = this.joyRaw;
    const dz = 0.07;
    j = Math.abs(j) < dz ? 0 : Math.sign(j) * ((Math.abs(j) - dz) / (1 - dz));
    j = Math.sign(j) * Math.pow(Math.abs(j), 1.15);
    const v = Math.abs(j) > 0.001 ? j * this.sensitivity : this.keySteer;
    return clamp(v, -1, 1);
  }

  get jump() { return this.jumpBuffer > 0; }
  clearJump() { this.jumpBuffer = 0; }
}
