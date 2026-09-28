// Trophies: unlock rules checked against simulation events plus a little run context.
// Pure logic, no DOM. The save (storage.js) keeps unlocked trophies and lifetime stats.
import { THEMES } from './config.js';
import { starRating } from './game/levels.js';

/**
 * Every trophy. `icon` is an item type (drawn as its rock) or a short glyph. Lifetime trophies
 * carry a `goal` and read their progress from the stats with `progress`.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-clear', title: 'Off the ledge', desc: 'Clear your first stage', icon: 'coin' },
  { id: 'untouchable', title: 'Untouchable', desc: 'Clear a stage without losing a heart', icon: '♥' },
  { id: 'perfectionist', title: 'Perfectionist', desc: 'Earn 3 stars on a campaign level', icon: '★' },
  { id: 'hot-streak', title: 'Hot streak', desc: 'Reach a 10-catch streak', icon: 'cash' },
  { id: 'on-fire', title: 'On fire', desc: 'Reach a 25-catch streak', icon: '✹' },
  { id: 'rainy-day', title: 'Rainy-day fund', desc: 'Bank 8 shields at once', icon: 'shield' },
  { id: 'comeback', title: 'Comeback', desc: 'Buy a heart back at the revive prompt, then clear the stage', icon: '↺' },
  { id: 'no-safety-net', title: 'No safety net', desc: 'Clear 5 stages in one run without a restore', icon: '⚑' },
  { id: 'demon-dancer', title: 'Demon dancer', desc: 'Let 10 demons fall past in one run', icon: 'demon' },
  { id: 'five-fold', title: 'Five-fold', desc: 'Score 500 points during one ×5', icon: 'mult5' },
  { id: 'shadow-crew', title: 'Shadow crew', desc: 'Catch 3 rocks with one set of shadow clones', icon: 'clone' },
  { id: 'split-decision', title: 'Split decision', desc: 'Catch both halves of a split rock', icon: 'split' },
  { id: 'magnetic', title: 'Magnetic', desc: 'Pull in 3 rocks with one magnet', icon: 'magnet' },
  { id: 'jackpot', title: 'Jackpot!', desc: 'Hit the jackpot with a ? rock', icon: 'mystery' },
  { id: 'world-traveller', title: 'World traveller', desc: 'Clear a stage on both Ice and Volcano', icon: '▲' },
  { id: 'weathered', title: 'Weathered', desc: 'Clear a windy stage', icon: '≋' },
  { id: 'fog-walker', title: 'Through the fog', desc: 'Clear a foggy stage', icon: '☁︎' },
  { id: 'gold-fever', title: 'Gold fever', desc: 'Clear a gold rush stage', icon: '✦' },
  { id: 'climber', title: 'Climber', desc: 'Clear level 10', icon: '10' },
  { id: 'mountaineer', title: 'Mountaineer', desc: 'Clear level 25', icon: '25' },
  { id: 'high-camp', title: 'High camp', desc: 'Clear level 50', icon: '50' },
  { id: 'summit', title: 'Summit', desc: 'Clear level 100', icon: '100' },
  { id: 'survivor', title: 'Survivor', desc: 'Reach wave 5 in Endless', icon: '∞' },
  { id: 'daily-grind', title: 'Daily grind', desc: 'Clear a Daily challenge', icon: '☀︎' },
  { id: 'hard-as-rock', title: 'Hard as rock', desc: 'Clear a stage on Hard', icon: '◆' },
  { id: 'gold-digger', title: 'Gold digger', desc: 'Catch 1,000 gold rocks', icon: 'coin', goal: 1000, progress: (s) => s.caught.coin || 0 },
  { id: 'fortune', title: 'Fortune', desc: 'Score 100,000 points in total', icon: '$', goal: 100000, progress: (s) => s.points },
]);

export const ACHIEVEMENT_IDS = Object.freeze(ACHIEVEMENTS.map((a) => a.id));
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
const LEVEL_TROPHIES = [['climber', 10], ['mountaineer', 25], ['high-camp', 50], ['summit', 100]];
const MODIFIER_TROPHIES = { windy: 'weathered', fog: 'fog-walker', goldRush: 'gold-fever' };

/** Lifetime counters shown on the trophy screen (also what the lifetime trophies read). */
export function emptyStats() {
  return {
    caught: {},
    points: 0,
    clears: 0,
    demonsDodged: 0,
    bestCombo: 0,
    bestWave: 0,
    jackpots: 0,
    playSeconds: 0,
    terrains: [],
  };
}

const freshStage = () => ({ revived: false, mult: 0, multPoints: 0, clonePulls: 0, magnetPulls: 0, halves: new Map() });

export class AchievementTracker {
  /** @param {{data: {achievements: object, stats: object}}} store the save (read live each time) */
  constructor(store) {
    this.store = store;
    this.runRef = null;
    this.run = { demonsDodged: 0 };
    this.stage = freshStage();
  }

