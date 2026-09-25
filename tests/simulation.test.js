import { describe, expect, it } from 'vitest';
import { PHASE, Simulation, clonePositions } from '../src/game/simulation.js';
import { InputState } from '../src/input/input-state.js';
import { BASE_SCOOP_WIDTH, EFFECTS, ROCK, RUN, TICK_RATE, ARENA } from '../src/config.js';
import { CONTACT_Y, PAST_SCOOP_Y } from '../src/game/cliff.js';
import { lingerSeconds } from '../src/game/spawn-director.js';
import { DT, eventsOf, makeDrop, runTicks, runUntil, simWithDrops } from './helpers.js';

const OVERLAP = ROCK.radius * ROCK.catchOverlapFraction;

describe('catching and missing', () => {
  it('awards a single catch exactly once', () => {
    const sim = simWithDrops([makeDrop(0, 'coin', 0, 2.5)]);
    runUntil(sim, 6);
    const events = sim.drainEvents();
    expect(sim.stage.score).toBe(50);
    expect(eventsOf(events, 'catch')).toHaveLength(1);
    expect(sim.stage.caught.coin).toBe(1);
    expect(sim.stage.falling).toHaveLength(0);
  });

  it('cash gives 100 and shield banks one without touching lives', () => {
    const sim = simWithDrops([makeDrop(0, 'cash', 0, 2.5), makeDrop(1, 'shield', 0, 3.5)]);
    runUntil(sim, 5);
    expect(sim.stage.score).toBe(100);
    expect(sim.run.bank).toBe(1);
    expect(sim.run.lives).toBe(3);
  });

  it('missed positives cost no life and fall away', () => {
    const sim = simWithDrops([makeDrop(0, 'coin', 6.5, 2.5), makeDrop(1, 'cash', -6.5, 3)]);
    runUntil(sim, 8);
    const events = sim.drainEvents();
    expect(sim.stage.score).toBe(0);
    expect(sim.run.lives).toBe(3);
    expect(eventsOf(events, 'miss')).toHaveLength(2);
    expect(eventsOf(events, 'ground')).toHaveLength(2);
    expect(sim.stage.falling).toHaveLength(0);
  });

  it('any touch counts: a rock grazing the rim edge is caught (base, expanded, shrunk)', () => {
    expect(OVERLAP).toBe(ROCK.radius);
    for (const [kind, factor] of [[null, 1], ['expand', EFFECTS.expandFactor], ['shrink', EFFECTS.shrinkFactor]]) {
      const half = (BASE_SCOOP_WIDTH * factor) / 2 + OVERLAP;
      const setup = (x) => {
        const drops = [makeDrop(1, 'coin', x, 3)];
        if (kind) drops.push(makeDrop(0, kind, 0, 1.5));
        const sim = simWithDrops(drops);
        runUntil(sim, 2.5);
        expect(sim.cart.width).toBeCloseTo(BASE_SCOOP_WIDTH * factor, 6);
        expect(sim.scoopBounds().width).toBeCloseTo(sim.cart.width, 9);
        runUntil(sim, 4);
        return sim.stage.caught.coin;
      };
      expect(setup(half - 0.01)).toBe(1);
      expect(setup(half + 0.01)).toBe(0);
    }
  });

  it('a fire rock grazing the rim edge costs a heart, one just clear of it does not', () => {
    const graze = simWithDrops([makeDrop(0, 'fire', BASE_SCOOP_WIDTH / 2 + OVERLAP - 0.02, 2.5)]);
    runUntil(graze, 6);
    expect(graze.run.lives).toBe(2);
    // A rock falling beside a parked cart never touches it (driver, wheels, body don't count).
    const clear = simWithDrops([makeDrop(0, 'fire', BASE_SCOOP_WIDTH / 2 + OVERLAP + 0.05, 2.5)]);
    runUntil(clear, 6);
    expect(clear.run.lives).toBe(3);
  });

  it('counts the touch the moment the rock bottom reaches the rim', () => {
    const sim = simWithDrops([makeDrop(0, 'coin', 0, 2.5)]);
    runUntil(sim, 3);
    const [c] = eventsOf(sim.drainEvents(), 'catch');
    expect(c.time).toBeCloseTo(2.5, 9);
    expect(c.y).toBeCloseTo(CONTACT_Y, 6);
    expect(CONTACT_Y).toBeCloseTo(ARENA.catchY + ROCK.radius, 9);
  });

  it('a scoop moving sideways into a rock beside the tub catches it', () => {
    const drop = makeDrop(0, 'coin', 4, 2.5);
    const sim = simWithDrops([drop]);
    runUntil(sim, 2.5); // rock reaches rim height well clear of the parked scoop
    expect(sim.stage.caught.coin).toBe(0);
    runUntil(sim, 2.5 + lingerSeconds(drop) - 0.05, { dir: 1, dragActive: false, dragDelta: 0 });
    const [c] = eventsOf(sim.drainEvents(), 'catch');
    expect(sim.stage.caught.coin).toBe(1);
    expect(c.y).toBeLessThan(CONTACT_Y);
    expect(c.y).toBeGreaterThan(PAST_SCOOP_Y);
  });

  it('a rock that has fallen past the tub can no longer be touched', () => {
    const drop = makeDrop(0, 'fire', 4, 2.5);
    const sim = simWithDrops([drop]);
    runUntil(sim, 2.5 + lingerSeconds(drop) + 0.02);
    runUntil(sim, 4, { dir: 1, dragActive: false, dragDelta: 0 });
    const events = sim.drainEvents();
    expect(eventsOf(events, 'catch')).toHaveLength(0);
    expect(eventsOf(events, 'miss')).toHaveLength(1);
    expect(sim.run.lives).toBe(3);
  });

  it('resolves several crossings in one tick in time-of-impact order', () => {
    const t = 2.5;
    const sim = simWithDrops([makeDrop(0, 'coin', 0, t + DT * 0.2), makeDrop(1, 'shield', 0.3, t + DT * 0.6)]);
    runUntil(sim, 4);
    const catches = eventsOf(sim.drainEvents(), 'catch');
    expect(catches.map((e) => e.itemType)).toEqual(['coin', 'shield']);
  });
});

