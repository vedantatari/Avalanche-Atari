# Avalanche

An Avalanche-inspired arcade game in plain HTML, CSS, and JavaScript. Rocks crack out of a snowy cliff. Steer
the bearded miner's riveted mine cart so its open tub catches the good rocks and lets the harmful ones fall. Bank shields to
buy back hearts, and clear timed score targets to unlock 100 levels across two terrains (Ice, Volcano).

- **No build step.** The game is `index.html`, `css/`, `src/` (ES modules), `vendor/` (Three.js), and `assets/`.
- **Three ways to play:** the 100-level campaign (with 1–3 star ratings and a resumable run), an **Endless** mode where waves speed up until you fall, and a seeded **Daily challenge** that is the same stage for everyone all day. A local high-score table keeps the ten best finished runs.
- **Living background:** wind gusts, cliff slides, snow curtains, cloud shadows, sun shafts, birds, swaying trees, chimney smoke, steam vents, and eruptions. It all runs behind the gameplay plane, so it never covers a rock, and it freezes on pause.
- **Fills the window** on every device. The menu holds the terrain picker and rock legend, and a **Full screen** button (or the F key) switches the browser to true full screen.
- **3D:** Three.js WebGL. If WebGL can't start, a Canvas 2D renderer takes over and runs the same simulation.
- **Offline:** no backend, accounts, analytics, CDN imports, or runtime downloads.

## Run it

The game uses JavaScript modules, so it must be served over `http://`. Opening `index.html` from disk
(`file://`) does not work.

```bash
node scripts/serve.mjs 8080        # zero-dependency server included in this repo (or: npm start)
# or: python -m http.server 8080
```

Then open http://localhost:8080/.

**Deploy:** copy `index.html`, `css/`, `src/`, `vendor/`, and `assets/` to any static host. All paths are
relative, so a subfolder works. `node_modules/`, `tests/`, `scripts/`, and `docs/` are only needed for development.

## Controls

| Action | Keyboard | Mouse / touch |
|---|---|---|
| Move | ← → or A / D | Mouse: the cart follows the pointer (default, toggleable in Settings), or drag the playfield (relative drag). On phones and tablets, touch and hold the **left or right half of the screen** to move that way; sliding a held finger across the middle switches sides. |
| Restore a heart | R | Restore button |
| Pause | Esc or P | Pause button |
| Full screen on/off | F | Full screen button (menu and pause screen) |

While **Reverse** (the whiskey bottle) is active, every movement method is flipped: pressing left moves the
cart right and vice versa (pointer-follow mirrors about the centre), and a "⇄ REVERSED Ns" badge shows above the cart.

## Rules (summary)