  /**
   * Feeds one frame's simulation events. `ctx.run` is the live run object (a new object means
   * a new run); `ctx.difficulty` the selected difficulty. Returns the trophies these events
   * unlocked, in order.
   */
  onEvents(events, ctx = {}) {
    const out = [];
    if (ctx.run && ctx.run !== this.runRef) {
      this.runRef = ctx.run;
      this.run = { demonsDodged: 0 };
    }
    for (const e of events) this._event(e, ctx, out);
    return out;
  }

  _event(e, ctx, out) {
    const stats = this.store.data.stats;
    switch (e.type) {
      case 'stageStart':
        this.stage = freshStage();
        break;
      case 'catch':
        this._catch(e, out);
        break;
      case 'miss':
        if (e.itemType === 'demon') {
          stats.demonsDodged += 1;
          this.run.demonsDodged += 1;
          if (this.run.demonsDodged >= 10) this._unlock('demon-dancer', out);
        }
        break;
      case 'effectEnd':
        if (e.effect === 'multiplier') this.stage.mult = 0;
        break;
      case 'restore':
        if (e.fromRevive) this.stage.revived = true;
        break;
      case 'endlessLevelUp':
        stats.points += e.score || 0;
        stats.bestWave = Math.max(stats.bestWave, e.wave);
        if (e.wave >= 5) this._unlock('survivor', out);
        this._lifetime(out);
        break;
      case 'stageEnd':
        this._stageEnd(e, ctx, out);
        break;
      default:
        break;
    }
  }

  _catch(e, out) {
    const stats = this.store.data.stats;
    const st = this.stage;
    stats.caught[e.itemType] = (stats.caught[e.itemType] || 0) + 1;
    if (e.combo) stats.bestCombo = Math.max(stats.bestCombo, e.combo);
    if (e.combo >= 10) this._unlock('hot-streak', out);
    if (e.combo >= 25) this._unlock('on-fire', out);
    if (e.bank >= 8) this._unlock('rainy-day', out);
    if (e.effect === 'multiplier') {
      st.mult = e.multiplier;
      st.multPoints = 0;
    } else if (st.mult === 5 && e.score) {
      st.multPoints += e.score + (e.comboBonus || 0);
      if (st.multPoints >= 500) this._unlock('five-fold', out);
    }
    if (e.effect === 'clone') {
      if (!e.refreshed) st.clonePulls = 0;
    } else if (e.scoop) {
      st.clonePulls += 1;
      if (st.clonePulls >= 3) this._unlock('shadow-crew', out);
    }
    if (e.effect === 'magnet') {
      if (!e.refreshed) st.magnetPulls = 0;
    } else if (e.pulled) {
      st.magnetPulls += 1;
      if (st.magnetPulls >= 3) this._unlock('magnetic', out);
    }
    if (e.pair !== undefined) {
      const n = (st.halves.get(e.pair) || 0) + 1;
      st.halves.set(e.pair, n);
      if (n >= 2) this._unlock('split-decision', out);
    }
    if (e.reveal === 'jackpot') {
      stats.jackpots += 1;
      this._unlock('jackpot', out);
    }
    this._lifetime(out);
  }

  _stageEnd(e, ctx, out) {
    const stats = this.store.data.stats;
    stats.points += e.score || 0;
    if (e.result === 'won') {
      stats.clears += 1;
      this._unlock('first-clear', out);
      if (e.livesLost === 0) this._unlock('untouchable', out);
      if (e.mode === 'level' && starRating(true, e.score, e.reachable) === 3) this._unlock('perfectionist', out);
      if (this.stage.revived) this._unlock('comeback', out);
      if (e.mode === 'level' && ctx.run && ctx.run.restoresUsed === 0 && ctx.run.stagesCleared >= 5) this._unlock('no-safety-net', out);
      if (e.terrain && !stats.terrains.includes(e.terrain)) stats.terrains.push(e.terrain);
      if (THEMES.every((t) => stats.terrains.includes(t))) this._unlock('world-traveller', out);
      if (MODIFIER_TROPHIES[e.modifier]) this._unlock(MODIFIER_TROPHIES[e.modifier], out);
      if (ctx.difficulty === 'hard') this._unlock('hard-as-rock', out);
      if (e.mode === 'daily') this._unlock('daily-grind', out);
      if (e.mode === 'level') for (const [id, level] of LEVEL_TROPHIES) if (e.level >= level) this._unlock(id, out);
    }
    this._lifetime(out);
  }

  _lifetime(out) {
    const stats = this.store.data.stats;
    for (const a of ACHIEVEMENTS) if (a.goal && a.progress(stats) >= a.goal) this._unlock(a.id, out);
  }

  _unlock(id, out) {
    const got = this.store.data.achievements;
    if (got[id]) return;
    got[id] = new Date().toISOString().slice(0, 10);
    out.push(BY_ID[id]);
  }
}
