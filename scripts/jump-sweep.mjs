import { buildTrack } from '../src/game/trackData.js';
import { Racer, stepRacer, State } from '../src/game/racer.js';
const track = buildTrack();
function run(path, lip, speed, boost, startBack = 30) {
  const r = new Racer(0, 't');
  r.place(track, path, lip.s - startBack, 0, speed);
  const ctx = { track, practice: false, respawn() {} };
  const input = { steer: 0, jump: false };
  let t = 0, jumped = false, landed = false, fell = false, speedAtLip = 0;
  while (t < 9) {
    input.jump = false;
    if (boost && !jumped && lip.s - r.s < 7 && r.state === State.SLIDING) { input.jump = true; jumped = true; }
    stepRacer(r, 1 / 60, input, track, ctx);
    for (const e of r.events) { if (e.type === 'launch') speedAtLip = r.speed; if (e.type === 'land') landed = true; if (e.type === 'fall') fell = true; }
    r.events.length = 0;
    t += 1 / 60;
    if (fell || (landed && r.s > lip.s + lip.gapLen + 6)) break;
  }
  return { fell, landed, speedAtLip };
}
for (const [pid, li] of [['M', 0], ['M', 1], ['S', 0]]) {
  const path = track[pid]; const lip = path.lips[li];
  console.log(`--- ${pid} lip ${li} (gap ${lip.gapLen})`);
  for (const boost of [false, true]) {
    let line = boost ? 'boost   ' : 'no boost';
    for (let sp = 12; sp <= 32; sp += 2) { const o = run(path, lip, sp, boost); line += ` ${sp}:${o.fell ? 'FALL' : 'ok  '}(${o.speedAtLip.toFixed(0)})`; }
    console.log(line);
  }
}
