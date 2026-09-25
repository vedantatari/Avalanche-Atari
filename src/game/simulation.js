// Deterministic game simulation: runs, stages, cart, falling rocks, catches, effects,
// lives, shields, and restores. No DOM, rendering, or wall-clock access in here.
//
// Tick order (fixed step): effects/input -> move cart -> advance cliff/items ->
// resolve catches in time-of-impact order -> apply results -> check termination.
import {
  ARENA,
  BASE_SCOOP_WIDTH,
  CART,
  CART_MAX_SPEED,
  COMBO,
  EFFECTS,
  ROCK,
  RUN,
  TICK_RATE,
  secondsToTicks,
} from '../config.js';
import { ITEM_TYPES, isNegative, isScoring, itemEffect } from './items.js';
import { LEVEL_COUNT, clampLevel, stageDuration } from './levels.js';
import { generateStageSchedule } from './spawn-director.js';
import { PAST_SCOOP_Y, dropYAt } from './cliff.js';
import { hashSeed, randomSeed } from './rng.js';

export const PHASE = Object.freeze({
  IDLE: 'idle',
  INTRO: 'intro',
  PLAYING: 'playing',
  PAUSED: 'paused',
  REVIVE: 'revive',
  ENDED: 'ended',
});

export const NO_INPUT = Object.freeze({ dir: 0, dragActive: false, dragDelta: 0, followX: null });

/** Run modes. `level` is the classic campaign; `daily` is one seeded stage; `endless` never ends on time. */
export const MODES = Object.freeze({ LEVEL: 'level', DAILY: 'daily', ENDLESS: 'endless' });

const SIZE_TICKS = secondsToTicks(EFFECTS.sizeSeconds);
const REVERSE_TICKS = secondsToTicks(EFFECTS.reverseSeconds);
const MULTIPLIER_TICKS = secondsToTicks(EFFECTS.multiplierSeconds);
const CLONE_TICKS = secondsToTicks(EFFECTS.cloneSeconds);
const HIT_IMMUNITY_TICKS = secondsToTicks(EFFECTS.hitImmunitySeconds);
const RESTORE_IMMUNITY_TICKS = secondsToTicks(EFFECTS.restoreImmunitySeconds);
const CATCH_OVERLAP = ROCK.radius * ROCK.catchOverlapFraction;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, f) => a + (b - a) * f;
const emptyCounts = () => Object.fromEntries(ITEM_TYPES.map((t) => [t, 0]));
const noEffects = () => ({ size: null, sizeUntil: 0, reverseUntil: 0, invulnUntil: 0, multiplier: 1, multiplierUntil: 0, cloneUntil: 0 });

/**
 * Centres of the two shadow-clone scoops (left, right) beside a cart at `x` with scoop
 * `width`. Each sits one scoop width plus a gap away and is kept inside the arena, so near an
 * edge the outer clone slides in behind the cart instead of leaving the rail.
 */
export function clonePositions(x, width) {
  const offset = width + EFFECTS.cloneGap;
  const bound = ARENA.halfWidth - width / 2;
  return [clamp(x - offset, -bound, bound), clamp(x + offset, -bound, bound)];
}

export class Simulation {
  /**
   * @param {object} [options]
   * @param {number|null} [options.durationOverride] dev/test only: shortens every stage.
   */
  constructor(options = {}) {
    this.dt = 1 / TICK_RATE;
    this.options = { durationOverride: null, ...options };
    this.phase = PHASE.IDLE;
    this.run = null;
    this.stage = null;
    this.cart = null;
    this.effects = null;
    this.events = [];
    this.pausedFrom = null;
  }

  // ---------------------------------------------------------------- run lifecycle

  /** Starts a brand-new run (fresh lives, empty shield bank, no restores used). */
  startRun(level, { seed, mode = MODES.LEVEL } = {}) {
    this.run = {
      mode,
      seed: (seed ?? randomSeed()) >>> 0,
      startLevel: clampLevel(level),
      lives: RUN.startLives,
      bank: 0,
      restoresUsed: 0,
      stagesCleared: 0,
      totalScore: 0,
    };
    this._startStage(clampLevel(level));
  }

