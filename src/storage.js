/**
 * Local-only persistence. Everything lives in localStorage under a key namespace derived from the
 * app's URL path, because every GitHub Pages project on the same user site shares one origin (and
 * therefore one localStorage). Falls back to in-memory storage if the browser blocks storage.
 */
import { FREE_UNLOCKS, UNLOCKS } from './cosmetics.js';

const APP = 'splash-rush';
const scopePath = (() => {
  try {
    return new URL(import.meta.env.BASE_URL, location.href).pathname;
  } catch {
    return '/';
  }
})();
export const NAMESPACE = `${APP}@${scopePath}`;

const memory = new Map();
function read(key) {
  try {
    const v = localStorage.getItem(`${NAMESPACE}:${key}`);
    if (v != null) return JSON.parse(v);
  } catch { /* storage unavailable or corrupt */ }
  return memory.has(key) ? memory.get(key) : null;
}
function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(`${NAMESPACE}:${key}`, JSON.stringify(value));
  } catch { /* quota / private mode */ }
}

export const isMobileDevice = () => {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  return coarse || (touch && Math.min(screen.width, screen.height) < 900);
};

export const DEFAULT_SETTINGS = () => ({
  graphics: 'auto', // auto | low | medium | high
  shadows: !isMobileDevice(),
  post: false,
  trail: true, // speed lines + wake
  splash: true, // splash / fall particles
  sensitivity: 1,
  handedness: 'right',
  sfx: true,
  music: true,
  haptics: true,
  difficulty: 'normal',
  practiceDefault: false,
});

const DEFAULT_PROFILE = () => ({
  v: 1,
  best: { race: null, practice: null },
  palette: 0,
  accessory: 1,
  unlocks: [...FREE_UNLOCKS],
  stats: { races: 0, finished: 0, wins: 0, falls: 0 },
});

export class Store {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS(), ...(read('settings') || {}) };
    const p = read('profile') || {};
    this.profile = { ...DEFAULT_PROFILE(), ...p };
    this.profile.best = { ...DEFAULT_PROFILE().best, ...(p.best || {}) };
    this.profile.stats = { ...DEFAULT_PROFILE().stats, ...(p.stats || {}) };
    this.profile.unlocks = Array.from(new Set([...FREE_UNLOCKS, ...(p.unlocks || [])]));
    if (!this.isUnlocked(`pal:${this.profile.palette}`)) this.profile.palette = 0;
    if (!this.isUnlocked(`acc:${this.profile.accessory}`)) this.profile.accessory = 1;
  }

  saveSettings() { write('settings', this.settings); }
  saveProfile() { write('profile', this.profile); }

  set(key, value) {
    this.settings[key] = value;
    this.saveSettings();
  }

  isUnlocked(id) { return this.profile.unlocks.includes(id); }

  setLook(palette, accessory) {
    if (palette != null && this.isUnlocked(`pal:${palette}`)) this.profile.palette = palette;
    if (accessory != null && this.isUnlocked(`acc:${accessory}`)) this.profile.accessory = accessory;
    this.saveProfile();
  }

  /** Record a finished/abandoned race. Returns { newBest, unlocked:[...] }. */
  recordRace(result) {
    const p = this.profile;
    p.stats.races++;
    if (result.finished) p.stats.finished++;
    if (result.finished && !result.practice && result.rank === 1) p.stats.wins++;
    if (!result.finished) p.stats.falls++;
    let newBest = false;
    if (result.finished) {
      const key = result.practice ? 'practice' : 'race';
      if (p.best[key] == null || result.time < p.best[key]) {
        p.best[key] = result.time;
        newBest = true;
      }
    }
    const unlocked = [];
    for (const u of UNLOCKS) {
      if (!p.unlocks.includes(u.id) && u.test(result, p.stats)) {
        p.unlocks.push(u.id);
        unlocked.push(u);
      }
    }
    this.saveProfile();
    return { newBest, unlocked };
  }

  reset() {
    this.profile = DEFAULT_PROFILE();
    this.saveProfile();
  }
}
