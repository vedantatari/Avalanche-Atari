import { afterEach, describe, expect, it } from 'vitest';
import { MODES, PHASE, Simulation } from '../src/game/simulation.js';
import { setDifficultyMode, getDifficultyMode, difficultyFor, targetShare, stageTarget } from '../src/game/levels.js';
import { generateStageSchedule } from '../src/game/spawn-director.js';
import { COMBO, FAIRNESS, TICK_RATE } from '../src/config.js';
import { eventsOf, makeDrop, runUntil, simWithDrops } from './helpers.js';

describe('combo streak', () => {
  it('pays a rising bonus every 5 consecutive scoring catches', () => {
    const drops = Array.from({ length: 10 }, (_, i) => makeDrop(i, 'coin', 0, 2 + i * 0.5));
    const sim = simWithDrops(drops, { duration: 10 });
    runUntil(sim, 8);
    const catches = eventsOf(sim.drainEvents(), 'catch');
    expect(catches.map((e) => e.combo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(catches[4].comboBonus).toBe(COMBO.bonus);
    expect(catches[9].comboBonus).toBe(COMBO.bonus * 2);
    expect(catches[3].comboBonus).toBeUndefined();
    // 10 coins + the two milestone bonuses.
    expect(sim.stage.score).toBe(500 + COMBO.bonus * 3);
    expect(sim.stage.bestCombo).toBe(10);
  });

  it('resets when a scoring rock is missed or damage is taken; other items leave it alone', () => {
    const sim = simWithDrops([
      makeDrop(0, 'coin', 0, 2),
      makeDrop(1, 'shield', 0, 2.5), // neither extends nor breaks the streak
      makeDrop(2, 'coin', 6.5, 3), // missed scoring rock: streak breaks
      makeDrop(3, 'coin', 0, 4),
      makeDrop(4, 'fire', 0, 4.5), // damage: streak breaks again
      makeDrop(5, 'coin', 0, 6),
    ]);
    runUntil(sim, 7);
    const events = sim.drainEvents();
    const catches = eventsOf(events, 'catch');
    expect(catches.filter((e) => e.combo !== undefined).map((e) => e.combo)).toEqual([1, 1, 1]);
    expect(eventsOf(events, 'miss').find((e) => e.id === 2).comboLost).toBe(1);
    expect(sim.stage.bestCombo).toBe(1);
  });
});

describe('endless mode', () => {
  const endlessSim = () => {
    const sim = new Simulation({ durationOverride: 3 });
    sim.startRun(1, { seed: 77, mode: MODES.ENDLESS });
    sim.beginPlay();
    return sim;
  };

  it('has no target and rolls the deadline into the next, harder wave without ending', () => {
    const sim = endlessSim();
    expect(sim.stage.target).toBe(null);
    sim.stage.schedule.drops = [];
    runUntil(sim, 2.9);
    sim.stage.score = 700;
    while (sim.stage.level === 1 && sim.phase === PHASE.PLAYING) sim.tick();
    expect(sim.phase).toBe(PHASE.PLAYING);
    expect(sim.stage.level).toBe(2);
    expect(sim.stage.tick).toBe(0);
    expect(sim.run.totalScore).toBe(700);
    const up = eventsOf(sim.drainEvents(), 'endlessLevelUp');
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ level: 2, wave: 2, total: 700 });
  });

  it('ends only on death, reporting the cumulative total', () => {
    const sim = endlessSim();
    sim.stage.schedule.drops = [makeDrop(0, 'demon', 0, 2)];
    sim.stage.score = 300;
    sim.run.totalScore = 1200;
    runUntil(sim, 2.5);
    expect(sim.phase).toBe(PHASE.ENDED);
    const [end] = eventsOf(sim.drainEvents(), 'stageEnd');
    expect(end).toMatchObject({ mode: 'endless', total: 1500, result: 'lost' });
    expect(end.finalLevel).toBe(false);
  });

  it('never emits targetReached and cannot continue like a campaign win', () => {
    const sim = endlessSim();
    sim.stage.schedule.drops = [makeDrop(0, 'cash', 0, 2)];
    runUntil(sim, 2.5);
    expect(eventsOf(sim.drainEvents(), 'targetReached')).toHaveLength(0);
    expect(sim.continueRun()).toBe(false);
  });
});

