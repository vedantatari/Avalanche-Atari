// Shelf cells on the cliff and the marked item rocks they turn into. A cell's plain rock and
// the item rock that replaces it share the same geometry variant, so the rock that cracks is
// visibly the same rock that falls. The reverse item shakes loose as a whiskey bottle instead.
import * as THREE from '../../../vendor/three/three.module.min.js';
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
    this.emblemGeo = new THREE.PlaneGeometry(0.94, 0.94);
    this.crackGeo = new THREE.PlaneGeometry(1.25, 1.1);
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
        emissiveIntensity: type === 'fire' || type === 'demon' ? 0.75 : 0.42,
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
    this.group.add(this.rock, this.cap, this.crack, this.emblem, this.trail, this.bottle, this.tag);
    this.group.visible = false;
    this.mode = null;
  }

  configure(type, variant, capMaterial) {
    const lib = this.lib;
    this.type = type;
    this.variant = variant;
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
    this.tag.position.set(0, 0.95 / sy, 0.75 / sz);
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
    this.cells = cliffCells().map((cell) => {
      const variant = variantOfCell(cell.id);
      const mesh = new THREE.Mesh(lib.blocks[variant]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const cap = new THREE.Mesh(lib.caps[variant]);
      cap.position.y = lib.blocks[variant].boundingBox.max.y - 0.06;
      mesh.add(cap);
      const home = setRayPoint(new THREE.Vector3(), cell.x, cell.y, cell.z);
      mesh.position.copy(home);
      mesh.rotation.y = ((cell.id * 37) % 11) / 11 * 0.3 - 0.15;
      this.group.add(mesh);
      return { cell, variant, mesh, cap, home, baseRotY: mesh.rotation.y };
    });
    this.materials = [];
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
    for (const c of this.cells) {
      c.mesh.material = this.materials[c.cell.id % this.materials.length];
      c.cap.material = this.capMaterial;
      c.cap.visible = theme.capKind !== 'none';
    }
  }

  /** Visual state for time `t` from the stage's per-cell timeline (null timeline = all intact). */
  update(timeline, t) {
    for (const c of this.cells) {
      const drop = timeline ? timeline.current(c.cell.id, t) : null;
      const mesh = c.mesh;
      if (!drop || t >= drop.refillEndAt) {
        mesh.visible = true;
        mesh.position.copy(c.home);
        mesh.scale.setScalar(1);
        continue;
      }
      if (t < drop.refillAt) {
        mesh.visible = false; // cracking (item rock shown instead) or an empty hole
        continue;
      }
      // Refill: a new rock slides forward out of the socket.
      const p = (t - drop.refillAt) / (drop.refillEndAt - drop.refillAt);
      const e = 1 - Math.pow(1 - p, 3);
      mesh.visible = true;
      setRayPoint(mesh.position, c.cell.x, c.cell.y, c.cell.z - 1.3 * (1 - e));
      mesh.scale.setScalar(0.7 + 0.3 * e);
    }
  }

  dispose() {
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
