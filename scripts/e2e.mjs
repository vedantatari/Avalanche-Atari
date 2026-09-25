// Browser verification for Avalanche (dev tool; needs a locally installed Chrome/Edge).
//   1. start a server:  node scripts/serve.mjs 8080
//   2. run:             node scripts/e2e.mjs [--browser=chrome|edge] [--shots=<dir>] [--base=http://localhost:8080/]
// Uses real keyboard, mouse, and CDP touch input. Uses ?debug hooks only to set up
// scenarios (inject a rock, shorten a stage) and to read state for assertions.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { BASE_SCOOP_WIDTH, EFFECTS } from '../src/config.js';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const BROWSERS = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};
const browserName = arg('browser', 'chrome');
const exe = BROWSERS[browserName] || browserName;
const BASE = arg('base', 'http://localhost:8080/');
const SHOTS = arg('shots', '');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

const results = [];
let current = '';
function check(cond, message) {
  if (!cond) throw new Error(message);
}
async function test(name, fn) {
  current = name;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`FAIL  ${name}\n      ${err.message.split('\n')[0]}`);
  }
}

const browser = await chromium.launch({ executablePath: exe, args: GPU_ARGS });
const version = browser.version();

/** New isolated context + page with error tracking. */
async function openGame({ w = 1366, h = 768, touch = false, mobile = false, query = '', tutorial = true, initScript } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  await page.goto(`${BASE}?debug&seed=4242${query}`);
  await page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
  // The relative-drag and keyboard checks predate pointer-follow; the dedicated follow test
  // re-enables it. Everything else runs with the classic relative controls.
  await page.evaluate(() => window.__avalanche.app.setSetting('pointerFollow', false));
  if (tutorial) await page.evaluate(() => window.__avalanche.store.markTutorialDone());
  if (SHOTS) await page.evaluate(() => document.querySelector('[style*="monospace"]')?.remove());
  const g = {
    page,
    context,
    problems,
    state: () => page.evaluate(() => window.__avalanche.state()),
    eval: (fn, a) => page.evaluate(fn, a),
    async startLevel(level = 1) {
      await page.evaluate((l) => {
        const a = window.__avalanche;
        a.store.data.unlockedLevel = Math.max(a.store.data.unlockedLevel, l);
        a.app.selectLevel(l);
      }, level);
      await page.click('#btn-play');
      await page.waitForFunction(() => window.__avalanche.state().phase === 'playing', null, { timeout: 20000 });
      await page.evaluate(() => window.__avalanche.clearUpcoming());
    },
    waitFor: (fn, arg2, timeout = 15000) => page.waitForFunction(fn, arg2, { timeout }),
    async close() {
      await context.close();
    },
  };
  return g;
}

const rect = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, sel);

