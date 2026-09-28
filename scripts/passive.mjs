// How does a player who never touches the stick fare? node scripts/passive.mjs
import { buildTrack } from '../src/game/trackData.js';
import { Race } from '../src/game/race.js';
import { State } from '../src/game/racer.js';
const track = buildTrack();
const sites = {}; let fin = 0, fell = 0, n = 40;
for (let i = 0; i < n; i++) {
  const race = new Race(track, { seed: 500 + i, playerSlot: 7 });
  race.onEvent = (r, ev) => { if (r.isPlayer && ev.type === 'fall') { const k = `${r.path.id}@${Math.round(r.s / 25) * 25}`; sites[k] = (sites[k] || 0) + 1; fell++; } if (r.isPlayer && ev.type === 'finish') fin++; };
  race.go();
  // start with a random lateral offset (as a human would end up)
  race.player.u = (i % 7 - 3) * 0.7;
  let g = 0;
  while (!race.playerDone() && race.time < 120 && g++ < 9000) race.update(1 / 60, { steer: 0, jump: false });
}
console.log(`passive player: finished ${fin}/${n}, fell ${fell}/${n}`, JSON.stringify(sites));
