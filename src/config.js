// Central tuning for Avalanche.
// Every number here is an initial default, not a validated balancing claim.
// Gameplay code reads from this module only; renderers read ARENA/CLIFF/ROCK for geometry.

/** Fixed simulation rate (ticks per second). Effects and timers count whole ticks. */
export const TICK_RATE = 120;

export const LOOP = {
  /** Longest real frame delta fed to the simulation; larger gaps are dropped, not caught up. */
  maxFrameDelta: 0.1,
  maxTicksPerFrame: 24,
};

/** Logical playfield in world units. The gameplay plane sits at z = gameZ. */
export const ARENA = {
  halfWidth: 10,
  catchY: 0,
  /** Missed rocks break on the rail ledge once they fall below this height. */
  floorY: -1.05,
  gameZ: 0.8,
  /** Region of the gameplay plane that must always be visible (arena, cart, source shelves). */
  frame: { minX: -10.7, maxX: 10.7, minY: -1.85, maxY: 10.25 },
  /** Share of spare vertical screen space placed above the arena (rest goes below). */
  extraSpaceAbove: 0.9,
  /** Fixed camera: height above the catch plane and distance in front of the gameplay plane. */
  cameraHeight: 6.5,
  cameraDistance: 34,
};

export const CART = {
  /** Base scoop width as a share of the arena width (same on every device). */
  scoopWidthRatio: 0.1408,
  /** Seconds to cross the full travel range at top speed (was 1.2; faster on request). */
  traverseSeconds: 0.8,
  /** Keyboard / hold-button acceleration (world units per second squared). */
  acceleration: 307,
  /** Scoop width tween speed (world units per second) so edge clamping never jumps. */
  widthChangeRate: 10,
  /** Depth of the scoop tub below its rim. A rock touching the tub's side also counts. */
  scoopDepth: 0.5,
};

export const ROCK = {
  /** Logical half-size of a falling rock (matches the visible block) used for touching and spacing. */
  radius: 0.462,
  blockScale: 1.1,
  /** Falling rocks shrink to this share of the shelf-block size once they detach. */
  fallingScale: 0.63,
  /**
   * Falling boxes are stretched slightly wider than tall (a card-like aspect ratio) so the
   * embedded marking gets more room; the emblem itself is kept round by the renderers.
   */
  fallingStretch: { x: 1.15, y: 0.88 },
  /**
   * Portion of the rock radius that may hang outside the scoop and still count as caught.
   * 1 = any touch counts, even a rock grazing the rim's edge (good, bad, or effect).
   */
  catchOverlapFraction: 1,
  /** Seconds a detached rock spends accelerating before reaching its steady fall speed. */
  accelSeconds: 0.35,
};

/** Source shelves near the cliff top. Rows further back sit higher. */
export const CLIFF = {
  columnSpacing: 1.584,
  rows: [
    { y: 7.3, z: -0.6, columns: 13 },
    { y: 8.4, z: -1.55, columns: 12 },
    { y: 9.5, z: -2.5, columns: 13 },
  ],
  /** Seconds a hole stays empty before a replacement rock slides in. */
  refillDelay: 3.2,
  refillSeconds: 0.65,
};

export const RUN = {
  startLives: 3,
  maxLives: 3,
  /** Shield cost of each restore within one run; its length is the restore cap. */
  restoreCosts: [1, 2, 4, 8],
};

export const EFFECTS = {
  expandFactor: 1.4,
  shrinkFactor: 0.7,
  sizeSeconds: 5,
  reverseSeconds: 5,
  /** Score multiplier rocks (×2 / ×3 / ×5): a new one replaces the current one and restarts the timer. */
  multiplierSeconds: 5,
  /** Shadow clone: two ghost scoops ride beside the cart, one scoop width plus this gap away. */
  cloneSeconds: 5,
  cloneGap: 1.3,
  cloneOpacity: 0.7,
  /** Magnet: helpful rocks this far beyond the scoop's normal reach are pulled in as well. */
  magnetSeconds: 5,
  magnetReach: 2.45,
  /** Frost: the cart's top speed drops to this share while its wheels are frozen. */
  frostSeconds: 4,
  frostSpeedFactor: 0.5,
  hitImmunitySeconds: 1,
  restoreImmunitySeconds: 1,
};

