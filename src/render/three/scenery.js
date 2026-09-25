// Theme scenery: cliff wall, stacked boulder blocks, shelf ledges, side cliffs, vegetation,
// rail track, ground ledge, distant mountains, and theme props. The layout is identical for
// every theme (same seed); only materials, props, and ambience differ.
import * as THREE from '../../../vendor/three/three.module.min.js';
import { ARENA, CLIFF } from '../../config.js';
import { Rng, hashSeed } from '../../game/rng.js';
import { cliffCells } from '../../game/cliff.js';
import { themeInfo } from '../themes.js';
import { stoneCanvas } from '../emblems.js';
import {
  capGeometry,
  chunkyBlockGeometry,
  deadTreeGeometry,
  mountainGeometry,
  pineGeometry,
  shrubGeometry,
} from './geometry.js';
import { rayPoint } from './projection.js';
import { imageTexture } from './textures.js';

const VARIANTS = 6;
let sharedBlockGeos = null;
let sharedCapGeos = null;

export function blockGeometries() {
  if (!sharedBlockGeos) {
    sharedBlockGeos = [];
    sharedCapGeos = [];
    for (let i = 0; i < VARIANTS; i++) {
      const rng = new Rng(hashSeed('block', i));
      const w = rng.range(1.26, 1.42);
      const h = rng.range(1.04, 1.2);
      const d = rng.range(1.0, 1.16);
      sharedBlockGeos.push(chunkyBlockGeometry(hashSeed('blockgeo', i), { w, h, d }));
      sharedCapGeos.push(capGeometry(hashSeed('cap', i), w * 0.92, d * 0.9));
    }
  }
  return { blocks: sharedBlockGeos, caps: sharedCapGeos };
}

/** Frees the shared block/cap geometries (renderer teardown); they rebuild on next use. */
export function disposeSharedGeometries() {
  for (const g of sharedBlockGeos || []) g.dispose();
  for (const g of sharedCapGeos || []) g.dispose();
  sharedBlockGeos = null;
  sharedCapGeos = null;
}

