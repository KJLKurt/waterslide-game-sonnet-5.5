import * as THREE from 'three';
import { buildTrack } from './game/trackData.js';
import { Race, RACER_COUNT } from './game/race.js';
import { State } from './game/racer.js';
import { AIDriver } from './game/ai.js';
import { Frame } from './game/track.js';
import { clamp } from './game/util.js';
import { createTrackMeshes } from './trackMesh.js';
import { createWorld } from './world.js';
import { CharacterPool, makeNpcLook, makePlayerLook } from './characters.js';
import { Particles, SpeedLines } from './vfx.js';
import { CameraRig } from './cameraRig.js';
import { Quality } from './quality.js';

const _f = new Frame();
const _focus = new THREE.Vector3();

export class Game {
  constructor({ canvas, ui, store, input, audio }) {
    this.canvas = canvas;
    this.ui = ui;
    this.store = store;
    this.input = input;
    this.audio = audio;
    this.quality = new Quality(store);
    this.state = 'menu'; // menu | countdown | racing | ended
    this.paused = false;
    this.time = 0;
    this.last = performance.now();
    this.fpsEma = 60;
    this.cd = { t: 0, shown: -1 };
    this.endAt = null;
    this.shortcutLanded = false;
    this.spectate = null;
    this.endListT = 0;
    this.post = null;
    this.postLoading = false;
    this.characterOpen = false;

    const st = this.quality.state;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: st.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0x78c6ff);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // mobile browsers can drop the GL context (backgrounding, memory pressure): recover with a clean reload
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1200);
    this.scene.add(this.camera);

    this.track = buildTrack();
    this.trackMesh = createTrackMeshes(this.track, this.renderer);
    this.scene.add(this.trackMesh.group);
    this.world = createWorld(this.scene, this.track, this.quality);
    this.chars = new CharacterPool(this.scene, RACER_COUNT);
    this.particles = new Particles(this.scene, 800);
    this.speedLines = new SpeedLines(this.camera);
    this.rig = new CameraRig(this.camera);
    // floating "you are here" arrow above the player's rider
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.quality.onChange = (s) => this.applyQuality(s);
    this.applyQuality(st, true);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'racing' || this.state === 'countdown') this.pause();
        this.audio.suspend();
      } else this.audio.resume();
    });

    this.input.onPause = () => {
      if (this.paused) this.resume();
      else if (this.state === 'racing' || this.state === 'countdown') this.pause();
    };

    this.newRace(this.store.settings.practiceDefault);
    this.enterMenu();
    this.audio.setEnabled(store.settings.sfx, store.settings.music);
    this.input.sensitivity = store.settings.sensitivity;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- quality / rendering setup
  applyQuality(s, first = false) {
    this.renderer.setPixelRatio(s.pixelRatio);
    this.renderer.shadowMap.enabled = s.shadows;
    const sun = this.world.sun;
    if (sun.castShadow !== s.shadows || sun.shadow.mapSize.x !== s.shadowMap) {
      sun.castShadow = s.shadows;
      sun.shadow.mapSize.set(s.shadowMap, s.shadowMap);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
    this.chars.setBlobShadows(!s.shadows);
    this.chars.setShadowCasting(s.shadows);
    this.speedLines.enabled = s.trail;
    this.trackMesh.material.map.anisotropy = s.pixelRatio > 1.2 ? 4 : 2;
    if (!first) this.resize();
    if (s.post && !this.post && !this.postLoading) {
      this.postLoading = true;
      import('./post.js').then((m) => {
        this.postLoading = false;
        if (!this.quality.state.post) return;
        const { w, h } = this.size;
        this.post = m.createPost(this.renderer, this.scene, this.camera, w, h, this.quality.state.pixelRatio);
      }).catch(() => { this.postLoading = false; });
    } else if (!s.post && this.post) {
      this.post.dispose();
      this.post = null;
    }
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.size = { w, h };
    this.renderer.setPixelRatio(this.quality.state.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.setAspect(w / h);
    this.ui.setLayout(w, h);
    this.post?.setSize(w, h, this.quality.state.pixelRatio);
    this.updateViewShift();
  }

  setCharacterOpen(open) {
    this.characterOpen = open;
    this.chars.solo = open ? this.player.index : null;
    this.updateViewShift();
  }

  updateViewShift() {
    const { w, h } = this.size;
    const v = this.rig.viewShift;
    v.tx = 0; v.ty = 0;
    if (this.state === 'menu') {
      if (this.characterOpen) { if (w > h) v.tx = w * 0.2; else v.ty = h * 0.2; }
      else if (w > h) v.tx = -w * (this.store.settings.handedness === 'left' ? -0.17 : 0.17);
      else v.ty = h * 0.2;
    }
  }

  // ---------------------------------------------------------------- race lifecycle
  newRace(practice) {
    this.race = new Race(this.track, {
      practice,
      difficulty: this.store.settings.difficulty,
      seed: (Math.random() * 1e9) | 0,
      playerSlot: 7,
    });
    this.race.onEvent = (r, ev) => this.onRaceEvent(r, ev);
    this.player = this.race.player;
    this.applyLooks();
    this.particles.clear();
    this.rig.snap = true;
    this.shortcutLanded = false;
    this.endAt = null;
    this.spectate = null;
    this.forkToast = false;
  }

  applyLooks() {
    const p = this.store.profile;
    let n = 0;
    this.race.racers.forEach((r) => {
      if (r.isPlayer) this.chars.looks[r.index] = makePlayerLook(p.palette, p.accessory);
      else { this.chars.looks[r.index] = makeNpcLook(n, (n * 3 + (this.race.seed % 4)) % 4); n++; }
    });
    this.chars.rebuild();
  }

  setPlayerLook(palette, accessory) {
    this.chars.looks[this.player.index] = makePlayerLook(palette, accessory);
    this.chars.rebuild();
  }

  enterMenu() {
    if (this.updatePending) { location.reload(); return; }
    this.state = 'menu';
    this.paused = false;
    this.input.enabled = false;
    this.input.reset();
    this.ui.hudVisible(false);
    this.ui.hideScreens();
    this.ui.countdown('');
    this.ui.syncMenu();
    this.ui.show('menu');
    this.audio.whoosh(0);
    this.audio.stopMusic();
    this.setCharacterOpen(false);
    this.newRace(this.ui.practice);
    this.rig.snap = true;
    this.updateViewShift();
  }

  startRace(practice) {
    document.activeElement?.blur?.();
    this.audio.unlock();
    this.audio.startMusic();
    this.setCharacterOpen(false);
    this.newRace(practice);
    this.quality.reset();
    this.ui.hideScreens();
    this.ui.hudVisible(true);
    this.ui.setMode(practice);
    this.ui.setJumpHint(false);
    this.ui.hint(null);
    this.ui.setEdge(0);
    this.ui.setHanded(this.store.settings.handedness);
    this.input.enabled = true;
    this.input.reset();
    this.state = 'countdown';
    this.paused = false;
    this.cd = { t: 0, shown: -1 };
    this.rig.snap = true;
    this.updateViewShift();
    if (this.autopilot) this.enableAutopilot();
    const touch = this.ui.root.classList.contains('touch');
    this.ui.tips(this.store.profile.stats.races < 3
      ? (touch ? 'Drag the left thumb to steer.\nTap JUMP at orange ramps. Stay on the slide!' : 'A / D or ← → to steer. Space to jump at orange ramps.\nStay on the slide!')
      : null);
  }

  enableAutopilot() {
    this.race.drivers[this.player.index] = new AIDriver({
      name: 'auto', skill: this.autopilotSkill ?? 0.9, risk: this.autopilotRisk ?? 0.85, aggression: 0.5,
      laneBias: 0, phase1: 1, phase2: 2, seed: 4242,
    });
  }

  pause() {
    if (this.paused || (this.state !== 'racing' && this.state !== 'countdown')) return;
    this.paused = true;
    this.input.enabled = false;
    this.input.reset();
    this.audio.whoosh(0);
    this.ui.show('pause');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.input.enabled = true;
    this.ui.hideScreens();
    this.audio.resume();
  }

  endRace() {
    if (this.state === 'ended') return;
    const race = this.race;
    const p = this.player;
    const finished = p.state === State.FINISHED;
    this.state = 'ended';
    this.input.enabled = false;
    this.input.reset();
    this.ui.hudVisible(false);
    this.ui.hint(null);
    this.ui.setEdge(0);
    this.audio.whoosh(0);
    const result = {
      practice: race.practice,
      finished,
      rank: finished ? p.finishRank : null,
      time: p.finishTime,
      shortcutLanded: this.shortcutLanded,
    };
    const rec = this.store.recordRace(result);
    this.ui.showEnd({
      dnf: !finished,
      rank: p.finishRank,
      total: RACER_COUNT,
      time: p.finishTime,
      best: this.store.profile.best[race.practice ? 'practice' : 'race'],
      newBest: rec.newBest,
      unlocked: rec.unlocked,
      practice: race.practice,
      progress: p.progress,
      list: this.resultList(),
    });
    this.audio.finish(finished && p.finishRank <= 3);
    if (!finished) {
      const alive = race.order.find((r) => r.state !== State.OUT && r.state !== State.FALLING);
      this.spectate = alive || race.order[0];
      this.rig.snap = true;
    }
  }

  resultList() {
    return this.race.results().map((r) => ({ rank: r.rank, name: r.name, isPlayer: r.isPlayer, time: r.time, status: r.status }));
  }

  // ---------------------------------------------------------------- race events -> feedback
  nearCamera(r, d = 90) {
    const c = this.camera.position;
    return (r.x - c.x) ** 2 + (r.y - c.y) ** 2 + (r.z - c.z) ** 2 < d * d;
  }

  vibrate(pattern) {
    if (this.store.settings.haptics && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
  }

  onRaceEvent(r, ev) {
    const isP = r.isPlayer;
    const q = this.quality.state;
    switch (ev.type) {
      case 'hop':
        if (isP) { this.audio.jump(); this.input.clearJump(); }
        break;
      case 'armed':
        if (isP) { this.input.clearJump(); this.audio.click(); this.ui.toast('Get ready…', 500); }
        break;
      case 'launch':
        if (isP) {
          this.audio.jump();
          if (ev.boosted) { this.audio.boost(); this.ui.toast('Big air!', 900); }
        }
        break;
      case 'land':
        if (r.path === this.track.S && isP) this.shortcutLanded = true;
        if (isP) {
          this.audio.land(ev.impact / 14);
          this.rig.jolt(clamp(ev.impact / 14, 0.2, 0.9));
          this.vibrate(14);
          if (ev.perfect) this.ui.toast('Perfect landing! Boost!', 1100);
        }
        if (q.splash && this.nearCamera(r)) {
          this.particles.burst(r.x, r.y + 0.2, r.z, isP ? 16 : 8, 3.2, 3.5, 0.85, 0.95, 1, 0.55);
          if (ev.perfect) this.particles.burst(r.x, r.y + 0.6, r.z, 14, 4.5, 4, 1, 0.85, 0.25, 0.5);
        }
        break;
      case 'fall':
        if (isP) { this.audio.splash(); this.vibrate([60, 30, 60]); this.rig.jolt(0.6); }
        else if (this.nearCamera(r, 60)) this.audio.bump();
        break;
      case 'out':
        if (q.splash && this.nearCamera(r, 160)) this.particles.burst(r.x, r.y, r.z, 30, 7, 5, 0.85, 0.95, 1, 0.9);
        if (isP && this.race.practice === false) this.endAt = this.race.time + 0.5;
        break;
      case 'respawn':
        if (isP) this.ui.toast('Back to checkpoint', 1100);
        break;
      case 'checkpoint':
        if (isP) { this.audio.checkpoint(); this.ui.toast(this.race.practice ? 'Checkpoint saved' : 'Checkpoint', 900); }
        break;
      case 'shortcut':
        if (isP) this.ui.toast('Shortcut! Jump the gap!', 1500);
        break;
      case 'finish':
        if (isP) { this.endAt = this.race.time + 1.9; this.vibrate([30, 40, 30]); this.audio.finish(true); this.ui.toast(r.finishRank === 1 ? 'YOU WIN!' : 'FINISH!', 1800); }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- main loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let rawDt = (now - this.last) / 1000;
    this.last = now;
    if (!(rawDt > 0)) rawDt = 1 / 60;
    rawDt = Math.min(rawDt, 0.1);
    this.fpsEma += (1 / rawDt - this.fpsEma) * 0.05;
    const dt = this.paused ? 0 : rawDt;
    this.time += rawDt;
    this.input.update(rawDt);
    this.quality.frame(rawDt, this.state === 'racing' || this.state === 'countdown');

    const race = this.race;
    switch (this.state) {
      case 'countdown': this.updateCountdown(dt); break;
      case 'racing': this.updateRacing(dt); break;
      case 'ended':
        race.update(dt, null);
        this.endListT -= rawDt;
        if (this.endListT <= 0 && this.ui.current === 'end') { this.endListT = 0.4; this.ui.updateEndList(this.resultList()); }
        break;
      default: break;
    }

    this.updateCamera(rawDt, dt);
    this.updateVisuals(rawDt, dt);
    this.render(rawDt);
  }

  updateCountdown(dt) {
    this.updateHud();
    if (dt === 0) return;
    this.cd.t += dt;
    const n = 3 - Math.floor(this.cd.t);
    if (this.cd.t < 3 && n !== this.cd.shown) {
      this.cd.shown = n;
      this.ui.countdown(String(n));
      this.audio.tick(false);
    }
    if (this.cd.t >= 3) {
      this.state = 'racing';
      this.race.go();
      this.input.clearJump();
      this.ui.countdown('GO!');
      this.ui.tips(null);
      this.audio.tick(true);
      this.ui.toast('', 1);
      if (this.autopilot) this.enableAutopilot();
    }
  }

  updateRacing(dt) {
    const race = this.race;
    if (dt > 0) {
      race.update(dt, { steer: this.input.steer, jump: this.input.jump });
      if (this.endAt != null && race.time >= this.endAt) this.endRace();
    }
    if (this.state !== 'racing') return;
    const p = this.player;
    this.updateHud();
    // ---- contextual hints: jump zones, fork, edge warning
    let jumpHint = false, hintText = null;
    if (p.state === State.SLIDING) {
      const lip = p.path.lipAhead(p.s, 46);
      if (lip && lip.s - p.s > 0 && lip.zone) {
        jumpHint = true;
        if (lip.s - p.s <= lip.zone.window) hintText = 'JUMP!';
      }
      p.path.frame(p.s, _f);
      const lim = _f.width * 0.5 - 0.3;
      this.ui.setEdge((Math.abs(p.u) / lim - 0.72) / 0.28);
      const z = this.track.decisionZones[0];
      if (!this.forkToast && p.path === z.path && p.s > z.s0 - 30) {
        this.forkToast = true;
        this.ui.toast('◀ LEFT: shortcut (jump the gap!)\nRIGHT: safe main route ▶', 3000);
      }
    } else this.ui.setEdge(0);
    this.ui.setJumpHint(jumpHint);
    this.ui.hint(hintText);
    this.audio.whoosh(clamp(p.speed / 30, 0, 1), p.state === State.AIRBORNE);
    this.audio.tickMusic(dt);
  }

  updateHud() {
    const race = this.race, p = this.player, order = race.order;
    const board = [];
    if (p.rank <= 5) for (let i = 0; i < 5; i++) board.push({ rank: i + 1, name: order[i].name, me: order[i] === p });
    else {
      for (let i = 0; i < 3; i++) board.push({ rank: i + 1, name: order[i].name, me: false });
      board.push({ gap: true });
      board.push({ rank: p.rank, name: p.name, me: true });
    }
    this.ui.hud({ rank: p.rank, total: RACER_COUNT, time: race.time, progress: p.state === State.FINISHED ? 1 : p.progress, speed: p.speed, board });
  }

  /** Debug helper (used by the e2e scripts): put the player somewhere on the track. */
  debugPlace(pathId, s, u = 0, speed = 20) {
    const p = this.player;
    p.place(this.track, this.track[pathId], s, u, speed);
    this.rig.snap = true;
  }

  updateCamera(rawDt, dt) {
    const rig = this.rig;
    const race = this.race;
    switch (this.state) {
      case 'menu': {
        const p = this.player;
        const portrait = this.size.w < this.size.h;
        const k = this.characterOpen ? 0.78 : 1;
        rig.orbitAround(rawDt, { x: p.x, y: p.y, z: p.z }, (portrait ? 9.6 : 8.6) * k, (portrait ? 2.9 : 2.7) * k, 0.3, this.characterOpen ? 0.8 : 0.95);
        break;
      }
      case 'countdown':
        rig.flyIn(rawDt, this.player, this.cd.t / 2.8, this.time);
        break;
      case 'racing':
        rig.chase(rawDt, this.player, this.time);
        break;
      case 'ended': {
        const tgt = this.spectate && this.spectate.state !== State.OUT ? this.spectate : this.player;
        if (this.player.state === State.FINISHED) rig.orbitAround(rawDt, { x: this.player.x, y: this.player.y, z: this.player.z }, 6.5, 2.4, 0.45, 1.0);
        else rig.chase(rawDt, tgt, this.time);
        break;
      }
      default: break;
    }
    rig.applyViewOffset(this.size.w, this.size.h, rawDt);
  }

  updateVisuals(rawDt, dt) {
    const race = this.race;
    const q = this.quality.state;
    const chars = this.chars;
    const t = this.time;
    const cam = this.camera.position;
    for (const r of race.racers) {
      let ground = null;
      if (r.state === State.SLIDING || r.state === State.FINISHED) ground = { x: r.x, y: r.y, z: r.z, nx: r.nx, ny: r.ny, nz: r.nz, h: 0 };
      else if (r.state === State.AIRBORNE) {
        const hit = this.track.raycastDown(r.x, r.y + 0.3, r.z, 90, 0.5);
        if (hit) ground = { x: r.x, y: hit.y, z: r.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, h: r.y - hit.y };
      }
      chars.pose(r.index, r, rawDt, t, ground);

      // wake behind sliding racers
      if (dt > 0 && this.state !== 'menu' && r.state === State.SLIDING && r.speed > 5) {
        const isP = r.isPlayer;
        if (isP ? q.trail : (q.trail && q.npcTrails && Math.random() < 0.45 && this.nearCamera(r, 70))) {
          const s = r.speed;
          for (let k = 0; k < (isP ? 2 : 1); k++) {
            this.particles.emit(
              r.x - r.fx * 0.7 + (Math.random() - 0.5) * 0.6, r.y + 0.12, r.z - r.fz * 0.7 + (Math.random() - 0.5) * 0.6,
              -r.fx * s * 0.12 + (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.2, -r.fz * s * 0.12 + (Math.random() - 0.5) * 1.2,
              0.45 + Math.random() * 0.25, 0.35, 1.3, 0.9, 0.97, 1, 3,
            );
          }
          if (r.boostTime > 0) this.particles.emit(r.x, r.y + 0.8, r.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 0.5, 0.5, 0.1, 1, 0.85, 0.2, 0);
        }
      }
    }
    chars.commit();
    const pl = this.player;
    const showMarker = this.state !== 'menu' && pl.state !== State.OUT && !(this.state === 'ended');
    this.marker.visible = showMarker;
    if (showMarker) {
      this.marker.position.set(pl.x + pl.nx * 2.55, pl.y + pl.ny * 2.55 + Math.sin(t * 5) * 0.1, pl.z + pl.nz * 2.55);
      this.marker.rotation.y = t * 2.5;
    }
    this.particles.update(dt);
    this.particles.setScale((this.size.h * q.pixelRatio) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    const sp = clamp(this.player.speed / 30, 0, 1);
    this.speedLines.update(rawDt, this.state === 'racing' ? sp : 0, this.camera.aspect, this.camera.fov);

    this.trackMesh.waterTex.offset.x -= rawDt * 0.85;
    _focus.set(this.player.x, this.player.y, this.player.z);
    this.world.update(rawDt, _focus);
  }

  render(rawDt) {
    if (this.contextLost) return;
    if (this.post) this.post.render(rawDt);
    else this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- settings from UI
  onSetting(key, value) {
    const s = this.store.settings;
    switch (key) {
      case 'sfx': case 'music': this.audio.setEnabled(s.sfx, s.music); break;
      case 'sensitivity': this.input.sensitivity = s.sensitivity; break;
      case 'handedness': this.ui.setHanded(s.handedness); this.updateViewShift(); break;
      case 'graphics': this.quality.reset(); break;
      case 'difficulty': if (this.state === 'menu') this.newRace(this.ui.practice); break;
      default: this.quality.recompute(); break;
    }
    if (['shadows', 'post', 'trail', 'splash'].includes(key)) this.quality.recompute();
  }

  debugState() {
    const p = this.player;
    return {
      state: this.state, paused: this.paused, time: this.race.time, fps: Math.round(this.fpsEma),
      player: { st: p.state, path: p.path?.id, s: +p.s.toFixed(1), u: +p.u.toFixed(2), speed: +p.speed.toFixed(1), rank: p.rank, progress: +p.progress.toFixed(3), y: +p.y.toFixed(1) },
      quality: this.quality.state, drawCalls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles,
    };
  }
}