describe('fire, lives and immunity', () => {
  it('fire costs one life and grants one second of immunity', () => {
    const sim = simWithDrops([
      makeDrop(0, 'fire', 0, 2),
      makeDrop(1, 'fire', 0.2, 2.5), // inside immunity
      makeDrop(2, 'fire', 0, 3.2), // after immunity
    ]);
    runUntil(sim, 2.01);
    expect(sim.run.lives).toBe(2);
    expect(sim.isInvulnerable()).toBe(true);
    runUntil(sim, 2.6);
    expect(sim.run.lives).toBe(2);
    runUntil(sim, 3.3);
    expect(sim.run.lives).toBe(1);
    expect(sim.stage.livesLost).toBe(2);
  });

  it('zero hearts without an affordable restore ends the run immediately', () => {
    const sim = simWithDrops([makeDrop(0, 'fire', 0, 2)]);
    sim.run.lives = 1;
    runUntil(sim, 3);
    expect(sim.phase).toBe(PHASE.ENDED);
    expect(sim.stage.result).toBe('lost');
    expect(sim.stage.endReason).toBe('out-of-lives');
  });

  it('zero hearts with an affordable restore opens a paused revive decision', () => {
    const sim = simWithDrops([makeDrop(0, 'fire', 0, 2), makeDrop(1, 'coin', 0, 2 + DT * 0.5)]);
    sim.run.lives = 1;
    sim.run.bank = 1;
    runUntil(sim, 3);
    expect(sim.phase).toBe(PHASE.REVIVE);
    const frozenTick = sim.stage.tick;
    // The coin in the same tick after the fatal hit is frozen, not awarded.
    expect(sim.stage.score).toBe(0);
    runTicks(sim, 50);
    expect(sim.stage.tick).toBe(frozenTick);
    expect(sim.restore()).toBe(true);
    expect(sim.phase).toBe(PHASE.PLAYING);
    expect(sim.run.lives).toBe(1);
    expect(sim.run.bank).toBe(0);
    expect(sim.isInvulnerable()).toBe(true);
    expect(sim.stage.tick).toBe(frozenTick);
  });

  it('declining the revive ends the run', () => {
    const sim = simWithDrops([makeDrop(0, 'fire', 0, 2)]);
    sim.run.lives = 1;
    sim.run.bank = 4;
    runUntil(sim, 3);
    expect(sim.declineRevive()).toBe(true);
    expect(sim.phase).toBe(PHASE.ENDED);
    expect(sim.run.bank).toBe(4);
  });
});