/** Waits until the cart has rested near a position. */
async function settle(g) {
  await g.page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------- tests

await test('boot: menu shows, 3D renderer, no console errors or failed requests', async () => {
  const g = await openGame({ tutorial: false });
  const s = await g.state();
  check(s.renderer === '3d', `renderer ${s.renderer}`);
  check(s.overlays.includes('ov-menu'), 'menu not open');
  const cards = await g.eval(() => document.querySelectorAll('#menu-terrain .terrain-card').length);
  check(cards === 2, `terrain cards ${cards}`);
  const icons = await g.eval(() => [...document.querySelectorAll('#legend img')].every((i) => i.src.startsWith('data:image/png')));
  check(icons, 'legend icons missing');
  check(g.problems.length === 0, g.problems.join('\n'));
  await g.close();
});

await test('game fills the window; full-screen toggle (button and F) works', async () => {
  const g = await openGame({ w: 1366, h: 768 });
  const frame = await rect(g.page, '#frame');
  check(Math.round(frame.x) === 0 && Math.round(frame.y) === 0 && Math.round(frame.w) === 1366 && Math.round(frame.h) === 768, `frame ${JSON.stringify(frame)}`);
  const visible = await g.eval(() => !document.getElementById('btn-fullscreen').hidden);
  check(visible, 'full-screen button hidden although the API exists');
  // Right after the first context closes, the headless browser can take a while to grant
  // fullscreen; generous timeouts keep this about behaviour, not suite-order timing.
  await g.page.click('#btn-fullscreen');
  await g.waitFor(() => !!document.fullscreenElement, null, 15000);
  await g.waitFor(() => document.querySelector('#btn-fullscreen .fs-label').textContent === 'Exit full screen', null, 5000);
  await g.page.keyboard.press('KeyF');
  await g.waitFor(() => !document.fullscreenElement, null, 15000);
  // Leaving full screen during play pauses the game.
  await g.startLevel(1);
  await g.page.keyboard.press('KeyF');
  await g.waitFor(() => !!document.fullscreenElement, null, 15000);
  check((await g.state()).phase === 'playing', 'entering full screen interrupted play');
  await g.eval(() => document.exitFullscreen());
  await g.waitFor(() => window.__avalanche.state().phase === 'paused', null, 15000);
  await g.close();
});

await test('background is alive: wind, slides, sifting snow, birds, swaying trees', async () => {
  const g = await openGame({ w: 1366, h: 768 });
  const readTree = () => g.eval(() => Array.from(window.__avalanche.app.renderer.life.h.trees.mesh.instanceMatrix.array.slice(0, 16)).join(','));
  const t1 = await readTree();
  await g.page.waitForTimeout(6500);
  const stats = await g.eval(() => ({ ...window.__avalanche.app.renderer.life.stats }));
  const t2 = await readTree();
  check(t1 !== t2, 'trees are not swaying');
  check(stats.slides > 0 && stats.sifts > 0, `no cliff activity: ${JSON.stringify(stats)}`);
  check(stats.flocks > 0, `no birds after 6.5 s: ${JSON.stringify(stats)}`);
  const live = await g.eval(() => Array.from(window.__avalanche.app.renderer.life.particles.life).filter((v) => v > 0).length);
  check(live > 0, 'no background particles alive');
  // Pausing freezes the background too.
  await g.startLevel(1);
  await g.page.keyboard.press('Escape');
  const a = await readTree();
  await g.page.waitForTimeout(500);
  check(a === (await readTree()), 'background kept moving while paused');
  await g.close();
});

await test('touch zones: no arrow buttons; holding a half of the screen steers that way', async () => {
  const desk = await openGame({ w: 1366, h: 768 });
  await desk.startLevel(1);
  check(!(await desk.eval(() => document.getElementById('btn-left') || document.getElementById('btn-right'))), 'old arrow buttons still present');
  check(!(await desk.eval(() => document.getElementById('move-strip') || document.getElementById('strip-track'))), 'old movement slider still present');
  await desk.close();

  const g = await openGame({ w: 390, h: 844, touch: true, mobile: true });
  await g.startLevel(1);
  const scene = await rect(g.page, '#scene');
  const cdp = await g.context.newCDPSession(g.page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const hold = async (x, ms) => {
    await touch('touchStart', [{ x, y: scene.cy, id: 1 }]);
    await g.page.waitForTimeout(ms);
    await touch('touchEnd', [{ x, y: scene.cy, id: 1 }]);
  };
  const x0 = (await g.state()).cartX;
  await hold(scene.cx + scene.w * 0.3, 300); // right half
  const x1 = (await g.state()).cartX;
  check(x1 > x0 + 1.5, `hold right half moved ${x0.toFixed(2)} -> ${x1.toFixed(2)}`);
  // Wait for the release to register (it can lag under load) before checking nothing is stuck.
  await g.waitFor(() => window.__avalanche.app.inputState.direction === 0, null, 3000);
  await settle(g);
  const x2 = (await g.state()).cartX;
  await g.page.waitForTimeout(200);
  check(Math.abs((await g.state()).cartX - x2) < 1e-6, 'zone hold left input stuck');
  await hold(scene.cx - scene.w * 0.3, 300); // left half
  const x3 = (await g.state()).cartX;
  check(x3 < x2 - 1.5, `hold left half moved ${x2.toFixed(2)} -> ${x3.toFixed(2)}`);
  // Sliding across the middle without lifting switches direction.
  await touch('touchStart', [{ x: scene.cx - scene.w * 0.3, y: scene.cy, id: 1 }]);
  await g.page.waitForTimeout(200);
  await touch('touchMove', [{ x: scene.cx + scene.w * 0.3, y: scene.cy, id: 1 }]);
  await g.page.waitForTimeout(60);
  check((await g.eval(() => window.__avalanche.app.inputState.direction)) === 1, 'sliding across the middle did not switch sides');
  await touch('touchEnd', [{ x: scene.cx + scene.w * 0.3, y: scene.cy, id: 1 }]);
  await g.close();
});

await test('first play shows the catch/avoid tutorial, then starts level 1', async () => {
  const g = await openGame({ tutorial: false });
  await g.page.click('#btn-play');
  const title = await g.eval(() => !document.getElementById('ov-howto').hidden && document.getElementById('howto-title').textContent);
  check(title === 'Before you start', `tutorial title ${title}`);
  const items = await g.eval(() => document.querySelectorAll('#howto-grid .howto-item').length);
  check(items === 10, `tutorial items ${items}`);
  await g.page.click('#btn-howto-ok');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing');
  const s = await g.state();
  // Targets are dynamic (a share of this stage's reachable score), so only their shape is fixed.
  check(s.level === 1 && s.target >= 1000 && s.target % 50 === 0 && s.lives === 3 && s.bank === 0, JSON.stringify(s));
  check(await g.eval(() => window.__avalanche.store.data.tutorialDone), 'tutorial not recorded');
  await g.close();
});

await test('keyboard: arrows and A/D move the cart smoothly; release stops it', async () => {
  const g = await openGame();
  await g.startLevel(1);
  const x0 = (await g.state()).cartX;
  await g.page.keyboard.down('ArrowRight');
  await g.page.waitForTimeout(350);
  await g.page.keyboard.up('ArrowRight');
  const x1 = (await g.state()).cartX;
  check(x1 > x0 + 1.5, `ArrowRight moved ${x0} -> ${x1}`);
  await settle(g);
  const x2 = (await g.state()).cartX;
  await g.page.waitForTimeout(300);
  const x3 = (await g.state()).cartX;
  check(Math.abs(x3 - x2) < 1e-6, `cart drifted after release ${x2} -> ${x3}`);
  await g.page.keyboard.down('KeyA');
  await g.page.waitForTimeout(300);
  await g.page.keyboard.up('KeyA');
  check((await g.state()).cartX < x3 - 1, 'KeyA did not move left');
  await g.page.keyboard.down('KeyD');
  await g.page.waitForTimeout(1600);
  await g.page.keyboard.up('KeyD');
  const s = await g.state();
  check(Math.abs(s.cartX + s.scoopWidth / 2 - 8) < 1e-6, `cart not clamped at right edge: ${s.cartX}`);
  await g.close();
});

await test('pause (Esc) freezes time and effects; resume continues without a jump', async () => {
  const g = await openGame();
  await g.startLevel(1);
  await g.eval(() => window.__avalanche.injectDrop('expand', 0, 0.6));
  await g.waitFor(() => window.__avalanche.state().effects?.size === 'expand');
  await g.page.keyboard.press('Escape');
  const a = await g.state();
  check(a.phase === 'paused' && a.overlays.includes('ov-pause'), `phase ${a.phase}`);
  await g.page.waitForTimeout(1200);
  const b = await g.state();
  check(a.tick === b.tick, `tick advanced while paused ${a.tick} -> ${b.tick}`);
  check(a.effects.sizeSeconds === b.effects.sizeSeconds, 'effect timer advanced while paused');
  await g.page.click('#btn-resume');
  await g.page.waitForTimeout(100);
  const c = await g.state();
  check(c.phase === 'playing', `phase after resume ${c.phase}`);
  check(c.tick - b.tick < 40, `time jumped on resume by ${c.tick - b.tick} ticks`);
  await g.page.keyboard.press('KeyP');
  check((await g.state()).phase === 'paused', 'P did not pause');
  await g.page.keyboard.press('KeyP');
  check((await g.state()).phase === 'playing', 'P did not resume');
  await g.close();
});

await test('visibility loss and window blur pause the game', async () => {
  const g = await openGame();
  await g.startLevel(1);
  await g.eval(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const s = await g.state();
  check(s.phase === 'paused', `visibility: phase ${s.phase}`);
  await g.eval(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await g.page.click('#btn-resume');
  await g.page.keyboard.down('ArrowLeft');
  await g.eval(() => window.dispatchEvent(new Event('blur')));
  const s2 = await g.state();
  check(s2.phase === 'paused', `blur: phase ${s2.phase}`);
  const held = await g.eval(() => window.__avalanche.app.inputState.direction);
  check(held === 0, 'held key survived blur');
  await g.page.keyboard.up('ArrowLeft');
  await g.close();
});

await test('mouse: relative drag on the playfield', async () => {
  const g = await openGame();
  await g.startLevel(1);
  const scene = await rect(g.page, '#scene');
  const ppu = await g.eval(() => window.__avalanche.layout.pxPerUnit);
  const y = scene.y + scene.h * 0.55;
  await g.page.mouse.move(scene.cx, y);
  await g.page.mouse.down();
  for (let i = 1; i <= 10; i++) await g.page.mouse.move(scene.cx + i * 12, y);
  await g.page.waitForTimeout(250);
  const x1 = (await g.state()).cartX;
  check(Math.abs(x1 - 120 / ppu) < 0.35, `playfield drag moved ${x1.toFixed(2)} (expected ${(120 / ppu).toFixed(2)})`);
  // Moving back reverses without teleporting.
  for (let i = 1; i <= 5; i++) await g.page.mouse.move(scene.cx + 120 - i * 12, y);
  await g.page.waitForTimeout(250);
  await g.page.mouse.up();
  const x2 = (await g.state()).cartX;
  check(Math.abs(x2 - 60 / ppu) < 0.35, `reverse drag ${x2.toFixed(2)}`);
  await settle(g);
  const x3 = (await g.state()).cartX;
  await g.page.waitForTimeout(200);
  check(Math.abs((await g.state()).cartX - x3) < 1e-6, 'drag left input stuck');
  await g.close();
});

await test('mouse: absolute pointer-follow steers by hovering; reverse mirrors it', async () => {
  const g = await openGame();
  await g.eval(() => window.__avalanche.app.setSetting('pointerFollow', true));
  await g.startLevel(1);
  const scene = await rect(g.page, '#scene');
  const y = scene.y + scene.h * 0.55;
  // No button held: the cart tracks the pointer's x.
  await g.page.mouse.move(scene.cx, y);
  await g.page.mouse.move(scene.cx + 160, y, { steps: 8 });
  await g.page.waitForTimeout(400);
  const world = await g.eval((px) => {
    const L = window.__avalanche.layout;
    const r = document.getElementById('scene').getBoundingClientRect();
    return L.toWorld(px - r.left, 0).x;
  }, scene.cx + 160);
  const x1 = (await g.state()).cartX;
  check(Math.abs(x1 - world) < 0.35, `follow moved ${x1.toFixed(2)} (pointer at ${world.toFixed(2)})`);
  // Reverse mirrors the follow target about the centre.
  await g.eval(() => window.__avalanche.injectDrop('reverse', window.__avalanche.state().cartX, 0.5));
  await g.waitFor(() => window.__avalanche.state().reversed === true);
  await g.page.mouse.move(scene.cx + 159, y);
  await g.page.mouse.move(scene.cx + 160, y);
  await g.page.waitForTimeout(500);
  const x2 = (await g.state()).cartX;
  check(Math.abs(x2 + world) < 0.5, `reversed follow at ${x2.toFixed(2)} (expected ~${(-world).toFixed(2)})`);
  // Keyboard still overrides the hovering pointer (a key press clears the follow target).
  await g.waitFor(() => window.__avalanche.state().reversed === false, null, 9000);
  await g.page.waitForTimeout(600); // the cart eases back to the un-mirrored follow target
  const x3 = (await g.state()).cartX;
  await g.page.keyboard.down('ArrowLeft');
  await g.page.waitForTimeout(300);
  await g.page.keyboard.up('ArrowLeft');
  const x4 = (await g.state()).cartX;
  check(x4 < x3 - 0.8, `keyboard did not take over from follow: ${x3} -> ${x4}`);
  await g.close();
});

await test('touch: a second finger on Restore does not interrupt steering; cancel clears input', async () => {
  const g = await openGame({ w: 390, h: 844, touch: true, mobile: true });
  await g.startLevel(1);
  await g.eval(() => window.__avalanche.grant({ lives: 2, bank: 1 }));
  const cdp = await g.context.newCDPSession(g.page);
  const scene = await rect(g.page, '#scene');
  const restore = await rect(g.page, '#btn-restore');
  const y = scene.y + scene.h * 0.5;
  const zx = scene.cx + scene.w * 0.3; // right steering zone
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x: zx, y, id: 1 }]);
  await g.page.waitForTimeout(250);
  const x0 = (await g.state()).cartX;
  check(x0 > 0.5, `zone hold did not steer: ${x0.toFixed(2)}`);
  // Second finger taps Restore while the first keeps steering.
  await touch('touchStart', [{ x: zx, y, id: 1 }, { x: restore.cx, y: restore.cy, id: 2 }]);
  await g.page.waitForTimeout(60);
  // CDP touchEnd lists the finger that lifts: finger 2 lifts, finger 1 keeps steering.
  await touch('touchEnd', [{ x: restore.cx, y: restore.cy, id: 2 }]);
  await g.page.waitForTimeout(150);
  const s = await g.state();
  check(s.lives === 3 && s.bank === 0 && s.restoresUsed === 1, `restore by second finger: ${JSON.stringify({ lives: s.lives, bank: s.bank })}`);
  check((await g.eval(() => window.__avalanche.app.inputState.direction)) === 1, 'second finger stole or ended the steering hold');
  await touch('touchCancel', []);
  await g.page.waitForTimeout(100);
  check((await g.eval(() => window.__avalanche.app.inputState.direction)) === 0, 'touch cancel left the hold active');
  const scroll = await g.eval(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, ih: innerHeight }));
  check(scroll.y === 0 && scroll.h <= scroll.ih + 1, `page scrolled: ${JSON.stringify(scroll)}`);
  await g.close();
});

