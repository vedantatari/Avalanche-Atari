# Avalanche — Game Flow & Design

A browser remake of Atari's arcade classic **Avalanche**, built in plain HTML, CSS, and JavaScript.
Rocks crack loose from a snowy cliff; you steer a bearded miner's mine cart so its open tub catches
the valuable rocks and lets the harmful ones fall. This document explains the problem the game solves,
how the game flows, how to play it, and how the design answers the original brief.

For setup, folder structure, and running the game locally, see [README.md](README.md).

---

## 1. The problem statement

Recreate the spirit of Atari's *Avalanche* (1978) — falling objects, a player-controlled catcher, and
escalating pressure — as a **modern browser arcade game** that:

1. **Runs anywhere with zero friction.** It must open in a normal browser on desktop, tablet, or phone,
   with no install, no account, no backend, and no build step — plain HTML/CSS/JS served as static files.
2. **Is fair despite being random.** Classic catch-the-falling-object games can generate unwinnable or
   trivial moments. Every stage must be beatable by a human, and score targets must demand real play
   rather than being met by standing still.
3. **Offers lasting progression, not one loop.** A long campaign (100 levels across two terrains, with
   star ratings), plus modes for quick replay: an Endless survival mode and a Daily challenge identical
   for every player on a given day.
4. **Looks and feels modern** — a living 3D mountain scene — while degrading gracefully on machines
   where WebGL is unavailable or slow.

Section 5 maps each of these requirements to how the game meets it.

## 2. Game flow

### Screens and states

```
                ┌────────────────────────────────────────────┐
                │                  MENU                      │
                │  Play / Resume run · All levels · Endless  │
                │  Daily · Scores · Terrain · Legend         │
                │  How to play · Settings · Full screen      │
                └───────┬────────────────────────────────────┘
                        │ Play (first ever play shows the
                        │ "Before you start" tutorial first)
                        ▼
   ┌──────────── LEVEL INTRO ────────────┐   "LEVEL N · Reach ~T in 0:45 · Get ready…"
   │                                     │
   ▼                                     │
 PLAYING ──── Esc / P / focus loss ──► PAUSED ──► Resume · Restart · Quit to menu
   │
   ├─ score reaches target early ──► "Target reached — survive!" (keep playing)
   │
   ├─ hearts hit 0, restore affordable ──► REVIVE PROMPT (paused): pay shields or End run
   │
   ├─ hearts hit 0, no restore possible (or demon touched) ──► GAME OVER ► Retry / Menu
   │
   └─ timer ends ──► RESULTS
                      ├─ score ≥ target and ≥ 1 heart ──► STAGE CLEAR (1–3 ★)
                      │        Next level (hearts refill; shields & restores carry over)
                      │        Level 100 clear ──► summit screen
                      └─ otherwise ──► STAGE FAILED ► Retry (new run) / Menu
```

### A stage, beat by beat

1. **Intro banner** (~1.3 s): shows the level number and its score target, e.g. "Reach ~850 in 0:45".
2. **Play**: every stage runs on a **45-second clock**. Rocks visibly crack and shake on the cliff
   shelves before detaching, giving you a moment to react, then fall toward the rail.
3. **Catching**: a rock counts the instant it touches the cart's tub — its bottom reaching the rim
   anywhere across the tub (even the very edge), or the tub's side bumping it. Good rocks, hazards,
   and effect rocks all follow this same touch rule. **Missed rocks never cost hearts** — they
   shatter harmlessly on the rail ledge.
4. **Target reached early**: the HUD switches to "Target reached — survive!". You still have to be
   alive when the clock ends.
5. **End of stage**: you **win** if your score is at least the target *and* you have at least one
   heart when the timer ends. A win rates **1–3 stars** and unlocks the next level.

### Between stages (a "run")

- A campaign **run** starts with 3 hearts, 0 banked shields, and 0 restores used.
- **Next level** refills hearts to 3; your banked shields and restores-used carry into the next stage.
- **Retry** and **Restart** begin a fresh run.
- Quitting to the menu (or reloading the page) mid-run keeps a **Resume run** snapshot: you restart at
  the beginning of the stage you were on, with the hearts, shield bank, and restore count the run had
  when that stage began.

### Modes

| Mode | What it is |
|---|---|
| **Campaign** | 100 levels. Clear a level to unlock the next. Best score and stars per level are remembered on the level grid, shared across both terrains. |
| **Endless** | Starts at wave 1 with **no score target**; when each 45 s timer ends the run rolls into a harder wave. The run ends only when you die, and the cumulative total goes to the high-score table. |
| **Daily** | One stage seeded from today's date — the same rocks, in the same order, for everyone, all day. Retrying replays the exact same stage. |

A local **high-score table** keeps the ten best finished runs. **Terrain** (Ice or Volcano) is a visual
choice — the same seeded schedule plays identically on either.

## 3. How to play

### Controls

