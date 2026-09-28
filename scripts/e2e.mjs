// End-to-end checks against the PRODUCTION build served under a sub-path (like GitHub Pages).
//   node scripts/e2e.mjs            (builds with BASE_PATH=/splash-rush/ and runs headless Chrome)
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const BASE = '/splash-rush/';
const PORT = 4181;
const ORIGIN = `http://localhost:${PORT}`;
const URL_ = `${ORIGIN}${BASE}?debug`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${msg}`); } else { fail++; console.log(`  FAIL ${msg} ${extra}`); }
};
const section = (t) => console.log(`\n== ${t}`);

console.log('building with base', BASE);
execSync('npx vite build', { stdio: 'pipe', env: { ...process.env, BASE_PATH: BASE } });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', env: { ...process.env, BASE_PATH: BASE } });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server timeout')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

const errors = [];
async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { ctx, page };
}
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 720 } };
const gs = (page) => page.evaluate(() => window.__game.debugState());
const waitFor = async (page, fn, arg, timeout = 60000) => { await page.waitForFunction(fn, arg, { timeout, polling: 200 }); };
const ptr = (page, sel, type, id, x, y) => page.evaluate(([sel, type, id, x, y]) => {
  document.querySelector(sel).dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1 }));
}, [sel, type, id, x, y]);
const clickSel = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

try {
  // ------------------------------------------------------------------ PWA / sub-path
  section('PWA, sub-path hosting, offline');
  {
    const { ctx, page } = await newPage(PHONE);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      return { scope: r.scope, script: r.active.scriptURL, state: r.active.state };
    });
    ok(reg.scope === `${ORIGIN}${BASE}`, `service worker scope is ${ORIGIN}${BASE}`, JSON.stringify(reg));
    ok(reg.script === `${ORIGIN}${BASE}sw.js`, 'service worker script lives inside the app path');
    const caches_ = await page.evaluate(() => caches.keys());
    ok(caches_.length === 1 && caches_[0].startsWith(`splash-rush:${BASE}:`), `cache is namespaced by scope path (${caches_})`);
    const cached = await page.evaluate(async () => { const c = await caches.open((await caches.keys())[0]); return (await c.keys()).map((r) => new URL(r.url).pathname); });
    ok(cached.some((p) => p.endsWith('/index.html')) && cached.some((p) => /\/assets\/index-.*\.js$/.test(p)) && cached.some((p) => /\/assets\/post-.*\.js$/.test(p)) && cached.some((p) => p.endsWith('manifest.webmanifest')) && cached.some((p) => p.endsWith('icon-512.png')),
      `precache holds shell + JS + lazy chunk + manifest + icons (${cached.length} entries)`);
    ok(cached.every((p) => p.startsWith(BASE)), 'every cached URL is inside the scope');
    const man = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    ok(man.scope === './' && man.start_url === './' && man.icons.length >= 3, 'manifest uses relative scope/start_url', JSON.stringify(man).slice(0, 120));
    // wait for the page to be controlled (clients.claim), then go offline and reload
    await waitFor(page, () => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const st = await gs(page);
    ok(st.state === 'menu', 'offline reload boots into the menu');
    // lazy chunk (bloom) must also load offline
    await clickSel(page, '.menu [data-act=settings]');
    await page.evaluate(() => document.querySelector('[data-tog=post]').click());
    await waitFor(page, () => !!window.__game.post, undefined, 20000).catch(() => {});
    const hasPost = await page.evaluate(() => !!window.__game.post);
    ok(hasPost, 'optional post-processing chunk loads from the offline cache');
    await ctx.close();
  }

  // ------------------------------------------------------------------ storage + settings
  section('local storage & settings');
  {
    const { ctx, page } = await newPage(PHONE);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const st0 = await gs(page);
    ok(st0.quality.pixelRatio <= 1.5 && st0.quality.shadows === false && st0.quality.post === false, 'mobile defaults: pixel ratio cap 1.5, shadows off, post off', JSON.stringify(st0.quality));
    await clickSel(page, '.menu [data-act=settings]');
    await page.evaluate(() => { document.querySelector('[data-set=handedness][data-val=left]').click(); document.querySelector('[data-set=graphics][data-val=low]').click(); document.querySelector('[data-tog=practiceDefault]').click(); });
    const stLow = await gs(page);
    ok(stLow.quality.pixelRatio === 1 && stLow.quality.shadows === false && stLow.quality.post === false, 'graphics=low forces pixel ratio 1.0 and disables shadows/post', JSON.stringify(stLow.quality));
    const keys = await page.evaluate(() => Object.keys(localStorage));
    ok(keys.length > 0 && keys.every((k) => k.startsWith(`splash-rush@${BASE}:`)), `localStorage keys are namespaced by path (${keys})`);
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const persisted = await page.evaluate(() => ({ left: document.querySelector('.ui').classList.contains('left-handed'), practice: window.__game.ui.practice, graphics: window.__game.store.settings.graphics }));
    ok(persisted.left && persisted.practice && persisted.graphics === 'low', 'settings persist across reloads', JSON.stringify(persisted));
    await ctx.close();
  }

  // ------------------------------------------------------------------ touch input, portrait
  section('touch controls (portrait, multi-touch)');
  {
    const { ctx, page } = await newPage(PHONE);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    ok(await page.evaluate(() => document.querySelector('.ui').classList.contains('touch') && document.querySelector('.ui').classList.contains('portrait')), 'touch + portrait layout classes');
    await clickSel(page, '.menu [data-act=play]');
    await waitFor(page, () => window.__game.state === 'racing', undefined, 30000);
    await page.waitForTimeout(1500);
    // hold the joystick to the right...
    await ptr(page, '.joy-zone', 'pointerdown', 1, 90, 700);
    await ptr(page, '.joy-zone', 'pointermove', 1, 160, 700);
    let steer = await page.evaluate(() => window.__game.input.steer);
    ok(steer > 0.6, `joystick drag right steers right (${steer.toFixed(2)})`);
    // ...and press JUMP with a second finger while still steering
    await ptr(page, '.jump-btn', 'pointerdown', 2, 320, 760);
    await page.waitForTimeout(250);
    steer = await page.evaluate(() => window.__game.input.steer);
    const air = await page.evaluate(() => window.__game.player.state);
    ok(steer > 0.6, 'steering stays active while the jump finger is down (multi-touch safe)', String(steer));
    ok(air === 1, 'jump button lifts the rider into the Airborne state', String(air));
    await ptr(page, '.jump-btn', 'pointerup', 2, 320, 760);
    await ptr(page, '.joy-zone', 'pointerup', 1, 160, 700);
    steer = await page.evaluate(() => window.__game.input.steer);
    ok(Math.abs(steer) < 0.05, 'releasing the stick recentres steering');
    // page must not scroll / zoom
    const scroll = await page.evaluate(() => { window.scrollTo(0, 500); return [window.scrollY, document.documentElement.scrollWidth, window.innerWidth, getComputedStyle(document.body).touchAction, document.querySelector('meta[name=viewport]').content]; });
    ok(scroll[0] === 0 && scroll[1] <= scroll[2], 'page cannot scroll (no overflow)', JSON.stringify(scroll));
    ok(scroll[3] === 'none' && /user-scalable=no/.test(scroll[4]), 'touch-action:none and zoom disabled via viewport meta');
    const ev = await page.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); document.getElementById('game').dispatchEvent(e); return e.defaultPrevented; });
    ok(ev, 'touchmove default is prevented while playing');
    await ctx.close();
  }

  // ------------------------------------------------------------------ keyboard + orientation
  section('keyboard (desktop) & orientation');
  {
    const { ctx, page } = await newPage(DESKTOP);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    ok(await page.evaluate(() => !document.querySelector('.ui').classList.contains('touch')), 'desktop hides touch controls');
    await clickSel(page, '.menu [data-act=play]');
    await waitFor(page, () => window.__game.state === 'racing', undefined, 30000);
    await page.waitForTimeout(1500);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(400);
    const s1 = await page.evaluate(() => window.__game.input.steer);
    await page.keyboard.up('KeyD');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(400);
    const s2 = await page.evaluate(() => window.__game.input.steer);
    await page.keyboard.up('ArrowLeft');
    ok(s1 > 0.5 && s2 < -0.5, `D / ArrowLeft steer right / left (${s1.toFixed(2)}, ${s2.toFixed(2)})`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    ok((await page.evaluate(() => window.__game.player.state)) === 1, 'Space jumps');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => window.__game.paused), 'Escape pauses');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => !window.__game.paused), 'Escape resumes');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelector('.ui').classList.contains('landscape')), 'landscape layout after rotating');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelector('.ui').classList.contains('portrait')), 'portrait layout after rotating back');
    await ctx.close();
  }

  // ------------------------------------------------------------------ falling: race vs practice
  section('falling (race = lose, practice = respawn at checkpoint)');
  {
    const { ctx, page } = await newPage(PHONE);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    await page.evaluate(() => window.__game.startRace(false));
    await waitFor(page, () => window.__game.state === 'racing', undefined, 30000);
    await page.waitForTimeout(800);
    // slide off the edge of the trunk (u beyond half width)
    await page.evaluate(() => window.__game.debugPlace('T', 60, 5.7, 22));
    await waitFor(page, () => window.__game.ui.current === 'end', undefined, 30000);
    const end = await page.evaluate(() => ({ badge: document.querySelector('.end-badge').textContent, title: document.querySelector('.end-title').textContent, rows: document.querySelectorAll('.end-list .row').length, falls: window.__game.store.profile.stats.falls }));
    ok(/Splash/.test(end.badge) && /fell/.test(end.title), `race mode: player leaves the slide and loses (${end.title})`);
    ok(end.rows === 13, 'end screen lists all 13 racers');
    ok(end.falls >= 1, 'fall recorded in stats');
    await clickSel(page, '.end [data-act=menu]');
    await page.evaluate(() => window.__game.startRace(true));
    await waitFor(page, () => window.__game.state === 'racing', undefined, 30000);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__game.debugPlace('T', 120, 5.7, 22));
    await waitFor(page, () => window.__game.player.state === 2, undefined, 20000);
    await waitFor(page, () => window.__game.player.state === 0 && window.__game.player.invuln > 0, undefined, 30000);
    const st = await gs(page);
    ok(st.state === 'racing' && st.player.st === 0, 'practice mode: falling respawns the rider at the last checkpoint and the race continues', JSON.stringify(st.player));
    await ctx.close();
  }

  // ------------------------------------------------------------------ full race, persistence
  section('full race with autopilot, results, best time, unlocks');
  {
    const { ctx, page } = await newPage(PHONE);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    await page.evaluate(() => { const g = window.__game; g.autopilot = true; g.startRace(false); });
    await waitFor(page, () => window.__game.ui.current === 'end', undefined, 150000);
    const r = await page.evaluate(() => ({
      badge: document.querySelector('.end-badge').textContent, time: document.querySelector('.end-time').textContent,
      best: window.__game.store.profile.best.race, unlocks: window.__game.store.profile.unlocks, rows: [...document.querySelectorAll('.end-list .row i')].map((e) => e.textContent),
      unlockedText: document.querySelector('.end-unlock').textContent,
    }));
    ok(/^\d+(st|nd|rd|th)$/.test(r.badge), `finish position shown (${r.badge})`);
    ok(/Time \d:\d\d\.\d\d/.test(r.time), `finish time shown (${r.time})`);
    ok(r.best > 30 && r.best < 90, `best time stored (${r.best?.toFixed?.(2)}s)`);
    ok(r.unlocks.includes('pal:3') && /Mint/.test(r.unlockedText), 'finishing a race unlocks a palette');
    await page.waitForTimeout(3000);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.end-list .row i')].map((e) => e.textContent));
    console.log('   results column:', rows.join(' '));
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const menuBest = await page.evaluate(() => document.querySelector('.best').textContent);
    ok(/\d:\d\d\.\d\d/.test(menuBest), `best time persists across reload (${menuBest})`);
    await ctx.close();
  }

  section('rendering budget');
  {
    const { ctx, page } = await newPage(PHONE);
    await page.goto(URL_, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    await page.evaluate(() => { const g = window.__game; g.autopilot = true; g.startRace(false); g.cd.t = 2.9; });
    await page.waitForTimeout(6000);
    const st = await gs(page);
    console.log('   drawCalls', st.drawCalls, 'triangles', st.tris, 'fps(software GL)', st.fps);
    ok(st.drawCalls < 60, `draw calls stay low (${st.drawCalls})`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ two apps, one origin, relative base
  section('coexisting with other PWAs on the same origin (default relative base)');
  {
    const REL = path.resolve('node_modules/.cache/e2e-rel');
    execSync(`npx vite build --outDir ${REL} --emptyOutDir`, { stdio: 'pipe', env: { ...process.env, BASE_PATH: '' } });
    const mounts = ['/app-a/', '/deep/app-b/'];
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const m = mounts.find((p) => u.pathname.startsWith(p));
      if (!m) { res.writeHead(404); return res.end('nope'); }
      let rel = u.pathname.slice(m.length) || 'index.html';
      const file = path.join(REL, rel);
      if (!file.startsWith(REL) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', Vary: 'Origin' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => srv.listen(4182, r));
    const O = 'http://localhost:4182';
    const { ctx, page } = await newPage(PHONE);
    await page.goto(`${O}/app-a/?debug`, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const regA = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    ok(regA === `${O}/app-a/`, `relative base works under /app-a/ (scope ${regA})`);
    // another PWA's cache + a stale cache of app B must survive / be pruned correctly
    await page.evaluate(async () => { await caches.open('some-other-pwa:v3'); await caches.open('splash-rush:/deep/app-b/:stale'); });
    await page.evaluate(() => { document.querySelector('.menu [data-act=settings]').click(); document.querySelector('[data-set=difficulty][data-val=hard]').click(); });
    const keysA = await page.evaluate(() => Object.keys(localStorage));
    await page.goto(`${O}/deep/app-b/?debug`, { waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    const regB = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    ok(regB === `${O}/deep/app-b/`, `relative base works under /deep/app-b/ (scope ${regB})`);
    await waitFor(page, () => !!navigator.serviceWorker.controller);
    const names = await page.evaluate(() => caches.keys());
    ok(names.includes('some-other-pwa:v3'), 'a foreign PWA cache on the same origin is left untouched');
    ok(names.some((n) => n.startsWith('splash-rush:/app-a/:')), "app A's cache is left untouched by app B");
    ok(names.some((n) => n.startsWith('splash-rush:/deep/app-b/:') && !n.endsWith(':stale')) && !names.includes('splash-rush:/deep/app-b/:stale'), "app B prunes only its own stale caches", names.join(', '));
    const keysB = await page.evaluate(() => Object.keys(localStorage));
    ok(keysA.length > 0 && keysA.every((k) => k.startsWith('splash-rush@/app-a/:')), `app A storage keys: ${keysA}`);
    ok(!keysB.some((k) => k.startsWith('splash-rush@/deep/app-b/:difficulty')) && (await page.evaluate(() => window.__game.store.settings.difficulty)) === 'normal', "app B does not see app A's settings (separate namespaces)");
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => !!window.__game);
    ok((await gs(page)).state === 'menu', 'app B boots offline from its own scoped cache');
    await ctx.close();
    srv.close();
  }

  section('console');
  const realErrors = errors.filter((e) => !/GPU stall|ReadPixels/.test(e));
  ok(realErrors.length === 0, `no console errors (${realErrors.length})`, realErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
