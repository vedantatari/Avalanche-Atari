# Avalanche

An Avalanche-inspired arcade game in plain HTML, CSS, and JavaScript — no build step, no backend, no
runtime downloads. Rocks crack out of a snowy cliff; steer the miner's mine cart so its open tub
catches the good rocks and lets the harmful ones fall, across a 100-level campaign (Ice and Volcano
terrains), an Endless mode, and a seeded Daily challenge.

**Gameplay documentation** — the problem statement, game flow, rules, and a new-player tutorial — is
in [gameflow.md](gameflow.md). This file covers setting the project up, the folder structure, and
running it locally.

## 1. Setting up the code locally

**Requirements**

- Any modern browser (Chrome, Edge, or another Chromium-based browser is what the checks ran on).
- [Node.js](https://nodejs.org/) 18+ — only to run the tiny local web server and the dev tools.
  (Any static file server works instead; Node itself has no runtime role in the game.)

**Steps**

```bash
# 1. Get the code
git clone <this-repository-url>
cd Avlanche-Atari

# 2. (Optional — dev tools only) install test dependencies
npm install
```

`npm install` fetches only `vitest` and `playwright-core` for the test suites. **The game itself
needs no dependencies** — everything it uses is already in the repo, including a vendored copy of
Three.js in `vendor/three/`. If you only want to play, you can skip step 2 entirely.

## 2. Folder structure

```
Avlanche-Atari/
├── index.html                  page shell, HUD, and overlay screens (DOM)
├── css/
│   └── styles.css              full-window layout, HUD modes (wide/mid/compact/short), overlays
├── src/
│   ├── main.js                 app controller: flow, pause, revive, storage, renderer selection
│   ├── config.js               central tuning — every gameplay number lives here
│   ├── ui.js                   menus, overlays, HUD updates
│   ├── audio.js                procedural Web Audio (no audio files)
│   ├── storage.js              localStorage persistence (progress, settings, high scores)
│   ├── debug.js                ?debug URL facility for dev/tests
│   ├── game/                   pure simulation, no DOM: simulation, spawn-director,
│   │                           reachability, levels, items, cliff, loop (fixed 120 Hz step), rng
│   ├── input/                  input-state (device-independent) + keyboard/pointer bindings
│   └── render/                 layout, appearance, emblems, themes, assets, renderer-2d,
│       └── three/              Three.js renderer: scenery, background-life, rocks, cart, fx,
│                               geometry, projection, textures
├── vendor/
│   └── three/                  Three.js r186 (MIT), one minified ES module — no CDN
├── assets/                     favicon, Atari logo, CC0 textures (credits in assets/textures/CREDITS.md)
├── tests/                      Vitest rule tests (82 tests)
├── scripts/                    serve.mjs (local server), e2e.mjs (42 browser checks),
│                               shots.mjs, perf.mjs, record.mjs, filmstrip.mjs
├── docs/
│   └── verification/           screenshots and a 10 s gameplay clip from the checks
├── .github/workflows/          GitHub Pages deployment (deploys the repo root as-is)
└── package.json                npm scripts + the two dev dependencies
```

The split that matters: `src/game/` is a pure, DOM-free simulation; `src/render/` only draws it.
That is why the 3D and 2D renderers are interchangeable and the rule tests can run without a browser.

## 3. Running the game on a local computer

The game uses JavaScript modules, so it must be served over `http://` — opening `index.html`
straight from disk (`file://`) will not work.

```bash
# from the project root — zero-dependency server included in the repo
npm start
# or equivalently:
node scripts/serve.mjs 8080
```

Then open **http://localhost:8080/** in your browser. That's it — press **Play**.

Any other static server works too, e.g.:

```bash
python -m http.server 8080
# or
npx serve .
```

**Deploying** is the same idea: copy `index.html`, `css/`, `src/`, `vendor/`, and `assets/` to any
static host (all paths are relative, so a subfolder works). The included GitHub Actions workflow
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) publishes the repo to GitHub Pages on
every push to `main`. `node_modules/`, `tests/`, `scripts/`, and `docs/` are dev-only.

## 4. Development: tests and tools (optional)

```bash
npm install                 # once — dev tools only
npm test                    # 82 Vitest rule tests (simulation, modes, spawning, storage, loop, layout)

node scripts/serve.mjs 8080 # keep a server running in another terminal, then:
npm run e2e                 # 42 browser checks in your locally installed Chrome
npm run e2e:edge            # same, in Edge
npm run perf                # frame-time measurement
npm run record              # captures a real gameplay clip into docs/verification/
```

The browser scripts drive a locally installed Chrome or Edge through `playwright-core` — no browser
download is needed.

**Debug facility** (dev/test only, not linked from the player UI): open the game with `?debug` in
the URL. It shows an fps/phase/seed readout, exposes `window.__avalanche` for reproducible
scenarios, and accepts `seed=<n>` (replay the same stages), `duration=<s>` (shorten stages),
`renderer=2d` (force the fallback), and `level=<n>`.

**Where to change things**: nearly every gameplay number — timings, spawn weights, speeds, restore
costs, difficulty curves, fairness margins, quality presets — lives in
[src/config.js](src/config.js). Item effects ([src/game/items.js](src/game/items.js)) are separate
from item appearance ([src/render/appearance.js](src/render/appearance.js)), terrain palettes are in
[src/render/themes.js](src/render/themes.js), and background-life timing is `LIFE` in the config.

## License / credits

Three.js is MIT-licensed ([vendor/three/LICENSE](vendor/three/LICENSE)); texture and logo credits
are in [assets/textures/CREDITS.md](assets/textures/CREDITS.md). Assets are stored locally and never
fetched at runtime.
