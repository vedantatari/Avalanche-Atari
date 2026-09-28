// Visual identity of each logical item type. Almost everything that falls is a physical rock
// with an embedded marking; the reverse item is a whiskey bottle instead (kind: 'bottle').
// `tag` is the floating pill shown beside a cracking/falling item so anyone can read what it
// does at a glance: helpful items get a dark pill with their accent colour, hazards a red
// pill, and the demon its own black-and-red one.
// Swap this table (or add another) to restyle items without touching scoring, collisions,
// or progression.

const GOOD_TAG = 'rgba(16,24,32,0.88)';
const BAD_TAG = 'rgba(206,24,42,0.92)';

export const ROCK_APPEARANCE = Object.freeze({
  coin: {
    kind: 'rock',
    name: 'Gold rock',
    base: '#6b4b32',
    vein: '#ffc21a',
    glow: 1,
    emblemGlow: 0.8,
    emblem: 'coin',
    popup: '+50',
    popupColor: '#ffd35a',
    tag: { text: '+50', fg: '#ffd35a', bg: GOOD_TAG },
    particle: ['#ffd35a', '#fff2b0', '#e8a93a'],
  },
  cash: {
    kind: 'rock',
    name: 'Emerald rock',
    base: '#34503a',
    vein: '#2dff6e',
    glow: 1,
    emblemGlow: 0.8,
    emblem: 'cash',
    popup: '+100',
    popupColor: '#5ef0a4',
    tag: { text: '+100', fg: '#5ef0a4', bg: GOOD_TAG },
    particle: ['#5ef0a4', '#d4ffe6', '#20b86c'],
  },
  shield: {
    kind: 'rock',
    name: 'Shield rock',
    base: '#5b6f93',
    vein: '#8fd0ff',
    glow: 0.35,
    emblem: 'shield',
    popup: '+1 SHIELD',
    popupColor: '#9ad6ff',
    tag: { text: 'SHIELD', fg: '#9ad6ff', bg: GOOD_TAG },
    particle: ['#9ad6ff', '#e6f5ff', '#4a90e2'],
  },
  expand: {
    kind: 'rock',
    name: 'Wide rock',
    base: '#355a55',
    vein: '#3ff0ff',
    glow: 1,
    emblemGlow: 0.8,
    emblem: 'expand',
    popup: 'WIDE SCOOP',
    popupColor: '#8ef5dd',
    tag: { text: 'WIDE', fg: '#8ef5dd', bg: GOOD_TAG },
    particle: ['#8ef5dd', '#e0fff7', '#39b89f'],
  },
  shrink: {
    kind: 'rock',
    name: 'Narrow rock',
    base: '#6e3428',
    vein: '#ff3b26',
    glow: 1,
    emblemGlow: 0.8,
    emblem: 'shrink',
    popup: 'NARROW',
    popupColor: '#ff9d8a',
    tag: { text: 'SHRINK', fg: '#ffffff', bg: BAD_TAG },
    particle: ['#ff9d8a', '#ffe0d8', '#d4533f'],
  },
  fire: {
    kind: 'rock',
    name: 'Fire rock',
    base: '#231d1b',
    vein: '#ff7417',
    glow: 1,
    emblemGlow: 0.85,
    emblem: 'fire',
    popup: '−1 ♥',
    popupColor: '#ff6a3d',
    tag: { text: '−1 ♥', fg: '#ffffff', bg: BAD_TAG },
    particle: ['#ff7417', '#ffc04a', '#3a2c2a'],
  },
  demon: {
    kind: 'rock',
    name: 'Demon rock',
    base: '#1c0b16',
    vein: '#ff2f4e',
    glow: 1,
    emblemGlow: 0.75,
    emblem: 'demon',
    popup: 'DEMON!',
    popupColor: '#ff3d5c',
    tag: { text: 'DEATH', fg: '#ff3d5c', bg: 'rgba(8,4,10,0.95)' },
    particle: ['#ff2f4e', '#8a1030', '#2a0a14'],
  },
  reverse: {
    kind: 'bottle',
    name: 'Whiskey bottle',
    // base = amber glass, vein = the whiskey highlight; both also colour the glass shards.
    base: '#9a5418',
    vein: '#ffb45c',
    glow: 0.3,
    emblem: 'reverse',
    popup: 'HIC! REVERSED',
    popupColor: '#ffc27a',
    tag: { text: 'FLIP', fg: '#ffffff', bg: BAD_TAG },
    particle: ['#ffc27a', '#fff1dc', '#b8641c'],
  },
  mult2: {
    kind: 'rock',
    name: '×2 rock',
    base: '#4d7688',
    vein: '#6fe3ff',
    glow: 0.5,
    emblem: 'mult2',
    popup: '×2 POINTS',
    popupColor: '#8eeaff',
    tag: { text: '×2', fg: '#8eeaff', bg: GOOD_TAG },
    particle: ['#8eeaff', '#e6fbff', '#2fa7d6'],
  },
  mult3: {
    kind: 'rock',
    name: '×3 rock',
    base: '#86597f',
    vein: '#ff8fe6',
    glow: 0.5,
    emblem: 'mult3',
    popup: '×3 POINTS',
    popupColor: '#ffa6ec',
    tag: { text: '×3', fg: '#ffa6ec', bg: GOOD_TAG },
    particle: ['#ffa6ec', '#ffe6fa', '#d24fb8'],
  },
  mult5: {
    kind: 'rock',
    name: '×5 rock',
    base: '#8c3f36',
    vein: '#ffd23f',
    glow: 0.65,
    emblem: 'mult5',
    popup: '×5 POINTS',
    popupColor: '#ffd84a',
    tag: { text: '×5', fg: '#ffd84a', bg: GOOD_TAG },
    particle: ['#ffd84a', '#fff4c2', '#ff6a3d'],
  },
  clone: {
    kind: 'rock',
    name: 'Shadow clone rock',
    base: '#3a3f58',
    vein: '#b9c4ff',
    glow: 0.45,
    emblem: 'clone',
    popup: 'SHADOW CLONE',
    popupColor: '#c8d0ff',
    tag: { text: 'CLONE', fg: '#c8d0ff', bg: GOOD_TAG },
    particle: ['#c8d0ff', '#f0f2ff', '#5b64a8'],
  },
  split: {
    kind: 'rock',
    name: 'Split rock',
    base: '#80705c',
    vein: '#ffb347',
    glow: 0.5,
    emblem: 'split',
    popup: '+40',
    popupColor: '#ffc36b',
    tag: { text: 'SPLIT', fg: '#ffc36b', bg: GOOD_TAG },
    particle: ['#ffc36b', '#fff0d0', '#d98a2b'],
  },
  magnet: {
    kind: 'rock',
    name: 'Magnet rock',
    base: '#58607a',
    vein: '#7fd8ff',
    glow: 0.5,
    emblem: 'magnet',
    popup: 'MAGNET',
    popupColor: '#8fe4ff',
    tag: { text: 'MAGNET', fg: '#8fe4ff', bg: GOOD_TAG },
    particle: ['#8fe4ff', '#e8f9ff', '#e2474b'],
  },
  mystery: {
    kind: 'rock',
    name: 'Mystery rock',
    base: '#6a4b78',
    vein: '#e59bff',
    glow: 0.55,
    emblem: 'mystery',
    popup: '?!',
    popupColor: '#f0b8ff',
    tag: { text: '???', fg: '#ffffff', bg: 'rgba(110,62,170,0.94)' },
    particle: ['#f0b8ff', '#fff0ff', '#9a4fd0'],
  },
  frost: {
    kind: 'rock',
    name: 'Frost rock',
    base: '#8fb2c8',
    vein: '#e2f7ff',
    glow: 0.35,
    emblem: 'frost',
    popup: 'FROZEN',
    popupColor: '#bfeaff',
    tag: { text: 'FREEZE', fg: '#ffffff', bg: BAD_TAG },
    particle: ['#dff5ff', '#ffffff', '#7fb8e0'],
  },
});

