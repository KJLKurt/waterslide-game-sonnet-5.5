/**
 * Racer: track-constrained motion.  No rigid bodies.
 *
 * State per racer: path, s (distance along centerline), u (lateral offset), speed (forward),
 * vy (vertical velocity while airborne) and a state machine  SLIDING / AIRBORNE / FALLING / FINISHED.
 * While sliding the world position is derived from the path frame at (s,u) and snapped to the slide by a
 * vertical raycast. While airborne the racer follows a ballistic arc and lands when the down-ray finds the slide.
 */
import { clamp, damp } from './util.js';
import { Frame, sectionHeight, sectionSlope, FLAG_ROUGH, FLAG_BOOST } from './track.js';

export const State = { SLIDING: 0, AIRBORNE: 1, FALLING: 2, FINISHED: 3, OUT: 4 };

export const PHYS = {
  gravity: 20,
  baseAccel: 3.0, // "water current" that keeps flat sections moving
  slopeAccel: 30,
  uphillScale: 0.4, // ramps are boosters, not brakes
  drag: 0.0145,
  roughDragMul: 2.6,
  maxSpeed: 34,
  maxLatSpeed: 10.5,
  steerResponse: 9,
  bankRelief: 0.35, // fraction of curve drift cancelled by the banked track
  troughPull: 1.0, // gentle pull toward the centre from the trough profile
  edgeMargin: 0.3,
  missGrace: 0.16,
  hopSpeed: 8.2,
  rampBoost: 6.4, // extra vertical speed for a well-timed ramp jump
  airSteer: 11,
  airLatMax: 6,
  failDrop: 7, // metres below the path before an airborne racer counts as lost
  fallTime: 1.05,
  landBoostTime: 1.1,
  landBoostAccel: 9,
  boostStripAccel: 12,
  startKick: 2.2,
};

const _f = new Frame();

export class Racer {
  constructor(index, name, isPlayer = false) {
    this.index = index;
    this.name = name;
    this.isPlayer = isPlayer;
    this.pace = 1; // driving-force multiplier (rivals: difficulty + skill)
    this.reset();
  }

  reset() {
    this.state = State.SLIDING;
    this.path = null;
    this.s = 0;
    this.u = 0;
    this.uVel = 0;
    this.speed = 0;
    this.vy = 0;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    // orientation helpers for rendering
    this.fx = 0; this.fy = 0; this.fz = 1; // forward
    this.nx = 0; this.ny = 1; this.nz = 0; // up
    this.steer = 0;
    this.airTime = 0;
    this.noLand = 0;
    this.missTime = 0;
    this.stateTime = 0;
    this.hopCooldown = 0;
    this.armedBoost = false; // jump pressed inside a lip window
    this.perfectLaunch = false;
    this.boostTime = 0;
    this.finishTime = null;
    this.finishRank = 0;
    this.progress = 0;
    this.rank = 0;
    this.dnf = false;
    this.fellAtProgress = 0;
    this.checkpoint = null;
    this.usedShortcut = false;
    this.bump = 0;
    this.landed = 0; // impulse for animation / camera
    this.holdTimer = 0; // start reaction
    this.kickTime = 0;
    this.invuln = 0;
    this.hasJumped = false;
    this.lastPerfect = false;
    this.events = []; // per-step events consumed by the game layer
  }

  place(track, path, s, u, speed = 0) {
    this.path = path;
    this.s = s;
    this.u = u;
    this.speed = speed;
    this.uVel = 0;
    this.state = State.SLIDING;
    this.stateTime = 0;
    this.vy = 0;
    this.missTime = 0;
    this.armedBoost = false;
    this.syncFromPath(track);
  }