- A run starts with 3 hearts (max 3), 0 shields, and 0 restores used.
- **Next level** refills hearts to 3; banked shields and restores used carry into the next stage. **Retry** and **Restart** start a new run.
- **Combo streak:** consecutive catches of scoring rocks build a streak; every 5th pays a rising bonus (+50, +100, …). Missing a scoring rock or taking damage resets it (`COMBO` in `src/config.js`).
- **Stars:** a campaign win rates 1–3 stars from the share of that stage's reachable score you collected (2★ ≥ 75%, 3★ ≥ 90%); the level grid remembers your best.
- **Difficulty:** Settings offers Easy / Normal / Hard, a multiplier layer over drop rate, fall speed, and targets (`DIFFICULTY_MODES`). It applies from the next stage; targets always respect the fairness floor.
- **Endless** starts at level 1 with no score target and rolls into a harder wave whenever the timer ends; the run ends when you die and the cumulative total counts. **Daily** is one stage seeded from the date, the same for everyone; retrying replays the exact same rocks.
- A mid-run reload (or quitting to the menu) keeps a **Resume run** snapshot: you restart at the beginning of the stage you were on, with the run's hearts, bank, and restores as they were when that stage began.
- Levels 1–15 last 60 s, 16–49 last 90 s, and 50–100 last 120 s. Difficulty (fall speed, drop rate, patterns, which rocks appear) is shifted by `LEVELS.difficultyOffset`, so level 1 plays like the original level 1 + that offset and later levels follow on from there.
- **Targets are dynamic.** Each stage computes the best score a human-speed route could collect from its own seeded rocks (multiplier rocks included), then asks for a share of it: `LEVELS.targetShare` rises from `start` at level 1 toward `max`, rounded to 50 and never above reachable ÷ 1.4. So the target differs per level and per run. Menus show a typical value (`~N pts`).
- Reaching the target early shows "Target reached — survive!". You win if, when the timer ends, you have at least the target and at least one heart.
- **Touch counts.** A rock is collected (or hurts) the moment it touches the cart's tub: its bottom reaching the rim anywhere across the tub, even right on the edge, or the tub's side bumping it while it is still beside the tub. Good rocks, hazards, and effects all follow this rule.
- **Rocks:**
  - gold +50;
  - emerald $ +100;
  - shield +1 banked;
  - teal + makes the scoop ×1.4 wide for 5 s;
  - coral − makes it ×0.7 for 5 s;
  - fire costs a heart, then gives 1 s of immunity;
  - the whiskey bottle flips controls for 5 s;
  - ×2 / ×3 / ×5 rocks multiply every point scored for 5 s. A new multiplier replaces the current one and restarts
    the 5 s. The score pill shows the active multiplier, and popups show the multiplied points;
  - the shadow rock adds two shadow-clone carts at 70% opacity for 5 s, one on each side of the cart (a scoop width
    plus a 1.3-unit gap away, kept on the rail). Clones catch helpful rocks only; harmful rocks fall straight through them.
- Missed rocks never cost hearts.
- **Restores** cost 1, 2, 4, then 8 banked shields, at most 4 per run. At 0 hearts, if you can afford one, the game pauses and asks.

## Where to change things

| What | File |
|---|---|
| Every number: timings, weights, speeds, restore costs, difficulty curves, fairness, quality presets | `src/config.js` |
| Cart speed and feel: `CART.traverseSeconds` (0.8 s edge-to-edge), `CART.acceleration` | `src/config.js` |
| Targets and difficulty: `LEVELS.targetShare`, `LEVELS.difficultyOffset`, `FAIRNESS.reachBias`; catch zone: `ROCK.catchOverlapFraction`, `CART.scoopDepth` | `src/config.js` |
| Combo streak cadence and bonus (`COMBO`), Easy/Normal/Hard multipliers (`DIFFICULTY_MODES`) | `src/config.js` |
| Background-life timings (gusts, slides, birds, eruptions, cloud shadows) | `LIFE` in `src/config.js`; behaviour in `src/render/three/background-life.js` |
| How each rock type looks (colours, vein colour, marking, popup text) | `src/render/appearance.js` |
| Rock markings (canvas drawings) | `src/render/emblems.js` |
| Terrain palettes and lighting | `src/render/themes.js` |
| Scenery layout and props | `src/render/three/scenery.js` |
| Mine cart and miner model | `src/render/three/cart.js` (3D), `_drawCart` in `src/render/renderer-2d.js` (2D) |
| Score bar (stone plaque, gem caps, molten fill) and HUD layout | `index.html`, `css/styles.css` |

Logical item types (`src/game/items.js`) are kept separate from their appearance, so restyling rocks
doesn't touch scoring, collisions, or progression.

## File structure

```
index.html                  page, HUD, overlays (DOM)
css/styles.css              full-window layout, HUD modes (wide / mid / compact / short), overlays
src/main.js                 app controller: flow, pause, revive, storage, renderer selection
src/config.js               central tuning
src/game/                   pure simulation (no DOM): simulation, spawn-director, reachability, levels,
                            items, cliff (cells + fall kinematics), loop (fixed step), rng
src/input/                  input-state (device-independent), input (keyboard + Pointer Events)
src/render/                 layout (logical→screen), appearance, emblems, themes, assets, renderer-2d
src/render/three/           Three.js renderer: scenery, background-life, rocks, cart, fx, geometry, projection
src/ui.js, src/audio.js, src/storage.js, src/debug.js
vendor/three/               three.js r186 (MIT), single minified ES module
assets/                     favicon, Atari logo source, CC0 textures (see assets/textures/CREDITS.md)
tests/                      Vitest rule tests
scripts/                    serve, e2e browser checks, screenshots, perf, gameplay recording
docs/verification/          screenshots and a 10-second gameplay clip from the checks below
```

