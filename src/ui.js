// DOM HUD, menus, and overlays. Reads game state; sends player intents to the app.
import { RUN, THEMES } from './config.js';
import { ITEM_TYPES } from './game/items.js';
import { MODES } from './game/simulation.js';
import { LEVEL_COUNT, stageDuration } from './game/levels.js';
import { previewTarget } from './game/spawn-director.js';
import { LEGEND, appearanceOf } from './render/appearance.js';
import { themeInfo } from './render/themes.js';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};
const PAGE_SIZE = 20;

const RESTORE_NOTES = {
  'hearts-full': 'Hearts full',
  'max-used': 'All 4 restores used',
  'not-playing': '',
  'no-run': '',
};

export class UI {
  constructor(app) {
    this.app = app;
    this.frame = $('frame');
    this.overlays = ['ov-menu', 'ov-levels', 'ov-settings', 'ov-howto', 'ov-pause', 'ov-revive', 'ov-result', 'ov-confirm', 'ov-context', 'ov-scores'];
    this.stack = [];
    this.toastQueue = [];
    this.toastActive = false;
    this.hud = {
      level: $('hud-level'),
      score: $('hud-score'),
      target: $('hud-target'),
      bar: $('hud-bar'),
      scorePill: $('score-pill'),
      mult: $('hud-mult'),
      time: $('hud-time'),
      timerPill: $('timer-pill'),
      hearts: $('hud-hearts'),
      heartEls: [...$('hud-hearts').querySelectorAll('.heart')],
      bank: $('hud-bank'),
      cost: $('hud-cost'),
      used: $('hud-used'),
      restore: $('btn-restore'),
      note: $('restore-note'),
    };
    this.last = {};
    this.icons = {};
    this.levelPage = 0;
    this._bind();
  }

  // ------------------------------------------------------------------ bindings

