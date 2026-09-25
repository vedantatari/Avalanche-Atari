// Riveted steel mine cart on iron rail wheels, with a bearded miner riding inside. The cart's
// open tub is the catcher: only the tub changes width; the miner and wheels keep their size.
// The miner sits a little behind the gameplay plane so falling rocks always draw in front.
import * as THREE from '../../../vendor/three/three.module.min.js';
import { Rng, hashSeed } from '../../game/rng.js';

const WHEEL_R = 0.34;
/** Tub height below the rim (the rim top is the catch plane, y = 0 in the scoop root). */
const TUB_H = 1.2;
/** The miner is drawn large, like a character riding in the cart, not a tiny operator. */
const MINER_SCALE = 1.45;
/** Frustum radius that gives a half-width of 1 once the 4-sided tub is turned square-on. */
const TUB_R = Math.SQRT2;

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, flatShading: true, fog: false, ...extra });
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function ball(r, material, x = 0, y = 0, z = 0, detail = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

let tubTexture = null;

/** Frees the shared tub panel texture (renderer teardown); it rebuilds on next use. */
export function disposeTubTexture() {
  tubTexture?.dispose();
  tubTexture = null;
}

/** One riveted steel panel (tiled once per tub side): bands, straps, rivets, and rust runs. */
function tubCanvasTexture() {
  if (tubTexture) return tubTexture;
  const W = 384;
  const H = 180;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const rng = new Rng(hashSeed('minecart-steel'));

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#9aa2aa');
  base.addColorStop(0.6, '#7f878f');
  base.addColorStop(1, '#5e656c');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // Brushed/pitted metal.
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '20,24,28'},${rng.range(0.03, 0.09)})`;
    ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, 3), rng.range(1, 6));
  }
  // Rust blooms, heavier low down and around the straps.
  for (let i = 0; i < 16; i++) {
    const x = rng.range(0, W);
    const y = rng.range(H * 0.25, H);
    const r = rng.range(8, 26);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(176,92,38,0.55)');
    g.addColorStop(1, 'rgba(176,92,38,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const band = (y, h) => {
    ctx.fillStyle = '#4d535a';
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, y, W, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + h - 2, W, 2);
  };
  const strap = (x, w) => {
    ctx.fillStyle = '#50565d';
    ctx.fillRect(x, 0, w, H);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, 0, 2, H);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + w - 2, 0, 2, H);
  };
  const rivet = (x, y) => {
    const g = ctx.createRadialGradient(x - 1.2, y - 1.2, 0.5, x, y, 4.2);
    g.addColorStop(0, '#e2e6ea');
    g.addColorStop(0.55, '#8d949b');
    g.addColorStop(1, '#3b4046');
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(x + 1, y + 1.5, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    // Rust run dripping from some rivets.
    if (rng.chance(0.35)) {
      ctx.fillStyle = `rgba(160,82,34,${rng.range(0.25, 0.45)})`;
      ctx.fillRect(x - 1, y + 4, 2, rng.range(8, 26));
    }
  };

  const straps = [0, W * 0.33 - 8, W * 0.67 - 8, W - 18];
  straps.forEach((x, i) => strap(x, i === 0 || i === straps.length - 1 ? 18 : 16));
  band(0, 24);
  band(H * 0.56, 16);
  band(H - 12, 12);
  for (let x = 12; x < W; x += 26) rivet(x, 12);
  for (let x = 12; x < W; x += 26) rivet(x, H * 0.56 + 8);
  for (const x of straps) for (let y = 34; y < H - 16; y += 22) rivet(x + 9, y);

  tubTexture = new THREE.CanvasTexture(c);
  tubTexture.colorSpace = THREE.SRGBColorSpace;
  tubTexture.wrapS = THREE.RepeatWrapping;
  tubTexture.repeat.set(4, 1); // one full panel per side of the 4-sided tub
  tubTexture.anisotropy = 4;
  return tubTexture;
}

export class CartModel {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'cart';
    this.body = new THREE.Group();
    this.group.add(this.body);

    const steel = mat('#ffffff', { map: tubCanvasTexture(), roughness: 0.55, metalness: 0.25 });
    const steelInside = mat('#3e434a', { roughness: 0.8, side: THREE.BackSide });
    const iron = mat('#43484f', { roughness: 0.5, metalness: 0.35 });
    const dark = mat('#26292e', { roughness: 0.75 });
    const rust = mat('#9c5424', { roughness: 0.8 });
    this.glowMaterials = [steel, iron];

    // Scoop root rides the suspension spring; the tub inside it scales in x with the scoop.
    this.scoopRoot = new THREE.Group();
    this.scoop = new THREE.Group();
    this.scoopRoot.add(this.scoop);
    const tubGeo = new THREE.CylinderGeometry(TUB_R, TUB_R * 0.8, TUB_H, 4, 1, true, Math.PI / 4);
    const tub = new THREE.Mesh(tubGeo, steel);
    const inner = new THREE.Mesh(tubGeo, steelInside);
    tub.position.y = inner.position.y = -TUB_H / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), mat('#2d3136', { roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -TUB_H + 0.02;
    // Heavy rolled lip around the rim.
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(TUB_R * 1.035, TUB_R * 1.02, 0.12, 4, 1, true, Math.PI / 4), mat('#5a6168', { roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide }));
    lip.position.y = -0.05;
    for (const m of [tub, inner, lip]) {
      m.castShadow = true;
      this.scoop.add(m);
    }
    this.scoop.add(floor);
    this.scoop.scale.set(1.28, 1, 0.5);
    this.group.add(this.scoopRoot);

    // Undercarriage: frame rails, axle boxes, and end bumpers (fixed size).
    const b = this.body;
    b.add(box(2.0, 0.14, 0.78, dark, 0, -TUB_H - 0.07, 0));
    for (const x of [-1.05, 1.05]) b.add(box(0.16, 0.2, 0.5, iron, x, -TUB_H + 0.02, 0));
    for (const x of [-0.72, 0.72]) b.add(box(0.26, 0.18, 0.86, rust, x, -TUB_H - 0.2, 0));

    // Rail wheels: dark iron with a flange, spokes, and a rusty hub.
    this.wheels = [];
    const tire = mat('#30343a', { roughness: 0.55, metalness: 0.4 });
    const flange = mat('#23262b', { roughness: 0.7 });
    const hub = mat('#a0582a', { roughness: 0.6 });
    for (const x of [-0.72, 0.72]) {
      for (const z of [-0.42, 0.42]) {
        const w = new THREE.Group();
        const t = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.14, 18), tire);
        t.rotation.x = Math.PI / 2;
        t.castShadow = true;
        const f = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R + 0.05, WHEEL_R + 0.05, 0.04, 18), flange);
        f.rotation.x = Math.PI / 2;
        f.position.z = -Math.sign(z) * 0.07;
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 8), hub);
        h.rotation.x = Math.PI / 2;
        w.add(t, f, h, box(0.52, 0.07, 0.16, flange), box(0.07, 0.52, 0.16, flange));
        w.position.set(x, -1.75 + WHEEL_R, z);
        this.group.add(w);
        this.wheels.push(w);
      }
    }

    this._buildMiner();

    this.wheelAngle = 0;
    this.lean = 0;
    this.spring = { pos: 0, vel: 0 };
    this.celebrate = 0;
    this.hit = 0;
    this.shake = 0;
    this.ejectT = null;
    this.ejectDir = 1;
    this.lastX = null;
    this.reducedMotion = false;
  }

  /** Blasts the miner out of the tub; he tumbles off and lies beside the rail (game over). */
  eject() {
    if (this.ejectT !== null) return;
    this.ejectT = 0;
    this.ejectDir = Math.random() < 0.5 ? -1 : 1;
  }

  /** Puts the miner back in the cart for the next stage. */
  resetDriver() {
    this.ejectT = null;
    this.driver.position.set(0, -0.08, -0.12);
    this.driver.rotation.set(0, 0, 0);
  }

  /** Stocky bearded miner: steel hard hat with a headlamp, blue shirt, leather bib apron. */
  _buildMiner() {
    const shirt = mat('#557394', { roughness: 0.85 });
    const leather = mat('#7b4a2a', { roughness: 0.75 });
    const skin = mat('#eab48f', { roughness: 0.8 });
    const beard = mat('#c0571f', { roughness: 0.95 });
    const beardDark = mat('#9a4318', { roughness: 0.95 });
    const hat = mat('#8b939b', { roughness: 0.4, metalness: 0.45 });
    const dark = mat('#26292e', { roughness: 0.7 });
    this.glowMaterials.push(shirt);

    const m = new THREE.Group();
    this.driver = m;

    // Torso (mostly hidden in the tub) with the apron bib and shoulder straps.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.62, 10), shirt);
    torso.position.y = 0.08;
    torso.castShadow = true;
    m.add(torso);
    m.add(box(0.4, 0.34, 0.06, leather, 0, 0.07, 0.3));
    m.add(box(0.12, 0.08, 0.02, mat('#5e3820'), 0.09, 0.1, 0.34)); // bib pocket
    for (const x of [-0.15, 0.15]) m.add(box(0.07, 0.3, 0.05, leather, x, 0.3, 0.26));
    for (const x of [-0.15, 0.15]) m.add(ball(0.025, mat('#d9b25a', { metalness: 0.6, roughness: 0.3 }), x, 0.22, 0.31, 0));

    // Head: face, big nose, bushy brows, ginger beard and moustache, hair tufts.
    this.head = new THREE.Group();
    this.head.add(ball(0.19, skin, 0, 0, 0));
    this.head.add(ball(0.055, mat('#e09a78', { roughness: 0.8 }), 0, -0.01, 0.19, 1));
    for (const x of [-0.07, 0.07]) {
      this.head.add(ball(0.024, dark, x, 0.045, 0.165, 0));
      this.head.add(box(0.1, 0.035, 0.05, beardDark, x * 1.05, 0.09, 0.16));
    }
    const beardMesh = ball(0.2, beard, 0, -0.17, 0.1, 1);
    beardMesh.scale.set(1.05, 1.15, 0.8);
    this.head.add(beardMesh);
    for (const x of [-0.06, 0.06]) {
      const tache = ball(0.07, beardDark, x, -0.06, 0.2, 0);
      tache.scale.set(1.2, 0.55, 0.7);
      this.head.add(tache);
    }
    for (const x of [-0.19, 0.19]) this.head.add(ball(0.07, beard, x, -0.03, 0.02, 0));

    // Steel hard hat with brim, ridge, and a glowing headlamp.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat);
    dome.position.y = 0.08;
    dome.castShadow = true;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 16), hat);
    brim.position.set(0, 0.08, 0.02);
    const ridge = box(0.05, 0.05, 0.4, hat, 0, 0.28, 0);
    const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 10), dark);
    lampBody.rotation.x = Math.PI / 2;
    lampBody.position.set(0, 0.17, 0.2);
    this.lampLight = new THREE.Mesh(new THREE.CircleGeometry(0.042, 12), mat('#fff3b0', { emissive: '#ffd966', emissiveIntensity: 1.4 }));
    this.lampLight.position.set(0, 0.17, 0.237);
    this.head.add(dome, brim, ridge, lampBody, this.lampLight);
    this.head.position.y = 0.62;
    m.add(this.head);

    // Arms reach forward to grip the front lip; they pivot at the shoulders.
    this.arms = [-1, 1].map((side) => {
      const arm = new THREE.Group();
      const sleeve = box(0.13, 0.36, 0.13, shirt, 0, -0.16, 0);
      const hand = ball(0.07, skin, 0, -0.36, 0, 1);
      arm.add(sleeve, hand);
      arm.position.set(side * 0.34, 0.3, 0.05);
      m.add(arm);
      return arm;
    });

    m.scale.setScalar(MINER_SCALE);
    m.position.set(0, -0.08, -0.12);
    this.scoopRoot.add(m);
  }

  /**
   * Turns this cart into a see-through shadow clone. Every mesh gets a depth-only twin that
   * draws first, so only the clone's front surfaces blend: it reads as one cart at the given
   * opacity instead of an x-ray of overlapping parts. Clones cast no shadow.
   */
  makeGhost() {
    const meshes = [];
    this.group.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    const depthOnly = {};
    this.ghostMaterials = new Set();
    for (const mesh of meshes) {
      const mat = mesh.material;
      if (!this.ghostMaterials.has(mat)) {
        mat.transparent = true;
        mat.depthWrite = false;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -1;
        mat.polygonOffsetUnits = -2;
        this.ghostMaterials.add(mat);
      }
      mesh.castShadow = false;
      mesh.renderOrder = 1.6;
      depthOnly[mat.side] ||= new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true, side: mat.side, fog: false });
      const twin = new THREE.Mesh(mesh.geometry, depthOnly[mat.side]);
      twin.renderOrder = 1.5;
      mesh.add(twin);
    }
    this.setOpacity(0);
  }

  setOpacity(alpha) {
    for (const m of this.ghostMaterials) m.opacity = alpha;
    this.group.visible = alpha > 0.005;
  }

  setWidth(width) {
    this.scoop.scale.x = width / 2;
  }

  /** Suspension compression from a landing rock. */
  impact(strength = 1) {
    this.spring.vel -= 2.4 * strength;
  }

  cheer() {
    this.celebrate = 0.75;
  }

  hurt() {
    this.hit = 0.6;
    this.shake = this.reducedMotion ? 0 : 0.35;
  }

  /**
   * @param {object} s  { x, width, v, vmax, invulnerable }
   * @param {number} dt real seconds since the last frame (0 when paused)
   * @param {number} time seconds for idle animation
   */
  update(s, dt, time) {
    const x = s.x;
    if (this.lastX === null) this.lastX = x;
    this.wheelAngle -= (x - this.lastX) / WHEEL_R;
    this.lastX = x;
    for (const w of this.wheels) w.rotation.z = this.wheelAngle;

    this.setWidth(s.width);

    // The miner leans into motion, reacts to catches and hits; all secondary to input response.
    const targetLean = -Math.max(-1, Math.min(1, s.v / s.vmax)) * 0.16;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 12);
    this.driver.rotation.z = this.lean;
    this.body.rotation.z = this.lean * 0.1;
    this.scoopRoot.rotation.z = this.lean * 0.08;

    const k = 190;
    const c = 15;
    if (dt > 0) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.spring.vel += (-k * this.spring.pos - c * this.spring.vel) * h;
        this.spring.pos += this.spring.vel * h;
      }
    }
    const sp = Math.max(-0.5, Math.min(0.5, this.spring.pos));
    this.scoopRoot.position.y = sp * 0.16;
    this.scoop.scale.y = 1 + sp * 0.08; // steel barely flexes

    this.celebrate = Math.max(0, this.celebrate - dt);
    this.hit = Math.max(0, this.hit - dt);
    const cheer = Math.min(1, this.celebrate * 5) * (this.celebrate > 0 ? 1 : 0);
    // Resting pose grips the front lip; a cheer throws both fists up.
    const armRaise = -0.95 - cheer * 1.9;
    this.arms[0].rotation.x = armRaise;
    this.arms[1].rotation.x = armRaise;
    this.arms[0].rotation.z = -0.25 - cheer * 0.35;
    this.arms[1].rotation.z = 0.25 + cheer * 0.35;

    const idle = this.reducedMotion ? 0 : Math.sin(time * 2.3) * 0.012;
    const flinch = this.hit > 0 ? Math.sin(this.hit * 30) * 0.08 * (this.hit / 0.6) : 0;
    this.driver.position.y = -0.08 + idle;
    this.head.rotation.x = -this.hit * 0.5 + flinch;
    this.head.rotation.y = this.reducedMotion ? 0 : Math.sin(time * 0.7) * 0.15;
    this.head.position.y = 0.62 + cheer * 0.04;

    // Ejected by the demon blast: an arc up and out of the tub, tumbling, then lying still
    // beside the rail. This overrides the normal riding pose until resetDriver().
    if (this.ejectT !== null) {
      this.ejectT += dt;
      const t = Math.min(this.ejectT, 1.6);
      const dir = this.ejectDir;
      const flight = Math.min(t, 0.85);
      const fy = -0.08 + 3.4 * t - 6.2 * t * t;
      this.driver.position.set(dir * 1.8 * flight, Math.max(fy, -1.48), -0.12 + flight * 0.5);
      this.driver.rotation.z = dir * Math.min(t / 0.85, 1) * 1.75;
      // Arms flail overhead all the way down.
      this.arms[0].rotation.x = -2.6;
      this.arms[1].rotation.x = -2.6;
      this.head.rotation.x = 0.4;
    }

    this.shake = Math.max(0, this.shake - dt);
    const shakeX = this.shake > 0 ? Math.sin(time * 70) * 0.06 * (this.shake / 0.35) : 0;
    this.group.position.x = x + shakeX;

    // Gentle outline-like pulse while immune (no harsh strobing).
    const glow = s.invulnerable ? (this.reducedMotion ? 0.2 : 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(time * 9))) : 0;
    for (const m of this.glowMaterials) {
      m.emissive.setRGB(1, 0.95, 0.85);
      m.emissiveIntensity = glow;
    }
    this.lampLight.material.emissiveIntensity = 1.2 + (this.reducedMotion ? 0 : Math.max(0, Math.sin(time * 3)) * 0.6);
  }
}
