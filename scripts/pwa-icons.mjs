// Dev tool: renders the install / home-screen icons from assets/favicon.svg in a locally
// installed Chrome (playwright-core, no browser download). Re-run after changing the favicon:
//   node scripts/pwa-icons.mjs [--browser=chrome|edge|<path to the browser exe>]
// Writes assets/icons/: icon-192.png and icon-512.png (rounded tile, transparent corners),
// icon-maskable-512.png (full bleed, art inside the 80% safe zone) and apple-touch-icon.png
// (180x180, full bleed and opaque; iOS rounds the corners itself).
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const BROWSERS = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};
const browserName = arg('browser', 'chrome');
const exe = BROWSERS[browserName] || browserName;
const OUT = new URL('../assets/icons/', import.meta.url);

// The favicon without its tile: peak, snow cap, cart tub, wheels (64-unit viewBox).
const favicon = readFileSync(new URL('../assets/favicon.svg', import.meta.url), 'utf8');
const inner = favicon.slice(favicon.indexOf('>') + 1, favicon.lastIndexOf('</svg>'));
const art = inner.replace(/^\s*<rect\b[^>]*\/>/, '');
if (art === inner) throw new Error('assets/favicon.svg: expected the background <rect> first');

// The favicon's own navy: the cream peak, white snow, teal tub and orange wheels all stay
// crisp on it, where the sky blue washes out the peak and the snow.
const TILE = '#1e2a36';

// fit: radius (share of the icon size) of the circle the art's bounding box is scaled into.
// Maskable icons may be cropped down to the central 80% circle, hence 0.4 there.
const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true, fit: 0.44 },
  { file: 'icon-512.png', size: 512, rounded: true, fit: 0.44 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, fit: 0.4 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, fit: 0.42 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size, rounded, fit } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  // Rounded icons keep transparent corners; full-bleed ones are opaque edge to edge.
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:${rounded ? 'transparent' : TILE}}svg{display:block}</style>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${rounded ? (size * 14) / 64 : 0}" fill="${TILE}"/>` +
      `<g id="art">${art}</g></svg>`,
  );
  // Centre the art's bounding box and scale it so the box just fits the fit circle.
  await page.evaluate(({ size, fit }) => {
    const g = document.getElementById('art');
    const b = g.getBBox();
    const k = (fit * size) / Math.hypot(b.width / 2, b.height / 2);
    g.setAttribute('transform', `translate(${size / 2} ${size / 2}) scale(${k}) translate(${-b.x - b.width / 2} ${-b.y - b.height / 2})`);
  }, { size, fit });
  await page.screenshot({ path: fileURLToPath(new URL(file, OUT)), omitBackground: rounded });
  console.log(`assets/icons/${file}  ${size}x${size}`);
}
await browser.close();