  _bind() {
    const app = this.app;
    const on = (id, fn) => $(id).addEventListener('click', (e) => {
      app.audio.play('click');
      fn(e);
    });
    on('btn-play', () => app.play());
    on('btn-resume-run', () => app.resumeSavedRun());
    on('btn-endless', () => app.startEndless());
    on('btn-daily', () => app.startDaily());
    on('btn-scores', () => this.showScores());
    on('btn-level-prev', () => app.selectLevel(app.selectedLevel - 1));
    on('btn-level-next', () => app.selectLevel(app.selectedLevel + 1));
    on('btn-levels', () => this.showLevels());
    on('btn-howto', () => this.showHowto(false));
    on('btn-settings', () => this.showSettings());
    this._onTap($('btn-pause'), () => app.togglePause());
    on('btn-resume', () => app.resume());
    on('btn-restart', () => app.retry());
    on('btn-pause-menu', () => app.toMenu());
    on('btn-pause-howto', () => this.showHowto(false));
    this._onTap($('btn-restore'), () => app.requestRestore());
    on('btn-revive-yes', () => app.acceptRevive());
    on('btn-revive-no', () => app.declineRevive());
    on('btn-next', () => app.nextLevel());
    on('btn-retry', () => app.retry());
    on('btn-result-menu', () => app.toMenu());
    on('btn-reset', () => this.open('ov-confirm'));
    on('btn-confirm-no', () => this.close('ov-confirm'));
    on('btn-confirm-yes', () => {
      app.resetProgress();
      this.close('ov-confirm');
      this.toast('Progress reset', 'good');
    });
    on('btn-howto-ok', () => this._closeHowto());
    on('btn-context-retry', () => app.contextRetry());
    on('btn-context-2d', () => app.switchRenderer('2d'));
    for (const el of document.querySelectorAll('[data-fullscreen]')) {
      el.addEventListener('click', () => {
        app.audio.play('click');
        app.toggleFullscreen();
      });
    }
    for (const el of document.querySelectorAll('[data-close]')) {
      el.addEventListener('click', () => this.closeTop());
    }

    const bindToggle = (id, key) => {
      $(id).addEventListener('change', (e) => app.setSetting(key, e.target.checked));
    };
    bindToggle('set-sound', 'sound');
    bindToggle('set-music', 'music');
    bindToggle('set-motion', 'reducedMotion');
    bindToggle('set-follow', 'pointerFollow');
    bindToggle('pause-sound', 'sound');
    bindToggle('pause-music', 'music');
    const bindSlider = (id, key) => {
      $(id).addEventListener('input', (e) => app.setSetting(key, Number(e.target.value) / 100));
    };
    bindSlider('set-master-vol', 'masterVol');
    bindSlider('set-sfx-vol', 'sfxVol');
    bindSlider('set-music-vol', 'musicVol');
    for (const [id, key] of [['set-quality', 'quality'], ['set-renderer', 'renderer'], ['set-difficulty', 'difficulty']]) {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-value]');
        if (b) app.setSetting(key, b.dataset.value);
      });
    }

    // Escape closes the top-most dismissible overlay (pause handled by the app).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      const top = this.stack[this.stack.length - 1];
      if (top && ['ov-levels', 'ov-settings', 'ov-confirm', 'ov-scores'].includes(top)) {
        e.stopImmediatePropagation();
        this.closeTop();
      } else if (top === 'ov-howto') {
        e.stopImmediatePropagation();
        this._closeHowto();
      }
    }, true);

    // Focus trap: while an overlay is open, Tab cycles within it instead of escaping to the
    // HUD behind. The HUD is also made inert so pointer and reader focus cannot reach it.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.stack.length) return;
      const top = $(this.stack[this.stack.length - 1]);
      const focusables = [...top.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const inside = top.contains(document.activeElement);
      if (!inside) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }, true);
  }

  /** The HUD behind an open overlay must not take focus, clicks, or reader attention. */
  _updateInert() {
    const behind = this.anyOpen;
    for (const id of ['hud-top', 'hud-bottom']) {
      const el = $(id);
      if (behind) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    }
  }

  /** Activation for in-play HUD buttons: pointerup for touch/pen (any finger), click otherwise. */
  _onTap(el, fn) {
    const downs = new Set();
    let suppressUntil = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') downs.add(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      if (!downs.delete(e.pointerId)) return;
      suppressUntil = performance.now() + 600;
      if (!el.disabled) {
        this.app.audio.play('click');
        fn();
      }
    });
    el.addEventListener('pointercancel', (e) => downs.delete(e.pointerId));
    el.addEventListener('click', () => {
      if (performance.now() < suppressUntil) return;
      this.app.audio.play('click');
      fn();
    });
  }

  // ------------------------------------------------------------------ overlay stack

  /** Shows `id` on top; overlays beneath it stay in the stack but hidden until it closes. */
  open(id) {
    for (const other of this.overlays) if (other !== id) $(other).hidden = true;
    $(id).hidden = false;
    this.stack = this.stack.filter((s) => s !== id);
    this.stack.push(id);
    const focusable = $(id).querySelector('.btn.primary, button, input');
    focusable?.focus({ preventScroll: true });
    this._updateInert();
    this.app.onOverlayChange();
  }

  close(id) {
    $(id).hidden = true;
    this.stack = this.stack.filter((s) => s !== id);
    const top = this.stack[this.stack.length - 1];
    if (top) $(top).hidden = false;
    this._updateInert();
    this.app.onOverlayChange();
  }

  closeTop() {
    const top = this.stack[this.stack.length - 1];
    if (top) this.close(top);
  }

  closeAll() {
    for (const id of this.overlays) $(id).hidden = true;
    this.stack = [];
    this._updateInert();
    this.app.onOverlayChange();
  }

  isOpen(id) {
    return this.stack.includes(id);
  }

  get anyOpen() {
    return this.stack.length > 0;
  }

  // ------------------------------------------------------------------ screens

  showMenu() {
    this.closeAll();
    this.hideIntro();
    this.refreshMenu();
    this.open('ov-menu');
  }

  refreshMenu() {
    const app = this.app;
    $('menu-level').textContent = app.selectedLevel;
    $('btn-level-prev').disabled = app.selectedLevel <= 1;
    $('btn-level-next').disabled = app.selectedLevel >= app.store.data.unlockedLevel;
    const resume = app.store.data.resume;
    $('btn-resume-run').hidden = !resume;
    if (resume) {
      $('resume-note').textContent = resume.mode === MODES.ENDLESS
        ? `Endless · wave ${resume.stagesCleared + 1} · ${resume.totalScore} pts`
        : `Level ${resume.level} · ${resume.lives} ♥ · ${resume.bank} shields`;
    }
    const daily = app.store.data.daily;
    $('daily-note').textContent = daily?.date === app.dailyDate() ? `Best ${daily.best}` : 'New!';
    const notes = [];
    if (app.renderer?.kind === '2d') notes.push(app.fallbackReason === 'webgl' ? 'Simple 2D mode: 3D graphics are not available on this device.' : 'Simple 2D mode is on (Settings).');
    if (!app.store.persistent) notes.push('Progress cannot be saved in this browser session.');
    $('menu-note').textContent = notes.join(' ');
    $('menu-note').hidden = notes.length === 0;
    this.refreshTerrain();
  }

  showLevels() {
    this.levelPage = Math.floor((this.app.selectedLevel - 1) / PAGE_SIZE);
    this._renderLevels();
    this.open('ov-levels');
  }

  _renderLevels() {
    const app = this.app;
    const pages = $('level-pages');
    pages.replaceChildren();
    for (let p = 0; p < Math.ceil(LEVEL_COUNT / PAGE_SIZE); p++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.textContent = `${p * PAGE_SIZE + 1}–${Math.min(LEVEL_COUNT, (p + 1) * PAGE_SIZE)}`;
      b.setAttribute('aria-selected', String(p === this.levelPage));
      b.addEventListener('click', () => {
        this.levelPage = p;
        this._renderLevels();
      });
      pages.appendChild(b);
    }
    const grid = $('level-grid');
    grid.replaceChildren();
    const start = this.levelPage * PAGE_SIZE + 1;
    for (let level = start; level < start + PAGE_SIZE && level <= LEVEL_COUNT; level++) {
      const unlocked = app.store.isUnlocked(level);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'level-btn' + (level === app.selectedLevel ? ' current' : '');
      b.disabled = !unlocked;
      const best = app.store.bestScore(level);
      const stars = app.store.starsFor(level);
      if (unlocked) {
        const starRow = stars ? `<span class="stars" aria-hidden="true">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` : '';
        b.innerHTML = `<b>${level}</b>${starRow}<small>${best ? `Best ${best}` : `~${previewTarget(level)} pts`}</small>`;
        b.setAttribute('aria-label', `Level ${level}${best ? `, best ${best}` : ''}${stars ? `, ${stars} star${stars === 1 ? '' : 's'}` : ''}`);
        b.addEventListener('click', () => {
          app.audio.play('click');
          app.startLevel(level);
        });
      } else {
        b.innerHTML = `<svg class="lock" aria-hidden="true"><use href="#i-lock"/></svg><small>${level}</small>`;
        b.setAttribute('aria-label', `Level ${level}, locked`);
      }
      grid.appendChild(b);
    }
  }

  showScores() {
    const data = this.app.store.data;
    const daily = data.daily?.date === this.app.dailyDate() ? data.daily : null;
    $('scores-summary').innerHTML = [
      `<div><span>Endless best</span><b>${data.endlessBest || '—'}</b></div>`,
      `<div><span>Today's daily</span><b>${daily ? daily.best : '—'}</b></div>`,
    ].join('');
    const list = $('scores-list');
    list.replaceChildren();
    const modeLabel = { level: 'Campaign', endless: 'Endless', daily: 'Daily' };
    for (const s of data.scores) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${s.score}</b><span>${modeLabel[s.mode] || s.mode} · level ${s.level}</span><small>${s.date}</small>`;
      list.appendChild(li);
    }
    $('scores-empty').hidden = data.scores.length > 0;
    this.open('ov-scores');
  }

  showSettings() {
    this.refreshSettings();
    this.open('ov-settings');
  }

  refreshSettings() {
    const s = this.app.store.settings;
    $('set-sound').checked = s.sound;
    $('set-music').checked = s.music;
    $('set-motion').checked = s.reducedMotion;
    $('set-follow').checked = s.pointerFollow;
    $('pause-sound').checked = s.sound;
    $('pause-music').checked = s.music;
    $('set-master-vol').value = Math.round(s.masterVol * 100);
    $('set-sfx-vol').value = Math.round(s.sfxVol * 100);
    $('set-music-vol').value = Math.round(s.musicVol * 100);
    for (const [id, value] of [['set-quality', s.quality], ['set-renderer', s.renderer], ['set-difficulty', s.difficulty]]) {
      for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === value));
      for (const b of $(id).querySelectorAll('button')) b.setAttribute('role', 'radio');
    }
    const r = this.app.renderer;
    const q = this.app.activeQuality;
    $('renderer-status').textContent =
      r?.kind === '3d' ? `Using 3D (WebGL) · ${q} quality.` : this.app.fallbackReason === 'webgl' ? 'Using simple 2D: WebGL could not start on this device.' : 'Using simple 2D.';
    $('storage-status').textContent = this.app.store.persistent ? '' : 'Saving is unavailable in this browser session; progress lasts until you close the tab.';
  }

  showHowto(tutorial) {
    this.tutorialMode = tutorial;
    $('howto-title').textContent = tutorial ? 'Before you start' : 'How to play';
    $('btn-howto-ok').textContent = tutorial ? 'Start' : 'Got it';
    this.open('ov-howto');
  }

  _closeHowto() {
    this.close('ov-howto');
    if (this.tutorialMode) {
      this.tutorialMode = false;
      this.app.tutorialDone();
    }
  }

  showPause(note) {
    $('pause-note').textContent = note || '';
    $('pause-note').hidden = !note;
    this.refreshSettings();
    this.open('ov-pause');
  }

  showRevive(status) {
    $('revive-cost').textContent = status.cost;
    $('revive-bank').textContent = status.bank;
    $('revive-left').textContent = status.maxUses - status.used;
    $('btn-revive-yes').textContent = `Restore · ${status.cost} shield${status.cost === 1 ? '' : 's'}`;
    this.open('ov-revive');
  }

  showResult(r) {
    const card = $('ov-result').querySelector('.result-card');
    const endless = r.mode === MODES.ENDLESS;
    const daily = r.mode === MODES.DAILY;
    const won = r.result === 'won';
    card.classList.toggle('won', won || (endless && r.reason !== 'demon'));
    card.classList.toggle('lost', !won && !(endless && r.reason !== 'demon'));
    const complete = won && r.finalLevel;
    $('result-title').textContent = endless
      ? 'Run over!'
      : complete
        ? 'Summit cleared!'
        : won
          ? daily ? 'Daily cleared!' : 'Stage clear!'
          : r.reason === 'demon'
            ? 'GAME OVER'
            : daily ? 'Daily failed' : 'Stage failed';
    $('result-sub').textContent = endless
      ? `You survived ${r.wave} wave${r.wave === 1 ? '' : 's'} for ${r.total} points${r.newBest ? ' — a new best!' : ''}.`
      : complete
        ? 'You cleared all 100 levels. Replay the summit or pick any level from the menu.'
        : won
          ? daily
            ? `Today's challenge cleared with ${r.lives} heart${r.lives === 1 ? '' : 's'} left${r.newBest ? ' — a new daily best!' : ''}.`
            : `Level ${r.level} cleared with ${r.lives} heart${r.lives === 1 ? '' : 's'} left.`
          : r.reason === 'demon'
            ? 'A demon got you — instant game over.'
            : r.reason === 'out-of-lives'
              ? 'Out of hearts.'
              : `Time's up — ${r.score} of ${r.target} points.`;
    const stars = $('result-stars');
    stars.hidden = !r.stars;
    if (r.stars) {
      stars.innerHTML = [1, 2, 3].map((i) => `<span class="${i <= r.stars ? 'on' : ''}">★</span>`).join('');
      stars.setAttribute('aria-label', `${r.stars} of 3 stars`);
    }
    $('result-score').textContent = endless ? r.total : r.score;
    $('result-target-box').hidden = endless;
    $('result-target').textContent = r.target ?? '—';
    $('result-best').textContent = r.best;
    $('result-lost').textContent = r.livesLost;
    $('result-combo-box').hidden = !(r.bestCombo >= 5);
    $('result-combo').textContent = r.bestCombo;
    const caught = $('result-caught');
    caught.replaceChildren();
    for (const type of ITEM_TYPES) {
      const n = r.caught[type];
      if (!n) continue;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = appearanceOf(type).name;
      chip.innerHTML = `<img alt="${appearanceOf(type).name}" src="${this.icons[type] || ''}">×${n}`;
      caught.appendChild(chip);
    }
    if (!caught.children.length) caught.innerHTML = '<span class="hint">No rocks caught</span>';
    $('result-unlock').hidden = !r.unlocked;
    $('result-unlock').textContent = r.unlocked ? `Level ${r.unlocked} unlocked!` : '';
    $('btn-next').hidden = !(won && !r.finalLevel && r.mode === MODES.LEVEL);
    $('btn-retry').textContent = complete ? 'Replay' : endless || daily ? 'Play again' : 'Retry';
    this.closeAll();
    this.open('ov-result');
  }

  showContextLost() {
    this.open('ov-context');
  }

  showIntro(level, target, duration, mode = MODES.LEVEL) {
    $('intro-level').textContent = mode === MODES.ENDLESS ? 'ENDLESS' : mode === MODES.DAILY ? `DAILY · L${pad2(level)}` : `LEVEL ${pad2(level)}`;
    $('intro-goal').textContent = mode === MODES.ENDLESS
      ? 'Survive — every wave gets faster'
      : `Reach ${target} in ${clock(duration)}`;
    $('intro-banner').hidden = false;
  }

  hideIntro() {
    $('intro-banner').hidden = true;
  }

  setLoading(on) {
    $('loading').hidden = !on;
  }

  // ------------------------------------------------------------------ terrain & legend

  buildTerrain(thumbs) {
    this.thumbs = thumbs;
    for (const [containerId, compact] of [['menu-terrain', true]]) {
      const box = $(containerId);
      box.replaceChildren();
      for (const id of THEMES) {
        const info = themeInfo(id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'terrain-card';
        b.setAttribute('role', 'radio');
        b.dataset.theme = id;
        b.setAttribute('aria-label', `${info.label} terrain: ${info.blurb}`);
        if (thumbs[id]) b.style.backgroundImage = `url(${thumbs[id]})`;
        b.innerHTML = `<svg class="check" aria-hidden="true"><use href="#i-check"/></svg><span class="name">${info.label.toUpperCase()}</span>`;
        b.addEventListener('click', () => {
          this.app.audio.play('click');
          this.app.setTheme(id);
        });
        if (compact) b.title = info.blurb;
        box.appendChild(b);
      }
    }
    this.refreshTerrain();
  }

  refreshTerrain() {
    const locked = !this.app.canChangeTheme();
    for (const b of document.querySelectorAll('.terrain-card')) {
      b.setAttribute('aria-checked', String(b.dataset.theme === this.app.theme));
      b.disabled = locked;
    }
  }

  buildLegend(icons) {
    this.icons = icons;
    const legend = $('legend');
    legend.replaceChildren();
    const howto = $('howto-grid');
    howto.replaceChildren();
    for (const entry of LEGEND) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const imgs = entry.types.map((t) => `<img alt="" src="${icons[t] || ''}">`).join('');
      item.innerHTML = `<div class="legend-icons">${imgs}</div><div class="t">${entry.title}</div><div class="d">${entry.detail}</div>`;
      legend.appendChild(item);
    }
    const verdict = { catch: 'Catch', avoid: 'Avoid', mixed: '+ helps · − hurts' };
    const rows = [
      { types: ['coin'], t: 'Gold rock', d: '+50 points', v: 'catch' },
      { types: ['cash'], t: 'Emerald $ rock', d: '+100 points', v: 'catch' },
      { types: ['shield'], t: 'Shield rock', d: '+1 banked shield', v: 'catch' },
      { types: ['expand'], t: 'Teal + rock', d: 'Wider scoop for 5s', v: 'catch' },
      { types: ['shrink'], t: 'Coral − rock', d: 'Narrow scoop 5s', v: 'avoid' },
      { types: ['fire'], t: 'Fire rock', d: 'Lose a heart', v: 'avoid' },
      { types: ['demon'], t: 'Demon rock', d: 'Falls faster; touch it and the run ends instantly', v: 'avoid' },
      { types: ['reverse'], t: 'Whiskey bottle', d: 'Controls flip 5s', v: 'avoid' },
      { types: ['mult2', 'mult3', 'mult5'], t: '×2 / ×3 / ×5 rock', d: 'Points multiplied for 5s', v: 'catch' },
      { types: ['clone'], t: 'Shadow rock', d: '2 clone carts for 5s; they catch good rocks only', v: 'catch' },
    ];
    for (const r of rows) {
      const el = document.createElement('div');
      el.className = `howto-item ${r.v}`;
      const imgs = r.types.map((t) => `<img alt="" src="${icons[t] || ''}">`).join('');
      el.innerHTML = `<div class="howto-icons">${imgs}</div><div><div class="v">${verdict[r.v]}</div><div class="t">${r.t}</div><div class="d">${r.d}</div></div>`;
      howto.appendChild(el);
    }
  }

  // ------------------------------------------------------------------ HUD

  /** Picks a HUD arrangement for the frame size, then returns the insets it occupies. */
  applyHudMode(width, height) {
    const mode = width < 700 && height > width * 1.05 ? 'compact' : height < 480 || width < 700 ? 'short' : width < 940 ? 'mid' : 'wide';
    if (this.frame.dataset.hud !== mode) this.frame.dataset.hud = mode;
    this.frame.toggleAttribute('data-narrow', width < 380);
    const frameRect = this.frame.getBoundingClientRect();
    const top = $('hud-top').getBoundingClientRect();
    const bottom = $('hud-bottom').getBoundingClientRect();
    this.frame.style.setProperty('--toast-top', `${Math.round(top.bottom - frameRect.top + 10)}px`);
    return {
      top: Math.max(0, top.bottom - frameRect.top) + 8,
      bottom: Math.max(0, frameRect.bottom - bottom.top) + 6,
      left: 0,
      right: 0,
    };
  }

  _set(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  updateHud(sim) {
    const st = sim.stage;
    const run = sim.run;
    const h = this.hud;
    // Endless mode has no target: the score pill shows the cumulative run total instead.
    const endless = !!st && st.target === null;
    const level = st ? st.level : this.app.selectedLevel;
    const target = st ? st.target : previewTarget(level);
    const score = st ? (endless ? run.totalScore + st.score : st.score) : 0;
    this._set('level', level, (v) => (h.level.textContent = pad2(v)));
    this._set('score', score, (v) => (h.score.textContent = v));
    this._set('target', endless ? '∞' : target, (v) => (h.target.textContent = v));
    this._set('bar', endless ? 100 : Math.min(100, Math.round((score / target) * 1000) / 10), (v) => (h.bar.style.width = `${v}%`));
    this._set('reached', !!st?.targetReached, (v) => h.scorePill.classList.toggle('reached', v));
    this._set('mult', sim.scoreMultiplier(), (v) => {
      h.mult.hidden = v <= 1;
      h.mult.textContent = `×${v}`;
      h.mult.dataset.mult = v;
    });
    const remaining = st ? sim.timeRemaining : stageDuration(level);
    this._set('time', clock(remaining), (v) => (h.time.textContent = v));
    this._set('low', !!st && remaining <= 10 && sim.phase === 'playing', (v) => h.timerPill.classList.toggle('low', v));
    const lives = run ? run.lives : RUN.startLives;
    this._set('lives', lives, (v) => {
      h.heartEls.forEach((el, i) => el.classList.toggle('empty', i >= v));
      h.hearts.setAttribute('aria-label', `${v} of ${RUN.maxLives} hearts`);
    });
    this._set('bank', run ? run.bank : 0, (v) => (h.bank.textContent = v));
    const status = sim.restoreStatus();
    const cost = sim.run ? sim.nextRestoreCost() : RUN.restoreCosts[0];
    this._set('cost', cost, (v) => {
      h.cost.innerHTML = v === null ? '<span class="dot">•</span> —' : `<span class="dot">•</span> ${v} <span class="unit">SHIELD${v === 1 ? '' : 'S'}</span>`;
    });
    this._set('used', run ? run.restoresUsed : 0, (v) => (h.used.innerHTML = `${v} / ${RUN.restoreCosts.length} <span class="unit">USED</span>`));
    this._set('restoreOk', status.ok, (v) => {
      h.restore.disabled = !v;
      h.restore.setAttribute('aria-label', v ? `Restore one heart for ${cost} shield${cost === 1 ? '' : 's'}` : 'Restore unavailable');
    });
    const note = status.ok ? '' : status.reason === 'need-shields' ? `Need ${status.need} more shield${status.need === 1 ? '' : 's'}` : RESTORE_NOTES[status.reason] ?? '';
    this._set('note', note, (v) => (h.note.textContent = v));
  }

  /** Shows the full-screen buttons only where the Fullscreen API exists, with the right label. */
  refreshFullscreen(supported, active) {
    for (const el of document.querySelectorAll('[data-fullscreen]')) {
      el.hidden = !supported;
      el.querySelector('.fs-label').textContent = active ? 'Exit full screen' : 'Full screen';
      el.querySelector('use').setAttribute('href', active ? '#i-collapse' : '#i-expand');
      el.setAttribute('aria-pressed', String(active));
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', active ? 'Exit full screen' : 'Full screen');
    }
  }

  flashRestoreNote() {
    const n = this.hud.note;
    n.classList.remove('flash');
    void n.offsetWidth;
    n.classList.add('flash');
  }

  heartHit() {
    const el = this.hud.hearts;
    el.classList.remove('hurt');
    void el.offsetWidth;
    el.classList.add('hurt');
  }

  /**
   * Toasts queue instead of overwriting each other, so near-simultaneous messages (say, two
   * first-encounter hints) are all read. Only one shows at a time to keep the shelves visible.
   */
  toast(text, kind = '', seconds = 2.6) {
    this.toastQueue.push({ text, kind, seconds });
    if (!this.toastActive) this._nextToast();
  }

  _nextToast() {
    const next = this.toastQueue.shift();
    if (!next) {
      this.toastActive = false;
      return;
    }
    this.toastActive = true;
    const gen = this.toastGen || 0;
    const layer = $('toasts');
    layer.replaceChildren();
    const el = document.createElement('div');
    el.className = `toast ${next.kind}`;
    el.textContent = next.text;
    layer.appendChild(el);
    setTimeout(() => el.classList.add('out'), next.seconds * 1000);
    setTimeout(() => {
      // A clearToasts() in between invalidates this timer; a newer toast owns the layer.
      if (gen !== (this.toastGen || 0)) return;
      el.remove();
      this._nextToast();
    }, next.seconds * 1000 + 400);
  }

  clearToasts() {
    this.toastGen = (this.toastGen || 0) + 1;
    this.toastQueue.length = 0;
    this.toastActive = false;
    $('toasts').replaceChildren();
  }

  announce(text) {
    const a = $('announcer');
    a.textContent = '';
    setTimeout(() => (a.textContent = text), 30);
  }
}
