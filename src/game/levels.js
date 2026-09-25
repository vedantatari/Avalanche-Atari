// Stage durations, score targets, and difficulty curves per level.
import { LEVELS, DIFFICULTY, DIFFICULTY_MODES, FAIRNESS } from '../config.js';

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
 * rounded to 50, and never above reachable / minReachableScoreRatio.
 */
export function stageTarget(level, reachableScore) {
  const step = LEVELS.targetRoundTo;
  const target = Math.round((reachableScore * targetShare(level)) / step) * step;
  const cap = Math.floor(reachableScore / FAIRNESS.minReachableScoreRatio / step) * step;
  return Math.max(step, Math.min(target, cap));
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
