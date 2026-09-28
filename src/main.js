import './style.css';
import { Store } from './storage.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';
import { Game } from './game.js';
import { isMobileDevice } from './storage.js';

const boot = document.getElementById('boot');
const params = new URLSearchParams(location.search);
const debug = params.has('debug') || import.meta.env.DEV;

function fail(msg) {
  boot.innerHTML = `<div style="padding:24px;text-align:center;max-width:420px">😕<br/>${msg}</div>`;
}

// ---- keep the page from scrolling / zooming while playing
const blockZoom = (e) => e.preventDefault();
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, blockZoom, { passive: false }));
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest?.('.scroll-y')) e.preventDefault();
}, { passive: false });
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function start() {
  const store = new Store();
  const input = new Input();
  const audio = new AudioFX();
  let game = null;
  const ui = new UI(document.getElementById('ui'), store, {
    onPlay: (practice) => { audio.unlock(); game.startRace(practice); },
    onAgain: () => { audio.unlock(); game.startRace(game.race.practice); },
    onPause: () => game.pause(),
    onResume: () => game.resume(),
    onRestart: () => { game.resume(); game.startRace(game.race.practice); },
    onQuit: () => game.enterMenu(),
    onSetting: (k, v) => game.onSetting(k, v),
    onLook: (pal, acc) => game.setPlayerLook(pal, acc),
    onCharacterOpen: (open) => game.setCharacterOpen(open),
    onReset: () => { game.applyLooks(); },
    onClick: () => { audio.unlock(); audio.click(); },
  });
  ui.setTouch(isMobileDevice());
  window.addEventListener('touchstart', () => ui.setTouch(true), { once: true, passive: true });
  ui.setHanded(store.settings.handedness);
  input.attach({ zone: ui.el.zone, base: ui.el.base, thumb: ui.el.thumb, jumpBtn: ui.el.jump });
  input.onAnyKey = (e) => {
    if (e.code === 'Enter' && game.state === 'menu' && ui.current === 'menu') { audio.unlock(); game.startRace(ui.practice); }
  };

  game = new Game({ canvas: document.getElementById('game'), ui, store, input, audio });
  if (debug) {
    window.__game = game;
    if (params.has('autopilot')) game.autopilot = true;
  }
  ui.setOffline(false);
  requestAnimationFrame(() => requestAnimationFrame(() => boot.classList.add('done')));
  setTimeout(() => boot.remove(), 900);
  return { ui, get game() { return game; } };
}

let app = null;
try {
  app = start();
} catch (err) {
  console.error(err);
  fail('Could not start the game. This game needs a browser with WebGL enabled.');
}

// ---- service worker: precaches the built app so it loads offline; scoped to this app's base path
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const base = import.meta.env.BASE_URL;
  const hadController = !!navigator.serviceWorker.controller;
  // a new build took over: refresh right away in the menu, otherwise as soon as the player is back there
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const g = window.__game || app?.game;
    if (!g || g.state === 'menu') location.reload();
    else if (g) g.updatePending = true;
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        const check = () => app?.ui.setOffline(!!(reg.active && navigator.serviceWorker.controller) || reg.active?.state === 'activated');
        if (reg.active) check();
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => { if (w.state === 'activated') check(); });
        });
        navigator.serviceWorker.ready.then(() => app?.ui.setOffline(true, '✓ Ready to play offline'));
      })
      .catch((e) => console.warn('SW registration failed', e));
  });
}