/** Logical item effects. Appearance lives separately in render/appearance.js. */
export const ITEM_EFFECTS = {
  coin: { polarity: 'positive', score: 50 },
  cash: { polarity: 'positive', score: 100 },
  shield: { polarity: 'positive', bank: 1 },
  expand: { polarity: 'positive', size: 'expand' },
  shrink: { polarity: 'negative', size: 'shrink' },
  fire: { polarity: 'negative', damage: 1 },
  /** Touching the demon ends the run instantly, regardless of hearts, shields, or immunity. */
  demon: { polarity: 'negative', fatal: true },
  reverse: { polarity: 'negative', reverse: true },
  mult2: { polarity: 'positive', multiplier: 2 },
  mult3: { polarity: 'positive', multiplier: 3 },
  mult5: { polarity: 'positive', multiplier: 5 },
  clone: { polarity: 'positive', clone: true },
  /** Breaks in two mid-fall (see SPLIT); each half is its own scoring rock. */
  split: { polarity: 'positive', score: 40 },
  magnet: { polarity: 'positive', magnet: true },
  /** Resolves to a seeded surprise when caught (see MYSTERY). It never costs a heart. */
  mystery: { polarity: 'positive', mystery: true },
  frost: { polarity: 'negative', frost: true },
};

/**
 * Mystery rock: its outcome is drawn when the stage is generated (so replays and the daily
 * match) and revealed on the catch. Weighted; never fire or the demon.
 */
export const MYSTERY = {
  jackpot: 250,
  outcomes: { jackpot: 30, shield: 14, expand: 12, mult3: 10, magnet: 8, clone: 6, shrink: 10, reverse: 5, frost: 5 },
};

/**
 * Split rock: breaks in two at `at` of its fall; the halves reach their landing spots,
 * `offset` either side of the source column, at `settle` of the fall. 2 × offset stays under
 * the scoop's reach, so a centred cart can take both halves.
 */
export const SPLIT = { at: 0.35, settle: 0.7, offset: 0.8 };

/** Relative drop weights, normalised over the types enabled at a level. Weight 0 = never in the bag (the demon is scheduled on its own clock instead). */
export const SPAWN_WEIGHTS = {
  coin: 58,
  cash: 12,
  shield: 6,
  expand: 7,
  fire: 14,
  demon: 0,
  shrink: 5,
  reverse: 4,
  mult2: 4,
  mult3: 3,
  mult5: 2,
  clone: 4,
  split: 5,
  magnet: 3,
  mystery: 4,
  frost: 4,
};

/**
 * First level at which each type can drop, on the difficulty scale (level + difficultyOffset):
 * the four newer rocks arrive during the first campaign levels (2, 3, 5, and 8).
 */
export const TYPE_UNLOCK_LEVEL = {
  coin: 1,
  cash: 1,
  shield: 1,
  expand: 1,
  fire: 1,
  demon: 1,
  shrink: 3,
  reverse: 5,
  mult2: 1,
  mult3: 1,
  mult5: 1,
  clone: 1,
  split: 16,
  magnet: 17,
  mystery: 19,
  frost: 22,
};

/**
 * Terrain rules: each terrain changes one mechanic (its look lives in render/themes.js).
 * Ice: a slippery rail — the cart speeds up, brakes, and turns with less grip and glides on
 * after input stops (top speed is unchanged). Volcano: heat vents push some rocks sideways as
 * they fall; every pushed landing spot is re-checked against the fairness rules.
 */