await test('reverse: flips keyboard, touch zones and drag; shows REVERSED; ends after 5 s', async () => {
  // Tablet so touch zones exist; keyboard and mouse still work there.
  const g = await openGame({ w: 1024, h: 768, touch: true, mobile: true });
  await g.startLevel(5);
  await g.eval(() => window.__avalanche.injectDrop('reverse', 0, 0.5));
  await g.waitFor(() => window.__avalanche.state().reversed === true);
  let x = (await g.state()).cartX;
  await g.page.keyboard.down('ArrowRight');
  await g.page.waitForTimeout(250);
  await g.page.keyboard.up('ArrowRight');
  let x2 = (await g.state()).cartX;
  check(x2 < x - 0.8, `ArrowRight while reversed: ${x} -> ${x2}`);
  const scene = await rect(g.page, '#scene');
  const cdp = await g.context.newCDPSession(g.page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x: scene.cx - scene.w * 0.3, y: scene.cy, id: 9 }]);
  await g.page.waitForTimeout(250);
  await touch('touchEnd', [{ x: scene.cx - scene.w * 0.3, y: scene.cy, id: 9 }]);
  const x3 = (await g.state()).cartX;
  check(x3 > x2 + 0.8, `left touch zone while reversed: ${x2} -> ${x3}`);
  await g.page.mouse.move(scene.cx, scene.cy);
  await g.page.mouse.down();
  await g.page.mouse.move(scene.cx + 60, scene.cy, { steps: 6 });
  await g.page.waitForTimeout(200);
  await g.page.mouse.up();
  const x4 = (await g.state()).cartX;
  check(x4 < x3 - 0.5, `drag right while reversed: ${x3} -> ${x4}`);
  const t = await g.state();
  const left5 = t.effects.reverseSeconds;
  check(left5 > 0 && left5 <= 5, `reverse timer ${left5}`);
  await g.waitFor(() => window.__avalanche.state().reversed === false, null, 9000);
  x = (await g.state()).cartX;
  await g.page.keyboard.down('ArrowRight');
  await g.page.waitForTimeout(200);
  await g.page.keyboard.up('ArrowRight');
  check((await g.state()).cartX > x + 0.5, 'controls did not return to normal');
  await g.close();
});

