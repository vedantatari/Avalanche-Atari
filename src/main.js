// App controller: wires simulation, loop, input, renderer, audio, storage, and UI together.
import { MODES, PHASE, Simulation } from './game/simulation.js';
import { FixedStepLoop } from './game/loop.js';
import { clampLevel, setDifficultyMode } from './game/levels.js';
import { ITEM_TYPES } from './game/items.js';
import { hashSeed, randomSeed } from './game/rng.js';
import { InputState } from './input/input-state.js';
import { InputController } from './input/input.js';
import { SaveStore } from './storage.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { computeLayout } from './render/layout.js';
import { loadImages } from './render/assets.js';
import { Renderer2D } from './render/renderer-2d.js';
import { QUALITY, THEMES, UI as UI_TIMING } from './config.js';
import { installDebug } from './debug.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
/** Dev/test facility: only active with ?debug in the URL, never shown in the player UI. */
const DEBUG = params.has('debug');
const QUALITY_ORDER = ['high', 'medium', 'low'];
const HINTS = {
  demon: 'DEMON! Touch it and the run ends — no hearts, no shields',
  shrink: 'New: coral − rock shrinks your scoop 5s',
  reverse: 'New: whiskey bottle flips your controls 5s',
  mult2: 'New: ×2 rock doubles your points for 5s',
  mult3: 'New: ×3 rock triples your points for 5s',
  mult5: 'New: ×5 rock — five times the points for 5s',
  clone: 'New: shadow rock adds two clone carts for 5s',
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
};
const EFFECT_END = {
  reverse: 'Controls back to normal',
  multiplier: 'Points multiplier over',
  clone: 'Shadow clones gone',
};

