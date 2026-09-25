// Dev helper: capture several frames over time (to review background motion). Output PNGs in <outDir>.
//   node scripts/filmstrip.mjs <outDir> <theme> [frames] [gapMs] [width] [height] [play]
import { chromium } from 'playwright-core';
const [, , outDir = '.', theme = 'ice', frames = '4', gap = '1400', w = '1366', h = '768', play = '1'] = process.argv;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto('http://localhost:8080/?debug&seed=11');
await page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
await page.evaluate((t) => { const a = window.__avalanche; a.store.markTutorialDone(); a.app.setTheme(t); document.querySelector('[style*="monospace"]')?.remove(); }, theme);
if (play === '1') {
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__avalanche.state().phase === 'playing', null, { timeout: 20000 });
}
await page.waitForTimeout(2500);
for (let i = 0; i < +frames; i++) {
  await page.screenshot({ path: `${outDir}/${theme}-${i}.png` });
  await page.waitForTimeout(+gap);
}
console.log(JSON.stringify(await page.evaluate(() => window.__avalanche.app.renderer.life.stats)));
await browser.close();
