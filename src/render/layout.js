// Maps the single logical playfield onto any screen. The arena frame is scaled uniformly to
// fit inside the part of the canvas not covered by HUD bars, so meshes are never stretched,
// actionable objects are never cropped, and logical speeds never depend on aspect ratio.
import { ARENA } from '../config.js';

export function computeLayout(width, height, insets = {}) {
  const inset = { top: 0, bottom: 0, left: 0, right: 0, ...insets };
  const F = ARENA.frame;
  const frameW = F.maxX - F.minX;
  const frameH = F.maxY - F.minY;
  const safeW = Math.max(40, width - inset.left - inset.right);
  const safeH = Math.max(40, height - inset.top - inset.bottom);
  const pxPerUnit = Math.max(1e-3, Math.min(safeW / frameW, safeH / frameH));
  const spareW = safeW - frameW * pxPerUnit;
  const spareH = safeH - frameH * pxPerUnit;
  // Screen position (CSS px) of the frame's top-left corner.
  const left = inset.left + spareW / 2;
  const top = inset.top + spareH * ARENA.extraSpaceAbove;

  // World rectangle on the gameplay plane covered by the full canvas.
  const view = {
    left: F.minX - left / pxPerUnit,
    top: F.maxY + top / pxPerUnit,
  };
  view.right = view.left + width / pxPerUnit;
  view.bottom = view.top - height / pxPerUnit;

  return {
    width,
    height,
    pxPerUnit,
    insets: inset,
    view,
    frameRect: { left, top, width: frameW * pxPerUnit, height: frameH * pxPerUnit },
    toScreen(x, y) {
      return { x: (x - view.left) * pxPerUnit, y: (view.top - y) * pxPerUnit };
    },
    toWorld(px, py) {
      return { x: view.left + px / pxPerUnit, y: view.top - py / pxPerUnit };
    },
  };
}