describe('demon', () => {
  it('touching the demon ends the run instantly, regardless of hearts, shields, or immunity', () => {
    const sim = simWithDrops([makeDrop(0, 'fire', 0, 2), makeDrop(1, 'demon', 0, 2.5)]);
    sim.run.bank = 8; // enough for a revive, which must not be offered
    runUntil(sim, 3);
    expect(sim.run.lives).toBe(0);
    expect(sim.phase).toBe(PHASE.ENDED);
    expect(sim.stage.result).toBe('lost');
    expect(sim.stage.endReason).toBe('demon');
    expect(sim.run.bank).toBe(8);
    const catches = eventsOf(sim.drainEvents(), 'catch');
    // The fire hit at t=2 grants immunity, but the demon at t=2.5 kills through it.
    expect(catches.find((e) => e.itemType === 'demon')).toMatchObject({ fatal: true, lives: 0 });
  });

  it('a dodged demon costs nothing', () => {
    const sim = simWithDrops([makeDrop(0, 'demon', 6.5, 2.5)]);
    runUntil(sim, 5);
    expect(sim.run.lives).toBe(3);
    expect(sim.phase).toBe(PHASE.PLAYING);
    expect(eventsOf(sim.drainEvents(), 'miss')).toHaveLength(1);
  });

  it('demons fall straight through shadow clones', () => {
    const OFFSET = BASE_SCOOP_WIDTH + EFFECTS.cloneGap;
    const sim = simWithDrops([makeDrop(0, 'clone', 0, 2), makeDrop(1, 'demon', OFFSET, 3)]);
    runUntil(sim, 5);
    expect(sim.phase).toBe(PHASE.PLAYING);
    expect(sim.run.lives).toBe(3);
    expect(eventsOf(sim.drainEvents(), 'miss').map((e) => e.id)).toEqual([1]);
  });
});

describe('shield restores', () => {
  it('costs 1, 2, 4, 8; one life each; never a fifth; never negative', () => {
    const sim = simWithDrops([]);
    sim.run.bank = 15;
    const costs = [];
    for (let i = 0; i < 4; i++) {
      sim.run.lives = 1;
      const before = sim.run.bank;
      expect(sim.restore()).toBe(true);
      costs.push(before - sim.run.bank);
      expect(sim.run.lives).toBe(2);
    }
    expect(costs).toEqual(RUN.restoreCosts);
    expect(sim.run.bank).toBe(0);
    sim.run.bank = 100;
    sim.run.lives = 1;
    expect(sim.restore()).toBe(false);
    expect(sim.restoreStatus().reason).toBe('max-used');
    expect(sim.run.bank).toBe(100);
    expect(sim.run.restoresUsed).toBe(4);
  });

  it('never spends at full hearts and never overdraws the bank', () => {
    const sim = simWithDrops([]);
    sim.run.bank = 10;
    expect(sim.restore()).toBe(false);
    expect(sim.restoreStatus().reason).toBe('hearts-full');
    expect(sim.run.bank).toBe(10);

    sim.run.lives = 2;
    sim.run.bank = 0;
    expect(sim.restore()).toBe(false);
    expect(sim.restoreStatus()).toMatchObject({ reason: 'need-shields', need: 1 });
    expect(sim.run.bank).toBe(0);

    sim.run.bank = 1;
    expect(sim.restore()).toBe(true);
    sim.run.lives = 2;
    sim.run.bank = 1; // next cost is 2
    expect(sim.restore()).toBe(false);
    expect(sim.run.bank).toBe(1);
    expect(sim.run.lives).toBe(2);
  });
});

