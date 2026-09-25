// Canvas drawings shared by both renderers: item emblems (the markings embedded in rocks),
// mineral vein textures, crack overlays, and label pills. Shapes carry meaning on their own,
// not just colour, and every emblem has a dark outline so it reads on any rock at small size.
import { Rng } from '../game/rng.js';

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, cx, cy, outer, inner, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function shieldPath(ctx, cx, cy, w, h) {
  const top = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.quadraticCurveTo(cx + w * 0.28, top + h * 0.1, cx + w / 2, top + h * 0.06);
  ctx.quadraticCurveTo(cx + w * 0.54, top + h * 0.62, cx, top + h);
  ctx.quadraticCurveTo(cx - w * 0.54, top + h * 0.62, cx - w / 2, top + h * 0.06);
  ctx.quadraticCurveTo(cx - w * 0.28, top + h * 0.1, cx, top);
  ctx.closePath();
}

function triangle(ctx, tipX, y, dir, size) {
  ctx.beginPath();
  ctx.moveTo(tipX, y);
  ctx.lineTo(tipX - dir * size, y - size * 0.85);
  ctx.lineTo(tipX - dir * size, y + size * 0.85);
  ctx.closePath();
}

function fillStroke(ctx, fill, stroke, width) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Recessed stamp behind the symbol so it reads as set into the stone. */
function inset(ctx, cx, cy, r, color) {
  const g = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.2, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

/** Draws the marking for `type` centred at (cx, cy) inside a square of side `s`. */
export function drawEmblem(ctx, type, cx, cy, s) {
  ctx.save();
  const lw = Math.max(1.5, s * 0.06);
  switch (type) {
    case 'coin': {
      inset(ctx, cx, cy, s * 0.46, 'rgba(60,40,10,0.35)');
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.12, s * 0.05, cx, cy, s * 0.4);
      g.addColorStop(0, '#fff0a8');
      g.addColorStop(0.55, '#ffc93c');
      g.addColorStop(1, '#d68f1c');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
      fillStroke(ctx, g, '#5a3a0c', lw);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.29, 0, Math.PI * 2);
      ctx.lineWidth = lw * 0.5;
      ctx.strokeStyle = 'rgba(120,70,10,0.7)';
      ctx.stroke();
      star(ctx, cx, cy + s * 0.01, s * 0.22, s * 0.095);
      fillStroke(ctx, '#fff8dc', '#7a4e10', lw * 0.6);
      break;
    }
    case 'cash': {
      inset(ctx, cx, cy, s * 0.47, 'rgba(10,50,30,0.35)');
      const g = ctx.createLinearGradient(cx, cy - s * 0.38, cx, cy + s * 0.38);
      g.addColorStop(0, '#5cf0a6');
      g.addColorStop(1, '#128a50');
      roundRect(ctx, cx - s * 0.36, cy - s * 0.36, s * 0.72, s * 0.72, s * 0.14);
      fillStroke(ctx, g, '#0b3f26', lw);
      ctx.font = `900 ${Math.round(s * 0.62)}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = lw * 1.1;
      ctx.strokeStyle = '#0b3f26';
      ctx.strokeText('$', cx, cy + s * 0.03);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('$', cx, cy + s * 0.03);
      break;
    }
    case 'shield': {
      inset(ctx, cx, cy, s * 0.47, 'rgba(10,20,50,0.35)');
      const g = ctx.createLinearGradient(cx - s * 0.3, cy - s * 0.4, cx + s * 0.3, cy + s * 0.4);
      g.addColorStop(0, '#8fd3ff');
      g.addColorStop(1, '#2a62cf');
      shieldPath(ctx, cx, cy, s * 0.66, s * 0.8);
      fillStroke(ctx, g, '#0f2658', lw);
      shieldPath(ctx, cx, cy + s * 0.02, s * 0.38, s * 0.5);
      ctx.lineWidth = lw * 0.8;
      ctx.strokeStyle = '#eaf6ff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.2);
      ctx.lineTo(cx, cy + s * 0.22);
      ctx.stroke();
      break;
    }
    case 'expand': {
      inset(ctx, cx, cy, s * 0.47, 'rgba(10,50,40,0.3)');
      const a = s * 0.13;
      const l = s * 0.24;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy - l);
      ctx.lineTo(cx + a, cy - l);
      ctx.lineTo(cx + a, cy - a);
      ctx.lineTo(cx + l, cy - a);
      ctx.lineTo(cx + l, cy + a);
      ctx.lineTo(cx + a, cy + a);
      ctx.lineTo(cx + a, cy + l);
      ctx.lineTo(cx - a, cy + l);
      ctx.lineTo(cx - a, cy + a);
      ctx.lineTo(cx - l, cy + a);
      ctx.lineTo(cx - l, cy - a);
      ctx.lineTo(cx - a, cy - a);
      ctx.closePath();
      fillStroke(ctx, '#4fe39a', '#0c4a31', lw);
      triangle(ctx, cx + s * 0.47, cy, 1, s * 0.11);
      fillStroke(ctx, '#ffffff', '#0c4a31', lw * 0.7);
      triangle(ctx, cx - s * 0.47, cy, -1, s * 0.11);
      fillStroke(ctx, '#ffffff', '#0c4a31', lw * 0.7);
      break;
    }
    case 'shrink': {
      inset(ctx, cx, cy, s * 0.47, 'rgba(60,15,10,0.3)');
      roundRect(ctx, cx - s * 0.22, cy - s * 0.09, s * 0.44, s * 0.18, s * 0.04);
      fillStroke(ctx, '#ff5a4a', '#5e1109', lw);
      triangle(ctx, cx + s * 0.27, cy, -1, s * 0.11);
      fillStroke(ctx, '#ffffff', '#5e1109', lw * 0.7);
      triangle(ctx, cx - s * 0.27, cy, 1, s * 0.11);
      fillStroke(ctx, '#ffffff', '#5e1109', lw * 0.7);
      break;
    }
    case 'fire': {
      // Flame silhouette with an angry face.
      const g = ctx.createLinearGradient(cx, cy - s * 0.46, cx, cy + s * 0.4);
      g.addColorStop(0, '#ff3d12');
      g.addColorStop(0.5, '#ff8a1c');
      g.addColorStop(1, '#ffd94a');
      ctx.beginPath();
      const b = cy + s * 0.38;
      ctx.moveTo(cx - s * 0.3, b);
      ctx.bezierCurveTo(cx - s * 0.46, cy + s * 0.1, cx - s * 0.36, cy - s * 0.12, cx - s * 0.3, cy - s * 0.3);
      ctx.quadraticCurveTo(cx - s * 0.2, cy - s * 0.12, cx - s * 0.14, cy - s * 0.16);
      ctx.quadraticCurveTo(cx - s * 0.12, cy - s * 0.38, cx - s * 0.02, cy - s * 0.47);
      ctx.quadraticCurveTo(cx + s * 0.06, cy - s * 0.22, cx + s * 0.12, cy - s * 0.2);
      ctx.quadraticCurveTo(cx + s * 0.2, cy - s * 0.32, cx + s * 0.3, cy - s * 0.36);
      ctx.bezierCurveTo(cx + s * 0.34, cy - s * 0.1, cx + s * 0.48, cy + s * 0.12, cx + s * 0.3, b);
      ctx.closePath();
      fillStroke(ctx, g, '#3a0c02', lw);
      // face plate
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.1, s * 0.25, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2a1512';
      ctx.fill();
      // angry eyes
      ctx.fillStyle = '#ffe14d';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + d * s * 0.04, cy + s * 0.04);
        ctx.lineTo(cx + d * s * 0.19, cy - s * 0.02);
        ctx.lineTo(cx + d * s * 0.16, cy + s * 0.1);
        ctx.lineTo(cx + d * s * 0.06, cy + s * 0.1);
        ctx.closePath();
        ctx.fill();
      }
      // frown
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.1, cy + s * 0.22);
      ctx.quadraticCurveTo(cx, cy + s * 0.14, cx + s * 0.1, cy + s * 0.22);
      ctx.lineWidth = lw * 0.8;
      ctx.strokeStyle = '#ffb13a';
      ctx.lineCap = 'round';
      ctx.stroke();
      break;
    }
    case 'demon': {
      // Horned demon head with burning eyes and a fanged grin: unmistakably "do not touch".
      const g = ctx.createRadialGradient(cx, cy - s * 0.05, s * 0.06, cx, cy + s * 0.05, s * 0.42);
      g.addColorStop(0, '#ff4a4a');
      g.addColorStop(0.6, '#c41430');
      g.addColorStop(1, '#5c0618');
      // Horns first, behind the head.
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + d * s * 0.16, cy - s * 0.18);
        ctx.quadraticCurveTo(cx + d * s * 0.34, cy - s * 0.3, cx + d * s * 0.33, cy - s * 0.48);
        ctx.quadraticCurveTo(cx + d * s * 0.44, cy - s * 0.32, cx + d * s * 0.3, cy - s * 0.1);
        ctx.closePath();
        fillStroke(ctx, '#e8d6c4', '#2a050d', lw * 0.8);
      }
      // Head: wide skull tapering to a pointed chin.
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.34);
      ctx.bezierCurveTo(cx + s * 0.3, cy - s * 0.34, cx + s * 0.38, cy - s * 0.08, cx + s * 0.26, cy + s * 0.18);
      ctx.quadraticCurveTo(cx + s * 0.12, cy + s * 0.4, cx, cy + s * 0.46);
      ctx.quadraticCurveTo(cx - s * 0.12, cy + s * 0.4, cx - s * 0.26, cy + s * 0.18);
      ctx.bezierCurveTo(cx - s * 0.38, cy - s * 0.08, cx - s * 0.3, cy - s * 0.34, cx, cy - s * 0.34);
      ctx.closePath();
      fillStroke(ctx, g, '#2a050d', lw);
      // Burning slanted eyes.
      ctx.fillStyle = '#ffe14d';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + d * s * 0.05, cy - s * 0.02);
        ctx.lineTo(cx + d * s * 0.24, cy - s * 0.12);
        ctx.lineTo(cx + d * s * 0.2, cy + s * 0.04);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#ff7417';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + d * s * 0.15, cy - s * 0.04, s * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      // Fanged grin.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.16, cy + s * 0.18);
      ctx.quadraticCurveTo(cx, cy + s * 0.28, cx + s * 0.16, cy + s * 0.18);
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#2a050d';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + d * s * 0.13, cy + s * 0.2);
        ctx.lineTo(cx + d * s * 0.09, cy + s * 0.32);
        ctx.lineTo(cx + d * s * 0.05, cy + s * 0.22);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'reverse': {
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.1, s * 0.05, cx, cy, s * 0.42);
      g.addColorStop(0, '#c9a2ff');
      g.addColorStop(1, '#6b3fb8');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
      fillStroke(ctx, g, '#2c1257', lw);
      // Upper arc heads right, lower arc heads left: a left/right reversal loop.
      const r = s * 0.24;
      for (const [a0, a1] of [[Math.PI * 1.08, Math.PI * 1.82], [Math.PI * 0.08, Math.PI * 0.82]]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.lineCap = 'round';
        ctx.lineWidth = s * 0.13;
        ctx.strokeStyle = '#2c1257';
        ctx.stroke();
        ctx.lineWidth = s * 0.085;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        const hx = cx + Math.cos(a1) * r;
        const hy = cy + Math.sin(a1) * r;
        const tangent = a1 + Math.PI / 2;
        const hs = s * 0.13;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(tangent) * hs, hy + Math.sin(tangent) * hs);
        ctx.lineTo(hx + Math.cos(tangent + 2.3) * hs, hy + Math.sin(tangent + 2.3) * hs);
        ctx.lineTo(hx + Math.cos(tangent - 2.3) * hs, hy + Math.sin(tangent - 2.3) * hs);
        ctx.closePath();
        fillStroke(ctx, '#ffffff', '#2c1257', lw * 0.6);
      }
      break;
    }
    case 'mult2':
    case 'mult3':
    case 'mult5': {
      // Starburst badge carrying the factor: the number itself is the marking.
      const [light, dark, ink] = MULT_COLORS[type];
      const g = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.1, s * 0.04, cx, cy, s * 0.46);
      g.addColorStop(0, light);
      g.addColorStop(1, dark);
      star(ctx, cx, cy, s * 0.47, s * 0.36, 12);
      fillStroke(ctx, g, ink, lw);
      ctx.font = `900 ${Math.round(s * 0.44)}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lw * 1.3;
      ctx.strokeStyle = ink;
      const label = `×${type.slice(4)}`;
      ctx.strokeText(label, cx, cy + s * 0.03);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, cx, cy + s * 0.03);
      break;
    }
    case 'clone': {
      // The player's cart (teal scoop, orange body) flanked by two see-through copies.
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.12, s * 0.05, cx, cy, s * 0.46);
      g.addColorStop(0, '#e4e8ff');
      g.addColorStop(1, '#4d56aa');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.44, 0, Math.PI * 2);
      fillStroke(ctx, g, '#161a40', lw);
      const cart = (x, w, alpha) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        const top = cy - w * 0.36;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, top);
        ctx.lineTo(x + w / 2, top);
        ctx.lineTo(x + w * 0.36, top + w * 0.38);
        ctx.lineTo(x - w * 0.36, top + w * 0.38);
        ctx.closePath();
        fillStroke(ctx, '#40b1a6', '#161a40', lw * 0.7);
        ctx.beginPath();
        ctx.rect(x - w * 0.42, top + w * 0.38, w * 0.84, w * 0.24);
        fillStroke(ctx, '#ec7a2d', '#161a40', lw * 0.7);
        for (const d of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(x + d * w * 0.25, top + w * 0.66, w * 0.11, 0, Math.PI * 2);
          fillStroke(ctx, '#2b2f36', '#161a40', lw * 0.5);
        }
        ctx.restore();
      };
      cart(cx - s * 0.25, s * 0.3, 0.5);
      cart(cx + s * 0.25, s * 0.3, 0.5);
      cart(cx, s * 0.38, 1);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Light, dark, and outline colours of each multiplier badge. */
