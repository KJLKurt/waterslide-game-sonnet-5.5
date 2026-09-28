/**
 * Race manager: owns the racers, steps them on a stable sub-stepped timeline, resolves soft racer
 * collisions, checkpoints, finishing, and the live ranking (progress based, speed as tie-break).
 */
import { Racer, State, stepRacer } from './racer.js';
import { AIDriver, makePersonalities } from './ai.js';
import { makeRng } from './util.js';

export const RACER_COUNT = 13;
const SUBSTEP = 1 / 60;

export class Race {
  constructor(track, opts = {}) {
    this.track = track;
    this.practice = !!opts.practice;
    this.difficulty = opts.difficulty || 'normal';
    this.seed = opts.seed ?? (Math.random() * 1e9) | 0;
    this.playerBot = !!opts.playerBot;
    this.rng = makeRng(this.seed);
    this.phase = 'countdown'; // 'countdown' | 'racing'
    this.time = 0;
    this.finishCount = 0;
    this.onEvent = null;
    this.racers = [];
    this.drivers = [];
    this.ctx = { track, practice: this.practice, respawn: (r) => this.respawn(r) };

    const persona = makePersonalities(RACER_COUNT - 1, this.difficulty, this.seed);
    const slots = track.startSlots.slice(0, RACER_COUNT);
    const playerSlot = opts.playerSlot ?? 7;
    let n = 0;
    for (let i = 0; i < RACER_COUNT; i++) {
      const isPlayer = i === playerSlot;
      const p = isPlayer ? null : persona[n++];
      const r = new Racer(i, isPlayer ? 'You' : p.name, isPlayer);
      r.persona = p;
      if (p) r.pace = ({ easy: 0.93, normal: 0.985, hard: 1.045 }[this.difficulty] ?? 1) * (1 + (p.skill - 0.6) * 0.05);
      r.slot = slots[i];
      this.racers.push(r);
      if (isPlayer) this.player = r;
    }
    // NPC drivers (and an optional bot standing in for the player in headless tests)
    this.racers.forEach((r) => {
      if (!r.isPlayer) this.drivers[r.index] = new AIDriver(r.persona);
      else if (this.playerBot) {
        this.drivers[r.index] = new AIDriver({
          name: 'bot', skill: opts.botSkill ?? 0.8, risk: opts.botRisk ?? 0.7, aggression: 0.5,
          laneBias: 0, phase1: 1, phase2: 2, seed: 99,
        });
      }
    });
    this.grid();
    this.playerInput = { steer: 0, jump: false };
    this.computeRanking();
  }

  grid() {
    for (const r of this.racers) {
      r.reset();
      r.place(this.track, this.track.T, r.slot.s, r.slot.u, 0);
      r.checkpoint = this.track.checkpoints[0];
    }
  }

  go() {
    this.phase = 'racing';
    this.time = 0;
    for (const r of this.racers) {
      r.kickTime = 1.4;
      r.holdTimer = r.isPlayer ? 0 : this.rng.range(0.02, 0.42) * (1.15 - (r.persona?.skill ?? 0.5));
    }
  }

  respawn(r) {
    const cp = r.checkpoint || this.track.checkpoints[0];
    r.place(this.track, cp.path, cp.s, 0, 11);
    r.invuln = 1.6;
    r.dnf = false;
    r.boostTime = 0;
  }

  /** Advance the race by `dt` seconds (any size; internally sub-stepped). */
  update(dt, input) {
    if (this.phase !== 'racing') return;
    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / n;
    const inp = this.playerInput;
    inp.steer = input ? input.steer : 0;
    let jump = input ? input.jump : false;
    for (let i = 0; i < n; i++) {
      inp.jump = jump;
      jump = false; // edge only on the first substep
      this.step(h);
    }
  }

  step(h) {
    this.time += h;
    for (const r of this.racers) {
      if (r.state === State.OUT) continue;
      if (r.holdTimer > 0) { r.holdTimer -= h; continue; }
      const drv = this.drivers[r.index];
      const input = drv ? drv.update(r, this, h) : this.playerInput;
      stepRacer(r, h, input, this.track, this.ctx);
      if (r.events.length) {
        for (const ev of r.events) this.handleEvent(r, ev);
        r.events.length = 0;
      }
      this.updateCheckpoint(r);
    }
    this.separate(h);
    this.computeRanking();
  }

  handleEvent(r, ev) {
    if (ev.type === 'finish') {
      r.finishTime = this.time;
      r.finishRank = ++this.finishCount;
    }
    this.onEvent?.(r, ev);
  }

  updateCheckpoint(r) {
    if (r.state !== State.SLIDING) return;
    const d = r.path.mainDist(r.s);
    const cps = this.track.checkpoints;
    for (let i = cps.length - 1; i >= 0; i--) {
      if (d >= cps[i].dist) {
        if (!r.checkpoint || cps[i].dist > r.checkpoint.dist) {
          r.checkpoint = cps[i];
          if (i > 0) this.onEvent?.(r, { type: 'checkpoint', index: i });
        }
        break;
      }
    }
  }

  /** Soft collisions between sliding racers: nudge sideways, shave a little speed off the rear one. */
  separate(h) {
    const R = this.racers;
    for (let i = 0; i < R.length; i++) {
      const a = R[i];
      if (a.state !== State.SLIDING && a.state !== State.FINISHED) continue;
      for (let j = i + 1; j < R.length; j++) {
        const b = R[j];
        if ((b.state !== State.SLIDING && b.state !== State.FINISHED) || b.path !== a.path) continue;
        const ds = a.s - b.s;
        if (ds > 1.5 || ds < -1.5) continue;
        const du = a.u - b.u;
        if (du > 1.05 || du < -1.05) continue;
        const sign = du === 0 ? (i % 2 ? 1 : -1) : Math.sign(du);
        const push = Math.min(0.08, (1.05 - Math.abs(du)) * 0.5);
        a.u += sign * push;
        b.u -= sign * push;
        a.bump = b.bump = 1;
        const rear = ds < 0 ? a : b;
        const front = ds < 0 ? b : a;
        if (Math.abs(ds) < 1.1) rear.speed = Math.min(rear.speed, front.speed + 0.4);
      }
    }
  }

  computeRanking() {
    const t = this.track;
    for (const r of this.racers) {
      if (r.state === State.FINISHED) r.progress = 1;
      else if (r.state === State.OUT || (r.state === State.FALLING && !this.practice)) r.progress = r.fellAtProgress;
      else r.progress = t.progress(r.path, r.s);
    }
    const group = (r) => (r.state === State.FINISHED ? 0 : r.state === State.OUT || (r.state === State.FALLING && !this.practice) ? 2 : 1);
    this.order = this.racers.slice().sort((a, b) => {
      const ga = group(a), gb = group(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return a.finishTime - b.finishTime;
      if (b.progress !== a.progress) return b.progress - a.progress;
      return b.speed - a.speed;
    });
    this.order.forEach((r, i) => (r.rank = i + 1));
  }

  /** True once nobody can change the standings any more. */
  get allDone() {
    return this.racers.every((r) => r.state === State.FINISHED || r.state === State.OUT);
  }

  playerDone() {
    const p = this.player;
    return p.state === State.FINISHED || p.state === State.OUT;
  }

  results() {
    return this.order.map((r) => ({
      racer: r,
      rank: r.rank,
      name: r.name,
      isPlayer: r.isPlayer,
      time: r.finishTime,
      status: r.state === State.FINISHED ? 'finished' : r.state === State.OUT || (r.state === State.FALLING && !this.practice) ? 'dnf' : 'racing',
      progress: r.progress,
    }));
  }
}
