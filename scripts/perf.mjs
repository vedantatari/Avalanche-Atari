// Measures frame pacing during busy play in GPU-backed headless Chrome, next to a blank-page
// baseline (headless Chrome may cap requestAnimationFrame below the display rate).
//   node scripts/perf.mjs [width] [height] [level] [quality]
import { chromium } from 'playwright-core';

const [, , w = '1920', h = '1080', level = '30', quality = ''] = process.argv;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const sample = (ms) =>
  page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const start = last;
        requestAnimationFrame(function f(now) {
          times.push(now - last);
          last = now;
          if (now - start < dur) requestAnimationFrame(f);
          else {
            times.sort((a, b) => a - b);
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            resolve({ fps: +(1000 / avg).toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1) });
          }
        });
      }),
    ms,
  );

await page.goto('about:blank');
const baseline = await sample(3000);

await page.goto(`http://localhost:8080/?debug&seed=3`);
await page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
await page.evaluate(
  ({ l, q }) => {
    const a = window.__avalanche;
    a.store.markTutorialDone();
    a.store.data.unlockedLevel = 100;
    a.app.selectLevel(+l);
    if (q) a.app.setSetting('quality', q);
    const app = a.app;
    const inner = app.loop.renderFn;
    a.jsMs = [];
    app.loop.renderFn = (alpha, dt) => {
      const t0 = performance.now();
      inner(alpha, dt);
      a.jsMs.push(performance.now() - t0);
    };
  },
  { l: level, q: quality },
);
await page.click('#btn-play');
await page.waitForFunction(() => window.__avalanche.state().phase === 'playing', null, { timeout: 30000 });
await page.keyboard.down('ArrowLeft');
await page.evaluate(() => (window.__avalanche.jsMs.length = 0));
const game = await sample(6000);
await page.keyboard.up('ArrowLeft');
const js = await page.evaluate(() => {
  const x = window.__avalanche.jsMs;
  return +(x.reduce((a, b) => a + b, 0) / x.length).toFixed(2);
});
const s = await page.evaluate(() => window.__avalanche.state());
console.log(
  JSON.stringify({ gpu, viewport: `${w}x${h}`, level: +level, quality: s.quality, renderer: s.renderer, blankPage: baseline, game, jsPerFrameMs: js, rocksOnScreen: s.falling.length }),
);
await browser.close();
