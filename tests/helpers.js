import { Simulation, PHASE } from '../src/game/simulation.js';
import { cliffCells, fallProfile } from '../src/game/cliff.js';
import { TICK_RATE } from '../src/config.js';

export const DT = 1 / TICK_RATE;

/** Builds a drop that reaches the catch plane at `arriveAt` above `x`. */
export function makeDrop(id, type, x, arriveAt, fallSeconds = 2) {
  const cell = cliffCells()[0];
  const detachAt = arriveAt - fallSeconds;
  const { accel, speed } = fallProfile(cell.y, fallSeconds);
  return {
    id,
    type,
    cellId: cell.id,
    x,
    y0: cell.y,
    z0: cell.z,
    crackAt: detachAt - 0.3,
    detachAt,
    fallSeconds,
    arriveAt,
    accel,
    speed,
    refillAt: detachAt + 3,
    refillEndAt: detachAt + 3.6,
    pattern: null,
  };
}

/** Starts a run whose stage uses exactly `drops` (sorted by crack time) and begins play. */
export function simWithDrops(drops, { level = 1, duration } = {}) {
  const sim = new Simulation({ durationOverride: duration ?? null });
  sim.startRun(level, { seed: 1 });
  sim.stage.schedule.drops = [...drops].sort((a, b) => a.crackAt - b.crackAt);
  sim.beginPlay();
  sim.drainEvents();
  return sim;
}

export function runTicks(sim, n, input) {
  for (let i = 0; i < n; i++) sim.tick(input);
}

export function runUntil(sim, seconds, input) {
  const target = Math.round(seconds * TICK_RATE);
  while (sim.stage.tick < target && sim.phase === PHASE.PLAYING) sim.tick(input);
}

export function eventsOf(events, type) {
  return events.filter((e) => e.type === type);
}
