/**
 * "Coral Cascade" – an original layout.
 *
 *   T  trunk:   start deck -> drop -> banked left -> banked right -> widening fork platform
 *   M  main:    banked spiral loop -> kicker ramp #1 -> banked left hairpin -> kicker ramp #2
 *               -> banked right sweeper -> finish straight -> splash pool
 *   S  shortcut (left branch at the fork): kicker + 18 m gap that needs a well-timed jump, then a steep
 *               chute that flies over the spiral and drops back onto M.
 */
import { DEG } from './util.js';
import { Track, buildPath, RIM_W } from './track.js';

const LANE_OFFSET = 3.8; // fork lane centre distance from trunk centre line
const LANE_WIDTH = 6;

const SLALOM_AMP = 26; // metres of lateral swing (to the left of the chord)

function waypoint(st, E, amp, at) {
  const dx = E.px - st.x, dz = E.pz - st.z;
  const chord = Math.hypot(dx, dz);
  const ux = dx / chord, uz = dz / chord;
  return {
    x: st.x + dx * at + uz * amp,
    z: st.z + dz * at - ux * amp,
    y: st.y + (E.py + 3.4 - st.y) * at,
    yaw: Math.atan2(ux, uz),
  };
}

function horizRight(yaw) {
  return { x: -Math.cos(yaw), z: Math.sin(yaw) };
}

