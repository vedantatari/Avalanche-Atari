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
    base: '#8f877e',
    vein: '#ffc53a',
    glow: 0.55,
    emblem: 'coin',
    popup: '+50',
    popupColor: '#ffd35a',
    tag: { text: '+50', fg: '#ffd35a', bg: GOOD_TAG },
    particle: ['#ffd35a', '#fff2b0', '#e8a93a'],
  },
  cash: {
    kind: 'rock',
    name: 'Emerald rock',
    base: '#7a817c',
    vein: '#2fd683',
    glow: 0.45,
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
    base: '#4c8c84',
    vein: '#8ef5dd',
    glow: 0.3,
    emblem: 'expand',
    popup: 'WIDE SCOOP',
    popupColor: '#8ef5dd',
    tag: { text: 'WIDE', fg: '#8ef5dd', bg: GOOD_TAG },
    particle: ['#8ef5dd', '#e0fff7', '#39b89f'],
  },
  shrink: {
    kind: 'rock',
    name: 'Narrow rock',
    base: '#b4665b',
    vein: '#ffb3a3',
    glow: 0.25,
    emblem: 'shrink',
    popup: 'NARROW',
    popupColor: '#ff9d8a',
    tag: { text: 'SHRINK', fg: '#ffffff', bg: BAD_TAG },
    particle: ['#ff9d8a', '#ffe0d8', '#d4533f'],
  },
  fire: {
    kind: 'rock',
    name: 'Fire rock',
    base: '#2d2524',
    vein: '#ff7417',
    glow: 1,
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
});

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
  return out;
}

/** Short legend text shared by the side panel, tutorial, and How to play. */
export const LEGEND = [
  { types: ['coin', 'cash'], title: 'Gold / $ rock', detail: '+50 / +100', verdict: 'catch' },
  { types: ['shield'], title: 'Shield rock', detail: 'Bank +1', verdict: 'catch' },
  { types: ['expand', 'shrink'], title: '+ / − rock', detail: 'Size · 5s', verdict: 'mixed' },
  { types: ['fire'], title: 'Fire rock', detail: 'Lose a heart', verdict: 'avoid' },
  { types: ['demon'], title: 'Demon', detail: 'Instant game over', verdict: 'avoid' },
  { types: ['reverse'], title: 'Whiskey', detail: 'Reverse · 5s', verdict: 'avoid' },
  { types: ['mult2', 'mult3', 'mult5'], title: '×2 ×3 ×5 rock', detail: 'Points · 5s', verdict: 'catch' },
  { types: ['clone'], title: 'Shadow rock', detail: 'Clones · 5s', verdict: 'catch' },
];