await test('multiplier + shadow clones: ×5 boosts catches, clones catch beside the cart, fire falls through', async () => {
  const g = await openGame();
  await g.startLevel(1);
  await g.eval((off) => {
    const a = window.__avalanche;
    a.injectDrop('clone', 0, 0.5);
    a.injectDrop('mult5', 0, 0.8);
    a.injectDrop('coin', -off, 1.4);
    a.injectDrop('cash', off, 1.45);
    a.injectDrop('fire', off, 1.9);
  }, BASE_SCOOP_WIDTH + EFFECTS.cloneGap);
  await g.waitFor(() => window.__avalanche.state().effects.cloneSeconds > 0);
  await g.waitFor(() => window.__avalanche.state().score >= 750, null, 5000);
  const chip = await g.eval(() => {
    const el = document.getElementById('hud-mult');
    return el.hidden ? null : el.textContent;
  });
  check(chip === '×5', `multiplier chip ${chip}`);
  await g.page.waitForTimeout(900);
  const s = await g.state();
  check(s.score === 750, `score ${s.score} (want 5 × 50 + 5 × 100)`);
  check(s.lives === 3, `fire hit a clone: lives ${s.lives}`);
  check(s.caught.coin === 1 && s.caught.cash === 1, `caught ${JSON.stringify(s.caught)}`);
  check(Math.abs(s.cartX) < 1e-9, `cart moved to ${s.cartX}`);
  await g.waitFor(() => {
    const fx = window.__avalanche.state().effects;
    return fx.cloneSeconds === 0 && fx.multiplier === 1;
  }, null, 9000);
  check(await g.eval(() => document.getElementById('hud-mult').hidden), 'multiplier chip still shown');
  check(g.problems.length === 0, g.problems.join('\n'));
  await g.close();
});

await test('expand then shrink change only the scoop width for 5 s', async () => {
  const g = await openGame();
  await g.startLevel(3);
  await g.eval(() => window.__avalanche.injectDrop('expand', 0, 0.5));
  await g.waitFor(() => window.__avalanche.state().effects?.size === 'expand');
  await g.page.waitForTimeout(300);
  let s = await g.state();
  check(Math.abs(s.scoopWidth - 2.56 * 1.4) < 1e-6, `expanded width ${s.scoopWidth}`);
  await g.eval(() => window.__avalanche.injectDrop('shrink', window.__avalanche.state().cartX, 0.5));
  await g.waitFor(() => window.__avalanche.state().effects?.size === 'shrink');
  await g.page.waitForTimeout(300);
  s = await g.state();
  check(Math.abs(s.scoopWidth - 2.56 * 0.7) < 1e-6, `shrunk width ${s.scoopWidth}`);
  await g.waitFor(() => window.__avalanche.state().effects?.size === null, null, 9000);
  await g.page.waitForTimeout(300);
  s = await g.state();
  check(Math.abs(s.scoopWidth - 2.56) < 1e-6, `width restored ${s.scoopWidth}`);
  await g.close();
});

