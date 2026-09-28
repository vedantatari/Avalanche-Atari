// App controller: wires simulation, loop, input, renderer, audio, storage, and UI together.
import { MODES, PHASE, Simulation } from './game/simulation.js';
import { FixedStepLoop } from './game/loop.js';
import { clampLevel, levelTerrain, setDifficultyMode, starRating } from './game/levels.js';
import { ITEM_TYPES, isNegative } from './game/items.js';
import { hashSeed, randomSeed } from './game/rng.js';
import { InputState } from './input/input-state.js';
import { InputController } from './input/input.js';
import { SaveStore } from './storage.js';
import { AchievementTracker } from './achievements.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { computeLayout } from './render/layout.js';
import { loadImages } from './render/assets.js';
import { Renderer2D } from './render/renderer-2d.js';
import { CART_TIERS, cartTier } from './render/appearance.js';
import { DEMO_PARTS, DEMO_TRANSITION_SECONDS } from './game/demo.js';
import { QUALITY, UI as UI_TIMING } from './config.js';
import { installDebug } from './debug.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
/** Dev/test facility: only active with ?debug in the URL, never shown in the player UI. */
const DEBUG = params.has('debug');
const QUALITY_ORDER = ['high', 'medium', 'low'];
const TOUCH_VIEW_HEIGHT = 600;
/** First-encounter hints, keyed by item type, stage modifier, or 'terrain:<id>'. */
const HINTS = {
  demon: 'DEMON! Touch it and the run ends — no hearts, no shields',
  shrink: 'New: coral − rock shrinks your scoop 5s',
  reverse: 'New: whiskey bottle flips your controls 5s',
  mult2: 'New: ×2 rock doubles your points for 5s',
  mult3: 'New: ×3 rock triples your points for 5s',
  mult5: 'New: ×5 rock — five times the points for 5s',
  clone: 'New: shadow rock adds two clone carts for 5s',
  split: 'New: split rock breaks in two — catch both halves',
  magnet: 'New: magnet pulls good rocks into your scoop for 5s',
  mystery: 'New: ? rock — a surprise, good or bad, never a lost heart',
  frost: 'New: frost rock freezes your wheels — half speed for 4s',
  windy: 'Windy stage: every rock drifts with the wind — follow the arrows',
  fog: 'Foggy stage: rocks show what they are only below the fog',
  goldRush: 'Gold rush: extra gold and emeralds — and extra fire',
  storm: 'Ice storms! Leave the flashing zone before the lightning strikes',
  eruption: 'Lava eruptions! Leave the glowing zone — the lava burns a heart',
  'terrain:ice': 'Ice: slippery rail — the cart glides on after you let go',
  'terrain:volcano': 'Volcano: heat vents push some rocks sideways — watch the arrows',
};
const EFFECT_SOUND = {
  coin: 'coin',
  cash: 'cash',
  shield: 'shield',
  expand: 'expand',
  shrink: 'shrink',
  reverse: 'reverse',
  mult2: 'multiplier',
  mult3: 'multiplier',
  mult5: 'multiplier',
  clone: 'clone',
  split: 'coin',
  magnet: 'magnet',
  frost: 'frost',
};
const EFFECT_END = {
  reverse: 'Controls back to normal',
  multiplier: 'Points multiplier over',
  clone: 'Shadow clones gone',
  magnet: 'Magnet off',
  frost: 'Wheels thawed out',
};
/** Vibration patterns (ms). Kept short: haptics confirm, they never distract. */
const HAPTICS = {
  good: 8,
  combo: [12, 40, 18],
  bad: 35,
  fire: 60,
  demon: [90, 60, 150],
  split: 6,
  win: [20, 60, 20, 60, 45],
  lose: 120,
  trophy: [15, 50, 15, 50, 30],
  revive: 70,
};

