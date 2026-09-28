// Teleport the autopiloted player and capture a frame sequence: node scripts/visual/seq.mjs <url> <outDir> <profile> <path:s:u:speed> <count> <intervalMs> [--high]
import { chromium } from 'playwright-core';
const [url, outDir, profile = 'phone-landscape', spot = 'S:8:0:22', count = '8', interval = '250'] = process.argv.slice(2);
const PROFILES = {
  'phone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  'phone-landscape': { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
};
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await (await browser.newContext(PROFILES[profile])).newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|vite/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.evaluate(() => { const g = window.__game; g.autopilot = true; g.autopilotSkill = 0.95; g.startRace(false); g.cd.t = 2.95; });
await page.waitForTimeout(700);
const [path, s, u, speed] = spot.split(':');
await page.evaluate(([p, s, u, sp]) => window.__game.debugPlace(p, +s, +u, +sp), [path, s, u ?? 0, speed ?? 22]);
for (let i = 0; i < Number(count); i++) {
  await page.waitForTimeout(Number(interval));
  await page.screenshot({ path: `${outDir}/seq-${profile}-${i}.png` });
  console.log(i, await page.evaluate(() => { const p = window.__game.debugState().player; return `${p.st} ${p.path} s=${p.s} u=${p.u} sp=${p.speed} y=${p.y}`; }));
}
console.log(logs.join('\n'));
await browser.close();
