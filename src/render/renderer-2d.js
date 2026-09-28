// Canvas 2D fallback renderer. Same simulation, same logical layout, simpler visuals.
// Used automatically when WebGL cannot start, or when chosen in Settings.
import { ARENA, BASE_SCOOP_WIDTH, CART_MAX_SPEED, TICK_RATE, CLIFF, EFFECTS, LIFE, MODIFIERS, ROCK } from '../config.js';
import { cliffCells, dropXAt, dropYAt } from '../game/cliff.js';
import { Rng, hashSeed } from '../game/rng.js';
import { clonePositions } from '../game/simulation.js';
import { CART_SLICES, CART_TIERS, appearanceOf, cartSliceXs, effectBadges, revealPopup } from './appearance.js';
import { loadCartImage } from './assets.js';
import { themeInfo } from './themes.js';
import { drawBottle, drawEmblem, labelCanvas, makeCanvas, veinCanvas } from './emblems.js';

const DT = 1 / TICK_RATE;
const HW = ARENA.halfWidth;
const S = ROCK.blockScale;
const SPACING = CLIFF.columnSpacing;
const CELLS = cliffCells();
const CAM_Z = ARENA.gameZ + ARENA.cameraDistance;
const depthScale = (z) => (CAM_Z - ARENA.gameZ) / (CAM_Z - z);
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
/** Falling rocks ease down to this share of the shelf-block size once they detach. */
const FALL_SCALE = ROCK.fallingScale;
/** Falling boxes stretch to a wider card-like aspect so the marking has more room. */
const STRETCH_X = ROCK.fallingStretch.x;
const STRETCH_Y = ROCK.fallingStretch.y;
/** Each half of a split rock is drawn at this share of a whole rock. */
const HALF_SCALE = 0.8;
/** Side a pushed rock is still drifting toward (-1 / 1), or 0; split halves need no arrow. */
const driftDir = (d, T) => (d.x0 !== undefined && !d.half && T < d.driftEnd ? Math.sign(d.x - d.x0) : 0);
const STORM_COLORS = {
  ice: { top: '200,228,255', bottom: '226,244,255', edge: '190,240,255', glow: '#8fe4ff', cloud: '70,84,110', stripeBg: '20,40,70', stripe: '140,225,255', bandTop: '235,248,255', bandBottom: '190,230,255', streak: '255,255,255' },
  lava: { top: '255,110,30', bottom: '255,150,50', edge: '255,180,70', glow: '#ff7a1c', cloud: '60,48,44', stripeBg: '50,20,10', stripe: '255,140,40', bandTop: '255,190,80', bandBottom: '220,70,20', streak: '255,200,80' },
};
/** A tag pill, with an arrow toward the drift side when the rock will be pushed. */
const tagText = (tag, dir) => (dir > 0 ? `${tag.text} →` : dir < 0 ? `← ${tag.text}` : tag.text);

function rockOutline(variant) {
  const rng = new Rng(hashSeed('outline', variant));
  const pts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const r = rng.range(0.86, 1);
    pts.push([Math.cos(a) * r * 0.5 * 1.04, Math.sin(a) * r * 0.5 * 0.88]);
  }
  return pts;
}
const OUTLINES = Array.from({ length: 6 }, (_, i) => rockOutline(i));

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function tracePoly(ctx, pts, cx, cy, w, h) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * w, cy + y * h) : ctx.moveTo(cx + x * w, cy + y * h)));
  ctx.closePath();
}

export class Renderer2D {
  constructor(container, opts = {}) {
    this.kind = '2d';
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D unavailable');
    container.appendChild(this.canvas);
    this.sprites = new Map();
    this.bg = null;
    this.layout = null;
    this.themeId = 'ice';
    this.theme = themeInfo('ice');
    this.dpr = 1;
    this.quality = 'high';
    this.particles = [];
    this.popups = [];
    this.caught = new Map();
    this.clock = 0;
    this.shake = 0;
    this.impact = 0;
    this.hit = 0;
    this.cheer = 0;
    this.cartAnim = { wheel: 0, lastX: null };
    this.cloneAnims = [{ wheel: 0, lastX: null }, { wheel: 0, lastX: null }];
    this.cloneFade = 0;
    this.ghostCanvas = null;
    this.reducedMotion = !!opts.reducedMotion;
    this.schedule = null;
    /** Per-stage one-shot effects: rocks already puffed by a vent or revealed by the fog. */
    this.pushed = new Set();
    this.revealed = new Set();
    this.streaks = [];
    this.stageWind = 0;
    this.lastV = 0;
    this.cartTier = 0;
    this.bolts = [];
    this.flashLevel = 0;
    this.nextBolt = 0;
    this.stormFrozen = false;
    const rng = new Rng(hashSeed('storm2d'));
    this.snow = Array.from({ length: 70 }, () => ({ x: rng.next(), y: rng.next(), l: rng.range(0.15, 0.4), v: rng.range(0.6, 1.2) }));
  }

  setCartTier(tier) {
    if (tier === this.cartTier) return;
    this.cartTier = tier;
    this.cartSprite = null;
    const meta = CART_TIERS[tier];
    if (!meta?.sprite) return;
    loadCartImage(meta.sprite).then((img) => {
      if (img && this.cartTier === tier) this.cartSprite = { img, meta };
    });
  }

  setTheme(id) {
    this.themeId = id;
    this.theme = themeInfo(id);
    this.sprites.clear();
    this.bg = null;
  }

  setQuality(level) {
    this.quality = level;
    if (this.layout) this.resize(this.layout);
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
  }