const MULT_COLORS = {
  mult2: ['#c8f6ff', '#1e9dd0', '#0a3550'],
  mult3: ['#ffd0f5', '#c43aa4', '#4a0c3c'],
  mult5: ['#fff3a0', '#ff6d1f', '#5a1a04'],
};

/** Whiskey label (wrapped around the 3D bottle, and reused by the 2D drawing). */
export function bottleLabelCanvas(w = 256, h = 128) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f3e3c0';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#6b3a12';
  ctx.lineWidth = h * 0.06;
  ctx.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a2c0c';
  ctx.font = `900 ${Math.round(h * 0.42)}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
  ctx.fillText('XXX', w / 2, h * 0.4);
  ctx.font = `700 ${Math.round(h * 0.2)}px Georgia, "Times New Roman", serif`;
  ctx.fillText('WHISKEY', w / 2, h * 0.74);
  return c;
}

/** Flat whiskey bottle (2D renderer and fallbacks), `h` tall, centred on (cx, cy). */
export function drawBottle(ctx, cx, cy, h) {
  ctx.save();
  const w = h * 0.42;
  const top = cy - h / 2;
  const bodyTop = top + h * 0.4;
  const lw = Math.max(1.5, h * 0.035);
  // Glass silhouette: body, sloped shoulders, neck.
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.18, top + h * 0.1);
  ctx.lineTo(cx - w * 0.18, top + h * 0.26);
  ctx.quadraticCurveTo(cx - w / 2, top + h * 0.3, cx - w / 2, bodyTop);
  ctx.lineTo(cx - w / 2, cy + h / 2 - h * 0.03);
  ctx.quadraticCurveTo(cx - w / 2, cy + h / 2, cx - w / 2 + h * 0.03, cy + h / 2);
  ctx.lineTo(cx + w / 2 - h * 0.03, cy + h / 2);
  ctx.quadraticCurveTo(cx + w / 2, cy + h / 2, cx + w / 2, cy + h / 2 - h * 0.03);
  ctx.lineTo(cx + w / 2, bodyTop);
  ctx.quadraticCurveTo(cx + w / 2, top + h * 0.3, cx + w * 0.18, top + h * 0.26);
  ctx.lineTo(cx + w * 0.18, top + h * 0.1);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, '#6e3508');
  g.addColorStop(0.35, '#c7741f');
  g.addColorStop(1, '#5a2a06');
  fillStroke(ctx, g, '#2a1204', lw);
  // Cork and gold foil.
  ctx.fillStyle = '#c89a5a';
  ctx.fillRect(cx - w * 0.16, top, w * 0.32, h * 0.1);
  ctx.fillStyle = '#d9a520';
  ctx.fillRect(cx - w * 0.2, top + h * 0.1, w * 0.4, h * 0.07);
  // Label.
  const lh = h * 0.3;
  ctx.drawImage(bottleLabelCanvas(128, 64), cx - w * 0.44, cy + h * 0.02, w * 0.88, lh);
  // Glass highlight.
  ctx.fillStyle = 'rgba(255,240,210,0.45)';
  ctx.fillRect(cx - w * 0.36, bodyTop + h * 0.02, w * 0.08, h * 0.5);
  ctx.restore();
}

/** Square emblem texture canvas (transparent background). */
export function emblemCanvas(type, size = 256) {
  const c = makeCanvas(size);
  drawEmblem(c.getContext('2d'), type, size / 2, size / 2, size * 0.96);
  return c;
}

/**
 * Stone texture with mineral veins. `emissive` returns only the veins on black, used as
 * an emissive map so gold/fire veins glow softly.
 */
export function veinCanvas(base, vein, seed, { size = 256, emissive = false, detail = null } = {}) {
  const rng = new Rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  if (emissive) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
  } else if (detail) {
    // Tinted stone: base colour multiplied by a greyscale crack/detail photo texture.
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(detail, 0, 0, size, size);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const light = rng.chance(0.5);
      ctx.fillStyle = light ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
      const r = rng.range(2, 9);
      ctx.beginPath();
      ctx.arc(rng.range(0, size), rng.range(0, size), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let v = 0; v < 6; v++) {
    let x = rng.range(0, size);
    let y = rng.range(0, size);
    let a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = rng.int(4, 8);
    for (let k = 0; k < segs; k++) {
      a += rng.range(-0.9, 0.9);
      x += Math.cos(a) * rng.range(14, 34);
      y += Math.sin(a) * rng.range(14, 34);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = vein;
    ctx.lineWidth = rng.range(4, 9);
    ctx.globalAlpha = emissive ? 1 : 0.95;
    ctx.stroke();
    if (!emissive) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Plain stone texture for shelf blocks and scenery. */
export function stoneCanvas(base, seed, size = 128) {
  const rng = new Rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(1.5, 6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = rng.range(0, size);
    let y = rng.range(0, size);
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += rng.range(-18, 18);
      y += rng.range(-18, 18);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

/** Transparent overlay of fresh cracks shown while a source rock shakes loose. */
export function crackCanvas(seed, size = 128) {
  const rng = new Rng(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  for (let b = 0; b < 5; b++) {
    let x = size / 2 + rng.range(-8, 8);
    let y = size / 2 + rng.range(-8, 8);
    let a = (b / 5) * Math.PI * 2 + rng.range(-0.4, 0.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      a += rng.range(-0.5, 0.5);
      x += Math.cos(a) * rng.range(10, 18);
      y += Math.sin(a) * rng.range(10, 18);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(20,14,10,0.85)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return c;
}

/** Rounded label pill used for popups and effect badges. */
export function labelCanvas(text, { fg = '#ffffff', bg = null, stroke = 'rgba(20,30,40,0.85)', height = 64, font } = {}) {
  const fontSpec = font || `700 ${Math.round(height * 0.56)}px Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", Arial, sans-serif`;
  const probe = makeCanvas(4);
  const pctx = probe.getContext('2d');
  pctx.font = fontSpec;
  const textW = Math.ceil(pctx.measureText(text).width);
  const padX = bg ? height * 0.42 : height * 0.2;
  const w = textW + padX * 2;
  const c = makeCanvas(w, height);
  const ctx = c.getContext('2d');
  if (bg) {
    roundRect(ctx, 2, 2, w - 4, height - 4, (height - 4) / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }
  ctx.font = fontSpec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (stroke && !bg) {
    ctx.lineWidth = height * 0.12;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, w / 2, height / 2 + 1);
  }
  ctx.fillStyle = fg;
  ctx.fillText(text, w / 2, height / 2 + 1);
  return c;
}