function texture(canvas, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function skyTexture(colors) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.55, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Collects block instances then builds one InstancedMesh per geometry variant. */
class BlockBatch {
  constructor(material, capMaterial) {
    this.material = material;
    this.capMaterial = capMaterial;
    this.items = [];
  }

  add(variant, x, y, z, s = 1, color, { cap = false, rotY = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    this.items.push({ variant: variant % VARIANTS, x, y, z, s, color, cap, rotY, sx, sy, sz });
  }

  build(group, { castShadow = false, receiveShadow = true } = {}) {
    const { blocks, caps } = blockGeometries();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    for (let v = 0; v < VARIANTS; v++) {
      const list = this.items.filter((b) => b.variant === v);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(blocks[v], this.material, list.length);
      const capped = list.filter((b) => b.cap);
      const capMesh = capped.length ? new THREE.InstancedMesh(caps[v], this.capMaterial, capped.length) : null;
      const blockH = blocks[v].boundingBox.max.y;
      let ci = 0;
      list.forEach((b, i) => {
        q.setFromEuler(e.set(0, b.rotY, 0));
        const scale = new THREE.Vector3(b.s * b.sx, b.s * b.sy, b.s * b.sz);
        m.compose(new THREE.Vector3(b.x, b.y, b.z), q, scale);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(b.color));
        if (b.cap && capMesh) {
          m.compose(new THREE.Vector3(b.x, b.y + blockH * scale.y - 0.06 * scale.y, b.z), q, scale);
          capMesh.setMatrixAt(ci++, m);
        }
      });
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
      if (capMesh) {
        capMesh.receiveShadow = receiveShadow;
        group.add(capMesh);
      }
    }
  }
}

function tint(hex, rng, amount = 0.05) {
  return new THREE.Color(hex).offsetHSL(0, rng.range(-0.02, 0.02), rng.range(-amount, amount)).getHex();
}

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Builds everything static for a theme. Returns { group, background, lights, update(dt) }.
 */
export function buildScenery(themeId, { quality, images = {} }) {
  const T = themeInfo(themeId);
  const rng = new Rng(hashSeed('scenery-layout-v1'));
  const group = new THREE.Group();
  group.name = `scenery-${themeId}`;

  const stoneTex = imageTexture(images.boulderDetail) || texture(stoneCanvas('#ffffff', hashSeed('stone', themeId)), 1);
  const stoneNormal = imageTexture(images.boulderNormal, { color: false });
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: stoneTex, normalMap: stoneNormal, roughness: 0.93, metalness: 0, flatShading: true });
  blockMat.color.setScalar(1.55); // the detail map averages ~0.7; keep palette brightness
  const capMat = new THREE.MeshStandardMaterial({
    color: T.cap,
    normalMap: imageTexture(images.snowNormal, { color: false, repeat: [2, 2] }),
    roughness: T.capKind === 'snow' ? 0.75 : 0.95,
    flatShading: true,
    emissive: T.capKind === 'snow' ? new THREE.Color('#223344') : new THREE.Color(0),
    emissiveIntensity: 0.25,
  });
  const batch = new BlockBatch(blockMat, capMat);
  const caps = T.capKind !== 'none';

  // A. Central cliff wall: vertical pillars give the striated slate face.
  {
    const cliffTex = imageTexture(images.cliffDetail, { repeat: [1, 12] }) || stoneTex;
    const cliffNormal = imageTexture(images.cliffNormal, { color: false, repeat: [1, 12] });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cliffTex, normalMap: cliffNormal, roughness: 0.96, flatShading: true });
    wallMat.color.setScalar(1.5);
    const pillars = new BlockBatch(wallMat, capMat);
    let x = -12;
    while (x < 12) {
      const w = rng.range(1.0, 1.7);
      // Pillars stop behind the stepped block cliff so no spikes show against the sky.
      pillars.add(rng.int(0, 5), x + w / 2, 5.5, -4.8 + rng.range(-0.5, 0.5), 1, tint(rng.pick(T.wall), rng, 0.04), {
        sx: (w + 0.2) / 1.3,
        sy: 17 / 1.1,
        sz: 2.2,
      });
      x += w;
    }
    // The face stays sunlit like the reference art; shadows land on the blocks instead.
    pillars.build(group, { receiveShadow: false });
    // Snow patches clinging to the face (Ice only).
    if (T.capKind === 'snow') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      for (let k = 0; k < 7; k++) {
        const gx = 16 + Math.random() * 32;
        const gy = 20 + Math.random() * 24;
        const r = 10 + Math.random() * 12;
        const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
      }
      const patchTex = new THREE.CanvasTexture(c);
      const patchMat = new THREE.MeshStandardMaterial({ map: patchTex, transparent: true, depthWrite: false, roughness: 0.8, color: '#f6f9fc' });
      // Kept to the lower edges of the face so they never read as something falling.
      const patches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.4), patchMat, 10);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 10; i++) {
        const s = rng.range(0.9, 1.8);
        const x = (i % 2 ? 1 : -1) * rng.range(5.8, 9);
        m.compose(new THREE.Vector3(x, rng.range(-1.5, 1.2), -3.0), new THREE.Quaternion(), new THREE.Vector3(s, s, 1));
        patches.setMatrixAt(i, m);
      }
      group.add(patches);
    }
  }

  // B. Shelf ledges under each source row, plus dark sockets revealed when a rock detaches.
  {
    const socketGeo = new THREE.BoxGeometry(1.22, 1.02, 0.4);
    const socketMat = new THREE.MeshStandardMaterial({ color: '#1f2227', roughness: 1 });
    const cells = cliffCells();
    const sockets = new THREE.InstancedMesh(socketGeo, socketMat, cells.length);
    const m = new THREE.Matrix4();
    cells.forEach((cell, i) => {
      const p = rayPoint(cell.x, cell.y, cell.z - 0.55);
      m.makeTranslation(p.x, p.y, p.z);
      sockets.setMatrixAt(i, m);
    });
    group.add(sockets);
    CLIFF.rows.forEach((row, r) => {
      for (let x = -8.64; x <= 8.7; x += 1.44) {
        const p = rayPoint(x, row.y - 0.1, row.z - 1.25);
        const c = new THREE.Color(rng.pick(T.block)).offsetHSL(0, 0, -0.1).getHex();
        batch.add(rng.int(0, 5), p.x, p.y, p.z, 1.08, c, { cap: caps, rotY: rng.range(-0.15, 0.15) });
      }
    });
  }

  // C. Upper cliff: stacked blocks above the source shelves up to the skyline.
  for (let r = 0; r < 11; r++) {
    const y = 11.9 + r * 1.12;
    const z = -3.3 - r * 0.3;
    const offset = r % 2 ? 0.72 : 0;
    const halfSpan = 12 - r * 0.85 + rng.range(-0.4, 0.4);
    for (let x = -halfSpan + offset; x <= halfSpan; x += 1.44 + rng.range(-0.05, 0.1)) {
      if (rng.chance(0.06)) continue;
      batch.add(rng.int(0, 5), x, y + rng.range(-0.08, 0.08), z + rng.range(-0.25, 0.25), rng.range(0.94, 1.08), tint(rng.pick(T.block), rng), {
        cap: caps && rng.chance(0.95),
        rotY: rng.range(-0.15, 0.15),
      });
    }
  }

  // Positions and objects that src/render/three/background-life.js animates.
  const life = { trees: null, ledges: [], peaks: [], chimney: null, crater: null, craterMesh: null, vents: [] };

  // D. Side cliffs framing the arena, stepping down and outward.
  const treeSpots = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 20; i++) {
      const x = side * (9.4 + i * 1.45 + rng.range(-0.15, 0.15));
      const near = i < 4;
      const height = near ? rng.range(6.5, 10) : rng.range(2, 7.5) + Math.sin(i * 0.9) * 1.5;
      const z = -1.4 - rng.range(0, 2.6);
      let y = -1.3;
      while (y < height) {
        batch.add(rng.int(0, 5), x, y, z + rng.range(-0.2, 0.2), rng.range(1.0, 1.18), tint(rng.pick(T.block), rng), {
          cap: caps && (y + 1.2 >= height || rng.chance(0.55)),
          rotY: rng.range(-0.2, 0.2),
        });
        y += 1.14;
      }
      life.ledges.push(new THREE.Vector3(x, y - 0.55, z + 0.45));
      if (rng.chance(0.65)) treeSpots.push([x + rng.range(-0.4, 0.4), y - 0.5, z + 0.3]);
      // Lower foreground rocks.
      if (i > 0 && rng.chance(0.8)) {
        const fz = rng.range(0.9, 2.4);
        const fx = side * (9.9 + i * 1.45);
        batch.add(rng.int(0, 5), fx, -1.4, fz, rng.range(0.9, 1.2), tint(rng.pick(T.block), rng), { cap: caps, rotY: rng.range(-0.3, 0.3) });
        if (rng.chance(0.4)) treeSpots.push([fx, -0.6, fz - 0.4]);
      }
    }
  }
  // Trees along the back of the ground near the sides.
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    treeSpots.push([side * rng.range(4.8, 8.8), -1.95, -2.2 - rng.range(0, 1.2)]);
  }
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    treeSpots.push([side * rng.range(10.4, 19), -1.95, rng.range(0.6, 2.6)]);
  }

  // E. Ground ledge with the rail, and a rocky front edge under the control bar.
  {
    const groundMat = new THREE.MeshStandardMaterial({ color: T.groundRock, map: stoneTex, normalMap: stoneNormal, roughness: 0.95, flatShading: true });
    const topMat = new THREE.MeshStandardMaterial({ color: T.ground, roughness: 0.85, flatShading: true });
    const base = box(120, 40, 7, groundMat, 0, -22, 1.9);
    base.receiveShadow = true;
    group.add(base);
    const top = box(120, 0.14, 6.6, topMat, 0, -1.95, 1.9);
    top.receiveShadow = true;
    group.add(top);
    for (let row = 0; row < 4; row++) {
      const z = 5.15 + row * 0.35;
      const y = -2.35 - row * 1.12;
      for (let x = -40 + (row % 2) * 0.7; x <= 40; x += 1.5 + rng.range(-0.1, 0.1)) {
        batch.add(rng.int(0, 5), x, y, z, rng.range(1.05, 1.25), tint(rng.pick(T.block), rng, 0.08), {
          cap: caps && row === 0,
          rotY: rng.range(-0.2, 0.2),
          sz: 0.9,
        });
      }
    }
    // Soft lumps behind the rail.
    if (caps) {
      const lump = new THREE.InstancedMesh(capGeometry(hashSeed('lump'), 1.6, 1), topMat, 26);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 26; i++) {
        const s = rng.range(0.8, 1.6);
        m.compose(new THREE.Vector3(rng.range(-14, 14), -1.9, rng.range(-0.9, -0.2)), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.9, s));
        lump.setMatrixAt(i, m);
      }
      lump.receiveShadow = true;
      group.add(lump);
    }
  }

  // F. Rail track.
  {
    const railMat = new THREE.MeshStandardMaterial({ color: T.rail, roughness: 0.45, metalness: 0.55 });
    const sleeperMat = new THREE.MeshStandardMaterial({ color: '#4d3d31', roughness: 0.9, flatShading: true });
    const orange = new THREE.MeshStandardMaterial({ color: '#e7732b', roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.7 });
    const z0 = ARENA.gameZ;
    for (const dz of [-0.42, 0.42]) {
      const rail = box(19.6, 0.1, 0.11, railMat, 0, -1.8, z0 + dz);
      rail.receiveShadow = true;
      group.add(rail);
    }
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.08, 1.25), sleeperMat, 29);
    const brackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.24, 0.14), orange, 11);
    const bolts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), dark, 11);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 29; i++) {
      m.makeTranslation(-9.8 + i * 0.7, -1.89, z0);
      sleepers.setMatrixAt(i, m);
    }
    for (let i = 0; i < 11; i++) {
      const x = -9 + i * 1.8;
      m.makeTranslation(x, -1.86, z0 + 0.56);
      brackets.setMatrixAt(i, m);
      m.makeTranslation(x, -1.86, z0 + 0.64);
      bolts.setMatrixAt(i, m);
    }
    sleepers.receiveShadow = true;
    group.add(sleepers, brackets, bolts);
    for (const side of [-1, 1]) {
      const bumper = box(0.3, 0.55, 1.25, orange, side * 9.75, -1.55, z0);
      const stripe = box(0.32, 0.14, 1.27, dark, side * 9.75, -1.5, z0);
      group.add(bumper, stripe);
    }
  }

  // G. Vegetation.
  {
    let geo;
    let mat;
    if (T.treeKind === 'pine') {
      geo = pineGeometry(hashSeed('pine'), T.tree, T.capKind === 'snow' ? '#f2f6fa' : null);
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    } else if (T.treeKind === 'dead') {
      geo = deadTreeGeometry(hashSeed('dead'), T.tree);
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    } else {
      geo = shrubGeometry(hashSeed('shrub'), T.tree);
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    }
    const count = T.treeKind === 'pine' ? treeSpots.length : Math.ceil(treeSpots.length * 0.6);
    const trees = new THREE.InstancedMesh(geo, mat, count);
    trees.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
    const bases = [];
    for (let i = 0; i < count; i++) {
      const [x, y, z] = treeSpots[i];
      const s = T.treeKind === 'pine' ? rng.range(0.62, 1.15) : rng.range(0.8, 1.3);
      const base = { p: new THREE.Vector3(x, y, z), yaw: rng.range(0, 6), s, phase: rng.range(0, 6) };
      bases.push(base);
      m.compose(base.p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, base.yaw, 0)), new THREE.Vector3(s, s, s));
      trees.setMatrixAt(i, m);
    }
    life.trees = { mesh: trees, bases };
    trees.castShadow = quality !== 'low';
    group.add(trees);
  }

  batch.build(group);

  // H. Distant mountains.
  {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    for (let i = 0; i < 12; i++) {
      const height = rng.range(34, 70);
      const radius = rng.range(20, 34);
      const geo = mountainGeometry(hashSeed('mtn', i), T.mountain, T.mountainTop, { radius, height });
      const mesh = new THREE.Mesh(geo, mat);
      const x = -110 + i * 20 + rng.range(-6, 6);
      mesh.position.set(x, height / 2 - 12, -95 - rng.range(0, 40));
      mesh.rotation.y = rng.range(0, Math.PI);
      group.add(mesh);
    }
  }

  // Tall peaks behind the side cliffs so snowy summits show in the upper corners.
  {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const height = rng.range(27, 32);
        const geo = mountainGeometry(hashSeed('peak', side, i), T.mountain, T.mountainTop, { radius: rng.range(9, 12), height });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(side * (19 + i * 7 + rng.range(-1.5, 1.5)), height / 2 - 12 + rng.range(-1, 1.5), -26 - i * 5);
        mesh.rotation.y = rng.range(0, Math.PI);
        group.add(mesh);
        life.peaks.push({ top: new THREE.Vector3(mesh.position.x, mesh.position.y + height / 2, mesh.position.z), side, height });
      }
    }
  }

  // Higher peaks near the centre: only tall (portrait) views reach them, above the cliff top.
  {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const height = rng.range(36, 44);
      const geo = mountainGeometry(hashSeed('tallpeak', i), T.mountain, T.mountainTop, { radius: rng.range(10, 13), height });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(side * (7 + Math.floor(i / 2) * 9 + rng.range(-1, 1)), height / 2 - 12, -34 - i * 3);
      mesh.rotation.y = rng.range(0, Math.PI);
      group.add(mesh);
      life.peaks.push({ top: new THREE.Vector3(mesh.position.x, mesh.position.y + height / 2, mesh.position.z), side, height });
    }
  }

  const animated = [];
  addProps(themeId, T, group, rng, animated, life);

  // Lights.
  const lights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(T.hemi.sky, T.hemi.ground, T.hemi.intensity);
  const sun = new THREE.DirectionalLight(T.sun.color, T.sun.intensity);
  const [sx, sy, sz] = T.sun.dir;
  sun.position.set(sx * 40, sy * 40 + 4, sz * 40 + ARENA.gameZ);
  sun.target.position.set(0, 4, ARENA.gameZ);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -15;
  sc.right = 15;
  sc.top = 16;
  sc.bottom = -8;
  sc.near = 1;
  sc.far = 110;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  const rim = new THREE.DirectionalLight(T.rim.color, T.rim.intensity);
  rim.position.set(6, 10, -30);
  lights.add(hemi, sun, sun.target, rim);

  return {
    group,
    lights,
    sun,
    rim,
    life,
    background: skyTexture(T.sky),
    fog: new THREE.FogExp2(T.fog, T.fogDensity),
    update(time, wind) {
      for (const a of animated) a(time, wind);
    },
  };
}

