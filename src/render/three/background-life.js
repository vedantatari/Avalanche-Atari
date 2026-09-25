// Background life: weather, wildlife, and small cliff events that keep the scene moving.
// Everything here is decorative and lives behind the gameplay plane (or far away), so it
// never covers the rocks or the cart. Timings are in LIFE (src/config.js).
import * as THREE from '../../../vendor/three/three.module.min.js';
import { ARENA, LIFE } from '../../config.js';
import { ParticleSystem } from './fx.js';
import { CAMERA } from './projection.js';

const rand = (a, b) => a + Math.random() * (b - a);
const between = ([a, b]) => rand(a, b);
const pick = (list) => list[(Math.random() * list.length) | 0];

/** Depth factor: how much larger world coordinates are than plane coordinates at depth z. */
const depthK = (z) => (CAMERA.z - z) / (CAMERA.z - ARENA.gameZ);
const planeX = (x, z) => CAMERA.x + (x - CAMERA.x) / depthK(z);
const planeY = (y, z) => CAMERA.y + (y - CAMERA.y) / depthK(z);
const worldX = (px, z) => CAMERA.x + (px - CAMERA.x) * depthK(z);
const worldY = (py, z) => CAMERA.y + (py - CAMERA.y) * depthK(z);

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  const puff = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.6})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  };
  for (let i = 0; i < 9; i++) puff(50 + i * 19 + Math.random() * 12, 70 - Math.sin((i / 8) * Math.PI) * 22 + Math.random() * 8, 30 + Math.random() * 18, 0.55);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');
  const gx = ctx.createLinearGradient(0, 0, 64, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.5, 'rgba(255,255,255,1)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = 'destination-in';
  const gy = ctx.createLinearGradient(0, 0, 0, 256);
  gy.addColorStop(0, 'rgba(0,0,0,1)');
  gy.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBird(material) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), material);
  body.scale.set(2.3, 0.8, 0.9);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0.06, 0, 0, -0.1, 0, 0.36, 0.14, 0, 0.3, 0.06, 0, 0, -0.1, 0, 0.36, 0.14, 0, 0.3], 3));
  wing.computeVertexNormals();
  const left = new THREE.Mesh(wing, material);
  const right = new THREE.Mesh(wing, material);
  right.scale.z = -1;
  group.add(body, left, right);
  group.visible = false;
  return { group, left, right, active: false };
}

