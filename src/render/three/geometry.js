// Procedural low-poly geometry: chunky rock blocks, snow caps, trees, mountains.
import * as THREE from '../../../vendor/three/three.module.min.js';
import { Rng } from '../../game/rng.js';

const key = (v) => `${Math.round(v.x * 997)}|${Math.round(v.y * 997)}|${Math.round(v.z * 997)}`;

/**
 * Displaces vertices by a per-position random offset. Vertices shared between faces get the
 * same offset (looked up by original position), so the mesh stays watertight.
 */
function jitterByPosition(geometry, rng, amount, shape = (v) => v) {
  const pos = geometry.attributes.position;
  const offsets = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = key(v);
    let off = offsets.get(k);
    if (!off) {
      off = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(amount);
      offsets.set(k, off);
    }
    shape(v).add(off);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
}

/** Rounded, faceted boulder block (unit-ish size, centred on the origin). */
export function chunkyBlockGeometry(seed, { w = 1.36, h = 1.16, d = 1.12, round = 0.46, jitter = 0.07, segments = 3 } = {}) {
  const rng = new Rng(seed);
  const g = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  jitterByPosition(g, rng, jitter, (v) => {
    const len = v.length() || 1;
    return v.lerp(v.clone().multiplyScalar(0.6 / len), round);
  });
  g.scale(w, h, d);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** Lumpy snow/ash/dust cap that sits on top of a block of footprint w x d. */
export function capGeometry(seed, w, d) {
  const rng = new Rng(seed);
  const g = new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  jitterByPosition(g, rng, 0.05);
  g.scale(w * 1.1, 0.78, d * 1.04);
  g.computeVertexNormals();
  return g;
}

function paint(geometry, color) {
  const c = new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Concatenates non-indexed geometries that share position/normal/color attributes. */
export function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'color'];
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const total = parts.reduce((s, g) => s + g.attributes[name].array.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const g of parts) {
      out.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  merged.computeBoundingSphere();
  return merged;
}

/** Snow tips are painted on upward-facing triangles of a coloured geometry. */
function frostTops(geometry, snowColor, threshold = 0.55, minY = -Infinity) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const col = g.attributes.color;
  const snow = new THREE.Color(snowColor);
  for (let i = 0; i < n.count; i += 3) {
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    const pos = g.attributes.position;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (ny > threshold && cy > minY) for (let k = 0; k < 3; k++) col.setXYZ(i + k, snow.r, snow.g, snow.b);
  }
  return g;
}

export function pineGeometry(seed, color, snowColor) {
  const rng = new Rng(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.11, 0.6, 5);
  trunk.translate(0, 0.3, 0);
  parts.push(paint(trunk.toNonIndexed(), '#5a3d28'));
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const r = 0.78 - i * 0.14;
    const h = 0.82 - i * 0.06;
    const base = 0.45 + i * 0.44;
    const cone = new THREE.ConeGeometry(r, h, 8, 2);
    jitterByPosition(cone, rng, 0.035);
    cone.translate(0, base + h / 2, 0);
    let g = paint(cone.toNonIndexed(), color);
    if (snowColor) g = frostTops(g, snowColor, 0.35, base + h * 0.42);
    parts.push(g);
  }
  const merged = mergeGeometries(parts.map((g) => (g.attributes.normal ? g : (g.computeVertexNormals(), g))));
  merged.computeVertexNormals();
  return merged;
}

export function deadTreeGeometry(seed, color) {
  const rng = new Rng(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.1, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  parts.push(paint(trunk.toNonIndexed(), color));
  for (let i = 0; i < 3; i++) {
    const b = new THREE.CylinderGeometry(0.02, 0.045, 0.7, 4);
    b.translate(0, 0.35, 0);
    b.rotateZ((i % 2 ? 1 : -1) * rng.range(0.5, 0.9));
    b.translate(0, 0.7 + i * 0.3, 0);
    parts.push(paint(b.toNonIndexed(), color));
  }
  parts.forEach((g) => g.computeVertexNormals());
  return mergeGeometries(parts);
}

export function shrubGeometry(seed, color) {
  const rng = new Rng(seed);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.IcosahedronGeometry(rng.range(0.22, 0.34), 0);
    s.translate(rng.range(-0.25, 0.25), rng.range(0.18, 0.3), rng.range(-0.15, 0.15));
    const g = paint(s.index ? s.toNonIndexed() : s, color);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** Jagged mountain cone with a painted summit. */
export function mountainGeometry(seed, color, topColor, { radius = 12, height = 20 } = {}) {
  const rng = new Rng(seed);
  const g = new THREE.ConeGeometry(radius, height, 8, 5);
  jitterByPosition(g, rng, radius * 0.08);
  const ng = paint(g.toNonIndexed(), color);
  const pos = ng.attributes.position;
  const col = ng.attributes.color;
  const top = new THREE.Color(topColor);
  const base = new THREE.Color(color);
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const snowLine = height * (0.12 + rng.range(-0.06, 0.06));
    const c = y > snowLine ? top : base.clone().offsetHSL(0, 0, rng.range(-0.04, 0.04));
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, c.r, c.g, c.b);
  }
  ng.computeVertexNormals();
  return ng;
}
