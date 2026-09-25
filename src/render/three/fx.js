// Pooled visual effects: soft particles, rock fragments, score popups, and effect badges.
// Everything is preallocated; nothing grows per frame.
import * as THREE from '../../../vendor/three/three.module.min.js';
import { ARENA } from '../../config.js';
import { labelCanvas } from '../emblems.js';
import { chunkyBlockGeometry } from './geometry.js';
import { setRayPoint } from './projection.js';

const VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = pcolor;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, size * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, smoothstep(0.5, 0.18, d) * vAlpha);
  #include <colorspace_fragment>
}`;

function pointsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
}

function pointsGeometry(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('pcolor', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

/** Ring-buffer burst particles (catch sparkles, snow puffs, dust, embers). */
export class ParticleSystem {
  constructor(capacity = 700) {
    this.n = capacity;
    this.geometry = pointsGeometry(capacity);
    this.material = pointsMaterial();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.alphaMul = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.next = 0;
    this.scale = 1;
    this.tmp = new THREE.Color();
  }

  /**
   * @param {object} o { x, y, z, count, colors, speed, spread, up, gravity, life, size,
   *   grow (smoke: size swells and fades in/out), alpha, drag (x damping), vx (extra x velocity) }
   */
  emit(o) {
    const count = Math.max(1, Math.round((o.count || 10) * this.scale));
    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.pcolor.array;
    const size = this.geometry.attributes.size.array;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 2) * (0.35 + Math.random() * 0.65);
      const spread = o.spread ?? 0.2;
      pos[i * 3] = o.x + (Math.random() - 0.5) * spread;
      pos[i * 3 + 1] = o.y + (Math.random() - 0.5) * spread;
      pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * spread * 0.5;
      this.vel[i * 3] = Math.cos(a) * sp * (o.xScale ?? 1) + (o.vx ?? 0);
      this.vel[i * 3 + 1] = Math.abs(Math.sin(a)) * sp * (o.up ?? 1) + (o.lift ?? 0);
      this.vel[i * 3 + 2] = (Math.random() - 0.3) * sp * 0.4;
      this.tmp.set(o.colors[k % o.colors.length]);
      col[i * 3] = this.tmp.r;
      col[i * 3 + 1] = this.tmp.g;
      col[i * 3 + 2] = this.tmp.b;
      const life = (o.life ?? 0.7) * (0.6 + Math.random() * 0.4);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.baseSize[i] = (o.size ?? 0.16) * (0.6 + Math.random() * 0.6);
      size[i] = this.baseSize[i];
      this.gravity[i] = o.gravity ?? -6;
      this.grow[i] = o.grow ?? 0;
      this.alphaMul[i] = o.alpha ?? 1;
      this.drag[i] = o.drag ?? 1.5;
    }
  }

  update(dt) {
    const pos = this.geometry.attributes.position.array;
    const size = this.geometry.attributes.size.array;
    const alpha = this.geometry.attributes.alpha.array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] += this.gravity[i] * dt;
      this.vel[i * 3] *= Math.max(0, 1 - dt * this.drag[i]);
      pos[i * 3] += this.vel[i * 3] * dt;
      pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const g = this.grow[i];
      if (g > 0) {
        // Smoke/dust puff: swells, fades in quickly and out slowly.
        alpha[i] = Math.min(1, t * 1.4) * Math.min(1, (1 - t) * 5) * this.alphaMul[i];
        size[i] = this.baseSize[i] * (1 + (1 - t) * g);
      } else {
        alpha[i] = Math.min(1, t * 1.6) * this.alphaMul[i];
        size[i] = this.baseSize[i] * (0.5 + t * 0.5);
      }
    }
    for (const name of ['position', 'size', 'alpha', 'pcolor']) this.geometry.attributes[name].needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Slow ambient motes: snow falling, embers rising, or dust drifting. */
export class AmbientParticles {
  constructor(kind, color, count) {
    this.kind = kind;
    this.n = count;
    this.geometry = pointsGeometry(count);
    this.material = pointsMaterial();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.seed = new Float32Array(count);
    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.pcolor.array;
    const size = this.geometry.attributes.size.array;
    const alpha = this.geometry.attributes.alpha.array;
    const c = new THREE.Color(color);
    const ash = new THREE.Color('#8f8783');
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 1] = -4 + Math.random() * 32;
      pos[i * 3 + 2] = -3 + Math.random() * 9;
      (kind === 'embers' && i % 2 ? ash : c).toArray(col, i * 3);
      this.seed[i] = Math.random() * 100;
      size[i] = kind === 'snow' ? 0.08 + Math.random() * 0.12 : kind === 'embers' ? 0.05 + Math.random() * 0.07 : 0.05 + Math.random() * 0.06;
      alpha[i] = kind === 'dust' ? 0.35 : 0.8;
    }
    for (const name of ['position', 'size', 'alpha', 'pcolor']) this.geometry.attributes[name].needsUpdate = true;
  }

  update(dt, time, wind = 0) {
    const pos = this.geometry.attributes.position.array;
    const alpha = this.geometry.attributes.alpha.array;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      pos[i * 3] += wind * (0.7 + (s % 1) * 0.6) * dt;
      if (this.kind === 'snow') {
        pos[i * 3] += Math.sin(time * 0.6 + s) * 0.35 * dt;
        pos[i * 3 + 1] -= (0.55 + (s % 1) * 0.5) * dt;
      } else if (this.kind === 'embers') {
        pos[i * 3] += Math.sin(time * 1.3 + s) * 0.3 * dt;
        if (i % 2) {
          pos[i * 3 + 1] -= (0.3 + (s % 1) * 0.3) * dt; // ash settling
          alpha[i] = 0.55;
        } else {
          pos[i * 3 + 1] += (0.35 + (s % 1) * 0.4) * dt;
          alpha[i] = 0.45 + 0.4 * Math.sin(time * 4 + s);
        }
      } else {
        pos[i * 3] += (0.35 + Math.sin(time * 0.3 + s) * 0.2) * dt;
        pos[i * 3 + 1] += Math.sin(time * 0.8 + s) * 0.08 * dt;
      }
      if (pos[i * 3 + 1] < -4) pos[i * 3 + 1] += 32;
      if (pos[i * 3 + 1] > 28) pos[i * 3 + 1] -= 32;
      if (pos[i * 3] > 25) pos[i * 3] -= 50;
      if (pos[i * 3] < -25) pos[i * 3] += 50;
    }
    this.geometry.attributes.position.needsUpdate = true;
    if (this.kind === 'embers') this.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Small tumbling rock chips for breaks and hazard hits. */
export class Fragments {
  constructor(capacity = 90) {
    this.n = capacity;
    const geo = chunkyBlockGeometry(12345, { w: 0.22, h: 0.18, d: 0.2, jitter: 0.02 });
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, fog: false }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.r = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
    this.t = new THREE.Vector3();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, hidden);
    this.mesh.setColorAt(0, new THREE.Color('#888'));
  }

  burst(x, y, z, colors, count = 8, power = 3) {
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.p.set([x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.4, z], i * 3);
      const a = Math.random() * Math.PI;
      this.v.set([Math.cos(a) * power * (0.4 + Math.random()), Math.sin(a) * power * (0.5 + Math.random() * 0.6), (Math.random() - 0.2) * 1.5], i * 3);
      this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.life[i] = 0.55 + Math.random() * 0.4;
      this.size[i] = 0.6 + Math.random() * 0.9;
      this.mesh.setColorAt(i, c.set(colors[k % colors.length]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.v[j + 1] -= 14 * dt;
      this.p[j] += this.v[j] * dt;
      this.p[j + 1] += this.v[j + 1] * dt;
      this.p[j + 2] += this.v[j + 2] * dt;
      const s = this.life[i] > 0 ? this.size[i] * Math.min(1, this.life[i] * 4) : 0;
      this.e.set(this.r[j] * this.life[i] * 3, this.r[j + 1] * this.life[i] * 3, this.r[j + 2]);
      this.m.compose(this.t.set(this.p[j], this.p[j + 1], this.p[j + 2]), this.q.setFromEuler(this.e), this.s.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.n; i++) {
      this.life[i] = 0;
      this.mesh.setMatrixAt(i, hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/**
 * Decorative pebbles that tumble off the cliff with each detaching rock. They are small,
 * unmarked, and fall behind the gameplay plane, so they never read as catchable rocks.
 */
export class Debris {
  constructor(capacity = 70) {
    this.n = capacity;
    const geo = chunkyBlockGeometry(777, { w: 0.34, h: 0.3, d: 0.3, jitter: 0.03, segments: 2 });
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.next = 0;
    this.colors = ['#9a9087'];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
    this.t = new THREE.Vector3();
    this.c = new THREE.Color();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, hidden);
    this.mesh.setColorAt(0, this.c.set('#999'));
  }

  setColors(colors) {
    this.colors = colors;
  }

  spawn(x, y, z, count = 3, spread = 0.7) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.p.set([x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * 0.4, z], i * 3);
      this.v.set([(Math.random() - 0.5) * 0.8, -Math.random() * 1.2, 0], i * 3);
      this.life[i] = 4;
      this.size[i] = 0.45 + Math.random() * 0.75;
      this.spin[i] = (Math.random() - 0.5) * 8;
      this.mesh.setColorAt(i, this.c.set(this.colors[(Math.random() * this.colors.length) | 0]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      this.v[j + 1] -= 7 * dt;
      this.p[j] += this.v[j] * dt;
      this.p[j + 1] += this.v[j + 1] * dt;
      if (this.p[j + 1] < -1.8) this.life[i] = 0;
      const s = this.life[i] > 0 ? this.size[i] : 0;
      const a = this.life[i] * this.spin[i];
      this.m.compose(this.t.set(this.p[j], this.p[j + 1], this.p[j + 2]), this.q.setFromEuler(this.e.set(a, a * 0.7, a * 0.3)), this.s.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.update(0);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/**
 * Popup/badge label textures, bounded as an LRU: multipliers make many distinct "+N" strings
 * over a session, so old entries are evicted and their GPU textures freed. A texture evicted
 * while briefly still on a sprite re-uploads on its next use, which is fine at this size.
 */
const LABEL_CACHE_LIMIT = 80;
const textureCache = new Map();

function labelTexture(text, style) {
  const key = `${text}|${style.fg}|${style.bg}`;
  let tex = textureCache.get(key);
  if (tex) {
    textureCache.delete(key); // re-insert to mark as most recently used
  } else {
    tex = new THREE.CanvasTexture(labelCanvas(text, style));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (textureCache.size >= LABEL_CACHE_LIMIT) {
      const [oldestKey, oldest] = textureCache.entries().next().value;
      textureCache.delete(oldestKey);
      oldest.dispose();
    }
  }
  textureCache.set(key, tex);
  return tex;
}

/** Frees every cached label texture (renderer teardown). */
export function disposeLabelTextures() {
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
}

function makeSprite() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
  s.visible = false;
  s.renderOrder = 3;
  return s;
}

function applyLabel(sprite, text, style, height) {
  const tex = labelTexture(text, style);
  if (sprite.material.map !== tex) {
    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
  }
  const img = tex.image;
  sprite.scale.set((img.width / img.height) * height, height, 1);
}

/** Rising "+50" style popups. They sit just behind the gameplay plane so rocks stay on top. */
export class Popups {
  constructor(capacity = 10) {
    this.group = new THREE.Group();
    this.items = Array.from({ length: capacity }, () => {
      const sprite = makeSprite();
      this.group.add(sprite);
      return { sprite, life: 0, x: 0, y: 0 };
    });
    this.next = 0;
  }

  show(text, x, y, color = '#ffffff') {
    const item = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    applyLabel(item.sprite, text, { fg: color, stroke: 'rgba(24,34,46,0.92)', height: 80 }, 0.82);
    item.life = 1;
    item.x = x;
    item.y = y;
    item.sprite.visible = true;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt / 0.95;
      const t = 1 - Math.max(0, item.life);
      setRayPoint(item.sprite.position, item.x, item.y + t * 1.3, ARENA.gameZ - 0.7);
      item.sprite.material.opacity = Math.min(1, item.life * 2.5);
      if (item.life <= 0) item.sprite.visible = false;
    }
  }

  clear() {
    for (const item of this.items) {
      item.life = 0;
      item.sprite.visible = false;
    }
  }

  dispose() {
    // Sprite maps live in the shared label cache (freed by disposeLabelTextures).
    for (const item of this.items) item.sprite.material.dispose();
  }
}

/** Timed-effect badges above the cart (size, reverse, multiplier, clones), behind the rock plane. */
export class EffectBadges {
  constructor() {
    this.group = new THREE.Group();
    this.sprites = {};
    for (const key of ['size', 'reverse', 'multiplier', 'clone']) {
      this.sprites[key] = makeSprite();
      this.group.add(this.sprites[key]);
    }
  }

  /** @param {{key:string, text:string, style:object}[]} badges from appearance.effectBadges */
  update(cartX, badges) {
    let y = 1.45;
    for (const sprite of Object.values(this.sprites)) sprite.visible = false;
    for (const b of badges) {
      const sprite = this.sprites[b.key];
      applyLabel(sprite, b.text, b.style, 0.5);
      setRayPoint(sprite.position, cartX, y, ARENA.gameZ - 1.1);
      sprite.visible = true;
      y += 0.62;
    }
  }

  dispose() {
    for (const sprite of Object.values(this.sprites)) sprite.material.dispose();
  }
}
