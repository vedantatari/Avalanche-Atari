// WebGL renderer (Three.js). Reads the simulation, never writes to it.
import * as THREE from '../../../vendor/three/three.module.min.js';
import { ARENA, BASE_SCOOP_WIDTH, EFFECTS, MODIFIERS, QUALITY, ROCK, TICK_RATE, CART_MAX_SPEED, THEMES } from '../../config.js';
import { dropXAt, dropYAt } from '../../game/cliff.js';
import { cliffCells } from '../../game/cliff.js';
import { clonePositions } from '../../game/simulation.js';
import { ITEM_TYPES } from '../../game/items.js';
import { CART_TIERS, appearanceOf, effectBadges, revealPopup } from '../appearance.js';
import { loadCartImage } from '../assets.js';
import { themeInfo } from '../themes.js';
import { computeLayout } from '../layout.js';
import { buildScenery, disposeSharedGeometries } from './scenery.js';
import { CartModel, disposeTubTexture } from './cart.js';
import { AmbientParticles, Debris, EffectBadges, Fragments, ParticleSystem, Popups, disposeLabelTextures } from './fx.js';
import { CellTimeline, ItemVisual, RockLibrary, ShelfCells, variantOfCell } from './rocks.js';
import { BackgroundLife } from './background-life.js';
import { StormFx } from './storm.js';
import { CAMERA, setRayPoint } from './projection.js';

const DT = 1 / TICK_RATE;
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const MAT_TEXTURES = ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'lightMap'];

/**
 * Frees every geometry, material, and texture reachable from `root`. Shared resources are
 * visited once; disposing is idempotent, so overlap with explicit dispose() calls is safe.
 */
function disposeTree(root, seen = new Set()) {
  root?.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const key of MAT_TEXTURES) {
        const t = m[key];
        if (t && !seen.has(t)) {
          seen.add(t);
          t.dispose();
        }
      }
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
  return seen;
}
const CELLS = cliffCells();
/**
 * Falling rocks travel this far in front of the gameplay plane (along camera rays, so their
 * screen position is unchanged) and pass in front of the miner riding in the cart. A caught
 * rock glides back onto the plane as it settles into the tub.
 */
const ROCK_FRONT = 0.8;
/** Falling rocks ease down to this share of the shelf-block size once they detach. */
const FALL_SCALE = ROCK.fallingScale;
/** Falling boxes stretch to a wider card-like aspect so the marking has more room. */
const FALL_X = FALL_SCALE * ROCK.fallingStretch.x;
const FALL_Y = FALL_SCALE * ROCK.fallingStretch.y;
/** World-space emblem scale while falling: nearly the box height, kept round. */
const EMBLEM_SCALE = FALL_Y * 1.1;
/** Each half of a split rock is drawn at this share of a whole rock. */
const HALF_SCALE = 0.8;

/** Side a pushed rock is still drifting toward (-1 / 1), or 0; split halves need no arrow. */
const driftDir = (d, T) => (d.x0 !== undefined && !d.half && T < d.driftEnd ? Math.sign(d.x - d.x0) : 0);

/**
 * Fog stages: a bank of mist over the upper arena, in front of the falling rocks. Rocks above
 * the fog line show no marking; the bank fades out just below the line.
 */
function fogBank() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(236,240,245,0.86)');
  g.addColorStop(0.72, 'rgba(236,240,245,0.62)');
  g.addColorStop(1, 'rgba(236,240,245,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false }));
  mesh.renderOrder = 2.5;
  mesh.visible = false;
  const top = 13;
  const bottom = MODIFIERS.fog.line - 0.8;
  const z = ARENA.gameZ + ROCK_FRONT + 0.3;
  const k = (CAMERA.z - z) / (CAMERA.z - ARENA.gameZ);
  setRayPoint(mesh.position, 0, (top + bottom) / 2, z);
  mesh.scale.set(90 * k, (top - bottom) * k, 1);
  return mesh;
}