  /** Compute world position & orientation from (path, s, u). */
  syncFromPath(track) {
    const f = this.path.frame(this.s, _f);
    const w = f.width;
    const h = sectionHeight(this.u, w);
    this.x = f.px + f.rx * this.u + f.nx * h;
    this.y = f.py + f.ry * this.u + f.ny * h;
    this.z = f.pz + f.rz * this.u + f.nz * h;
    const sl = sectionSlope(this.u, w);
    let nx = f.nx - f.rx * sl, ny = f.ny - f.ry * sl, nz = f.nz - f.rz * sl;
    const l = 1 / Math.hypot(nx, ny, nz);
    this.nx = nx * l; this.ny = ny * l; this.nz = nz * l;
    this.fx = f.tx; this.fy = f.ty; this.fz = f.tz;
    this.vx = f.tx * this.speed;
    this.vz = f.tz * this.speed;
    this.vy = f.ty * this.speed;
  }
}

/**
 * Advance one racer by dt seconds. `input` = { steer: -1..1, jump: bool (edge) }.
 * `track` provides raycasts; `ctx` = { practice, respawn(racer) }
 */
export function stepRacer(r, dt, input, track, ctx) {
  r.stateTime += dt;
  if (r.hopCooldown > 0) r.hopCooldown -= dt;
  if (r.invuln > 0) r.invuln -= dt;
  if (r.landed > 0) r.landed = Math.max(0, r.landed - dt * 3);
  if (r.bump > 0) r.bump = Math.max(0, r.bump - dt * 4);
  switch (r.state) {
    case State.SLIDING:
    case State.FINISHED:
      stepSliding(r, dt, input, track, ctx);
      break;
    case State.AIRBORNE:
      stepAirborne(r, dt, input, track, ctx);
      break;
    case State.FALLING:
      stepFalling(r, dt, ctx);
      break;
    default:
      break;
  }
}

function stepSliding(r, dt, input, track, ctx) {
  const path = r.path;
  const finished = r.state === State.FINISHED;
  const f = path.frame(r.s, _f);
  const flags = path.flags[Math.min(path.n - 1, Math.round(r.s / path.ds))];

  // ---- forward speed
  let drag = PHYS.drag;
  if (flags & FLAG_ROUGH) drag *= PHYS.roughDragMul;
  const slope = f.ty < 0 ? -f.ty * PHYS.slopeAccel : -f.ty * PHYS.slopeAccel * PHYS.uphillScale;
  let accel = (PHYS.baseAccel + slope) * r.pace - drag * r.speed * r.speed;
  if (r.boostTime > 0) { accel += PHYS.landBoostAccel; r.boostTime -= dt; }
  if (flags & FLAG_BOOST) accel += PHYS.boostStripAccel;
  if (r.kickTime > 0 && !finished) { accel += PHYS.startKick; r.kickTime -= dt; }
  if (finished) accel = -9 - r.speed * 0.6; // splash-pool braking
  r.speed = clamp(r.speed + accel * dt, 0, PHYS.maxSpeed);

  // ---- lateral
  let steer = finished ? clamp(-r.u * 0.5, -0.6, 0.6) : input.steer;
  r.steer = damp(r.steer, steer, 18, dt);
  const target = r.steer * PHYS.maxLatSpeed;
  const drift = -f.curv * r.speed * r.speed * (1 - PHYS.bankRelief);
  const lat = (target - r.uVel) * PHYS.steerResponse + drift - r.u * PHYS.troughPull;
  r.uVel = clamp(r.uVel + lat * dt, -14, 14);
  r.u += r.uVel * dt;

  // inner lines are shorter: advance faster when hugging the inside of the curve
  const lineFactor = clamp(1 - f.curv * r.u, 0.45, 1.6);
  r.s += (r.speed * dt) / lineFactor;

  // ---- jump button
  if (input.jump && !finished && r.hopCooldown <= 0) {
    const lip = path.lipAhead(r.s, 60);
    const zone = lip ? lip.zone : null;
    const dist = lip ? lip.s - r.s : 999;
    if (zone && dist > 0 && dist <= zone.window) {
      r.armedBoost = true; // jump assist: executed at the lip
      r.events.push({ type: 'armed' });
    } else if (!path.isGapAt(r.s)) {
      hop(r, path);
      r.events.push({ type: 'hop' });
      return;
    }
  }

  // ---- lip (ramp end): auto-launch
  if (path.isGapAt(r.s)) {
    launch(r, path, r.armedBoost);
    return;
  }

  // ---- end of path
  if (r.s >= path.length) {
    if (path.endKind === 'link') {
      const link = path.endLinks.find((l) => r.u < l.uMax);
      const to = link.to;
      r.path = to;
      r.u += link.du;
      const lim = to.width[0] * 0.5 - PHYS.edgeMargin - 0.25;
      r.u = clamp(r.u, -lim, lim);
      r.s = Math.max(0, r.s - path.length);
      if (to === ctx.track.S) { r.usedShortcut = true; r.events.push({ type: 'shortcut' }); }
    } else if (path.endKind === 'drop') {
      launch(r, path, false);
      return;
    } else {
      r.s = path.length - 0.5;
      r.speed = 0;
    }
  }

  // ---- finish
  if (!finished && ctx.track.finishPath === r.path && r.s >= r.path.finishS) {
    r.state = State.FINISHED;
    r.stateTime = 0;
    r.events.push({ type: 'finish' });
  }

  // ---- edge fall
  const cf = r.path.frame(r.s, _f);
  const halfW = cf.width * 0.5;
  if (!finished && Math.abs(r.u) > halfW - PHYS.edgeMargin) {
    startFall(r, Math.sign(r.u) || 1, ctx, cf);
    return;
  }
  if (finished) r.u = clamp(r.u, -halfW + 0.8, halfW - 0.8);

  // ---- world position + snap to the slide with a downward raycast
  r.syncFromPath(track);
  const hit = track.raycastDown(r.x, r.y + 1.1, r.z, 2.6, 0.2);
  if (hit) {
    // snap to the slide surface (only if it is where we expect it, so an unrelated slide passing underneath is ignored)
    if (Math.abs(hit.y - r.y) < 0.4) r.y = hit.y;
    r.missTime = 0;
  } else {
    r.missTime += dt;
    if (r.missTime > PHYS.missGrace && !finished) {
      startFall(r, 0, ctx, cf);
      return;
    }
  }
  // velocity for the render layer / camera
  r.vx = cf.tx * r.speed;
  r.vz = cf.tz * r.speed;
  r.vy = cf.ty * r.speed;
}

