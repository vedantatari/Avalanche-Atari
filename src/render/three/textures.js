// Small helpers for turning loaded images into Three.js textures.
import * as THREE from '../../../vendor/three/three.module.min.js';

/** Texture from a loaded image; `color` marks colour data (sRGB) versus normal/detail data. */
export function imageTexture(img, { color = true, repeat = [1, 1] } = {}) {
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