await test('fire + revive: paused decision, restore costs 1 then 2, End run loses', async () => {
  const g = await openGame();
  await g.startLevel(1);
  await g.eval(() => window.__avalanche.grant({ lives: 1, bank: 3 }));
  await g.eval(() => window.__avalanche.injectDrop('fire', window.__avalanche.state().cartX, 0.5));
  await g.waitFor(() => window.__avalanche.state().phase === 'revive');
  const a = await g.state();
  check(a.overlays.includes('ov-revive'), 'revive overlay not shown');
  const texts = await g.eval(() => ['revive-cost', 'revive-bank', 'revive-left'].map((id) => document.getElementById(id).textContent));
  check(texts.join(',') === '1,3,4', `revive numbers ${texts}`);
  await g.page.waitForTimeout(800);
  check((await g.state()).tick === a.tick, 'time advanced during the revive decision');
  if (SHOTS) await g.page.screenshot({ path: `${SHOTS}/revive-overlay.png` });
  await g.page.click('#btn-revive-yes');
  const b = await g.state();
  check(b.phase === 'playing' && b.lives === 1 && b.bank === 2 && b.restoresUsed === 1, `after restore ${JSON.stringify(b)}`);
  check(b.effects.invulnSeconds > 0.9, 'no immunity after restore');
  await g.page.waitForTimeout(1300);
  await g.eval(() => window.__avalanche.injectDrop('fire', window.__avalanche.state().cartX, 0.5));
  await g.waitFor(() => window.__avalanche.state().phase === 'revive');
  const c = await g.eval(() => document.getElementById('revive-cost').textContent);
  check(c === '2', `second restore cost ${c}`);
  await g.page.click('#btn-revive-no');
  await g.waitFor(() => !document.getElementById('ov-result').hidden, null, 5000);
  const r = await g.eval(() => ({ title: document.getElementById('result-title').textContent, next: document.getElementById('btn-next').hidden }));
  check(r.title === 'Stage failed' && r.next, `result ${JSON.stringify(r)}`);
  check(!(await g.eval(() => window.__avalanche.store.isUnlocked(2))), 'failure unlocked level 2');
  await g.close();
});

await test('restore button explains why it is disabled; R key restores when eligible', async () => {
  const g = await openGame();
  await g.startLevel(1);
  const full = await g.eval(() => ({ d: document.getElementById('btn-restore').disabled, n: document.getElementById('restore-note').textContent }));
  check(full.d && full.n === 'Hearts full', `full hearts ${JSON.stringify(full)}`);
  await g.eval(() => window.__avalanche.grant({ lives: 2, bank: 0 }));
  await g.page.waitForTimeout(100);
  const need = await g.eval(() => document.getElementById('restore-note').textContent);
  check(need === 'Need 1 more shield', `need note "${need}"`);
  await g.eval(() => window.__avalanche.grant({ bank: 1 }));
  await g.page.keyboard.press('KeyR');
  await g.page.waitForTimeout(120); // HUD refreshes on the next frame
  const s = await g.state();
  check(s.lives === 3 && s.bank === 0 && s.restoresUsed === 1, `R restore ${JSON.stringify(s)}`);
  const hud = await g.eval(() => ({ used: document.getElementById('hud-used').textContent, cost: document.getElementById('hud-cost').textContent }));
  check(hud.used.startsWith('1 / 4') && hud.cost.includes('2'), `HUD after restore ${JSON.stringify(hud)}`);
  await g.close();
});

await test('win: target + heart at deadline clears, unlocks; Next refills hearts, carries bank/restores', async () => {
  const g = await openGame({ query: '&duration=4' });
  await g.startLevel(1);
  await g.eval(() => window.__avalanche.grant({ score: 100, lives: 2, bank: 3 }));
  await g.eval(() => { window.__avalanche.sim.run.restoresUsed = 1; });
  await g.waitFor(() => !document.getElementById('ov-result').hidden, null, 10000);
  const r = await g.eval(() => ({ title: document.getElementById('result-title').textContent, unlock: document.getElementById('result-unlock').textContent, next: !document.getElementById('btn-next').hidden }));
  check(r.title === 'Stage clear!' && r.next && r.unlock.includes('Level 2'), `result ${JSON.stringify(r)}`);
  if (SHOTS) await g.page.screenshot({ path: `${SHOTS}/result-win.png` });
  check(await g.eval(() => window.__avalanche.store.isUnlocked(2)), 'level 2 not unlocked');
  await g.page.click('#btn-next');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing');
  const s = await g.state();
  check(s.level === 2 && s.lives === 3 && s.bank === 3 && s.restoresUsed === 1 && s.score === 0, `next level ${JSON.stringify(s)}`);
  await g.page.keyboard.press('Escape');
  await g.page.click('#btn-restart');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing');
  const t = await g.state();
  check(t.level === 2 && t.lives === 3 && t.bank === 0 && t.restoresUsed === 0, `restart = new run ${JSON.stringify(t)}`);
  await g.close();
});

await test('target reached early keeps playing with "Target reached — survive!"', async () => {
  const g = await openGame();
  await g.startLevel(1);
  const target = (await g.state()).target;
  await g.eval((t) => window.__avalanche.grant({ score: t - 30 }), target);
  await g.eval(() => window.__avalanche.injectDrop('coin', window.__avalanche.state().cartX, 0.5));
  await g.waitFor((t) => window.__avalanche.state().score >= t, target);
  await g.page.waitForTimeout(200);
  const toast = await g.eval(() => document.getElementById('toasts').textContent);
  check(toast.includes('Target reached'), `toast "${toast}"`);
  check((await g.state()).phase === 'playing', 'stage ended early');
  await g.close();
});

await test('level 100 completion shows the summit screen with replay, no level 101', async () => {
  const g = await openGame({ query: '&duration=3' });
  await g.startLevel(100);
  await g.eval(() => window.__avalanche.grant({ score: 99999 }));
  await g.waitFor(() => !document.getElementById('ov-result').hidden, null, 10000);
  const r = await g.eval(() => ({ title: document.getElementById('result-title').textContent, next: document.getElementById('btn-next').hidden, retry: document.getElementById('btn-retry').textContent }));
  check(r.title === 'Summit cleared!' && r.next && r.retry === 'Replay', `level 100 ${JSON.stringify(r)}`);
  check((await g.eval(() => window.__avalanche.store.data.unlockedLevel)) === 100, 'unlocked beyond 100');
  await g.close();
});

