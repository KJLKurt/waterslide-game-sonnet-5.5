// Plays a race with the autopilot in headless Chrome and saves screenshots: node scripts/play.mjs <url> <outDir> <profile> <times...>
import { chromium } from 'playwright-core';
const [url, outDir, profile = 'phone-portrait', ...times] = process.argv.slice(2);
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
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/${profile}-0-menu.png` });
await page.evaluate(() => { window.__game.autopilot = true; window.__game.startRace(false); });
let t = 0;
const marks = times.map(Number);
for (const target of marks) {
  await page.waitForTimeout(Math.max(0, (target - t) * 1000));
  t = target;
  await page.screenshot({ path: `${outDir}/${profile}-t${target}.png` });
  console.log(t, await page.evaluate(() => JSON.stringify(window.__game.debugState())));
}
console.log(logs.join('\n'));
await browser.close();
