import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRECACHE_BLOCK, precacheBlock, precacheList } from '../scripts/sw-precache.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const relative = (u) => !u.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(u);

/** Width x height from a PNG's IHDR chunk (bytes 16..24). */
function pngSize(file) {
  const b = readFileSync(join(ROOT, file));
  expect(b.subarray(0, 8).toString('hex'), `${file} is not a PNG`).toBe('89504e470d0a1a0a');
  expect(b.toString('latin1', 12, 16)).toBe('IHDR');
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

/** The PRECACHE block of sw.js as checked out (CRLF or LF). */
const swBlock = () => read('sw.js').replace(/\r\n/g, '\n').match(PRECACHE_BLOCK)?.[0];
const swEntries = () => [...(swBlock() ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]);

describe('web app manifest', () => {
  const load = () => JSON.parse(read('manifest.webmanifest'));

  it('parses as JSON and declares the app, display and colours with relative URLs', () => {
    const manifest = load();
    expect(manifest).toMatchObject({
      name: 'Avalanche',
      short_name: 'Avalanche',
      description: 'Catch the marked rocks breaking off the cliff, dodge fire and the demon.',
      start_url: './',
      scope: './',
      display: 'fullscreen',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'landscape',
      background_color: '#cfe0ee',
      theme_color: '#f6f0e4',
      categories: ['games'],
    });
    expect([manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)].filter((u) => !relative(u))).toEqual([]);
  });

  it('lists 192, 512 and maskable 512 icons whose PNGs match their declared sizes', () => {
    const manifest = load();
    expect(manifest.icons.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ['assets/icons/icon-192.png', '192x192', 'any'],
      ['assets/icons/icon-512.png', '512x512', 'any'],
      ['assets/icons/icon-maskable-512.png', '512x512', 'maskable'],
    ]);
    for (const icon of manifest.icons) {
      expect(existsSync(join(ROOT, icon.src)), `${icon.src} missing`).toBe(true);
      expect(pngSize(icon.src), icon.src).toBe(icon.sizes);
    }
    expect(pngSize('assets/icons/apple-touch-icon.png')).toBe('180x180');
  });
});

describe('service worker precache', () => {
  it('matches what scripts/sw-precache.mjs generates from disk', () => {
    expect(swBlock(), 'PRECACHE:BEGIN / PRECACHE:END block').toBeDefined();
    expect(swBlock()).toBe(precacheBlock(precacheList(ROOT)));
  });

  it('lists only files that exist', () => {
    const missing = swEntries().filter((p) => {
      const path = join(ROOT, p.endsWith('/') ? `${p}index.html` : p);
      return !existsSync(path) || !statSync(path).isFile();
    });
    expect(swEntries().length).toBeGreaterThan(2);
    expect(missing).toEqual([]);
  });

  it('uses only ./-relative URLs, never /-rooted or absolute ones', () => {
    expect(swEntries().filter((p) => !p.startsWith('./'))).toEqual([]);
  });
});
