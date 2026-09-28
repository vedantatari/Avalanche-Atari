import { describe, expect, it } from 'vitest';
import { PHASE, Simulation } from '../src/game/simulation.js';
import { findFairnessViolations, generateStageSchedule } from '../src/game/spawn-director.js';
import { maxReachableScore } from '../src/game/reachability.js';
import { stageModifier } from '../src/game/levels.js';
import { cliffCells, dropXAt } from '../src/game/cliff.js';
import { ARENA, BASE_SCOOP_WIDTH, CART_MAX_SPEED, EFFECTS, FAIRNESS, MODIFIERS, MYSTERY, ROCK, SPLIT, TERRAIN_RULES } from '../src/config.js';
import { eventsOf, makeDrop, runTicks, runUntil, simWithDrops } from './helpers.js';

const RIGHT = { dir: 1, dragActive: false, dragDelta: 0, followX: null };
const LEFT = { dir: -1, dragActive: false, dragDelta: 0, followX: null };
const follow = (x) => ({ dir: 0, dragActive: false, dragDelta: 0, followX: x });
const REACH = BASE_SCOOP_WIDTH / 2 + ROCK.radius;

/** A running stage with no rocks, on the given terrain, with the cart parked at `x`. */
function emptyStage(terrain, x = 0) {
  const sim = new Simulation();
  sim.startRun(1, { seed: 1, terrain });
  sim.stage.schedule.drops = [];
  sim.beginPlay();
  sim.cart.x = sim.cart.prevX = x;
  return sim;
}

describe('terrain rules: ice (slippery rail)', () => {
  it('keeps top speed but glides on after release, where classic control stops at once', () => {
    const glide = (terrain) => {
      const sim = emptyStage(terrain, -6);
      runTicks(sim, 40, RIGHT);
      expect(sim.cart.v).toBeCloseTo(CART_MAX_SPEED, 9);
      const x = sim.cart.x;
      runTicks(sim, 12);
      const coast = sim.cart.x - x;
      runTicks(sim, 60);
      expect(sim.cart.v).toBe(0);
      return coast;
    };
    expect(glide(null)).toBeLessThan(0.5);
    expect(glide('ice')).toBeGreaterThan(1);
  });

  it('turns with limited grip: reversing brakes through zero instead of flipping instantly', () => {
    const sim = emptyStage('ice', -6);
    runTicks(sim, 40, RIGHT);
    sim.tick(LEFT);
    expect(sim.cart.v).toBeGreaterThan(CART_MAX_SPEED * 0.8);
    runTicks(sim, 40, LEFT);
    expect(sim.cart.v).toBeCloseTo(-CART_MAX_SPEED, 9);
    const classic = emptyStage(null, -6);
    runTicks(classic, 40, RIGHT);
    classic.tick(LEFT);
    expect(classic.cart.v).toBeLessThanOrEqual(0);
  });

  it('chases a pointer target smoothly and settles exactly on it without overshooting', () => {
    const sim = emptyStage('ice', 0);
    let most = -Infinity;
    for (let i = 0; i < 180; i++) {
      sim.tick(follow(4));
      most = Math.max(most, sim.cart.x);
    }
    expect(most).toBeLessThanOrEqual(4 + 1e-9);
    expect(sim.cart.x).toBeCloseTo(4, 9);
    expect(sim.cart.v).toBe(0);
    runTicks(sim, 30, follow(4));
    expect(sim.cart.x).toBeCloseTo(4, 9);
  });

  it('models the sluggish turns in the reachable score, so ice targets are never harder', () => {
    for (const seed of [1, 7, 99]) {
      const plain = generateStageSchedule(20, seed);
      const ice = generateStageSchedule(20, seed, { terrain: 'ice' });
      expect(ice.reachableScore).toBe(maxReachableScore(ice.drops, { speedShare: FAIRNESS.reachSpeedShare * TERRAIN_RULES.ice.reachFactor }));
      expect(ice.reachableScore).toBeLessThanOrEqual(plain.reachableScore);
      expect(ice.target).toBeLessThanOrEqual(plain.target);
    }
  });
});