describe('deadline', () => {
  it('wins at the deadline with the target met and a heart left', () => {
    const sim = simWithDrops([], { duration: 5 });
    sim.stage.score = sim.stage.target;
    runUntil(sim, 10);
    expect(sim.phase).toBe(PHASE.ENDED);
    expect(sim.stage.result).toBe('won');
    expect(sim.stage.tick).toBe(5 * TICK_RATE);
  });

  it('reaching the target early does not end the stage', () => {
    const sim = simWithDrops([makeDrop(0, 'cash', 0, 1)], { duration: 5 });
    sim.stage.target = 100;
    runUntil(sim, 2);
    expect(sim.stage.targetReached).toBe(true);
    expect(sim.phase).toBe(PHASE.PLAYING);
    expect(eventsOf(sim.drainEvents(), 'targetReached')).toHaveLength(1);
  });

  it('loses at the deadline when short of the target', () => {
    const sim = simWithDrops([], { duration: 5 });
    runUntil(sim, 10);
    expect(sim.stage.result).toBe('lost');
    expect(sim.stage.endReason).toBe('time');
  });

  it('zero hearts in the final tick loses even with the target met, with no revive', () => {
    const sim = simWithDrops([makeDrop(0, 'fire', 0, 5 - DT * 0.5)], { duration: 5 });
    sim.stage.score = sim.stage.target + 500;
    sim.run.lives = 1;
    sim.run.bank = 8;
    runUntil(sim, 10);
    expect(sim.phase).toBe(PHASE.ENDED);
    expect(sim.stage.result).toBe('lost');
    expect(sim.run.bank).toBe(8);
  });

  it('counts a catch that crosses exactly at the deadline and ignores later ones', () => {
    const sim = simWithDrops([makeDrop(0, 'coin', 0, 5), makeDrop(1, 'coin', 0, 5 + DT * 0.5)], { duration: 5 });
    runUntil(sim, 10);
    expect(sim.stage.score).toBe(50);
    expect(sim.phase).toBe(PHASE.ENDED);
    runTicks(sim, 200);
    expect(sim.stage.score).toBe(50);
  });
});

describe('size effects', () => {
  it('lasts exactly 5 simulation seconds', () => {
    const sim = simWithDrops([makeDrop(0, 'expand', 0, 2)]);
    runUntil(sim, 2.001);
    const caughtTick = sim.stage.tick;
    expect(sim.effects.size).toBe('expand');
    const durationTicks = EFFECTS.sizeSeconds * TICK_RATE;
    runTicks(sim, durationTicks - 1);
    expect(sim.effectTimers().size).toBe('expand');
    sim.tick();
    expect(sim.stage.tick - caughtTick).toBe(durationTicks);
    expect(sim.effects.size).toBe(null);
    runTicks(sim, 30);
    expect(sim.cart.width).toBeCloseTo(BASE_SCOOP_WIDTH, 9);
  });

  it('same effect refreshes, opposite replaces, width never stacks', () => {
    const sim = simWithDrops([
      makeDrop(0, 'expand', 0, 2),
      makeDrop(1, 'expand', 0, 4),
      makeDrop(2, 'shrink', 0, 6),
    ]);
    runUntil(sim, 3.5);
    expect(sim.cart.width).toBeCloseTo(BASE_SCOOP_WIDTH * EFFECTS.expandFactor, 9);
    runUntil(sim, 4.5);
    expect(sim.cart.width).toBeCloseTo(BASE_SCOOP_WIDTH * EFFECTS.expandFactor, 9);
    expect(sim.effectTimers().sizeSeconds).toBeCloseTo(4.5, 1); // refreshed at 4 s
    runUntil(sim, 6.001);
    expect(sim.effects.size).toBe('shrink');
    expect(sim.effectTimers().sizeSeconds).toBeCloseTo(5, 1);
    runUntil(sim, 7);
    expect(sim.cart.width).toBeCloseTo(BASE_SCOOP_WIDTH * EFFECTS.shrinkFactor, 9);
  });

  it('keeps the whole scoop inside the arena while expanding at an edge, without jitter', () => {
    const sim = simWithDrops([makeDrop(0, 'expand', 6.7, 2)]);
    const right = { dir: 1, dragActive: false, dragDelta: 0 };
    runUntil(sim, 1.5, right); // parked against the right edge
    let lastX = sim.cart.x;
    let reversals = 0;
    let lastDelta = 0;
    for (let i = 0; i < 1.5 * TICK_RATE; i++) {
      sim.tick(right);
      const b = sim.scoopBounds();
      expect(b.right).toBeLessThanOrEqual(ARENA.halfWidth + 1e-9);
      const d = sim.cart.x - lastX;
      if (Math.sign(d) && Math.sign(lastDelta) && Math.sign(d) !== Math.sign(lastDelta)) reversals++;
      if (d) lastDelta = d;
      lastX = sim.cart.x;
    }
    expect(sim.effects.size).toBe('expand');
    expect(reversals).toBe(0);
    expect(sim.scoopBounds().right).toBeCloseTo(ARENA.halfWidth, 6);
  });
});