describe('daily mode and resume', () => {
  it('a daily run is a single stage: no next level, and retry keeps the seed', () => {
    const sim = new Simulation({ durationOverride: 2 });
    sim.startRun(12, { seed: 424242, mode: MODES.DAILY });
    sim.beginPlay();
    sim.stage.schedule.drops = [];
    sim.stage.score = sim.stage.target;
    runUntil(sim, 3);
    expect(sim.stage.result).toBe('won');
    expect(sim.continueRun()).toBe(false);
    const firstSchedule = JSON.stringify(sim.stage.schedule.drops);
    sim.retry();
    expect(sim.run.seed).toBe(424242);
    expect(sim.stage.level).toBe(12);
    expect(JSON.stringify(sim.stage.schedule.drops)).toBe(firstSchedule);
  });

  it('resumeRun rebuilds the run and replays the same stage schedule', () => {
    const sim = new Simulation();
    sim.startRun(3, { seed: 999 });
    const original = JSON.stringify(sim.stage.schedule.drops);
    const other = new Simulation();
    other.resumeRun({ mode: 'level', seed: 999, level: 3, startLevel: 3, lives: 2, bank: 4, restoresUsed: 1, stagesCleared: 0, totalScore: 350 });
    expect(other.run).toMatchObject({ lives: 2, bank: 4, restoresUsed: 1, totalScore: 350 });
    expect(JSON.stringify(other.stage.schedule.drops)).toBe(original);
  });
});

describe('pointer follow', () => {
  const follow = (x) => ({ dir: 0, dragActive: false, dragDelta: 0, followX: x });

  it('moves the cart to the pointer x and holds it there', () => {
    const sim = simWithDrops([]);
    runUntil(sim, 2, follow(4));
    expect(sim.cart.x).toBeCloseTo(4, 6);
    runUntil(sim, 3, follow(-2));
    expect(sim.cart.x).toBeCloseTo(-2, 6);
  });

  it('is mirrored while reversed and yields to keyboard input', () => {
    const sim = simWithDrops([makeDrop(0, 'reverse', 0, 2)]);
    runUntil(sim, 2.05);
    expect(sim.isReversed()).toBe(true);
    runUntil(sim, 3.5, follow(3));
    expect(sim.cart.x).toBeCloseTo(-3, 6);
    const before = sim.cart.x;
    runUntil(sim, 3.7, { dir: 1, dragActive: false, dragDelta: 0, followX: 3 });
    expect(sim.cart.x).toBeLessThan(before); // reversed keyboard right wins over the follow target
  });
});

describe('difficulty modes', () => {
  afterEach(() => setDifficultyMode('normal'));

  it('easy slows drops and lowers targets; hard does the opposite within the fairness cap', () => {
    const normal = { d: difficultyFor(10), share: targetShare(10), target: generateStageSchedule(10, 5).target };
    setDifficultyMode('easy');
    expect(getDifficultyMode()).toBe('easy');
    const easy = { d: difficultyFor(10), share: targetShare(10) };
    expect(easy.d.dropInterval).toBeGreaterThan(normal.d.dropInterval);
    expect(easy.d.fallSeconds).toBeGreaterThan(normal.d.fallSeconds);
    expect(easy.share).toBeLessThan(normal.share);
    setDifficultyMode('hard');
    const hard = { d: difficultyFor(10), share: targetShare(10) };
    expect(hard.d.dropInterval).toBeLessThan(normal.d.dropInterval);
    expect(hard.d.fallSeconds).toBeLessThan(normal.d.fallSeconds);
    // Hard targets still respect the reachable-score fairness floor.
    for (const seed of [5, 77]) {
      const s = generateStageSchedule(10, seed);
      expect(s.reachableScore / s.target).toBeGreaterThanOrEqual(FAIRNESS.minReachableScoreRatio);
      expect(s.target).toBe(stageTarget(10, s.reachableScore));
    }
    setDifficultyMode('bogus');
    expect(getDifficultyMode()).toBe('normal');
  });

  it('normal mode reproduces the exact default schedules', () => {
    const a = generateStageSchedule(9, 555);
    setDifficultyMode('easy');
    setDifficultyMode('normal');
    const b = generateStageSchedule(9, 555);
    expect(JSON.stringify(a.drops)).toBe(JSON.stringify(b.drops));
  });
});

describe('endless waves stay fair', () => {
  it('generates seeded, fairness-checked schedules for high waves at 120 ticks per second', () => {
    expect(TICK_RATE).toBe(120);
    const sim = new Simulation({ durationOverride: 2 });
    sim.startRun(1, { seed: 5, mode: MODES.ENDLESS });
    sim.beginPlay();
    for (let wave = 0; wave < 3; wave++) {
      sim.stage.schedule.drops = [];
      const lvl = sim.stage.level;
      for (let i = 0; i < 400 && sim.stage.level === lvl; i++) sim.tick();
    }
    expect(sim.stage.level).toBe(4);
    expect(sim.phase).toBe(PHASE.PLAYING);
  });
});
