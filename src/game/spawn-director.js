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
  DRIFT,
  EFFECTS,
  FAIRNESS,
  MODIFIERS,
  MYSTERY,
  ROCK,
  SPLIT,
  STORM,
  TERRAIN_RULES,
} from '../config.js';
import { Rng, hashSeed } from './rng.js';
import { difficultyFor, getDifficultyMode, stageDuration, stageModifier, stageTarget } from './levels.js';
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

/** Wide enough to cover the hazard window plus the longest linger beside the scoop. */
const CHECK_WINDOW = Math.max(FAIRNESS.sameColumnSeconds, FAIRNESS.hazardWindow + 1, 1.2);

function pickWeighted(rng, weights) {
  const entries = Object.entries(weights);
  let r = rng.next() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) if ((r -= w) < 0) return key;
  return entries[entries.length - 1][0];
}

/** Shuffled bag with carried remainders so long-run frequencies match the weights. */
class TypeBag {
  constructor(level, rng, modifier = null) {
    this.rng = rng;
    this.weights = normalisedWeights(level, modifier);
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
  const window = CHECK_WINDOW;
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

export function buildStorms(level, seed, duration) {
  if (level < STORM.fromLevel) return [];
  const rng = new Rng(hashSeed(seed, 'storm'));
  const half = ARENA.halfWidth * STORM.width;
  const slots = [half - ARENA.halfWidth, 0, ARENA.halfWidth - half];
  const storms = [];
  let last = -1;
  const band = STORM.counts.filter((b) => level >= b.fromLevel).pop();
  const count = rng.int(band.min, band.max);
  const slot = (duration - STORM.firstAt - STORM.endMargin) / count;
  const strike = Math.min(STORM.strikeSeconds, slot - STORM.warnSeconds - STORM.calmSeconds);
  if (strike <= 0) return storms;
  for (let n = 0; n < count; n++) {
    const t = STORM.firstAt + n * slot + rng.range(0, slot - STORM.warnSeconds - strike - STORM.calmSeconds);
    last = rng.pick([0, 1, 2].filter((i) => i !== last));
    const strikeAt = t + STORM.warnSeconds;
    storms.push({ x: slots[last], half, warnAt: t, strikeAt, endAt: Math.min(duration, strikeAt + strike) });
  }
  return storms;
}

export function stormProblem(type, x, arriveAt, storms) {
  for (const s of storms) {
    const dx = Math.abs(x - s.x);
    if (isNegative(type)) {
      if (arriveAt >= s.strikeAt - 0.3 && arriveAt <= s.endAt + 0.3 && dx > s.half - 1.5) return true;
    } else if (arriveAt >= s.warnAt + 0.5 && arriveAt <= s.endAt + 0.3 && dx < s.half + 0.3) return true;
  }
  return false;
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

function buildDrops(level, seed, duration, modifier, storms) {
  const rng = new Rng(seed);
  // Mystery outcomes come from their own stream so they never shift the rest of the schedule.
  const surprise = new Rng(hashSeed(seed, 'mystery'));
  const diff = difficultyFor(level);
  const bag = new TypeBag(level, rng, modifier);
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

  /** `fits(cell, existing)` replaces the single-rock fairness check (split rocks test both halves). */
  const chooseCell = (type, crackAt, arriveAt, preferX, pendingThisSlot, speeds = rowSpeed, fits = null) => {
    const existing = pendingThisSlot.length ? drops.concat(pendingThisSlot) : drops;
    const valid = [];
    for (const cell of cells) {
      if (cellFreeAt[cell.id] > crackAt) continue;
      if (pendingThisSlot.some((d) => d.cellId === cell.id)) continue;
      if (!fits && stormProblem(type, cell.x, arriveAt, storms)) continue;
      if (fits ? !fits(cell, existing) : placementProblem({ type, x: cell.x, arriveAt, speed: speeds[cell.row] }, existing)) continue;
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

  /** Both halves of a split rock must land inside the arena and pass every fairness rule. */
  const splitFits = (arriveAt) => (cell, existing) => {
    const speed = rowSpeed[cell.row];
    const a = { type: 'split', x: cell.x - SPLIT.offset, arriveAt, speed };
    const b = { type: 'split', x: cell.x + SPLIT.offset, arriveAt, speed };
    if (Math.max(Math.abs(a.x), Math.abs(b.x)) + ROCK.radius > ARENA.halfWidth) return false;
    if (stormProblem('split', a.x, arriveAt, storms) || stormProblem('split', b.x, arriveAt, storms)) return false;
    return !placementProblem(a, existing) && !placementProblem(b, existing.concat([a]));
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
      let fromBag = !req.type;
      let type = req.type ?? bag.draw(accept);
      if (fromBag && !accept(type)) {
        // The bag had no acceptable entry left (draw falls back to its first item):
        // swap in a scoring rock so the hazard/drought caps hold unconditionally.
        bag.putBack(type);
        type = bag.draw((c) => isScoring(c));
        if (!isScoring(type)) {
          bag.putBack(type);
          type = 'coin';
        }
      }
      const place = (kind) => chooseCell(kind, t, arriveAt, req.preferX, slot, rowSpeed, kind === 'split' ? splitFits(arriveAt) : null);
      let cell = place(type);
      if (!cell && type === 'split') {
        // No room for both halves right now: keep the split for later and drop gold instead.
        if (fromBag) bag.putBack(type);
        type = 'coin';
        fromBag = false;
        cell = place(type);
      }
      if (!cell && fromBag && isNegative(type)) {
        // No fair place for this hazard right now: keep it for later and drop a positive instead.
        bag.putBack(type);
        type = bag.draw((c) => !isNegative(c) && c !== 'split' && accept(c));
        if (isNegative(type) || type === 'split') {
          bag.putBack(type);
          type = 'coin';
        }
        cell = place(type);
      }
      if (!cell) {
        if (fromBag) bag.putBack(type);
        return;
      }
      const { accel, speed } = fallProfile(cell.y, fall);
      const refillAt = detachAt + CLIFF.refillDelay;
      const base = {
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
      };
      if (type === 'split') {
        // Two drops from one cell: they fall as one rock, then part to either side. The second
        // half counts as a pattern extra, like the coins a sweep adds.
        const pair = id;
        for (const half of [-1, 1]) {
          slot.push({
            id: id++,
            ...base,
            x: cell.x + half * SPLIT.offset,
            x0: cell.x,
            driftStart: detachAt + fall * SPLIT.at,
            driftEnd: detachAt + fall * SPLIT.settle,
            half,
            pair,
            pattern: half > 0 ? 'split' : base.pattern,
          });
        }
      } else {
        const drop = { id: id++, ...base };
        if (type === 'mystery') drop.reveal = pickWeighted(surprise, MYSTERY.outcomes);
        slot.push(drop);
      }
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
 * Pushes rocks sideways for heat vents (volcano) and wind (windy stages) without touching the
 * base schedule: types, timings, and source cells stay exactly as generated. Rocks are visited
 * in arrival order and each pushed landing spot is re-checked against its neighbours (earlier
 * ones already final, later ones not yet moved). A push that breaks a rule is halved, then
 * dropped: staying put is always fair, because every earlier push was checked against it.
 * Returns the wind direction (-1 or 1), or 0 without wind.
 */
function applyDrift(drops, seed, terrain, modifier, storms) {
  const heat = TERRAIN_RULES[terrain]?.drift;
  const wind = MODIFIERS[modifier]?.wind;
  if (!heat && !wind) return 0;
  const rng = new Rng(hashSeed(seed, 'drift'));
  const windDir = wind ? (rng.chance(0.5) ? 1 : -1) : 0;
  const order = [...drops].sort((a, b) => a.arriveAt - b.arriveAt || a.id - b.id);
  const bound = ARENA.halfWidth - ROCK.radius;
  let lo = 0;
  for (let i = 0; i < order.length; i++) {
    const d = order[i];
    let shift = wind ? windDir * rng.range(wind.min, wind.max) : 0;
    // Vents leave sweeps, stacks, and split halves alone; those already have a shape to keep.
    // In a wind they push with it, so every rock on a windy stage still drifts downwind.
    if (heat && (!d.pattern || d.pattern === 'pair') && !d.half && rng.chance(heat.chance)) {
      shift += (windDir || (rng.chance(0.5) ? 1 : -1)) * rng.range(heat.min, heat.max);
    }
    shift = Math.max(-DRIFT.maxShift, Math.min(DRIFT.maxShift, shift));
    if (!shift) continue;
    while (order[lo].arriveAt < d.arriveAt - CHECK_WINDOW - 0.5) lo++;
    let hi = i;
    while (hi + 1 < order.length && order[hi + 1].arriveAt <= d.arriveAt + CHECK_WINDOW) hi++;
    const neighbours = order.slice(lo, hi + 1).filter((o) => o !== d);
    const from = d.x;
    for (const s of [shift, shift / 2]) {
      const x = from + s;
      if (Math.abs(x) > bound || placementProblem({ ...d, x }, neighbours) || stormProblem(d.type, x, d.arriveAt, storms)) continue;
      if (d.x0 === undefined) {
        d.x0 = from;
        d.driftStart = d.detachAt + d.fallSeconds * DRIFT.from;
        d.driftEnd = d.detachAt + d.fallSeconds * DRIFT.to;
      }
      d.x = x;
      break;
    }
  }
  return windDir;
}

/**
 * Builds the full drop schedule for one stage. The target is dynamic: a level-dependent
 * share of the score this schedule's rocks actually offer along a reachable route.
 * `terrain` applies its rule (heat-vent drift, or a slower route model on ice); the stage
 * modifier defaults to the level's own.
 */
export function generateStageSchedule(level, seed, { duration = stageDuration(level), terrain = null, modifier = stageModifier(level) } = {}) {
  const s = seed >>> 0;
  const rules = TERRAIN_RULES[terrain];
  const storms = buildStorms(level, s, duration);
  const drops = buildDrops(level, s, duration, modifier, storms);
  const wind = applyDrift(drops, s, terrain, modifier, storms);
  const reachableScore = maxReachableScore(drops, { speedShare: FAIRNESS.reachSpeedShare * (rules?.reachFactor ?? 1) });
  const target = stageTarget(level, reachableScore, (MODIFIERS[modifier]?.targetScale ?? 1) * (1 - STORM.targetPerStorm * storms.length));
  return { level, seed: s, duration, target, drops, reachableScore, terrain: rules ? terrain : null, modifier, wind, storms };
}

const previewTargets = new Map();

/**
 * Typical target for a level, for menus shown before a stage exists. Each run's real target
 * comes from its own seeded schedule and is usually within a few hundred points of this.
 */
export function previewTarget(level, terrain = null) {
  const key = `${getDifficultyMode()}|${terrain}|${level}`;
  if (!previewTargets.has(key)) previewTargets.set(key, generateStageSchedule(level, hashSeed('preview', level), { terrain }).target);
  return previewTargets.get(key);
}