await test('terrain: locked during a stage, switchable in the menu, mechanics unchanged', async () => {
  const g = await openGame();
  await g.startLevel(1);
  const disabled = await g.eval(() => [...document.querySelectorAll('.terrain-card')].every((b) => b.disabled));
  check(disabled, 'terrain cards clickable during a stage');
  const sched1 = await g.eval(() => JSON.stringify(window.__avalanche.sim.stage.schedule.drops.slice(0, 0)));
  await g.page.keyboard.press('Escape');
  await g.page.click('#btn-pause-menu');
  await g.page.click('#menu-terrain .terrain-card[data-theme="volcano"]');
  check((await g.eval(() => window.__avalanche.store.data.theme)) === 'volcano', 'theme not saved');
  // Same seed + level -> identical schedule regardless of theme.
  const a = await g.eval(() => { const s = window.__avalanche.sim; s.startRun(7, { seed: 99 }); const d = JSON.stringify(s.stage.schedule.drops); s.quit(); return d; });
  await g.eval(() => window.__avalanche.app.setTheme('ice'));
  const b = await g.eval(() => { const s = window.__avalanche.sim; s.startRun(7, { seed: 99 }); const d = JSON.stringify(s.stage.schedule.drops); s.quit(); return d; });
  check(a === b && sched1 === '[]', 'schedule changed with theme');
  await g.close();
});

await test('resize mid-stage keeps positions and awards no phantom catches', async () => {
  const g = await openGame({ w: 1366, h: 768 });
  await g.startLevel(1);
  await g.eval(() => { const a = window.__avalanche; a.injectDrop('coin', 5, 2.5); a.injectDrop('fire', -5, 2.5); });
  await g.page.waitForTimeout(800);
  await g.eval(() => window.__avalanche.setTimeScale(0));
  const before = await g.state();
  await g.page.setViewportSize({ width: 1100, height: 700 });
  await g.page.waitForTimeout(300);
  await g.page.setViewportSize({ width: 1920, height: 1080 });
  await g.page.waitForTimeout(300);
  const after = await g.state();
  check(before.tick === after.tick && before.score === after.score && before.cartX === after.cartX, 'state changed on resize');
  check(JSON.stringify(before.falling) === JSON.stringify(after.falling), 'falling rocks changed on resize');
  check(JSON.stringify(before.caught) === JSON.stringify(after.caught), 'phantom catch on resize');
  await g.eval(() => window.__avalanche.setTimeScale(1));
  await g.close();
});

await test('orientation change pauses and waits for the player', async () => {
  const g = await openGame({ w: 390, h: 844, touch: true, mobile: true });
  await g.startLevel(1);
  await g.page.setViewportSize({ width: 844, height: 390 });
  await g.waitFor(() => window.__avalanche.state().phase === 'paused', null, 3000);
  const note = await g.eval(() => document.getElementById('pause-note').textContent);
  check(note.includes('rotated'), `pause note "${note}"`);
  check((await g.state()).hud === 'short', 'HUD did not switch to the landscape layout');
  await g.close();
});

await test('corrupt saved data does not prevent play', async () => {
  const g = await openGame({ tutorial: false, initScript: () => localStorage.setItem('avalanche.save', '{"version":1,"unlockedLevel":"lots",') });
  const s = await g.state();
  check(s.overlays.includes('ov-menu'), 'menu missing with corrupt save');
  await g.eval(() => window.__avalanche.store.markTutorialDone());
  await g.page.click('#btn-play');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing');
  check(g.problems.length === 0, g.problems.join('\n'));
  await g.close();
});

await test('unavailable storage still plays and says progress will not be saved', async () => {
  const g = await openGame({
    tutorial: false,
    initScript: () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }),
  });
  const note = await g.eval(() => document.getElementById('menu-note').textContent);
  check(note.includes('cannot be saved'), `menu note "${note}"`);
  await g.eval(() => window.__avalanche.store.markTutorialDone());
  await g.page.click('#btn-play');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing');
  await g.close();
});

await test('settings: sound/music/reduced-motion persist; reset needs confirmation', async () => {
  const g = await openGame();
  await g.page.click('#btn-settings');
  await g.page.click('label:has(#set-music)');
  await g.page.click('label:has(#set-motion)');
  const s = await g.eval(() => window.__avalanche.store.settings);
  check(s.music === false && s.reducedMotion === true, `settings ${JSON.stringify(s)}`);
  await g.eval(() => { window.__avalanche.store.data.unlockedLevel = 9; });
  await g.page.click('#btn-reset');
  check(await g.eval(() => !document.getElementById('ov-confirm').hidden), 'no confirmation shown');
  await g.page.click('#btn-confirm-no');
  check((await g.eval(() => window.__avalanche.store.data.unlockedLevel)) === 9, 'cancel still reset');
  await g.page.click('#btn-reset');
  await g.page.click('#btn-confirm-yes');
  const after = await g.eval(() => ({ u: window.__avalanche.store.data.unlockedLevel, m: window.__avalanche.store.settings.music }));
  check(after.u === 1 && after.m === false, `after reset ${JSON.stringify(after)}`);
  await g.close();
});

await test('level picker: 100 levels in pages, locked levels disabled', async () => {
  const g = await openGame();
  await g.eval(() => { window.__avalanche.store.data.unlockedLevel = 23; });
  await g.page.click('#btn-levels');
  const pages = await g.eval(() => document.querySelectorAll('#level-pages button').length);
  check(pages === 5, `pages ${pages}`);
  await g.page.click('#level-pages button:nth-child(2)');
  const info = await g.eval(() => [...document.querySelectorAll('#level-grid .level-btn')].map((b) => b.disabled));
  check(info.length === 20 && info.slice(0, 3).every((d) => !d) && info.slice(3).every((d) => d), `grid ${info}`);
  await g.page.click('#level-grid .level-btn:nth-child(3)');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing');
  check((await g.state()).level === 23, 'picked level did not start');
  await g.close();
});

await test('menu fits a 768px-tall window without scrolling past the full-screen button', async () => {
  const g = await openGame({ w: 1366, h: 768, tutorial: false });
  const r = await g.eval(() => document.getElementById('btn-fullscreen').getBoundingClientRect().bottom);
  check(r <= 768, `menu overflows: full-screen button bottom at ${Math.round(r)}px`);
  await g.close();
});