function addProps(themeId, T, group, rng, animated, life) {
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  const glow = (color, intensity = 1.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.6 });

  if (themeId === 'ice') {
    // Warm research hut on the right-hand ledge.
    const hut = new THREE.Group();
    hut.add(box(2.4, 1.5, 1.8, std('#c4473a'), 0, 0.75, 0));
    for (const side of [-1, 1]) {
      const slab = box(2.7, 0.14, 1.25, std('#f4f7fb'), 0, 1.85, side * 0.5);
      slab.rotation.x = side * 0.55;
      hut.add(slab);
    }
    const win = glow(T.window, 1.4);
    hut.add(box(0.5, 0.45, 0.05, win, -0.55, 0.9, 0.92), box(0.5, 0.45, 0.05, win, 0.55, 0.9, 0.92));
    hut.add(box(0.12, 1.0, 0.12, std('#6b7078'), 0.9, 2.5, -0.3));
    hut.position.set(12.6, -1.95, -0.2);
    hut.rotation.y = -0.3;
    group.add(hut);
    hut.updateMatrixWorld(true);
    life.chimney = hut.localToWorld(new THREE.Vector3(0.9, 3.05, -0.3));
    // Survey mast with a blinking beacon.
    const mast = new THREE.Group();
    const steel = std('#c96a2c');
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) mast.add(box(0.06, 4.2, 0.06, steel, dx, 2.1, dz));
    for (let i = 0; i < 6; i++) mast.add(box(0.44, 0.05, 0.05, steel, 0, 0.5 + i * 0.7, 0.18));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow('#ff5a3a', 2));
    beacon.position.y = 4.35;
    mast.add(beacon);
    // Pennant that ripples in the wind.
    const flagGeo = new THREE.PlaneGeometry(0.8, 0.42, 8, 1);
    flagGeo.translate(0.4, 0, 0);
    const flagBase = Float32Array.from(flagGeo.attributes.position.array);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: '#ff8a2a', side: THREE.DoubleSide, roughness: 0.7 }));
    flag.position.set(0.04, 3.95, 0);
    mast.add(flag);
    mast.position.set(10.4, -1.9, -0.9);
    group.add(mast);
    animated.push((t, wind = 0.3) => {
      beacon.material.emissiveIntensity = 1 + Math.max(0, Math.sin(t * 3)) * 2;
      const pos = flagGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = flagBase[i * 3];
        pos.setZ(i, Math.sin(x * 7 - t * (5 + wind * 3)) * 0.09 * (x / 0.8) * (0.6 + wind * 0.4));
      }
      pos.needsUpdate = true;
      flag.rotation.y = -0.25 + Math.sin(t * 0.9) * 0.12;
    });
  } else if (themeId === 'volcano') {
    // Distant volcano with a glowing crater and lava rivers; restrained, far behind the arena.
    const cone = new THREE.Mesh(
      mountainGeometry(hashSeed('volcano'), '#2a2124', '#3a2a2a', { radius: 36, height: 56 }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    );
    cone.position.set(-26, 16, -120);
    group.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 2, 8), glow(T.lava, 2.4));
    crater.position.set(-26, 43.5, -120);
    group.add(crater);
    life.crater = new THREE.Vector3(-26, 45, -120);
    life.craterMesh = crater;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      life.vents.push(new THREE.Vector3(side * rng.range(10, 16), -1.85, rng.range(0.2, 2.2)));
    }
    const lavaMat = new THREE.MeshBasicMaterial({ color: T.lava, fog: false, toneMapped: false });
    for (let i = 0; i < 4; i++) {
      const s = box(1.2, 26, 0.4, lavaMat, -26 + (i - 1.5) * 5, 28, -103 + i);
      s.rotation.z = (i - 1.5) * 0.35;
      group.add(s);
    }
    // Restrained lava seams low on the basalt wall (zig-zag, thin, far from the catch line colours).
    const seamMat = new THREE.MeshBasicMaterial({ color: '#ff6a1a', fog: false, toneMapped: false, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 6; i++) {
      // Kept to the arena edges so nothing orange competes with fire rocks mid-air.
      let x = (i % 2 ? 1 : -1) * rng.range(9.6, 11.5);
      let y = rng.range(-1.8, 1.5);
      for (let k = 0; k < 4; k++) {
        const len = rng.range(0.4, 0.8);
        const a = rng.range(-0.7, 0.7);
        const seg = box(0.06, len, 0.04, seamMat, x, y + len / 2, -3.45);
        seg.rotation.z = a;
        group.add(seg);
        x -= Math.sin(a) * len;
        y += Math.cos(a) * len;
      }
    }
    animated.push((t) => {
      crater.material.emissiveIntensity = 2.1 + Math.sin(t * 0.8) * 0.4;
      seamMat.opacity = 0.45 + Math.sin(t * 1.3) * 0.12;
    });
  }
}