export const TERRAIN_RULES = {
  ice: {
    rule: 'Slippery rail',
    blurb: 'The cart glides on after you let go',
    /** World units per second squared: speeding up, coasting to a stop, and braking/turning. */
    grip: { accel: 153, friction: 96, brake: 230 },
    /** Reachable-score routes assume this share of the usual route speed (sluggish turns). */
    reachFactor: 0.92,
  },
  volcano: {
    rule: 'Heat vents',
    blurb: 'Hot updrafts push some rocks sideways',
    /** Chance that a rock is pushed, and how far (world units). */
    drift: { chance: 0.5, min: 0.9, max: 1.8 },
  },
};

/** Sideways drift (heat vents, wind) runs between these shares of a fall, so rocks land straight. */
export const DRIFT = { from: 0.15, to: 0.8, maxShift: 2.6 };

/**
 * Stage modifiers. Campaign levels whose number ends in `digit` carry one (from `fromLevel`);
 * endless waves and the daily inherit their level's modifier. `targetScale` eases the target
 * where the modifier makes routes harder than the reachable-score model assumes.
 */
export const MODIFIERS = {
  windy: { label: 'Windy', blurb: 'Every rock drifts with the wind', digit: 4, fromLevel: 4, wind: { min: 0.7, max: 1.3 }, targetScale: 0.95 },
  /** Rocks show their markings only once they fall below `line` (world height). */
  fog: { label: 'Fog', blurb: 'Rocks show their markings only below the fog', digit: 7, fromLevel: 7, line: 4.4, targetScale: 0.92 },
  goldRush: { label: 'Gold rush', blurb: 'More gold and emeralds — and more fire', digit: 9, fromLevel: 9, weights: { coin: 1.5, cash: 2, fire: 1.35 } },
};

/**
 * Combo streak: consecutive catches of scoring rocks (gold/emerald). Missing a scoring rock
 * or taking damage resets the streak; every `every` catches pays `bonus × (streak / every)`.
 */
export const COMBO = {
  every: 5,
  bonus: 50,
};

/**
 * Difficulty modes: multipliers layered over the shared level curves. `normal` must stay
 * all-1s so the default schedules (and the tests that pin them) never change.
 */
export const DIFFICULTY_MODES = {
  easy: { label: 'Easy', dropInterval: 1.25, fallSeconds: 1.15, targetShare: 0.85 },
  normal: { label: 'Normal', dropInterval: 1, fallSeconds: 1, targetShare: 1 },
  hard: { label: 'Hard', dropInterval: 0.85, fallSeconds: 0.9, targetShare: 1.12 },
};

/** The demon: a scheduled hazard outside the weighted bag. Touching it ends the run. */
export const STORM = {
  fromLevel: 20,
  width: 0.35,
  counts: [
    { fromLevel: 20, min: 2, max: 3 },
    { fromLevel: 50, min: 4, max: 5 },
    { fromLevel: 80, min: 5, max: 6 },
  ],
  firstAt: 4,
  endMargin: 1,
  warnSeconds: 2,
  strikeSeconds: 3,
  calmSeconds: 1,
  targetPerStorm: 0.015,
};

export const DEMON = {
  /** Seconds between demon spawns within a stage (the first comes this long in). */
  everySeconds: 12,
  /** The demon falls in this share of the level's normal fall time (< 1 = faster than everyone). */
  fallFactor: 0.8,
};

export const LEVELS = {
  count: 100,
  /** Every stage runs on the same 45-second clock. */
  durationBands: [{ maxLevel: 100, seconds: 45 }],
  /**
   * Difficulty curves (speed, drop rate, patterns, rock unlocks) use level + this offset,
   * so level 1 plays like the original level 15 and every later level shifts along with it.
   */
  difficultyOffset: 14,
  /**
   * Targets are dynamic: each stage asks for this share of the scoring its own seeded rocks
   * offer (reachable score). The share rises from `start` at level 1 toward `max`.
   */
  targetShare: { start: 0.6, max: 0.7, levelScale: 40 },
  targetRoundTo: 50,
};

