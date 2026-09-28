# Splash Rush – 3D water slide racer (PWA)

A mobile-first 3D water-slide racing game: you and 12 rivals race down a banked, twisting slide with kicker ramps,
a big spiral, a gap-jump shortcut and a splash-pool finish. Built with **Three.js + Vite**, no runtime CDN, no server,
no analytics, no accounts. Installable, works offline, and can live on **GitHub Pages under a sub-path** next to your other PWAs.

* Portrait **and** landscape, touch (thumb joystick + jump button, multi-touch safe) and keyboard (A/D or ←/→, Space, Esc).
* Procedural cartoon humanoids (capsules / spheres / tori) with palettes and 3 accessories – every racer shares geometry and
  materials, and each body part is a single `InstancedMesh` (13 riders ≈ 12 draw calls; a whole frame is ~25 draw calls).
* Track-constraint physics (no rigid bodies) → stable on mid-range phones. Adaptive quality keeps the frame rate up.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173  (add ?debug for the debug hooks)
npm run build        # -> dist/  (relative base: works from ANY sub-path)
npm run preview
```

## Deploy to GitHub Pages (sub-path safe)

1. Push this folder to a GitHub repo (branch `main`).
2. **Settings → Pages → Build and deployment → Source: “GitHub Actions”.**
3. The workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds with `BASE_PATH=/<repo>/` and
   publishes `dist/`. Your game is then at `https://<user>.github.io/<repo>/`.

Manual alternative: `npm run build`, then upload the *contents* of `dist/` to a `gh-pages` branch (or any folder of any
static host). `vite.config.js` defaults to `base: './'`, so the same build works from `/`, `/repo/` or `/a/b/c/`;
set `BASE_PATH=/repo/` only if you prefer absolute URLs.

### How it coexists with your other PWAs on `<user>.github.io`

All GitHub Pages projects of one account share **one origin**, therefore one `localStorage`, one Cache Storage and
potentially overlapping service-worker scopes. This app is isolated on all three:

| Concern | What Splash Rush does |
| --- | --- |
| Service worker scope | Registered as `<base>sw.js` with `scope: <base>` → controls only `/<repo>/…` |
| Fetch handling | The worker ignores anything outside its scope, cross-origin, or non-GET requests |
| Cache Storage | Cache names are `splash-rush:<scope path>:<build hash>`; on activation only caches with **this** prefix are pruned |
| `localStorage` | Keys are `splash-rush@<scope path>:settings` / `:profile` |
| Manifest | `id`, `start_url` and `scope` are all `./` (relative to the manifest → your repo path) |

`npm run test:e2e` proves this: it mounts two copies at `/app-a/` and `/deep/app-b/` on one origin, adds a foreign
cache, and checks scope, cache and storage isolation and offline boot.

### Offline behaviour

`vite build` finishes with a small plugin (in [vite.config.js](vite.config.js)) that writes `dist/sw.js`, precaching *every*
built file (HTML shell, hashed JS/CSS, the lazy bloom chunk, icons, manifest). After the first visit the game boots with
no network. A new deploy = new hash → the new worker takes over; the page reloads itself the next time you are on
the menu. To force a refresh while testing: DevTools → Application → Service Workers → *Unregister*, and clear site data.

### Installing

* Android / desktop Chrome: menu → *Install app*.  * iOS Safari: Share → *Add to Home Screen* (uses the apple-touch-icon; runs full screen).

---

## Controls

| | Touch | Keyboard |
| --- | --- | --- |
| Steer | drag the floating joystick (left half, or right if left-handed) – horizontal axis only | `A`/`D` or `←`/`→` |
| Jump | **JUMP** button (bottom right / left if left-handed) | `Space` |
| Pause | ❚❚ button | `Esc` / `P` |

Jump rules: tap **JUMP** any time for a hop. Inside the *jump window* before a ramp lip (the button pulses and “JUMP!”
appears) the press is *armed* and executed exactly at the lip: **big air + speed boost on a clean landing**. Ramps launch
you automatically, so the two main-route kickers are safe; the shortcut gap **needs** the boosted jump.

Falling: leave the slide (or miss a landing) and in **Race** mode you’re out; in **Practice** mode you respawn at the last checkpoint.

## Settings (all stored locally)

Quality (auto / low / medium / high), shadows (off by default on phones), bloom (off by default), speed lines & wake,
splash effects, steering sensitivity, handedness, vibration, SFX, music, rival difficulty, practice-by-default.
Also stored: best race / practice time, last palette + accessory, unlock list and simple stats.

Adaptive quality (**Auto**): pixel ratio is capped at 1.5 (Low = 1.0, High = 2.0). If the frame rate stays under ~44 fps the game
steps down: pixel ratio (−0.25 per step to 1.0) → bloom off → shadows off → NPC wakes off. Blob shadows replace shadow
maps whenever real shadows are off.

---

## How it works