describe('terrain rules: volcano (heat vents)', () => {
  it('pushes some rocks sideways mid-fall, keeping every landing fair and inside the arena', () => {
    const cells = cliffCells();
    const shares = [];
    for (const level of [1, 12, 33, 60, 100]) {
      for (const seed of [1, 7, 99]) {
        const { drops } = generateStageSchedule(level, seed, { terrain: 'volcano' });
        expect(findFairnessViolations(drops)).toEqual([]);
        let pushed = 0;
        for (const d of drops) {
          expect(Math.abs(d.x) + ROCK.radius).toBeLessThanOrEqual(ARENA.halfWidth);
          if (d.x0 === undefined) continue;
          expect(d.x0).toBe(cells[d.cellId].x);
          expect(d.driftStart).toBeGreaterThanOrEqual(d.detachAt);
          expect(d.driftEnd).toBeLessThan(d.arriveAt);
          if (!d.half) pushed++;
        }
        shares.push(pushed / drops.length);
      }
    }
    // Sweeps and stacks keep their shape, so pattern-heavy late stages see fewer pushes.
    expect(Math.min(...shares)).toBeGreaterThan(0.08);
    expect(shares.reduce((a, b) => a + b) / shares.length).toBeGreaterThan(0.18);
  });

  it('eases a pushed rock from its source column to its landing spot', () => {
    const d = generateStageSchedule(33, 9, { terrain: 'volcano' }).drops.find((x) => x.x0 !== undefined && !x.half);
    expect(dropXAt(d, d.detachAt)).toBe(d.x0);
    expect(dropXAt(d, d.driftStart)).toBe(d.x0);
    expect(dropXAt(d, d.arriveAt)).toBe(d.x);
    const mid = dropXAt(d, (d.driftStart + d.driftEnd) / 2);
    expect(mid).toBeCloseTo((d.x0 + d.x) / 2, 9);
  });
});

describe('stage modifiers', () => {
  it('assigns windy / fog / gold rush by the level’s last digit, never to levels 1–3', () => {
    const at = (l) => stageModifier(l);
    expect([1, 2, 3, 5, 6, 8, 10, 100].map(at)).toEqual([null, null, null, null, null, null, null, null]);
    expect([4, 14, 94].map(at)).toEqual(['windy', 'windy', 'windy']);
    expect([7, 17, 97].map(at)).toEqual(['fog', 'fog', 'fog']);
    expect([9, 19, 99].map(at)).toEqual(['goldRush', 'goldRush', 'goldRush']);
    const s = generateStageSchedule(24, 3);
    expect(s.modifier).toBe('windy');
    expect(generateStageSchedule(24, 3, { modifier: null }).modifier).toBe(null);
  });

  it('windy: rocks drift with one stage-wide wind direction, even where heat vents push too', () => {
    for (const seed of [1, 2, 3, 4]) {
      for (const terrain of [null, 'volcano']) {
        const s = generateStageSchedule(14, seed, { terrain });
        expect([-1, 1]).toContain(s.wind);
        const pushed = s.drops.filter((d) => d.x0 !== undefined && !d.half);
        expect(pushed.length / s.drops.length).toBeGreaterThan(0.5);
        for (const d of pushed) expect(Math.sign(d.x - d.x0)).toBe(s.wind);
      }
    }
    expect(generateStageSchedule(15, 1).wind).toBe(0);
  });

  it('fog eases the target; gold rush brings more gold and emeralds', () => {
    for (const seed of [1, 7]) {
      const fog = generateStageSchedule(17, seed);
      const clear = generateStageSchedule(17, seed, { modifier: null });
      expect(JSON.stringify(fog.drops)).toBe(JSON.stringify(clear.drops));
      expect(fog.target).toBeLessThanOrEqual(clear.target);
      expect(fog.target).toBeLessThan(clear.target * (MODIFIERS.fog.targetScale + 0.05));
    }
    const rich = (modifier) => {
      let n = 0;
      let all = 0;
      for (let seed = 1; seed <= 6; seed++) {
        for (const d of generateStageSchedule(19, seed, { modifier }).drops) {
          if (d.pattern) continue;
          all++;
          if (d.type === 'coin' || d.type === 'cash') n++;
        }
      }
      return n / all;
    };
    expect(rich('goldRush')).toBeGreaterThan(rich(null) + 0.05);
  });

  it('stays fair and winnable-shaped on every modifier level, on every terrain', () => {
    for (const level of [4, 7, 9, 14, 17, 19, 24, 44, 57, 69, 94, 97, 99]) {
      for (const seed of [1, 7, 99]) {
        for (const terrain of [null, 'ice', 'volcano']) {
          const s = generateStageSchedule(level, seed, { terrain });
          expect(findFairnessViolations(s.drops)).toEqual([]);
          expect(s.reachableScore / s.target).toBeGreaterThanOrEqual(FAIRNESS.minReachableScoreRatio);
          for (const d of s.drops) expect(Math.abs(d.x) + ROCK.radius).toBeLessThanOrEqual(ARENA.halfWidth);
        }
      }
    }
  });

  it('a player who never moves still cannot clear modifier levels on either terrain', () => {
    for (const level of [4, 7, 9, 17, 44]) {
      for (const terrain of ['ice', 'volcano']) {
        const sim = new Simulation();
        sim.startRun(level, { seed: 3, terrain });
        sim.beginPlay();
        while (sim.phase === PHASE.PLAYING || sim.phase === PHASE.REVIVE) {
          if (sim.phase === PHASE.REVIVE) sim.declineRevive();
          else sim.tick();
        }
        expect(sim.stage.result).toBe('lost');
      }
    }
  });
});