| Action | Keyboard | Mouse / touch |
|---|---|---|
| Move the cart | ← → or A / D | Point with the mouse — the cart follows the pointer (default, toggleable in Settings) — or drag the playfield. On phones and tablets, touch and hold the **left or right half of the screen** to move that way; sliding a held finger across the middle switches sides. |
| Restore a heart | R | Restore button |
| Pause | Esc or P | Pause button |
| Full screen on/off | F | Full screen button (menu and pause screen) |

While **Reverse** (the whiskey bottle) is active, every movement method is flipped — left means right,
pointer-follow mirrors about the centre — and a "⇄ REVERSED" badge counts down above the cart.

### The rocks

Every falling rock carries a marking. The in-game legend (menu and How to play) shows each one.

| Rock | Catch it? | Effect |
|---|---|---|
| Gold rock | ✅ | +50 points |
| Emerald $ rock | ✅ | +100 points |
| Shield rock | ✅ | +1 banked shield (currency for heart restores) |
| Teal **+** rock | ✅ | Scoop grows to ×1.4 width for 5 s |
| Coral **−** rock | ⚠️ avoid | Scoop shrinks to ×0.7 width for 5 s |
| Fire rock | ❌ avoid | Lose a heart, then 1 s of immunity |
| **Demon** | ❌❌ avoid | **Instant game over** — regardless of hearts, shields, or immunity. It is scheduled (roughly every 12 s in a stage) and falls faster than everything else. |
| Whiskey bottle | ⚠️ avoid | Reverses all controls for 5 s |
| ×2 / ×3 / ×5 rock | ✅ | Multiplies every point scored for 5 s. A new multiplier replaces the current one and restarts the 5 s. The score pill shows the active multiplier. |
| Shadow rock | ✅ | Adds two shadow-clone carts at 70% opacity, one on each side of yours, for 5 s. Clones catch helpful rocks only — harmful rocks fall straight through them. |

### Hearts, shields, and restores

- You have at most **3 hearts**. Fire costs one; the demon ends the run outright.
- Caught shield rocks go into a **bank**. Spend the bank to restore hearts: the 1st restore in a run
  costs 1 shield, then 2, then 4, then 8 — **at most 4 restores per run**, and never at full hearts.
- At 0 hearts, if you can afford a restore, the game pauses and asks; declining (**End run**) loses.

### Scoring extras

- **Combo streak**: consecutive catches of scoring rocks (gold/emerald) build a streak; every 5th
  catch pays a rising bonus (+50, +100, +150…). Missing a scoring rock or taking damage resets it.
- **Stars**: a campaign win is rated by the share of that stage's *reachable* score you collected —
  **2★ at ≥ 75%, 3★ at ≥ 90%**.
- **Score targets are dynamic**: each stage computes the best score a human-speed route could collect
  from its own seeded rocks, then asks for a share of it (about 60% at level 1, rising toward 70%),
  rounded to the nearest 50. Menus show a typical value ("~N pts") because the exact target depends
  on the run's seed.

### Difficulty

Settings offers **Easy / Normal / Hard** — a multiplier layer over drop rate, fall speed, and targets
that applies from the next stage. Independently, the campaign curve itself ramps: higher levels drop
rocks faster and more often, fall times shorten, and multi-rock patterns (sweeps, pairs, stacks)
become more frequent.

## 4. Tutorial — your first game, step by step

1. **Open the game** (see [README.md](README.md)) — you land on the menu. Pick a **terrain** (Ice or
   Volcano — looks only, same gameplay) and skim the **rock legend** so you know gold/emerald/shield
   from fire and the demon. Press **Full screen** (or F) if you like.
