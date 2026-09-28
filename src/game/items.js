// Logical item types. Scoring, collisions, and progression only ever use these ids;
// how a type looks is decided by render/appearance.js.
import { ITEM_EFFECTS, MODIFIERS, SPAWN_WEIGHTS, TYPE_UNLOCK_LEVEL } from '../config.js';
import { difficultyLevel } from './levels.js';

export const ITEM_TYPES = Object.freeze(['coin', 'cash', 'shield', 'expand', 'shrink', 'fire', 'demon', 'reverse', 'mult2', 'mult3', 'mult5', 'clone', 'split', 'magnet', 'mystery', 'frost']);

export function itemEffect(type) {
  const def = ITEM_EFFECTS[type];
  if (!def) throw new Error(`Unknown item type: ${type}`);
  return def;
}

export const isNegative = (type) => itemEffect(type).polarity === 'negative';
export const isPositive = (type) => itemEffect(type).polarity === 'positive';
export const scoreValue = (type) => itemEffect(type).score || 0;
export const isScoring = (type) => scoreValue(type) > 0;

/** TYPE_UNLOCK_LEVEL is on the difficulty scale, so level 1 already has old level-5 rocks. */
export function enabledItemTypes(level) {
  return ITEM_TYPES.filter((t) => difficultyLevel(level) >= TYPE_UNLOCK_LEVEL[t] && SPAWN_WEIGHTS[t] > 0);
}

/** Weights normalised over the types enabled at `level`, boosted by a stage modifier if any. */
export function normalisedWeights(level, modifier = null) {
  const boost = MODIFIERS[modifier]?.weights || {};
  const weight = (t) => SPAWN_WEIGHTS[t] * (boost[t] ?? 1);
  const types = enabledItemTypes(level);
  const total = types.reduce((sum, t) => sum + weight(t), 0);
  return Object.fromEntries(types.map((t) => [t, weight(t) / total]));
}

/** Types that appear for the first time at exactly this level (used for first-encounter hints). */
export function typesIntroducedAt(level) {
  const d = difficultyLevel(level);
  return ITEM_TYPES.filter((t) => TYPE_UNLOCK_LEVEL[t] === d && level > 1);
}