await test('endless mode: no target, waves roll on, death records the cumulative total', async () => {
  const g = await openGame({ query: '&duration=3' });
  await g.page.click('#btn-endless');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing', null, 20000);
  await g.eval(() => window.__avalanche.clearUpcoming());
  let s = await g.state();
  check(s.mode === 'endless' && s.target === null && s.level === 1, `endless start ${JSON.stringify({ mode: s.mode, target: s.target })}`);
  check(await g.eval(() => document.getElementById('hud-target').textContent === '∞'), 'HUD target not ∞');
  await g.eval(() => window.__avalanche.grant({ score: 300 }));
  await g.waitFor(() => window.__avalanche.state().level === 2, null, 8000); // the 3 s wave rolls over
  await g.eval(() => window.__avalanche.clearUpcoming());
  s = await g.state();
  check(s.phase === 'playing' && s.totalScore === 300, `after wave 1: ${JSON.stringify({ phase: s.phase, total: s.totalScore })}`);
  await g.eval(() => window.__avalanche.injectDrop('demon', window.__avalanche.state().cartX, 0.5));
  await g.waitFor(() => !document.getElementById('ov-result').hidden, null, 10000);
  const r = await g.eval(() => ({
    title: document.getElementById('result-title').textContent,
    score: document.getElementById('result-score').textContent,
    next: document.getElementById('btn-next').hidden,
    best: window.__avalanche.store.data.endlessBest,
    board: window.__avalanche.store.data.scores.length,
  }));
  check(r.title === 'Run over!' && r.score === '300' && r.next, `endless result ${JSON.stringify(r)}`);
  check(r.best === 300 && r.board === 1, `endless not recorded ${JSON.stringify(r)}`);
  await g.close();
});

await test('daily challenge: one seeded stage per day; retry replays the same rocks', async () => {
  const g = await openGame({ query: '&duration=3' });
  const info = await g.eval(() => window.__avalanche.app.dailyInfo());
  await g.page.click('#btn-daily');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing', null, 20000);
  const s = await g.state();
  check(s.mode === 'daily' && s.level === info.level && s.seed === info.seed, `daily ${JSON.stringify({ level: s.level, seed: s.seed, info })}`);
  const sched = await g.eval(() => JSON.stringify(window.__avalanche.sim.stage.schedule.drops.map((d) => [d.type, d.cellId])));
  await g.eval((t) => window.__avalanche.grant({ score: t }), s.target);
  await g.waitFor(() => !document.getElementById('ov-result').hidden, null, 10000);
  const r = await g.eval(() => ({ title: document.getElementById('result-title').textContent, next: document.getElementById('btn-next').hidden, daily: window.__avalanche.store.data.daily }));
  check(r.title === 'Daily cleared!' && r.next, `daily result ${JSON.stringify(r)}`);
  check(r.daily && r.daily.best >= s.target && r.daily.level === info.level, `daily best ${JSON.stringify(r.daily)}`);
  await g.page.click('#btn-retry');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing', null, 20000);
  const again = await g.eval(() => JSON.stringify(window.__avalanche.sim.stage.schedule.drops.map((d) => [d.type, d.cellId])));
  check(again === sched, 'daily retry produced a different schedule');
  await g.close();
});

await test('combo: five consecutive scoring catches pay a bonus; a miss breaks the streak', async () => {
  const g = await openGame();
  await g.startLevel(1);
  await g.eval(() => {
    const a = window.__avalanche;
    for (let i = 0; i < 5; i++) a.injectDrop('coin', a.state().cartX, 0.5 + i * 0.6);
  });
  await g.waitFor(() => window.__avalanche.state().score >= 300, null, 8000);
  const s = await g.state();
  check(s.combo === 5 && s.score === 300, `combo ${JSON.stringify({ combo: s.combo, score: s.score })}`); // 5 × 50 + 50 bonus
  await g.eval(() => window.__avalanche.injectDrop('coin', window.__avalanche.state().cartX + 7, 0.5)); // unreachable: breaks it
  await g.waitFor(() => window.__avalanche.state().combo === 0, null, 8000);
  await g.close();
});

await test('resume: a reload mid-run offers Resume and restores the same stage', async () => {
  const g = await openGame();
  await g.startLevel(3);
  const before = await g.state();
  await g.page.reload();
  await g.page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
  const note = await g.eval(() => ({ hidden: document.getElementById('btn-resume-run').hidden, text: document.getElementById('resume-note').textContent }));
  check(!note.hidden && note.text.includes('Level 3'), `resume button ${JSON.stringify(note)}`);
  await g.page.click('#btn-resume-run');
  await g.waitFor(() => window.__avalanche.state().phase === 'playing', null, 20000);
  const s = await g.state();
  check(s.level === 3 && s.seed === before.seed && s.mode === 'level', `resumed ${JSON.stringify({ level: s.level, seed: s.seed })}`);
  // Losing the run clears the snapshot.
  await g.eval(() => window.__avalanche.grant({ lives: 1 }));
  await g.eval(() => window.__avalanche.injectDrop('demon', window.__avalanche.state().cartX, 0.5));
  await g.waitFor(() => !document.getElementById('ov-result').hidden, null, 10000);
  check((await g.eval(() => window.__avalanche.store.data.resume)) === null, 'loss kept the resume snapshot');
  await g.close();
});

