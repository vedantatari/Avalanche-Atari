// Records a real gameplay clip: a simple bot plays with real keyboard input (it reads rock
// positions through the ?debug hook to decide where to steer). Output: a .webm in <outDir>.
//   node scripts/record.mjs <outDir> [level] [seed] [seconds]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [, , outDir = 'docs/verification', level = '6', seed = '2026', seconds = '11.5'] = process.argv;
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const size = { width: 1280, height: 720 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
const videoStart = Date.now();
const page = await context.newPage();
await page.goto(`http://localhost:8080/?debug&seed=${seed}`);
await page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
await page.evaluate((l) => {
  const a = window.__avalanche;
  a.store.markTutorialDone();
  a.store.data.unlockedLevel = Math.max(a.store.data.unlockedLevel, +l);
  a.app.selectLevel(+l);
  document.querySelector('[style*="monospace"]')?.remove(); // hide the debug readout
}, level);
await page.click('#btn-play');
await page.waitForFunction(() => window.__avalanche.state().phase === 'playing', null, { timeout: 20000 });
const playStart = Date.now();

const GOOD = new Set(['coin', 'cash', 'shield', 'expand']);
function chooseTarget(s) {
  const vmax = 11.2 * 0.8;
  const upcoming = s.falling.filter((d) => d.at > s.t + 0.05).sort((a, b) => a.at - b.at);
  let target = s.x;
  for (const d of upcoming) {
    if (!GOOD.has(d.type)) continue;
    if (Math.abs(d.x - s.x) <= vmax * (d.at - s.t) + s.w / 2) {
      target = d.x;
      break;
    }
  }
  for (const d of upcoming) {
    if (GOOD.has(d.type) || d.at - s.t > 0.7) continue;
    const clear = s.w / 2 + 0.9;
    if (Math.abs(target - d.x) < clear) target = target >= d.x ? d.x + clear : d.x - clear;
  }
  return Math.max(-8 + s.w / 2, Math.min(8 - s.w / 2, target));
}

let held = null;
while ((Date.now() - playStart) / 1000 < +seconds) {
  const s = await page.evaluate(() => {
    const a = window.__avalanche;
    const st = a.sim.stage;
    return {
      x: a.sim.cart.x,
      w: a.sim.cart.width,
      t: a.sim.time,
      reversed: a.sim.isReversed(),
      phase: a.sim.phase,
      falling: st ? st.falling.filter((d) => !d.resolved).map((d) => ({ type: d.type, x: d.x, at: d.arriveAt })) : [],
    };
  });
  if (s.phase !== 'playing') break;
  const target = chooseTarget(s);
  let dir = Math.abs(target - s.x) < 0.3 ? 0 : Math.sign(target - s.x);
  if (s.reversed) dir = -dir; // the bot knows controls are flipped, like a player would
  const key = dir < 0 ? 'ArrowLeft' : dir > 0 ? 'ArrowRight' : null;
  if (key !== held) {
    if (held) await page.keyboard.up(held);
    if (key) await page.keyboard.down(key);
    held = key;
  }
  await page.waitForTimeout(30);
}
if (held) await page.keyboard.up(held);
const final = await page.evaluate(() => window.__avalanche.state());
const video = page.video();
await context.close();
const path = await video.path();
const info = { video: path, playStartOffset: (playStart - videoStart) / 1000, level: +level, seed: +seed, final: { score: final.score, lives: final.lives, bank: final.bank, caught: final.caught } };
writeFileSync(`${outDir}/recording.json`, JSON.stringify(info, null, 2));
console.log(JSON.stringify(info));
await browser.close();
