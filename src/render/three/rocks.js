// Shelf cells on the cliff and the marked item rocks they turn into. A cell's plain rock and
// the item rock that replaces it share the same geometry variant, so the rock that cracks is
// visibly the same rock that falls. The reverse item shakes loose as a whiskey bottle instead.
import * as THREE from '../../../vendor/three/three.module.min.js';
import { ROCK } from '../../config.js';
import { ITEM_TYPES } from '../../game/items.js';
import { cliffCells } from '../../game/cliff.js';
import { hashSeed } from '../../game/rng.js';
import { appearanceOf } from '../appearance.js';
import { bottleLabelCanvas, crackCanvas, emblemCanvas, labelCanvas, stoneCanvas, veinCanvas } from '../emblems.js';
import { blockGeometries } from './scenery.js';
import { setRayPoint } from './projection.js';
import { imageTexture } from './textures.js';

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}


export const variantOfCell = (cellId) => (cellId * 5 + 1) % 6;

/** Shared parts of the whiskey bottle: amber glass, label, foil, cork, and a glass glint. */
function bottleParts() {
  const profile = [
    [0, -0.72], [0.27, -0.72], [0.3, -0.68], [0.3, 0.1], [0.27, 0.24], [0.17, 0.36],
    [0.11, 0.44], [0.1, 0.6], [0.125, 0.62], [0.125, 0.68], [0, 0.68],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.MeshStandardMaterial({ color: '#8c4a12', roughness: 0.16, metalness: 0.05, emissive: '#6a2f06', emissiveIntensity: 0.35, fog: false });
  const label = new THREE.MeshStandardMaterial({ map: tex(bottleLabelCanvas()), roughness: 0.8, fog: false });
  const foil = new THREE.MeshStandardMaterial({ color: '#d9a520', roughness: 0.35, metalness: 0.6, fog: false });
  const cork = new THREE.MeshStandardMaterial({ color: '#c89a5a', roughness: 0.9, fog: false });
  const glint = new THREE.MeshBasicMaterial({ color: '#fff3dd', transparent: true, opacity: 0.45, depthWrite: false, fog: false });
  const labelArc = Math.PI * 1.1;
  return [
    { geometry: new THREE.LatheGeometry(profile, 22), material: glass, y: 0, shadow: true },
    // Open cylinder segment centred on +z so the label faces the camera.
    { geometry: new THREE.CylinderGeometry(0.306, 0.306, 0.42, 22, 1, true, -labelArc / 2, labelArc), material: label, y: -0.24 },
    { geometry: new THREE.CylinderGeometry(0.113, 0.113, 0.11, 14), material: foil, y: 0.54 },
    { geometry: new THREE.CylinderGeometry(0.09, 0.1, 0.14, 12), material: cork, y: 0.74 },
    { geometry: new THREE.PlaneGeometry(0.06, 0.6), material: glint, x: -0.16, y: -0.3, z: 0.262, rotY: -0.56 },
  ];
}

/** Shared materials for every item type (independent of theme). */
export class RockLibrary {
  constructor(images = {}) {
    this.images = images;
    this.boulderNormal = imageTexture(images.boulderNormal, { color: false });
    this.snowNormal = imageTexture(images.snowNormal, { color: false, repeat: [2, 2] });
    const { blocks, caps } = blockGeometries();
    this.blocks = blocks;
    this.caps = caps;
    this.emblemGeo = new THREE.PlaneGeometry(0.94 * ROCK.blockScale, 0.94 * ROCK.blockScale);
    this.crackGeo = new THREE.PlaneGeometry(1.25 * ROCK.blockScale, 1.1 * ROCK.blockScale);
    this.typeMats = {};
    this.emblemMats = {};
    this.tagMats = {};
    this.tagAspects = {};
    for (const type of ITEM_TYPES) {
      const a = appearanceOf(type);
      const seed = hashSeed('vein', type);
      this.typeMats[type] = new THREE.MeshStandardMaterial({
        map: tex(veinCanvas(a.base, a.vein, seed, { detail: images.boulderDetail })),
        normalMap: this.boulderNormal,
        normalScale: new THREE.Vector2(1.1, 1.1),
        emissiveMap: tex(veinCanvas(a.base, a.vein, seed, { emissive: true })),
        emissive: new THREE.Color(a.vein),
        emissiveIntensity: a.glow,
        roughness: 0.82,
        flatShading: true,
        fog: false,
      });
      const em = tex(emblemCanvas(type, 256));
      this.emblemMats[type] = new THREE.MeshStandardMaterial({
        map: em,
        emissiveMap: em,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: a.emblemGlow ?? 0.42,
        transparent: true,
        alphaTest: 0.04,
        roughness: 0.55,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      // Floating tag pill saying what the item does, shown while it cracks and falls.
      const tag = labelCanvas(a.tag.text, { fg: a.tag.fg, bg: a.tag.bg, height: 64 });
      this.tagMats[type] = new THREE.SpriteMaterial({ map: tex(tag), transparent: true, depthWrite: false, fog: false });
      this.tagAspects[type] = tag.width / tag.height;
    }
    // Arrow variants of the tags (for rocks a vent or the wind will push), built on first use.
    this.arrowTags = new Map();
    // Fog stages: an unmarked grey stone for rocks still above the fog line.
    this.fogMat = new THREE.MeshStandardMaterial({
      map: tex(veinCanvas('#8e9096', '#8e9096', hashSeed('fog-rock'), { detail: images.boulderDetail })),
      normalMap: this.boulderNormal,
      roughness: 0.9,
      flatShading: true,
      fog: false,
    });
    this.bottle = bottleParts();
    this.crackMat = new THREE.MeshBasicMaterial({ map: tex(crackCanvas(77)), transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const streak = document.createElement('canvas');
    streak.width = 8;
    streak.height = 128;
    const sctx = streak.getContext('2d');
    const grad = sctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.85)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 8, 128);
    this.trailGeo = new THREE.PlaneGeometry(0.08, 1.6);
    this.trailTex = tex(streak);
  }

  frontZ(variant) {
    return this.blocks[variant].boundingBox.max.z;
  }

  /** Tag material and aspect for `type`; `dir` (-1 / 1) adds an arrow for the drift side. */
  tag(type, dir = 0) {
    if (!dir) return { material: this.tagMats[type], aspect: this.tagAspects[type] };
    const key = `${type}|${dir}`;
    let t = this.arrowTags.get(key);
    if (!t) {
      const a = appearanceOf(type).tag;
      const c = labelCanvas(dir > 0 ? `${a.text} →` : `← ${a.text}`, { fg: a.fg, bg: a.bg, height: 64 });
      t = { material: new THREE.SpriteMaterial({ map: tex(c), transparent: true, depthWrite: false, fog: false }), aspect: c.width / c.height };
      this.arrowTags.set(key, t);
    }
    return t;
  }

  /** Frees every material and texture this library owns (block/cap geometries are shared). */
  dispose() {
    const seen = new Set();
    const texOf = (m) => [m.map, m.emissiveMap, m.normalMap, m.alphaMap];
    const disposeMat = (m) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      for (const t of texOf(m)) {
        if (t && !seen.has(t)) {
          seen.add(t);
          t.dispose();
        }
      }
      m.dispose();
    };
    for (const m of Object.values(this.typeMats)) disposeMat(m);
    for (const m of Object.values(this.emblemMats)) disposeMat(m);
    for (const m of Object.values(this.tagMats)) disposeMat(m);
    for (const t of this.arrowTags.values()) disposeMat(t.material);
    disposeMat(this.fogMat);
    for (const part of this.bottle) {
      part.geometry.dispose();
      disposeMat(part.material);
    }
    disposeMat(this.crackMat);
    this.trailTex.dispose();
    this.trailGeo.dispose();
    this.emblemGeo.dispose();
    this.crackGeo.dispose();
    this.boulderNormal?.dispose();
    this.snowNormal?.dispose();
  }
}

/** One pooled item: a rock (stone + mineral material, cap, crack overlay, embossed emblem) or a bottle. */
export class ItemVisual {
  constructor(lib) {
    this.lib = lib;
    this.group = new THREE.Group();
    this.rock = new THREE.Mesh(lib.blocks[0], lib.typeMats.coin);
    this.rock.castShadow = true;
    this.cap = new THREE.Mesh(lib.caps[0]);
    this.crack = new THREE.Mesh(lib.crackGeo, lib.crackMat.clone());
    this.emblem = new THREE.Mesh(lib.emblemGeo, lib.emblemMats.coin);
    // Faint motion streak above a falling rock (as in the reference art); behind the rock.
    this.trail = new THREE.Mesh(lib.trailGeo, new THREE.MeshBasicMaterial({ map: lib.trailTex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    this.trail.position.set(0, 1.35, -0.35);
    // Floating tag pill naming the item's effect; counter-scaled so it stays readable
    // however small the rock itself is drawn.
    this.tag = new THREE.Sprite(lib.tagMats.coin);
    this.tag.visible = false;
    this.bottle = new THREE.Group();
    for (const part of lib.bottle) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.position.set(part.x || 0, part.y, part.z || 0);
      mesh.rotation.y = part.rotY || 0;
      mesh.castShadow = !!part.shadow;
      this.bottle.add(mesh);
    }
    this.bottle.rotation.z = 0.14;
    this.bottle.scale.setScalar(ROCK.blockScale);
    this.group.add(this.rock, this.cap, this.crack, this.emblem, this.trail, this.bottle, this.tag);
    this.group.visible = false;
    this.mode = null;
  }

  configure(type, variant, capMaterial) {
    const lib = this.lib;
    this.type = type;
    this.variant = variant;
    this.fogged = false;
    this.tagDir = 0;
    this.tag.material = lib.tagMats[type];
    this.tagAspect = lib.tagAspects[type];
    this.tag.visible = false;
    const bottle = appearanceOf(type).kind === 'bottle';
    this.bottle.visible = bottle;
    this.rock.visible = !bottle;
    this.emblem.visible = !bottle;
    this.crack.visible = !bottle;
    this.rock.geometry = lib.blocks[variant];
    this.rock.material = lib.typeMats[type];
    this.emblem.material = lib.emblemMats[type];
    const front = lib.frontZ(variant);
    this.emblem.position.set(0, -0.02, front + 0.03);
    this.crack.position.set(0, 0, front + 0.015);
    this.cap.geometry = lib.caps[variant];
    this.cap.material = capMaterial || this.cap.material;
    this.cap.visible = !!capMaterial && !bottle;
    this.cap.position.y = lib.blocks[variant].boundingBox.max.y - 0.06;
    this.group.scale.setScalar(1);
    this.group.rotation.set(0, 0, 0);
    this.emblem.scale.setScalar(1);
    this.crack.material.opacity = 0;
    this.trail.material.opacity = 0;
    this.group.visible = true;
  }

  /**
   * Shows/hides the floating effect tag. `sx/sy/sz` is the current scale of the whole
   * visual: the tag divides it back out so the pill keeps the same on-screen size and
   * height above the rock no matter how small (or stretched) the rock is drawn.
   */
  setTag(show, sx = 1, sy = 1, sz = 1) {
    this.tag.visible = show;
    if (!show) return;
    const h = 0.46;
    this.tag.scale.set((h * this.tagAspect) / sx, h / sy, 1);
    this.tag.position.set(0, (0.95 * ROCK.blockScale) / sy, 0.75 / sz);
  }

  /** Points the tag at the side a pushed rock will drift to (0 = the plain tag). */
  useTag(dir) {
    if (dir === this.tagDir) return;
    this.tagDir = dir;
    const t = this.lib.tag(this.type, dir);
    this.tag.material = t.material;
    this.tagAspect = t.aspect;
  }

  /** Fog hides what a rock is: plain stone with no marking, until it drops below the fog. */
  setFogged(on) {
    if (on === this.fogged) return;
    this.fogged = on;
    const bottle = !on && appearanceOf(this.type).kind === 'bottle';
    this.bottle.visible = bottle;
    this.rock.visible = !bottle;
    this.crack.visible = !bottle;
    this.emblem.visible = !on && !bottle;
    this.rock.material = on ? this.lib.fogMat : this.lib.typeMats[this.type];
  }

  /** Frees this visual's own clones; everything else belongs to the shared library. */
  dispose() {
    this.crack.material.dispose();
    this.trail.material.dispose();
  }
}

/** Plain rocks sitting in every shelf cell, with detach holes and slide-in refills. */
export class ShelfCells {
  constructor(lib) {
    this.lib = lib;
    this.group = new THREE.Group();
    const euler = new THREE.Euler();
    this.cells = cliffCells().map((cell) => {
      const variant = variantOfCell(cell.id);
      const rot = new THREE.Quaternion().setFromEuler(euler.set(0, ((cell.id * 37) % 11) / 11 * 0.3 - 0.15, 0));
      return { cell, variant, rot, home: setRayPoint(new THREE.Vector3(), cell.x, cell.y, cell.z), capY: lib.blocks[variant].boundingBox.max.y - 0.06 };
    });
    this.materials = [];
    this.batches = [];
    this.m = new THREE.Matrix4();
    this.capM = new THREE.Matrix4();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  _batch(geometry, material, count, shadows) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    this.batches.push(mesh);
    return mesh;
  }

  setTheme(theme) {
    for (const m of this.materials) m.dispose();
    const lib = this.lib;
    if (!this.stone) {
      this.stone = imageTexture(lib.images.boulderDetail) || tex(stoneCanvas('#ffffff', hashSeed('cellstone', theme.id)));
    }
    this.materials = theme.block.map((c) => {
      const m = new THREE.MeshStandardMaterial({ color: c, map: this.stone, normalMap: lib.boulderNormal, roughness: 0.9, flatShading: true });
      m.color.multiplyScalar(1.55);
      return m;
    });
    this.capMaterial?.dispose(); // the previous theme's cap material would otherwise leak
    this.capMaterial = new THREE.MeshStandardMaterial({
      color: theme.cap,
      normalMap: lib.snowNormal,
      roughness: 0.8,
      flatShading: true,
      emissive: theme.capKind === 'snow' ? new THREE.Color('#223344') : new THREE.Color(0),
      emissiveIntensity: 0.25,
    });
    for (const b of this.batches) {
      this.group.remove(b);
      b.dispose();
    }
    this.batches = [];
    const blocks = new Map();
    for (const c of this.cells) {
      const key = `${c.variant}|${c.cell.id % this.materials.length}`;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(c);
    }
    for (const list of blocks.values()) {
      const mesh = this._batch(lib.blocks[list[0].variant], this.materials[list[0].cell.id % this.materials.length], list.length, true);
      list.forEach((c, i) => Object.assign(c, { block: mesh, blockIndex: i, cap: null }));
    }
    if (theme.capKind !== 'none') {
      lib.caps.forEach((geometry, variant) => {
        const list = this.cells.filter((c) => c.variant === variant);
        if (!list.length) return;
        const mesh = this._batch(geometry, this.capMaterial, list.length, false);
        list.forEach((c, i) => Object.assign(c, { cap: mesh, capIndex: i }));
      });
    }
    this.update(null, 0);
  }

  /** Visual state for time `t` from the stage's per-cell timeline (null timeline = all intact). */
  update(timeline, t) {
    for (const c of this.cells) {
      if (!c.block) continue;
      const drop = timeline ? timeline.current(c.cell.id, t) : null;
      let scale = 1;
      this.p.copy(c.home);
      if (drop && t < drop.refillEndAt) {
        if (t < drop.refillAt) scale = 0;
        else {
          const e = 1 - Math.pow(1 - (t - drop.refillAt) / (drop.refillEndAt - drop.refillAt), 3);
          setRayPoint(this.p, c.cell.x, c.cell.y, c.cell.z - 1.3 * (1 - e));
          scale = 0.7 + 0.3 * e;
        }
      }
      this.m.compose(this.p, c.rot, this.s.setScalar(scale));
      c.block.setMatrixAt(c.blockIndex, this.m);
      if (c.cap) c.cap.setMatrixAt(c.capIndex, this.capM.makeTranslation(0, c.capY, 0).premultiply(this.m));
    }
    for (const b of this.batches) b.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const b of this.batches) b.dispose();
    this.batches = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.capMaterial?.dispose();
    this.capMaterial = null;
    this.stone?.dispose();
    this.stone = null;
  }
}

/** Per-stage lookup of which drop (if any) owns each cell at a given time. */
export class CellTimeline {
  constructor(drops) {
    this.byCell = new Map();
    for (const d of drops) {
      if (!this.byCell.has(d.cellId)) this.byCell.set(d.cellId, []);
      this.byCell.get(d.cellId).push(d);
    }
    for (const list of this.byCell.values()) list.sort((a, b) => a.crackAt - b.crackAt);
  }

  current(cellId, t) {
    const list = this.byCell.get(cellId);
    if (!list) return null;
    let found = null;
    for (const d of list) {
      if (d.crackAt <= t) found = d;
      else break;
    }
    return found;
  }

  /** Drops whose rock is shaking loose in its cell at time t. */
  cracking(t, out = []) {
    for (const list of this.byCell.values()) {
      for (const d of list) {
        if (d.crackAt > t) break;
        if (t < d.detachAt) out.push(d);
      }
    }
    return out;
  }
}
