// Service worker: keeps a copy of the game so it installs as an app and plays offline.
// Network first, so a deployed update is always picked up while online; the cache is only
// the fallback. Every URL is relative to this file (the site may live under a sub-path).
// PRECACHE is generated: run `node scripts/sw-precache.mjs` after adding or removing files.
const CACHE = 'avalanche-v1';

// PRECACHE:BEGIN
const PRECACHE = [
  './',
  './index.html',
  './assets/audio/gem-rush-loop.mp3',
  './assets/carts/cart-1.png',
  './assets/carts/cart-10.png',
  './assets/carts/cart-2.png',
  './assets/carts/cart-3.png',
  './assets/carts/cart-4.png',
  './assets/carts/cart-5.png',
  './assets/carts/cart-6.png',
  './assets/carts/cart-7.png',
  './assets/carts/cart-8.png',
  './assets/carts/cart-9.png',
  './assets/favicon.svg',
  './assets/fonts/OFL.txt',
  './assets/fonts/fredoka.woff2',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/textures/boulder_detail.jpg',
  './assets/textures/boulder_normal.jpg',
  './assets/textures/cliff_detail.jpg',
  './assets/textures/cliff_normal.jpg',
  './assets/textures/snow_normal.jpg',
  './css/styles.css',
  './manifest.webmanifest',
  './src/achievements.js',
  './src/audio.js',
  './src/config.js',
  './src/debug.js',
  './src/game/cliff.js',
  './src/game/demo.js',
  './src/game/items.js',
  './src/game/levels.js',
  './src/game/loop.js',
  './src/game/reachability.js',
  './src/game/rng.js',
  './src/game/simulation.js',
  './src/game/spawn-director.js',
  './src/input/input-state.js',
  './src/input/input.js',
  './src/main.js',
  './src/render/appearance.js',
  './src/render/assets.js',
  './src/render/emblems.js',
  './src/render/layout.js',
  './src/render/renderer-2d.js',
  './src/render/themes.js',
  './src/render/three/background-life.js',
  './src/render/three/cart.js',
  './src/render/three/fx.js',
  './src/render/three/geometry.js',
  './src/render/three/projection.js',
  './src/render/three/renderer-3d.js',
  './src/render/three/rocks.js',
  './src/render/three/scenery.js',
  './src/render/three/storm.js',
  './src/render/three/textures.js',
  './src/storage.js',
  './src/ui.js',
  './vendor/three/three.module.min.js',
];
// PRECACHE:END

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// Drop caches left by older versions, then take over already-open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('avalanche-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // browser default
  // One entry per file: index.html?debug and index.html share a key.
  url.search = '';
  const key = url.href;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
      .then((res) => res || Response.error(), () => Response.error()),
  );
});
