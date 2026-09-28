/**
 * Adaptive quality.
 *  - pixel ratio cap: default 1.5 (auto / medium), low = 1.0, high = 2.0
 *  - shadows / post-processing / particles follow the user toggles, but low forces them off
 *  - in "auto" mode a frame-time monitor steps quality down when the device can't hold ~45 fps:
 *      pixel ratio (-0.25 steps to 1.0) -> bloom off -> shadows off -> NPC trails off
 */
export class Quality {
  constructor(store) {
    this.store = store;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.degrade = 0; // adaptive steps taken
    this.prAdjust = 0;
    this.acc = 0;
    this.frames = 0;
    this.cool = 3;
    this.onChange = null;
    this.state = {};
    this.recompute(false);
  }

  get preset() {
    const g = this.store.settings.graphics;
    return g === 'auto' ? 'medium' : g;
  }

  recompute(notify = true) {
    const s = this.store.settings;
    const g = s.graphics;
    const cap = { low: 1.0, medium: 1.5, high: 2.0 }[this.preset];
    let pr = Math.min(this.dpr, cap);
    if (g === 'auto') pr = Math.max(1, Math.min(pr, cap) - this.prAdjust);
    const low = g === 'low';
    const next = {
      pixelRatio: Math.max(1, pr),
      shadows: !!s.shadows && !low && !(g === 'auto' && this.degrade >= 2),
      post: !!s.post && !low && !(g === 'auto' && this.degrade >= 1),
      trail: !!s.trail,
      splash: !!s.splash,
      npcTrails: !low && !(g === 'auto' && this.degrade >= 3),
      shadowMap: g === 'high' ? 2048 : 1024,
      antialias: !low,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    if (changed && notify) this.onChange?.(next);
    return next;
  }

  /** Reset adaptive degradation (e.g. the user picked a preset, or a new race starts). */
  reset() {
    this.degrade = 0;
    this.prAdjust = 0;
    this.cool = 3;
    this.acc = 0;
    this.frames = 0;
    this.recompute();
  }

  /** Call once per rendered frame with the raw frame time in seconds. */
  frame(dt, active) {
    if (this.store.settings.graphics !== 'auto') return;
    if (!active || dt > 0.25 || document.hidden) { this.acc = 0; this.frames = 0; return; }
    this.cool -= dt;
    this.acc += dt;
    this.frames++;
    if (this.frames < 45) return;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (this.cool > 0) return;
    if (avg > 1 / 44) {
      // step down: lower resolution first, then effects
      if (this.state.pixelRatio > 1.01) this.prAdjust += 0.25;
      else if (this.degrade < 3) this.degrade++;
      else return;
      this.cool = 2.5;
      this.recompute();
    }
  }
}