```
src/game/           pure JS, no DOM/WebGL – runs headless in Node
  track.js          centerline samples (pos, tangent, right/normal, width, curvature, bank, flags), banking,
                    raycastDown() = vertical ray against the very cross-section the mesh is built from
  trackData.js      the "Coral Cascade" layout: trunk T → fork → main M (spiral, 2 kickers, hairpin, sweeper, finish)
                    / shortcut S (ramp, 18 m gap, rapids chute, drop back onto M)
  racer.js          per-racer state machine + physics (Sliding / Airborne / Falling / Finished)
  ai.js             NPC drivers with skill / risk / aggression, decision zones, jump plans, lapses
  race.js           sub-stepped race loop, checkpoints, soft collisions, live ranking, results
src/                rendering + app shell
  game.js           orchestration (state machine, events → sound/VFX, HUD, camera, quality)
  trackMesh.js      ring cross-section mesh (trough, rim, hull, caps), vertex colours, flowing-water texture
  world.js          sky gradient, fog, lights, sea, islands, clouds, pillars, gates, signs (all instanced)
  characters.js     procedural humanoids, instanced parts, poses (lean, bob, jump tuck, tumble), blob shadows
  cameraRig.js      chase camera w/ look-ahead; portrait/landscape aware distance, height and FOV
  vfx.js            pooled particle Points (wake, splash, sparkles) + speed lines
  quality.js post.js audio.js input.js ui.js storage.js cosmetics.js style.css sw-template.js
```

**Track model.** A path is a polyline sampled every 1 m: `pos, tangent, right, up(normal), width, curvature, bank, flags`.
Banking is derived from curvature (then smoothed). Racers live in `(path, s, u)`. Progress is normalised to `[0..1]`
over the main route; the shortcut maps onto the range it bypasses, so ranking is fair. Ties break on speed.

**Movement.** Sliding: `accel = current + slope·g − drag·v²` (rapids ×2.6 drag, ramps are boosters, not brakes);
lateral velocity chases the stick, plus curve drift `κv²·(1−bankRelief)` and a light trough pull; inner lines are shorter
(`ds = v·dt / (1 − κu)`). The world position comes from the path frame and is snapped by a **downward raycast** onto the slide.
Edge fall when `|u| > width/2 − margin` or the ray misses for a grace period. Airborne: ballistic with limited air
steering; landing is a swept down-ray so fast descents can’t tunnel; falling too far below the slide = lost.

**AI.** NPCs follow the centreline plus a target offset (racing line scaled by *aggression*, smooth noise scaled by
*(1−skill)*, avoidance/overtake bias, drift compensation). At the fork *decision zone* they pick the shortcut with a
probability built from *risk*, *skill* (jump success) and current *placement*. Jump success (armed boost at the lip) is
skill/difficulty-driven – failed jumps really fall short and drop into the gap. Low-skill riders occasionally lapse toward an edge.

---

## Dev tools

```bash
npm run sim              # headless races: finish times, shortcut usage, fall sites (node scripts/sim.mjs [races] [difficulty])
node scripts/track-check.mjs map.png   # stats + top-down/elevation debug image of the layout
node scripts/jump-sweep.mjs            # which launch speeds clear which gap
node scripts/tune.mjs 0.35 1.0         # sweep bankRelief / troughPull (passive rider vs NPC field)
npm run icons            # regenerate PWA icons (pure-JS rasteriser)
npm run test:e2e         # builds under /splash-rush/, runs headless Chrome: PWA/offline, storage, touch, keyboard, falls, full race…
node scripts/visual/screens.mjs <url> <outDir> <profile>   # UI screenshots (phone-portrait, phone-landscape, desktop, tiny-*)
```

Append `?debug` to expose `window.__game` (`debugState()`, `debugPlace(path, s, u, speed)`, `autopilot`).

## Notes

* No external assets: geometry, textures, icons and sounds are all generated in code.
* Verified in headless Chrome (software GL) at phone-portrait, phone-landscape, tiny and desktop sizes; performance numbers
  quoted above are draw-call / triangle counts, not phone benchmarks – use **Auto** quality and adjust in Settings if needed.

## Completion data
| Metric | Amount |
|---|---|
| Total processing time | 1 hr 7 min 26.339 sec |
| **Input tokens processed** | **31,591,815** |
| └ Cache-read input | 31,125,425 |
| └ Cache-creation input | 466,202 |
| └ Direct/non-cache input | 188 |
| **Output tokens** | **368,744** |
| └ Thinking/reasoning output | 208,181 |
| └ Non-thinking output | 160,563 |
| **Total tokens processed** | **31,960,559** |
| API calls | 94 |
| Model | sonnet-5.5 |
| Effort | extra-high |
| **Cost (API rates)** | **$11.78** |

| Cost breakdown | Tokens | Rate per million | Cost |
|---|---|---|---|
| Cache read | 31,125,425 | $0.20 | $6.23 |
| Cache write (1-hour) | 466,202 | $4.00 | $1.86 |
| Direct input | 188 | $2.00 | $0.00 |
| Output (incl. thinking) | 368,744 | $10.00 | $3.69 |
| **Total** | | | **$11.78** |

- Model: sonnet-5.5
- Effort: extra-high
- Cost: $11.78
- Site: https://kjlkurt.github.io/waterslide-game-sonnet-5.5/# waterslide-game-sonnet-5.5-