describe('reverse', () => {
  const moveWith = (sim, input, ticks = 30) => {
    const x0 = sim.cart.x;
    for (let i = 0; i < ticks; i++) sim.tick(typeof input === 'function' ? input() : input);
    return sim.cart.x - x0;
  };

  it('inverts keyboard, hold buttons and drag equally, and ends after 5 seconds', () => {
    const sim = simWithDrops([makeDrop(0, 'reverse', 0, 2)]);
    runUntil(sim, 2.001);
    expect(sim.isReversed()).toBe(true);

    const keys = new InputState();
    keys.keyDown('right');
    expect(moveWith(sim, () => keys.sample())).toBeLessThan(0);
    keys.clear();
    runTicks(sim, 20);

    const hold = new InputState();
    hold.holdStart('left', 7);
    expect(moveWith(sim, () => hold.sample())).toBeGreaterThan(0);
    hold.clear();
    runTicks(sim, 20);

    const drag = new InputState();
    drag.dragStart(3, 'strip');
    let n = 0;
    expect(
      moveWith(sim, () => {
        if (n++ < 10) drag.dragMove(3, 0.2);
        return drag.sample();
      }),
    ).toBeLessThan(0);
    drag.clear();

    // Ends exactly 5 s after the catch; input then behaves normally again.
    runUntil(sim, 2 + EFFECTS.reverseSeconds - 0.01);
    expect(sim.isReversed()).toBe(true);
    runUntil(sim, 2 + EFFECTS.reverseSeconds + 0.01);
    expect(sim.isReversed()).toBe(false);
    const k = new InputState();
    k.keyDown('right');
    expect(moveWith(sim, () => k.sample(), 10)).toBeGreaterThan(0);
  });

  it('a second reverse refreshes instead of cancelling', () => {
    const sim = simWithDrops([makeDrop(0, 'reverse', 0, 2), makeDrop(1, 'reverse', 0, 3)]);
    runUntil(sim, 3.01);
    expect(sim.isReversed()).toBe(true);
    expect(sim.effectTimers().reverseSeconds).toBeCloseTo(5, 1);
    runUntil(sim, 7.9);
    expect(sim.isReversed()).toBe(true);
    runUntil(sim, 8.05);
    expect(sim.isReversed()).toBe(false);
  });
});

describe('score multiplier', () => {
  it('multiplies every point scored for exactly 5 seconds, then stops', () => {
    const sim = simWithDrops([
      makeDrop(0, 'mult3', 0, 2),
      makeDrop(1, 'coin', 0, 3),
      makeDrop(2, 'cash', 0, 2 + EFFECTS.multiplierSeconds - 0.1),
      makeDrop(3, 'coin', 0, 2 + EFFECTS.multiplierSeconds + 0.2),
    ]);
    runUntil(sim, 2.5);
    expect(sim.scoreMultiplier()).toBe(3);
    expect(sim.effectTimers()).toMatchObject({ multiplier: 3 });
    runUntil(sim, 8);
    const events = sim.drainEvents();
    const catches = eventsOf(events, 'catch');
    expect(catches.map((e) => e.score ?? null)).toEqual([null, 150, 300, 50]);
    expect(catches[1].multiplier).toBe(3);
    expect(catches[3].multiplier).toBeUndefined();
    expect(sim.stage.score).toBe(500);
    expect(sim.scoreMultiplier()).toBe(1);
    expect(eventsOf(events, 'effectEnd').map((e) => e.effect)).toEqual(['multiplier']);
  });

  it('a new multiplier replaces the current one and restarts the timer', () => {
    const sim = simWithDrops([makeDrop(0, 'mult5', 0, 2), makeDrop(1, 'mult2', 0, 4), makeDrop(2, 'coin', 0, 6.5)]);
    runUntil(sim, 4.01);
    expect(sim.effectTimers().multiplier).toBe(2);
    expect(sim.effectTimers().multiplierSeconds).toBeCloseTo(5, 1);
    runUntil(sim, 7);
    expect(sim.stage.score).toBe(100);
    const replaced = eventsOf(sim.drainEvents(), 'catch').find((e) => e.itemType === 'mult2');
    expect(replaced).toMatchObject({ effect: 'multiplier', multiplier: 2, replaced: 5 });
  });

  it('never touches shields, hearts, or missed rocks', () => {
    const sim = simWithDrops([makeDrop(0, 'mult5', 0, 2), makeDrop(1, 'shield', 0, 3), makeDrop(2, 'fire', 0, 4), makeDrop(3, 'coin', 6.5, 5)]);
    runUntil(sim, 6);
    expect(sim.run.bank).toBe(1);
    expect(sim.run.lives).toBe(2);
    expect(sim.stage.score).toBe(0);
  });
});