class App {
  constructor() {
    this.store = new SaveStore();
    const s = this.store.settings;
    setDifficultyMode(s.difficulty);
    this.trophies = new AchievementTracker(this.store);
    this.stageTrophies = [];
    this.installPrompt = null;
    this.lastHaptic = 0;
    this.selectedLevel = this.store.data.selectedLevel === 0 ? 0 : clampLevel(Math.min(this.store.data.selectedLevel, this.store.data.unlockedLevel));
    this.theme = levelTerrain(this.selectedLevel);
    this.activeTheme = this.theme;
    const duration = DEBUG ? Number(params.get('duration')) || null : null;
    this.sim = new Simulation({ durationOverride: duration });
    this.inputState = new InputState();
    this.audio = new AudioEngine({ sound: s.sound, music: s.music, masterVol: s.masterVol, sfxVol: s.sfxVol, musicVol: s.musicVol });
    this.audio.theme = this.theme;
    this.ui = new UI(this);
    this.renderer = null;
    this.fallbackReason = null;
    this.layout = null;
    this.introLeft = 0;
    this.realTime = 0;
    this.orientation = null;
    this.view = { scale: 1, rot: false, key: '' };
    this.pendingStart = null;
    this.resultTimer = 0;
    this.perf = { samples: [], cooldown: 3, fps: 0 };
    this.activeQuality = this._initialQuality();
    this.loop = new FixedStepLoop({
      step: () => this.sim.tick(this.inputState.sample()),
      render: (alpha, dt) => this.frame(alpha, dt),
      shouldStep: () => this.sim.phase === PHASE.PLAYING,
    });
  }

  _initialQuality() {
    const q = this.store.settings.quality;
    if (q !== 'auto') return q;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    return coarse || Math.min(screen.width, screen.height) < 700 ? 'medium' : 'high';
  }