function hop(r, path) {
  const f = path.frame(r.s, _f);
  r.vx = f.tx * r.speed;
  r.vz = f.tz * r.speed;
  r.vy = f.ty * r.speed + PHYS.hopSpeed;
  enterAir(r, false);
}

function launch(r, path, boosted) {
  const f = path.frame(r.s, _f);
  r.vx = f.tx * r.speed;
  r.vz = f.tz * r.speed;
  r.vy = f.ty * r.speed;
  const lip = path.lipAt(r.s);
  if (lip) r.vy += lip.kick; // ramps add an upward impulse
  if (boosted) {
    r.vy += PHYS.rampBoost;
    r.perfectLaunch = true;
  }
  r.events.push({ type: 'launch', boosted });
  enterAir(r, boosted);
  r.noLand = 0.12;
}

function enterAir(r, perfect) {
  r.state = State.AIRBORNE;
  r.stateTime = 0;
  r.airTime = 0;
  r.armedBoost = false;
  r.perfectLaunch = perfect;
  r.noLand = 0.1;
  r.hopCooldown = 0.35;
}

function stepAirborne(r, dt, input, track, ctx) {
  const path = r.path;
  r.airTime += dt;
  if (r.noLand > 0) r.noLand -= dt;
  const px = r.x, py = r.y, pz = r.z;

  // limited air steering, along the path's lateral axis
  const f = path.frame(r.s, _f);
  r.steer = damp(r.steer, input.steer, 14, dt);
  const rx = f.rx, rz = f.rz;
  let latV = r.vx * rx + r.vz * rz;
  const wantLat = r.steer * PHYS.airLatMax;
  const dLat = clamp((wantLat - latV) * PHYS.airSteer * 0.25, -PHYS.airSteer, PHYS.airSteer) * dt;
  r.vx += rx * dLat;
  r.vz += rz * dLat;
  r.vy -= PHYS.gravity * dt;

  r.x += r.vx * dt;
  r.y += r.vy * dt;
  r.z += r.vz * dt;
  r.uVel = latV;

  // keep s tracking the nearest centerline point (2 Newton steps)
  for (let k = 0; k < 2; k++) {
    const g = path.frame(r.s, _f);
    const along = (r.x - g.px) * g.tx + (r.y - g.py) * g.ty + (r.z - g.pz) * g.tz;
    r.s = clamp(r.s + along, 0, path.length);
  }
  {
    const g = path.frame(r.s, _f);
    r.u = (r.x - g.px) * g.rx + (r.y - g.py) * g.ry + (r.z - g.pz) * g.rz;
  }
  r.speed = Math.hypot(r.vx, r.vz);
  const hs = Math.hypot(r.vx, r.vz) || 1;
  r.fx = r.vx / hs; r.fz = r.vz / hs; r.fy = clamp(r.vy / 30, -0.6, 0.6);

  // ---- landing (swept down ray so fast descents cannot tunnel through the slide)
  if (r.noLand <= 0 && r.vy <= 0.5) {
    const drop = Math.max(0, py - r.y);
    const hit = track.raycastDown(px, py + 0.7, pz, drop + 0.7 + 0.35, 0.1) ||
      track.raycastDown(r.x, r.y + 0.7, r.z, 1.0, 0.1);
    if (hit && hit.y >= r.y - 0.08 && hit.y <= py + 0.7) {
      land(r, hit, track, ctx);
      return;
    }
  }

  // ---- failure: too far below the slide (or airborne far too long)
  const g = path.frame(r.s, _f);
  if (r.y < g.py - PHYS.failDrop || r.airTime > 5) {
    startFall(r, 0, ctx, g);
  }
}