describe('shadow clone', () => {
  const OFFSET = BASE_SCOOP_WIDTH + EFFECTS.cloneGap;

  it('places one clone on each side, a scoop width plus a gap away, inside the arena', () => {
    expect(clonePositions(0, BASE_SCOOP_WIDTH)).toEqual([-OFFSET, OFFSET]);
    const wide = BASE_SCOOP_WIDTH * EFFECTS.expandFactor;
    expect(clonePositions(0, wide)[1]).toBeCloseTo(wide + EFFECTS.cloneGap, 9);
    const bound = ARENA.halfWidth - BASE_SCOOP_WIDTH / 2;
    const [left, right] = clonePositions(bound, BASE_SCOOP_WIDTH);
    expect(left).toBeCloseTo(bound - OFFSET, 9);
    expect(right).toBe(bound);
  });

  it('clones catch helpful rocks beside the cart for exactly 5 seconds', () => {
    const sim = simWithDrops([
      makeDrop(0, 'clone', 0, 2),
      makeDrop(1, 'coin', OFFSET, 3),
      makeDrop(2, 'cash', -OFFSET, 3.5),
      makeDrop(3, 'shield', OFFSET, 2 + EFFECTS.cloneSeconds - 0.1),
      makeDrop(4, 'coin', -OFFSET, 2 + EFFECTS.cloneSeconds + 0.2),
    ]);
    expect(sim.cloneXs()).toEqual([]);
    runUntil(sim, 2.5);
    expect(sim.hasClones()).toBe(true);
    expect(sim.cloneXs()).toEqual([-OFFSET, OFFSET]);
    runUntil(sim, 8);
    const events = sim.drainEvents();
    const catches = eventsOf(events, 'catch');
    expect(catches.map((e) => [e.itemType, e.scoop])).toEqual([['clone', 0], ['coin', 1], ['cash', -1], ['shield', 1]]);
    expect(catches[1].cartX).toBeCloseTo(OFFSET, 9);
    expect(sim.stage.score).toBe(150);
    expect(sim.run.bank).toBe(1);
    expect(eventsOf(events, 'miss').map((e) => e.id)).toEqual([4]);
    expect(sim.hasClones()).toBe(false);
    expect(sim.cart.x).toBe(0);
  });

  it('harmful rocks fall straight through the clones', () => {
    const sim = simWithDrops([
      makeDrop(0, 'clone', 0, 2),
      makeDrop(1, 'fire', OFFSET, 3),
      makeDrop(2, 'shrink', -OFFSET, 3.5),
      makeDrop(3, 'reverse', OFFSET, 4),
    ]);
    runUntil(sim, 6);
    expect(sim.run.lives).toBe(3);
    expect(sim.effectTimers()).toMatchObject({ size: null, reverseSeconds: 0 });
    expect(eventsOf(sim.drainEvents(), 'miss')).toHaveLength(3);
  });

  it('the cart catches first, and another shadow rock refreshes the clones', () => {
    const sim = simWithDrops([makeDrop(0, 'clone', 0, 2), makeDrop(1, 'clone', OFFSET, 4), makeDrop(2, 'coin', 0.2, 4.5)]);
    runUntil(sim, 4.01);
    expect(sim.effectTimers().cloneSeconds).toBeCloseTo(5, 1);
    runUntil(sim, 5);
    const catches = eventsOf(sim.drainEvents(), 'catch');
    expect(catches.map((e) => [e.itemType, e.scoop, !!e.refreshed])).toEqual([['clone', 0, false], ['clone', 1, true], ['coin', 0, false]]);
  });
});