class App {
  constructor() {
    this.store = new SaveStore();
    const s = this.store.settings;
    setDifficultyMode(s.difficulty);
    this.theme = this.store.data.theme;
    this.selectedLevel = clampLevel(Math.min(this.store.data.selectedLevel, this.store.data.unlockedLevel));
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
      worldX: (clientX) => {
        if (!this.layout) return NaN;
        const rect = $('scene').getBoundingClientRect();
        return this.layout.toWorld(clientX - rect.left, 0).x;
      },
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
      } else if (this.sim.phase !== PHASE.PAUSED && this.sim.phase !== PHASE.REVIVE) {
        this.audio.resume();
      }
      this.loop.resetClock();
    });

    const onFullscreenChange = () => {
      const active = this.isFullscreen();
      this.ui.refreshFullscreen(this.fullscreenSupported(), active);
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
    this.relayout();
    this.buildPreviews();
    this.ui.setLoading(false);
    this.ui.showMenu();
    this.loop.start();
    if (DEBUG) installDebug(this, params);
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
    this.renderer.setTheme(this.theme);
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
    const thumbs = {};
    for (const id of THEMES) thumbs[id] = safe(() => this.renderer.themeThumbnailDataURL(id, 360, 230));
    const icons = {};
    for (const t of ITEM_TYPES) icons[t] = safe(() => this.renderer.itemIconDataURL(t, 128));
    this.ui.buildTerrain(thumbs);
    this.ui.buildLegend(icons);
  }

  relayout() {
    const rect = $('frame').getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const insets = this.ui.applyHudMode(rect.width, rect.height);
    this.layout = computeLayout(rect.width, rect.height, insets);
    this.renderer?.resize(this.layout);
    const orientation = rect.width >= rect.height ? 'landscape' : 'portrait';
    if (this.orientation && orientation !== this.orientation) this.autoPause('rotate');
    this.orientation = orientation;
  }

  // ------------------------------------------------------------------ frame

  frame(alpha, frameDt) {
    this.realTime += frameDt;
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
    this.renderer.render({ sim: this.sim, alpha, frameDt, time: this.realTime, paused });
    const cart = this.sim.cart;
    const cartX = cart ? cart.prevX + (cart.x - cart.prevX) * alpha : 0;
    this.ui.updateHud(this.sim, cartX);
    this._monitorPerf(frameDt);
  }

  handleEvents(events) {
    this.renderer.handleEvents(events);
    for (const e of events) {
      switch (e.type) {
        case 'stageStart':
          this.ui.clearToasts();
          this._snapshotRun(e.level);
          break;
        case 'endlessLevelUp':
          this.audio.play('target');
          this.ui.toast(`Wave ${e.wave} — faster now!`, 'good');
          this.ui.announce(`Wave ${e.wave}. Total score ${e.total}.`);
          break;
        case 'catch':
          this._onCatch(e);
          break;
        case 'targetReached':
          this.audio.play('target');
          this.ui.toast('Target reached — survive!', 'good');
          this.ui.announce('Target reached. Survive until the timer ends.');
          break;
        case 'crack':
          this.audio.play('crack');
          if (HINTS[e.itemType] && this.store.markSeen(e.itemType)) this.ui.toast(HINTS[e.itemType], 'hint', 3.4);
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
        case 'stageEnd':
          this._onStageEnd(e);
          break;
        default:
          break;
      }
    }
  }

  _onCatch(e) {
    if (e.itemType === 'demon') {
      this.audio.play('damage');
      this._vibrate([90, 60, 150]);
      this.ui.heartHit();
      this.ui.announce('A demon! The run is over.');
      return;
    }
    if (e.itemType === 'fire') {
      if (e.blocked) {
        this.audio.play('blocked');
        return;
      }
      this.audio.play('damage');
      this._vibrate(60);
      this.ui.heartHit();
      this.ui.announce(`Fire rock! ${e.lives} heart${e.lives === 1 ? '' : 's'} left.`);
      return;
    }
    this.audio.play(EFFECT_SOUND[e.itemType]);
    if (e.comboBonus) {
      this.audio.play('multiplier');
      this.ui.announce(`Combo ${e.combo}! Bonus ${e.comboBonus} points.`);
    }
    if (e.effect === 'expand') this.ui.announce('Wide scoop for 5 seconds');
    else if (e.effect === 'shrink') this.ui.announce('Narrow scoop for 5 seconds');
    else if (e.effect === 'reverse') this.ui.announce('Whiskey! Controls reversed for 5 seconds');
    else if (e.effect === 'multiplier') this.ui.announce(`Points times ${e.multiplier} for 5 seconds`);
    else if (e.effect === 'clone') this.ui.announce('Shadow clones for 5 seconds');
    else if (e.itemType === 'shield') this.ui.announce(`Shield banked. Bank ${e.bank}.`);
  }

  /** 3 stars for near-perfect play, 2 for a strong clear, 1 for any win. */
  _stars(e) {
    if (e.result !== 'won' || !(e.reachable > 0)) return 0;
    const share = e.score / e.reachable;
    return share >= 0.9 ? 3 : share >= 0.75 ? 2 : 1;
  }

  _onStageEnd(e) {
    this.input.clear();
    const won = e.result === 'won';
    const result = { ...e };
    if (e.mode === MODES.ENDLESS) {
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
      Object.assign(result, { best: rec.best, unlocked: rec.unlocked, stars });
    }
    this.audio.play(won ? 'win' : 'lose');
    clearTimeout(this.resultTimer);
    // A demon loss holds the card back a little longer so the blast plays out first.
    this.resultTimer = setTimeout(() => {
      if (this.sim.phase !== PHASE.ENDED) return;
      this.ui.showResult(result);
    }, e.reason === 'demon' ? 1300 : 750);
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

  _vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* haptics are best-effort */
    }
  }

  // ------------------------------------------------------------------ flow

  play() {
    this.startLevel(this.selectedLevel);
  }

  selectLevel(level, { quiet = false } = {}) {
    this.selectedLevel = Math.min(this.store.data.unlockedLevel, clampLevel(level));
    this.store.setSelectedLevel(this.selectedLevel);
    if (!quiet) this.ui.refreshMenu();
  }

  startLevel(level) {
    level = clampLevel(level);
    if (!this.store.isUnlocked(level)) return;
    this.selectLevel(level, { quiet: true });
    if (!this.store.data.tutorialDone) {
      this.pendingStart = level;
      this.ui.showHowto(true);
      return;
    }
    this.sim.startRun(level, { seed: this._seed() });
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

  _beginIntro() {
    clearTimeout(this.resultTimer);
    this.ui.closeAll();
    this.ui.clearToasts();
    this.input.clear();
    const st = this.sim.stage;
    this.ui.showIntro(st.level, st.target, st.duration, this.sim.run?.mode);
    this.introLeft = UI_TIMING.introSeconds;
    this.audio.unlock();
    this.audio.resume();
    this.ui.refreshTerrain();
    this.loop.resetClock();
  }

  nextLevel() {
    if (this.sim.continueRun()) this._beginIntro();
  }

  retry() {
    // A daily retry replays the same seeded stage; other modes reroll.
    const daily = this.sim.run?.mode === MODES.DAILY;
    if (this.sim.retry(daily ? {} : { seed: this._seed() })) this._beginIntro();
  }

  /** Endless mode: waves of rising level numbers, no targets, score until the run ends. */
  startEndless() {
    this.sim.startRun(1, { seed: this._seed(), mode: MODES.ENDLESS });
    this._beginIntro();
  }

  /** Local date the daily challenge keys on. */
  dailyDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Everyone gets the same seeded stage on a given day; the level varies day by day. */
  dailyInfo() {
    const date = this.dailyDate();
    return { date, level: 8 + (hashSeed('daily-level', date) % 25), seed: hashSeed('daily', date) };
  }

  startDaily() {
    const { level, seed } = this.dailyInfo();
    this.sim.startRun(level, { seed, mode: MODES.DAILY });
    this._beginIntro();
  }

  /** Restarts a saved run at the beginning of the stage it was on. */
  resumeSavedRun() {
    const snap = this.store.data.resume;
    if (!snap || this.sim.phase !== PHASE.IDLE) return;
    this.sim.resumeRun(snap);
    this._beginIntro();
  }

  toMenu() {
    clearTimeout(this.resultTimer);
    this.sim.quit();
    this.input.clear();
    this.audio.resume();
    this.ui.clearToasts();
    this.ui.showMenu();
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
    try {
      const result = this.isFullscreen()
        ? (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc)
        : (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
      result?.catch?.((err) => console.warn('[avalanche] full screen request refused', err?.message || err));
    } catch (err) {
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

  canChangeTheme() {
    return this.sim.phase === PHASE.IDLE;
  }

  setTheme(id) {
    if (!this.canChangeTheme() || !THEMES.includes(id)) return;
    this.theme = id;
    this.store.setTheme(id);
    this.renderer.setTheme(id);
    this.audio.setTheme(id);
    this.ui.refreshTerrain();
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
    } else if (avg < QUALITY.adaptive.upgradeMs) {
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