function land(r, hit, track, ctx) {
  const path = hit.path;
  const impactSpeed = -r.vy;
  const f = path.frame(hit.s, _f);
  const along = r.vx * f.tx + r.vy * f.ty + r.vz * f.tz;
  if (path !== r.path) {
    if (path === ctx.track.M && r.path === ctx.track.S) r.usedShortcut = true;
    r.path = path;
  }
  r.s = hit.s;
  r.u = hit.u;
  r.speed = clamp(Math.max(along, r.speed * 0.72), 6, PHYS.maxSpeed);
  r.uVel = 0;
  r.state = State.SLIDING;
  r.stateTime = 0;
  r.missTime = 0;
  r.landed = clamp(impactSpeed / 14, 0.2, 1);
  r.hopCooldown = 0.12;
  r.noLand = 0;
  const perfect = r.perfectLaunch;
  if (perfect) r.boostTime = PHYS.landBoostTime;
  r.perfectLaunch = false;
  r.events.push({ type: 'land', impact: impactSpeed, perfect });
  r.syncFromPath(track);
  r.y = hit.y;
}

function startFall(r, side, ctx, f) {
  r.state = State.FALLING;
  r.stateTime = 0;
  const rx = f ? f.rx : 1, rz = f ? f.rz : 0;
  r.vx = r.vx || 0;
  r.vz = r.vz || 0;
  // keep momentum, add an outward shove when sliding off an edge
  const fx = f ? f.tx : r.fx, fz = f ? f.tz : r.fz;
  r.vx = fx * r.speed * 0.85 + rx * side * 3.5;
  r.vz = fz * r.speed * 0.85 + rz * side * 3.5;
  if (r.vy < 0) r.vy *= 0.5;
  r.fellSide = side;
  r.fellAtProgress = ctx.track.progress(r.path, r.s);
  r.events.push({ type: 'fall', progress: r.fellAtProgress });
}

function stepFalling(r, dt, ctx) {
  r.vy -= PHYS.gravity * dt;
  r.x += r.vx * dt;
  r.y += r.vy * dt;
  r.z += r.vz * dt;
  if (r.stateTime > PHYS.fallTime) {
    if (ctx.practice) {
      ctx.respawn(r);
      r.events.push({ type: 'respawn' });
    } else {
      r.state = State.OUT;
      r.dnf = true;
      r.events.push({ type: 'out' });
    }
  }
}
