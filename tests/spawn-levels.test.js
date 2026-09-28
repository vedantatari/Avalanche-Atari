import { describe, expect, it } from 'vitest';
import { generateStageSchedule, findFairnessViolations, largestSafeGap } from '../src/game/spawn-director.js';
import { maxReachableScore } from '../src/game/reachability.js';
import { stageDuration, stageTarget, targetShare, difficultyFor, difficultyLevel } from '../src/game/levels.js';
import { enabledItemTypes, isNegative, isScoring, typesIntroducedAt, ITEM_TYPES } from '../src/game/items.js';
import { ARENA, ROCK, SPAWN_WEIGHTS, FAIRNESS, DIFFICULTY, LEVELS } from '../src/config.js';
import { cliffCells } from '../src/game/cliff.js';

describe('levels', () => {
  it('runs every stage on the same 45-second clock', () => {
    for (const level of [1, 15, 16, 49, 50, 100]) expect(stageDuration(level)).toBe(45);
  });

  it('sets dynamic targets: a rising share of the stage’s own reachable score, rounded to 50', () => {
    let prev = 0;
    for (let level = 1; level <= 100; level++) {
      expect(targetShare(level)).toBeGreaterThan(prev);
      prev = targetShare(level);
    }
    expect(targetShare(1)).toBeCloseTo(LEVELS.targetShare.start, 9);
    expect(stageTarget(1, 3000)).toBe(Math.round((3000 * LEVELS.targetShare.start) / 50) * 50);
    for (const reachable of [700, 3333, 9999]) {
      for (const level of [1, 50, 100]) {
        const t = stageTarget(level, reachable);
        expect(t % 50).toBe(0);
        expect(reachable / t).toBeGreaterThanOrEqual(FAIRNESS.minReachableScoreRatio);
      }
    }
    expect(stageTarget(1, 0)).toBe(50);
    // Targets change with the level and with the rocks each run actually offers.
    expect(generateStageSchedule(60, 5).target).toBeGreaterThan(generateStageSchedule(1, 5).target);
    expect(new Set(SEEDS.map((s) => generateStageSchedule(10, s).target)).size).toBeGreaterThan(1);
    for (const seed of SEEDS) {
      const s = generateStageSchedule(10, seed);
      expect(s.target).toBe(stageTarget(10, s.reachableScore));
    }
  });

  it('starts level 1 at the offset difficulty (hard from the first stage) and eases toward the bounds', () => {
    const approach = ({ start, min, levelScale }, l) => min + (start - min) * Math.exp(-(l - 1) / levelScale);
    const d1 = 1 + LEVELS.difficultyOffset;
    expect(difficultyLevel(1)).toBe(d1);
    let prev = difficultyFor(1);
    expect(prev.dropInterval).toBeCloseTo(approach(DIFFICULTY.dropInterval, d1), 9);
    expect(prev.fallSeconds).toBeCloseTo(approach(DIFFICULTY.fallSeconds, d1), 9);
    // All multi-drop patterns are live from level 1 (offset 14 ≥ stackFromLevel 14).
    expect(prev.sweep).toBe(true);
    expect(prev.pair).toBe(true);
    expect(prev.stack).toBe(true);
    for (let level = 2; level <= 100; level++) {
      const d = difficultyFor(level);
      expect(d.dropInterval).toBeLessThan(prev.dropInterval);
      expect(d.dropInterval).toBeGreaterThan(DIFFICULTY.dropInterval.min);
      expect(d.fallSeconds).toBeGreaterThan(DIFFICULTY.fallSeconds.min);
      prev = d;
    }
  });

  it('drops every classic rock type from level 1; the newer rocks arrive over levels 2–8', () => {
    const NEWER = ['split', 'magnet', 'mystery', 'frost'];
    const classic = ITEM_TYPES.filter((t) => SPAWN_WEIGHTS[t] > 0 && !NEWER.includes(t));
    expect(enabledItemTypes(1)).toEqual(classic);
    expect(enabledItemTypes(1)).toContain('shrink');
    expect(enabledItemTypes(1)).toContain('reverse');
    const introduced = {};
    for (let level = 1; level <= 10; level++) for (const t of typesIntroducedAt(level)) introduced[t] = level;
    expect(introduced).toEqual({ split: 2, magnet: 3, mystery: 5, frost: 8 });
    expect(enabledItemTypes(8)).toEqual(ITEM_TYPES.filter((t) => SPAWN_WEIGHTS[t] > 0));
  });
});

