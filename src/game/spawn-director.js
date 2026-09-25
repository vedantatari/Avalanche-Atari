// Seeded, fair spawn director. A whole stage schedule is generated up front from
// (level, seed), so it never depends on theme, screen size, or player behaviour,
// and a failure can be replayed exactly.
import {
  ARENA,
  BASE_SCOOP_WIDTH,
  CART_MAX_SPEED,
  CLIFF,
  DEMON,
  DIFFICULTY,
  EFFECTS,
  FAIRNESS,
  ROCK,
} from '../config.js';
import { Rng, hashSeed } from './rng.js';
import { difficultyFor, getDifficultyMode, stageDuration, stageTarget } from './levels.js';
import { isNegative, isScoring, normalisedWeights } from './items.js';
import { CONTACT_Y, PAST_SCOOP_Y, cliffCells, fallProfile } from './cliff.js';
import { maxReachableScore } from './reachability.js';

/**
 * Seconds a rock stays beside the scoop after reaching rim height. During this time the
 * scoop's side can still touch it, so a hazard keeps blocking its column.
 */
export function lingerSeconds(drop) {
  return drop.speed ? (CONTACT_Y - PAST_SCOOP_Y) / drop.speed : 0;
}

const ROCK_OVERLAP = ROCK.radius * ROCK.catchOverlapFraction;
const HALF_BASE = BASE_SCOOP_WIDTH / 2;
const HALF_WIDEST = (BASE_SCOOP_WIDTH * EFFECTS.expandFactor) / 2;

/**
 * Minimum x distance between a scoring/positive rock and a harmful one arriving at the
 * same moment: the positive can land in the inner 60% of the widest scoop while the
 * harmful rock clears the rim by `comfortMargin`.
 */
export const PAIR_SEPARATION = HALF_WIDEST * 0.6 + HALF_WIDEST + ROCK_OVERLAP + FAIRNESS.comfortMargin;

/** Shuffled bag with carried remainders so long-run frequencies match the weights. */
class TypeBag {
  constructor(level, rng) {
    this.rng = rng;
    this.weights = normalisedWeights(level);
    this.types = Object.keys(this.weights);
    this.carry = Object.fromEntries(this.types.map((t) => [t, 0]));
    this.items = [];
  }

  refill() {
    const size = FAIRNESS.bagSize;
    const counts = {};
    let total = 0;
    for (const t of this.types) {
      const exact = this.weights[t] * size + this.carry[t];
      counts[t] = Math.max(0, Math.floor(exact));
      this.carry[t] = exact - counts[t];
      total += counts[t];
    }
    const byRemainder = [...this.types].sort((a, b) => this.carry[b] - this.carry[a]);
    for (let k = 0; total < size; k++, total++) {
      const t = byRemainder[k % byRemainder.length];
      counts[t]++;
      this.carry[t] -= 1;
    }
    for (const t of this.types) for (let i = 0; i < counts[t]; i++) this.items.push(t);
    this.rng.shuffle(this.items);
  }

  /** Takes the first bag entry that `accept` allows (or the first entry if none does). */
  draw(accept) {
    if (this.items.length === 0) this.refill();
    let index = this.items.findIndex(accept);
    if (index < 0) index = 0;
    return this.items.splice(index, 1)[0];
  }

  putBack(type) {
    this.items.push(type);
  }
}

