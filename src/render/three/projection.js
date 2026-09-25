// Fixed camera geometry shared by the scene builders and the renderer. The camera looks
// straight down -z with an off-axis frustum, so the gameplay plane (z = ARENA.gameZ) maps
// linearly to the screen and matches the logical layout exactly.
import { ARENA } from '../../config.js';

export const CAMERA = Object.freeze({
  x: 0,
  y: ARENA.cameraHeight,
  z: ARENA.gameZ + ARENA.cameraDistance,
  near: 1,
  far: 400,
});

/**
 * World position at depth `z` that appears exactly where plane point (x, y) appears.
 * Moving an object along this ray changes its apparent size but not its screen position.
 */
export function rayPoint(x, y, z) {
  const k = (CAMERA.z - z) / (CAMERA.z - ARENA.gameZ);
  return { x: CAMERA.x + (x - CAMERA.x) * k, y: CAMERA.y + (y - CAMERA.y) * k, z };
}

export function setRayPoint(target, x, y, z) {
  const k = (CAMERA.z - z) / (CAMERA.z - ARENA.gameZ);
  target.set(CAMERA.x + (x - CAMERA.x) * k, CAMERA.y + (y - CAMERA.y) * k, z);
  return target;
}