export const DIFFICULTY = {
  /** Seconds between drops: exponential approach from start toward min as level rises. */
  dropInterval: { start: 0.6, min: 0.26, levelScale: 30 },
  /** Source-to-scoop travel time. */
  fallSeconds: { start: 2.86, min: 1.15, levelScale: 25 },
  /** +/- share of random variation applied to each drop interval. */
  intervalJitter: 0.18,
  /** Visible crack/shake before a rock detaches. */
  crackSeconds: { min: 0.3, max: 0.45 },
  firstCrackAt: 0.4,
  /** Drops must reach the scoop at least this long before the deadline. */
  endBuffer: 0.05,
  /** Multi-drop patterns unlock with level; chance of a pattern per spawn slot. */
  patterns: {
    sweepFromLevel: 6,
    pairFromLevel: 10,
    stackFromLevel: 14,
    baseChance: 0.09,
    chancePerLevel: 0.004,
    maxChance: 0.4,
  },
};

export const FAIRNESS = {
  /** Positive and harmful rocks arriving together need this much clear air beyond the widest scoop. */
  comfortMargin: 0.8,
  /** Share of top speed assumed available for dodging between near-simultaneous arrivals. */
  dodgeSpeedShare: 0.5,
  /** Harmful rocks arriving within this window are treated as one wall that must leave a gap. */
  hazardWindow: 0.35,
  minSafeGap: 1.5,
  maxNegativesPerWindow: 2,
  /** Rocks in nearly the same column must arrive this far apart so they never overlap. */
  sameColumnSeconds: 0.42,
  sameColumnDistance: 1.5,
  maxConsecutiveNegative: 2,
  maxConsecutiveNonScoring: 4,
  bagSize: 25,
  /** Share of top speed a human is assumed to use when chaining catches. */
  reachSpeedShare: 0.8,
  /** Probability that a scoring rock is placed inside the comfortable reach of the previous one. */
  reachBias: 0.5,
  /** Targets never exceed reachable score / this ratio. */
  minReachableScoreRatio: 1.4,
};

export const QUALITY = {
  high: { dprCap: 2, shadows: true, shadowMapSize: 2048, particleScale: 1, ambientParticles: 320 },
  medium: { dprCap: 1.5, shadows: true, shadowMapSize: 1024, particleScale: 0.7, ambientParticles: 180 },
  low: { dprCap: 1, shadows: false, shadowMapSize: 512, particleScale: 0.4, ambientParticles: 50 },
  adaptive: { sampleFrames: 120, downgradeMs: 21, upgradeMs: 13, cooldownSeconds: 4, holdSeconds: 45 },
};

export const THEMES = ['ice', 'volcano'];

/** Background life (decorative only; never affects gameplay). Ranges are [min, max] seconds. */
export const LIFE = {
  baseWind: 0.25,
  gustEvery: [7, 13],
  gustSeconds: 2.8,
  gustStrength: 3.6,
  slideEvery: [1.6, 3.2],
  siftEvery: [1.0, 2.2],
  birdsEvery: [5, 9],
  avalancheEvery: [12, 22],
  eruptionEvery: [11, 18],
  spatterEvery: [2.5, 5],
  cloudCount: 7,
  /** Soft cloud shadows sweeping across the cliffs, and slanted sun shafts. */
  cloudShadows: 3,
  shadowOpacity: 0.2,
  sunShafts: 3,
  /** Largest share the sun dims when a cloud shadow passes. */
  cloudShadow: 0.07,
};

export const UI = {
  /** Seconds the "Level N" ready banner shows before play begins. */
  introSeconds: 1.3,
  toastSeconds: 2.6,
};

// ---- derived helpers (keep formulas next to the numbers they use) ----

export const ARENA_WIDTH = ARENA.halfWidth * 2;
export const BASE_SCOOP_WIDTH = ARENA_WIDTH * CART.scoopWidthRatio;
export const TRAVEL_RANGE = ARENA_WIDTH - BASE_SCOOP_WIDTH;
export const CART_MAX_SPEED = TRAVEL_RANGE / CART.traverseSeconds;
export const secondsToTicks = (s) => Math.round(s * TICK_RATE);
