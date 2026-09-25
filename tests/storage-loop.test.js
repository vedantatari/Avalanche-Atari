import { describe, expect, it } from 'vitest';
import { SaveStore, SAVE_KEY, defaultSave, sanitizeSave } from '../src/storage.js';
import { FixedStepLoop } from '../src/game/loop.js';
import { LOOP, TICK_RATE } from '../src/config.js';

class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

class ThrowingStorage {
  getItem() {
    throw new Error('SecurityError');
  }
  setItem() {
    throw new Error('QuotaExceeded');
  }
  removeItem() {
    throw new Error('nope');
  }
}

describe('storage', () => {
  it('falls back to defaults on corrupt JSON', () => {
    const store = new SaveStore(new MemoryStorage({ [SAVE_KEY]: '{not json' }));
    expect(store.data).toEqual(defaultSave());
  });

  it('keeps working in memory when storage throws', () => {
    const store = new SaveStore(new ThrowingStorage());
    expect(store.persistent).toBe(false);
    const r = store.recordStage(1, 600, true);
    expect(r.unlocked).toBe(2);
    expect(store.isUnlocked(2)).toBe(true);
    expect(store.save()).toBe(false);
  });

  it('works with no storage at all', () => {
    const store = new SaveStore(null);
    store.setSetting('sound', false);
    expect(store.settings.sound).toBe(false);
  });

  it('sanitises tampered values and migrates the prototype format', () => {
    const s = sanitizeSave({
      version: 2,
      unlockedLevel: 9999,
      best: { 1: 700, 2: 'x', 500: 3 },
      stars: { 1: 9, 2: 2 },
      settings: { sound: 'yes', quality: 'ultra', renderer: '2d', difficulty: 'nightmare', masterVol: 7 },
      seenTypes: ['shrink', 'bogus', 'shrink'],
      theme: 'moon',
    });
    expect(s.unlockedLevel).toBe(1);
    expect(s.best).toEqual({ 1: 700 });
    expect(s.stars).toEqual({ 2: 2 });
    expect(s.settings).toMatchObject({ sound: true, quality: 'auto', renderer: '2d', difficulty: 'normal', masterVol: 1 });
    expect(s.seenTypes).toEqual(['shrink']);
    expect(s.theme).toBe('ice');

    const old = sanitizeSave({ unlocked: 4, bestScores: { 3: 900 } });
    expect(old.unlockedLevel).toBe(4);
    expect(old.best[3]).toBe(900);
  });

  it('migrates version-1 per-terrain bests to one global best per level (the max)', () => {
    const s = sanitizeSave({
      version: 1,
      unlockedLevel: 5,
      best: { ice: { 1: 700, 2: 400 }, volcano: { 1: 900, 3: 250 } },
    });
    expect(s.best).toEqual({ 1: 900, 2: 400, 3: 250 });
  });

  it('unlocks only on wins, keeps one best and star rating per level, and caps at 100', () => {
    const store = new SaveStore(new MemoryStorage());
    expect(store.recordStage(1, 300, false).unlocked).toBe(null);
    expect(store.isUnlocked(2)).toBe(false);
    store.recordStage(1, 650, true, 2);
    expect(store.isUnlocked(2)).toBe(true);
    expect(store.bestScore(1)).toBe(650);
    expect(store.starsFor(1)).toBe(2);
    expect(store.recordStage(1, 100, false).best).toBe(650);
    store.recordStage(1, 90, true, 1); // a worse later win never lowers the stars
    expect(store.starsFor(1)).toBe(2);
    store.data.unlockedLevel = 100;
    expect(store.recordStage(100, 3000, true).unlocked).toBe(null);
    expect(store.data.unlockedLevel).toBe(100);

    const reloaded = new SaveStore(store.storage);
    expect(reloaded.bestScore(1)).toBe(650);
    reloaded.setTheme('volcano');
    reloaded.resetProgress();
    expect(reloaded.data.unlockedLevel).toBe(1);
    expect(reloaded.bestScore(1)).toBe(0);
    expect(reloaded.data.theme).toBe('volcano'); // reset keeps the chosen terrain
  });

  it('keeps a bounded leaderboard, daily best, endless best, and a validated resume snapshot', () => {
    const store = new SaveStore(new MemoryStorage());
    for (let i = 0; i < 14; i++) store.recordRun({ mode: 'level', level: 1 + i, score: 100 * (i + 1) });
    expect(store.data.scores).toHaveLength(10);
    expect(store.data.scores[0].score).toBe(1400);

    expect(store.recordDaily('2026-09-25', 12, 800)).toMatchObject({ best: 800, newBest: true });
    expect(store.recordDaily('2026-09-25', 12, 500)).toMatchObject({ best: 800, newBest: false });
    expect(store.recordDaily('2026-09-26', 14, 300).best).toBe(300); // a new day starts over

    expect(store.recordEndless(2500).newBest).toBe(true);
    expect(store.recordEndless(1000)).toMatchObject({ best: 2500, newBest: false });

    const snap = { mode: 'level', seed: 123, level: 4, startLevel: 2, lives: 2, bank: 3, restoresUsed: 1, stagesCleared: 2, totalScore: 1800 };
    store.setResume(snap);
    expect(new SaveStore(store.storage).data.resume).toEqual(snap);
    store.setResume({ mode: 'level', seed: -1 }); // invalid snapshots are dropped, not kept broken
    expect(store.data.resume).toBe(null);
    store.setResume(snap);
    store.clearResume();
    expect(new SaveStore(store.storage).data.resume).toBe(null);
  });
});

describe('fixed-step loop', () => {
  const makeLoop = (state) =>
    new FixedStepLoop({
      step: () => state.ticks++,
      render: () => {},
      shouldStep: () => !state.paused,
    });

  it('steps at the fixed rate', () => {
    const state = { ticks: 0, paused: false };
    const loop = makeLoop(state);
    loop.frame(0);
    for (let i = 1; i <= 60; i++) loop.frame((i * 1000) / 60);
    expect(state.ticks).toBeGreaterThanOrEqual(TICK_RATE - 1);
    expect(state.ticks).toBeLessThanOrEqual(TICK_RATE + 1);
  });

  it('does not advance while paused and never replays a long gap', () => {
    const state = { ticks: 0, paused: true };
    const loop = makeLoop(state);
    loop.frame(0);
    loop.frame(5000);
    expect(state.ticks).toBe(0);
    state.paused = false;
    loop.frame(60000); // a minute in the background
    expect(state.ticks).toBeLessThanOrEqual(Math.ceil(LOOP.maxFrameDelta * TICK_RATE));
    loop.resetClock();
    const before = state.ticks;
    loop.frame(120000);
    expect(state.ticks).toBe(before);
  });
});