  resize(layout) {
    this.layout = layout;
    const cap = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.canvas.width = Math.max(1, Math.round(layout.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(layout.height * this.dpr));
    this.sprites.clear();
    this.bg = null;
  }

  // ------------------------------------------------------------------ sprites

  /**
   * `stretched` bakes the wider card-like falling aspect into the body while the emblem
   * stays round; shelf rocks and icons use the natural square shape.
   */
  _rockSprite(kind, variant, px, stretched = false) {
    const key = `${kind}|${variant}|${px}|${stretched ? 'S' : 'N'}|${this.themeId}`;
    let c = this.sprites.get(key);
    if (c) return c;
    const bw = px * (stretched ? STRETCH_X : 1);
    const bh = px * (stretched ? STRETCH_Y : 1);
    const pad = Math.ceil(px * 0.2);
    c = makeCanvas(Math.ceil(bw) + pad * 2, Math.ceil(bh) + pad * 2);
    const ctx = c.getContext('2d');
    const cx = c.width / 2;
    const cy = c.height / 2 + bh * 0.04;
    const pts = OUTLINES[variant % 6];
    const T = this.theme;
    const item = kind !== 'plain' ? appearanceOf(kind) : null;
    if (item?.kind === 'bottle') {
      // The bottle keeps its natural proportions even in the stretched variant.
      drawBottle(ctx, cx, cy, px * 1.08);
      this.sprites.set(key, c);
      return c;
    }
    const base = item ? item.base : T.block[variant % T.block.length];
    // Body with a lit top-left and shaded bottom-right.
    tracePoly(ctx, pts, cx, cy, bw, bh);
    const g = ctx.createLinearGradient(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2);
    g.addColorStop(0, shade(base, 0.12));
    g.addColorStop(1, shade(base, -0.14));
    ctx.fillStyle = g;
    ctx.fill();
    if (item) {
      ctx.save();
      tracePoly(ctx, pts, cx, cy, bw, bh);
      ctx.clip();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(veinCanvas(item.base, item.vein, hashSeed('vein2d', kind), { size: 128, detail: this.opts.images?.boulderDetail }), cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1, px * 0.035);
    ctx.strokeStyle = 'rgba(20,18,16,0.55)';
    tracePoly(ctx, pts, cx, cy, bw, bh);
    ctx.stroke();
    // Cap.
    if (T.capKind !== 'none') {
      ctx.beginPath();
      ctx.ellipse(cx, cy - bh * 0.34, bw * 0.4, bh * 0.13, 0, Math.PI, 0);
      ctx.quadraticCurveTo(cx + bw * 0.2, cy - bh * 0.28, cx, cy - bh * 0.3);
      ctx.quadraticCurveTo(cx - bw * 0.2, cy - bh * 0.26, cx - bw * 0.4, cy - bh * 0.34);
      ctx.fillStyle = T.cap;
      ctx.fill();
    }
    // Emblem: round in both variants; in the stretched card it nearly fills the face height.
    if (item) drawEmblem(ctx, kind, cx, cy + bh * 0.03, px * (stretched ? 0.68 : 0.78));
    this.sprites.set(key, c);
    return c;
  }

  _labelSprite(text, style) {
    const key = `L|${text}|${style.fg}|${style.bg}`;
    let c = this.sprites.get(key);
    if (!c) {
      c = labelCanvas(text, style);
      this.sprites.set(key, c);
    }
    return c;
  }

  // ------------------------------------------------------------------ background

  _buildBackground() {
    const L = this.layout;
    const T = this.theme;
    const c = makeCanvas(this.canvas.width, this.canvas.height);
    const ctx = c.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    const s = L.pxPerUnit;
    const P = (x, y) => L.toScreen(x, y);
    const rng = new Rng(hashSeed('bg2d'));

    const sky = ctx.createLinearGradient(0, 0, 0, L.height);
    sky.addColorStop(0, T.sky[0]);
    sky.addColorStop(0.55, T.sky[1]);
    sky.addColorStop(1, T.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, L.width, L.height);

    // Distant mountains.
    for (let i = 0; i < 9; i++) {
      const x = -40 + i * 10 + rng.range(-3, 3);
      const base = P(x, 12);
      const peak = P(x + rng.range(-2, 2), 20 + rng.range(0, 10));
      const half = rng.range(8, 13) * s;
      ctx.beginPath();
      ctx.moveTo(base.x - half, base.y + 40 * s);
      ctx.lineTo(peak.x, peak.y);
      ctx.lineTo(base.x + half, base.y + 40 * s);
      ctx.fillStyle = T.mountain;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(peak.x - half * 0.3, peak.y + half * 0.45);
      ctx.lineTo(peak.x + half * 0.3, peak.y + half * 0.45);
      ctx.fillStyle = T.mountainTop;
      ctx.fill();
    }

    // Central wall pillars.
    for (let x = -(HW + 4); x < HW + 4; ) {
      const w = rng.range(1, 1.7) * S;
      const tl = P(x, 30);
      ctx.fillStyle = rng.pick(T.wall);
      ctx.fillRect(tl.x, tl.y, w * s + 1, 34 * s);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(tl.x + w * s * 0.75, tl.y, w * s * 0.25, 34 * s);
      x += w;
    }

    const block = (x, y, scale = 1, color, cap = true) => {
      const px = Math.round(1.36 * S * s * scale);
      const q = P(x, y);
      const sprite = this._plainBlock(color, px, cap);
      ctx.drawImage(sprite, q.x - sprite.width / 2 / this.dpr, q.y - sprite.height / 2 / this.dpr, sprite.width / this.dpr, sprite.height / this.dpr);
    };
    const caps = T.capKind !== 'none';

    // Upper cliff blocks (smaller as they recede).
    for (let r = 10; r >= 0; r--) {
      const y = 11.9 + r * 1.12 * S;
      const sc = depthScale(-3.3 - r * 0.3);
      for (let x = -(HW + 4) + (r % 2 ? SPACING / 2 : 0); x <= HW + 4; x += SPACING) block(x * sc, 6.5 + (y - 6.5) * sc, sc, rng.pick(T.block), caps);
    }
    // Shelf ledges and dark sockets.
    CLIFF.rows.forEach((row) => {
      const sc = depthScale(row.z);
      for (let x = -(HW + 1.4); x <= HW + 1.4; x += 1.2 * S) block(x, row.y - 0.78 * S * sc, sc * 0.9, shade(T.block[0], -0.1), false);
    });
    for (const cell of CELLS) {
      const q = P(cell.x, cell.y);
      const sc = depthScale(cell.z) * s * S;
      ctx.fillStyle = '#1f2227';
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, 0.56 * sc, 0.46 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Side cliffs.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 16; i++) {
        const x = side * (HW + 1.4 + i * 1.45 * S);
        const top = i < 4 ? rng.range(8, 13) : rng.range(3, 12);
        for (let y = -1.3; y < top; y += 1.14 * S) block(x, y, 1.05, rng.pick(T.block), caps && y + 1.2 >= top);
        this._tree(ctx, P(x, top + 0.2), s, T);
      }
    }
    // Ground.
    const g0 = P(-60, -1.9);
    ctx.fillStyle = T.groundRock;
    ctx.fillRect(0, g0.y, L.width, L.height - g0.y);
    ctx.fillStyle = T.ground;
    ctx.fillRect(0, g0.y - 0.12 * s, L.width, 0.35 * s);
    for (let row = 0; row < 4; row++) {
      for (let x = -30 + (row % 2) * 0.7; x <= 30; x += 1.5 * S) block(x, -2.5 - row * 1.12, 1.12, rng.pick(T.block), caps && row === 0);
    }
    // Rail.
    const railHalf = HW + 1.8;
    const r0 = P(-(HW + 1.6), -1.78);
    const r1 = P(HW + 1.6, -1.78);
    const sleeperGaps = Math.round((railHalf * 2) / 0.7);
    for (let i = 0; i <= sleeperGaps; i++) {
      const q = P(-railHalf + (i * railHalf * 2) / sleeperGaps, -1.9);
      ctx.fillStyle = '#4d3d31';
      ctx.fillRect(q.x - 0.1 * s, q.y - 0.05 * s, 0.2 * s, 0.12 * s);
    }
    ctx.fillStyle = T.rail;
    ctx.fillRect(r0.x, r0.y - 0.06 * s, r1.x - r0.x, 0.1 * s);
    const bracketGaps = Math.round(((HW + 1) * 2) / 1.8);
    for (let i = 0; i <= bracketGaps; i++) {
      const q = P(-(HW + 1) + (i * (HW + 1) * 2) / bracketGaps, -1.86);
      ctx.fillStyle = '#e7732b';
      ctx.fillRect(q.x - 0.16 * s, q.y - 0.1 * s, 0.32 * s, 0.24 * s);
    }
    for (const side of [-1, 1]) {
      const q = P(side * (HW + 1.75), -1.55);
      ctx.fillStyle = '#e7732b';
      ctx.fillRect(q.x - 0.15 * s, q.y - 0.28 * s, 0.3 * s, 0.55 * s);
    }
    this.bg = c;
  }

  _plainBlock(color, px, cap) {
    const key = `B|${color}|${px}|${cap}|${this.themeId}`;
    let c = this.sprites.get(key);
    if (c) return c;
    const pxd = Math.max(4, Math.round(px * this.dpr));
    const pad = Math.ceil(pxd * 0.2);
    c = makeCanvas(pxd + pad * 2, pxd + pad * 2);
    const ctx = c.getContext('2d');
    const cx = c.width / 2;
    const cy = c.height / 2;
    const pts = OUTLINES[(px * 7) % 6];
    tracePoly(ctx, pts, cx, cy, pxd * 1.05, pxd * 0.95);
    const g = ctx.createLinearGradient(cx - pxd / 2, cy - pxd / 2, cx + pxd / 2, cy + pxd / 2);
    g.addColorStop(0, shade(color.startsWith('#') ? color : '#888888', 0.1));
    g.addColorStop(1, shade(color.startsWith('#') ? color : '#888888', -0.15));
    ctx.fillStyle = color.startsWith('#') ? g : color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(1, pxd * 0.03);
    ctx.stroke();
    if (cap) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - pxd * 0.36, pxd * 0.42, pxd * 0.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.cap;
      ctx.fill();
    }
    this.sprites.set(key, c);
    return c;
  }

