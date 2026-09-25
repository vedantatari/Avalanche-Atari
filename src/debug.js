// Dev/test-only facility, enabled with ?debug in the URL (never linked from the player UI).
// Supported params: seed=<uint>, duration=<seconds>, renderer=2d|3d, level=<n>.
// Exposes window.__avalanche for reproducible checks and browser automation.
import { PHASE } from './game/simulation.js';
import { cliffCells, fallProfile } from './game/cliff.js';
import { CLIFF } from './config.js';

export function installDebug(app, params) {
  let injected = 0;
  const api = {
    app,
    sim: app.sim,
    store: app.store,
    PHASE,
    get layout() {
      return app.layout;
    },
    state() {
      const sim = app.sim;
      const st = sim.stage;
      return {
        phase: sim.phase,
        mode: sim.run?.mode ?? null,
        level: st?.level ?? null,
        score: st?.score ?? 0,
        combo: st?.combo ?? 0,
        totalScore: sim.run?.totalScore ?? 0,
        target: st?.target ?? null,
        tick: st?.tick ?? 0,
        timeRemaining: sim.timeRemaining,
        lives: sim.run?.lives ?? null,
        bank: sim.run?.bank ?? null,
        restoresUsed: sim.run?.restoresUsed ?? null,
        seed: sim.run?.seed ?? null,
        cartX: sim.cart?.x ?? 0,
        scoopWidth: sim.cart?.width ?? null,
        reversed: st ? sim.isReversed() : false,
        effects: st ? sim.effectTimers() : null,
        falling: st ? st.falling.map((d) => ({ id: d.id, type: d.type, x: d.x, arriveAt: d.arriveAt })) : [],
        caught: st ? { ...st.caught } : null,
        renderer: app.renderer?.kind,
        quality: app.activeQuality,
        fps: Math.round(app.perf.fps),
        overlays: [...app.ui.stack],
        hud: document.getElementById('frame').dataset.hud,
      };
    },
    setTimeScale(s) {
      app.loop.timeScale = s;
    },
    skipIntro() {
      app.introLeft = 0;
    },
    /** Test helper: adjust run/stage numbers directly. */
    grant({ score, bank, lives } = {}) {
      const sim = app.sim;
      if (score !== undefined && sim.stage) sim.stage.score = score;
      if (bank !== undefined && sim.run) sim.run.bank = bank;
      if (lives !== undefined && sim.run) sim.run.lives = lives;
    },
    /** Test helper: schedule one extra rock that arrives above `x` after `fall` seconds. */
    injectDrop(type, x, fall = 1.6) {
      const sim = app.sim;
      const st = sim.stage;
      if (!st) return null;
      const cell = cliffCells().reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) && b.row === 0 ? b : a), cliffCells()[0]);
      const now = sim.time;
      const crackAt = now + 0.02;
      const detachAt = crackAt + 0.3;
      const { accel, speed } = fallProfile(cell.y, fall);
      const drop = {
        id: 1e6 + injected++,
        type,
        cellId: cell.id,
        x,
        y0: cell.y,
        z0: cell.z,
        crackAt,
        detachAt,
        fallSeconds: fall,
        arriveAt: detachAt + fall,
        accel,
        speed,
        refillAt: detachAt + CLIFF.refillDelay,
        refillEndAt: detachAt + CLIFF.refillDelay + CLIFF.refillSeconds,
        pattern: 'debug',
      };
      const drops = st.schedule.drops;
      let i = st.nextCrack;
      while (i < drops.length && drops[i].crackAt <= crackAt) i++;
      drops.splice(i, 0, drop);
      return drop.id;
    },
    /** Test helper: remove upcoming scheduled rocks so a scenario runs in isolation. */
    clearUpcoming() {
      const st = app.sim.stage;
      if (st) st.schedule.drops.length = st.nextCrack;
    },
  };
  window.__avalanche = api;

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:6px;bottom:6px;z-index:99;background:rgba(0,0,0,.65);color:#9f9;font:11px/1.35 monospace;padding:4px 7px;border-radius:6px;pointer-events:none;white-space:pre';
  document.body.appendChild(box);
  setInterval(() => {
    const s = api.state();
    box.textContent = `DEBUG ${s.renderer}/${s.quality} ${s.fps}fps\nphase ${s.phase} seed ${s.seed ?? '-'}\nL${s.level ?? '-'} ${s.score}/${s.target ?? '-'} lives ${s.lives ?? '-'} bank ${s.bank ?? '-'}`;
  }, 250);

  const level = Number(params.get('level'));
  if (level > 0) app.selectLevel(level);
}