/** Checks one candidate against already scheduled drops. Returns a reason string or null. */
export function placementProblem(candidate, drops) {
  const candNeg = isNegative(candidate.type);
  // Wide enough to cover the hazard window plus the longest linger beside the scoop.
  const window = Math.max(FAIRNESS.sameColumnSeconds, FAIRNESS.hazardWindow + 1, 1.2);
  const nearbyNegatives = candNeg ? [candidate] : [];

  for (let i = drops.length - 1; i >= 0; i--) {
    const other = drops[i];
    // Drops are generated in crack order with near-constant fall times, so arrival order is
    // almost sorted; stop once we are safely past the window.
    if (other.arriveAt < candidate.arriveAt - window - 0.5) break;
    const dt = Math.abs(other.arriveAt - candidate.arriveAt);
    if (dt > window) continue;
    const dx = Math.abs(other.x - candidate.x);

    if (dx < FAIRNESS.sameColumnDistance && dt < FAIRNESS.sameColumnSeconds) return 'overlap';

    const otherNeg = isNegative(other.type);
    if (otherNeg !== candNeg) {
      // A hazard that arrives first still blocks its column while it falls beside the scoop,
      // so only the time after it has dropped clear counts as dodging time.
      const hazard = candNeg ? candidate : other;
      const helpful = candNeg ? other : candidate;
      const dodge = helpful.arriveAt >= hazard.arriveAt ? Math.max(0, dt - lingerSeconds(hazard)) : dt;
      const required = PAIR_SEPARATION - FAIRNESS.dodgeSpeedShare * CART_MAX_SPEED * dodge;
      if (dx < required) return 'forced-damage';
    }
    if (candNeg && otherNeg) {
      const first = other.arriveAt <= candidate.arriveAt ? other : candidate;
      if (dt <= FAIRNESS.hazardWindow + lingerSeconds(first)) nearbyNegatives.push(other);
    }
  }

  if (nearbyNegatives.length > 1) {
    if (nearbyNegatives.length > FAIRNESS.maxNegativesPerWindow) return 'too-many-hazards';
    if (largestSafeGap(nearbyNegatives.map((d) => d.x)) < FAIRNESS.minSafeGap) return 'no-safe-gap';
  }
  return null;
}

