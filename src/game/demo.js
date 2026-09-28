import { ARENA, CLIFF, DEMON, DRIFT, SPLIT, STORM } from '../config.js';
import { cliffCells, fallProfile } from './cliff.js';

const FALL = 1.9;
const CRACK = 0.4;
const WIND_SHIFT = 1.2;

export const DEMO_TRANSITION_SECONDS = 2;

export const DEMO_PARTS = [
  {
    seconds: 20,
    terrain: 'ice',
    fog: [8, 13],
    storms: [[6.5, 13.4]],
    drops: [
      [0.6, 'coin', -3],
      [1.6, 'cash', 1.5],
      [2.6, 'shield', 4],
      [3.6, 'expand', -1],
      [4.6, 'fire', 4.5],
      [5.2, 'coin', -2],
      [6.0, 'mult2', 0],
      [6.8, 'coin', -4.5],
      [7.3, 'coin', -3],
      [7.8, 'coin', -1.5],
      [8.6, 'shrink', 3],
      [9.8, 'clone', -2],
      [11.0, 'split', 1.5],
      [12.2, 'coin', -4],
      [13.8, 'magnet', -5],
      [14.8, 'coin', -2],
      [15.6, 'frost', 6.5],
      [16.6, 'cash', -3],
      [17.4, 'coin', -1],
    ],
    captions: [
      [0.2, 'Welcome to the demo! Ice rail: your cart glides after you let go'],
      [2.8, 'Gold +50 · Emerald +100 · Shield buys a heart back'],
      [5.4, 'Fire rock: let it fall — it burns a heart'],
      [8.0, 'Fog rolls in: markings hide until rocks drop through it'],
      [10.6, 'Shadow clones and split rocks — grab everything'],
      [13.4, 'ICE STORM! Leave the flashing zone before it strikes'],
      [16.2, 'Frost freezes your wheels for a moment'],
    ],
  },
  {
    seconds: 25,
    terrain: 'volcano',
    wind: [15, 19.5],
    storms: [[-6.5, 8.6]],
    drops: [
      [0.8, 'mult3', -2],
      [1.8, 'coin', 0, 1.6],
      [2.8, 'mult5', 3],
      [3.8, 'coin', 1],
      [4.6, 'mystery', -3],
      [5.6, 'reverse', 4],
      [6.6, 'demon', -1],
      [7.6, 'coin', 3.5],
      [9.2, 'cash', 3],
      [10.4, 'coin', 5],
      [11.6, 'coin', 1, -1.4],
      [12.6, 'shield', 4],
      [14.2, 'expand', -3],
      [15.2, 'coin', -4],
      [16.4, 'coin', 2],
      [17.8, 'coin', -5],
      [18.3, 'cash', -3],
      [18.8, 'coin', -1],
      [19.3, 'cash', 1],
      [19.8, 'coin', 3],
      [20.3, 'coin', 5],
      [21.4, 'fire', -2],
    ],
    captions: [
      [0.2, 'Volcano: heat vents push rocks sideways — follow the arrows'],
      [2.8, '×3 and ×5 multiply every point for 5 seconds'],
      [5.4, '? rock is a surprise · Whiskey flips your controls'],
      [7.0, 'DEMON! In a real level one touch ends the run — dodge it'],
      [9.6, 'ERUPTION! Keep clear — the lava burns a heart'],
      [14.6, 'Wind gust: every rock drifts with it'],
      [17.6, 'Gold rush! Scoop up the treasure before time runs out'],
    ],
  },
];

export function demoSchedule(part) {
  const p = DEMO_PARTS[part];
  const cells = cliffCells();
  const freeAt = new Float64Array(cells.length);
  const drops = [];
  let id = 0;
  for (const [t, type, x, shift = 0] of p.drops) {
    const fall = type === 'demon' ? FALL * DEMON.fallFactor : FALL;
    const detachAt = t + CRACK;
    const arriveAt = detachAt + fall;
    const cost = (c) => Math.abs(c.x - x) + c.row * 0.3;
    const cell = cells.filter((c) => freeAt[c.id] <= t).reduce((a, c) => (cost(c) < cost(a) ? c : a));
    const { accel, speed } = fallProfile(cell.y, fall);
    const refillAt = detachAt + CLIFF.refillDelay;
    freeAt[cell.id] = refillAt + CLIFF.refillSeconds;
    const base = { type, cellId: cell.id, x: cell.x, y0: cell.y, z0: cell.z, crackAt: t, detachAt, fallSeconds: fall, arriveAt, accel, speed, refillAt, refillEndAt: refillAt + CLIFF.refillSeconds, pattern: null };
    if (type === 'split') {
      const pair = id;
      for (const half of [-1, 1]) {
        drops.push({ id: id++, ...base, x: cell.x + half * SPLIT.offset, x0: cell.x, driftStart: detachAt + fall * SPLIT.at, driftEnd: detachAt + fall * SPLIT.settle, half, pair, pattern: half > 0 ? 'split' : null });
      }
      continue;
    }
    const drop = { id: id++, ...base };
    const push = shift + (p.wind && arriveAt >= p.wind[0] && arriveAt <= p.wind[1] ? WIND_SHIFT : 0);
    if (push) Object.assign(drop, { x0: cell.x, x: cell.x + push, driftStart: detachAt + fall * DRIFT.from, driftEnd: detachAt + fall * DRIFT.to });
    if (type === 'mystery') drop.reveal = 'jackpot';
    drops.push(drop);
  }
  const half = ARENA.halfWidth * STORM.width;
  const storms = p.storms.map(([x, warnAt]) => ({ x, half, warnAt, strikeAt: warnAt + STORM.warnSeconds, endAt: warnAt + STORM.warnSeconds + STORM.strikeSeconds }));
  return {
    level: 0,
    seed: 0,
    duration: p.seconds,
    target: null,
    drops,
    reachableScore: 0,
    terrain: p.terrain,
    modifier: null,
    wind: p.wind ? 1 : 0,
    storms,
    fogWindow: p.fog || null,
    windWindow: p.wind || null,
    captions: p.captions,
    demoPart: part,
  };
}
