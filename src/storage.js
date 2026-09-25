// Versioned local save: unlocked level, best scores, stars, leaderboard, settings, and an
// in-progress run snapshot. Every loaded value is validated; corrupt, older, or unavailable
// storage falls back safely.
import { LEVELS, THEMES } from './config.js';
import { ITEM_TYPES } from './game/items.js';

export const SAVE_KEY = 'avalanche.save';
export const SAVE_VERSION = 2;
const QUALITY_VALUES = ['auto', 'high', 'medium', 'low'];
const RENDERER_VALUES = ['auto', '3d', '2d'];
const DIFFICULTY_VALUES = ['easy', 'normal', 'hard'];
const RESUME_MODES = ['level', 'endless'];
/** Most leaderboard entries kept, best first. */
const SCORE_LIMIT = 10;

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    unlockedLevel: 1,
    /** Best score per level, shared by every terrain (schedules are terrain-independent). */
    best: {},
    /** Star rating per level (1–3), from the share of the stage's reachable score collected. */
    stars: {},
    /** Local leaderboard: finished runs, best first. */
    scores: [],
    /** Today's daily challenge: { date: 'YYYY-MM-DD', level, best }. */
    daily: null,
    endlessBest: 0,
    /** Snapshot of an in-progress run, taken at each stage start, for "Resume run". */
    resume: null,
    settings: {
      sound: true,
      music: true,
      masterVol: 1,
      sfxVol: 1,
      musicVol: 1,
      reducedMotion: false,
      quality: 'auto',
      renderer: 'auto',
      difficulty: 'normal',
      pointerFollow: true,
    },
    tutorialDone: false,
    seenTypes: [],
    theme: 'ice',
    selectedLevel: 1,
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const vol = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

/** {level: score} map with only valid levels and scores kept. */
function levelMap(src, maxValue) {
  const out = {};
  if (!isObj(src)) return out;
  for (const [level, value] of Object.entries(src)) {
    const l = intIn(level, 1, LEVELS.count, 0);
    const v = intIn(value, 0, maxValue, -1);
    if (l && v > 0) out[l] = v;
  }
  return out;
}