export const CART_TIERS = [
  { name: 'Rusty Rider', thumb: 'assets/carts/cart-1.png', tub: '#ffffff', lip: '#5a6168', frame: '#26292e', hub: '#a0582a', accent: '#9c5424', stripe: false },
  { name: 'Red Runner', thumb: 'assets/carts/cart-2.png', tub: '#ff8f80', lip: '#e9ebee', frame: '#2a2426', hub: '#ffd23a', accent: '#ffffff', stripe: true },
  { name: 'Copper Classic', sprite: 'assets/carts/cart-3.png', aspect: 512 / 502, rim: 0.398 },
  { name: 'Red Racer', sprite: 'assets/carts/cart-4.png', aspect: 512 / 477, rim: 0.382 },
  { name: 'Steam Engine', sprite: 'assets/carts/cart-5.png', aspect: 506 / 512, rim: 0.389 },
  { name: 'Thunder Bolt', sprite: 'assets/carts/cart-6.png', aspect: 497 / 512, rim: 0.377 },
  { name: 'Crystal Frost', sprite: 'assets/carts/cart-7.png', aspect: 494 / 512, rim: 0.389 },
  { name: 'Magma Core', sprite: 'assets/carts/cart-8.png', aspect: 512 / 505, rim: 0.376 },
  { name: 'Neon Nova', sprite: 'assets/carts/cart-9.png', aspect: 512 / 486, rim: 0.391 },
  { name: 'Emerald Dragon', sprite: 'assets/carts/cart-10.png', aspect: 489 / 512, rim: 0.389 },
];

export const CART_SLICES = [0, 0.15, 0.27, 0.73, 0.85, 1];