export function buildTrack() {
  // ---------------------------------------------------------------- T (trunk)
  const T = buildPath('T', {
    name: 'trunk',
    start: { x: 0, y: 260, z: 0, yaw: 0, pitch: -6, width: 11, hue: 0.56 },
    pieces: [
      { len: 26, pitch: -6, hue: 0.56 },
      { len: 58, pitch: -15, width: 10.5, hue: 0.55 },
      { len: 104, turn: -115, pitch: -9, hue: 0.5, checkpoint: true },
      { len: 34, pitch: -10, hue: 0.46 },
      { len: 100, turn: 150, pitch: -9, hue: 0.4, checkpoint: true },
      { len: 64, pitch: -10, width: 2 * (LANE_OFFSET + LANE_WIDTH / 2), hue: 0.34 },
    ],
  });
  const tf = T.frame(T.length);
  const yawEnd = Math.atan2(tf.tx, tf.tz);
  const pitchEnd = Math.asin(tf.ty) / DEG;
  const r = horizRight(yawEnd);

  // ---------------------------------------------------------------- M (main)
  const M = buildPath('M', {
    name: 'main',
    start: {
      x: tf.px + r.x * LANE_OFFSET, y: tf.py, z: tf.pz + r.z * LANE_OFFSET,
      yaw: yawEnd, pitch: pitchEnd, width: LANE_WIDTH, hue: 0.3,
    },
    pieces: [
      { len: 24, pitch: -10, width: LANE_WIDTH, hue: 0.3, checkpoint: true },
      { len: 168, turn: 360, turnEase: 0.15, pitch: -8.5, width: 10.5, hue: 0.08 }, // spiral loop
      { len: 84, pitch: -9, hue: 0.06 },
      { len: 30, pitch: -10, hue: 0.9, checkpoint: true, mark: 'rejoin' },
      // kicker ramp #1
      { len: 8, pitch: -3, hue: 0.9 },
      { len: 9, pitch: 13, ramp: true, hue: 0.9 },
      { len: 4, pitch: 13, ramp: true, hue: 0.9 },
      { len: 8, pitch: -12, gap: true, kick: 3.4, ease: 'out', hue: 0.9 },
      { len: 22, pitch: -12, hue: 0.86 },
      // banked left hairpin
      { len: 104, turn: -165, pitch: -9, width: 11, hue: 0.8, checkpoint: true },
      { len: 40, pitch: -10, hue: 0.74 },
      // kicker ramp #2 (longer gap)
      { len: 8, pitch: -3, hue: 0.7 },
      { len: 10, pitch: 14, ramp: true, hue: 0.7 },
      { len: 4, pitch: 14, ramp: true, hue: 0.7 },
      { len: 11, pitch: -12, gap: true, kick: 2.6, ease: 'out', hue: 0.7 },
      { len: 24, pitch: -12, hue: 0.66 },
      // banked right sweeper
      { len: 130, turn: 105, pitch: -8, width: 11.5, hue: 0.6, checkpoint: true },
      { len: 60, pitch: -6, hue: 0.56 },
      // finish straight & splash pool
      { len: 60, pitch: -3, width: 13, hue: 0.53, finish: true },
      { len: 70, pitch: 0, width: 18, hue: 0.5 },
    ],
  });

  const rejoinS = M.marks.rejoin;
  const rf = M.frame(rejoinS);
  const rejoinYaw = Math.atan2(rf.tx, rf.tz);

  // ---------------------------------------------------------------- S (shortcut)
  const S = buildPath('S', {
    name: 'shortcut',
    start: {
      x: tf.px - r.x * LANE_OFFSET, y: tf.py, z: tf.pz - r.z * LANE_OFFSET,
      yaw: yawEnd, pitch: pitchEnd, width: LANE_WIDTH, hue: 0.14,
    },
    pieces: [
      { len: 14, pitch: -8, hue: 0.14 },
      { len: 8, pitch: 12, ramp: true, hue: 0.12 },
      { len: 5, pitch: 12, ramp: true, hue: 0.12 },
      { len: 18, pitch: -10, gap: true, kick: 0.6, ease: 'out', hue: 0.12 }, // the big gap
      { len: 16, pitch: -14, width: 10, hue: 0.16 }, // wide landing deck
      // canyon slalom: swing out to a waypoint, then hermite back to the rejoin point above M
      {
        type: 'connect', pitch: -12, width: 7, hue: 0.19, rough: true,
        target: (st) => waypoint(st, rf, SLALOM_AMP, 0.5),
      },
      {
        type: 'connect', pitch: -8, width: LANE_WIDTH, hue: 0.22, rough: true,
        target: { x: rf.px, y: rf.py + 3.4, z: rf.pz, yaw: rejoinYaw },
      },
      { len: 4, pitch: -6, hue: 0.2 },
    ],
  });

  // ---------------------------------------------------------------- links & progress mapping
  T.mainStart = 0; T.mainEnd = T.length;
  M.mainStart = T.length; M.mainEnd = T.length + M.length;
  S.mainStart = T.length; S.mainEnd = T.length + rejoinS;

  T.endKind = 'link';
  T.endLinks = [
    { uMax: 0, to: S, du: LANE_OFFSET }, // u < 0 -> left lane (shortcut)
    { uMax: Infinity, to: M, du: -LANE_OFFSET },
  ];
  S.endKind = 'drop'; // S ends in a lip: racers launch and land on M
  M.endKind = 'end';

  // ---------------------------------------------------------------- gameplay metadata
  const startSlots = [];
  const cols4 = [-4.05, -1.35, 1.35, 4.05];
  const cols3 = [-2.7, 0, 2.7];
  const rows = [cols4, cols3, cols3, cols3];
  rows.forEach((cols, ri) => cols.forEach((u) => startSlots.push({ s: 21 - ri * 3.4, u })));

  const checkpoints = [{ path: T, s: 8, dist: 8 }];
  for (const p of [T, M]) for (const s of p.checkpoints) checkpoints.push({ path: p, s, dist: p.mainDist(s) });
  checkpoints.sort((a, b) => a.dist - b.dist);

  const jumpZones = [];
  for (const p of [T, M, S]) {
    for (const lip of p.lips) {
      const zone = {
        path: p, lipS: lip.s, gapLen: lip.gapLen, window: 13,
        big: p === S, // needs a boosted jump
      };
      lip.zone = zone;
      jumpZones.push(zone);
    }
  }

  const decisionZones = [
    { path: T, s0: T.length - 70, s1: T.length - 6, laneU: -LANE_OFFSET, altU: LANE_OFFSET, option: S },
  ];

  const track = new Track([T, M, S], {
    T, M, S,
    mainLength: T.length + M.length,
    finishDist: T.length + M.finishS,
    finishPath: M,
    startSlots,
    checkpoints,
    jumpZones,
    decisionZones,
    rejoinS,
    laneOffset: LANE_OFFSET,
    rimWidth: RIM_W,
  });
  track.seaY = track.minY - 16;
  return track;
}
