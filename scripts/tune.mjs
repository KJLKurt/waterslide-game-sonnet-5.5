// Sweep physics params: node scripts/tune.mjs <bankRelief> <troughPull>
import { buildTrack } from '../src/game/trackData.js';
import { Race } from '../src/game/race.js';
import { PHYS } from '../src/game/racer.js';
PHYS.bankRelief = Number(process.argv[2] ?? PHYS.bankRelief);
PHYS.troughPull = Number(process.argv[3] ?? PHYS.troughPull);
const track = buildTrack();
// 1) passive player
const sites = {}; let fin = 0, fell = 0; const n = 40;
for (let i = 0; i < n; i++) {
  const race = new Race(track, { seed: 500 + i, playerSlot: 7 });
  race.onEvent = (r, ev) => { if (r.isPlayer && ev.type === 'fall') { const k = `${r.path.id}@${Math.round(r.s / 25) * 25}`; sites[k] = (sites[k] || 0) + 1; fell++; } if (r.isPlayer && ev.type === 'finish') fin++; };
  race.go();
  race.player.u = (i % 7 - 3) * 0.7;
  let g = 0;
  while (!race.playerDone() && race.time < 120 && g++ < 9000) race.update(1 / 60, { steer: 0, jump: false });
}
console.log(`bankRelief ${PHYS.bankRelief} troughPull ${PHYS.troughPull} | passive: finished ${fin}/${n}, fell ${fell}/${n}`, JSON.stringify(sites));
// 2) NPC field
let npcFall = 0, npcFinish = 0, times = [], edge = {};
for (let i = 0; i < 25; i++) {
  const race = new Race(track, { seed: 900 + i * 13, playerBot: true, botSkill: 0.7 });
  race.onEvent = (r, ev) => { if (ev.type === 'fall') { npcFall++; const k = `${r.path.id}@${Math.round(r.s / 25) * 25}`; edge[k] = (edge[k] || 0) + 1; } if (ev.type === 'finish') { npcFinish++; times.push(r.finishTime); } };
  race.go();
  let g = 0;
  while (!race.allDone && race.time < 150 && g++ < 12000) race.update(1 / 60, { steer: 0, jump: false });
}
console.log(`   NPC field: finish ${npcFinish}/${25 * 13}, falls ${npcFall}, avg time ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}s`, JSON.stringify(edge));