  async init() {
    this.ui.setLoading(true);
    this.input = new InputController(this.inputState, {
      playfield: $('scene'),
      pxPerUnit: () => this.layout?.pxPerUnit || 30,
      localX: (el, e) => this.localPoint(el, e.clientX, e.clientY).x,
      worldX: (x) => (this.layout ? this.layout.toWorld(x, 0).x : NaN),
      followEnabled: () => this.store.settings.pointerFollow,
      isActive: () => this.sim.phase === PHASE.PLAYING && !this.ui.anyOpen,
      onPause: () => this.onPauseKey(),
      onRestore: () => this.requestRestore(),
      onBlur: () => this.autoPause('blur'),
      onGesture: () => this.audio.unlock(),
    });
    document.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.autoPause('hidden');
        this.audio.suspend();
        this.store.save();
      } else if (this.sim.phase !== PHASE.PAUSED && this.sim.phase !== PHASE.REVIVE) {
        this.audio.resume();
      }
      this.loop.resetClock();
    });

    const onFullscreenChange = () => {
      const active = this.isFullscreen();
      this.ui.refreshFullscreen(this.fullscreenSupported(), active);
      if (active) this._lockLandscape();
      // Leaving full screen (often via Esc, which the browser keeps for itself) pauses play.
      if (!active && this.wasFullscreen) this.autoPause('fullscreen');
      this.wasFullscreen = active;
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.toggleFullscreen();
      }
    });
    this.ui.refreshFullscreen(this.fullscreenSupported(), this.isFullscreen());

    await this.createRenderer();
    const observer = new ResizeObserver(() => this.relayout());
    observer.observe($('frame'));
    window.addEventListener('orientationchange', () => setTimeout(() => this.relayout(), 50));
    window.addEventListener('resize', () => this.relayout());
    this.relayout();
    this.buildPreviews();
    this.ui.setLoading(false);
    this.ui.showMenu();
    this.loop.start();
    this._installPwa();
    if (DEBUG) installDebug(this, params);
  }

  /** Offline play (service worker) and the browser's "install app" prompt, where supported. */
  _installPwa() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.info('[avalanche] offline play unavailable:', err?.message || err));
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      this.ui.refreshInstall(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.ui.refreshInstall(false);
      this.ui.toast('Installed — Avalanche now opens like an app', 'good');
    });
  }

  async installApp() {
    const prompt = this.installPrompt;
    if (!prompt) return;
    this.installPrompt = null;
    this.ui.refreshInstall(false);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      /* the browser may refuse; the button simply stays hidden */
    }
  }

  // ------------------------------------------------------------------ renderer & layout

  async createRenderer(preference) {
    const pref = (DEBUG && params.get('renderer')) || preference || this.store.settings.renderer;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    const scene = $('scene');
    const opts = {
      images: await loadImages(),
      quality: this.activeQuality,
      reducedMotion: this.store.settings.reducedMotion,
      onContextLost: () => this.onContextLost(),
      onContextRestored: () => this.onContextRestored(),
    };
    this.fallbackReason = null;
    if (pref !== '2d') {
      try {
        const { Renderer3D } = await import('./render/three/renderer-3d.js');
        this.renderer = new Renderer3D(scene, opts);
      } catch (err) {
        console.warn('[avalanche] 3D renderer unavailable, using the 2D fallback.', err?.message || err);
        this.fallbackReason = 'webgl';
        scene.querySelectorAll('canvas').forEach((c) => c.remove());
      }
    } else {
      this.fallbackReason = 'chosen';
    }
    if (!this.renderer) this.renderer = new Renderer2D(scene, opts);
    this.renderer.setReducedMotion(this.store.settings.reducedMotion);
    this.renderer.setQuality(this.activeQuality);
    this.renderer.setTheme(this.activeTheme);
    this.renderer.setCartTier(this.cartChoice());
    if (this.layout) this.renderer.resize(this.layout);
  }

  buildPreviews() {
    const safe = (fn) => {
      try {
        return fn();
      } catch (err) {
        console.warn('[avalanche] preview failed', err);
        return '';
      }
    };
    const icons = {};
    for (const t of ITEM_TYPES) icons[t] = safe(() => this.renderer.itemIconDataURL(t, 128));
    this.ui.buildLegend(icons);
  }

  _fitView() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const touch = !!window.matchMedia?.('(pointer: coarse)').matches;
    const rot = touch && h > w;
    const short = rot ? w : h;
    const scale = touch ? Math.min(1, short / TOUCH_VIEW_HEIGHT) : 1;
    const key = `${w}x${h}:${rot}:${scale}`;
    if (key === this.view.key) return;
    this.view = { scale, rot, key };
    const page = $('page');
    if (!rot && scale === 1) {
      page.removeAttribute('style');
      return;
    }
    const s = page.style;
    s.width = `${(rot ? h : w) / scale}px`;
    s.height = `${short / scale}px`;
    s.transformOrigin = '0 0';
    s.transform = `${rot ? `translateX(${w}px) rotate(90deg) ` : ''}scale(${scale})`;
    const sides = rot ? ['right', 'bottom', 'left', 'top'] : ['top', 'right', 'bottom', 'left'];
    ['t', 'r', 'b', 'l'].forEach((k, i) => s.setProperty(`--safe-${k}`, `calc(env(safe-area-inset-${sides[i]}, 0px) / ${scale})`));
  }

  localPoint(el, x, y) {
    const r = el.getBoundingClientRect();
    const { scale, rot } = this.view;
    return rot ? { x: (y - r.top) / scale, y: (r.right - x) / scale } : { x: (x - r.left) / scale, y: (y - r.top) / scale };
  }

  relayout() {
    this._fitView();
    const frame = $('frame');
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (width < 2 || height < 2) return;
    const insets = this.ui.applyHudMode(width, height);
    this.layout = computeLayout(width, height, insets);
    this.layout.scale = this.view.scale;
    this.renderer?.resize(this.layout);
    const orientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
    if (this.orientation && orientation !== this.orientation) this.autoPause('rotate');
    this.orientation = orientation;
  }

  // ------------------------------------------------------------------ frame

  frame(alpha, frameDt) {
    this.realTime += frameDt;
    if (this.sim.phase === PHASE.PLAYING) this.store.stats.playSeconds += frameDt;
    const events = this.sim.drainEvents();
    if (events.length) this.handleEvents(events);

    if (this.sim.phase === PHASE.INTRO && !this.ui.anyOpen) {
      this.introLeft -= frameDt;
      if (this.introLeft <= 0) {
        this.ui.hideIntro();
        this.sim.beginPlay();
        this.loop.resetClock();
      }
    }

    const paused = this.sim.phase === PHASE.PAUSED || this.sim.phase === PHASE.REVIVE;
    const st = this.sim.stage;
    const demoLeft = st?.practice ? DEMO_PARTS.slice(st.demoPart + 1).reduce((sum, p) => sum + p.seconds, 0) : 0;
    const held = paused || (this.sim.phase === PHASE.INTRO && st?.demoPart > 0);
    this.audio.updateMusic(this.sim.phase === PHASE.PLAYING ? 'play' : held ? 'hold' : 'stop', this.sim.timeRemaining + demoLeft);
    if (st?.practice && this.sim.phase === PHASE.PLAYING) {
      const caps = st.schedule.captions;
      while (this.captionIdx < caps.length && caps[this.captionIdx][0] <= this.sim.time) this.ui.toast(caps[this.captionIdx++][1], 'hint', 2.4);
    }
    this.renderer.render({ sim: this.sim, alpha, frameDt, time: this.realTime, paused });
    const cart = this.sim.cart;
    const cartX = cart ? cart.prevX + (cart.x - cart.prevX) * alpha : 0;
    this.ui.updateHud(this.sim, cartX);
    this._monitorPerf(frameDt);
  }

  handleEvents(events) {
    this.renderer.handleEvents(events);
    const ctx = { run: this.sim.run, difficulty: this.store.settings.difficulty };
    for (const e of events) {
      const unlocked = this.sim.run?.mode === MODES.DEMO ? [] : this.trophies.onEvents([e], ctx);
      if (unlocked.length) this._onTrophies(unlocked, e.type === 'stageEnd');
      switch (e.type) {
        case 'stageStart':
          this.ui.clearToasts();
          this.stageTrophies = [];
          this.captionIdx = 0;
          if (e.mode !== MODES.DEMO) this._snapshotRun(e.level);
          this._hint(e.terrain && `terrain:${e.terrain}`);
          this._hint(e.modifier);
          this._hint(e.storm && (e.terrain === 'volcano' ? 'eruption' : 'storm'));
          this._showTheme(e.terrain || this.activeTheme);
          this.renderer.setCartTier(e.mode === MODES.DEMO ? CART_TIERS.length - 1 : this.cartChoice());
          if (e.demoPart > 0) {
            this.ui.showIntro(0, null, e.duration, MODES.DEMO, { terrain: e.terrain });
            this.introLeft = DEMO_TRANSITION_SECONDS;
          }
          if (e.mode === MODES.LEVEL && e.level > 1 && (e.level - 1) % 5 === 0) this.ui.toast('Speed up!', 'good');
          break;
        case 'endlessLevelUp':
          this.audio.play('target');
          this.ui.toast(`Wave ${e.wave} — faster now!`, 'good');
          this.ui.announce(`Wave ${e.wave}. Total score ${e.total}.`);
          break;
        case 'catch':
          this._onCatch(e);
          break;
        case 'split':
          this.audio.play('split');
          this._haptic('split');
          break;
        case 'targetReached':
          this.audio.play('target');
          this.ui.toast('Target reached — survive!', 'good');
          this.ui.announce('Target reached. Survive until the timer ends.');
          break;
        case 'crack':
          this.audio.play('crack');
          this._hint(e.itemType);
          break;
        case 'ground':
          this.audio.play('ground');
          break;
        case 'effectEnd':
          this.ui.announce(EFFECT_END[e.effect] || 'Scoop back to normal');
          break;
        case 'revivePrompt':
          this.input.clear();
          this.audio.play('damage');
          this._haptic('revive');
          this.ui.showRevive(e);
          break;
        case 'restore':
          this.audio.play('revive');
          this.ui.announce(`Heart restored. ${e.lives} hearts.`);
          if (e.fromRevive) {
            this.ui.close('ov-revive');
            this.loop.resetClock();
          }
          break;
        case 'stormWarn':
          this.audio.play(this.sim.stage?.terrain === 'volcano' ? 'eruptWarn' : 'stormWarn');
          break;
        case 'stormStrike':
          this.audio.play(this.sim.stage?.terrain === 'volcano' ? 'eruption' : 'thunder');
          break;
        case 'stormHit':
          this.audio.play(this.sim.stage?.terrain === 'volcano' ? 'eruption' : 'thunder');
          this.audio.play('damage');
          this._haptic(e.damage ? 'fire' : 'demon');
          this.ui.heartHit();
          this.ui.announce(e.damage ? `${this.sim.stage?.terrain === 'volcano' ? 'Burned by the lava' : 'Frozen by the storm'}! ${e.lives} heart${e.lives === 1 ? '' : 's'} left.` : 'Caught in the ice storm! The run is over.');
          break;
        case 'stageEnd':
          this._onStageEnd(e);
          break;
        default:
          break;
      }
    }
  }

  _onCatch(e) {
    if (e.itemType === 'demon' && e.fatal) {
      this.audio.play('damage');
      this._haptic('demon');
      this.ui.heartHit();
      this.ui.announce('A demon! The run is over.');
      return;
    }
    if (e.itemType === 'fire' || e.itemType === 'demon') {
      if (e.blocked) {
        this.audio.play('blocked');
        return;
      }
      this.audio.play('damage');
      this._haptic('fire');
      this.ui.heartHit();
      this.ui.announce(e.itemType === 'demon' ? 'A demon! In a real level that ends the run.' : `Fire rock! ${e.lives} heart${e.lives === 1 ? '' : 's'} left.`);
      return;
    }
    // A mystery rock behaves as whatever it revealed.
    const acts = e.reveal && e.reveal !== 'jackpot' ? e.reveal : e.itemType;
    if (e.itemType === 'mystery') this.audio.play(e.reveal === 'jackpot' ? 'jackpot' : 'mystery');
    if (EFFECT_SOUND[acts]) this.audio.play(EFFECT_SOUND[acts]);
    this._haptic(e.comboBonus || e.reveal === 'jackpot' ? 'combo' : isNegative(acts) ? 'bad' : 'good');
    if (e.comboBonus) {
      this.audio.play('multiplier');
      this.ui.announce(`Combo ${e.combo}! Bonus ${e.comboBonus} points.`);
    }
    if (e.reveal === 'jackpot') this.ui.announce(`Jackpot! ${e.score} points.`);
    else if (e.effect === 'expand') this.ui.announce('Wide scoop for 5 seconds');
    else if (e.effect === 'shrink') this.ui.announce('Narrow scoop for 5 seconds');
    else if (e.effect === 'reverse') this.ui.announce('Whiskey! Controls reversed for 5 seconds');
    else if (e.effect === 'multiplier') this.ui.announce(`Points times ${e.multiplier} for 5 seconds`);
    else if (e.effect === 'clone') this.ui.announce('Shadow clones for 5 seconds');
    else if (e.effect === 'magnet') this.ui.announce('Magnet! Good rocks are pulled in for 5 seconds');
    else if (e.effect === 'frost') this.ui.announce('Frozen wheels! Half speed for 4 seconds');
    else if (acts === 'shield') this.ui.announce(`Shield banked. Bank ${e.bank}.`);
  }

  /** New trophies: saved at once; a toast mid-stage, the result card at a stage end. */
  _onTrophies(list, atStageEnd) {
    this.store.save();
    this.stageTrophies.push(...list);
    this.audio.play('trophy');
    this._haptic('trophy');
    for (const a of list) {
      if (!atStageEnd) this.ui.toast(`🏆 Trophy: ${a.title}`, 'trophy', 3);
      this.ui.announce(`Trophy unlocked: ${a.title}. ${a.desc}.`);
    }
  }

  /** Shows a first-encounter hint once per save (items, stage modifiers, terrains). */
  _hint(key) {
    if (this.sim.run?.mode === MODES.DEMO) return;
    if (key && HINTS[key] && this.store.markSeen(key)) this.ui.toast(HINTS[key], 'hint', 3.4);
  }

  _stars(e) {
    return starRating(e.result === 'won', e.score, e.reachable);
  }

  _onStageEnd(e) {
    this.input.clear();
    const won = e.result === 'won';
    const result = { ...e };
    if (e.mode === MODES.DEMO) {
      Object.assign(result, { best: null, newBest: false, unlocked: null, stars: 0 });
    } else if (e.mode === MODES.ENDLESS) {
      this.store.clearResume();
      const rec = this.store.recordEndless(e.total);
      this.store.recordRun({ mode: 'endless', level: e.level, score: e.total });
      Object.assign(result, { best: rec.best, newBest: rec.newBest, unlocked: null, stars: 0 });
    } else if (e.mode === MODES.DAILY) {
      const rec = this.store.recordDaily(this.dailyDate(), e.level, e.score);
      this.store.recordRun({ mode: 'daily', level: e.level, score: e.score });
      Object.assign(result, { best: rec.best, newBest: rec.newBest, unlocked: null, stars: this._stars(e) });
    } else {
      const stars = this._stars(e);
      const rec = this.store.recordStage(e.level, e.score, won, stars);
      // Snapshot the run for "Resume": a win continues at the next level, a loss ends it.
      if (won && !e.finalLevel) this._snapshotRun(e.level + 1);
      else this.store.clearResume();
      if (!won || e.finalLevel) this.store.recordRun({ mode: 'level', level: e.level, score: e.total });
      if (won) this.selectLevel(e.finalLevel ? e.level : e.level + 1, { quiet: true });
      Object.assign(result, { best: rec.best, newBest: rec.newBest, unlocked: rec.unlocked, stars });
      if (rec.unlocked && cartTier(rec.unlocked) > cartTier(rec.unlocked - 1)) this.store.setCart(null);
    }
    result.trophies = [...this.stageTrophies];
    this.audio.play(won ? 'win' : 'lose');
    if (e.reason !== 'demon' && e.reason !== 'storm') this._haptic(won ? 'win' : 'lose');
    clearTimeout(this.resultTimer);
    // A demon loss holds the card back a little longer so the blast plays out first.
    this.resultTimer = setTimeout(() => {
      if (this.sim.phase !== PHASE.ENDED) return;
      this.ui.showResult(result);
    }, e.reason === 'demon' || e.reason === 'storm' ? 1300 : 750);
  }

  /** Saves the running state so a reload (or quitting to the menu) can resume this stage. */
  _snapshotRun(level) {
    const run = this.sim.run;
    if (!run || run.mode === MODES.DAILY) return;
    this.store.setResume({
      mode: run.mode,
      seed: run.seed,
      level,
      startLevel: run.startLevel,
      lives: run.lives,
      bank: run.bank,
      restoresUsed: run.restoresUsed,
      stagesCleared: run.stagesCleared,
      totalScore: run.totalScore,
    });
  }

  /** Vibration feedback (phones that support it, when enabled); rapid catch pulses are thinned out. */
  _haptic(kind) {
    if (!this.store.settings.haptics || !HAPTICS[kind]) return;
    const now = performance.now();
    if ((kind === 'good' || kind === 'split') && now - this.lastHaptic < 60) return;
    this.lastHaptic = now;
    try {
      navigator.vibrate?.(HAPTICS[kind]);
    } catch {
      /* haptics are best-effort */
    }
  }

  // ------------------------------------------------------------------ flow

  play() {
    this.startLevel(this.selectedLevel);
  }

  cartChoice() {
    const max = cartTier(this.store.data.unlockedLevel);
    const pick = this.store.data.cart;
    return Number.isInteger(pick) && pick <= max ? pick : max;
  }

  selectCart(tier) {
    if (tier > cartTier(this.store.data.unlockedLevel)) return;
    this.store.setCart(tier);
    this.renderer.setCartTier(tier);
    this.ui.refreshMenu();
  }

  selectLevel(level, { quiet = false } = {}) {
    this.selectedLevel = level <= 0 ? 0 : Math.min(this.store.data.unlockedLevel, clampLevel(level));
    this.store.setSelectedLevel(this.selectedLevel);
    this.theme = levelTerrain(this.selectedLevel);
    if (this.renderer && this.sim.phase === PHASE.IDLE) this._showTheme(this.theme);
    if (!quiet) this.ui.refreshMenu();
  }

  startDemo() {
    this._showTheme(levelTerrain(0));
    this.sim.startRun(0, { seed: this._seed(), mode: MODES.DEMO, terrain: 'auto' });
    this._beginIntro();
  }

  startLevel(level) {
    if (level === 0) return this.startDemo();
    level = clampLevel(level);
    if (!this.store.isUnlocked(level)) return;
    this.selectLevel(level, { quiet: true });
    if (!this.store.data.tutorialDone) {
      this.pendingStart = level;
      this.ui.showHowto(true);
      return;
    }
    this._showTheme(levelTerrain(level));
    this.sim.startRun(level, { seed: this._seed(), terrain: 'auto' });
    this._beginIntro();
  }

  tutorialDone() {
    this.store.markTutorialDone();
    if (this.pendingStart) {
      const level = this.pendingStart;
      this.pendingStart = null;
      this.startLevel(level);
    }
  }

  _seed() {
    return DEBUG && params.get('seed') ? Number(params.get('seed')) >>> 0 : randomSeed();
  }

  _lockLandscape() {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    try {
      screen.orientation?.lock?.('landscape')?.catch?.(() => {});
    } catch {
      return;
    }
  }

  _beginIntro() {
    this._lockLandscape();
    clearTimeout(this.resultTimer);
    this.ui.closeAll();
    this.ui.clearToasts();
    this.input.clear();
    const st = this.sim.stage;
    this.ui.showIntro(st.level, st.target, st.duration, this.sim.run?.mode, { terrain: st.terrain, modifier: st.modifier });
    this.introLeft = UI_TIMING.introSeconds;
    this.audio.unlock();
    this.audio.resume();
    this.loop.resetClock();
  }

  nextLevel() {
    if (this.sim.run?.mode === MODES.DEMO) return this.startLevel(1);
    if (this.sim.continueRun()) this._beginIntro();
  }

  retry() {
    // A daily retry replays the same seeded stage; other modes reroll.
    const daily = this.sim.run?.mode === MODES.DAILY;
    if (this.sim.retry(daily ? {} : { seed: this._seed() })) this._beginIntro();
  }

  /** Endless mode: waves of rising level numbers, no targets, score until the run ends. */
  startEndless() {
    this._showTheme(levelTerrain(1));
    this.sim.startRun(1, { seed: this._seed(), mode: MODES.ENDLESS, terrain: 'auto' });
    this._beginIntro();
  }

  /** Local date the daily challenge keys on. */
  dailyDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Everyone gets the same seeded stage on a given day: the level and the terrain (whose rule
   * shapes the stage) vary day by day, so scores stay comparable.
   */
  dailyInfo() {
    const date = this.dailyDate();
    const level = 8 + (hashSeed('daily-level', date) % 25);
    return { date, level, seed: hashSeed('daily', date), terrain: levelTerrain(level) };
  }

  startDaily() {
    const { level, seed, terrain } = this.dailyInfo();
    this._showTheme(terrain);
    this.sim.startRun(level, { seed, mode: MODES.DAILY, terrain: 'auto' });
    this._beginIntro();
  }

  /** Restarts a saved run at the beginning of the stage it was on (on the current terrain). */
  resumeSavedRun() {
    const snap = this.store.data.resume;
    if (!snap || this.sim.phase !== PHASE.IDLE) return;
    this._showTheme(levelTerrain(snap.level));
    this.sim.resumeRun(snap, { terrain: 'auto' });
    this._beginIntro();
  }

  toMenu() {
    clearTimeout(this.resultTimer);
    this.sim.quit();
    this.input.clear();
    this.audio.resume();
    this.store.save();
    this._showTheme(this.theme);
    this.ui.clearToasts();
    this.ui.showMenu();
  }

  /** Puts a terrain on screen without changing the player's saved choice (the daily's own terrain). */
  _showTheme(id) {
    if (id === this.activeTheme) return;
    this.activeTheme = id;
    this.renderer.setTheme(id);
    this.audio.setTheme(id);
  }

  fullscreenSupported() {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /** Browser full screen for the whole page (needs a user gesture: click or key press). */
  toggleFullscreen() {
    if (!this.fullscreenSupported()) return;
    const doc = document;
    const root = doc.documentElement;
    const entering = !this.isFullscreen();
    // Change events can arrive only after a quick enter-then-exit has already happened, when
    // both read "not full screen"; recording the entry now keeps that exit pausing play.
    if (entering) this.wasFullscreen = true;
    try {
      const result = entering
        ? (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' })
        : (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      result?.catch?.((err) => {
        this.wasFullscreen = this.isFullscreen();
        console.warn('[avalanche] full screen request refused', err?.message || err);
      });
    } catch (err) {
      this.wasFullscreen = this.isFullscreen();
      console.warn('[avalanche] full screen unavailable', err?.message || err);
    }
  }

  onPauseKey() {
    const top = this.ui.stack[this.ui.stack.length - 1];
    if (this.sim.phase === PHASE.PLAYING || this.sim.phase === PHASE.INTRO) this.pause();
    else if (this.sim.phase === PHASE.PAUSED && top === 'ov-pause') this.resume();
  }

  togglePause() {
    if (this.sim.phase === PHASE.PAUSED) this.resume();
    else this.pause();
  }

  pause(note) {
    if (!this.sim.pause()) return false;
    this.input.clear();
    this.audio.suspend();
    this.store.save();
    this.ui.showPause(note);
    return true;
  }

  autoPause(reason) {
    this.input?.clear();
    const notes = {
      rotate: 'Screen rotated — resume when you are ready.',
      hidden: 'Paused while the game was in the background.',
      blur: 'Paused because the window lost focus.',
      fullscreen: 'Left full screen — resume when you are ready.',
      context: 'Graphics were interrupted.',
    };
    if (this.sim.phase === PHASE.PLAYING || this.sim.phase === PHASE.INTRO) this.pause(notes[reason]);
  }

  resume() {
    if (this.sim.phase !== PHASE.PAUSED) return;
    this.ui.closeAll();
    this.sim.resume();
    this.input.clear();
    this.loop.resetClock();
    this.audio.resume();
  }

  requestRestore() {
    if (this.sim.phase !== PHASE.PLAYING) return;
    if (!this.sim.restore()) {
      this.ui.flashRestoreNote();
      this.audio.play('blocked');
    }
  }

  acceptRevive() {
    if (this.sim.restore()) {
      this.ui.close('ov-revive');
      this.input.clear();
      this.loop.resetClock();
    }
  }

  declineRevive() {
    this.ui.close('ov-revive');
    this.sim.declineRevive();
  }

  async setSetting(key, value) {
    this.store.setSetting(key, value);
    const s = this.store.settings;
    if (key === 'sound') this.audio.setSound(s.sound);
    if (key === 'music') this.audio.setMusic(s.music);
    if (key === 'masterVol') this.audio.setVolume('master', s.masterVol);
    if (key === 'sfxVol') this.audio.setVolume('sfx', s.sfxVol);
    if (key === 'musicVol') this.audio.setVolume('music', s.musicVol);
    if (key === 'difficulty') {
      // Applies from the next generated stage; menus re-read the preview targets.
      setDifficultyMode(s.difficulty);
      this.ui.refreshMenu();
    }
    if (key === 'reducedMotion') this.renderer.setReducedMotion(s.reducedMotion);
    if (key === 'quality') {
      this.activeQuality = this._initialQuality();
      this.perf.samples = [];
      this.renderer.setQuality(this.activeQuality);
    }
    if (key === 'renderer') await this.switchRenderer(s.renderer, { persist: false });
    this.ui.refreshSettings();
  }

  async switchRenderer(pref, { persist = false } = {}) {
    if (persist) this.store.setSetting('renderer', pref);
    this.ui.setLoading(true);
    await this.createRenderer(pref);
    this.relayout();
    this.buildPreviews();
    this.ui.setLoading(false);
    if (this.ui.isOpen('ov-context')) {
      this.ui.close('ov-context');
      if (this.sim.phase === PHASE.PAUSED && !this.ui.isOpen('ov-pause')) this.ui.showPause();
    }
    this.ui.refreshMenu();
  }

  resetProgress() {
    this.store.resetProgress();
    this.selectLevel(1);
    this.ui.refreshMenu();
  }

  onOverlayChange() {
    if (this.ui.anyOpen) this.input?.clear();
  }

  onContextLost() {
    this.autoPause('context');
    this.ui.showContextLost();
  }

  onContextRestored() {
    if (this.ui.isOpen('ov-context')) this.ui.close('ov-context');
    this.renderer.resize(this.layout);
  }

  contextRetry() {
    if (this.renderer.lost) {
      this.ui.toast('Still waiting for the graphics to come back…');
      return;
    }
    this.ui.close('ov-context');
  }

  _monitorPerf(dt) {
    if (!(dt > 0) || document.hidden) return;
    const p = this.perf;
    p.samples.push(dt * 1000);
    if (p.samples.length > QUALITY.adaptive.sampleFrames) p.samples.shift();
    p.cooldown -= dt;
    p.hold = (p.hold || 0) - dt;
    const avg = p.samples.reduce((a, b) => a + b, 0) / p.samples.length;
    p.fps = 1000 / avg;
    if (this.store.settings.quality !== 'auto' || p.samples.length < QUALITY.adaptive.sampleFrames || p.cooldown > 0) return;
    if (avg > QUALITY.adaptive.downgradeMs) {
      const i = QUALITY_ORDER.indexOf(this.activeQuality);
      if (i < QUALITY_ORDER.length - 1) {
        this.activeQuality = QUALITY_ORDER[i + 1];
        this.renderer.setQuality(this.activeQuality);
        console.info(`[avalanche] frame time ${avg.toFixed(1)} ms: graphics quality lowered to ${this.activeQuality}`);
      }
      p.samples = [];
      p.cooldown = QUALITY.adaptive.cooldownSeconds;
      p.hold = QUALITY.adaptive.holdSeconds;
    } else if (avg < QUALITY.adaptive.upgradeMs && p.hold <= 0) {
      // Cheap frames for a full sample window: step back up toward the device's ceiling, so
      // a one-off stall (GC pause, alt-tab) never pins quality low for the whole session.
      const i = QUALITY_ORDER.indexOf(this.activeQuality);
      const ceiling = QUALITY_ORDER.indexOf(this._initialQuality());
      if (i > ceiling) {
        this.activeQuality = QUALITY_ORDER[i - 1];
        this.renderer.setQuality(this.activeQuality);
        console.info(`[avalanche] frame time ${avg.toFixed(1)} ms: graphics quality restored to ${this.activeQuality}`);
      }
      p.samples = [];
      p.cooldown = QUALITY.adaptive.cooldownSeconds;
    }
  }
}

const app = new App();
app.init().catch((err) => {
  console.error('[avalanche] failed to start', err);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = '<span>Could not start the game. Please reload.</span>';
});
