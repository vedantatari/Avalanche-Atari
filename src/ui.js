// DOM HUD, menus, and overlays. Reads game state; sends player intents to the app.
import { MODIFIERS, RUN, TERRAIN_RULES } from './config.js';
import { ITEM_TYPES } from './game/items.js';
import { MODES } from './game/simulation.js';
import { LEVEL_COUNT, levelTerrain, stageDuration, stageModifier } from './game/levels.js';
import { previewTarget } from './game/spawn-director.js';
import { ACHIEVEMENTS } from './achievements.js';
import { CART_TIERS, LEGEND, cartTier } from './render/appearance.js';
import { themeInfo } from './render/themes.js';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};
const PAGE_SIZE = 20;
const SPARKLES = {
  1: { burst: 0, twinkle: 4, size: [6, 10], opacity: 0.45 },
  2: { burst: 10, twinkle: 5, size: [8, 15], opacity: 0.8 },
  3: { burst: 22, twinkle: 10, size: [10, 22], opacity: 1 },
};
const FOUNTAIN = { 1: 6, 2: 14, 3: 28 };
const TIPS = {
  hearts: 'Catch shield rocks: banked shields buy hearts back when you run out.',
  score: ['Every 5th catch in a streak pays a bonus — keep the chain alive.', 'Grab a ×2, ×3 or ×5 rock, then feed it gold while it lasts.'],
};
const UNLOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="shackle" d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" fill="currentColor"/><circle cx="12" cy="15.4" r="1.8" fill="#e8f8ee"/></svg>';
const fmt = (n) => Number(n).toLocaleString('en-US');
const spark = (layer, kind, style) => {
  const el = document.createElement('i');
  el.className = kind;
  el.style.cssText = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(';');
  layer.appendChild(el);
};
/** Text-style glyphs (U+FE0E asks for the plain, non-emoji form) for terrains and modifiers. */
const GLYPH = { ice: '❄︎', volcano: '♨︎', windy: '≋', fog: '☁︎', goldRush: '✦' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const playTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

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
    this.overlays = ['ov-menu', 'ov-levels', 'ov-settings', 'ov-howto', 'ov-pause', 'ov-revive', 'ov-result', 'ov-confirm', 'ov-context', 'ov-scores', 'ov-trophies', 'ov-carts', 'ov-legend'];
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
    on('btn-trophies', () => this.showTrophies());
    on('btn-carts', () => this.showCarts());
    on('btn-demo', () => app.startDemo());
    on('btn-legend', () => this.open('ov-legend'));
    on('btn-install', () => app.installApp());
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
    bindToggle('set-haptics', 'haptics');
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
      if (top && ['ov-levels', 'ov-settings', 'ov-confirm', 'ov-scores', 'ov-trophies', 'ov-carts', 'ov-legend'].includes(top)) {
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
    $('menu-level').textContent = app.selectedLevel ? `Level ${app.selectedLevel}` : 'Demo';
    $('btn-level-prev').disabled = app.selectedLevel <= 0;
    $('btn-level-next').disabled = app.selectedLevel >= app.store.data.unlockedLevel;
    const resume = app.store.data.resume;
    $('btn-resume-run').hidden = !resume;
    if (resume) {
      $('resume-note').textContent = resume.mode === MODES.ENDLESS
        ? `Endless · wave ${resume.stagesCleared + 1} · ${resume.totalScore} pts`
        : `Level ${resume.level} · ${resume.lives} ♥ · ${resume.bank} shields`;
    }
    const daily = app.store.data.daily;
    const today = app.dailyInfo();
    $('daily-note').textContent = `${GLYPH[today.terrain]} ${daily?.date === today.date ? `Best ${daily.best}` : 'New!'}`;
    $('btn-daily').title = `Today's daily: level ${today.level} on ${themeInfo(today.terrain).label}`;
    $('trophy-note').textContent = `${Object.keys(app.store.data.achievements).length} / ${ACHIEVEMENTS.length}`;
    $('cart-note').textContent = CART_TIERS[app.cartChoice()].name;
    const notes = [];
    if (app.renderer?.kind === '2d') notes.push(app.fallbackReason === 'webgl' ? 'Simple 2D mode: 3D graphics are not available on this device.' : 'Simple 2D mode is on (Settings).');
    if (!app.store.persistent) notes.push('Progress cannot be saved in this browser session.');
    $('menu-note').textContent = notes.join(' ');
    $('menu-note').hidden = notes.length === 0;
  }

  showLevels() {
    this.levelPage = Math.max(0, Math.floor((this.app.selectedLevel - 1) / PAGE_SIZE));
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
    if (this.levelPage === 0) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'level-btn demo' + (app.selectedLevel === 0 ? ' current' : '');
      d.innerHTML = '<b>DEMO</b><small>Try everything</small>';
      d.setAttribute('aria-label', 'Demo level: try every rock, storm and terrain');
      d.addEventListener('click', () => {
        app.audio.play('click');
        app.startLevel(0);
      });
      grid.appendChild(d);
    }
    for (let level = start; level < start + PAGE_SIZE && level <= LEVEL_COUNT; level++) {
      const unlocked = app.store.isUnlocked(level);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'level-btn' + (level === app.selectedLevel ? ' current' : '');
      b.disabled = !unlocked;
      const best = app.store.bestScore(level);
      const stars = app.store.starsFor(level);
      const mod = stageModifier(level);
      const modBadge = mod ? `<span class="mod mod-${mod}" title="${MODIFIERS[mod].label}" aria-hidden="true">${GLYPH[mod]}</span>` : '';
      if (unlocked) {
        const starRow = stars ? `<span class="stars" aria-hidden="true">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` : '';
        b.innerHTML = `${modBadge}<b>${level}</b>${starRow}<small>${best ? `Best ${best}` : `~${previewTarget(level, levelTerrain(level))} pts`}</small>`;
        b.setAttribute('aria-label', `Level ${level}${mod ? `, ${MODIFIERS[mod].label}` : ''}${best ? `, best ${best}` : ''}${stars ? `, ${stars} star${stars === 1 ? '' : 's'}` : ''}`);
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

  /** Trophy cabinet: every trophy (locked ones show what to do), then lifetime stats. */
  showCarts() {
    this.renderCarts();
    this.open('ov-carts');
  }

  renderCarts(focus = null) {
    const max = cartTier(this.app.store.data.unlockedLevel);
    const current = this.app.cartChoice();
    $('cart-count').textContent = `${max + 1} of ${CART_TIERS.length} unlocked`;
    const grid = $('cart-grid');
    grid.replaceChildren();
    CART_TIERS.forEach((t, i) => {
      const locked = i > max;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cart-option';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === current));
      b.disabled = locked;
      b.setAttribute('aria-label', `${t.name}. ${locked ? `Locked until level ${i * 10 + 1}` : i === current ? 'Selected' : 'Unlocked'}.`);
      b.innerHTML = `<img alt="" src="${t.sprite || t.thumb}"><b>${t.name}</b><small>${locked ? `${UNLOCK_ICON} Level ${i * 10 + 1}` : i === current ? 'Selected' : 'Tap to ride'}</small>`;
      b.addEventListener('click', () => {
        this.app.audio.play('click');
        this.app.selectCart(i);
        this.renderCarts(i);
      });
      grid.appendChild(b);
    });
    if (focus !== null) grid.children[focus]?.focus({ preventScroll: true });
  }

  showTrophies() {
    const { achievements: got, stats } = this.app.store.data;
    const count = Object.keys(got).length;
    $('trophy-count').textContent = `${count} of ${ACHIEVEMENTS.length} unlocked`;
    const grid = $('trophy-grid');
    grid.replaceChildren();
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement('li');
      const done = !!got[a.id];
      li.className = `trophy ${done ? 'unlocked' : 'locked'}`;
      const icon = ITEM_TYPES.includes(a.icon) && this.icons[a.icon] ? `<img alt="" src="${this.icons[a.icon]}">` : `<span class="glyph">${esc(a.icon)}</span>`;
      let progress = '';
      if (a.goal && !done) {
        const n = Math.min(a.goal, a.progress(stats));
        progress = `<span class="progress" aria-hidden="true"><i style="width:${(100 * n) / a.goal}%"></i></span><small>${n.toLocaleString()} / ${a.goal.toLocaleString()}</small>`;
      }
      li.innerHTML = `<span class="medal" aria-hidden="true">${icon}</span><span class="info"><b>${esc(a.title)}</b><span>${esc(a.desc)}</span>${progress}${done ? `<small>Unlocked ${got[a.id]}</small>` : ''}</span>`;
      li.setAttribute('aria-label', `${a.title}: ${a.desc}. ${done ? 'Unlocked' : 'Locked'}.`);
      grid.appendChild(li);
    }
    const caught = Object.values(stats.caught).reduce((sum, n) => sum + n, 0);
    const rows = [
      ['Stages cleared', stats.clears],
      ['Points scored', stats.points.toLocaleString()],
      ['Rocks caught', caught.toLocaleString()],
      ['Best streak', stats.bestCombo],
      ['Demons dodged', stats.demonsDodged],
      ['Best endless wave', stats.bestWave || '—'],
      ['Jackpots', stats.jackpots],
      ['Time played', playTime(stats.playSeconds)],
    ];
    $('stats-grid').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.open('ov-trophies');
  }

  /** Shows the menu's Install button while the browser offers an install prompt. */
  refreshInstall(available) {
    $('btn-install').hidden = !available;
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
    $('set-haptics').checked = s.haptics;
    // Vibration only means something on touch devices whose browser can buzz.
    $('haptics-row').hidden = !('vibrate' in navigator && window.matchMedia?.('(pointer: coarse)').matches);
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
    const card = $('result-card');
    const endless = r.mode === MODES.ENDLESS;
    const daily = r.mode === MODES.DAILY;
    const demo = r.mode === MODES.DEMO;
    const won = r.result === 'won';
    const complete = won && r.finalLevel;
    const demon = r.reason === 'demon';
    const storm = r.reason === 'storm';
    const final = endless || demo ? r.total : r.score;
    const near = !won && !endless && !demon && !storm && r.target > 0 && final >= 0.75 * r.target;
    const mood = won || (endless && r.newBest) ? 'win' : demon || storm ? 'demon' : near || endless ? 'near' : 'lose';
    card.dataset.mood = mood;
    $('result-title').textContent = demo
      ? 'Demo complete!'
      : endless
      ? 'Run over!'
      : complete
        ? 'Summit cleared!'
        : won
          ? daily ? 'Daily cleared!' : 'Stage clear!'
          : demon
            ? 'GAME OVER'
            : storm
              ? 'Caught in the storm!'
              : near
              ? 'So close!'
              : r.reason === 'out-of-lives' ? 'Out of hearts!' : "Time's up!";
    const where = daily ? "Today's challenge" : `Level ${r.level}`;
    $('result-sub').textContent = demo
      ? 'You have seen it all — now take on level 1!'
      : endless
      ? `You survived ${r.wave} wave${r.wave === 1 ? '' : 's'}`
      : complete
        ? 'All 100 levels cleared — you conquered the mountain!'
        : won
          ? `${where} complete`
          : demon || storm
            ? ''
            : near
              ? 'You were almost there — one more go!'
              : `${where} — ${r.reason === 'out-of-lives' ? 'your hearts ran out' : 'the clock ran out'}.`;
    const hearts = $('result-hearts');
    hearts.hidden = !won;
    if (won) {
      hearts.innerHTML = Array.from({ length: RUN.maxLives }, (_, i) => `<svg class="heart${i < r.lives ? '' : ' empty'}" aria-hidden="true"><use href="#i-heart" /></svg>`).join('')
        + `<span>${r.lives} heart${r.lives === 1 ? '' : 's'} left</span>`;
      hearts.setAttribute('aria-label', `${r.lives} of ${RUN.maxLives} hearts left`);
    }
    const rocks = mood === 'win' ? ['coin', 'cash'] : demon ? ['demon', 'demon'] : storm ? ['frost', 'frost'] : r.reason === 'out-of-lives' ? ['fire', 'fire'] : ['coin', 'cash'];
    for (const [i, img] of [$('ribbon-rock-l'), $('ribbon-rock-r')].entries()) {
      const src = this.icons[rocks[i]];
      img.hidden = !src;
      if (src) img.src = src;
    }
    const stars = $('result-stars');
    stars.hidden = !r.stars;
    stars.innerHTML = '<svg class="star" aria-hidden="true"><use href="#i-star" /></svg>'.repeat(3);
    stars.setAttribute('aria-label', `${r.stars} of 3 stars`);
    $('result-hero-label').textContent = endless ? 'Total score' : 'Score';
    $('result-score').textContent = final;
    const diff = r.target == null ? null : final - r.target;
    let deltaText = '';
    if (endless) deltaText = !r.newBest && r.best > final ? `${fmt(r.best - final)} from your best` : '';
    else if (diff != null && won) deltaText = diff > 0 ? `+${fmt(diff)} over target` : 'Right on target!';
    else if (diff != null) deltaText = diff >= 0 ? 'Target reached — survive to clear!' : `${near ? 'Only ' : ''}${fmt(-diff)} more to clear`;
    const delta = $('result-delta');
    delta.hidden = !deltaText;
    delta.textContent = deltaText;
    delta.classList.toggle('down', !won);
    const nextShare = [0, 0.75, 0.9][r.stars] || 0;
    const nudge = $('result-nudge');
    nudge.hidden = !(won && nextShare && r.reachable > 0);
    nudge.textContent = nudge.hidden ? '' : `Score ${fmt(Math.ceil(nextShare * r.reachable))} for ${'★'.repeat(r.stars + 1)}`;
    $('result-target-box').hidden = endless || demo;
    $('result-best-box').hidden = demo;
    $('result-target').textContent = r.target == null ? '—' : fmt(r.target);
    $('result-best').textContent = fmt(r.best);
    $('result-best-box').classList.toggle('new', !!r.newBest && final > 0);
    $('result-lost').textContent = r.livesLost;
    $('result-combo-box').hidden = !(r.bestCombo >= 5);
    $('result-combo').textContent = r.bestCombo;
    const trophies = $('result-trophies');
    trophies.hidden = !r.trophies?.length;
    trophies.innerHTML = (r.trophies || []).map((a, i) => `<span class="chip" style="--i:${i}" title="${esc(a.desc)}">🏆 ${esc(a.title)}</span>`).join('');
    const tip = $('result-tip');
    tip.hidden = won || demon || storm;
    if (!tip.hidden) tip.innerHTML = `<b>Tip</b> ${r.reason === 'out-of-lives' ? TIPS.hearts : TIPS.score[Math.floor(Math.random() * TIPS.score.length)]}`;
    const unlock = $('result-unlock');
    unlock.hidden = !r.unlocked;
    const newCart = r.unlocked && (r.unlocked - 1) % 10 === 0 ? CART_TIERS[cartTier(r.unlocked)].name : null;
    unlock.innerHTML = r.unlocked ? `${UNLOCK_ICON}<span>Level ${r.unlocked} unlocked!${newCart ? ` New cart: ${newCart}!` : ''}</span>` : '';
    const next = $('btn-next');
    const retry = $('btn-retry');
    const showNext = demo || (won && !r.finalLevel && r.mode === MODES.LEVEL);
    next.querySelector('span').textContent = demo ? 'Play level 1' : 'Next level';
    next.hidden = !showNext;
    if (showNext) {
      const mod = stageModifier(r.level + 1);
      next.dataset.sub = `Level ${r.level + 1}${mod ? ` · ${GLYPH[mod]} ${MODIFIERS[mod].label}` : ''}`;
    }
    retry.classList.toggle('primary', !showNext);
    retry.classList.toggle('result-cta', !showNext);
    $('retry-label').textContent = demo ? 'Replay demo' : complete ? 'Replay' : endless || daily ? 'Play again' : won ? 'Replay' : 'Try again';
    const retrySub = showNext ? '' : endless ? `Beat ${fmt(r.best)}` : daily ? 'Same rocks, another shot' : `Level ${r.level}`;
    if (retrySub) retry.dataset.sub = retrySub;
    else delete retry.dataset.sub;
    this.closeAll();
    this.open('ov-result');
    (showNext ? next : retry).focus({ preventScroll: true });
    this._playResult(r, final);
  }

  _playResult(r, final) {
    cancelAnimationFrame(this.resultFrame);
    const card = $('result-card');
    const count = $('result-count');
    const stamp = $('result-stamp');
    const tier = r.stars || 0;
    const newBest = !!r.newBest && final > 0;
    const fx = tier || (newBest ? (r.mode === MODES.ENDLESS ? 2 : 1) : 0);
    const stars = [...$('result-stars').children].slice(0, tier);
    const calm = this.app.store.settings.reducedMotion || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const marks = [r.target || 0, 0.75 * r.reachable || 0, 0.9 * r.reachable || 0].slice(0, tier).map((m) => Math.min(final, m));
    for (let i = 1; i < marks.length; i++) marks[i] = Math.max(marks[i], marks[i - 1]);
    card.dataset.tier = fx;
    card.classList.toggle('calm', calm);
    card.classList.remove('landed');
    stamp.hidden = true;
    $('result-sparkles').replaceChildren();
    $('result-fountain').replaceChildren();
    const light = (i) => {
      if (stars[i].classList.contains('on')) return;
      stars[i].classList.add('on');
      if (calm) return;
      this.app.audio.play('star', i);
      this._starBurst(stars[i]);
    };
    const land = () => {
      count.textContent = fmt(final);
      stars.forEach((_, i) => light(i));
      card.classList.add('landed');
      stamp.hidden = !newBest;
      this._sparkle(SPARKLES[fx], calm);
      if (!calm) this._fountain(FOUNTAIN[fx] || 0);
      if (tier === 3) this.app.audio.play('jackpot');
      else if (newBest) this.app.audio.play('cash');
    };
    if (calm || final <= 0) return land();
    const duration = 900 + 250 * tier;
    const start = performance.now() + 450;
    count.textContent = '0';
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const value = Math.round(final * (1 - (1 - t) ** 3));
      count.textContent = fmt(value);
      if (t > 0 && t < 1) this.app.audio.play('tick', t);
      stars.forEach((_, i) => value >= marks[i] && light(i));
      if (t < 1) this.resultFrame = requestAnimationFrame(step);
      else land();
    };
    this.resultFrame = requestAnimationFrame(step);
  }

  _sparkle(spec, calm) {
    if (!spec) return;
    const layer = $('result-sparkles');
    const w = layer.clientWidth / 2;
    const h = layer.clientHeight / 2;
    const ring = (kind, n) => {
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const reach = kind === 'burst' ? 0.7 + Math.random() * 0.4 : 0.6 + Math.random() * 0.35;
        const size = spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]);
        spark(layer, kind, {
          '--tx': `${(Math.cos(angle) * reach * w).toFixed(1)}px`,
          '--ty': `${(Math.sin(angle) * reach * h).toFixed(1)}px`,
          '--s': `${size.toFixed(1)}px`,
          '--d': `${(kind === 'burst' ? Math.random() * 0.15 : 0.4 + Math.random() * 1.6).toFixed(2)}s`,
          '--o': spec.opacity,
        });
      }
    };
    if (!calm) ring('burst', spec.burst);
    ring('twinkle', spec.twinkle);
  }

  _starBurst(star) {
    const layer = $('result-sparkles');
    const a = star.getBoundingClientRect();
    const b = layer.getBoundingClientRect();
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const reach = 28 + Math.random() * 18;
      spark(layer, 'burst', {
        left: `${(a.left + a.width / 2 - b.left).toFixed(1)}px`,
        top: `${(a.top + a.height / 2 - b.top).toFixed(1)}px`,
        '--tx': `${(Math.cos(angle) * reach).toFixed(1)}px`,
        '--ty': `${(Math.sin(angle) * reach).toFixed(1)}px`,
        '--s': `${(6 + Math.random() * 6).toFixed(1)}px`,
        '--d': '0s',
        '--o': 1,
      });
    }
  }

  _fountain(n) {
    const layer = $('result-fountain');
    const w = layer.clientWidth;
    for (let i = 0; i < n; i++) {
      spark(layer, 'nugget', {
        '--tx': `${(((i + 0.5) / n - 0.5) * w * 0.9 + (Math.random() - 0.5) * 30).toFixed(1)}px`,
        '--up': `${(-40 - Math.random() * 50).toFixed(1)}px`,
        '--fall': `${(170 + Math.random() * 140).toFixed(1)}px`,
        '--r': `${Math.round(Math.random() * 720 - 360)}deg`,
        '--s': `${(8 + Math.random() * 10).toFixed(1)}px`,
        '--d': `${(Math.random() * 0.3).toFixed(2)}s`,
      });
    }
  }

  showContextLost() {
    this.open('ov-context');
  }

  showIntro(level, target, duration, mode = MODES.LEVEL, { terrain = null, modifier = null } = {}) {
    $('intro-level').textContent = mode === MODES.DEMO ? 'DEMO' : mode === MODES.ENDLESS ? 'ENDLESS' : mode === MODES.DAILY ? `DAILY · L${pad2(level)}` : `LEVEL ${pad2(level)}`;
    $('intro-goal').textContent = mode === MODES.DEMO
      ? terrain === 'volcano' ? 'Into the volcano — 25 seconds' : 'Try everything — no game over in the demo'
      : mode === MODES.ENDLESS
      ? 'Survive — every wave gets faster'
      : `Reach ${target} in ${clock(duration)}`;
    // The rules in play: the terrain's own rule, then this stage's weather, if any.
    const chips = [];
    if (TERRAIN_RULES[terrain]) chips.push(`<span class="rule-chip terrain-${terrain}">${GLYPH[terrain]} ${TERRAIN_RULES[terrain].rule}</span>`);
    if (MODIFIERS[modifier]) chips.push(`<span class="rule-chip mod-${modifier}">${GLYPH[modifier]} ${MODIFIERS[modifier].label}</span>`);
    $('intro-rules').innerHTML = chips.join('');
    $('intro-rules').hidden = !chips.length;
    $('intro-banner').hidden = false;
  }

  hideIntro() {
    $('intro-banner').hidden = true;
  }

  setLoading(on) {
    $('loading').hidden = !on;
  }

  // ------------------------------------------------------------------ terrain & legend

  buildLegend(icons) {
    this.icons = icons;
    $('legend-btn-img').src = icons.coin || '';
    const legend = $('legend');
    legend.replaceChildren();
    const howto = $('howto-grid');
    howto.replaceChildren();
    for (const entry of LEGEND) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const imgs = entry.types.map((t) => `<img alt="" src="${icons[t] || ''}">`).join('');
      item.innerHTML = `<div class="legend-icons">${imgs}</div><div class="t">${entry.title}</div><div class="ts">${entry.short}</div><div class="d">${entry.detail}</div>`;
      item.title = `${entry.title}: ${entry.detail}`;
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
      { types: ['split'], t: 'Split rock', d: 'Breaks in two mid-fall; +40 per half', v: 'catch' },
      { types: ['magnet'], t: 'Magnet', d: 'Pulls good rocks into the scoop for 5s', v: 'catch' },
      { types: ['mystery'], t: '? rock', d: 'A surprise: jackpot, power-up or nuisance — never a lost heart', v: 'mixed' },
      { types: ['frost'], t: 'Frost rock', d: 'Frozen wheels: half speed for 4s', v: 'avoid' },
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
    const target = st ? st.target : previewTarget(level, levelTerrain(level));
    const score = st ? (endless ? run.totalScore + (sim.phase === 'ended' ? 0 : st.score) : st.score) : 0;
    this._set('level', level, (v) => {
      h.level.textContent = v ? pad2(v) : 'DEMO';
      h.level.previousElementSibling.hidden = !v;
    });
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