/** Magnet: a glowing flat ring around the scoop marking how far its pull reaches. */
function magnetRing() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 56),
    new THREE.MeshBasicMaterial({ color: '#8fe4ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

export class Renderer3D {
  /**
   * @param {HTMLElement} container element that receives the canvas
   * @param {object} opts { quality, reducedMotion, onContextLost, onContextRestored }
   */
  constructor(container, opts = {}) {
    this.kind = '3d';
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    if (!renderer.getContext()) throw new Error('WebGL context unavailable');
    container.appendChild(this.canvas);
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // NeutralToneMapping needs three r162+; fall back gracefully on an older vendored build.
    renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
    this.camera.updateMatrixWorld();

    this.images = opts.images || {};
    this.lib = new RockLibrary(this.images);
    this.cells = new ShelfCells(this.lib);
    this.itemsGroup = new THREE.Group();
    this.cart = new CartModel();
    this.cart.group.position.z = ARENA.gameZ;
    // Shadow clones: two see-through copies of the cart that ride beside it while active.
    this.clones = [new CartModel(), new CartModel()];
    for (const ghost of this.clones) {
      ghost.makeGhost();
      ghost.group.position.z = ARENA.gameZ;
    }
    this.cloneFade = 0;
    this.particles = new ParticleSystem(700);
    this.fragments = new Fragments(90);
    this.popups = new Popups(10);
    this.badges = new EffectBadges();
    this.debris = new Debris(70);
    this.debrisClock = 0;
    this.life = new BackgroundLife(this.scene, { spawnPebbles: (x, y, z, n) => this.debris.spawn(x, y, z, n) });
    this.fogBank = fogBank();
    this.magnetRing = magnetRing();
    this.storm = new StormFx(this.particles);
    this.stormFrozen = false;
    this.lastV = 0;
    this.scene.add(this.cells.group, this.itemsGroup, this.cart.group, ...this.clones.map((c) => c.group), this.particles.points, this.fragments.mesh, this.popups.group, this.badges.group, this.debris.mesh, this.fogBank, this.magnetRing, this.storm.group);

    this.visuals = new Map();
    this.pool = [];
    this.seen = new Set();
    this.crackingList = [];
    this.timeline = null;
    this.schedule = null;
    this.sceneries = {};
    this.themeId = null;
    this.ambient = null;
    this.clock = 0;
    this.shake = 0;
    this.layout = null;
    this.quality = 'high';
    this.reducedMotion = !!opts.reducedMotion;
    this.lost = false;

    this.disposed = false;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.disposed) return; // dispose() forces a context loss on purpose
      this.lost = true;
      opts.onContextLost?.();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      if (this.disposed) return;
      this.lost = false;
      opts.onContextRestored?.();
    });

    this.setQuality(opts.quality || 'high');
  }

  // ------------------------------------------------------------------ configuration

  setTheme(themeId) {
    if (themeId === this.themeId) return;
    const prev = this.sceneries[this.themeId];
    if (prev) this.scene.remove(prev.group, prev.lights);
    const next = this._scenery(themeId);
    this.scene.add(next.group, next.lights);
    this.scene.background = next.background;
    this.scene.fog = next.fog;
    this.themeId = themeId;
    this.theme = themeInfo(themeId);
    this.cells.setTheme(this.theme);
    this.debris.setColors(this.theme.block);
    this.life.setTheme(this.theme, next);
    for (const v of this.visuals.values()) v.visual.cap.material = this.cells.capMaterial;
    this._rebuildAmbient();
    this._applyShadows();
    this._prewarm();
  }

  _prewarm() {
    if (!this.theme || this.lost) return;
    const key = `${this.themeId}|${this.quality}`;
    if (this.warmKey === key) return;
    this.warmKey = key;
    const temp = ITEM_TYPES.map((type) => {
      const v = this.pool.pop() || new ItemVisual(this.lib);
      v.configure(type, 0, this.cells.capMaterial);
      v.setTag(true);
      this.itemsGroup.add(v.group);
      return v;
    });
    const shown = [this.fogBank, this.magnetRing, ...this.storm.parts, this.storm.flash, ...this.storm.bolts.map((b) => b.g), ...this.clones.map((c) => c.group)].filter((o) => !o.visible);
    shown.forEach((o) => (o.visible = true));
    try {
      this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
      const seen = new Set();
      this.scene.traverseVisible((o) => {
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          for (const t of [m.map, m.emissiveMap, m.normalMap, m.alphaMap]) {
            if (!t || seen.has(t)) continue;
            seen.add(t);
            this.renderer.initTexture(t);
          }
        }
      });
    } catch {
      this.warmKey = null;
    }
    shown.forEach((o) => (o.visible = false));
    for (const v of temp) {
      v.group.visible = false;
      this.itemsGroup.remove(v.group);
      this.pool.push(v);
    }
  }

  _scenery(themeId) {
    if (!this.sceneries[themeId]) this.sceneries[themeId] = buildScenery(themeId, { quality: this.quality, images: this.images });
    return this.sceneries[themeId];
  }

  setQuality(level) {
    this.quality = QUALITY[level] ? level : 'high';
    this.q = QUALITY[this.quality];
    this.particles.scale = this.q.particleScale;
    this.life?.setQuality(this.q);
    this._applyShadows();
    this._rebuildAmbient();
    if (this.layout) this.resize(this.layout);
    this._prewarm();
  }

  setCartTier(tier) {
    if (tier === this.cartTier) return;
    this.cartTier = tier;
    for (const c of [this.cart, ...this.clones]) c.setTier(tier);
    const meta = CART_TIERS[tier];
    if (!meta?.sprite) return;
    loadCartImage(meta.sprite).then((img) => {
      if (!img || this.disposed || this.cartTier !== tier) return;
      this.cartTextures ||= new Map();
      let tex = this.cartTextures.get(meta.sprite);
      if (!tex) {
        tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        this.cartTextures.set(meta.sprite, tex);
      }
      for (const c of [this.cart, ...this.clones]) c.setSprite(tex, meta);
    });
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
    this.cart.reducedMotion = this.reducedMotion;
    for (const ghost of this.clones) ghost.reducedMotion = this.reducedMotion;
    this.life.setReducedMotion(this.reducedMotion);
    this._rebuildAmbient();
  }

  _applyShadows() {
    const r = this.renderer;
    r.shadowMap.enabled = this.q.shadows;
    const sc = this.sceneries[this.themeId];
    if (sc) {
      sc.sun.castShadow = this.q.shadows;
      if (sc.sun.shadow.mapSize.x !== this.q.shadowMapSize) {
        sc.sun.shadow.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
        sc.sun.shadow.map?.dispose();
        sc.sun.shadow.map = null;
      }
    }
    r.shadowMap.needsUpdate = true;
  }

  _rebuildAmbient() {
    if (!this.theme) return;
    if (this.ambient) {
      this.scene.remove(this.ambient.points);
      this.ambient.dispose();
    }
    const count = Math.round(this.q.ambientParticles * (this.reducedMotion ? 0.4 : 1));
    this.ambient = new AmbientParticles(this.theme.particles.kind, this.theme.particles.color, count);
    this.scene.add(this.ambient.points);
    this._updatePointScale();
  }

  /** Applies a layout from render/layout.js (CSS pixels) to canvas size and camera frustum. */
  resize(layout) {
    this.layout = layout;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(Math.max(1, Math.round(layout.width)), Math.max(1, Math.round(layout.height)), false);
    this._setFrustum(this.camera, layout.view);
    this._updatePointScale();
  }

  _setFrustum(camera, view) {
    const n = CAMERA.near;
    const d = CAMERA.z - ARENA.gameZ;
    camera.projectionMatrix.makePerspective(
      ((view.left - CAMERA.x) * n) / d,
      ((view.right - CAMERA.x) * n) / d,
      ((view.top - CAMERA.y) * n) / d,
      ((view.bottom - CAMERA.y) * n) / d,
      n,
      CAMERA.far,
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  _updatePointScale() {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const s = (this.camera.projectionMatrix.elements[5] * h) / 2;
    this.particles.material.uniforms.uScale.value = s;
    if (this.ambient) this.ambient.material.uniforms.uScale.value = s;
    if (this.life) this.life.particles.material.uniforms.uScale.value = s;
  }

  // ------------------------------------------------------------------ events

  handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'stageStart':
          this._resetStage();
          this.storm.setKind(e.terrain === 'volcano' ? 'lava' : 'ice');
          break;
        case 'crack':
          this._dustAtCell(e.cellId, 5, 0.45);
          this._pebbles(e.cellId, 1);
          break;
        case 'detach':
          this._dustAtCell(e.cellId, 14, 1);
          this._dustCloud(e.cellId);
          this._pebbles(e.cellId, this.reducedMotion ? 1 : 4);
          break;
        case 'catch':
          this._onCatch(e);
          break;
        case 'ground':
          this._onGround(e);
          break;
        case 'restore':
          this.particles.emit({ x: this.cartX ?? 0, y: 0.4, z: ARENA.gameZ + 0.4, count: 26, colors: ['#ff5a6a', '#ffd35a', '#ffffff'], speed: 3, gravity: -2, life: 0.9, size: 0.18 });
          this.popups.show('+1 ♥', this.cartX ?? 0, 1.1, '#ff8a9a');
          break;
        case 'targetReached':
          this.particles.emit({ x: this.cartX ?? 0, y: 0.6, z: ARENA.gameZ + 0.3, count: 30, colors: ['#ffd35a', '#8ef5dd', '#ffffff'], speed: 4, gravity: -5, life: 1.1, size: 0.16 });
          break;
        case 'effectEnd':
          if (e.effect === 'clone') this._clonePuff();
          break;
        case 'stormWarn':
          if (this.storm.kind === 'lava') {
            this.popups.show('ERUPTION!', e.x, 3.4, '#ffb040');
            if (!this.reducedMotion) this.shake = Math.max(this.shake, 0.25);
          } else this.popups.show('⚡ STORM', e.x, 3.4, '#bfeaff');
          break;
        case 'stormStrike':
          this.storm.strike(e.x, true);
          if (!this.reducedMotion) this.shake = Math.max(this.shake, this.storm.kind === 'lava' ? 0.35 : 0.2);
          break;
        case 'stormHit':
          if (e.damage) {
            this.storm.strike(e.x);
            if (this.storm.kind === 'lava') {
              this._blast(e.x, false);
              this.popups.show('BURNED −1 ♥', e.x, 1.3, '#ff7a2a');
            } else {
              this.particles.emit({ x: e.x, y: 0.3, z: ARENA.gameZ + 0.5, count: this.reducedMotion ? 10 : 30, colors: ['#ffffff', '#bfeaff', '#8fd8ff'], speed: 4, gravity: -5, life: 0.8, size: 0.18 });
              this.popups.show('FROZEN −1 ♥', e.x, 1.3, '#bfeaff');
            }
            this.cart.hurt();
            if (!this.reducedMotion) this.shake = 0.35;
            break;
          }
          this.storm.strike(e.x, true);
          this.stormFrozen = true;
          this.particles.emit({ x: e.x, y: 0.3, z: ARENA.gameZ + 0.5, count: this.reducedMotion ? 14 : 40, colors: ['#ffffff', '#bfeaff', '#8fd8ff'], speed: 5, gravity: -5, life: 0.9, size: 0.2 });
          this.popups.show('FROZEN!', e.x, 1.3, '#bfeaff');
          this.cart.hurt();
          this.cart.eject();
          if (!this.reducedMotion) this.shake = 0.7;
          break;
        case 'split': {
          // The rock cracks apart mid-air: a puff of gold chips where it breaks.
          const a = appearanceOf('split');
          this.fragments.burst(e.x, e.y, ARENA.gameZ + ROCK_FRONT, [a.base, a.vein, '#fff0d0'], this.reducedMotion ? 3 : 7, 2.2);
          this.particles.emit({ x: e.x, y: e.y, z: ARENA.gameZ + ROCK_FRONT + 0.2, count: 10, colors: a.particle, speed: 2.2, gravity: -3, life: 0.5, size: 0.14 });
          break;
        }
        default:
          break;
      }
    }
  }

  _resetStage() {
    for (const id of [...this.visuals.keys()]) this._release(id);
    this.particles.clear();
    this.fragments.clear();
    this.debris.clear();
    this.popups.clear();
    this.schedule = null;
    this.timeline = null;
    this.cloneFade = 0;
    this.storm.reset();
    this.stormFrozen = false;
    this.cart.resetDriver();
    for (const ghost of this.clones) ghost.setOpacity(0);
  }

  /** Fireball with rising flames and smoke on the cart — the demon's big one ejects the miner. */
  _blast(x, big) {
    const n = this.reducedMotion ? 0.4 : 1;
    // Core flash.
    this.particles.emit({ x, y: 0.4, z: ARENA.gameZ + 0.35, count: Math.round((big ? 26 : 14) * n), colors: ['#ffffff', '#ffe08a', '#ffc04a'], speed: big ? 5 : 3.5, gravity: -1, life: 0.35, size: big ? 0.3 : 0.22 });
    // Flames licking upward (positive gravity = buoyant).
    this.particles.emit({ x, y: 0.35, z: ARENA.gameZ + 0.4, count: Math.round((big ? 40 : 20) * n), colors: ['#ff7417', '#ff3d12', '#ffd94a'], speed: big ? 3 : 2, gravity: 2.2, life: big ? 0.9 : 0.6, size: big ? 0.28 : 0.2, up: big ? 2.2 : 1.5, drag: 2.5 });
    // Smoke swelling after the flash.
    this.particles.emit({ x, y: 0.5, z: ARENA.gameZ + 0.3, count: Math.round((big ? 18 : 8) * n), colors: ['#2a2124', '#4a3a34', '#5c5048'], speed: 1.6, gravity: 1.2, life: big ? 1.6 : 1.0, size: 0.4, up: 1.0, grow: 1.4, alpha: 0.55, drag: 2 });
  }

  /** Smoke puffs where the shadow clones pop in or out. */
  _clonePuff() {
    if (this.cartX === undefined) return;
    for (const x of clonePositions(this.cartX, this.cartWidth ?? 2.56)) {
      this.particles.emit({ x, y: -0.5, z: ARENA.gameZ + 0.4, count: this.reducedMotion ? 4 : 12, colors: ['#c8d0ff', '#8a93c8', '#eef0ff'], speed: 1.2, gravity: -0.3, life: 0.8, size: 0.7, spread: 1.6, up: 0.5, grow: 1.2, alpha: 0.7 });
    }
  }

  _dustAtCell(cellId, count, power) {
    const cell = CELLS[cellId];
    if (!cell || !this.theme) return;
    const p = setRayPoint(new THREE.Vector3(), cell.x, cell.y - 0.4, cell.z + 0.6);
    const kind = this.theme.capKind;
    const colors = kind === 'snow' ? ['#ffffff', '#e8f0f8', '#cfd8e2'] : kind === 'ash' ? ['#8a807b', '#5d5553', '#b0a49e'] : ['#e9d2a8', '#c9a878', '#f6e7cc'];
    this.particles.emit({ x: p.x, y: p.y, z: p.z, count, colors, speed: 1.4 * power, gravity: -2.2, life: 0.8, size: 0.2, spread: 0.7, up: 0.6 });
  }

  _pebbles(cellId, count) {
    const cell = CELLS[cellId];
    if (!cell) return;
    const p = setRayPoint(new THREE.Vector3(), cell.x, cell.y - 0.45, ARENA.gameZ - 1.1);
    this.debris.spawn(p.x, p.y, p.z, count);
  }

  /** Soft snow/ash/dust cloud where a rock breaks loose. */
  _dustCloud(cellId) {
    const cell = CELLS[cellId];
    if (!cell || !this.theme) return;
    const p = setRayPoint(new THREE.Vector3(), cell.x, cell.y, cell.z + 0.7);
    const kind = this.theme.capKind;
    const colors = kind === 'snow' ? ['#ffffff', '#f0f5fa'] : kind === 'ash' ? ['#9a908c', '#7d7470'] : ['#f1ddb8', '#dcc39a'];
    this.particles.emit({ x: p.x, y: p.y, z: p.z, count: this.reducedMotion ? 3 : 9, colors, speed: 0.9, gravity: -0.35, life: 1.5, size: 0.75, spread: 1.1, up: 0.4, xScale: 1.4 });
  }

  _onCatch(e) {
    const a = appearanceOf(e.itemType);
    let entry = this.visuals.get(e.id);
    if (!entry) {
      const drop = this.schedule?.drops.find((d) => d.id === e.id);
      if (drop) entry = this._acquire(drop);
    }
    // Clones never catch harmful rocks, so fire and the demon always land in the cart's own scoop.
    const scoopCart = e.scoop ? this.clones[e.scoop < 0 ? 0 : 1] : this.cart;
    if (e.itemType === 'demon' && e.fatal) {
      // The demon detonates ON the cart: a big flaming blast throws the miner out of the
      // tub onto the ground, then the GAME OVER card follows.
      scoopCart.impact(1.8);
      this.fragments.burst(e.cartX, 0.35, ARENA.gameZ + 0.2, [a.base, a.vein, '#ffb347'], this.reducedMotion ? 8 : 24, 6.5);
      this._blast(e.cartX, true);
      if (entry) this._release(e.id);
      this.popups.show('GAME OVER', e.cartX, 1.3, '#ff3d5c');
      this.cart.hurt();
      this.cart.eject();
      if (!this.reducedMotion) this.shake = 0.7;
      return;
    }
    scoopCart.impact(e.itemType === 'fire' ? 1.3 : 1);
    if (e.itemType === 'fire' || e.itemType === 'demon') {
      this.fragments.burst(e.cartX, 0.25, ARENA.gameZ + 0.2, [a.base, '#3d302c', a.vein], e.blocked ? 5 : 10, 3.4);
      if (entry) this._release(e.id);
      if (e.blocked) {
        this.particles.emit({ x: e.cartX, y: 0.3, z: ARENA.gameZ + 0.3, count: 16, colors: ['#ffc04a', '#ffffff'], speed: 3, gravity: -3, life: 0.5, size: 0.18 });
        this.popups.show('SAFE', e.cartX, 1.0, '#ffe08a');
      } else {
        // A regular blast: flames on the cart and a hard rattle, but the run continues.
        this._blast(e.cartX, false);
        this.popups.show(a.popup, e.cartX, 1.0, a.popupColor);
        this.cart.hurt();
        if (!this.reducedMotion) this.shake = 0.35;
      }
      return;
    }
    if (entry) {
      entry.mode = 'caught';
      entry.caughtAt = this.clock;
      entry.scoop = e.scoop || 0;
      const half = (this.cartWidth ?? 2.5) / 2;
      entry.offset = Math.max(-half * 0.55, Math.min(half * 0.55, e.x - e.cartX));
      // Rocks are caught on first touch (rim edge or tub side): settle in from that spot.
      entry.fromOffset = e.x - e.cartX;
      entry.fromY = e.y ?? 0.1;
      entry.fxDone = false;
    }
    // Scoring popups show the points actually earned, so a multiplier is visible at a glance.
    // A mystery rock announces what it turned out to be.
    if (e.reveal) {
      const jackpot = e.reveal === 'jackpot';
      this.popups.show(jackpot ? `JACKPOT +${e.score}` : revealPopup(e.reveal), e.x, 0.95, jackpot ? '#ffd35a' : appearanceOf(e.reveal).popupColor);
    } else this.popups.show(e.score ? `+${e.score}` : a.popup, e.x, 0.95, a.popupColor);
    if (e.pulled) {
      // Pulled in by the magnet: a streak of sparks from where the rock was toward the scoop.
      this.particles.emit({ x: e.x, y: e.y ?? 0.4, z: ARENA.gameZ + ROCK_FRONT, count: 10, colors: ['#8fe4ff', '#ffffff'], speed: 0.6, vx: (e.cartX - e.x) * 4, gravity: 0, drag: 3, life: 0.35, size: 0.12 });
    }
    if (e.effect === 'clone' && !e.refreshed) this._clonePuff();
    if (e.itemType === 'cash' || e.itemType === 'shield' || e.effect === 'multiplier' || e.effect === 'clone' || e.effect === 'magnet' || e.reveal === 'jackpot') scoopCart.cheer();
  }

  _onGround(e) {
    const entry = this.visuals.get(e.id);
    const a = appearanceOf(e.itemType);
    const y = ARENA.floorY - 0.3;
    this.fragments.burst(e.x, y, ARENA.gameZ + 0.3, [a.base, a.vein, '#6d6560'], this.reducedMotion ? 4 : 8, 2.4);
    const kind = this.theme?.capKind;
    this.particles.emit({
      x: e.x,
      y,
      z: ARENA.gameZ + 0.5,
      count: 12,
      colors: kind === 'snow' ? ['#ffffff', '#dfe8f0'] : ['#b8a58c', '#8f7f6d'],
      speed: 2,
      gravity: -3,
      life: 0.6,
      size: 0.22,
      up: 0.6,
    });
    if (entry) this._release(e.id);
  }

  // ------------------------------------------------------------------ item pool

  _acquire(drop) {
    const visual = this.pool.pop() || new ItemVisual(this.lib);
    visual.configure(drop.type, variantOfCell(drop.cellId), this.cells.capMaterial);
    this.itemsGroup.add(visual.group);
    const entry = { visual, drop, mode: 'crack', caughtAt: 0, offset: 0 };
    this.visuals.set(drop.id, entry);
    return entry;
  }

  _release(id) {
    const entry = this.visuals.get(id);
    if (!entry) return;
    entry.visual.group.visible = false;
    this.itemsGroup.remove(entry.visual.group);
    this.pool.push(entry.visual);
    this.visuals.delete(id);
  }

  // ------------------------------------------------------------------ frame

  /**
   * @param {object} view { sim, alpha, frameDt, time, paused }
   */
  render(view) {
    if (this.lost || !this.layout) return;
    const { sim, alpha } = view;
    const dt = view.paused ? 0 : Math.min(0.1, view.frameDt || 0);
    this.clock += dt;
    const time = view.time;
    const st = sim.stage;

    if ((st?.schedule || null) !== this.schedule) {
      for (const id of [...this.visuals.keys()]) this._release(id);
      this.schedule = st?.schedule || null;
      this.timeline = this.schedule ? new CellTimeline(this.schedule.drops) : null;
    }
    const T = st ? Math.max(0, (st.tick - 1 + alpha) * DT) : 0;

    // Cart (interpolated between the last two ticks).
    const cart = sim.cart;
    const cartX = cart ? cart.prevX + (cart.x - cart.prevX) * alpha : 0;
    const width = cart ? cart.prevWidth + (cart.width - cart.prevWidth) * alpha : BASE_SCOOP_WIDTH;
    this.cartX = cartX;
    this.cartWidth = width;
    const frozen = (!!st && sim.isFrozen()) || this.stormFrozen;
    this.cart.update(
      { x: cartX, width, v: cart?.v || 0, vmax: CART_MAX_SPEED, invulnerable: !!st && sim.isInvulnerable(), frozen },
      dt,
      time,
    );
    const timers = sim.effectTimers();
    this._updateClones(timers.cloneSeconds, cartX, width, cart?.v || 0, dt, time);
    const sch = st?.schedule;
    const fw = sch?.fogWindow;
    this.fogLevel = sch?.modifier === 'fog' ? 1 : fw ? Math.max(0, Math.min(1, (T - fw[0]) / 0.6, (fw[1] - T) / 0.6)) : 0;
    this.windNow = sch?.modifier === 'windy' || (sch?.windWindow && T >= sch.windWindow[0] && T < sch.windWindow[1]) ? sch.wind : 0;
    this._stageWeather(st, cart, cartX, width, timers, frozen, dt);
    this.storm.update(st?.schedule?.storms, T, dt, this.clock, this.reducedMotion);

    // Shelf cells and item rocks.
    this.cells.update(this.timeline, T);
    this.seen.clear();
    if (this.timeline) {
      this.crackingList.length = 0;
      for (const d of this.timeline.cracking(T, this.crackingList)) this._placeCracking(d, T, time);
    }
    if (st) {
      for (const d of st.falling) {
        if (T < d.detachAt) continue;
        this._placeFalling(d, T);
      }
    }
    for (const [id, entry] of this.visuals) {
      if (entry.mode === 'caught') this._placeCaught(id, entry, cartX, width);
    }
    for (const id of [...this.visuals.keys()]) if (!this.seen.has(id)) this._release(id);

    // Effects.
    this.badges.update(cartX, effectBadges(timers));
    // The demon burns: its veins and emblem pulse like embers (materials are demon-only).
    const pulse = 0.85 + 0.5 * (0.5 + 0.5 * Math.sin(this.clock * 11));
    this.lib.typeMats.demon.emissiveIntensity = pulse;
    this.lib.emblemMats.demon.emissiveIntensity = 0.55 + 0.4 * pulse;
    this.particles.update(dt);
    this.fragments.update(dt);
    // Occasional loose pebbles keep the cliff feeling alive (decorative only).
    this.debrisClock -= dt;
    if (this.debrisClock <= 0 && dt > 0) {
      this.debrisClock = this.reducedMotion ? 2.5 : 0.35 + Math.random() * 0.6;
      const x = (Math.random() - 0.5) * 17;
      const p = setRayPoint(new THREE.Vector3(), x, 9.6 + Math.random() * 1.2, ARENA.gameZ - 1.6);
      this.debris.spawn(p.x, p.y, p.z, 1, 0.2);
    }
    this.debris.update(dt);
    this.popups.update(dt);
    // Background life and props run on the renderer clock, which stops while paused.
    // Reduced motion freezes the ambient motes (falling snow/rising embers) entirely.
    this.life.update(dt, this.clock, this.layout.view);
    this.ambient?.update(view.paused || this.reducedMotion ? 0 : Math.min(0.05, view.frameDt || 0), time, this.life.wind);
    this.sceneries[this.themeId]?.update(this.clock, this.life.wind);

    this.shake = Math.max(0, this.shake - dt);
    const s = this.shake > 0 ? this.shake * 0.25 : 0;
    this.camera.position.set(CAMERA.x + Math.sin(time * 61) * s, CAMERA.y + Math.cos(time * 53) * s, CAMERA.z);
    this.camera.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Stage-rule visuals: the fog bank, wind (stronger background breeze plus streaks of blown
   * snow), the magnet's reach ring, ice crystals while frozen, and spray from gliding wheels.
   */
  _stageWeather(st, cart, cartX, width, timers, frozen, dt) {
    const calm = this.reducedMotion;
    this.fogBank.visible = this.fogLevel > 0.01;
    this.fogBank.material.opacity = this.fogLevel;
    const wind = this.windNow;
    this.life.stageWind = wind * 2.2;
    if (wind && dt > 0 && !calm && Math.random() < dt * 16) {
      this.particles.emit({ x: -wind * 11, y: 1 + Math.random() * 9, z: ARENA.gameZ - 0.6, count: 1, colors: ['#ffffff', '#e8f4ff'], speed: 0.1, vx: wind * 12, up: 0.1, gravity: 0, drag: 0, life: 1.9, size: 0.09, alpha: 0.7 });
    }

    const ring = this.magnetRing;
    ring.visible = timers.magnetSeconds > 0;
    if (ring.visible) {
      const reach = width / 2 + ROCK.radius * ROCK.catchOverlapFraction + EFFECTS.magnetReach;
      const z = ARENA.gameZ + 0.4;
      const k = (CAMERA.z - z) / (CAMERA.z - ARENA.gameZ);
      setRayPoint(ring.position, cartX, 0.2, z);
      ring.scale.set(reach * k, reach * k * 0.3, 1);
      const blink = timers.magnetSeconds < 1 && !calm ? 0.5 + 0.5 * Math.cos(this.clock * 18) : 1;
      ring.material.opacity = (0.45 + (calm ? 0 : 0.15 * Math.sin(this.clock * 8))) * blink;
      if (dt > 0 && !calm && Math.random() < dt * 18) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.particles.emit({ x: cartX + side * reach, y: 0.25, z, count: 1, colors: ['#8fe4ff', '#ffffff'], speed: 0.1, vx: -side * 4.5, up: 0, gravity: 0, drag: 0, life: 0.45, size: 0.1 });
      }
    }

    if (frozen && dt > 0 && Math.random() < dt * (calm ? 3 : 10)) {
      this.particles.emit({ x: cartX + (Math.random() - 0.5) * width, y: -0.2 + Math.random() * 0.4, z: ARENA.gameZ + 0.5, count: 2, colors: ['#e2f7ff', '#ffffff', '#9fd4f5'], speed: 0.4, gravity: -0.6, life: 0.7, size: 0.1 });
    }

    // Ice: snow sprays off the wheels while the cart glides and brakes.
    const v = cart?.v || 0;
    if (st?.terrain === 'ice' && dt > 0 && Math.abs(v) > 2.5 && Math.abs(v) < Math.abs(this.lastV) - 1e-3 && Math.random() < dt * 30) {
      this.particles.emit({ x: cartX - Math.sign(v) * 0.9, y: -1.7, z: ARENA.gameZ + 0.5, count: calm ? 1 : 3, colors: ['#ffffff', '#e4eef7'], speed: 1.2, vx: Math.sign(v) * 1.5, gravity: -3, life: 0.5, size: 0.14, up: 0.8 });
    }
    this.lastV = v;
  }

  /** Fades the shadow clones in and out and keeps them beside the cart. */
  _updateClones(seconds, cartX, width, v, dt, time) {
    const step = dt / 0.18;
    this.cloneFade = seconds > 0 ? Math.min(1, this.cloneFade + step) : Math.max(0, this.cloneFade - step);
    // Blink during the last second so the end never comes as a surprise.
    const blink = seconds > 0 && seconds < 1 && !this.reducedMotion ? 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(this.clock * 18)) : 1;
    const alpha = EFFECTS.cloneOpacity * this.cloneFade * blink;
    const xs = clonePositions(cartX, width);
    this.clones.forEach((ghost, i) => {
      ghost.setOpacity(alpha);
      if (!ghost.group.visible) {
        ghost.lastX = null;
        return;
      }
      ghost.update({ x: xs[i], width, v, vmax: CART_MAX_SPEED, invulnerable: false }, dt, time);
    });
  }

  _placeCracking(d, T, time) {
    if (d.half === 1) return; // a split rock shakes loose as one rock
    this.seen.add(d.id);
    const entry = this.visuals.get(d.id) || this._acquire(d);
    entry.mode = 'crack';
    const v = entry.visual;
    const cell = CELLS[d.cellId];
    const p = (T - d.crackAt) / (d.detachAt - d.crackAt);
    const amp = this.reducedMotion ? 0.012 : 0.045;
    setRayPoint(v.group.position, cell.x + Math.sin(time * 71 + d.id) * amp * p, cell.y + Math.cos(time * 57) * amp * 0.5 * p, cell.z);
    v.group.rotation.set(0, 0, Math.sin(time * 43 + d.id) * 0.05 * p);
    // On the shelf the rock sits at full boulder size; it only shrinks once it falls.
    v.group.scale.setScalar(1);
    v.emblem.scale.setScalar(easeOut(p * 3.2));
    v.crack.material.opacity = Math.min(0.85, p * 1.3);
    v.trail.material.opacity = 0;
    // Announce what is coming while the rock is still shaking loose (the fog hides it), with
    // an arrow when a vent or the wind will push it.
    const fogged = this.fogLevel > 0.5;
    v.setFogged(fogged);
    v.useTag(driftDir(d, T));
    v.setTag(p > 0.2 && !fogged, 1);
  }

  _placeFalling(d, T) {
    if (d.half === 1 && T < d.driftStart) return; // the second half appears when the rock splits
    this.seen.add(d.id);
    let entry = this.visuals.get(d.id);
    if (!entry || entry.mode === 'caught') entry = entry || this._acquire(d);
    if (entry.mode === 'caught') return;
    entry.mode = 'fall';
    const v = entry.visual;
    const cell = CELLS[d.cellId];
    const tau = T - d.detachAt;
    const y = dropYAt(d, T);
    const x = dropXAt(d, T);
    const z = cell.z + (ARENA.gameZ + ROCK_FRONT - cell.z) * easeOut(tau / 0.35);
    setRayPoint(v.group.position, x, y, z);
    const fogged = this.fogLevel > 0.5 && y > MODIFIERS.fog.line;
    if (!fogged && v.fogged) {
      // Dropping out of the fog: a wisp of mist as the marking shows.
      this.particles.emit({ x, y, z: z + 0.2, count: this.reducedMotion ? 2 : 6, colors: ['#f2f5f8', '#dfe5ec'], speed: 0.8, gravity: 0.2, life: 0.6, size: 0.35, grow: 1.2, alpha: 0.6 });
    }
    v.setFogged(fogged);
    const split = d.half && T >= d.driftStart;
    if (d.x0 !== undefined && !d.half && T >= d.driftStart && !entry.pushed) {
      entry.pushed = true;
      // Heat vents puff the rock sideways; the wind needs no extra show.
      if (this.schedule?.terrain === 'volcano' && this.schedule.modifier !== 'windy') {
        this.particles.emit({ x, y: y - 0.3, z: z + 0.1, count: this.reducedMotion ? 3 : 9, colors: ['#ff9a3c', '#ffd27a', '#8a7f7a'], speed: 1.1, vx: Math.sign(d.x - d.x0) * 2.2, gravity: 1.2, life: 0.55, size: 0.22, grow: 0.8, alpha: 0.75 });
      }
    }
    const wob = Math.min(1, tau * 2);
    // The whiskey bottle sways like it has had a few; rocks only wobble.
    const sway = v.bottle.visible ? 0.45 : 0.12;
    v.group.rotation.set(0.05, Math.sin(T * 1.3 + d.id * 1.7) * 0.2 * wob, Math.sin(T * (v.bottle.visible ? 3.2 : 1.9) + d.id) * sway * wob);
    // Detached boxes ease down from full boulder size to their smaller, wider card-like
    // falling shape on the way out of the cell. The bottle keeps its natural proportions.
    const p = easeOut(tau / 0.35);
    const bottle = v.bottle.visible;
    const half = split ? HALF_SCALE : 1;
    const kx = (1 + ((bottle ? FALL_SCALE : FALL_X) - 1) * p) * half;
    const ky = (1 + ((bottle ? FALL_SCALE : FALL_Y) - 1) * p) * half;
    const kz = (1 + (FALL_SCALE - 1) * p) * half;
    v.group.scale.set(kx, ky, kz);
    // The emblem is counter-scaled so it stays round and nearly fills the stretched face,
    // while the floating tag (kept at full size by setTag) does the rest of the explaining.
    const e = (1 + (EMBLEM_SCALE - 1) * p) * half;
    v.emblem.scale.set(e / kx, e / ky, 1);
    v.useTag(driftDir(d, T));
    // Split halves are small and obvious; fogged rocks hide what they are.
    v.setTag(!fogged && !split, kx, ky, kz);
    v.crack.material.opacity = Math.max(0, 0.85 - tau * 2);
    v.trail.material.opacity = Math.min(0.4, tau * 0.8) * (y > ARENA.catchY ? 1 : 0.4);
    // The demon burns: flames lick off it all the way down (its material pulse is global).
    if (v.type === 'demon' && !fogged && !this.reducedMotion && (entry.lastFlame ?? 0) < this.clock - 0.06) {
      entry.lastFlame = this.clock;
      this.particles.emit({
        x: x + (Math.random() - 0.5) * 0.5,
        y: y + (Math.random() - 0.3) * 0.4,
        z: ARENA.gameZ + ROCK_FRONT + 0.15,
        count: 2,
        colors: ['#ff7417', '#ffc04a', '#ff2f4e'],
        speed: 0.7,
        gravity: 1.6,
        life: 0.45,
        size: 0.16,
        up: 1.2,
      });
    }
  }

  _placeCaught(id, entry, cartX, width) {
    this.seen.add(id);
    const v = entry.visual;
    // Rocks caught by a shadow clone settle into that clone's scoop.
    const scoopCart = entry.scoop ? this.clones[entry.scoop < 0 ? 0 : 1] : this.cart;
    const scoopX = entry.scoop ? clonePositions(cartX, width)[entry.scoop < 0 ? 0 : 1] : cartX;
    const c = this.clock - entry.caughtAt;
    const a = appearanceOf(v.type);
    if (c > 0.42) {
      this._release(id);
      this.seen.delete(id);
      return;
    }
    const sink = easeOut(c / 0.12);
    const fromY = entry.fromY ?? 0.1;
    const y = fromY + (-0.2 - fromY) * sink + (c > 0.12 && c < 0.24 ? Math.sin(((c - 0.12) / 0.12) * Math.PI) * 0.04 : 0);
    const fromOffset = entry.fromOffset ?? entry.offset;
    const offset = fromOffset + (entry.offset - fromOffset) * sink;
    const dissolve = c > 0.24 ? (c - 0.24) / 0.18 : 0;
    const scale = 0.86 * (1 - dissolve * 0.85) * (entry.drop.half ? HALF_SCALE : 1);
    const bottle = v.bottle.visible;
    setRayPoint(v.group.position, scoopX + offset, y + scoopCart.scoopRoot.position.y, ARENA.gameZ + ROCK_FRONT * (1 - sink));
    v.group.rotation.set(0.05, 0, 0);
    v.group.scale.set(
      (bottle ? FALL_SCALE : FALL_X) * scale * (1 + (1 - sink) * 0.06),
      (bottle ? FALL_SCALE : FALL_Y) * scale * (1 - (1 - sink) * 0.1 + sink * 0.02),
      FALL_SCALE * scale,
    );
    v.setTag(false);
    v.crack.material.opacity = 0;
    v.trail.material.opacity = 0;
    if (c > 0.24 && !entry.fxDone) {
      entry.fxDone = true;
      this.particles.emit({
        x: scoopX + entry.offset,
        y: 0.35,
        z: ARENA.gameZ - 0.4,
        count: v.type === 'coin' ? 16 : 24,
        colors: a.particle,
        speed: 3.2,
        gravity: -4,
        life: 0.7,
        size: 0.17,
        up: 1.2,
      });
    }
  }

  // ------------------------------------------------------------------ snapshots

  _readTarget(width, height, draw) {
    const rt = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    draw();
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(prevTarget);
    rt.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      img.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /**
   * One hidden scene + pooled visual, reused for every icon render. Building it per call
   * used to leak a scene, two lights, and the visual's cloned materials each time.
   */
  _iconRig() {
    if (!this.iconRig) {
      const scene = new THREE.Scene();
      const visual = new ItemVisual(this.lib);
      scene.add(visual.group);
      scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a4a', 1.6));
      const sun = new THREE.DirectionalLight('#fff0dc', 2.2);
      sun.position.set(-2, 3, 4);
      scene.add(sun);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      cam.position.set(0, 0.2, 3.3);
      cam.lookAt(0, 0.05, 0);
      this.iconRig = { scene, visual, cam };
    }
    return this.iconRig;
  }

  /** Small transparent render of a marked rock for the legend and tutorial. */
  itemIconDataURL(type, size = 96) {
    const { scene, visual, cam } = this._iconRig();
    visual.configure(type, type === 'cash' ? 3 : 1, this.theme?.capKind === 'snow' ? this.cells.capMaterial : null);
    visual.group.rotation.set(0.25, -0.35, 0.05);
    if (visual.bottle.visible) visual.group.scale.setScalar(0.92);
    const prevClear = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    const url = this._readTarget(size, size, () => this.renderer.render(scene, cam));
    this.renderer.setClearColor(0x000000, prevClear);
    return url;
  }

  /** Builds every theme once so switching later is instant. */
  prewarmThemes() {
    for (const id of THEMES) this._scenery(id);
  }

  /**
   * Frees the whole renderer: scene graph, cached sceneries for every theme, pooled item
   * visuals, FX systems, the rock library, and the module-level caches — then tears down the
   * GL context. WebGLRenderer.dispose() alone frees almost none of that, and the renderer is
   * rebuilt whenever the player switches Renderer in Settings or a lost context recovers.
   */
  dispose() {
    this.disposed = true;
    const seen = new Set();
    // Everything reachable from the scene (cells, items, carts + ghost twins, FX meshes,
    // background life, the current theme's scenery), then the sceneries not currently added.
    disposeTree(this.scene, seen);
    for (const sc of Object.values(this.sceneries)) {
      disposeTree(sc.group, seen);
      disposeTree(sc.lights, seen);
      sc.sun.shadow.map?.dispose();
      sc.background?.dispose();
    }
    // Pooled visuals sit outside the scene; their cloned materials are theirs to free.
    for (const v of this.pool) {
      disposeTree(v.group, seen);
      v.dispose();
    }
    for (const entry of this.visuals.values()) entry.visual.dispose();
    if (this.iconRig) disposeTree(this.iconRig.scene, seen);
    this.ambient?.dispose();
    this.storm.dispose();
    for (const t of this.cartTextures?.values() ?? []) t.dispose();
    this.life.dispose();
    this.popups.dispose();
    this.badges.dispose();
    this.cells.dispose();
    this.lib.dispose();
    // Module-level caches shared across renderer instances; they rebuild on next use.
    disposeLabelTextures();
    disposeSharedGeometries();
    disposeTubTexture();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* context may already be gone */
    }
    this.canvas.remove();
  }
}