  /**
   * Rebuilds a run from a saved snapshot and starts its current stage from the beginning.
   * Stage schedules derive from (run seed, level), so the stage replays exactly.
   */
  resumeRun(snap) {
    this.run = {
      mode: snap.mode || MODES.LEVEL,
      seed: snap.seed >>> 0,
      startLevel: clampLevel(snap.startLevel),
      lives: snap.lives,
      bank: snap.bank,
      restoresUsed: snap.restoresUsed,
      stagesCleared: snap.stagesCleared,
      totalScore: snap.totalScore,
    };
    this._startStage(clampLevel(snap.level));
  }

  /** Continues the run into the next level after a win: hearts refill, bank/restores carry. */
  continueRun() {
    const st = this.stage;
    if (!st || st.result !== 'won' || st.level >= LEVEL_COUNT) return false;
    if (this.run.mode !== MODES.LEVEL) return false; // a daily is one stage; endless never ends on a win
    this.run.lives = RUN.startLives;
    this._startStage(st.level + 1);
    return true;
  }

  /** Retrying always begins a new run at the same level, keeping the mode (and a daily's seed). */
  retry({ seed } = {}) {
    if (!this.stage || !this.run) return false;
    const mode = this.run.mode;
    const level = mode === MODES.ENDLESS ? this.run.startLevel : this.stage.level;
    this.startRun(level, { seed: seed ?? (mode === MODES.DAILY ? this.run.seed : undefined), mode });
    return true;
  }

  quit() {
    this.phase = PHASE.IDLE;
    this.stage = null;
    this.run = null;
    this.pausedFrom = null;
  }

  _startStage(level, { skipIntro = false } = {}) {
    const duration = this.options.durationOverride ?? stageDuration(level);
    // Endless waves can revisit a level number (capped at 100), so they seed by wave index.
    const stageSeed = this.run.mode === MODES.ENDLESS
      ? hashSeed(this.run.seed, 'wave', this.run.stagesCleared)
      : hashSeed(this.run.seed, level);
    const schedule = generateStageSchedule(level, stageSeed, { duration });
    this.stage = {
      level,
      duration,
      durationTicks: secondsToTicks(duration),
      /** null in endless mode: there is no score target, only survival. */
      target: this.run.mode === MODES.ENDLESS ? null : schedule.target,
      schedule,
      tick: 0,
      score: 0,
      combo: 0,
      bestCombo: 0,
      nextCrack: 0,
      cracking: [],
      falling: [],
      caught: emptyCounts(),
      livesLost: 0,
      fatal: false,
      targetReached: false,
      result: null,
      endReason: null,
    };
    this.cart = {
      x: 0,
      prevX: 0,
      v: 0,
      width: BASE_SCOOP_WIDTH,
      prevWidth: BASE_SCOOP_WIDTH,
      dragTarget: null,
      travelled: 0,
    };
    this.effects = noEffects();
    this.pausedFrom = null;
    this.phase = skipIntro ? PHASE.PLAYING : PHASE.INTRO;
    this._emit({ type: 'stageStart', level, target: this.stage.target, duration, mode: this.run.mode });
  }

  /** Ends the intro banner and starts the clock. */
  beginPlay() {
    if (this.phase !== PHASE.INTRO) return false;
    this.phase = PHASE.PLAYING;
    return true;
  }