/** A synthetic split pair arriving at `arriveAt` above source column `x0`. */
function splitPair(id, x0, arriveAt) {
  return [-1, 1].map((half) => {
    const d = makeDrop(id + (half > 0 ? 1 : 0), 'split', x0 + half * SPLIT.offset, arriveAt);
    return { ...d, x0, driftStart: d.detachAt + d.fallSeconds * SPLIT.at, driftEnd: d.detachAt + d.fallSeconds * SPLIT.settle, half, pair: id };
  });
}

describe('new rocks', () => {
  it('split: one cell, two halves that part mid-fall and land either side of the column', () => {
    let pairs = 0;
    for (const seed of [1, 2, 3]) {
      const { drops } = generateStageSchedule(20, seed);
      for (const a of drops.filter((d) => d.half === -1)) {
        const b = drops.find((d) => d.pair === a.id && d.half === 1);
        expect(b).toBeTruthy();
        for (const key of ['cellId', 'crackAt', 'detachAt', 'arriveAt', 'x0', 'driftStart', 'driftEnd']) expect(b[key]).toBe(a[key]);
        expect(b.x - a.x).toBeCloseTo(2 * SPLIT.offset, 9);
        expect(b.pattern).toBe('split');
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(2);
    // Both halves together stay within one scoop's reach: a centred cart takes both.
    expect(2 * SPLIT.offset).toBeLessThan(REACH);
  });

  it('split: a centred cart catches both halves (+40 each, two combo steps)', () => {
    const sim = simWithDrops(splitPair(0, 0, 2.5));
    runUntil(sim, 4);
    const catches = eventsOf(sim.drainEvents(), 'catch');
    expect(catches.map((e) => [e.itemType, e.score, e.pair])).toEqual([['split', 40, 0], ['split', 40, 0]]);
    expect(sim.stage.score).toBe(80);
    expect(sim.stage.combo).toBe(2);
  });

  it('magnet: pulls helpful rocks in from further out for 5 s, never hazards', () => {
    const sim = simWithDrops([
      makeDrop(0, 'magnet', 0, 2),
      makeDrop(1, 'coin', REACH + 1, 3),
      makeDrop(2, 'fire', -(REACH + 1), 3.5),
      makeDrop(3, 'coin', REACH + EFFECTS.magnetReach + 0.2, 4),
      makeDrop(4, 'coin', REACH + 1, 2 + EFFECTS.magnetSeconds + 0.2),
    ]);
    runUntil(sim, 2.5);
    expect(sim.hasMagnet()).toBe(true);
    expect(sim.effectTimers().magnetSeconds).toBeCloseTo(4.5, 1);
    runUntil(sim, 9);
    const events = sim.drainEvents();
    const catches = eventsOf(events, 'catch');
    expect(catches.map((e) => [e.itemType, !!e.pulled])).toEqual([['magnet', false], ['coin', true]]);
    expect(eventsOf(events, 'miss').map((e) => e.id)).toEqual([2, 3, 4]);
    expect(sim.run.lives).toBe(3);
    expect(eventsOf(events, 'effectEnd').map((e) => e.effect)).toEqual(['magnet']);
  });

  it('frost: halves the cart’s top speed for exactly 4 s', () => {
    const sim = simWithDrops([makeDrop(0, 'frost', 0, 2)]);
    runUntil(sim, 2.001);
    expect(sim.isFrozen()).toBe(true);
    sim.cart.x = sim.cart.prevX = -6;
    runTicks(sim, 40, RIGHT);
    expect(sim.cart.v).toBeCloseTo(CART_MAX_SPEED * EFFECTS.frostSpeedFactor, 9);
    runUntil(sim, 2 + EFFECTS.frostSeconds + 0.01);
    expect(sim.isFrozen()).toBe(false);
    sim.cart.x = sim.cart.prevX = -6;
    runTicks(sim, 40, RIGHT);
    expect(sim.cart.v).toBeCloseTo(CART_MAX_SPEED, 9);
    expect(eventsOf(sim.drainEvents(), 'effectEnd').map((e) => e.effect)).toEqual(['frost']);
  });

  it('mystery: its seeded outcome is fixed per schedule and is never fire or the demon', () => {
    const outcomes = new Set();
    for (const level of [5, 20, 60]) {
      for (let seed = 1; seed <= 15; seed++) {
        const a = generateStageSchedule(level, seed).drops.filter((d) => d.type === 'mystery');
        const b = generateStageSchedule(level, seed).drops.filter((d) => d.type === 'mystery');
        expect(a.map((d) => d.reveal)).toEqual(b.map((d) => d.reveal));
        for (const d of a) outcomes.add(d.reveal);
      }
    }
    for (const o of outcomes) expect(Object.keys(MYSTERY.outcomes)).toContain(o);
    expect(outcomes.has('fire') || outcomes.has('demon')).toBe(false);
    expect(outcomes.size).toBeGreaterThan(4);
  });

  it('mystery: applies the revealed effect; a jackpot pays 250 × the multiplier without a combo step', () => {
    const drops = [makeDrop(0, 'mystery', 0, 2), makeDrop(1, 'mult5', 0, 2.5), makeDrop(2, 'mystery', 0, 3), makeDrop(3, 'mystery', 0, 3.5)];
    drops[0].reveal = 'shield';
    drops[2].reveal = 'jackpot';
    drops[3].reveal = 'expand';
    const sim = simWithDrops(drops);
    runUntil(sim, 4);
    const catches = eventsOf(sim.drainEvents(), 'catch').filter((e) => e.itemType === 'mystery');
    expect(catches.map((e) => e.reveal)).toEqual(['shield', 'jackpot', 'expand']);
    expect(sim.run.bank).toBe(1);
    expect(sim.stage.score).toBe(MYSTERY.jackpot * 5);
    expect(catches[1]).toMatchObject({ score: MYSTERY.jackpot * 5, multiplier: 5 });
    expect(sim.stage.combo).toBe(0);
    expect(sim.effects.size).toBe('expand');
    expect(sim.stage.caught.mystery).toBe(3);
  });
});
