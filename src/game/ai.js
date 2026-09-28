/**
 * NPC driver.  Follows the centerline with a per-racer target offset + smooth noise and reads three
 * personality parameters:
 *   skill      steering accuracy, drift compensation, jump-timing and landing success
 *   risk       appetite for the shortcut
 *   aggression racing line (cuts curves), overtake bias, willingness to run near the edge
 */
import { PHYS } from './racer.js';
import { Frame } from './track.js';
import { clamp, makeRng } from './util.js';

const NAMES = [
  'Splashy', 'Kai', 'Marlin', 'Coral', 'Finn', 'Wavey', 'Drip', 'Bubbles', 'Tide', 'Nemo', 'Pearl', 'Skipper',
  'Misty', 'Reef', 'Dash', 'Ripple', 'Sunny', 'Zippy',
];

export function makePersonalities(count, difficulty, seed) {
  const rng = makeRng(seed);
  const names = NAMES.slice().sort(() => rng() - 0.5);
  const diff = { easy: -0.14, normal: 0, hard: 0.1 }[difficulty] ?? 0;
  const skills = Array.from({ length: count }, (_, i) => 0.32 + (0.62 * i) / Math.max(1, count - 1));
  skills.sort(() => rng() - 0.5);
  return skills.map((base, i) => ({
    name: names[i % names.length],
    skill: clamp(base + rng.range(-0.05, 0.05) + diff, 0.15, 0.98),
    risk: rng(),
    aggression: rng(),
    laneBias: rng.range(-2.6, 2.6),
    phase1: rng.range(0, 6.28),
    phase2: rng.range(0, 6.28),
    seed: Math.floor(rng() * 1e9),
  }));
}

const _f = new Frame();
const _g = new Frame();

export class AIDriver {
  constructor(personality) {
    this.p = personality;
    this.rng = makeRng(personality.seed);
    this.time = this.rng.range(0, 10);
    this.intent = null; // 'shortcut' | 'main' once decided
    this.plans = new Map();
    this.out = { steer: 0, jump: false };
    this.steerNoise = 0;
    this.lapse = 0;
    this.lapseDir = 1;
  }

  jumpSuccessProb(zone) {
    const s = this.p.skill;
    return zone.big ? clamp(0.28 + 0.7 * Math.pow(s, 1.15), 0.15, 0.97) : clamp(0.5 + 0.5 * s, 0.3, 0.98);
  }

  update(r, race, dt) {
    const p = this.p;
    const track = race.track;
    const out = this.out;
    out.jump = false;
    this.time += dt;
    const path = r.path;

    // ---- decisions at shortcut zones
    for (const z of track.decisionZones) {
      if (r.path === z.path && r.s >= z.s0 && this.intent === null) {
        const behind = (r.rank - 1) / Math.max(1, race.racers.length - 1);
        const pj = this.jumpSuccessProb(z.option.lips[0].zone);
        const desire = 0.55 * p.risk + 0.4 * behind + 0.12 * p.aggression;
        const pTake = clamp(desire * (0.3 + 0.75 * pj) * 0.85, 0, 0.92);
        this.intent = this.rng() < pTake ? 'shortcut' : 'main';
      }
    }

    // ---- jump planning for the next lip on this path
    const lip = path.lipAhead(r.s, 70);
    if (lip && lip.zone) {
      const z = lip.zone;
      let plan = this.plans.get(lip);
      if (!plan) {
        const ok = this.rng() < this.jumpSuccessProb(z);
        if (ok) plan = { mode: 'good', at: this.rng.range(1.5, z.window * 0.7), done: false };
        else plan = this.rng() < 0.5 ? { mode: 'none', done: true } : { mode: 'early', at: z.window + this.rng.range(4, 14), done: false };
        this.plans.set(lip, plan);
      }
      if (!plan.done && lip.s - r.s <= plan.at) {
        out.jump = true;
        plan.done = true;
      }
    }

    // ---- target lateral position
    const look = clamp(r.speed * 0.4, 6, 18);
    const fa = path.frame(r.s + look, _f);
    const fn = path.frame(r.s, _g);
    const halfW = fn.width * 0.5;
    const kAbs = clamp(Math.abs(fa.curv) * 55, 0, 1);
    const inside = Math.sign(fa.curv) * kAbs * p.aggression * Math.max(0, fa.width * 0.5 - 2.6);
    let target = p.laneBias * (1 - kAbs * 0.6) * Math.min(1, halfW / 5) + inside;

    const noiseAmp = (1 - p.skill) * 1.7;
    target += noiseAmp * (Math.sin(this.time * 0.9 + p.phase1) + 0.6 * Math.sin(this.time * 2.3 + p.phase2)) * 0.62;

    // fork lane
    for (const z of track.decisionZones) {
      if (r.path === z.path && r.s >= z.s0 - 25 && this.intent) {
        const lane = this.intent === 'shortcut' ? z.laneU : z.altU;
        const k = clamp((r.s - (z.s0 - 25)) / 30, 0, 1);
        target = target * (1 - k) + lane * k;
      }
    }
    if (r.path === track.S) target = target * 0.25; // narrow chute: stay near the middle

    // overtaking / avoidance
    for (const o of race.racers) {
      if (o === r || o.path !== r.path || o.state !== 0) continue;
      const ds = o.s - r.s;
      if (ds > 0.5 && ds < 9 && Math.abs(o.u - r.u) < 1.7) {
        const side = r.u >= o.u ? 1 : -1;
        target = Math.max(-999, target) + side * (2.0 - 0.9 * p.aggression) * (1 - ds / 10);
        if (p.aggression > 0.6 && Math.abs(r.u) > halfW - 2.6) target -= side * 1.0;
      }
    }

    const safe = 1.15 + 1.4 * (1 - p.aggression) + (r.path === track.S ? 0.6 : 0);
    target = clamp(target, -(halfW - safe), halfW - safe);

    // occasional lapses of concentration (more likely for low-skill riders): drift toward an edge for a moment
    if (this.lapse > 0) {
      this.lapse -= dt;
      target = this.lapseDir * (halfW + 0.25);
    } else if (r.state === 0 && r.path !== track.S && r.speed > 12) {
      const rate = (1 - p.skill) ** 2 * 0.03 * (race.difficulty === 'hard' ? 0.5 : race.difficulty === 'easy' ? 1.4 : 1);
      if (this.rng() < rate * dt) { this.lapse = 0.45 + this.rng() * 0.45; this.lapseDir = this.rng() < 0.5 ? -1 : 1; }
    }

    // ---- steering (PD toward target, with drift compensation)
    const err = target - r.u;
    let desired = clamp(err * (2.2 + p.skill * 1.3), -PHYS.maxLatSpeed * 0.9, PHYS.maxLatSpeed * 0.9);
    const drift = -fn.curv * r.speed * r.speed * (1 - PHYS.bankRelief);
    const comp = (drift / (PHYS.steerResponse * PHYS.maxLatSpeed)) * (0.5 + 0.55 * p.skill);
    this.steerNoise += ((this.rng() - 0.5) * 2 - this.steerNoise) * Math.min(1, dt * 6);
    let steer = desired / PHYS.maxLatSpeed - comp + this.steerNoise * (1 - p.skill) * 0.16;
    out.steer = clamp(steer, -1, 1);
    return out;
  }
}