export class BackgroundLife {
  /**
   * @param {THREE.Scene} scene
   * @param {object} hooks { spawnPebbles(x, y, z, count) }
   */
  constructor(scene, hooks = {}) {
    this.hooks = hooks;
    this.group = new THREE.Group();
    this.group.name = 'background-life';
    scene.add(this.group);
    this.particles = new ParticleSystem(1100);
    this.particles.points.renderOrder = 0;
    this.group.add(this.particles.points);

    this.cloudTex = cloudTexture();
    this.clouds = [];
    for (let i = 0; i < LIFE.cloudCount; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.8 }));
      sprite.renderOrder = -1;
      this.group.add(sprite);
      this.clouds.push({ sprite, vx: rand(0.6, 1.3) });
    }

    this.birdMat = new THREE.MeshBasicMaterial({ color: '#232830', side: THREE.DoubleSide });
    this.birds = Array.from({ length: 10 }, () => makeBird(this.birdMat));
    for (const b of this.birds) {
      b.group.scale.setScalar(1.7);
      this.group.add(b.group);
    }

    // Cloud shadows drifting over the cliffs (in front of the cliff, behind every rock).
    const shadowTex = softTexture([[0, 1], [0.55, 0.7], [1, 0]]);
    this.shadows = Array.from({ length: LIFE.cloudShadows }, () => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTex, color: '#1c2a3a', transparent: true, opacity: LIFE.shadowOpacity, depthWrite: false, fog: false }),
      );
      mesh.renderOrder = 1;
      this.group.add(mesh);
      return { mesh, vx: 0 };
    });
    // Slanted sun shafts that slowly breathe.
    const shaftTex = shaftTexture();
    this.shafts = Array.from({ length: LIFE.sunShafts }, (_, i) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shaftTex, color: '#fff3d6', transparent: true, opacity: 0.1, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
      );
      mesh.renderOrder = 1;
      this.group.add(mesh);
      return { mesh, phase: i * 2.1 };
    });

    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpE = new THREE.Euler();
    this.tmpS = new THREE.Vector3();
    this.reducedMotion = false;
    this.wind = LIFE.baseWind;
    this.windDir = 1;
    this.gust = null;
    this.events = [];
    this.stats = { slides: 0, sifts: 0, flocks: 0, gusts: 0, avalanches: 0, eruptions: 0, spatters: 0 };
    this.time = 0;
  }

  /** @param {object} theme themeInfo; @param {object} scenery buildScenery() result */
  setTheme(theme, scenery) {
    this.theme = theme;
    this.h = scenery.life;
    this.sun = scenery.sun;
    this.rim = scenery.rim;
    this.sunBase = scenery.sun.intensity;
    this.rimBase = scenery.rim.intensity;
    this.particles.clear();
    this.events.length = 0;
    this.gust = null;
    for (const b of this.birds) {
      b.active = false;
      b.group.visible = false;
    }
    this.shadows.forEach((s, i) => {
      const w = rand(12, 18);
      s.mesh.scale.set(w, w * 0.55, 1);
      s.mesh.position.set(-24 + i * 17 + rand(-3, 3), rand(2.5, 7.5), 0.1);
      s.vx = rand(0.7, 1.2);
      s.mesh.visible = theme.id !== 'volcano';
    });
    this.shafts.forEach((s, i) => {
      s.mesh.material.color.set(theme.id === 'volcano' ? '#ff7a3a' : '#fff3d6');
      s.base = theme.id === 'volcano' ? 0.05 : 0.09;
      s.mesh.scale.set(rand(2.2, 3.4), 24, 1);
      s.mesh.position.set(-9 + i * 5.5 + rand(-1, 1), 6, -3.0);
      s.mesh.rotation.z = -0.42;
    });
    const tint = theme.id === 'volcano' ? '#6a5a56' : '#ffffff';
    this.clouds.forEach((c, i) => {
      c.sprite.material.color.set(tint);
      c.sprite.material.opacity = theme.id === 'volcano' ? 0.55 : 0.85;
      const w = rand(26, 42);
      c.sprite.scale.set(w, w * 0.42, 1);
      c.sprite.position.set(-110 + (220 / this.clouds.length) * i + rand(-10, 10), rand(22, 44), rand(-72, -95));
    });
    const kind = theme.capKind;
    this.capColors = kind === 'snow' ? ['#ffffff', '#eef4fa', '#dfe8f1'] : kind === 'ash' ? ['#9a908c', '#7d7470', '#b3aaa5'] : ['#f1ddb8', '#dcc39a', '#e9cfa6'];
    // Stagger the first events so the scene comes alive within a couple of seconds.
    this.timers = {
      slide: rand(0.8, 2),
      sift: rand(0.3, 1),
      birds: rand(1.5, 4),
      gust: rand(3, 6),
      avalanche: rand(4, 8),
      eruption: rand(5, 9),
      spatter: rand(1.5, 3),
      smoke: 0,
      steam: 0,
      plume: 0,
    };
  }

  setQuality(q) {
    this.particles.scale = q.particleScale;
    this.clouds.forEach((c, i) => (c.sprite.visible = i < Math.max(3, Math.round(LIFE.cloudCount * q.particleScale))));
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
  }

  // ------------------------------------------------------------------ helpers

  /** Ledges on the side cliffs that are currently on screen. */
  _visibleLedges(view) {
    return this.h.ledges.filter((p) => {
      const px = planeX(p.x, p.z);
      const py = planeY(p.y, p.z);
      return px > view.left + 0.5 && px < view.right - 0.5 && py < view.top - 1.5 && py > view.bottom + 2;
    });
  }

  _schedule(name, range) {
    this.timers[name] = between(range);
  }

  // ------------------------------------------------------------------ frame

  update(dt, time, view) {
    if (!this.h || !view) return;
    this.time = time;
    const calm = this.reducedMotion;

    // Wind: a gentle breeze with occasional gusts (not in reduced motion).
    let gustEnv = 0;
    if (this.gust) {
      this.gust.t += dt;
      const p = this.gust.t / LIFE.gustSeconds;
      gustEnv = p >= 1 ? 0 : Math.sin(Math.PI * p);
      if (p >= 1) this.gust = null;
    }
    this.wind = this.windDir * (LIFE.baseWind + gustEnv * (calm ? 0 : LIFE.gustStrength));

    // Timers.
    for (const k of Object.keys(this.timers)) this.timers[k] -= dt;
    if (dt > 0) this._events(dt, view, calm, gustEnv);

    this._updateBirds(dt, time, view);
    this._updateClouds(dt);
    this._updateShadowsAndShafts(dt, time);
    this._swayTrees(time);
    this._light(time);
    this.particles.update(dt);
  }

  _events(dt, view, calm, gustEnv) {
    const t = this.timers;
    const theme = this.theme.id;

    if (t.gust <= 0) {
      this._schedule('gust', LIFE.gustEvery);
      if (!calm) {
        this.gust = { t: 0 };
        this.windDir = Math.random() < 0.7 ? 1 : -1;
        this.stats.gusts++;
      }
    }
    // Spindrift: gusts lift snow/dust off the cliff tops.
    if (gustEnv > 0.35 && Math.random() < dt * 14) {
      const ledges = this._visibleLedges(view);
      if (ledges.length) {
        const p = pick(ledges);
        this.particles.emit({ x: p.x, y: p.y + 0.1, z: p.z, count: 4, colors: this.capColors, speed: 0.6, vx: this.wind * 1.6, lift: 0.5, gravity: -0.6, drag: 0.4, life: 1.4, size: 0.13, alpha: 0.7, spread: 0.8 });
      }
    }

    if (gustEnv > 0.5 && this.theme.id === 'ice' && this.h.trees && Math.random() < dt * 6) {
      const b = pick(this.h.trees.bases);
      const px = planeX(b.p.x, b.p.z);
      if (px > view.left && px < view.right) {
        this.particles.emit({ x: b.p.x, y: b.p.y + 1.6 * b.s, z: b.p.z + 0.3, count: 6, colors: this.capColors, speed: 0.7, vx: this.wind * 0.8, lift: 0.2, gravity: -2.5, life: 1.6, size: 0.2, alpha: 0.85, spread: 0.8 });
      }
    }

    // Small slides pouring off the side cliffs.
    if (t.slide <= 0) {
      this._schedule('slide', LIFE.slideEvery);
      if (!calm) {
        const ledges = this._visibleLedges(view);
        if (ledges.length) {
          this.events.push({ kind: 'slide', p: pick(ledges).clone(), t: 0, duration: rand(1.3, 2.1), landed: false });
          this.stats.slides++;
        }
      }
    }
    // Fine snow/dust sifting down the open cliff face behind the play area.
    if (t.sift <= 0) {
      this._schedule('sift', LIFE.siftEvery);
      if (!calm) {
        const z = -3.1;
        const px = rand(-7.4, 7.4);
        this.events.push({ kind: 'sift', p: new THREE.Vector3(worldX(px, z), worldY(6.5, z), z), t: 0, duration: rand(2, 3.4) });
        this.stats.sifts++;
      }
    }
    // Birds; none over the volcano, and none in reduced motion (crossing movement).
    if (t.birds <= 0) {
      this._schedule('birds', LIFE.birdsEvery);
      if (theme !== 'volcano' && !calm) this._launchBirds(view);
    }
    // Far-off avalanches on the peaks (Ice).
    if (t.avalanche <= 0) {
      this._schedule('avalanche', LIFE.avalancheEvery);
      if (!calm && theme !== 'volcano' && this.h.peaks.length) {
        const peak = pick(this.h.peaks);
        this.events.push({ kind: 'avalanche', peak, t: 0, duration: 3.6, dir: peak.side || (Math.random() < 0.5 ? -1 : 1) });
        this.stats.avalanches++;
      }
    }

    if (theme === 'ice' && this.h.chimney && t.smoke <= 0) {
      t.smoke = 0.28;
      const c = this.h.chimney;
      this.particles.emit({ x: c.x, y: c.y, z: c.z, count: 1, colors: ['#eef2f6', '#d5dce3'], speed: 0.12, vx: this.wind * 0.5, lift: 0.75, gravity: 0.12, drag: 0.3, life: 3.2, size: 0.3, grow: 2.4, alpha: 0.55, spread: 0.1 });
    }

    if (theme === 'volcano') {
      if (this.h.vents.length && t.steam <= 0) {
        t.steam = 0.32;
        const v = pick(this.h.vents);
        this.particles.emit({ x: v.x, y: v.y, z: v.z, count: 1, colors: ['#8d8480', '#6f6763', '#a39a95'], speed: 0.15, vx: this.wind * 0.4, lift: 0.95, gravity: 0.15, drag: 0.3, life: 2.8, size: 0.4, grow: 2.3, alpha: 0.45, spread: 0.3 });
      }
      if (t.spatter <= 0) {
        this._schedule('spatter', LIFE.spatterEvery);
        if (!calm && this.h.vents.length) {
          const v = pick(this.h.vents);
          this.particles.emit({ x: v.x, y: v.y + 0.1, z: v.z, count: 16, colors: ['#ff7a1f', '#ffc04a', '#ff4a12'], speed: 3.2, up: 1.6, gravity: -7, life: 1, size: 0.1, spread: 0.3 });
          this.particles.emit({ x: v.x, y: v.y + 0.2, z: v.z, count: 3, colors: ['#ff8a3c'], speed: 0.3, lift: 0.6, gravity: 0, life: 0.8, size: 0.5, grow: 1, alpha: 0.35 });
          this.stats.spatters++;
        }
      }
      if (this.h.crater && t.plume <= 0) {
        t.plume = 0.45;
        const c = this.h.crater;
        this.particles.emit({ x: c.x, y: c.y, z: c.z, count: 1, colors: ['#3a3230', '#4a403c', '#2d2725'], speed: 1, vx: 1.5 + this.wind, lift: 3.2, gravity: 0.2, drag: 0.1, life: 7, size: 5, grow: 2.2, alpha: 0.6, spread: 3 });
      }
      if (t.eruption <= 0) {
        this._schedule('eruption', LIFE.eruptionEvery);
        if (!calm && this.h.crater) {
          const c = this.h.crater;
          this.particles.emit({ x: c.x, y: c.y + 1, z: c.z, count: 26, colors: ['#ff7a1f', '#ffc04a', '#ff3d0f'], speed: 14, up: 2.2, gravity: -10, life: 2.6, size: 1.3, spread: 3 });
          this.particles.emit({ x: c.x, y: c.y + 2, z: c.z, count: 6, colors: ['#2d2725', '#4a403c'], speed: 2, lift: 5, gravity: 0.3, drag: 0.1, life: 6, size: 7, grow: 1.8, alpha: 0.7, spread: 4 });
          this.events.push({ kind: 'flash', t: 0, duration: 1.2 });
          this.stats.eruptions++;
        }
      }
    }

    // Run active multi-frame events.
    for (const e of this.events) {
      e.t += dt;
      const p = e.t / e.duration;
      if (e.kind === 'slide') {
        this.particles.emit({ x: e.p.x, y: e.p.y, z: e.p.z, count: 4, colors: this.capColors, speed: 0.8, up: 0.15, lift: -0.5, gravity: -6.5, drag: 2, life: 1.8, size: 0.28, spread: 0.7 });
        if (e.t - dt <= 0) {
          this.particles.emit({ x: e.p.x, y: e.p.y + 0.2, z: e.p.z, count: 7, colors: this.capColors, speed: 0.8, lift: 0.4, gravity: -0.3, life: 1.8, size: 0.6, grow: 1.6, alpha: 0.7, spread: 1 });
          this.hooks.spawnPebbles?.(e.p.x, e.p.y, e.p.z, 3);
        }
        if (!e.landed && e.t > 0.85) {
          e.landed = true;
          this.particles.emit({ x: e.p.x, y: -1.6, z: e.p.z + 0.4, count: 8, colors: this.capColors, speed: 1.2, lift: 0.5, gravity: -0.4, life: 2, size: 0.7, grow: 1.8, alpha: 0.6, spread: 1.4 });
        }
      } else if (e.kind === 'sift') {
        if (Math.random() < dt * 40) {
          this.particles.emit({ x: e.p.x, y: e.p.y, z: e.p.z, count: 2, colors: this.capColors, speed: 0.1, up: 0.1, lift: -0.6, gravity: -2.6, drag: 1, life: 3, size: 0.13, alpha: 0.85, spread: 0.25 });
        }
      } else if (e.kind === 'avalanche') {
        if (Math.random() < dt * 9) {
          const top = e.peak.top;
          const x = top.x + e.dir * p * e.peak.height * 0.25;
          const y = top.y - p * e.peak.height * 0.55;
          this.particles.emit({ x, y, z: top.z + 2, count: 2, colors: ['#ffffff', '#eef4fa'], speed: 0.8, lift: 0.2, gravity: -0.3, drag: 0.5, life: 2.6, size: 2.2, grow: 1.3, alpha: 0.85, spread: 1.5 });
        }
      } else if (e.kind === 'flash' && this.h.craterMesh) {
        this.h.craterMesh.material.emissiveIntensity = 2.4 + Math.sin(Math.PI * Math.min(1, p)) * 5;
      }
    }
    this.events = this.events.filter((e) => e.t < e.duration);
  }

  _launchBirds(view) {
    const free = this.birds.filter((b) => !b.active);
    if (free.length < 2) return;
    this.stats.flocks++;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const top = Math.min(view.top - 1.6, 17);
    const high = Math.random() < 0.4;
    const y = high ? rand(10.35, Math.max(10.6, top)) : rand(2.5, 6.2);
    const zBand = high ? [-2.9, -2.4] : [-2.9, -2.7];
    const x0 = dir > 0 ? view.left - 1.5 : view.right + 1.5;
    const n = Math.min(free.length, 3 + ((Math.random() * 4) | 0));
    const speed = rand(2.4, 3.4);
    for (let i = 0; i < n; i++) {
      const b = free[i];
      const row = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      Object.assign(b, { active: true, px: x0 - dir * Math.abs(row) * 0.9, py: y + row * 0.35, vx: dir * speed, z: rand(zBand[0], zBand[1]), phase: rand(0, 6), flap: rand(8, 11), end: dir > 0 ? view.right + 3 : view.left - 3 });
      b.group.visible = true;
    }
  }

  _updateBirds(dt, time, view) {
    for (const b of this.birds) {
      if (!b.active) continue;
      b.phase += dt * b.flap;
      b.px += b.vx * dt;
      const px = b.px;
      const py = b.py + Math.sin(time * 1.3 + b.phase) * 0.08;
      const heading = Math.sign(b.vx);
      if ((b.vx > 0 && px > b.end) || (b.vx < 0 && px < b.end) || px > view.right + 6 || px < view.left - 6) b.active = false;
      if (!b.active) {
        b.group.visible = false;
        continue;
      }
      b.group.position.set(worldX(px, b.z), worldY(py, b.z), b.z);
      b.group.rotation.y = heading >= 0 ? 0 : Math.PI;
      const flap = 0.2 + Math.sin(b.phase) * 0.8;
      b.left.rotation.x = -flap;
      b.right.rotation.x = flap;
    }
  }

  _updateClouds(dt) {
    if (this.reducedMotion) return; // clouds hold still: full-screen drift is a vestibular trigger
    for (const c of this.clouds) {
      c.sprite.position.x += c.vx * (1 + Math.abs(this.wind) * 0.4) * Math.sign(this.windDir || 1) * dt;
      if (c.sprite.position.x > 120) c.sprite.position.x = -120;
      if (c.sprite.position.x < -120) c.sprite.position.x = 120;
    }
  }

  _updateShadowsAndShafts(dt, time) {
    if (this.reducedMotion) {
      for (const s of this.shafts) s.mesh.material.opacity = s.base ?? 0.08;
      return;
    }
    for (const s of this.shadows) {
      s.mesh.position.x += s.vx * (1 + Math.abs(this.wind) * 0.3) * dt;
      if (s.mesh.position.x > 26) s.mesh.position.x = -26;
    }
    for (const s of this.shafts) {
      s.mesh.material.opacity = s.base * (0.55 + 0.45 * Math.sin(time * 0.35 + s.phase));
    }
  }

  _swayTrees(time) {
    const trees = this.h.trees;
    if (!trees) return;
    const amp = (this.reducedMotion ? 0.012 : 0.03) + Math.abs(this.wind) * (this.reducedMotion ? 0 : 0.035);
    const lean = this.wind * (this.reducedMotion ? 0 : 0.02);
    trees.bases.forEach((b, i) => {
      const a = Math.sin(time * 1.5 + b.phase) * amp - lean;
      this.tmpE.set(0, b.yaw, a, 'YXZ');
      this.tmpM.compose(b.p, this.tmpQ.setFromEuler(this.tmpE), this.tmpS.set(b.s, b.s, b.s));
      trees.mesh.setMatrixAt(i, this.tmpM);
    });
    trees.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Frees everything this system created (its group is expected to leave the scene too). */
  dispose() {
    const seen = new Set();
    const disposeMat = (m) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      if (m.map && !seen.has(m.map)) {
        seen.add(m.map);
        m.map.dispose();
      }
      m.dispose();
    };
    this.particles.dispose();
    for (const c of this.clouds) disposeMat(c.sprite.material);
    this.cloudTex.dispose();
    for (const b of this.birds) {
      b.group.traverse((o) => {
        if (o.isMesh && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
      });
    }
    disposeMat(this.birdMat);
    for (const s of [...this.shadows, ...this.shafts]) {
      s.mesh.geometry.dispose();
      disposeMat(s.mesh.material);
    }
  }

  /** Slow cloud shadows: the sun dims and brightens a little; volcano rim light pulses. */
  _light(time) {
    if (!this.sun) return;
    const shade = 0.5 + 0.5 * Math.sin(time * 0.11) * Math.sin(time * 0.067 + 1.3);
    this.sun.intensity = this.sunBase * (1 - LIFE.cloudShadow * shade);
    if (this.theme.id === 'volcano' && this.rim) {
      const flash = this.events.find((e) => e.kind === 'flash');
      const boost = flash ? Math.sin(Math.PI * Math.min(1, flash.t / flash.duration)) * 2.6 : 0;
      this.rim.intensity = this.rimBase * (1 + 0.12 * Math.sin(time * 1.7)) + boost;
    }
  }
}