  pause() {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.INTRO) return false;
    this.pausedFrom = this.phase;
    this.phase = PHASE.PAUSED;
    return true;
  }

  resume() {
    if (this.phase !== PHASE.PAUSED) return false;
    this.phase = this.pausedFrom || PHASE.PLAYING;
    this.pausedFrom = null;
    return true;
  }

  // ---------------------------------------------------------------- queries

  get time() {
    return this.stage ? this.stage.tick * this.dt : 0;
  }

  get timeRemaining() {
    return this.stage ? Math.max(0, (this.stage.durationTicks - this.stage.tick) * this.dt) : 0;
  }

  get maxSpeed() {
    return CART_MAX_SPEED;
  }

  isReversed() {
    return !!this.stage && this.stage.tick < this.effects.reverseUntil;
  }

  isInvulnerable() {
    return !!this.stage && this.stage.tick < this.effects.invulnUntil;
  }

  /** Factor applied to every point scored right now (1 when no multiplier is active). */
  scoreMultiplier() {
    return this.stage && this.effects.multiplierUntil > 0 ? this.effects.multiplier : 1;
  }

  hasClones() {
    return !!this.stage && this.effects.cloneUntil > 0;
  }

  /** Remaining seconds of each timed effect (0 when inactive). */
  effectTimers() {
    if (!this.stage) return { size: null, sizeSeconds: 0, reverseSeconds: 0, invulnSeconds: 0, multiplier: 1, multiplierSeconds: 0, cloneSeconds: 0 };
    const now = this.stage.tick;
    const left = (until) => Math.max(0, (until - now) * this.dt);
    const sizeLeft = this.effects.size ? left(this.effects.sizeUntil) : 0;
    const multLeft = this.effects.multiplierUntil > 0 ? left(this.effects.multiplierUntil) : 0;
    return {
      size: sizeLeft > 0 ? this.effects.size : null,
      sizeSeconds: sizeLeft,
      reverseSeconds: left(this.effects.reverseUntil),
      invulnSeconds: left(this.effects.invulnUntil),
      multiplier: multLeft > 0 ? this.effects.multiplier : 1,
      multiplierSeconds: multLeft,
      cloneSeconds: this.effects.cloneUntil > 0 ? left(this.effects.cloneUntil) : 0,
    };
  }

  targetScoopWidth() {
    const kind = this.effects?.size;
    if (kind === 'expand') return BASE_SCOOP_WIDTH * EFFECTS.expandFactor;
    if (kind === 'shrink') return BASE_SCOOP_WIDTH * EFFECTS.shrinkFactor;
    return BASE_SCOOP_WIDTH;
  }

  /** Logical scoop bounds used for catching (the hitbox). */
  scoopBounds() {
    const half = this.cart.width / 2;
    return { left: this.cart.x - half, right: this.cart.x + half, width: this.cart.width };
  }

  /** Centres of the shadow-clone scoops (left, right), or none when no clone is active. */
  cloneXs() {
    return this.hasClones() ? clonePositions(this.cart.x, this.cart.width) : [];
  }

  nextRestoreCost() {
    if (!this.run || this.run.restoresUsed >= RUN.restoreCosts.length) return null;
    return RUN.restoreCosts[this.run.restoresUsed];
  }

  /** Whether a restore can be bought right now, and if not, why. */
  restoreStatus() {
    const maxUses = RUN.restoreCosts.length;
    if (!this.run || !this.stage) return { ok: false, reason: 'no-run', cost: null, maxUses };
    const base = { cost: this.nextRestoreCost(), used: this.run.restoresUsed, maxUses, bank: this.run.bank };
    if (this.run.restoresUsed >= maxUses) return { ...base, ok: false, reason: 'max-used' };
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.REVIVE) return { ...base, ok: false, reason: 'not-playing' };
    if (this.run.lives >= RUN.maxLives) return { ...base, ok: false, reason: 'hearts-full' };
    if (this.run.bank < base.cost) return { ...base, ok: false, reason: 'need-shields', need: base.cost - this.run.bank };
    return { ...base, ok: true, reason: null };
  }

  /** Items the renderer should draw, with their current logical positions. */
  visibleDrops() {
    return this.stage ? this.stage.falling : [];
  }

  // ---------------------------------------------------------------- actions

  /** Spends banked shields to restore one heart. */
  restore() {
    const status = this.restoreStatus();
    if (!status.ok) return false;
    const run = this.run;
    run.bank -= status.cost;
    run.restoresUsed += 1;
    run.lives = Math.min(RUN.maxLives, run.lives + 1);
    this.effects.invulnUntil = Math.max(this.effects.invulnUntil, this.stage.tick + RESTORE_IMMUNITY_TICKS);
    const fromRevive = this.phase === PHASE.REVIVE;
    if (fromRevive) this.phase = PHASE.PLAYING;
    this._emit({ type: 'restore', cost: status.cost, lives: run.lives, bank: run.bank, fromRevive });
    return true;
  }

  /** Player chose not to restore at zero hearts: the run ends. */
  declineRevive() {
    if (this.phase !== PHASE.REVIVE) return false;
    this._endStage('lost', 'out-of-lives');
    return true;
  }

  // ---------------------------------------------------------------- simulation step

  /**
   * Advances exactly one fixed tick.
   * @param {{dir:number, dragActive:boolean, dragDelta:number}} input intended motion
   *   (keyboard/hold direction, and relative drag in world units). Reverse is applied here,
   *   once, for every input method.
   */
  tick(input = NO_INPUT) {
    if (this.phase !== PHASE.PLAYING) return false;
    const st = this.stage;
    const dt = this.dt;
    const t0 = st.tick * dt;

    // 1. Input is interpreted under the effects active for this tick.
    const sign = st.tick < this.effects.reverseUntil ? -1 : 1;

    // 2. Cart: scoop width eases toward its target, then the cart moves and is clamped.
    this._moveCart(input, sign, dt);

    // 3. Cliff and items.
    st.tick += 1;
    const t1 = st.tick * dt;
    this._advanceCliff(t1);

    // 4. Touches, in time-of-impact order. Any contact between a rock and the scoop counts,
    //    even on the rim's edge: either the rock's bottom reaches the rim above the scoop
    //    (at arriveAt, with the cart interpolated to that instant), or, while the rock is
    //    still beside the tub, the scoop's side runs into it (checked at the end of the tick).
    const contacts = [];
    for (const drop of st.falling) {
      if (drop.resolved || drop.arriveAt > t1) continue;
      if (drop.arriveAt > t0) {
        const f = (drop.arriveAt - t0) / dt;
        contacts.push({ drop, time: drop.arriveAt, cartX: lerp(this.cart.prevX, this.cart.x, f), width: lerp(this.cart.prevWidth, this.cart.width, f) });
      } else {
        contacts.push({ drop, time: t1, cartX: this.cart.x, width: this.cart.width });
      }
    }
    contacts.sort((a, b) => a.time - b.time || a.drop.id - b.drop.id);
    const deadline = st.durationTicks * dt;
    let frozen = false;
    for (const { drop, time, cartX, width } of contacts) {
      if (frozen || time > deadline + 1e-9) {
        drop.resolved = true;
        drop.missed = true;
        continue;
      }
      const catcher = this._catcherFor(drop, cartX, width);
      if (catcher) {
        drop.resolved = true;
        drop.caught = true;
        // 5. Apply the result immediately so later events in this tick see it.
        this._applyCatch(drop, catcher, time);
        if (this.run.lives <= 0) frozen = true; // freeze the rest of this tick
      } else if (dropYAt(drop, t1) < PAST_SCOOP_Y) {
        // Fell fully past the tub without touching it.
        drop.resolved = true;
        drop.missed = true;
        const event = { type: 'miss', id: drop.id, itemType: drop.type, x: drop.x, time: t1 };
        // Letting a scoring rock slip past breaks the combo streak.
        if (isScoring(drop.type) && st.combo > 0) {
          event.comboLost = st.combo;
          st.combo = 0;
        }
        this._emit(event);
      }
    }

    // Caught rocks leave the simulation now; missed rocks keep falling until the ledge.
    st.falling = st.falling.filter((d) => {
      if (d.caught) return false;
      if (d.missed && dropYAt(d, t1) < ARENA.floorY) {
        this._emit({ type: 'ground', id: d.id, itemType: d.type, x: d.x });
        return false;
      }
      return true;
    });

    // Timed effects end exactly on the tick boundary where their duration elapses.
    this._expireEffects(st.tick);

    // 6. Termination.
    const atDeadline = st.tick >= st.durationTicks;
    if (this.run.lives <= 0) {
      if (st.fatal) this._endStage('lost', 'demon'); // no revive from a demon touch
      else if (atDeadline) this._endStage('lost', 'out-of-lives');
      else if (this.restoreStatus().ok) {
        this.phase = PHASE.REVIVE;
        this._emit({ type: 'revivePrompt', ...this.restoreStatus() });
      } else this._endStage('lost', 'out-of-lives');
      return true;
    }
    if (atDeadline) {
      if (this.run.mode === MODES.ENDLESS) this._advanceEndless();
      else if (st.score >= st.target) this._endStage('won', 'time');
      else this._endStage('lost', 'time');
    }
    return true;
  }

  /** Endless mode: the timer running out rolls seamlessly into the next, harder wave. */
  _advanceEndless() {
    const st = this.stage;
    this.run.totalScore += st.score;
    this.run.stagesCleared += 1;
    const level = Math.min(LEVEL_COUNT, this.run.startLevel + this.run.stagesCleared);
    this._emit({ type: 'endlessLevelUp', level, wave: this.run.stagesCleared + 1, total: this.run.totalScore });
    this._startStage(level, { skipIntro: true });
  }

  _expireEffects(now) {
    const fx = this.effects;
    if (fx.size && now >= fx.sizeUntil) {
      const kind = fx.size;
      fx.size = null;
      this._emit({ type: 'effectEnd', effect: kind });
    }
    if (fx.reverseUntil > 0 && now >= fx.reverseUntil) {
      fx.reverseUntil = 0;
      this._emit({ type: 'effectEnd', effect: 'reverse' });
    }
    if (fx.multiplierUntil > 0 && now >= fx.multiplierUntil) {
      fx.multiplierUntil = 0;
      fx.multiplier = 1;
      this._emit({ type: 'effectEnd', effect: 'multiplier' });
    }
    if (fx.cloneUntil > 0 && now >= fx.cloneUntil) {
      fx.cloneUntil = 0;
      this._emit({ type: 'effectEnd', effect: 'clone' });
    }
  }

  /**
   * The scoop that catches `drop`, as { x, scoop } where scoop is 0 for the cart and -1 / 1
   * for the left / right shadow clone, or null for a miss. A scoop catches a rock as soon as
   * they touch (|dx| <= half scoop width + rock radius). The cart's own scoop wins ties.
   * Clones are shadows: they collect helpful rocks, and harmful ones fall straight through.
   */
  _catcherFor(drop, cartX, width) {
    const reach = width / 2 + CATCH_OVERLAP;
    if (Math.abs(drop.x - cartX) <= reach) return { x: cartX, scoop: 0 };
    if (!this.effects.cloneUntil || isNegative(drop.type)) return null;
    const [left, right] = clonePositions(cartX, width);
    if (Math.abs(drop.x - left) <= reach) return { x: left, scoop: -1 };
    if (Math.abs(drop.x - right) <= reach) return { x: right, scoop: 1 };
    return null;
  }

  _moveCart(input, sign, dt) {
    const cart = this.cart;
    cart.prevX = cart.x;
    cart.prevWidth = cart.width;

    const targetWidth = this.targetScoopWidth();
    const step = CART.widthChangeRate * dt;
    cart.width = Math.abs(targetWidth - cart.width) <= step ? targetWidth : cart.width + Math.sign(targetWidth - cart.width) * step;

    const bound = ARENA.halfWidth - cart.width / 2;
    const vmax = CART_MAX_SPEED;
    const dir = clamp(Math.round(input.dir || 0), -1, 1) * sign;

    if (dir !== 0) {
      cart.dragTarget = null;
      const desired = dir * vmax;
      const dv = CART.acceleration * dt;
      cart.v = Math.abs(desired - cart.v) <= dv ? desired : cart.v + Math.sign(desired - cart.v) * dv;
      // Reversing direction is immediate: no sliding the wrong way.
      if (Math.sign(cart.v) !== 0 && Math.sign(cart.v) !== dir) cart.v = 0;
    } else if (input.dragActive) {
      if (cart.dragTarget === null) cart.dragTarget = cart.x;
      cart.dragTarget = clamp(cart.dragTarget + (input.dragDelta || 0) * sign, -bound, bound);
      cart.v = clamp((cart.dragTarget - cart.x) / dt, -vmax, vmax);
    } else if (Number.isFinite(input.followX)) {
      // Absolute pointer-follow: the cart tracks the pointer's world X at up to top speed.
      // Reverse mirrors the target about the centre, so following inverts like every input.
      cart.dragTarget = null;
      const target = clamp(input.followX * sign, -bound, bound);
      cart.v = clamp((target - cart.x) / dt, -vmax, vmax);
    } else {
      cart.dragTarget = null;
      const dv = CART.acceleration * 1.4 * dt;
      cart.v = Math.abs(cart.v) <= dv ? 0 : cart.v - Math.sign(cart.v) * dv;
    }

    const nextX = cart.x + cart.v * dt;
    cart.x = clamp(nextX, -bound, bound);
    if (cart.x !== nextX) cart.v = 0;
    if (cart.dragTarget !== null) cart.dragTarget = clamp(cart.dragTarget, -bound, bound);
    cart.travelled += cart.x - cart.prevX;
  }

  _advanceCliff(t1) {
    const st = this.stage;
    const drops = st.schedule.drops;
    while (st.nextCrack < drops.length && drops[st.nextCrack].crackAt <= t1) {
      const drop = drops[st.nextCrack++];
      st.cracking.push(drop);
      this._emit({ type: 'crack', id: drop.id, itemType: drop.type, cellId: drop.cellId, time: drop.crackAt });
    }
    if (st.cracking.length) {
      const still = [];
      for (const drop of st.cracking) {
        if (drop.detachAt <= t1) {
          st.falling.push({ ...drop, resolved: false, caught: false, missed: false });
          this._emit({ type: 'detach', id: drop.id, itemType: drop.type, cellId: drop.cellId, time: drop.detachAt });
        } else still.push(drop);
      }
      st.cracking = still;
    }
  }

  _applyCatch(drop, catcher, time) {
    const st = this.stage;
    const run = this.run;
    const fx = this.effects;
    const def = itemEffect(drop.type);
    const now = st.tick;
    // cartX is the centre of the scoop that caught the rock (the cart's or a clone's).
    // y is the rock's centre height at the touch, so renderers can settle it from there.
    const event = { type: 'catch', id: drop.id, itemType: drop.type, x: drop.x, y: dropYAt(drop, time), cartX: catcher.x, scoop: catcher.scoop, time };
    st.caught[drop.type] += 1;

    if (def.score) {
      const factor = this.scoreMultiplier();
      st.score += def.score * factor;
      event.score = def.score * factor;
      if (factor > 1) event.multiplier = factor;
      // Combo streak: consecutive scoring catches; every COMBO.every pays a rising bonus.
      st.combo += 1;
      st.bestCombo = Math.max(st.bestCombo, st.combo);
      event.combo = st.combo;
      if (st.combo % COMBO.every === 0) {
        const bonus = COMBO.bonus * (st.combo / COMBO.every);
        st.score += bonus;
        event.comboBonus = bonus;
      }
    }
    if (def.multiplier) {
      event.refreshed = fx.multiplierUntil > 0 && fx.multiplier === def.multiplier;
      if (fx.multiplierUntil > 0 && fx.multiplier !== def.multiplier) event.replaced = fx.multiplier;
      fx.multiplier = def.multiplier;
      fx.multiplierUntil = now + MULTIPLIER_TICKS;
      event.effect = 'multiplier';
      event.multiplier = def.multiplier;
    }
    if (def.clone) {
      event.refreshed = fx.cloneUntil > 0;
      fx.cloneUntil = now + CLONE_TICKS;
      event.effect = 'clone';
    }
    if (def.bank) {
      run.bank += def.bank;
      event.bank = run.bank;
    }
    if (def.size) {
      const refreshed = fx.size === def.size;
      const replaced = fx.size && fx.size !== def.size ? fx.size : null;
      fx.size = def.size;
      fx.sizeUntil = now + SIZE_TICKS;
      event.effect = def.size;
      event.refreshed = refreshed;
      if (replaced) event.replaced = replaced;
    }
    if (def.reverse) {
      event.refreshed = now < fx.reverseUntil;
      fx.reverseUntil = now + REVERSE_TICKS;
      event.effect = 'reverse';
    }
    if (def.fatal) {
      // The demon: instant loss, regardless of hearts, shields, or immunity.
      st.livesLost += run.lives;
      run.lives = 0;
      st.fatal = true;
      event.fatal = true;
      event.lives = 0;
      st.combo = 0;
    }
    if (def.damage) {
      if (now < fx.invulnUntil) {
        event.blocked = true;
      } else {
        run.lives = Math.max(0, run.lives - def.damage);
        st.livesLost += def.damage;
        fx.invulnUntil = now + HIT_IMMUNITY_TICKS;
        event.damage = def.damage;
        event.lives = run.lives;
        st.combo = 0;
      }
    }
    this._emit(event);

    if (!st.targetReached && st.target !== null && st.score >= st.target) {
      st.targetReached = true;
      this._emit({ type: 'targetReached', score: st.score, target: st.target });
    }
  }

  _endStage(result, reason) {
    const st = this.stage;
    st.result = result;
    st.endReason = reason;
    this.phase = PHASE.ENDED;
    if (result === 'won') this.run.stagesCleared += 1;
    this.run.totalScore += st.score;
    this._emit({
      type: 'stageEnd',
      result,
      reason,
      mode: this.run.mode,
      level: st.level,
      score: st.score,
      total: this.run.totalScore,
      target: st.target,
      /** What this stage's own rocks offered along a reachable route; used for star ratings. */
      reachable: st.schedule.reachableScore,
      bestCombo: st.bestCombo,
      wave: this.run.mode === MODES.ENDLESS ? this.run.stagesCleared + 1 : null,
      caught: { ...st.caught },
      livesLost: st.livesLost,
      lives: this.run.lives,
      finalLevel: this.run.mode === MODES.LEVEL && st.level >= LEVEL_COUNT,
    });
  }

  _emit(event) {
    this.events.push(event);
  }

  /** Returns and clears pending events (consumed by renderer, audio, and UI). */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
