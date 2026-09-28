import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, AchievementTracker, emptyStats } from '../src/achievements.js';
import { SaveStore, defaultSave, sanitizeSave } from '../src/storage.js';
import { MYSTERY, SPLIT } from '../src/config.js';
import { makeDrop, runUntil, simWithDrops } from './helpers.js';

const fakeStore = () => ({ data: { achievements: {}, stats: emptyStats() } });
const ids = (list) => list.map((a) => a.id);
const win = (extra = {}) => ({ type: 'stageEnd', result: 'won', mode: 'level', level: 3, score: 900, reachable: 2000, livesLost: 1, terrain: 'ice', modifier: null, ...extra });

describe('trophy list', () => {
  it('has unique ids, titles and descriptions, and goals only on lifetime trophies', () => {
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(24);
    for (const a of ACHIEVEMENTS) {
      expect(a.title.length).toBeGreaterThan(2);
      expect(a.desc.length).toBeGreaterThan(8);
      expect(a.icon).toBeTruthy();
      if (a.goal) expect(typeof a.progress(emptyStats())).toBe('number');
    }
  });
});

describe('trophy tracker', () => {
  it('unlocks stage-clear trophies from a win, once each', () => {
    const store = fakeStore();
    const t = new AchievementTracker(store);
    const run = { restoresUsed: 0, stagesCleared: 1 };
    t.onEvents([{ type: 'stageStart' }], { run });
    const got = t.onEvents([win({ livesLost: 0, score: 1900, reachable: 2000 })], { run, difficulty: 'normal' });
    expect(ids(got)).toEqual(['first-clear', 'untouchable', 'perfectionist']);
    expect(Object.keys(store.data.achievements)).toEqual(['first-clear', 'untouchable', 'perfectionist']);
    expect(store.data.stats.clears).toBe(1);
    expect(store.data.stats.points).toBe(1900);
    expect(t.onEvents([win({ livesLost: 0, score: 1900, reachable: 2000 })], { run })).toEqual([]);
  });

  it('reads terrain, modifier, difficulty, mode, and level from the stage end', () => {
    const store = fakeStore();
    const t = new AchievementTracker(store);
    const run = { restoresUsed: 1, stagesCleared: 1 };
    const got = [
      ...t.onEvents([win({ terrain: 'ice', modifier: 'windy' })], { run, difficulty: 'hard' }),
      ...t.onEvents([win({ terrain: 'volcano', modifier: 'fog', mode: 'daily', level: 12 })], { run }),
      ...t.onEvents([win({ modifier: 'goldRush', level: 25 })], { run }),
    ];
    expect(ids(got)).toEqual(expect.arrayContaining(['weathered', 'hard-as-rock', 'fog-walker', 'daily-grind', 'world-traveller', 'gold-fever', 'climber', 'mountaineer']));
    expect(ids(got)).not.toContain('high-camp');
    expect(store.data.stats.terrains).toEqual(['ice', 'volcano']);
  });

  it('comeback needs a revive restore and a clear; no-safety-net needs 5 clears without restores', () => {
    const t = new AchievementTracker(fakeStore());
    const run = { restoresUsed: 0, stagesCleared: 4 };
    t.onEvents([{ type: 'stageStart' }, { type: 'restore', fromRevive: false }], { run });
    expect(ids(t.onEvents([win()], { run }))).not.toContain('comeback');
    t.onEvents([{ type: 'stageStart' }, { type: 'restore', fromRevive: true }], { run });
    run.stagesCleared = 5;
    expect(ids(t.onEvents([win()], { run }))).toEqual(expect.arrayContaining(['comeback', 'no-safety-net']));
  });

  it('counts demons dodged per run: a new run starts over', () => {
    const t = new AchievementTracker(fakeStore());
    const miss = { type: 'miss', itemType: 'demon' };
    const runA = {};
    expect(t.onEvents(Array(9).fill(miss), { run: runA })).toEqual([]);
    const runB = {};
    expect(t.onEvents(Array(9).fill(miss), { run: runB })).toEqual([]);
    expect(ids(t.onEvents([miss], { run: runB }))).toEqual(['demon-dancer']);
  });

  it('tracks streaks, the bank, multiplier windows, clones, magnets, splits, and jackpots', () => {
    const store = fakeStore();
    const t = new AchievementTracker(store);
    const run = {};
    const c = (extra) => ({ type: 'catch', itemType: 'coin', ...extra });
    const got = t.onEvents([
      { type: 'stageStart' },
      c({ combo: 10 }),
      c({ itemType: 'shield', bank: 8 }),
      c({ itemType: 'mult5', effect: 'multiplier', multiplier: 5 }),
      c({ score: 250, multiplier: 5 }),
      c({ score: 250, multiplier: 5, comboBonus: 50 }),
      c({ itemType: 'clone', effect: 'clone' }),
      c({ scoop: 1 }),
      c({ scoop: -1 }),
      c({ scoop: 1 }),
      c({ itemType: 'magnet', effect: 'magnet' }),
      c({ pulled: true }),
      c({ pulled: true }),
      c({ pulled: true }),
      c({ itemType: 'split', pair: 7 }),
      c({ itemType: 'split', pair: 7 }),
      c({ itemType: 'mystery', reveal: 'jackpot', score: MYSTERY.jackpot }),
    ], { run });
    expect(ids(got)).toEqual(['hot-streak', 'rainy-day', 'five-fold', 'shadow-crew', 'magnetic', 'split-decision', 'jackpot']);
    expect(store.data.stats.bestCombo).toBe(10);
    expect(store.data.stats.jackpots).toBe(1);
    expect(store.data.stats.caught.coin).toBe(9);
  });

  it('a multiplier window ends with its effect; one split half is not enough', () => {
    const t = new AchievementTracker(fakeStore());
    const got = t.onEvents([
      { type: 'stageStart' },
      { type: 'catch', itemType: 'mult5', effect: 'multiplier', multiplier: 5 },
      { type: 'catch', itemType: 'cash', score: 400, multiplier: 5 },
      { type: 'effectEnd', effect: 'multiplier' },
      { type: 'catch', itemType: 'cash', score: 400 },
      { type: 'catch', itemType: 'split', pair: 3 },
      { type: 'stageStart' },
      { type: 'catch', itemType: 'split', pair: 3 },
    ], { run: {} });
    expect(got).toEqual([]);
  });

  it('unlocks lifetime trophies from accumulated stats and endless waves', () => {
    const store = fakeStore();
    store.data.stats.caught.coin = 999;
    store.data.stats.points = 99_000;
    const t = new AchievementTracker(store);
    const got = t.onEvents([
      { type: 'catch', itemType: 'coin', score: 50 },
      { type: 'endlessLevelUp', wave: 5, score: 1200, total: 5000 },
    ], { run: {} });
    expect(ids(got)).toEqual(['gold-digger', 'survivor', 'fortune']);
    expect(store.data.stats.bestWave).toBe(5);
  });

  it('works on real simulation events: both halves of a split rock', () => {
    const halves = [-1, 1].map((half) => {
      const d = makeDrop(half > 0 ? 1 : 0, 'split', half * SPLIT.offset, 2.5);
      return { ...d, x0: 0, driftStart: d.detachAt + 0.7, driftEnd: d.detachAt + 1.4, half, pair: 0 };
    });
    const sim = simWithDrops(halves);
    const t = new AchievementTracker(fakeStore());
    runUntil(sim, 4);
    expect(ids(t.onEvents(sim.drainEvents(), { run: sim.run }))).toEqual(['split-decision']);
  });
});