/** Coerces any parsed value (possibly from an older version or tampered) into a valid save. */
export function sanitizeSave(raw) {
  const save = defaultSave();
  if (!isObj(raw)) return save;

  // Version 0 (pre-release prototype) stored `unlocked` and `bestScores` keyed by level only.
  if (raw.version === undefined && ('unlocked' in raw || 'bestScores' in raw)) {
    raw = { ...raw, unlockedLevel: raw.unlocked, best: raw.bestScores };
  }

  save.unlockedLevel = intIn(raw.unlockedLevel, 1, LEVELS.count, 1);
  save.selectedLevel = Math.min(save.unlockedLevel, intIn(raw.selectedLevel, 1, LEVELS.count, 1));

  // Version 1 kept bests per terrain; schedules were always terrain-independent, so the
  // migration keeps each level's highest score across terrains.
  let bestSrc = raw.best;
  if (isObj(bestSrc) && THEMES.some((t) => isObj(bestSrc[t]))) {
    const merged = {};
    for (const t of THEMES) {
      for (const [level, score] of Object.entries(levelMap(bestSrc[t], 1e7))) {
        merged[level] = Math.max(merged[level] || 0, score);
      }
    }
    bestSrc = merged;
  }
  save.best = levelMap(bestSrc, 1e7);
  save.stars = levelMap(raw.stars, 3);

  if (Array.isArray(raw.scores)) {
    save.scores = raw.scores
      .filter(isObj)
      .map((s) => ({
        mode: oneOf(s.mode, ['level', 'endless', 'daily'], 'level'),
        level: intIn(s.level, 1, LEVELS.count, 1),
        score: intIn(s.score, 0, 1e8, -1),
        date: typeof s.date === 'string' ? s.date.slice(0, 10) : '',
      }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, SCORE_LIMIT);
  }
  if (isObj(raw.daily) && typeof raw.daily.date === 'string') {
    const best = intIn(raw.daily.best, 0, 1e8, -1);
    const level = intIn(raw.daily.level, 1, LEVELS.count, 0);
    if (best >= 0 && level) save.daily = { date: raw.daily.date.slice(0, 10), level, best };
  }
  save.endlessBest = intIn(raw.endlessBest, 0, 1e8, 0);
  if (isObj(raw.resume)) {
    const r = raw.resume;
    const snap = {
      mode: oneOf(r.mode, RESUME_MODES, 'level'),
      seed: intIn(r.seed, 0, 0xffffffff, -1),
      level: intIn(r.level, 1, LEVELS.count, 0),
      startLevel: intIn(r.startLevel, 1, LEVELS.count, 0),
      lives: intIn(r.lives, 1, 3, 0),
      bank: intIn(r.bank, 0, 1e4, -1),
      restoresUsed: intIn(r.restoresUsed, 0, 4, -1),
      stagesCleared: intIn(r.stagesCleared, 0, 1e4, -1),
      totalScore: intIn(r.totalScore, 0, 1e8, -1),
    };
    const valid = snap.seed >= 0 && snap.level && snap.startLevel && snap.lives && snap.bank >= 0 && snap.restoresUsed >= 0 && snap.stagesCleared >= 0 && snap.totalScore >= 0;
    if (valid) save.resume = snap;
  }

  if (isObj(raw.settings)) {
    const s = raw.settings;
    save.settings.sound = bool(s.sound, true);
    save.settings.music = bool(s.music, true);
    save.settings.masterVol = vol(s.masterVol, 1);
    save.settings.sfxVol = vol(s.sfxVol, 1);
    save.settings.musicVol = vol(s.musicVol, 1);
    save.settings.reducedMotion = bool(s.reducedMotion, false);
    save.settings.quality = oneOf(s.quality, QUALITY_VALUES, 'auto');
    save.settings.renderer = oneOf(s.renderer, RENDERER_VALUES, 'auto');
    save.settings.difficulty = oneOf(s.difficulty, DIFFICULTY_VALUES, 'normal');
    save.settings.pointerFollow = bool(s.pointerFollow, true);
  }
  save.tutorialDone = bool(raw.tutorialDone, false);
  if (Array.isArray(raw.seenTypes)) save.seenTypes = [...new Set(raw.seenTypes.filter((t) => ITEM_TYPES.includes(t)))];
  save.theme = oneOf(raw.theme, THEMES, 'ice');
  return save;
}

function probeStorage(storage) {
  try {
    if (!storage) return null;
    const probe = '__avalanche_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export class SaveStore {
  /** @param {Storage|null} [storage] injectable for tests; defaults to window.localStorage. */
  constructor(storage) {
    let candidate = storage;
    if (candidate === undefined) {
      try {
        candidate = typeof localStorage !== 'undefined' ? localStorage : null;
      } catch {
        candidate = null;
      }
    }
    this.storage = probeStorage(candidate);
    this.persistent = !!this.storage;
    this.data = this._load();
  }

  _load() {
    if (!this.storage) return defaultSave();
    try {
      const text = this.storage.getItem(SAVE_KEY);
      if (!text) return defaultSave();
      return sanitizeSave(JSON.parse(text));
    } catch {
      return defaultSave();
    }
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.data = sanitizeSave(this.data);
    this.save();
  }

  bestScore(level) {
    return this.data.best[level] ?? 0;
  }

  starsFor(level) {
    return this.data.stars[level] ?? 0;
  }

  isUnlocked(level) {
    return level >= 1 && level <= this.data.unlockedLevel;
  }

  /** Records a finished campaign stage; returns { best, newBest, unlocked, stars }. */
  recordStage(level, score, won, stars = 0) {
    const prev = this.bestScore(level);
    const newBest = score > prev;
    if (newBest) this.data.best[level] = score;
    if (won && stars > this.starsFor(level)) this.data.stars[level] = Math.min(3, stars);
    let unlocked = null;
    if (won && level < LEVELS.count && this.data.unlockedLevel < level + 1) {
      this.data.unlockedLevel = level + 1;
      unlocked = level + 1;
    }
    this.save();
    return { best: Math.max(prev, score), newBest, unlocked, stars: this.starsFor(level) };
  }

  /** Adds a finished run to the local leaderboard (kept sorted, best first). */
  recordRun({ mode, level, score }) {
    if (!(score > 0)) return;
    const date = new Date().toISOString().slice(0, 10);
    this.data.scores.push({ mode, level, score, date });
    this.data.scores.sort((a, b) => b.score - a.score);
    this.data.scores = this.data.scores.slice(0, SCORE_LIMIT);
    this.save();
  }

  /** Records a daily-challenge result; a new date starts a fresh daily. */
  recordDaily(date, level, score) {
    const prev = this.data.daily?.date === date ? this.data.daily.best : 0;
    const best = Math.max(prev, score);
    this.data.daily = { date, level, best };
    this.save();
    return { best, newBest: score > prev };
  }

  recordEndless(total) {
    const newBest = total > this.data.endlessBest;
    if (newBest) this.data.endlessBest = total;
    this.save();
    return { best: this.data.endlessBest, newBest };
  }

  /** Saves a run snapshot so a reload can resume at the start of the current stage. */
  setResume(snapshot) {
    this.data.resume = snapshot;
    this.data = sanitizeSave(this.data);
    this.save();
  }

  clearResume() {
    if (!this.data.resume) return;
    this.data.resume = null;
    this.save();
  }

  setTheme(theme) {
    this.data.theme = THEMES.includes(theme) ? theme : this.data.theme;
    this.save();
  }

  setSelectedLevel(level) {
    this.data.selectedLevel = Math.min(this.data.unlockedLevel, Math.max(1, level));
    this.save();
  }

  markTutorialDone() {
    this.data.tutorialDone = true;
    this.save();
  }

  markSeen(type) {
    if (this.data.seenTypes.includes(type)) return false;
    this.data.seenTypes.push(type);
    this.save();
    return true;
  }

  /** Clears progress (unlocks, bests, stars, scores, hints) but keeps settings and terrain. */
  resetProgress() {
    const settings = { ...this.data.settings };
    const theme = this.data.theme;
    this.data = defaultSave();
    this.data.settings = settings;
    this.data.theme = theme;
    this.save();
  }
}
