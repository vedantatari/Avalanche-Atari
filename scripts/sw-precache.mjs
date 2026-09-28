// Dev tool: regenerates the PRECACHE block in sw.js from the files on disk, so the offline
// copy matches what ships. Run it after adding, renaming, or removing a shipped file:
//   node scripts/sw-precache.mjs           rewrite sw.js
//   node scripts/sw-precache.mjs --check   exit 1 and print the difference if sw.js is stale
// Only the page, manifest, CSS, src/ modules, Three.js, and assets/ (minus .md) ship;
// docs/, tests/, scripts/, node_modules/, and .github/ are dev-only.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The generated region of sw.js, markers included (match against LF-normalised text). */
export const PRECACHE_BLOCK = /^\/\/ PRECACHE:BEGIN$[\s\S]*?^\/\/ PRECACHE:END$/m;

/** Files under `dir` (relative to `root`, forward slashes), skipping dotfiles. */
function walk(root, dir) {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .flatMap((e) => (e.isDirectory() ? walk(root, `${dir}/${e.name}`) : e.isFile() ? [`${dir}/${e.name}`] : []));
}

/** Every URL to precache, relative to sw.js: the page first, then the rest in code-unit order. */
export function precacheList(root = ROOT) {
  const files = [
    'manifest.webmanifest',
    'css/styles.css',
    'vendor/three/three.module.min.js',
    ...walk(root, 'src').filter((f) => f.endsWith('.js')),
    ...walk(root, 'assets').filter((f) => !/\.md$/i.test(f)),
  ];
  return ['./', './index.html', ...files.map((f) => `./${f}`).sort()];
}

/** The PRECACHE block (markers included) for `list`, LF line endings. */
export function precacheBlock(list) {
  return ['// PRECACHE:BEGIN', 'const PRECACHE = [', ...list.map((p) => `  '${p}',`), '];', '// PRECACHE:END'].join('\n');
}

function main() {
  const file = join(ROOT, 'sw.js');
  const source = readFileSync(file, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n'; // keep whatever git checked out
  const text = source.replace(/\r\n/g, '\n');
  const current = text.match(PRECACHE_BLOCK)?.[0];
  if (!current) {
    console.error('sw.js: no "// PRECACHE:BEGIN" ... "// PRECACHE:END" block found');
    process.exit(1);
  }
  const list = precacheList(ROOT);
  const next = precacheBlock(list);
  if (current === next) {
    console.log(`sw.js precache is up to date (${list.length} URLs)`);
    return;
  }
  if (process.argv.includes('--check')) {
    const a = current.split('\n');
    const b = next.split('\n');
    const diff = [...a.filter((l) => !b.includes(l)).map((l) => `- ${l}`), ...b.filter((l) => !a.includes(l)).map((l) => `+ ${l}`)];
    console.error(`sw.js precache is out of date; run: node scripts/sw-precache.mjs\n${diff.join('\n') || '(order or formatting differs)'}`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(PRECACHE_BLOCK, () => next).replace(/\n/g, eol));
  console.log(`sw.js precache updated (${list.length} URLs)`);
}

// CLI only when run directly, so tests can import precacheList without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