describe('save: trophies, stats, haptics', () => {
  it('defaults to no trophies, empty stats, and vibration on', () => {
    const s = defaultSave();
    expect(s.achievements).toEqual({});
    expect(s.stats).toEqual(emptyStats());
    expect(s.settings.haptics).toBe(true);
  });

  it('keeps valid trophies and stats, drops unknown or tampered ones', () => {
    const s = sanitizeSave({
      version: 2,
      achievements: { 'first-clear': '2026-09-28T10:00', bogus: '2026-01-01', untouchable: 7 },
      stats: { caught: { coin: 12, nope: 4, cash: -3 }, points: '1500', clears: 2.9, playSeconds: 61.5, terrains: ['volcano', 'moon', 'ice'] },
      settings: { haptics: 'yes' },
    });
    expect(s.achievements).toEqual({ 'first-clear': '2026-09-28' });
    expect(s.stats.caught).toEqual({ coin: 12 });
    expect(s.stats).toMatchObject({ points: 1500, clears: 2, playSeconds: 61.5, terrains: ['ice', 'volcano'] });
    expect(s.settings.haptics).toBe(true);
    expect(sanitizeSave({ settings: { haptics: false } }).settings.haptics).toBe(false);
  });

  it('resetting progress clears trophies and stats but keeps settings', () => {
    const store = new SaveStore(null);
    store.data.achievements['first-clear'] = '2026-09-28';
    store.data.stats.points = 5000;
    store.setSetting('haptics', false);
    expect(store.hasAchievement('first-clear')).toBe(true);
    store.resetProgress();
    expect(store.hasAchievement('first-clear')).toBe(false);
    expect(store.stats.points).toBe(0);
    expect(store.settings.haptics).toBe(false);
  });
});
