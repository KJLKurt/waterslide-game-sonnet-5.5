// Screenshots every UI screen: node scripts/screens.mjs <url> <outDir> <profile>
import { chromium } from 'playwright-core';
const [url, outDir, profile = 'phone-portrait'] = process.argv.slice(2);
const PROFILES = {
  'phone-portrait': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'phone-landscape': { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  'tiny-portrait': { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'tiny-landscape': { viewport: { width: 568, height: 320 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  small: { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext(PROFILES[profile]);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|vite/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${profile}-${n}.png` }); };
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
await shot('menu');
await click('.menu [data-act=settings]'); await shot('settings');
await click('[data-act=close-settings]');
await click('.menu [data-act=character]'); await shot('character');
await click('[data-act=close-character]');
await page.evaluate(() => { const g = window.__game; g.autopilot = true; g.startRace(false); g.cd.t = 2.9; });
await page.waitForTimeout(3500);
await click('.hud [data-act=pause]'); await shot('pause');
await click('.pause [data-act=resume]');
// force end screen with a fake DNF
await page.evaluate(() => { const g = window.__game; g.player.state = 4; g.player.dnf = true; g.player.fellAtProgress = 0.42; g.endRace(); });
await shot('end-dnf');
console.log(logs.join('\n') || 'no console errors');
await browser.close();