export function cartSliceXs(width, base, imgW) {
  const f = width / base;
  const fixed = CART_SLICES[1] + (CART_SLICES[3] - CART_SLICES[2]) + (1 - CART_SLICES[4]);
  const k = Math.max(0.3, (f - fixed) / (1 - fixed));
  const squeeze = f / (fixed + (1 - fixed) * k);
  const xs = [0];
  for (let i = 1; i < CART_SLICES.length; i++) xs.push(xs[i - 1] + (CART_SLICES[i] - CART_SLICES[i - 1]) * (i === 2 || i === 4 ? k : 1));
  const total = xs[xs.length - 1];
  return xs.map((x) => (x - total / 2) * imgW * squeeze);
}

export const cartTier = (unlockedLevel) => Math.max(0, Math.min(CART_TIERS.length - 1, Math.floor(((unlockedLevel || 1) - 1) / 10)));

/** Popup text when a mystery rock reveals its outcome (a jackpot shows its points instead). */
export function revealPopup(reveal) {
  return reveal === 'jackpot' ? 'JACKPOT' : ROCK_APPEARANCE[reveal]?.popup || '?!';
}

export function appearanceOf(type) {
  const a = ROCK_APPEARANCE[type];
  if (!a) throw new Error(`No appearance for item type ${type}`);
  return a;
}

const MULT_BADGE = {
  2: { fg: '#06324a', bg: 'rgba(130,225,255,0.95)' },
  3: { fg: '#4a0c3c', bg: 'rgba(255,160,235,0.95)' },
  5: { fg: '#4a1a04', bg: 'rgba(255,205,70,0.96)' },
};

/** Timed-effect badges stacked above the cart (bottom first), shared by both renderers. */
export function effectBadges(timers) {
  const secs = (t) => Math.ceil(t - 1e-6);
  const out = [];
  if (timers.size) {
    const wide = timers.size === 'expand';
    out.push({ key: 'size', text: `${wide ? 'WIDE SCOOP' : 'NARROW'} ${secs(timers.sizeSeconds)}s`, style: { fg: '#10302c', bg: wide ? 'rgba(170,245,226,0.94)' : 'rgba(255,190,176,0.95)' } });
  }
  if (timers.reverseSeconds > 0) {
    out.push({ key: 'reverse', text: `⇄ REVERSED ${secs(timers.reverseSeconds)}s`, style: { fg: '#ffffff', bg: 'rgba(116,70,190,0.95)' } });
  }
  if (timers.multiplierSeconds > 0) {
    out.push({ key: 'multiplier', text: `×${timers.multiplier} POINTS ${secs(timers.multiplierSeconds)}s`, style: MULT_BADGE[timers.multiplier] || MULT_BADGE[2] });
  }
  if (timers.cloneSeconds > 0) {
    out.push({ key: 'clone', text: `SHADOW CLONES ${secs(timers.cloneSeconds)}s`, style: { fg: '#ffffff', bg: 'rgba(64,72,132,0.95)' } });
  }
  if (timers.magnetSeconds > 0) {
    out.push({ key: 'magnet', text: `MAGNET ${secs(timers.magnetSeconds)}s`, style: { fg: '#062a3a', bg: 'rgba(140,225,255,0.95)' } });
  }
  if (timers.frostSeconds > 0) {
    out.push({ key: 'frost', text: `FROZEN ${secs(timers.frostSeconds)}s`, style: { fg: '#ffffff', bg: 'rgba(52,120,178,0.95)' } });
  }
  return out;
}

/**
 * Short legend text shared by the side panel, tutorial, and How to play. `short` labels the
 * compact menu legend on mid-height screens.
 */
export const LEGEND = [
  { types: ['coin', 'cash'], title: 'Gold / $ rock', short: 'Gold · $', detail: '+50 / +100', verdict: 'catch' },
  { types: ['shield'], title: 'Shield rock', short: 'Shield', detail: 'Bank +1', verdict: 'catch' },
  { types: ['expand', 'shrink'], title: '+ / − rock', short: '+ / −', detail: 'Size · 5s', verdict: 'mixed' },
  { types: ['fire'], title: 'Fire rock', short: 'Fire', detail: 'Lose a heart', verdict: 'avoid' },
  { types: ['demon'], title: 'Demon', short: 'Demon', detail: 'Instant game over', verdict: 'avoid' },
  { types: ['reverse'], title: 'Whiskey', short: 'Whiskey', detail: 'Reverse · 5s', verdict: 'avoid' },
  { types: ['mult2', 'mult3', 'mult5'], title: '×2 ×3 ×5 rock', short: '×2 ×3 ×5', detail: 'Points · 5s', verdict: 'catch' },
  { types: ['clone'], title: 'Shadow rock', short: 'Shadow', detail: 'Clones · 5s', verdict: 'catch' },
  { types: ['split'], title: 'Split rock', short: 'Split', detail: '2 × +40', verdict: 'catch' },
  { types: ['magnet'], title: 'Magnet', short: 'Magnet', detail: 'Pull · 5s', verdict: 'catch' },
  { types: ['mystery'], title: '? rock', short: '? rock', detail: 'Surprise', verdict: 'mixed' },
  { types: ['frost'], title: 'Frost rock', short: 'Frost', detail: 'Slow · 4s', verdict: 'avoid' },
];
