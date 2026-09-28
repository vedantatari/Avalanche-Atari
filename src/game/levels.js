// Stage durations, score targets, modifiers, and difficulty curves per level.
import { LEVELS, DIFFICULTY, DIFFICULTY_MODES, FAIRNESS, MODIFIERS } from '../config.js';

export const LEVEL_COUNT = LEVELS.count;

// Selected difficulty mode (Easy / Normal / Hard). A module-level setting so every curve,
// schedule, and preview reads the same mode; it only applies from the next generated stage.
let difficultyMode = 'normal';

export function setDifficultyMode(mode) {
  difficultyMode = DIFFICULTY_MODES[mode] ? mode : 'normal';
}

export const getDifficultyMode = () => difficultyMode;

const modeFactors = () => DIFFICULTY_MODES[difficultyMode];

export function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n)) return 1;
  return Math.min(LEVEL_COUNT, Math.max(1, n));
}

/** Level the difficulty curves use: level 1 plays like the original level 1 + offset. */
export const difficultyLevel = (level) => level + LEVELS.difficultyOffset;

export const levelTerrain = (level) => (level % 2 ? 'volcano' : 'ice');

export function stageDuration(level) {
  const band = LEVELS.durationBands.find((b) => level <= b.maxLevel);
  return (band || LEVELS.durationBands[LEVELS.durationBands.length - 1]).seconds;
}

/** Share of a stage's reachable score the player must collect; rises with level. */
export function targetShare(level) {
  const { start, max, levelScale } = LEVELS.targetShare;
  return (max - (max - start) * Math.exp(-(level - 1) / levelScale)) * modeFactors().targetShare;
}

/**
 * Dynamic target: a level-dependent share of the scoring this stage's own rocks offer,
 * rounded to 50, and never above reachable / minReachableScoreRatio. `scale` eases the share
 * for stage modifiers that make routes harder than the reachable-score model assumes.
 */
export function stageTarget(level, reachableScore, scale = 1) {
  const step = LEVELS.targetRoundTo;
  const target = Math.round((reachableScore * targetShare(level) * scale) / step) * step;
  const cap = Math.floor(reachableScore / FAIRNESS.minReachableScoreRatio / step) * step;
  return Math.max(step, Math.min(target, cap));
}

/** The stage modifier a level carries (by its last digit, from each modifier's first level), or null. */
export function stageModifier(level) {
  const digit = level % 10;
  for (const [id, m] of Object.entries(MODIFIERS)) {
    if (m.digit === digit && level >= m.fromLevel) return id;
  }
  return null;
}

/** 3 stars for near-perfect play (≥ 90% of the reachable score), 2 for ≥ 75%, 1 for any win. */
export function starRating(won, score, reachable) {
  if (!won || !(reachable > 0)) return 0;
  const share = score / reachable;
  return share >= 0.9 ? 3 : share >= 0.75 ? 2 : 1;
}

const approach = ({ start, min, levelScale }, level) =>
  min + (start - min) * Math.exp(-(level - 1) / levelScale);

export function difficultyFor(level) {
  const p = DIFFICULTY.patterns;
  const d = difficultyLevel(level);
  const f = modeFactors();
  return {
    dropInterval: approach(DIFFICULTY.dropInterval, d) * f.dropInterval,
    fallSeconds: approach(DIFFICULTY.fallSeconds, d) * f.fallSeconds,
    patternChance: Math.min(p.maxChance, p.baseChance + p.chancePerLevel * d),
    sweep: d >= p.sweepFromLevel,
    pair: d >= p.pairFromLevel,
    stack: d >= p.stackFromLevel,
  };
}