describe('pause', () => {
  it('freezes the timer, effects and item positions', () => {
    const sim = simWithDrops([makeDrop(0, 'expand', 0, 2), makeDrop(1, 'coin', 3, 6)]);
    runUntil(sim, 2.5);
    const snapshot = JSON.stringify({ t: sim.stage.tick, fx: sim.effectTimers(), f: sim.stage.falling, c: sim.cart });
    sim.pause();
    runTicks(sim, 600, { dir: 1, dragActive: false, dragDelta: 0 });
    expect(JSON.stringify({ t: sim.stage.tick, fx: sim.effectTimers(), f: sim.stage.falling, c: sim.cart })).toBe(snapshot);
    sim.resume();
    sim.tick();
    expect(sim.stage.tick).toBe(Math.round(2.5 * TICK_RATE) + 1);
  });
});

describe('run and stage semantics', () => {
  it('starts a run with 3 hearts, no shields, no restores, no effects', () => {
    const sim = new Simulation();
    sim.startRun(1, { seed: 42 });
    expect(sim.phase).toBe(PHASE.INTRO);
    expect(sim.run).toMatchObject({ lives: 3, bank: 0, restoresUsed: 0 });
    expect(sim.stage).toMatchObject({ level: 1, score: 0, duration: 45 });
    expect(sim.stage.target).toBe(sim.stage.schedule.target);
    expect(sim.stage.target % 50).toBe(0);
    expect(sim.stage.target).toBeGreaterThan(500);
    expect(sim.effectTimers()).toMatchObject({ size: null, reverseSeconds: 0, multiplier: 1, multiplierSeconds: 0, cloneSeconds: 0 });
  });

  it('next level refills hearts and carries bank and restores; retry starts fresh', () => {
    const sim = simWithDrops([makeDrop(0, 'expand', 0, 2)], { duration: 5 });
    sim.run.lives = 2;
    sim.run.bank = 3;
    sim.run.restoresUsed = 1;
    sim.stage.score = sim.stage.target;
    runUntil(sim, 6);
    expect(sim.stage.result).toBe('won');
    expect(sim.continueRun()).toBe(true);
    expect(sim.stage.level).toBe(2);
    expect(sim.run).toMatchObject({ lives: 3, bank: 3, restoresUsed: 1 });
    expect(sim.stage).toMatchObject({ score: 0, tick: 0, targetReached: false });
    expect(sim.stage.falling).toHaveLength(0);
    expect(sim.effectTimers()).toMatchObject({ size: null, reverseSeconds: 0, invulnSeconds: 0, multiplier: 1, cloneSeconds: 0 });

    sim.retry({ seed: 5 });
    expect(sim.stage.level).toBe(2);
    expect(sim.run).toMatchObject({ lives: 3, bank: 0, restoresUsed: 0 });
  });

  it('cannot continue after a loss or past level 100', () => {
    const sim = simWithDrops([], { duration: 2 });
    runUntil(sim, 3);
    expect(sim.stage.result).toBe('lost');
    expect(sim.continueRun()).toBe(false);

    const last = new Simulation({ durationOverride: 2 });
    last.startRun(100, { seed: 3 });
    last.stage.schedule.drops = [];
    last.beginPlay();
    last.stage.score = last.stage.target;
    runUntil(last, 3);
    expect(last.stage.result).toBe('won');
    expect(last.continueRun()).toBe(false);
  });

  it('the same seed replays the same stage exactly', () => {
    const play = () => {
      const sim = new Simulation();
      sim.startRun(7, { seed: 1234 });
      sim.beginPlay();
      const input = new InputState();
      for (let i = 0; i < 20 * TICK_RATE; i++) {
        if (i % 240 === 0) input.keyDown('left');
        if (i % 240 === 120) input.keyUp('left');
        sim.tick(input.sample());
      }
      return { score: sim.stage.score, lives: sim.run.lives, bank: sim.run.bank, x: sim.cart.x };
    };
    expect(play()).toEqual(play());
  });
});

describe('difficulty', () => {
  it('a player who never moves cannot clear a stage', () => {
    for (const level of [1, 5, 20, 60, 100]) {
      for (const seed of [3, 11, 29]) {
        const sim = new Simulation();
        sim.startRun(level, { seed });
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