## Development and tests (optional)

```bash
npm install                 # dev tools only: vitest, playwright-core (the game itself needs nothing)
npm test                    # 82 rule tests (simulation, modes, spawning, storage, loop, layout, appearance)
node scripts/serve.mjs 8080 # in another terminal
npm run e2e                 # 42 browser checks in local Chrome;  node scripts/e2e.mjs --browser=edge
```

The browser scripts drive locally installed Chrome or Edge through `playwright-core`. No browser download is needed.

**Debug facility** (dev/test only; not linked from the player UI): add `?debug` to the URL.

- Shows a small readout of fps, phase, seed, and state.
- Exposes `window.__avalanche` for reproducible scenarios.
- Accepts optional parameters:
  - `seed=<n>` replays the same stages;
  - `duration=<s>` shortens every stage (only with `?debug`, so it can't ship by accident);
  - `renderer=2d` forces the fallback;
  - `level=<n>`.

## Verification actually performed

On Windows 11, 2026-09-25:

- **Rule tests (Vitest), 82/82 passing:**
  - single catch awards once; missed positives cost no hearts;
  - restore sequence 1/2/4/8 with no fifth restore, never at full hearts, bank never negative;
  - zero hearts with and without an affordable restore; zero hearts at the deadline loses even with the target met;
  - catches exactly at the deadline count, later ones don't;
  - size effect lasts exactly 5 s (600 ticks), refreshes and replaces, hitbox equals the current scoop, no edge jitter;
  - reverse flips keyboard, holds, and drag, ends after 5 s, and two reverses don't cancel;
  - pointer-follow tracks the pointer, is mirrored while reversed, and yields to the keyboard;
  - combo streaks pay rising bonuses and reset on a scoring miss or damage;
  - endless waves roll on at the deadline with no target and end only on death; daily runs replay the same seed;
  - resume snapshots rebuild the same run and stage schedule;
  - difficulty modes scale drops and targets while normal reproduces the default schedules exactly;
  - pause freezes time, effects, and rocks; the loop never replays a long gap;
  - targets, durations, unlocks, continuation vs new run;
  - seeded schedules reproduce and stay in bounds, pass fairness checks, and pass reachability;
  - every item type renders as a marked rock; resizing doesn't change the simulation;
  - corrupt or unavailable storage, and the version-1 per-terrain best-score migration.
- **Browser checks (`scripts/e2e.mjs`), 42 checks in Chrome 153.0.8010.53** (headless, real GPU through D3D11; 41–42 pass per run — the full-screen toggle check can time out from suite-order timing in headless runs and passes reliably in isolation):
  - boot with no console errors or failed requests;
  - the background is alive (trees sway; slides, snow curtains, and birds happen within seconds) and freezes on pause;
  - the game fills the window; the full-screen toggle works by button and F, and leaving full screen mid-play pauses;
  - first-play tutorial;
  - keyboard including A/D and edge clamping;
  - Esc/P pause with no time jump on resume; visibility loss and blur pause;
  - mouse relative drag and absolute pointer-follow (with reverse mirroring) on the playfield;
  - CDP touch zone steering (hold a half of the screen), a second finger tapping Restore without interrupting it, and touch cancel;
  - reverse across all input methods; expand/shrink widths;
  - the revive decision (paused, costs 1 then 2, End run loses);
  - disabled-restore explanations and the R key;
  - win → unlock → Next refills hearts and carries bank/restores; Restart resets the run;
  - target reached early; level 100 summit screen;
  - endless waves, the daily challenge, combo bonuses, resume after reload, the high-scores overlay;
  - the new settings (difficulty, volume sliders, pointer-follow) persisting;
  - renderer switching 3D↔2D repeatedly with a clean dispose;
  - terrain locked mid-stage, with the same schedule across themes;
  - resize mid-stage (no phantom catches); orientation change pauses;
  - corrupt and blocked localStorage; settings and reset confirmation; level picker;
  - 2D fallback with WebGL disabled.
- **Layout checks** (no HUD overlap, no page scroll, touch targets ≥ 44 px, arena clear of the HUD) at 1366×768, 1920×1080, 360×640, 390×844, 844×390, 768×1024, and 1024×768. Screenshots are in `docs/verification/`.
- **Performance** (`scripts/perf.mjs`), headless Chrome on an Intel Arc Pro integrated GPU:
  - About 58 fps average with 95th-percentile frames at 17 ms. That equals the blank-page cap in the same browser at 1920×1080 (high quality, level 30), 1366×768 (level 60), and 390×844 (medium).
  - JavaScript costs about 4–4.7 ms per frame, background life included.
  - Adaptive quality lowers DPR, shadows, and particles if frame time goes above 25 ms.
- **Gameplay clip:** `docs/verification/gameplay-10s.mp4` is a real 10 s recording at level 6. A simple bot played it through real keyboard input, reading rock positions from the debug hook to decide where to steer.

**Shipped size:**

| Part | Size |
|---|---|
| `vendor/three` | 742 KB |
| Game source (`src`, `css`, `index.html`) | ~340 KB unminified |
| Textures | 460 KB |

## Known limitations

- **Not tested on physical phones or tablets.** Mobile results come from Chrome/Edge device emulation (viewport, touch, DPR 2). Firefox and Safari (desktop and iOS) weren't available on this machine and are untested.
- **Frame rates** were measured headless on one integrated GPU. Weaker phones rely on the adaptive quality step-down, which was not measured on a real device.
- **Audio** is procedural Web Audio. It starts after the first gesture and initialized without errors, but nobody listened to it during these checks.
- **Balancing:** the brief's fixed target formula left reachable scoring at 5–7× the target, and a player who never moved still won. Targets are now a share of each stage's reachable score (see Rules). Simulated play with the current tuning (difficultyOffset 14, targetShare 0.6 → 0.7, faster drops, fire weight 14, demons, rock radius 0.224; 8 seeds per level): a player who never moves and random mashing lost every sampled stage. A good bot cleared 7/8 at level 1, about 6/8 through level 35, and only 2–3/8 at levels 50 and 100, mostly from fire and demon hits. These are bot numbers, not human playtests; late levels may be too hard for people. Tune `LEVELS.targetShare` and `LEVELS.difficultyOffset` in `src/config.js`.
- The reference images show a painted, high-detail render. This build approximates that look with procedural low-poly geometry, CC0 photo detail maps, and procedural snow and trees. Close, but not a pixel match.

## Departures from the brief (by request)

- **Faster cart, no on-screen slider.** The cart crosses the arena in 0.8 s instead of the brief's ~1.2 s, with quicker acceleration. That applies to every control, so no input method has an advantage. The on-screen movement strip was removed; on phones and tablets the whole playfield is the control — hold the left or right half to move that way.

- **Full-window layout.** The game fills the browser window instead of the framed page with a header and a terrain/legend panel below it. The ATARI / AVALANCHE lockup, terrain cards, and rock legend now sit in the menu. A Full screen button and the F key switch to browser full screen. The iPhone doesn't offer that API, so the button is hidden there; the game still fills the screen.

- **No Vite, no `dist/`.** You chose plain HTML/CSS/JS with no build step, so the source folder is the deliverable, and `npm run build`/`preview` don't exist. Three.js is vendored as one minified file; see `vendor/three/VERSION.txt` for how to regenerate it.
- **Downloaded assets.** You allowed internet assets, so CC0 Poly Haven textures and the Atari Fuji mark (Wikimedia Commons) are stored locally in `assets/`. They are never fetched at runtime. Credits and trademark notes are in `assets/textures/CREDITS.md`.
- **Whiskey bottle.** The Reverse item falls as an amber whiskey bottle instead of a purple rock. Its effect is unchanged.
- **Extra items.** The ×2 / ×3 / ×5 multiplier rocks and the shadow-clone rock are additions to the brief. Their timings,
  weights, clone gap, and clone opacity are in `EFFECTS`, `ITEM_EFFECTS`, and `SPAWN_WEIGHTS` in `src/config.js`.
