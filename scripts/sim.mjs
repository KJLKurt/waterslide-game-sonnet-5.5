// Headless race simulation: tunes/validates physics, AI, shortcut balance. Usage: node scripts/sim.mjs [races] [difficulty]
import { buildTrack } from '../src/game/trackData.js';
import { Race } from '../src/game/race.js';
import { State } from '../src/game/racer.js';

const N = Number(process.argv[2] || 20);
const difficulty = process.argv[3] || 'normal';
const track = buildTrack();

const agg = { finishTimes: [], winnerTimes: [], falls: 0, dnf: 0, shortcutTry: 0, shortcutOk: 0, shortcutFall: 0, jumps: 0, land: 0, perfect: 0, byPath: { S: [], M: [] }, fallProgress: [], simTime: [] };
const fallSites = {};
const t0 = Date.now();
for (let n = 0; n < N; n++) {
  const race = new Race(track, { seed: 1000 + n * 17, difficulty, playerBot: true, botSkill: 0.6 + (n % 5) * 0.08 });
  const enteredS = new Set();
  race.onEvent = (r, ev) => {
    if (ev.type === 'shortcut') { agg.shortcutTry++; enteredS.add(r.index); }
    if (ev.type === 'fall') {
      agg.falls++;
      const key = `${r.path.id}@${Math.round(r.s / 20) * 20}`;
      fallSites[key] = (fallSites[key] || 0) + 1;
      if (enteredS.has(r.index) && r.path.id === 'S') agg.shortcutFall++;
    }
    if (ev.type === 'land' && ev.perfect) agg.perfect++;
    if (ev.type === 'launch') agg.jumps++;
    if (ev.type === 'finish') {
      agg.finishTimes.push(r.finishTime);
      if (r.finishRank === 1) agg.winnerTimes.push(r.finishTime);
      if (enteredS.has(r.index)) agg.byPath.S.push(r.finishTime); else agg.byPath.M.push(r.finishTime);
    }
  };
  race.go();
  let guard = 0;
  while (!race.allDone && race.time < 200 && guard++ < 20000) race.update(1 / 60, { steer: 0, jump: false });
  agg.dnf += race.racers.filter((r) => r.state === State.OUT).length;
  agg.simTime.push(race.time);
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const min = (a) => Math.min(...a), max = (a) => Math.max(...a);
console.log(`races ${N}  wall ${(Date.now() - t0)}ms`);
console.log(`finishers ${agg.finishTimes.length}/${N * 13}  dnf ${agg.dnf}  avgTime ${avg(agg.finishTimes).toFixed(2)}s  min ${min(agg.finishTimes).toFixed(2)} max ${max(agg.finishTimes).toFixed(2)}`);
console.log(`winner avg ${avg(agg.winnerTimes).toFixed(2)}s`);
console.log(`shortcut entered ${agg.shortcutTry} (${(agg.shortcutTry / (N * 13) * 100).toFixed(0)}% of racers), fell on S ${agg.shortcutFall}, success ${(1 - agg.shortcutFall / Math.max(1, agg.shortcutTry)).toFixed(2)}`);
console.log(`avg finish via S ${avg(agg.byPath.S).toFixed(2)}s (n=${agg.byPath.S.length})  via M ${avg(agg.byPath.M).toFixed(2)}s (n=${agg.byPath.M.length})  => saving ${(avg(agg.byPath.M) - avg(agg.byPath.S)).toFixed(2)}s`);
console.log(`jumps ${agg.jumps}, perfect landings ${agg.perfect}, falls ${agg.falls}`);
console.log('fall sites', JSON.stringify(fallSites));
