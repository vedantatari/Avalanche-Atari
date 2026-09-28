import * as THREE from '../../../vendor/three/three.module.min.js';
import { ARENA } from '../../config.js';
import { Rng, hashSeed } from '../../game/rng.js';
import { CAMERA, setRayPoint } from './projection.js';

const Z = ARENA.gameZ + 1.25;
const K = (CAMERA.z - Z) / (CAMERA.z - ARENA.gameZ);
const TOP = 11.5;
const BOTTOM = -1.85;
const TINTS = {
  ice: { haze: '#d6ebff', streaks: '#ffffff', cloud: '#c4d4f0', strip: '#8ce1ff', frost: '#e6f6ff', edge: '#bff0ff', flash: '#e8f6ff' },
  lava: { haze: '#ff7a2a', streaks: '#ffc24a', cloud: '#a89890', strip: '#ff8a2a', frost: '#ff9a3a', edge: '#ffb040', flash: '#ff9a4a' },
};

function canvasTexture(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function sheet(map, blending = THREE.NormalBlending, order = 2.6) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map, color: map ? '#ffffff' : '#e8f6ff', transparent: true, opacity: 0, depthWrite: false, blending, fog: false }),
  );
  m.renderOrder = order;
  m.visible = false;
  return m;
}

function hazeTexture() {
  return canvasTexture(64, 128, (ctx, w, h) => {
    const v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(235,235,235,0.35)');
    v.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const e = ctx.createLinearGradient(0, 0, w, 0);
    e.addColorStop(0, 'rgba(0,0,0,0)');
    e.addColorStop(0.12, 'rgba(0,0,0,1)');
    e.addColorStop(0.88, 'rgba(0,0,0,1)');
    e.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = e;
    ctx.fillRect(0, 0, w, h);
  });
}

function streakTexture() {
  const rng = new Rng(hashSeed('storm-streaks'));
  const t = canvasTexture(64, 256, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 80; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const l = rng.range(8, 26);
      ctx.lineWidth = rng.range(0.8, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - l * 0.35, y + l);
      ctx.stroke();
    }
  }, true);
  t.repeat.set(2, 3);
  return t;
}

function cloudTexture() {
  const rng = new Rng(hashSeed('storm-cloud'));
  return canvasTexture(256, 96, (ctx, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = rng.range(w * 0.1, w * 0.9);
      const y = rng.range(h * 0.25, h * 0.7);
      const r = rng.range(18, 42);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const shade = Math.round(rng.range(70, 120));
      g.addColorStop(0, `rgba(${shade},${shade},${shade},0.9)`);
      g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

function stripeTexture() {
  const t = canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(24,24,24,0.75)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 16, h);
      ctx.lineTo(x + 16 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
  }, true);
  t.repeat.set(3, 1);
  return t;
}

function frostTexture() {
  const rng = new Rng(hashSeed('storm-frost'));
  return canvasTexture(128, 32, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(215,215,215,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 26; i++) {
      const x = rng.range(0, w);
      const s = rng.range(2, 5);
      ctx.beginPath();
      ctx.moveTo(x - s, h * 0.45);
      ctx.lineTo(x + s, h * 0.45);
      ctx.lineTo(x, h * 0.45 - rng.range(6, 14));
      ctx.closePath();
      ctx.fill();
    }
  });
}

