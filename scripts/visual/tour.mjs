// Teleports the (autopiloted) player to interesting track spots and screenshots each one.
// node scripts/tour.mjs <url> <outDir> <profile> path:s[:u[:speed]] ...
import { chromium } from 'playwright-core';
const [url, outDir, profile = 'phone-portrait', ...spots] = process.argv.slice(2);
const PROFILES = {
  'phone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'phone-landscape': { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
};
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext(PROFILES[profile]);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|vite/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => { const g = window.__game; g.store.set('graphics', 'high'); g.quality.reset(); g.autopilot = true; g.startRace(false); g.cd.t = 2.95; });
await page.waitForTimeout(800);
let i = 0;
for (const spot of spots) {
  const [path, s, u = '0', speed = '22'] = spot.split(':');
  await page.evaluate(([path, s, u, speed]) => { window.__game.debugPlace(path, +s, +u, +speed); }, [path, s, u, speed]);
  await page.waitForTimeout(900);
  const name = `${outDir}/${profile}-spot${i++}-${path}${s}.png`;
  await page.screenshot({ path: name });
  console.log(name, await page.evaluate(() => JSON.stringify(window.__game.debugState().player)));
}
console.log(logs.join('\n'));
await browser.close();