2. **Press Play.** Because it's your first game, the **"Before you start"** panel appears: the core
   rule — *steer the cart so the teal scoop catches the good rocks and lets the bad ones fall* — plus
   the controls. Press **Start**. (It's always available later under **How to play**.)
3. **Level 1 intro** shows your target, something like "Reach ~600 in 0:45". Get ready.
4. **Just chase gold.** Move with ← → (or point with the mouse) and catch gold and emerald rocks.
   Don't panic about rocks you can't reach — **missing never hurts you**. Only *catching* something
   bad does.
5. **Watch the cracks.** Rocks shake and crack on the cliff shelves for a beat before they drop —
   that's your cue where the next one falls.
6. **Avoid fire, flee the demon.** Fire costs a heart. The demon (it's unmistakable, and falls
   faster) ends the run instantly — when in doubt, drive away from it and sacrifice the points.
7. **Bank shields when it's safe.** They're your extra lives: at 0 hearts you can buy a heart back
   for 1 shield the first time (then 2, 4, 8). If the revive prompt appears, take it — a run that
   survives is worth more than a banked shield.
8. **Grab a multiplier, then feed it.** Catching ×2/×3/×5 is only worth much if you catch scoring
   rocks during its 5 seconds. Same for the shadow rock — its clones catch good rocks near you.
9. **When "Target reached — survive!" appears**, you can play it safe: dodge hazards and coast until
   the timer ends. You win with the target met and at least one heart.
10. **Stage clear!** Check your stars, then hit **Next level** — hearts refill, your shields carry.
    From here the game teaches itself: each level is a touch faster and busier than the last. When
    you want variety, try **Endless** (how long can you last?) or the **Daily** (one fair, shared
    stage per day — compare scores with friends).

**Practical tips**

- The cart crosses the whole arena in 0.8 s — trust that you can make almost any rock if you commit early.
- The **+** rock (wider scoop) is quietly one of the best pickups; the **−** rock is a trap that looks similar — read the marking, not just the colour.
- While **reversed**, slow down and make small corrections; five seconds passes quickly.
- On a phone: hold the left or right half of the screen — don't swipe. A second finger can tap Restore without letting go.

## 5. How the solution addresses the problem statement

**Zero-friction, runs anywhere.** The deliverable is static files — `index.html`, `css/`, `src/`
(ES modules), `vendor/` (Three.js, vendored, no CDN), `assets/`. There is no build step, backend,
account, analytics, or runtime download; the game works fully offline once served. The layout fills
any window, adapts its HUD across wide/mid/compact/short breakpoints, keeps touch targets ≥ 44 px,
and was screenshot-verified from 360×640 phones up to 1920×1080 desktops
(see [docs/verification/](docs/verification/)).

**Fairness despite randomness.** This is the design's core idea, solved in three layers:

1. A **spawn director** ([src/game/spawn-director.js](src/game/spawn-director.js)) draws rocks from a
   weighted bag but enforces fairness rules from [src/config.js](src/config.js) (`FAIRNESS`): harmful
   rocks arriving together must leave a dodgeable gap wider than the widest scoop, near-simultaneous
   hazards are capped, same-column drops are spaced so rocks never overlap, and streaks of
   negative or non-scoring rocks are bounded.
2. A **reachability check** ([src/game/reachability.js](src/game/reachability.js)) simulates a
   human-speed route through each stage's seeded schedule to compute the score actually collectable.
3. **Dynamic targets** are derived from that reachable score (a ~60–70% share, capped at
   reachable ÷ 1.4) instead of a fixed formula. This fixed the original brief's balance flaw, where
   reachable scoring was 5–7× the target and a player who never moved could still win — under the
   current tuning, a motionless or randomly-mashing player loses every sampled stage.

**Lasting progression and replay.** 100 campaign levels with per-level best scores and 1–3 star
ratings, escalating speed/density/patterns, and two terrains; an Endless mode with rolling waves; a
date-seeded Daily identical for all players; a ten-entry local high-score table; and a resume-run
snapshot so a closed tab never destroys a campaign run. All persistence is `localStorage` — private
and offline.

**Modern look with graceful degradation.** A Three.js WebGL scene with a living background (wind
gusts, cliff slides, snow curtains, birds, cloud shadows, eruptions) that runs strictly behind the
gameplay plane so it never obscures a rock, and freezes on pause. Adaptive quality steps down DPR,
shadows, and particles if frames run long. If WebGL can't start at all, a **Canvas 2D renderer takes
over and runs the exact same simulation** — the game logic ([src/game/](src/game/)) is pure and
DOM-free, driven by a fixed 120 Hz tick, so renderers are interchangeable and the simulation is
identical on every device and frame rate.

## 6. Other information

- **Determinism**: every stage is generated from a seed by a dedicated RNG
  ([src/game/rng.js](src/game/rng.js)) — the same seed always produces the same rocks. This is what
  makes the Daily fair, "Retry" exact, resume reliable, and the 82-test rule suite possible.
- **Accessibility & comfort**: a Reduced-motion setting (no shake, calm background, fewer particles),
  pointer-follow toggle, volume sliders (master/effects/music), ARIA-labelled controls, and pause on
  focus loss, tab switch, or orientation change — the loop never replays a long gap, so nothing
  happens while you're not looking.
- **Audio** is procedural Web Audio (no audio files); it starts after the first user gesture and
  fails silently where unavailable.
- **Settings** persist locally: difficulty, sound/music and volumes, reduced motion, pointer-follow,
  graphics quality (Auto/High/Medium/Low), renderer (Auto/3D/2D), plus a guarded full progress reset.
- **Tuning lives in one file**: nearly every gameplay number — timings, weights, speeds, restore
  costs, difficulty curves, fairness margins — is in [src/config.js](src/config.js), and item
  *effects* ([src/game/items.js](src/game/items.js)) are kept separate from item *appearance*
  ([src/render/appearance.js](src/render/appearance.js)), so rebalancing or reskinning never touches
  simulation code.
- **Verification**: 82 Vitest rule tests and 42 Playwright browser checks cover the rules above —
  catches at the deadline, restore costs, reverse across input methods, resume snapshots, fairness
  and reachability of seeded schedules, renderer switching, corrupt storage, and more. See
  [README.md](README.md) for how to run them, and [docs/verification/](docs/verification/) for
  screenshots and a real 10-second gameplay recording.
- **Known limitations**: mobile behaviour was verified through Chrome/Edge device emulation, not
  physical phones; Firefox and Safari are untested; performance numbers come from one integrated
  GPU; and late-campaign balance is bot-tested rather than human-playtested (tune
  `LEVELS.targetShare` / `LEVELS.difficultyOffset` in [src/config.js](src/config.js) if levels
  50+ prove too hard).