function edgeTexture() {
  return canvasTexture(16, 4, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(160,160,160,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(160,160,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function boltGeometry(seed, width) {
  const rng = new Rng(seed);
  const pos = [];
  const strip = (pts, w) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const a = w * (1 - (i / pts.length) * 0.4);
      const b = w * (1 - ((i + 1) / pts.length) * 0.4);
      pos.push(x0 - a, y0, 0, x0 + a, y0, 0, x1 + b, y1, 0, x0 - a, y0, 0, x1 + b, y1, 0, x1 - b, y1, 0);
    }
  };
  const main = [];
  let x = 0;
  for (let y = TOP; y > BOTTOM; y -= rng.range(0.5, 1.1)) {
    main.push([x, y]);
    x = Math.max(-1, Math.min(1, x + rng.range(-0.6, 0.6)));
  }
  main.push([x, BOTTOM]);
  strip(main, width);
  const from = main[rng.int(2, Math.max(2, main.length - 4))];
  const dir = rng.chance(0.5) ? 1 : -1;
  const branch = [from];
  for (let k = 1; k <= 3; k++) branch.push([from[0] + dir * k * rng.range(0.4, 0.7), from[1] - k * rng.range(0.5, 0.9)]);
  strip(branch, width * 0.55);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export class StormFx {
  constructor(particles) {
    this.particles = particles;
    this.group = new THREE.Group();
    this.haze = sheet(hazeTexture());
    this.streaks = sheet(streakTexture(), THREE.AdditiveBlending);
    this.cloud = sheet(cloudTexture());
    this.strip = sheet(stripeTexture());
    this.frost = sheet(frostTexture());
    const edge = edgeTexture();
    this.edges = [sheet(edge, THREE.AdditiveBlending), sheet(edge, THREE.AdditiveBlending)];
    this.flash = sheet(null, THREE.AdditiveBlending, 3.5);
    this.flash.position.set(CAMERA.x, CAMERA.y, ARENA.gameZ + 6);
    this.flash.scale.set(400, 400, 1);
    this.parts = [this.haze, this.streaks, this.cloud, this.strip, this.frost, ...this.edges];
    this.shapes = Array.from({ length: 6 }, (_, i) => [boltGeometry(hashSeed('bolt', i), 0.11), boltGeometry(hashSeed('bolt', i), 0.5)]);
    this.bolts = Array.from({ length: 4 }, () => {
      const material = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const glow = new THREE.Mesh(this.shapes[0][1], material('#7fd0ff'));
      const core = new THREE.Mesh(this.shapes[0][0], material('#ffffff'));
      const g = new THREE.Group();
      g.add(glow, core);
      glow.renderOrder = core.renderOrder = 3;
      g.visible = false;
      this.group.add(g);
      return { g, core, glow, life: 0, max: 1 };
    });
    this.group.add(...this.parts, this.flash);
    this.nextBolt = 0;
    this.flashLevel = 0;
    this.boltIndex = 0;
    this.setKind('ice');
  }

  setKind(kind) {
    this.kind = kind === 'lava' ? 'lava' : 'ice';
    const t = TINTS[this.kind];
    this.haze.material.color.set(t.haze);
    this.streaks.material.color.set(t.streaks);
    this.cloud.material.color.set(t.cloud);
    this.strip.material.color.set(t.strip);
    this.frost.material.color.set(t.frost);
    for (const e of this.edges) e.material.color.set(t.edge);
    this.flash.material.color.set(t.flash);
  }

  strike(x, big = false) {
    if (this.kind === 'lava') this.burst(x, big);
    else this.bolt(x, big);
  }

  burst(x, big = false) {
    this.particles.emit({ x, y: -1.5, z: Z, count: big ? 26 : 12, colors: ['#ffe07a', '#ff9a2a', '#ff4a12'], speed: big ? 5 : 3.5, up: 1.5, lift: big ? 8 : 6, gravity: -9, drag: 0.4, life: 1.3, size: big ? 0.3 : 0.24, spread: 0.6 });
    this.particles.emit({ x, y: -1.2, z: Z - 0.1, count: big ? 10 : 5, colors: ['#3a302c', '#5c4a42', '#2a2220'], speed: 1.2, lift: 2.5, gravity: 1.5, drag: 1.5, life: 1.8, size: 0.5, grow: 1.2, alpha: 0.6 });
    this.flashLevel = Math.max(this.flashLevel, big ? 0.5 : 0.18);
  }

  dispose() {
    for (const pair of this.shapes) for (const g of pair) g.dispose();
  }

  reset() {
    for (const b of this.bolts) {
      b.life = 0;
      b.g.visible = false;
    }
    this.flashLevel = 0;
  }

  _place(mesh, x, y, w, h) {
    setRayPoint(mesh.position, x, y, Z);
    mesh.scale.set(w * K, h * K, 1);
  }

  bolt(x, big = false) {
    const b = this.bolts[this.boltIndex++ % this.bolts.length];
    const [core, glow] = this.shapes[Math.floor(Math.random() * this.shapes.length)];
    b.core.geometry = core;
    b.glow.geometry = glow;
    setRayPoint(b.g.position, x, 0, Z + 0.05);
    b.g.scale.set((Math.random() < 0.5 ? -1 : 1) * K * (big ? 1.4 : 1), K, K);
    b.life = b.max = big ? 0.55 : 0.28;
    b.g.visible = true;
    this.flashLevel = Math.max(this.flashLevel, big ? 0.6 : 0.22);
  }

  update(storms, T, dt, clock, calm) {
    const s = storms?.find((z) => T >= z.warnAt && T <= z.endAt + 0.6) || null;
    if (!s) {
      for (const m of this.parts) m.visible = false;
    } else {
      const warn = T < s.strikeAt;
      const fade = T > s.endAt ? Math.max(0, 1 - (T - s.endAt) / 0.6) : 1;
      const p = warn ? (T - s.warnAt) / (s.strikeAt - s.warnAt) : 1;
      const blink = calm ? 0.6 : 0.5 + 0.5 * Math.sin(clock * (10 + 14 * p));
      const w = s.half * 2;
      const mid = (TOP + BOTTOM) / 2;
      this._place(this.haze, s.x, mid, w, TOP - BOTTOM);
      this._place(this.streaks, s.x, mid, w, TOP - BOTTOM);
      this._place(this.cloud, s.x, 9.7, w * 1.35, 2.2);
      this._place(this.strip, s.x, -1.62, w, 0.42);
      this._place(this.frost, s.x, -1.62, w, 0.5);
      this.edges.forEach((e, i) => this._place(e, s.x + (i ? 1 : -1) * s.half, mid, 0.35, TOP - BOTTOM));
      const set = (m, o) => {
        m.material.opacity = o;
        m.visible = o > 0.005;
      };
      set(this.haze, warn ? 0.08 + 0.14 * blink : 0.6 * fade);
      set(this.streaks, warn ? 0 : 0.55 * fade);
      set(this.cloud, warn ? 0.75 * p : 0.9 * fade);
      set(this.strip, warn ? 0.45 + 0.5 * blink : 0);
      set(this.frost, warn ? 0 : 0.85 * fade);
      for (const e of this.edges) set(e, warn ? 0.35 + 0.6 * blink : 0.5 * fade);
      const lava = this.kind === 'lava';
      if (!calm) {
        this.streaks.material.map.offset.y += dt * (lava ? -2.2 : 1.6);
        this.streaks.material.map.offset.x += dt * 0.4;
        this.strip.material.map.offset.x += dt * 1.5;
      }
      if (lava && warn && dt > 0 && !calm && Math.random() < dt * 14) {
        this.particles.emit({ x: s.x + (Math.random() - 0.5) * w, y: -1.6, z: Z, count: 2, colors: ['#ffd24a', '#ff7a1c'], speed: 0.6, lift: 2 + 3 * p, gravity: -6, life: 0.7, size: 0.12 });
      }
      if (!warn && T < s.endAt && dt > 0) {
        if (clock >= this.nextBolt) {
          this.strike(s.x + (Math.random() - 0.5) * s.half * 1.4);
          this.nextBolt = clock + (calm ? 1.2 : 0.35 + Math.random() * 0.6);
        }
        if (!calm && Math.random() < dt * 40) {
          if (lava) this.particles.emit({ x: s.x + (Math.random() - 0.5) * w, y: -1.5 + Math.random() * 2, z: Z, count: 2, colors: ['#ffd24a', '#ff7a1c', '#ff4a12'], speed: 0.5, lift: 2, gravity: 3, drag: 0.8, life: 1.4, size: 0.12 });
          else this.particles.emit({ x: s.x + (Math.random() - 0.5) * w, y: 2 + Math.random() * 9, z: Z, count: 2, colors: ['#ffffff', '#dff4ff', '#bfe6ff'], speed: 0.4, vx: -3, gravity: -9, drag: 0.5, life: 1.1, size: 0.13 });
        }
      }
    }
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const a = Math.max(0, b.life / b.max);
      const flick = calm || Math.sin(clock * 90) > -0.3 ? 1 : 0.35;
      b.core.material.opacity = a * flick;
      b.glow.material.opacity = 0.55 * a * flick;
      b.g.visible = b.life > 0;
    }
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.5);
    this.flash.visible = !calm && this.flashLevel > 0.01;
    this.flash.material.opacity = this.flashLevel * 0.6;
  }
}
