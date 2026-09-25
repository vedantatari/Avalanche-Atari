import { describe, expect, it } from 'vitest';
import { ROCK_APPEARANCE, appearanceOf, effectBadges, LEGEND } from '../src/render/appearance.js';
import { computeLayout } from '../src/render/layout.js';
import { ITEM_TYPES } from '../src/game/items.js';
import { ARENA, CART_MAX_SPEED } from '../src/config.js';
import { Simulation } from '../src/game/simulation.js';
import { THEME_INFO } from '../src/render/themes.js';

describe('item appearance', () => {
  it('renders every logical type as a marked rock, except reverse, which is a whiskey bottle', () => {
    expect(Object.keys(ROCK_APPEARANCE).sort()).toEqual([...ITEM_TYPES].sort());
    for (const type of ITEM_TYPES) {
      const a = appearanceOf(type);
      expect(a.kind).toBe(type === 'reverse' ? 'bottle' : 'rock');
      expect(a.emblem).toBe(type);
      expect(a.base).toMatch(/^#[0-9a-f]{6}$/i);
      expect(a.vein).toMatch(/^#[0-9a-f]{6}$/i);
      // Every type carries a floating tag so falling items read at a glance.
      expect(a.tag.text.length).toBeGreaterThan(0);
      expect(a.tag.text.length).toBeLessThanOrEqual(6);
      expect(a.tag.fg).toBeTruthy();
      expect(a.tag.bg).toBeTruthy();
    }
    // Harmful and helpful rocks never share a base colour.
    const bases = ITEM_TYPES.map((t) => appearanceOf(t).base);
    expect(new Set(bases).size).toBe(bases.length);
  });

  it('legend covers every type', () => {
    expect(new Set(LEGEND.flatMap((l) => l.types))).toEqual(new Set(ITEM_TYPES));
  });

  it('shows a badge for each active timed effect, with whole seconds left', () => {
    expect(effectBadges(new Simulation().effectTimers())).toEqual([]);
    const badges = effectBadges({ size: 'expand', sizeSeconds: 4.2, reverseSeconds: 0.4, multiplier: 5, multiplierSeconds: 2.5, cloneSeconds: 5 });
    expect(badges.map((b) => b.key)).toEqual(['size', 'reverse', 'multiplier', 'clone']);
    expect(badges.map((b) => b.text)).toEqual(['WIDE SCOOP 5s', '⇄ REVERSED 1s', '×5 POINTS 3s', 'SHADOW CLONES 5s']);
  });

  it('themes only carry presentation data', () => {
    for (const theme of Object.values(THEME_INFO)) {
      for (const key of Object.keys(theme)) expect(['score', 'weights', 'speed', 'difficulty']).not.toContain(key);
    }
  });
});

describe('layout', () => {
  const sizes = [
    [1366, 768],
    [1920, 1080],
    [360, 640],
    [390, 844],
    [844, 390],
    [768, 1024],
  ];

  it('keeps the whole arena frame inside the HUD-free region without stretching', () => {
    for (const [w, h] of sizes) {
      const insets = { top: 90, bottom: 120 };
      const L = computeLayout(w, h, insets);
      const F = ARENA.frame;
      const tl = L.toScreen(F.minX, F.maxY);
      const br = L.toScreen(F.maxX, F.minY);
      expect(tl.x).toBeGreaterThanOrEqual(-1e-6);
      expect(br.x).toBeLessThanOrEqual(w + 1e-6);
      expect(tl.y).toBeGreaterThanOrEqual(insets.top - 1e-6);
      expect(br.y).toBeLessThanOrEqual(h - insets.bottom + 1e-6);
      // Uniform scale: one world unit is the same number of pixels on both axes.
      const a = L.toScreen(0, 0);
      const b = L.toScreen(1, 1);
      expect(b.x - a.x).toBeCloseTo(a.y - b.y, 9);
      // Round trip.
      const p = L.toWorld(a.x, a.y);
      expect(p.x).toBeCloseTo(0, 9);
      expect(p.y).toBeCloseTo(0, 9);
    }
  });

  it('resizing never changes simulation state or logical speed', () => {
    const sim = new Simulation();
    sim.startRun(4, { seed: 11 });
    sim.beginPlay();
    for (let i = 0; i < 600; i++) sim.tick({ dir: 1, dragActive: false, dragDelta: 0 });
    const before = JSON.stringify({ c: sim.cart, s: sim.stage.score, f: sim.stage.falling });
    for (const [w, h] of sizes) computeLayout(w, h, { top: 50, bottom: 60 });
    expect(JSON.stringify({ c: sim.cart, s: sim.stage.score, f: sim.stage.falling })).toBe(before);
    expect(sim.maxSpeed).toBe(CART_MAX_SPEED);
  });
});