await test('new settings: difficulty, volume sliders, and pointer-follow persist', async () => {
  const g = await openGame();
  await g.page.click('#btn-settings');
  await g.page.click('#set-difficulty button[data-value="hard"]');
  await g.eval(() => {
    const el = document.getElementById('set-sfx-vol');
    el.value = '40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await g.page.click('label:has(#set-follow)');
  const s = await g.eval(() => window.__avalanche.store.settings);
  check(s.difficulty === 'hard' && Math.abs(s.sfxVol - 0.4) < 1e-9 && s.pointerFollow === true, `settings ${JSON.stringify(s)}`);
  // Hard raises the preview targets shown in the menu (share × 1.12, capped by fairness).
  check(g.problems.length === 0, g.problems.join('\n'));
  await g.close();
});

await test('high scores overlay lists recorded runs', async () => {
  const g = await openGame();
  await g.eval(() => {
    const st = window.__avalanche.store;
    st.recordRun({ mode: 'endless', level: 4, score: 1200 });
    st.recordRun({ mode: 'level', level: 2, score: 700 });
  });
  await g.page.click('#btn-scores');
  const r = await g.eval(() => ({
    open: !document.getElementById('ov-scores').hidden,
    rows: document.querySelectorAll('#scores-list li').length,
    first: document.querySelector('#scores-list li b')?.textContent,
  }));
  check(r.open && r.rows === 2 && r.first === '1200', `scores ${JSON.stringify(r)}`);
  await g.close();
});

await test('renderer switch 3D↔2D repeats cleanly (dispose) and keeps one canvas', async () => {
  const g = await openGame();
  for (let i = 0; i < 3; i++) {
    await g.eval(() => window.__avalanche.app.setSetting('renderer', '2d'));
    await g.waitFor(() => window.__avalanche.state().renderer === '2d', null, 20000);
    await g.eval(() => window.__avalanche.app.setSetting('renderer', '3d'));
    await g.waitFor(() => window.__avalanche.state().renderer === '3d', null, 20000);
  }
  const canvases = await g.eval(() => document.querySelectorAll('#scene canvas').length);
  check(canvases === 1, `${canvases} canvases after switching`);
  check(g.problems.length === 0, g.problems.join('\n'));
  await g.close();
});

// Layout checks at the viewports listed in the brief.
const VIEWPORTS = [
  { name: 'desktop-1366x768', w: 1366, h: 768 },
  { name: 'desktop-1920x1080', w: 1920, h: 1080 },
  { name: 'phone-360x640', w: 360, h: 640, touch: true, mobile: true },
  { name: 'phone-390x844', w: 390, h: 844, touch: true, mobile: true },
  { name: 'phone-landscape-844x390', w: 844, h: 390, touch: true, mobile: true },
  { name: 'tablet-768x1024', w: 768, h: 1024, touch: true, mobile: true },
  { name: 'tablet-1024x768', w: 1024, h: 768, touch: true, mobile: true },
];
for (const vp of VIEWPORTS) {
  await test(`layout ${vp.name}: no overlap, no scroll, 44px targets, arena clear of HUD`, async () => {
    const g = await openGame(vp);
    await g.startLevel(5);
    await g.eval(() => {
      const a = window.__avalanche;
      ['coin', 'cash', 'shield', 'expand', 'shrink', 'fire', 'reverse'].forEach((t, i) => a.injectDrop(t, -6 + i * 2, 1.3));
      a.injectDrop('reverse', a.state().cartX, 0.4);
    });
    await g.page.waitForTimeout(1300);
    await g.eval(() => window.__avalanche.setTimeScale(0));
    const report = await g.eval(() => {
      const sel = ['.level-pill', '#score-pill', '.timer-pill', '#hud-hearts', '#btn-pause', '#bank-pill', '.restore-group'];
      const frame = document.getElementById('frame').getBoundingClientRect();
      const boxes = sel.map((s) => [s, document.querySelector(s).getBoundingClientRect()]).filter(([, r]) => r.width > 0);
      const issues = [];
      if (document.getElementById('btn-left') || document.getElementById('btn-right')) issues.push('old move buttons still in the DOM');
      for (const [s, r] of boxes) {
        if (r.left < frame.left - 0.5 || r.right > frame.right + 0.5 || r.top < frame.top - 0.5 || r.bottom > frame.bottom + 0.5) issues.push(`${s} outside frame`);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, ra] = boxes[i];
          const [b, rb] = boxes[j];
          if (ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5 && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5) issues.push(`${a} overlaps ${b}`);
        }
      for (const s of ['#btn-pause', '#btn-restore']) {
        const r = document.querySelector(s).getBoundingClientRect();
        if (r.width < 44 || r.height < 44) issues.push(`${s} is ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      const L = window.__avalanche.layout;
      const hudTop = document.getElementById('hud-top').getBoundingClientRect().bottom - frame.top;
      const hudBottom = document.getElementById('hud-bottom').getBoundingClientRect().top - frame.top;
      if (L.frameRect.top < hudTop - 0.5) issues.push(`arena top ${L.frameRect.top.toFixed(1)} under HUD ${hudTop.toFixed(1)}`);
      if (L.frameRect.top + L.frameRect.height > hudBottom + 0.5) issues.push('arena bottom under controls');
      const doc = document.documentElement;
      if (doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1) issues.push(`page scrolls ${doc.scrollWidth}x${doc.scrollHeight}`);
      return { issues, hud: document.getElementById('frame').dataset.hud, ppu: L.pxPerUnit, rockPx: Math.round(L.pxPerUnit * 1.36) };
    }, !!vp.touch);
    if (SHOTS) {
      await g.eval(() => document.querySelector('[style*="monospace"]')?.remove());
      await g.page.screenshot({ path: `${SHOTS}/${vp.name}.png` });
    }
    check(report.issues.length === 0, report.issues.join('; '));
    check(report.rockPx >= 26, `rocks too small: ${report.rockPx}px`);
    console.log(`      hud=${report.hud} rock≈${report.rockPx}px scoop≈${Math.round(report.ppu * 2.56)}px`);
    await g.close();
  });
}

await test('2D fallback renders a playable game when WebGL is unavailable', async () => {
  const b2 = await chromium.launch({ executablePath: exe, args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  const context = await b2.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?debug&seed=5`);
  await page.waitForFunction(() => window.__avalanche && document.getElementById('loading').hidden, null, { timeout: 60000 });
  const note = await page.evaluate(() => document.getElementById('menu-note').textContent);
  check(note.includes('Simple 2D'), `fallback note "${note}"`);
  await page.evaluate(() => window.__avalanche.store.markTutorialDone());
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__avalanche.state().phase === 'playing');
  await page.evaluate(() => { const a = window.__avalanche; a.clearUpcoming(); a.injectDrop('coin', 0, 0.6); ['cash', 'shield', 'fire', 'reverse'].forEach((t, i) => a.injectDrop(t, -6 + i * 4, 1.4)); });
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(200);
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => window.__avalanche.state());
  check(s.renderer === '2d', `renderer ${s.renderer}`);
  check(s.cartX < 0, 'cart did not move in 2D mode');
  if (SHOTS) {
    await page.evaluate(() => window.__avalanche.setTimeScale(0));
    await page.screenshot({ path: `${SHOTS}/fallback-2d.png` });
  }
  check(errors.length === 0, errors.join('\n'));
  await b2.close();
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${browserName} ${version}: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
