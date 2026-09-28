// Local image assets (CC0 surface detail from Poly Haven, see assets/textures/CREDITS.md).
// Loading is best-effort: if an image fails, renderers fall back to procedural textures.

const FILES = {
  boulderDetail: 'assets/textures/boulder_detail.jpg',
  boulderNormal: 'assets/textures/boulder_normal.jpg',
  cliffDetail: 'assets/textures/cliff_detail.jpg',
  cliffNormal: 'assets/textures/cliff_normal.jpg',
  snowNormal: 'assets/textures/snow_normal.jpg',
};

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[avalanche] could not load ${url}; using procedural texture`);
      resolve(null);
    };
    img.src = new URL(url, document.baseURI).href;
  });
}

const cartImages = new Map();

export function loadCartImage(url) {
  if (!cartImages.has(url)) cartImages.set(url, loadImage(url));
  return cartImages.get(url);
}

let cache = null;

/** Resolves to { name: HTMLImageElement | null }. Never rejects; gives up after `timeoutMs`. */
export function loadImages(timeoutMs = 8000) {
  if (!cache) {
    const all = Promise.all(Object.entries(FILES).map(async ([k, url]) => [k, await loadImage(url)])).then(Object.fromEntries);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(Object.fromEntries(Object.keys(FILES).map((k) => [k, null]))), timeoutMs));
    cache = Promise.race([all, timeout]);
  }
  return cache;
}
