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

function halo(ctx, cx, cy, r, rgb, alpha) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
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
      halo(ctx, cx, cy, s * 0.5, '255,190,30', 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40,22,6,0.5)';
      ctx.fill();
      const rim = ctx.createLinearGradient(cx, cy - s * 0.37, cx, cy + s * 0.37);
      rim.addColorStop(0, '#ffe066');
      rim.addColorStop(1, '#d9820a');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.37, 0, Math.PI * 2);
      fillStroke(ctx, rim, '#7a4506', lw * 0.8);
      const face = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.1, s * 0.03, cx, cy, s * 0.3);
      face.addColorStop(0, '#ffeb99');
      face.addColorStop(0.6, '#ffc526');
      face.addColorStop(1, '#f09c0e');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.29, 0, Math.PI * 2);
      ctx.fillStyle = face;
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = '#c2700a';
      ctx.stroke();
      const sg = ctx.createLinearGradient(cx, cy - s * 0.2, cx, cy + s * 0.2);
      sg.addColorStop(0, '#fffbea');
      sg.addColorStop(1, '#ffe2a0');
      star(ctx, cx, cy + s * 0.015, s * 0.21, s * 0.09);
      fillStroke(ctx, sg, '#d9820a', lw * 0.6);
      break;
    }
    case 'cash': {
      halo(ctx, cx, cy, s * 0.5, '45,255,110', 0.8);
      const g = ctx.createRadialGradient(cx, cy - s * 0.05, s * 0.05, cx, cy, s * 0.37);
      g.addColorStop(0, '#1f9a4a');
      g.addColorStop(1, '#0a4a22');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.37, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowColor = '#3dff80';
      ctx.shadowBlur = s * 0.08;
      ctx.lineWidth = lw * 1.1;
      ctx.strokeStyle = '#6dff9c';
      ctx.stroke();
      ctx.font = `900 ${Math.round(s * 0.52)}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#063818';
      ctx.strokeText('$', cx, cy + s * 0.03);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#eafff0';
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
      halo(ctx, cx, cy, s * 0.5, '60,235,255', 0.7);
      const g = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.38);
      g.addColorStop(0, '#12585e');
      g.addColorStop(1, '#062a2e');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = 'rgba(110,245,255,0.75)';
      ctx.stroke();
      const a = s * 0.095;
      const l = s * 0.27;
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
      const pg = ctx.createLinearGradient(cx, cy - l, cx, cy + l);
      pg.addColorStop(0, '#d6feff');
      pg.addColorStop(1, '#3fe3f2');
      ctx.shadowColor = '#3ff0ff';
      ctx.shadowBlur = s * 0.1;
      ctx.fillStyle = pg;
      ctx.fill();
      break;
    }
    case 'shrink': {
      halo(ctx, cx, cy, s * 0.5, '255,55,35', 0.75);
      const g = ctx.createRadialGradient(cx - s * 0.05, cy - s * 0.07, s * 0.03, cx, cy, s * 0.3);
      g.addColorStop(0, '#ff6a52');
      g.addColorStop(0.6, '#d8161a');
      g.addColorStop(1, '#86090e');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
      ctx.shadowColor = '#ff2a1a';
      ctx.shadowBlur = s * 0.08;
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = '#ff9a86';
      ctx.stroke();
      ctx.shadowColor = '#ff6a52';
      ctx.shadowBlur = s * 0.06;
      roundRect(ctx, cx - s * 0.17, cy - s * 0.045, s * 0.34, s * 0.09, s * 0.02);
      ctx.fillStyle = '#fff4ef';
      ctx.fill();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = s * 0.065;
      ctx.strokeStyle = '#ffffff';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + d * s * 0.35, cy - s * 0.12);
        ctx.lineTo(cx + d * s * 0.44, cy);
        ctx.lineTo(cx + d * s * 0.35, cy + s * 0.12);
        ctx.stroke();
      }
      break;
    }
    case 'fire': {
      halo(ctx, cx, cy + s * 0.02, s * 0.5, '255,110,20', 0.85);
      const g = ctx.createLinearGradient(cx, cy - s * 0.46, cx, cy + s * 0.38);
      g.addColorStop(0, '#ff3d12');
      g.addColorStop(0.45, '#ff8a1c');
      g.addColorStop(1, '#ffe26a');
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
      ctx.shadowColor = '#ff7a14';
      ctx.shadowBlur = s * 0.1;
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineJoin = 'round';
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = '#7a1c04';
      ctx.stroke();
      const core = ctx.createRadialGradient(cx, cy + s * 0.14, s * 0.02, cx, cy + s * 0.14, s * 0.22);
      core.addColorStop(0, 'rgba(255,245,180,0.85)');
      core.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.14, s * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();
      ctx.fillStyle = '#3a1004';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + d * s * 0.04, cy + s * 0.07);
        ctx.lineTo(cx + d * s * 0.17, cy);
        ctx.lineTo(cx + d * s * 0.15, cy + s * 0.11);
        ctx.lineTo(cx + d * s * 0.06, cy + s * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.11, cy + s * 0.19);
      ctx.quadraticCurveTo(cx, cy + s * 0.31, cx + s * 0.11, cy + s * 0.19);
      ctx.quadraticCurveTo(cx, cy + s * 0.23, cx - s * 0.11, cy + s * 0.19);
      ctx.fill();
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
    case 'split': {
      // A gold nugget cracked down the middle, its halves already parting.
      inset(ctx, cx, cy, s * 0.47, 'rgba(60,35,5,0.35)');
      const r = s * 0.34;
      const zig = [[0, -1], [0.2, -0.55], [-0.16, -0.12], [0.18, 0.28], [-0.1, 0.64], [0, 1]];
      const g = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.12, s * 0.04, cx, cy, s * 0.4);
      g.addColorStop(0, '#fff0b8');
      g.addColorStop(0.6, '#ffb347');
      g.addColorStop(1, '#b8661a');
      for (const side of [-1, 1]) {
        const ox = cx + side * s * 0.06;
        ctx.beginPath();
        if (side < 0) ctx.arc(ox, cy, r, Math.PI / 2, Math.PI * 1.5);
        else ctx.arc(ox, cy, r, -Math.PI / 2, Math.PI / 2);
        const pts = side < 0 ? zig : [...zig].reverse();
        for (const [zx, zy] of pts) ctx.lineTo(ox + zx * r * 0.5, cy + zy * r);
        ctx.closePath();
        fillStroke(ctx, g, '#4a2a06', lw);
      }
      triangle(ctx, cx + s * 0.49, cy, 1, s * 0.1);
      fillStroke(ctx, '#ffffff', '#4a2a06', lw * 0.7);
      triangle(ctx, cx - s * 0.49, cy, -1, s * 0.1);
      fillStroke(ctx, '#ffffff', '#4a2a06', lw * 0.7);
      break;
    }
    case 'magnet': {
      // Red horseshoe magnet with steel tips and a spark of field between them.
      inset(ctx, cx, cy, s * 0.47, 'rgba(10,30,50,0.35)');
      const R = s * 0.25;
      const top = cy - s * 0.2;
      const base = cy + s * 0.04;
      const u = () => {
        ctx.beginPath();
        ctx.moveTo(cx - R, top);
        ctx.lineTo(cx - R, base);
        ctx.arc(cx, base, R, Math.PI, 0, true);
        ctx.lineTo(cx + R, top);
      };
      ctx.lineCap = 'butt';
      u();
      ctx.lineWidth = s * 0.17 + lw * 2;
      ctx.strokeStyle = '#1a1a2e';
      ctx.stroke();
      u();
      ctx.lineWidth = s * 0.17;
      ctx.strokeStyle = '#e2474b';
      ctx.stroke();
      for (const d of [-1, 1]) {
        roundRect(ctx, cx + d * R - s * 0.095, top - s * 0.15, s * 0.19, s * 0.16, s * 0.03);
        fillStroke(ctx, '#e4ebf2', '#1a1a2e', lw * 0.8);
      }
      ctx.strokeStyle = '#8fe4ff';
      ctx.lineWidth = lw * 0.9;
      ctx.lineCap = 'round';
      for (const [x0, y0, x1, y1] of [[-0.09, -0.4, 0.09, -0.44], [-0.05, -0.3, 0.06, -0.33]]) {
        ctx.beginPath();
        ctx.moveTo(cx + x0 * s, cy + y0 * s);
        ctx.lineTo(cx + x1 * s, cy + y1 * s);
        ctx.stroke();
      }
      break;
    }
    case 'mystery': {
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.12, s * 0.05, cx, cy, s * 0.46);
      g.addColorStop(0, '#f3c8ff');
      g.addColorStop(1, '#6d2fa8');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.43, 0, Math.PI * 2);
      fillStroke(ctx, g, '#2a0d45', lw);
      ctx.font = `900 ${Math.round(s * 0.64)}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lw * 1.3;
      ctx.strokeStyle = '#2a0d45';
      ctx.strokeText('?', cx, cy + s * 0.04);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('?', cx, cy + s * 0.04);
      star(ctx, cx + s * 0.27, cy - s * 0.27, s * 0.08, s * 0.03, 4);
      fillStroke(ctx, '#fff6a8', '#2a0d45', lw * 0.5);
      break;
    }
    case 'frost': {
      // Snowflake on an icy disc: six arms, each with a pair of branches.
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.12, s * 0.05, cx, cy, s * 0.46);
      g.addColorStop(0, '#f2fbff');
      g.addColorStop(1, '#4f98cc');
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.43, 0, Math.PI * 2);
      fillStroke(ctx, g, '#0e3a5c', lw);
      const arms = (width, color) => {
        ctx.lineCap = 'round';
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * s * 0.33, cy + Math.sin(a) * s * 0.33);
          ctx.stroke();
          const bx = cx + Math.cos(a) * s * 0.2;
          const by = cy + Math.sin(a) * s * 0.2;
          for (const d of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(a + d * 0.75) * s * 0.1, by + Math.sin(a + d * 0.75) * s * 0.1);
            ctx.stroke();
          }
        }
      };
      arms(lw * 2.6, '#0e3a5c');
      arms(lw * 1.2, '#ffffff');
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
  const k = size / 256;
  const n = 4;
  const cell = size / n;
  const grid = [];
  for (let j = 0; j <= n; j++) {
    const row = [];
    for (let i = 0; i <= n; i++) row.push([(i + rng.range(-0.32, 0.32)) * cell, (j + rng.range(-0.32, 0.32)) * cell]);
    grid.push(row);
  }
  const cracks = [];
  const link = ([x0, y0], [x1, y1]) => {
    const pts = [[x0, y0]];
    for (const t of [0.33, 0.66]) {
      const o = rng.range(-0.14, 0.14);
      pts.push([x0 + (x1 - x0) * t + (y0 - y1) * o, y0 + (y1 - y0) * t + (x1 - x0) * o]);
    }
    pts.push([x1, y1]);
    cracks.push({ pts, w: rng.range(2.5, 5.5) * k });
  };
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      if (i < n && rng.chance(0.82)) link(grid[j][i], grid[j][i + 1]);
      if (j < n && rng.chance(0.82)) link(grid[j][i], grid[j + 1][i]);
    }
  }
  const pass = (style, scale) => {
    ctx.strokeStyle = style;
    for (const crack of cracks) {
      ctx.beginPath();
      crack.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = crack.w * scale;
      ctx.stroke();
    }
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!emissive) pass('rgba(0,0,0,0.55)', 2.4);
  ctx.globalAlpha = 0.3;
  pass(vein, 3.6);
  ctx.globalAlpha = 1;
  pass(vein, 1);
  pass('rgba(255,250,225,0.75)', 0.35);
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