  _tree(ctx, q, s, T) {
    if (T.treeKind === 'pine') {
      for (let i = 0; i < 3; i++) {
        const w = (0.62 - i * 0.14) * s;
        const y = q.y - (0.55 + i * 0.5) * s;
        ctx.beginPath();
        ctx.moveTo(q.x - w, y);
        ctx.lineTo(q.x, y - 0.9 * s);
        ctx.lineTo(q.x + w, y);
        ctx.fillStyle = T.tree;
        ctx.fill();
        if (T.capKind === 'snow') {
          ctx.beginPath();
          ctx.moveTo(q.x - w * 0.35, y - 0.55 * s);
          ctx.lineTo(q.x, y - 0.9 * s);
          ctx.lineTo(q.x + w * 0.35, y - 0.55 * s);
          ctx.fillStyle = '#f2f6fa';
          ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = T.tree;
      ctx.beginPath();
      ctx.arc(q.x, q.y - 0.25 * s, 0.35 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ events

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'stageStart') {
        this.particles.length = 0;
        this.popups.length = 0;
        this.caught.clear();
        this.pushed.clear();
        this.revealed.clear();
        this.streaks.length = 0;
        this.cloneFade = 0;
        this.minerFall = null;
        this.bolts.length = 0;
        this.flashLevel = 0;
        this.stormFrozen = false;
        this.stormKind = e.terrain === 'volcano' ? 'lava' : 'ice';
      } else if (e.type === 'stormWarn') {
        const lava = this.stormKind === 'lava';
        this.popups.push({ text: lava ? 'ERUPTION!' : '⚡ STORM', color: lava ? '#ffb040' : '#bfeaff', x: e.x, y: 3.4, life: 1 });
        if (lava && !this.reducedMotion) this.shake = Math.max(this.shake, 0.25);
      } else if (e.type === 'stormStrike') {
        this._strike(e.x, true);
        if (!this.reducedMotion) this.shake = Math.max(this.shake, this.stormKind === 'lava' ? 0.35 : 0.2);
      } else if (e.type === 'stormHit' && e.damage) {
        this._strike(e.x);
        if (this.stormKind === 'lava') {
          this._flameBlast(e.x, false);
          this.popups.push({ text: 'BURNED −1 ♥', color: '#ff7a2a', x: e.x, y: 1.3, life: 1 });
        } else {
          this._burst(e.x, 0.3, ['#ffffff', '#bfeaff', '#8fd8ff'], 24, 5);
          this.popups.push({ text: 'FROZEN −1 ♥', color: '#bfeaff', x: e.x, y: 1.3, life: 1 });
        }
        this.hit = 0.6;
        if (!this.reducedMotion) this.shake = 0.35;
      } else if (e.type === 'stormHit') {
        this._strike(e.x, true);
        this._burst(e.x, 0.3, ['#ffffff', '#bfeaff', '#8fd8ff'], 34, 6);
        this.popups.push({ text: 'FROZEN!', color: '#bfeaff', x: e.x, y: 1.3, life: 1 });
        this.stormFrozen = true;
        this.minerFall = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
        this.hit = 0.9;
        if (!this.reducedMotion) this.shake = 0.6;
      } else if (e.type === 'effectEnd' && e.effect === 'clone') {
        this._clonePuff();
      } else if (e.type === 'split') {
        const a = appearanceOf('split');
        this._burst(e.x, e.y, [a.base, ...a.particle], 12, 2);
      } else if (e.type === 'catch') {
        const a = appearanceOf(e.itemType);
        this.impact = 1;
        if (e.itemType === 'demon' && e.fatal) {
          // The demon detonates ON the cart: a big flaming blast throws the miner out of
          // the tub onto the ground, then the GAME OVER card follows.
          this._burst(e.cartX, 0.3, a.particle, 30, 7);
          this._flameBlast(e.cartX, true);
          this.minerFall = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
          this.popups.push({ text: 'GAME OVER', color: '#ff3d5c', x: e.cartX, y: 1.2, life: 1 });
          this.hit = 0.9;
          if (!this.reducedMotion) this.shake = 0.6;
        } else if (e.itemType === 'fire' || e.itemType === 'demon') {
          // A regular blast: flames on the cart and a hard rattle, but the run continues.
          if (!e.blocked) this._flameBlast(e.cartX, false);
          else this._burst(e.cartX, 0.3, ['#ffc04a', '#ffffff'], 12, 3);
          this.popups.push({ text: e.blocked ? 'SAFE' : a.popup, color: a.popupColor, x: e.cartX, y: 1, life: 1 });
          if (!e.blocked) {
            this.hit = 0.6;
            if (!this.reducedMotion) this.shake = 0.35;
          }
        } else {
          // Rocks caught by a shadow clone settle into that clone's scoop.
          const scoop = e.scoop || 0;
          const cartX = scoop ? e.cartX : this.cartX ?? e.cartX;
          // Caught on first touch (rim edge or tub side): settle in from that spot.
          const fromOffset = e.x - cartX;
          // Keep the geometry variant the rock fell as, so its shape never pops when caught.
          const drop = this.schedule?.drops.find((d) => d.id === e.id);
          const variant = ((drop?.cellId ?? 0) * 5 + 1) % 6;
          const size = drop?.half ? HALF_SCALE : 1;
          this.caught.set(e.id, { type: e.itemType, variant, size, t: 0, scoop, offset: Math.max(-0.7, Math.min(0.7, fromOffset)), fromOffset, fromY: e.y ?? 0.1, fx: false });
          // A mystery rock announces what it turned out to be.
          if (e.reveal) {
            const jackpot = e.reveal === 'jackpot';
            this.popups.push({ text: jackpot ? `JACKPOT +${e.score}` : revealPopup(e.reveal), color: jackpot ? '#ffd35a' : appearanceOf(e.reveal).popupColor, x: e.x, y: 0.95, life: 1 });
          } else this.popups.push({ text: e.score ? `+${e.score}` : a.popup, color: a.popupColor, x: e.x, y: 0.95, life: 1 });
          if (e.pulled) this._burst(e.x, e.y ?? 0.4, ['#8fe4ff', '#ffffff'], 8, 1.4);
          if (e.effect === 'clone' && !e.refreshed) this._clonePuff();
          if (e.itemType === 'cash' || e.itemType === 'shield' || e.effect === 'multiplier' || e.effect === 'clone' || e.effect === 'magnet' || e.reveal === 'jackpot') this.cheer = 0.75;
        }
      } else if (e.type === 'ground') {
        const a = appearanceOf(e.itemType);
        this._burst(e.x, ARENA.floorY - 0.2, [a.base, a.vein, '#ffffff'], 10, 2.4);
      } else if (e.type === 'detach') {
        const cell = CELLS[e.cellId];
        this._burst(cell.x, cell.y - 0.3, [this.theme.cap, '#ffffff'], 8, 1.2);
      } else if (e.type === 'restore') {
        this._burst(this.cartX ?? 0, 0.4, ['#ff5a6a', '#ffd35a', '#ffffff'], 20, 3);
        this.popups.push({ text: '+1 ♥', color: '#ff8a9a', x: this.cartX ?? 0, y: 1.1, life: 1 });
      }
    }
  }

  _clonePuff() {
    if (this.cartX === undefined) return;
    for (const x of clonePositions(this.cartX, this.cartWidth ?? 2.56)) this._burst(x, -0.5, ['#c8d0ff', '#8a93c8', '#eef0ff'], 14, 1.6);
  }

  /** Flickering fire glow around a falling demon, with flames licking off it. */
  _demonAura(d, y, time, dt) {
    const q = this.layout.toScreen(d.x, y);
    const s = this.layout.pxPerUnit;
    const r = (0.72 + Math.sin(time * 12 + d.id) * 0.12) * s;
    const g = this.ctx.createRadialGradient(q.x, q.y, r * 0.15, q.x, q.y, r);
    g.addColorStop(0, 'rgba(255,120,40,0.5)');
    g.addColorStop(0.6, 'rgba(255,60,40,0.22)');
    g.addColorStop(1, 'rgba(255,40,40,0)');
    this.ctx.fillStyle = g;
    this.ctx.beginPath();
    this.ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    if (!this.reducedMotion && Math.random() < dt * 22) {
      this.particles.push({
        x: d.x + (Math.random() - 0.5) * 0.5,
        y: y + (Math.random() - 0.2) * 0.3,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 1.6 + Math.random() * 1.4,
        life: 0.3 + Math.random() * 0.25,
        color: ['#ff7417', '#ffc04a', '#ff2f4e'][(Math.random() * 3) | 0],
        r: 0.07 + Math.random() * 0.07,
      });
    }
  }

  /** Fireball with rising flames and smoke on the cart (big = the demon's fatal one). */
  _flameBlast(x, big) {
    const n = this.quality === 'low' || this.reducedMotion ? 0.5 : 1;
    this._burst(x, 0.35, ['#ffffff', '#ffe08a', '#ffc04a'], Math.round((big ? 18 : 10) * n), big ? 5 : 3.5);
    for (let i = 0; i < Math.round((big ? 26 : 14) * n); i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * (big ? 1.2 : 0.8),
        y: 0.2 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 1.4,
        vy: 1.8 + Math.random() * 2.4,
        life: 0.35 + Math.random() * 0.3,
        color: ['#ff7417', '#ff3d12', '#ffd94a'][i % 3],
        r: 0.09 + Math.random() * (big ? 0.12 : 0.08),
      });
    }
    for (let i = 0; i < Math.round((big ? 10 : 4) * n); i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.8,
        y: 0.5 + Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 1.2 + Math.random(),
        life: 0.8 + Math.random() * 0.5,
        color: i % 2 ? '#4a3a34' : '#2a2124',
        r: 0.16 + Math.random() * 0.12,
      });
    }
  }

  _burst(x, y, colors, count, speed) {
    const n = Math.round(count * (this.quality === 'low' ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.3, color: colors[i % colors.length], r: 0.06 + Math.random() * 0.08 });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  // ------------------------------------------------------------------ frame

  render(view) {
    const L = this.layout;
    if (!L) return;
    const { sim, alpha } = view;
    const dt = view.paused ? 0 : Math.min(0.1, view.frameDt || 0);
    this.clock += dt;
    const ctx = this.ctx;
    if (!this.bg) this._buildBackground();
    const s = L.pxPerUnit;
    const st = sim.stage;
    const T = st ? Math.max(0, (st.tick - 1 + alpha) * DT) : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake > 0 ? this.shake * 8 : 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, Math.sin(view.time * 60) * sh * this.dpr, 0);

    if (st?.schedule !== this.schedule) {
      this.schedule = st?.schedule || null;
      this.byCell = new Map();
      if (this.schedule) {
        for (const d of this.schedule.drops) {
          if (!this.byCell.has(d.cellId)) this.byCell.set(d.cellId, []);
          this.byCell.get(d.cellId).push(d);
        }
      }
    }

    const sch = st?.schedule;
    const fw = sch?.fogWindow;
    const fogLevel = sch?.modifier === 'fog' ? 1 : fw ? Math.max(0, Math.min(1, (T - fw[0]) / 0.6, (fw[1] - T) / 0.6)) : 0;
    const fog = fogLevel > 0.5;
    this.stageWind = sch?.modifier === 'windy' || (sch?.windWindow && T >= sch.windWindow[0] && T < sch.windWindow[1]) ? sch.wind : 0;
    this._drawLife(ctx, dt, view.time);
    this._drawWater(ctx, view.time);

    // Shelf cells.
    for (const cell of CELLS) {
      const list = this.byCell?.get(cell.id);
      let drop = null;
      if (list) for (const d of list) if (d.crackAt <= T) drop = d;
      const sc = depthScale(cell.z);
      const variant = (cell.id * 5 + 1) % 6;
      if (drop && T < drop.detachAt) {
        const p = (T - drop.crackAt) / (drop.detachAt - drop.crackAt);
        const amp = (this.reducedMotion ? 0.01 : 0.04) * p;
        // Shelf rocks sit at the same card scale the falling boxes use; fog hides the marking.
        this._drawRock(fog ? 'plain' : drop.type, variant, cell.x + Math.sin(view.time * 70) * amp, cell.y, FALL_SCALE * sc, 0, true);
        // Announce what is coming while the rock is still shaking loose, with an arrow when a
        // vent or the wind will push it.
        const tag = appearanceOf(drop.type).tag;
        if (tag && p > 0.2 && !fog) this._drawLabel(tagText(tag, driftDir(drop, T)), cell.x, cell.y + 0.75, 0.44, tag);
        continue;
      }
      if (drop && T < drop.refillAt) continue;
      let k = 1;
      if (drop && T < drop.refillEndAt) k = 0.6 + 0.4 * easeOut((T - drop.refillAt) / (drop.refillEndAt - drop.refillAt));
      this._drawRock('plain', variant, cell.x, cell.y, FALL_SCALE * sc * k, 0, true);
    }

    // Cart.
    const cart = sim.cart;
    const cartX = cart ? cart.prevX + (cart.x - cart.prevX) * alpha : 0;
    const width = cart ? cart.prevWidth + (cart.width - cart.prevWidth) * alpha : BASE_SCOOP_WIDTH;
    this.cartX = cartX;
    this.cartWidth = width;
    const timers = sim.effectTimers();
    const frozen = (!!st && sim.isFrozen()) || this.stormFrozen;
    this._drawClones(timers.cloneSeconds, cartX, width, cart?.v || 0, view.time, dt);
    if (timers.magnetSeconds > 0) this._drawMagnet(cartX, width, timers.magnetSeconds);
    this._drawCart(ctx, cartX, width, cart?.v || 0, st && sim.isInvulnerable(), view.time, dt, this.cartAnim, frozen);
    const cloneXs = clonePositions(cartX, width);
    this._iceSpray(st, cart?.v || 0, cartX, dt);

    // Falling rocks, drawn after the cart so they pass in front of the miner.
    if (st) {
      for (const d of st.falling) {
        if (T < d.detachAt) continue;
        if (d.half === 1 && T < d.driftStart) continue; // the second half appears at the split
        const tau = T - d.detachAt;
        const cell = CELLS[d.cellId];
        const split = d.half && T >= d.driftStart;
        // Same card scale as on the shelf; only the depth cue eases out as it comes forward.
        const ds = depthScale(cell.z);
        const sc = FALL_SCALE * (ds + (1 - ds) * easeOut(tau / 0.35)) * (split ? HALF_SCALE : 1);
        const y = dropYAt(d, T);
        const x = dropXAt(d, T);
        const fogged = fog && y > MODIFIERS.fog.line;
        if (fog && !fogged && !this.revealed.has(d.id)) {
          this.revealed.add(d.id);
          this._burst(x, y, ['#f2f5f8', '#dfe5ec'], 6, 1);
        }
        if (d.x0 !== undefined && !d.half && T >= d.driftStart && !this.pushed.has(d.id)) {
          this.pushed.add(d.id);
          if (st.terrain === 'volcano' && st.modifier !== 'windy') this._burst(x, y - 0.3, ['#ff9a3c', '#ffd27a', '#8a7f7a'], 8, 1.4);
        }
        // The demon burns: a flickering glow behind it and flames licking upward.
        if (d.type === 'demon' && !fogged) this._demonAura({ id: d.id, x }, y, view.time, dt);
        this._drawRock(fogged ? 'plain' : d.type, (d.cellId * 5 + 1) % 6, x, y, sc, Math.sin(T * 1.9 + d.id) * 0.12, true);
        // The rock is small while falling: the floating tag does the real explaining.
        const tag = appearanceOf(d.type).tag;
        if (tag && !fogged && !split) this._drawLabel(tagText(tag, driftDir(d, T)), x, y + 0.75, 0.44, tag);
      }
    }
    this._drawStorm(ctx, st?.schedule?.storms, T, dt, view.time);
    if (fogLevel > 0.01) {
      ctx.globalAlpha = fogLevel;
      this._drawFog();
      ctx.globalAlpha = 1;
    }
    if (this.stageWind) this._drawWind(dt);

    // Caught rocks settling in the scoop, then dissolving.
    for (const [id, c] of this.caught) {
      c.t += dt;
      if (c.t > 0.42) {
        this.caught.delete(id);
        continue;
      }
      const scoopX = c.scoop ? cloneXs[c.scoop < 0 ? 0 : 1] : cartX;
      if (c.t > 0.24 && !c.fx) {
        c.fx = true;
        this._burst(scoopX + c.offset, 0.3, appearanceOf(c.type).particle, 16, 3);
      }
      const sink = easeOut(c.t / 0.12);
      const k = FALL_SCALE * 0.86 * (1 - Math.max(0, (c.t - 0.24) / 0.18) * 0.85) * (c.size ?? 1);
      const offset = c.fromOffset + (c.offset - c.fromOffset) * sink;
      this._drawRock(c.type, c.variant ?? 1, scoopX + offset, c.fromY + (-0.2 - c.fromY) * sink, k, 0, true);
    }

    // Effect badges above the cart.
    let badgeY = 1.45;
    for (const b of effectBadges(timers)) {
      this._drawLabel(b.text, cartX, badgeY, 0.5, b.style);
      badgeY += 0.62;
    }

    // Particles and popups.
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= 5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) continue;
      const q = L.toScreen(p.x, p.y);
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, p.r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.life -= dt / 0.95;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      this._drawLabel(p.text, p.x, p.y + (1 - p.life) * 1.3, 0.82, { fg: p.color, stroke: 'rgba(24,34,46,0.92)', height: 80 });
    }
    ctx.globalAlpha = 1;
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  _drawRock(kind, variant, x, y, scale = 1, rot = 0, stretched = false) {
    const s = this.layout.pxPerUnit;
    const px = Math.max(8, Math.round(1.36 * S * s * this.dpr));
    const sprite = this._rockSprite(kind, variant, px, stretched);
    const q = this.layout.toScreen(x, y);
    const w = (sprite.width / this.dpr) * scale;
    const h = (sprite.height / this.dpr) * scale;
    const ctx = this.ctx;
    if (rot) {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(rot);
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else ctx.drawImage(sprite, q.x - w / 2, q.y - h / 2, w, h);
  }

  _drawLabel(text, x, y, heightUnits, style) {
    const sprite = this._labelSprite(text, { height: 64, ...style });
    const h = heightUnits * this.layout.pxPerUnit;
    const w = (sprite.width / sprite.height) * h;
    const q = this.layout.toScreen(x, y);
    this.ctx.drawImage(sprite, q.x - w / 2, q.y - h / 2, w, h);
  }

  /**
   * Shadow clones: each is drawn at full strength into an offscreen canvas, then copied onto
   * the scene at the clone opacity, so the clone reads as one see-through cart.
   */
  _drawClones(seconds, cartX, width, v, time, dt) {
    const step = dt / 0.18;
    this.cloneFade = seconds > 0 ? Math.min(1, this.cloneFade + step) : Math.max(0, this.cloneFade - step);
    const blink = seconds > 0 && seconds < 1 && !this.reducedMotion ? 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(this.clock * 18)) : 1;
    const alpha = EFFECTS.cloneOpacity * this.cloneFade * blink;
    if (alpha <= 0.005) {
      for (const a of this.cloneAnims) a.lastX = null;
      return;
    }
    const main = this.canvas;
    if (!this.ghostCanvas || this.ghostCanvas.width !== main.width || this.ghostCanvas.height !== main.height) {
      this.ghostCanvas = makeCanvas(main.width, main.height);
    }
    const g = this.ghostCanvas.getContext('2d');
    const L = this.layout;
    const halfW = Math.max(width / 2 + 0.25, 1.25) + 0.35;
    clonePositions(cartX, width).forEach((x, i) => {
      const tl = L.toScreen(x - halfW, 0.7);
      const br = L.toScreen(x + halfW, -2);
      const sx = Math.max(0, Math.floor(tl.x * this.dpr));
      const sy = Math.max(0, Math.floor(tl.y * this.dpr));
      const sw = Math.min(main.width, Math.ceil(br.x * this.dpr)) - sx;
      const sh = Math.min(main.height, Math.ceil(br.y * this.dpr)) - sy;
      if (sw <= 0 || sh <= 0) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(sx, sy, sw, sh);
      g.setTransform(this.ctx.getTransform());
      this._drawCart(g, x, width, v, false, time, dt, this.cloneAnims[i]);
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.ghostCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.restore();
    });
  }

  /** Magnet: a glowing ring around the scoop marking how far its pull reaches. */
  _drawMagnet(cartX, width, seconds) {
    const ctx = this.ctx;
    const L = this.layout;
    const s = L.pxPerUnit;
    const reach = width / 2 + ROCK.radius * ROCK.catchOverlapFraction + EFFECTS.magnetReach;
    const c = L.toScreen(cartX, 0.2);
    const blink = seconds < 1 && !this.reducedMotion ? 0.5 + 0.5 * Math.cos(this.clock * 18) : 1;
    ctx.save();
    ctx.globalAlpha = (0.6 + (this.reducedMotion ? 0 : 0.15 * Math.sin(this.clock * 8))) * blink;
    ctx.strokeStyle = '#8fe4ff';
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.setLineDash([s * 0.3, s * 0.18]);
    ctx.lineDashOffset = this.reducedMotion ? 0 : -this.clock * s * 1.2;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, reach * s, reach * s * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Ice: snow sprays from the wheels while the cart glides and brakes. */
  _iceSpray(st, v, cartX, dt) {
    if (st?.terrain === 'ice' && dt > 0 && Math.abs(v) > 2.5 && Math.abs(v) < Math.abs(this.lastV) - 1e-3 && Math.random() < dt * 25) {
      this._burst(cartX - Math.sign(v) * 0.9, -1.7, ['#ffffff', '#e4eef7'], this.reducedMotion ? 1 : 3, 1.2);
    }
    this.lastV = v;
  }

  /** Fog stages: a bank of mist over the upper arena; rocks above the fog line show no marking. */
  _drawFog() {
    const L = this.layout;
    const ctx = this.ctx;
    const bottom = L.toScreen(0, MODIFIERS.fog.line - 0.8).y;
    const g = ctx.createLinearGradient(0, 0, 0, bottom);
    g.addColorStop(0, 'rgba(236,240,245,0.86)');
    g.addColorStop(0.72, 'rgba(236,240,245,0.62)');
    g.addColorStop(1, 'rgba(236,240,245,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.width, bottom);
  }

  /** Windy stages: streaks of blown snow crossing the arena with the wind. */
  _drawWind(dt) {
    const L = this.layout;
    const dir = this.stageWind;
    if (dt > 0 && !this.reducedMotion && Math.random() < dt * 14) {
      this.streaks.push({ x: dir > 0 ? L.view.left - 1 : L.view.right + 1, y: 1 + Math.random() * 9, v: dir * (9 + Math.random() * 4), len: 0.6 + Math.random() * 0.8 });
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(1, L.pxPerUnit * 0.035);
    ctx.lineCap = 'round';
    for (const k of this.streaks) {
      k.x += k.v * dt;
      const a = L.toScreen(k.x, k.y);
      const b = L.toScreen(k.x - Math.sign(k.v) * k.len, k.y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
    this.streaks = this.streaks.filter((k) => k.x > L.view.left - 3 && k.x < L.view.right + 3);
  }

  _strike(x, big = false) {
    if (this.stormKind === 'lava') this._erupt(x, big);
    else this._bolt(x, big);
  }

  _erupt(x, big = false) {
    const n = Math.round((big ? 26 : 12) * (this.quality === 'low' ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: x + (Math.random() - 0.5) * 0.8, y: -1.5, vx: (Math.random() - 0.5) * 3, vy: 5 + Math.random() * (big ? 5 : 3.5), life: 0.9 + Math.random() * 0.5, color: ['#ffe07a', '#ff9a2a', '#ff4a12'][i % 3], r: 0.1 + Math.random() * 0.12 });
    }
    this.flashLevel = Math.max(this.flashLevel, big ? 0.5 : 0.18);
  }

  _bolt(x, big = false) {
    const pts = [];
    let bx = x;
    for (let y = 11.5; y > -1.85; y -= 0.5 + Math.random() * 0.6) {
      pts.push([bx, y]);
      bx = x + Math.max(-1, Math.min(1, bx - x + (Math.random() - 0.5) * 1.2));
    }
    pts.push([bx, -1.85]);
    const from = pts[2 + Math.floor(Math.random() * Math.max(1, pts.length - 6))];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const branch = [from, ...[1, 2, 3].map((k) => [from[0] + dir * k * (0.4 + Math.random() * 0.3), from[1] - k * (0.5 + Math.random() * 0.4)])];
    this.bolts.push({ pts, branch, life: big ? 0.55 : 0.28, max: big ? 0.55 : 0.28, big });
    this.flashLevel = Math.max(this.flashLevel, big ? 0.6 : 0.22);
  }

  _drawStorm(ctx, storms, T, dt, time) {
    const L = this.layout;
    const s = L.pxPerUnit;
    const calm = this.reducedMotion;
    const z = storms?.find((q) => T >= q.warnAt && T <= q.endAt + 0.6);
    if (z) {
      const warn = T < z.strikeAt;
      const fade = T > z.endAt ? Math.max(0, 1 - (T - z.endAt) / 0.6) : 1;
      const p = warn ? (T - z.warnAt) / (z.strikeAt - z.warnAt) : 1;
      const blink = calm ? 0.6 : 0.5 + 0.5 * Math.sin(time * (10 + 14 * p));
      const a = L.toScreen(z.x - z.half, 11.5);
      const b = L.toScreen(z.x + z.half, -1.85);
      const w = b.x - a.x;
      const h = b.y - a.y;
      const lava = this.stormKind === 'lava';
      const C = STORM_COLORS[lava ? 'lava' : 'ice'];
      ctx.save();
      const haze = ctx.createLinearGradient(0, a.y, 0, b.y);
      const k = warn ? 0.1 + 0.16 * blink : 0.72 * fade;
      haze.addColorStop(0, `rgba(${C.top},${k * 0.45})`);
      haze.addColorStop(1, `rgba(${C.bottom},${k})`);
      ctx.fillStyle = haze;
      ctx.fillRect(a.x, a.y, w, h);
      const edge = warn ? 0.35 + 0.6 * blink : 0.5 * fade;
      for (const [lw, k] of [[Math.max(7, 0.26 * s), 0.3], [Math.max(2, 0.08 * s), 1]]) {
        ctx.strokeStyle = `rgba(${C.edge},${edge * k})`;
        ctx.lineWidth = lw;
        for (const ex of [a.x, b.x]) {
          ctx.beginPath();
          ctx.moveTo(ex, a.y);
          ctx.lineTo(ex, b.y);
          ctx.stroke();
        }
      }
      const cloud = warn ? 0.75 * p : 0.9 * fade;
      ctx.fillStyle = `rgba(${C.cloud},${cloud})`;
      for (let i = 0; i < 7; i++) {
        const cx = a.x + w * (0.05 + i * 0.15);
        const r = (0.7 + (i % 3) * 0.25) * s;
        ctx.beginPath();
        ctx.ellipse(cx, L.toScreen(0, 9.6 + (i % 2) * 0.3).y, r * 1.3, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lava && warn && dt > 0 && !calm && Math.random() < dt * 14) {
        this.particles.push({ x: z.x + (Math.random() - 0.5) * z.half * 2, y: -1.6, vx: (Math.random() - 0.5) * 0.6, vy: 2 + 3 * p + Math.random(), life: 0.6, color: Math.random() < 0.5 ? '#ffd24a' : '#ff7a1c', r: 0.06 + Math.random() * 0.05 });
      }
      const rail = L.toScreen(z.x - z.half, -1.4);
      const railH = 0.44 * s;
      if (warn) {
        ctx.beginPath();
        ctx.rect(a.x, rail.y, w, railH);
        ctx.clip();
        ctx.fillStyle = `rgba(${C.stripeBg},${0.45 + 0.4 * blink})`;
        ctx.fillRect(a.x, rail.y, w, railH);
        ctx.fillStyle = `rgba(${C.stripe},${0.55 + 0.45 * blink})`;
        const step = 0.5 * s;
        const off = calm ? 0 : ((time * 1.5 * s) % step);
        for (let sx = a.x - railH + off; sx < b.x + railH; sx += step) {
          ctx.beginPath();
          ctx.moveTo(sx, rail.y + railH);
          ctx.lineTo(sx + step / 2, rail.y + railH);
          ctx.lineTo(sx + step / 2 + railH, rail.y);
          ctx.lineTo(sx + railH, rail.y);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        const frost = ctx.createLinearGradient(0, rail.y, 0, rail.y + railH);
        frost.addColorStop(0, `rgba(${C.bandTop},0)`);
        frost.addColorStop(0.4, `rgba(${C.bandTop},${0.9 * fade})`);
        frost.addColorStop(1, `rgba(${C.bandBottom},${0.85 * fade})`);
        ctx.fillStyle = frost;
        ctx.fillRect(a.x, rail.y, w, railH);
        ctx.strokeStyle = `rgba(${C.streak},${0.9 * fade})`;
        ctx.lineWidth = Math.max(1.5, 0.05 * s);
        ctx.lineCap = 'round';
        for (const f of this.snow) {
          const fx = a.x + ((f.x - (calm ? 0 : time * 0.12 * f.v)) % 1 + 1) % 1 * w;
          const fy = a.y + ((((f.y + (calm ? 0 : (lava ? -0.6 : 0.5) * time * f.v)) % 1) + 1) % 1) * h;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx - f.l * 0.35 * s, fy + (lava ? -0.6 : 1) * f.l * s);
          ctx.stroke();
        }
        if (T < z.endAt && dt > 0 && this.clock >= this.nextBolt) {
          this._strike(z.x + (Math.random() - 0.5) * z.half * 1.4);
          this.nextBolt = this.clock + (calm ? 1.2 : 0.35 + Math.random() * 0.6);
        }
      }
      ctx.restore();
    }
    if (!this.bolts.length && this.flashLevel <= 0) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const line = (pts) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        const q = L.toScreen(px, py);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
    };
    for (const bolt of this.bolts) {
      bolt.life -= dt;
      if (bolt.life <= 0) continue;
      const flick = calm || Math.sin(time * 90) > -0.3 ? 1 : 0.35;
      const alpha = (bolt.life / bolt.max) * flick;
      ctx.strokeStyle = `rgba(127,208,255,${0.25 * alpha})`;
      ctx.lineWidth = (bolt.big ? 0.8 : 0.56) * s;
      line(bolt.pts);
      line(bolt.branch);
      ctx.strokeStyle = `rgba(127,208,255,${0.55 * alpha})`;
      ctx.lineWidth = (bolt.big ? 0.4 : 0.28) * s;
      line(bolt.pts);
      line(bolt.branch);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = (bolt.big ? 0.1 : 0.07) * s;
      line(bolt.pts);
      line(bolt.branch);
    }
    this.bolts = this.bolts.filter((bolt) => bolt.life > 0);
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.5);
    if (!calm && this.flashLevel > 0.01) {
      ctx.fillStyle = `rgba(${this.stormKind === 'lava' ? '255,150,70' : '232,246,255'},${this.flashLevel * 0.45})`;
      ctx.fillRect(0, 0, L.width, L.height);
    }
    ctx.restore();
  }

  _drawWater(ctx, time) {
    const L = this.layout;
    const s = L.pxPerUnit;
    const icy = this.theme.capKind === 'snow';
    const t = this.reducedMotion ? 0 : time;
    for (const side of [-1, 1]) {
      const a = L.toScreen(side < 0 ? -10.9 : 9.8, 6.2);
      const b = L.toScreen(side < 0 ? -9.8 : 10.9, -1.55);
      const fall = ctx.createLinearGradient(0, a.y, 0, b.y);
      fall.addColorStop(0, icy ? 'rgba(170,220,248,0)' : 'rgba(230,70,15,0)');
      fall.addColorStop(0.03, icy ? 'rgba(170,220,248,0.85)' : 'rgba(240,90,20,0.92)');
      fall.addColorStop(1, icy ? 'rgba(205,238,255,0.92)' : 'rgba(255,190,60,0.95)');
      if (!icy) {
        ctx.fillStyle = 'rgba(255,90,20,0.22)';
        ctx.fillRect(a.x - 0.25 * s, a.y + (b.y - a.y) * 0.12, b.x - a.x + 0.5 * s, (b.y - a.y) * 0.88);
      }
      ctx.fillStyle = fall;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = icy ? 'rgba(255,255,255,0.7)' : 'rgba(255,236,150,0.85)';
      ctx.lineWidth = Math.max(1, 0.05 * s);
      const h = b.y - a.y;
      for (let k = 0; k < 8; k++) {
        const x = a.x + ((k + 0.5) / 8) * (b.x - a.x);
        for (let j = 0; j < 3; j++) {
          const y = a.y + h * 0.15 + (((t * (icy ? 0.35 : 0.12) + k * 0.37 + j / 3) % 1) * h * 0.85);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, Math.min(b.y, y + 0.6 * s));
          ctx.stroke();
        }
      }
      const src = L.toScreen(side * 10.35, 6.3);
      ctx.fillStyle = icy ? 'rgba(26,30,36,0.92)' : 'rgba(70,24,8,0.92)';
      ctx.beginPath();
      ctx.ellipse(src.x, src.y, 0.75 * s, 0.4 * s, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = icy ? 'rgba(255,255,255,0.88)' : 'rgba(255,214,110,0.92)';
      ctx.beginPath();
      ctx.ellipse(src.x, src.y + 0.06 * s, 0.6 * s, 0.14 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      const p0 = L.toScreen(side < 0 ? -11.5 : 9.7, -1.25);
      const p1 = L.toScreen(side < 0 ? -9.7 : 11.5, -1.72);
      const pool = ctx.createLinearGradient(0, p0.y, 0, p1.y);
      pool.addColorStop(0, icy ? 'rgba(191,232,255,0.2)' : 'rgba(255,176,58,0.2)');
      pool.addColorStop(0.3, icy ? 'rgba(150,210,245,0.9)' : 'rgba(255,150,40,0.92)');
      pool.addColorStop(1, icy ? 'rgba(63,143,200,0.95)' : 'rgba(154,32,8,0.95)');
      ctx.fillStyle = pool;
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.fillStyle = icy ? 'rgba(255,255,255,0.7)' : 'rgba(255,230,120,0.85)';
      for (let k = 0; k < 6; k++) {
        const rx = p0.x + (((k * 0.29 + t * (icy ? 0.06 : 0.02)) % 1) * (p1.x - p0.x));
        const ry = p0.y + (0.4 + (k % 3) * 0.2) * (p1.y - p0.y);
        ctx.fillRect(rx, ry, 0.35 * s, Math.max(1, 0.03 * s));
      }
      const foam = L.toScreen(side * 10.35, -1.35);
      ctx.fillStyle = icy ? `rgba(255,255,255,${0.75 + 0.2 * Math.sin(t * 5)})` : `rgba(255,214,110,${0.75 + 0.2 * Math.sin(t * 5)})`;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.ellipse(foam.x + k * 0.22 * s, foam.y + Math.abs(k) * 0.04 * s, (0.3 + 0.03 * Math.sin(t * 7 + k)) * s, 0.16 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawCartSprite(ctx, x, width, v, invulnerable, time, dt, anim, frozen, squash) {
    const { img, meta } = this.cartSprite;
    const L = this.layout;
    const s = L.pxPerUnit;
    const h = 1.75 / (0.994 - meta.rim);
    const xs = cartSliceXs(width, BASE_SCOOP_WIDTH, h * meta.aspect);
    const lean = -Math.max(-1, Math.min(1, v / CART_MAX_SPEED)) * 0.16;
    const fall = anim === this.cartAnim ? this.minerFall : null;
    if (fall) fall.t += dt;
    const tip = fall ? Math.min(fall.t / 0.5, 1) : 0;
    const o = L.toScreen(x, -squash + (this.cheer > 0 ? 0.1 : 0) - tip * 0.25);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(-lean * 0.3 + (fall ? fall.dir * tip * 0.45 : 0));
    if (invulnerable) {
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = 10 + (this.reducedMotion ? 0 : Math.sin(time * 9) * 4);
    }
    if (this.hit > 0 && anim === this.cartAnim) ctx.filter = 'sepia(0.6) saturate(3) hue-rotate(-30deg)';
    else if (frozen) ctx.filter = 'saturate(0.35) brightness(1.25)';
    const top = -meta.rim * h * s;
    const iw = img.naturalWidth;
    for (let i = 0; i < CART_SLICES.length - 1; i++) {
      const dw = (xs[i + 1] - xs[i]) * s;
      if (dw > 0.5) ctx.drawImage(img, CART_SLICES[i] * iw, 0, (CART_SLICES[i + 1] - CART_SLICES[i]) * iw, img.naturalHeight, xs[i] * s, top, dw + 0.5, h * s);
    }
    ctx.restore();
  }

  _drawCart(ctx, x, width, v, invulnerable, time, dt, anim = this.cartAnim, frozen = false) {
    const L = this.layout;
    const s = L.pxPerUnit;
    const P = (px, py) => L.toScreen(x + px, py);
    if (anim.lastX === null) anim.lastX = x;
    anim.wheel -= (x - anim.lastX) / 0.34;
    anim.lastX = x;
    // Impact, hit, and cheer timers belong to the real cart; clones only mirror them.
    if (anim === this.cartAnim) {
      this.impact = Math.max(0, this.impact - dt * 5);
      this.hit = Math.max(0, this.hit - dt);
      this.cheer = Math.max(0, this.cheer - dt);
    }
    const squash = Math.sin(this.impact * Math.PI) * 0.08;

    const rect = (px, py, w, h, color) => {
      const q = P(px - w / 2, py + h / 2);
      ctx.fillStyle = color;
      ctx.fillRect(q.x, q.y, w * s, h * s);
    };
    const disc = (cx, cy, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (this.cartSprite) {
      this._drawCartSprite(ctx, x, width, v, invulnerable, time, dt, anim, frozen, squash);
      return;
    }
    const tier = CART_TIERS[this.cartTier] && !CART_TIERS[this.cartTier].sprite ? CART_TIERS[this.cartTier] : CART_TIERS[0];

    if (invulnerable) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = 10 + (this.reducedMotion ? 0 : Math.sin(time * 9) * 4);
    }

    // Miner riding in the tub (drawn first so the tub front hides his lower half).
    // Local units: 1 = one world unit, y up; the canvas y axis points down.
    const lean = -Math.max(-1, Math.min(1, v / CART_MAX_SPEED)) * 0.16;
    const cheer = this.cheer > 0 ? 1 : 0;
    const flinch = this.hit > 0 ? Math.sin(this.hit * 30) * 0.03 : 0;
    const origin = P(0, -0.08 - squash);
    // Demon blast: the miner arcs out of the tub and lies beside the rail (real cart only).
    const fall = anim === this.cartAnim ? this.minerFall : null;
    if (fall) fall.t += dt;
    const ft = fall ? Math.min(fall.t, 1.6) : 0;
    const flight = Math.min(ft, 0.85);
    const fallX = fall ? fall.dir * 1.8 * flight : 0;
    const fallY = fall ? Math.max(3.4 * ft - 6.2 * ft * ft, -1.4) : 0;
    const fallRot = fall ? fall.dir * Math.min(ft / 0.85, 1) * 1.75 : 0;
    const miner = (draw) => {
      ctx.save();
      ctx.translate(origin.x + fallX * s, origin.y - fallY * s);
      ctx.rotate(-lean + fallRot);
      ctx.scale(s * 1.45, s * 1.45); // same miner scale as the 3D cart
      draw();
      ctx.restore();
    };
    miner(() => {
      ctx.fillStyle = '#557394';
      ctx.beginPath();
      ctx.roundRect(-0.31, -0.39, 0.62, 0.62, 0.12);
      ctx.fill();
      ctx.fillStyle = '#7b4a2a';
      ctx.fillRect(-0.2, -0.24, 0.4, 0.34);
      ctx.fillRect(-0.185, -0.45, 0.07, 0.24);
      ctx.fillRect(0.115, -0.45, 0.07, 0.24);
      const hy = -0.62 - flinch - cheer * 0.04;
      for (const x of [-0.19, 0.19]) disc(x, hy + 0.03, 0.07, '#c0571f');
      disc(0, hy, 0.19, '#eab48f');
      ctx.fillStyle = '#c0571f';
      ctx.beginPath();
      ctx.ellipse(0, hy + 0.17, 0.21, 0.23, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9a4318';
      for (const x of [-0.065, 0.065]) {
        ctx.beginPath();
        ctx.ellipse(x, hy + 0.06, 0.085, 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 0.05, hy - 0.11, 0.1, 0.035);
      }
      disc(0, hy + 0.01, 0.055, '#e09a78');
      for (const x of [-0.07, 0.07]) disc(x, hy - 0.045, 0.024, '#26292e');
      ctx.fillStyle = '#8b939b';
      ctx.beginPath();
      ctx.arc(0, hy - 0.08, 0.215, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-0.27, hy - 0.1, 0.54, 0.035);
      disc(0, hy - 0.17, 0.052, '#26292e');
      disc(0, hy - 0.17, 0.038, '#fff3b0');
    });

    // Riveted steel tub: the catcher. Its open top is the scoop and scales with the width.
    const top = P(0, 0 - squash);
    const hw = (width / 2) * s;
    const bw = hw * 0.8;
    const depth = 1.2 * s;
    const tub = () => {
      ctx.beginPath();
      ctx.moveTo(top.x - hw, top.y);
      ctx.lineTo(top.x + hw, top.y);
      ctx.lineTo(top.x + bw, top.y + depth);
      ctx.lineTo(top.x - bw, top.y + depth);
      ctx.closePath();
    };
    const painted = tier !== CART_TIERS[0];
    const steel = ctx.createLinearGradient(0, top.y, 0, top.y + depth);
    steel.addColorStop(0, painted ? shade(tier.tub, -0.05) : '#9aa2aa');
    steel.addColorStop(0.6, painted ? shade(tier.tub, -0.2) : '#7f878f');
    steel.addColorStop(1, painted ? shade(tier.tub, -0.38) : '#5e656c');
    tub();
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.save();
    tub();
    ctx.clip();
    for (const [fx, fy, r] of painted ? [] : [[-0.6, 0.7, 0.28], [0.45, 0.8, 0.22], [0.05, 0.45, 0.16], [0.85, 0.55, 0.18]]) {
      const cx = top.x + fx * hw;
      const cy = top.y + fy * depth;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * s);
      g.addColorStop(0, 'rgba(176,92,38,0.55)');
      g.addColorStop(1, 'rgba(176,92,38,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r * s, cy - r * s, r * 2 * s, r * 2 * s);
    }
    ctx.strokeStyle = '#50565d';
    ctx.lineWidth = 0.09 * s;
    for (const f of [-0.93, -0.33, 0.33, 0.93]) {
      ctx.beginPath();
      ctx.moveTo(top.x + f * hw, top.y);
      ctx.lineTo(top.x + f * bw, top.y + depth);
      ctx.stroke();
    }
    ctx.fillStyle = '#4d535a';
    ctx.fillRect(top.x - hw, top.y + depth * 0.52, hw * 2, 0.1 * s);
    ctx.fillRect(top.x - hw, top.y + depth - 0.08 * s, hw * 2, 0.08 * s);
    if (tier.stripe) {
      ctx.fillStyle = tier.accent;
      ctx.fillRect(top.x - hw, top.y + 0.34 * s, hw * 2, 0.16 * s);
    }
    ctx.restore();
    // Heavy rolled lip with a row of rivets.
    ctx.fillStyle = tier.lip;
    ctx.fillRect(top.x - hw - 0.04 * s, top.y - 0.06 * s, (hw + 0.04 * s) * 2, 0.14 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(top.x - hw - 0.04 * s, top.y - 0.06 * s, (hw + 0.04 * s) * 2, 0.025 * s);
    for (let rx = -hw + 0.12 * s; rx < hw - 0.05 * s; rx += 0.26 * s) {
      disc(top.x + rx, top.y + 0.01 * s, 0.035 * s, '#c9ced3');
      disc(top.x + rx, top.y + depth * 0.52 + 0.05 * s, 0.032 * s, '#b9bec3');
    }
    if (frozen) {
      // Frozen wheels: frost glazes the tub and icicles hang from the lip.
      tub();
      ctx.fillStyle = 'rgba(200,236,255,0.42)';
      ctx.fill();
      ctx.fillStyle = 'rgba(235,248,255,0.92)';
      let n = 0;
      for (let ix = -hw + 0.18 * s; ix < hw - 0.1 * s; ix += 0.34 * s, n++) {
        ctx.beginPath();
        ctx.moveTo(top.x + ix - 0.06 * s, top.y + 0.07 * s);
        ctx.lineTo(top.x + ix + 0.06 * s, top.y + 0.07 * s);
        ctx.lineTo(top.x + ix, top.y + (0.2 + (n % 3) * 0.05) * s);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Hands grip the front lip; a cheer throws both fists up.
    miner(() => {
      ctx.strokeStyle = '#557394';
      ctx.lineWidth = 0.13;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const hx = side * (cheer ? 0.46 : 0.42);
        const hy = cheer ? -0.78 : -0.04;
        ctx.beginPath();
        ctx.moveTo(side * 0.34, -0.3);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        disc(hx, hy, 0.07, '#eab48f');
      }
    });
    if (invulnerable) ctx.restore();

    // Undercarriage and iron rail wheels whose spokes follow displacement.
    rect(0, -1.27, 2.0, 0.14, tier.frame);
    for (const wx of [-0.72, 0.72]) rect(wx, -1.4, 0.26, 0.18, '#9c5424');
    for (const wx of [-0.72, 0.72]) {
      const c = P(wx, -1.41);
      disc(c.x, c.y, 0.39 * s, '#23262b');
      disc(c.x, c.y, 0.34 * s, '#30343a');
      ctx.strokeStyle = '#23262b';
      ctx.lineWidth = 0.07 * s;
      for (let k = 0; k < 2; k++) {
        const a = anim.wheel + (k * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(c.x - Math.cos(a) * 0.3 * s, c.y - Math.sin(a) * 0.3 * s);
        ctx.lineTo(c.x + Math.cos(a) * 0.3 * s, c.y + Math.sin(a) * 0.3 * s);
        ctx.stroke();
      }
      disc(c.x, c.y, 0.09 * s, tier.hub);
    }
  }

  // ------------------------------------------------------------------ background life

  /** Lightweight version of the 3D background life: clouds, falling motes, birds, cliff slides. */
  _drawLife(ctx, dt, time) {
    const L = this.layout;
    const T = this.theme;
    if (!this.life || this.life.theme !== this.themeId) {
      this.life = {
        theme: this.themeId,
        clouds: Array.from({ length: 4 }, (_, i) => ({ x: (i / 4) * L.width, y: 0.05 + Math.random() * 0.12, w: 120 + Math.random() * 110, v: 6 + Math.random() * 8 })),
        motes: Array.from({ length: this.reducedMotion ? 25 : 70 }, () => ({ x: Math.random(), y: Math.random(), s: 1 + Math.random() * 2, v: 0.03 + Math.random() * 0.05, p: Math.random() * 6 })),
        birds: [],
        birdTimer: 2 + Math.random() * 3,
        slideTimer: 1 + Math.random() * 2,
      };
    }
    const S = this.life;
    const s = L.pxPerUnit;
    // Reduced motion: clouds and motes hold still (drawn where they are) and no birds fly —
    // full-screen drift and falling snow are exactly the motion the flag exists to remove.
    const calm = this.reducedMotion;
    // Clouds drifting across the top of the sky.
    ctx.fillStyle = T.id === 'volcano' ? 'rgba(90,76,72,0.45)' : 'rgba(255,255,255,0.55)';
    for (const c of S.clouds) {
      if (!calm) c.x += c.v * dt;
      if (c.x - c.w > L.width) c.x = -c.w;
      const y = c.y * L.height;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(c.x + (k - 1.5) * c.w * 0.22, y + Math.sin(k * 1.7) * 6, c.w * 0.22, c.w * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Snow falling / embers rising / dust drifting.
    const kind = T.particles.kind;
    ctx.fillStyle = kind === 'embers' ? 'rgba(255,150,60,0.8)' : kind === 'dust' ? 'rgba(243,220,180,0.55)' : 'rgba(255,255,255,0.85)';
    for (const m of S.motes) {
      if (!calm) {
        m.p += dt;
        if (kind === 'embers') m.y -= m.v * dt * 0.6;
        else if (kind === 'dust') m.x += m.v * dt * 0.6;
        else m.y += m.v * dt;
        m.x += Math.sin(m.p * 0.8) * 0.004 * dt * 10 + this.stageWind * m.v * dt * 1.5;
      }
      if (m.x < 0) m.x += 1;
      if (m.y > 1) m.y -= 1;
      if (m.y < 0) m.y += 1;
      if (m.x > 1) m.x -= 1;
      ctx.beginPath();
      ctx.arc(m.x * L.width, m.y * L.height, m.s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Birds crossing above the source shelves (not over the volcano, not in reduced motion).
    S.birdTimer -= dt;
    if (S.birdTimer <= 0 && T.id !== 'volcano' && !calm) {
      S.birdTimer = LIFE.birdsEvery[0] + Math.random() * (LIFE.birdsEvery[1] - LIFE.birdsEvery[0]);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = 10.4 + Math.random() * 0.8;
      for (let i = 0; i < 4; i++) S.birds.push({ x: (dir > 0 ? L.view.left - 1 : L.view.right + 1) - dir * i * 0.7, y: y + (i % 2 ? 0.25 : -0.2) * Math.ceil(i / 2), v: dir * 3, p: Math.random() * 6 });
    }
    ctx.strokeStyle = '#2a3038';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.lineCap = 'round';
    for (const b of S.birds) {
      b.x += b.v * dt;
      b.p += dt * 10;
      const q = L.toScreen(b.x, b.y);
      const wing = s * 0.28;
      const lift = Math.sin(b.p) * wing * 0.6;
      ctx.beginPath();
      ctx.moveTo(q.x - wing, q.y - lift);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(q.x + wing, q.y - lift);
      ctx.stroke();
    }
    S.birds = S.birds.filter((b) => b.x > L.view.left - 6 && b.x < L.view.right + 6);
    // Small slides pouring off the side cliffs.
    S.slideTimer -= dt;
    if (S.slideTimer <= 0 && !this.reducedMotion) {
      S.slideTimer = LIFE.slideEvery[0] + Math.random() * (LIFE.slideEvery[1] - LIFE.slideEvery[0]);
      const side = Math.random() < 0.5 ? -1 : 1;
      this._burst(side * (HW + 1.6 + Math.random() * 3), 5 + Math.random() * 3, [T.cap, '#ffffff'], 14, 0.8);
    }
  }

  // ------------------------------------------------------------------ snapshots

  itemIconDataURL(type, size = 96) {
    const c = makeCanvas(size);
    const sprite = this._rockSprite(type, 1, Math.round(size * 0.78));
    c.getContext('2d').drawImage(sprite, (size - sprite.width) / 2, (size - sprite.height) / 2);
    return c.toDataURL('image/png');
  }

  prewarmThemes() {}

  dispose() {
    this.canvas.remove();
  }
}