/** Widest interval of cart-centre positions (widest scoop) that touches none of the hazards. */
export function largestSafeGap(hazardXs) {
  const reach = HALF_WIDEST + ROCK_OVERLAP;
  const lo = -ARENA.halfWidth + HALF_WIDEST;
  const hi = ARENA.halfWidth - HALF_WIDEST;
  const blocked = hazardXs
    .map((x) => [Math.max(lo, x - reach), Math.min(hi, x + reach)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let best = 0;
  let cursor = lo;
  for (const [a, b] of blocked) {
    if (a > cursor) best = Math.max(best, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return Math.max(best, hi - cursor);
}

/** Re-checks a full schedule; used by tests and dev tooling. */
export function findFairnessViolations(drops) {
  const sorted = [...drops].sort((a, b) => a.arriveAt - b.arriveAt);
  const problems = [];
  for (let i = 0; i < sorted.length; i++) {
    const earlier = sorted.slice(Math.max(0, i - 24), i);
    const reason = placementProblem(sorted[i], earlier);
    if (reason) problems.push({ id: sorted[i].id, reason });
  }
  return problems;
}

function startPattern(diff, rng) {
  const kinds = [];
  if (diff.sweep) kinds.push('sweep');
  if (diff.pair) kinds.push('pair');
  if (diff.stack) kinds.push('stack');
  if (!kinds.length) return null;
  const kind = rng.pick(kinds);
  if (kind === 'sweep') {
    const dir = rng.chance(0.5) ? 1 : -1;
    return { kind, remaining: rng.int(3, 4), x: -dir * rng.range(2.5, 6), step: dir * rng.range(1.5, 2.1) };
  }
  if (kind === 'stack') return { kind, remaining: 3, x: rng.range(-6, 6) };
  return { kind, remaining: 1 };
}

function buildDrops(level, seed, duration) {
  const rng = new Rng(seed);
  const diff = difficultyFor(level);
  const bag = new TypeBag(level, rng);
  const cells = cliffCells();
  const cellFreeAt = new Float64Array(cells.length);
  const drops = [];
  const lastArrival = duration - DIFFICULTY.endBuffer;
  const reachSpeed = CART_MAX_SPEED * FAIRNESS.reachSpeedShare;
  const catchHalf = HALF_BASE + ROCK_OVERLAP;
  const rowSpeed = CLIFF.rows.map((row) => fallProfile(row.y, diff.fallSeconds).speed);
  const demonFall = diff.fallSeconds * DEMON.fallFactor;
  const demonRowSpeed = CLIFF.rows.map((row) => fallProfile(row.y, demonFall).speed);

  let t = DIFFICULTY.firstCrackAt;
  let nextDemonAt = DEMON.everySeconds;
  let negStreak = 0;
  let nonScoringStreak = 0;
  let lastScoring = { x: 0, arriveAt: 0 };
  let pattern = null;

  const accept = (type) => {
    if (isNegative(type) && negStreak >= FAIRNESS.maxConsecutiveNegative) return false;
    if (!isScoring(type) && nonScoringStreak >= FAIRNESS.maxConsecutiveNonScoring) return false;
    return true;
  };

  const chooseCell = (type, crackAt, arriveAt, preferX, pendingThisSlot, speeds = rowSpeed) => {
    const existing = pendingThisSlot.length ? drops.concat(pendingThisSlot) : drops;
    const valid = [];
    for (const cell of cells) {
      if (cellFreeAt[cell.id] > crackAt) continue;
      if (pendingThisSlot.some((d) => d.cellId === cell.id)) continue;
      if (placementProblem({ type, x: cell.x, arriveAt, speed: speeds[cell.row] }, existing)) continue;
      valid.push(cell);
    }
    if (!valid.length) return null;

    if (preferX !== undefined) {
      return valid.reduce((a, b) => (Math.abs(b.x - preferX) < Math.abs(a.x - preferX) ? b : a));
    }
    // Avoid re-using the exact columns of the last couple of drops so drops do not cluster.
    const recent = drops.slice(-2).map((d) => d.x);
    let pool = valid.filter((c) => recent.every((x) => Math.abs(x - c.x) > 0.8));
    if (!pool.length) pool = valid;

    if (isScoring(type) && rng.chance(FAIRNESS.reachBias)) {
      const window = Math.max(0, arriveAt - lastScoring.arriveAt);
      const reach = reachSpeed * window + catchHalf;
      const reachable = pool.filter((c) => Math.abs(c.x - lastScoring.x) <= reach);
      if (reachable.length) pool = reachable;
    }
    return rng.pick(pool);
  };

  let id = 0;

  /**
   * The demon runs on its own clock: one spawn every `DEMON.everySeconds`, falling faster
   * than the regular drops. It still goes through the fairness checks (never forced damage,
   * never an unescapable wall), and respects the streak caps; when no fair spot exists right
   * now it retries a second later instead of skipping the cadence entirely.
   */
  const trySpawnDemon = (crackAt) => {
    if (negStreak >= FAIRNESS.maxConsecutiveNegative || nonScoringStreak >= FAIRNESS.maxConsecutiveNonScoring) {
      nextDemonAt = crackAt + 1;
      return;
    }
    const crackTime = rng.range(DIFFICULTY.crackSeconds.min, DIFFICULTY.crackSeconds.max);
    const detachAt = crackAt + crackTime;
    const arriveAt = detachAt + demonFall;
    if (arriveAt > lastArrival) {
      nextDemonAt = Infinity;
      return;
    }
    const cell = chooseCell('demon', crackAt, arriveAt, undefined, [], demonRowSpeed);
    if (!cell) {
      nextDemonAt = crackAt + 1;
      return;
    }
    const { accel, speed } = fallProfile(cell.y, demonFall);
    const refillAt = detachAt + CLIFF.refillDelay;
    drops.push({
      id: id++,
      type: 'demon',
      cellId: cell.id,
      x: cell.x,
      y0: cell.y,
      z0: cell.z,
      crackAt,
      detachAt,
      fallSeconds: demonFall,
      arriveAt,
      accel,
      speed,
      refillAt,
      refillEndAt: refillAt + CLIFF.refillSeconds,
      pattern: null,
    });
    cellFreeAt[cell.id] = refillAt + CLIFF.refillSeconds;
    negStreak += 1;
    nonScoringStreak += 1;
    nextDemonAt += DEMON.everySeconds;
  };

  while (true) {
    if (t >= nextDemonAt) trySpawnDemon(t);
    const fall = diff.fallSeconds;
    let requests;
    let interval = diff.dropInterval * (1 + rng.range(-DIFFICULTY.intervalJitter, DIFFICULTY.intervalJitter));

    if (!pattern && rng.chance(diff.patternChance)) pattern = startPattern(diff, rng);
    if (pattern) {
      if (pattern.kind === 'sweep') {
        const type = pattern.remaining === 1 && rng.chance(0.4) ? 'cash' : 'coin';
        requests = [{ type, preferX: pattern.x }];
        pattern.x += pattern.step;
        interval = Math.max(interval, 0.45);
      } else if (pattern.kind === 'stack') {
        requests = [{ type: 'coin', preferX: pattern.x }];
        interval = Math.max(interval, FAIRNESS.sameColumnSeconds + 0.05);
      } else {
        requests = [{}, {}];
        interval *= 1.5;
      }
      requests.forEach((r) => (r.pattern = pattern.kind));
      if (--pattern.remaining <= 0) pattern = null;
    } else {
      requests = [{}];
    }

    const crackTimes = requests.map(() => rng.range(DIFFICULTY.crackSeconds.min, DIFFICULTY.crackSeconds.max));
    if (t + Math.max(...crackTimes) + fall > lastArrival) break;

    const slot = [];
    requests.forEach((req, k) => {
      const detachAt = t + crackTimes[k];
      const arriveAt = detachAt + fall;
      let type = req.type ?? bag.draw(accept);
      if (!req.type && !accept(type)) {
        // The bag had no acceptable entry left (draw falls back to its first item):
        // swap in a scoring rock so the hazard/drought caps hold unconditionally.
        bag.putBack(type);
        type = bag.draw((c) => isScoring(c));
        if (!isScoring(type)) {
          bag.putBack(type);
          type = 'coin';
        }
      }
      let cell = chooseCell(type, t, arriveAt, req.preferX, slot);
      if (!cell && !req.type && isNegative(type)) {
        // No fair place for this hazard right now: keep it for later and drop a positive instead.
        bag.putBack(type);
        type = bag.draw((c) => !isNegative(c) && accept(c));
        if (isNegative(type)) {
          bag.putBack(type);
          type = 'coin';
        }
        cell = chooseCell(type, t, arriveAt, req.preferX, slot);
      }
      if (!cell) {
        if (!req.type) bag.putBack(type);
        return;
      }
      const { accel, speed } = fallProfile(cell.y, fall);
      const refillAt = detachAt + CLIFF.refillDelay;
      slot.push({
        id: id++,
        type,
        cellId: cell.id,
        x: cell.x,
        y0: cell.y,
        z0: cell.z,
        crackAt: t,
        detachAt,
        fallSeconds: fall,
        arriveAt,
        accel,
        speed,
        refillAt,
        refillEndAt: refillAt + CLIFF.refillSeconds,
        pattern: req.pattern || null,
      });
      cellFreeAt[cell.id] = refillAt + CLIFF.refillSeconds;
      negStreak = isNegative(type) ? negStreak + 1 : 0;
      nonScoringStreak = isScoring(type) ? 0 : nonScoringStreak + 1;
      if (isScoring(type)) lastScoring = { x: cell.x, arriveAt };
    });
    drops.push(...slot);
    t += interval;
  }
  return drops;
}

/**
 * Builds the full drop schedule for one stage. The target is dynamic: a level-dependent
 * share of the score this schedule's rocks actually offer along a reachable route.
 */
export function generateStageSchedule(level, seed, { duration = stageDuration(level) } = {}) {
  const drops = buildDrops(level, seed >>> 0, duration);
  const reachableScore = maxReachableScore(drops);
  const target = stageTarget(level, reachableScore);
  return { level, seed: seed >>> 0, duration, target, drops, reachableScore };
}

const previewTargets = new Map();

/**
 * Typical target for a level, for menus shown before a stage exists. Each run's real target
 * comes from its own seeded schedule and is usually within a few hundred points of this.
 */
export function previewTarget(level) {
  const key = `${getDifficultyMode()}|${level}`;
  if (!previewTargets.has(key)) previewTargets.set(key, generateStageSchedule(level, hashSeed('preview', level)).target);
  return previewTargets.get(key);
}