const LEVEL_SAMPLE = [1, 2, 3, 5, 8, 12, 16, 25, 40, 50, 75, 100];
const SEEDS = [1, 7, 99, 2024, 31337];

describe('spawn director', () => {
  it('reproduces the same schedule from the same seed and differs across seeds', () => {
    const a = generateStageSchedule(9, 555);
    const b = generateStageSchedule(9, 555);
    const c = generateStageSchedule(9, 556);
    expect(JSON.stringify(a.drops)).toBe(JSON.stringify(b.drops));
    expect(JSON.stringify(a.drops)).not.toBe(JSON.stringify(c.drops));
  });

  it('keeps every drop inside the arena, on a real cliff cell, and before the deadline', () => {
    const cells = cliffCells();
    for (const level of LEVEL_SAMPLE) {
      const s = generateStageSchedule(level, 42);
      for (const d of s.drops) {
        expect(Math.abs(d.x) + ROCK.radius).toBeLessThanOrEqual(ARENA.halfWidth);
        // Split halves leave their cell's column mid-fall; everything else lands under it.
        expect(cells[d.cellId].x).toBe(d.x0 ?? d.x);
        if (d.x0 === undefined) expect(d.x).toBe(cells[d.cellId].x);
        expect(cells[d.cellId].y).toBe(d.y0);
        expect(d.arriveAt).toBeLessThanOrEqual(s.duration);
        expect(d.detachAt - d.crackAt).toBeGreaterThanOrEqual(DIFFICULTY.crackSeconds.min - 1e-9);
        expect(d.detachAt - d.crackAt).toBeLessThanOrEqual(DIFFICULTY.crackSeconds.max + 1e-9);
        // The demon has spawn weight 0: it is scheduled on its own clock, not drawn from the bag.
        if (d.type !== 'demon') expect(enabledItemTypes(level)).toContain(d.type);
      }
    }
  });

  it('never reuses a cell before it has visibly refilled', () => {
    for (const level of [1, 30, 100]) {
      const { drops } = generateStageSchedule(level, 8);
      const byCell = new Map();
      // The two halves of a split rock leave one cell together, as one rock.
      for (const d of drops.filter((x) => x.half !== 1)) {
        const prev = byCell.get(d.cellId);
        if (prev) expect(d.crackAt).toBeGreaterThanOrEqual(prev.refillEndAt - 1e-9);
        byCell.set(d.cellId, d);
      }
    }
  });

  it('obeys fairness: no forced damage, safe gaps, capped hazard/drought streaks', () => {
    for (const level of LEVEL_SAMPLE) {
      for (const seed of SEEDS) {
        const { drops } = generateStageSchedule(level, seed);
        expect(findFairnessViolations(drops)).toEqual([]);
        let neg = 0;
        let dry = 0;
        for (const d of [...drops].sort((a, b) => a.crackAt - b.crackAt)) {
          neg = isNegative(d.type) ? neg + 1 : 0;
          dry = isScoring(d.type) ? 0 : dry + 1;
          expect(neg).toBeLessThanOrEqual(FAIRNESS.maxConsecutiveNegative);
          expect(dry).toBeLessThanOrEqual(FAIRNESS.maxConsecutiveNonScoring);
        }
      }
    }
  });

  it('keeps every target at or below reachable / 1.4 on sampled routes', () => {
    const ratios = [];
    for (const level of LEVEL_SAMPLE) {
      for (const seed of SEEDS) {
        const s = generateStageSchedule(level, seed);
        const reachable = maxReachableScore(s.drops);
        expect(reachable).toBe(s.reachableScore);
        expect(reachable / s.target).toBeGreaterThanOrEqual(FAIRNESS.minReachableScoreRatio);
        ratios.push(reachable / s.target);
      }
    }
    // Targets are tight but fair: never above reachable / 1.4, never trivially low.
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(1.4);
    expect(Math.max(...ratios)).toBeLessThan(1.95);
  });

  it('keeps long-run type frequencies close to the configured weights', () => {
    const counts = Object.fromEntries(ITEM_TYPES.map((t) => [t, 0]));
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const d of generateStageSchedule(60, seed).drops) {
        if (d.pattern) continue; // patterns add extra coins by design
        if (d.type === 'demon') continue; // demons are on a fixed clock, not the weighted bag
        counts[d.type]++;
        total++;
      }
    }
    const weightTotal = ITEM_TYPES.reduce((s, t) => s + SPAWN_WEIGHTS[t], 0);
    for (const t of ITEM_TYPES) {
      expect(Math.abs(counts[t] / total - SPAWN_WEIGHTS[t] / weightTotal)).toBeLessThan(0.03);
    }
    expect(counts.shield).toBeLessThan(counts.coin / 5);
  });

  it('schedules a demon roughly every 12 seconds, falling faster than the regular drops', () => {
    for (const [level, seed] of [[1, 3], [20, 7], [60, 11]]) {
      const s = generateStageSchedule(level, seed);
      const demons = s.drops.filter((d) => d.type === 'demon').sort((a, b) => a.crackAt - b.crackAt);
      // One per 12 s cadence, minus at most a couple lost to the end-of-stage cutoff or retries.
      expect(demons.length).toBeGreaterThanOrEqual(Math.floor(s.duration / 12) - 2);
      expect(demons.length).toBeLessThanOrEqual(Math.ceil(s.duration / 12));
      const regularFall = s.drops.find((d) => d.type !== 'demon').fallSeconds;
      for (const d of demons) expect(d.fallSeconds).toBeLessThan(regularFall);
      // The cadence anchors to a 12 s grid; a delayed placement may shorten one gap a little.
      for (let i = 1; i < demons.length; i++) {
        expect(demons[i].crackAt - demons[i - 1].crackAt).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('spreads drops across the playfield without clustering', () => {
    const { drops } = generateStageSchedule(20, 77);
    const xs = drops.map((d) => d.x);
    expect(Math.min(...xs)).toBeLessThan(-5);
    expect(Math.max(...xs)).toBeGreaterThan(5);
    const thirds = [0, 0, 0];
    for (const x of xs) thirds[x < -2.7 ? 0 : x > 2.7 ? 2 : 1]++;
    for (const n of thirds) expect(n / xs.length).toBeGreaterThan(0.2);
  });

  it('terrain never changes which rocks fall, from where, or when — heat vents only move landings', () => {
    expect(generateStageSchedule.length).toBe(2);
    const plain = generateStageSchedule(33, 9);
    expect(plain.drops.length).toBeGreaterThan(100);
    const ice = generateStageSchedule(33, 9, { terrain: 'ice' });
    const volcano = generateStageSchedule(33, 9, { terrain: 'volcano' });
    const shape = (s) => s.drops.map((d) => [d.id, d.type, d.cellId, d.crackAt, d.detachAt, d.arriveAt]);
    expect(shape(ice)).toEqual(shape(plain));
    expect(shape(volcano)).toEqual(shape(plain));
    expect(ice.drops.map((d) => d.x)).toEqual(plain.drops.map((d) => d.x));
    expect(volcano.drops.some((d, i) => d.x !== plain.drops[i].x)).toBe(true);
  });

  it('computes safe gaps between hazards', () => {
    expect(largestSafeGap([])).toBeGreaterThan(10);
    expect(largestSafeGap([0])).toBeGreaterThan(3);
  });
});
