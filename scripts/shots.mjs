// Dev helper: capture gameplay screenshots for several viewports/themes in one run.
// Usage: node scripts/shots.mjs <outDir> [baseUrl]
import { chromium } from 'playwright-core';
const outDir = process.argv[2] || '.';
const base = process.argv[3] || 'http://localhost:8080/';
const cases = JSON.parse(process.env.SHOT_CASES || '[]');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const c of cases) {
  const context = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr || 1, hasTouch: !!c.touch, isMobile: !!c.mobile });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?debug&seed=${c.seed || 7}${c.query || ''}`);
  await page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
  await page.evaluate((theme) => { window.__avalanche.store.markTutorialDone(); if (theme) window.__avalanche.app.setTheme(theme); document.querySelector('[style*="monospace"]')?.remove(); }, c.theme);
  if (c.menu) {
    await page.waitForTimeout(800);
  } else {
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__avalanche.state().phase === 'playing', null, { timeout: 30000 });
    if (c.catchAt) {
      // A coin that lands in the scoop at x = 0, plus a shield beside it, to show catch feedback.
      await page.evaluate(() => {
        const a = window.__avalanche;
        a.clearUpcoming();
        a.injectDrop('cash', 0.2, 1.0);
        a.injectDrop('reverse', -5, 1.2);
        a.injectDrop('fire', 5.5, 1.5);
      });
    } else if (c.inject !== false) {
      await page.evaluate(() => {
        const a = window.__avalanche;
        ['coin', 'cash', 'shield', 'expand', 'shrink', 'fire', 'reverse'].forEach((t, i) => a.injectDrop(t, -6 + i * 2, 1.2 + i * 0.05));
      });
    }
    const stopTick = Math.round((c.at || 1) * 120);
    await page.waitForFunction((t) => window.__avalanche.state().tick >= t, stopTick, { timeout: 60000 });
    await page.evaluate(() => { window.__avalanche.app.pause(); window.__avalanche.app.ui.closeAll(); });
    await page.waitForTimeout(400);
  }
  const file = `${outDir}/${c.name}.png`;
  await page.screenshot({ path: file });
  console.log(`${c.name}: ${logs.length ? logs.join(' | ') : 'ok'} hud=${await page.evaluate(() => document.getElementById('frame').dataset.hud)}`);
  await context.close();
}
await browser.close();
