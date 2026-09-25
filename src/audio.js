// Procedural Web Audio: short distinct cues plus a subtle theme ambience/music bed.
// Audio starts only after a user gesture and fails silently if unavailable.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor({ sound = true, music = true, masterVol = 1, sfxVol = 1, musicVol = 1 } = {}) {
    this.ctx = null;
    this.available = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.soundOn = sound;
    this.musicOn = music;
    this.volumes = { master: masterVol, sfx: sfxVol, music: musicVol };
    this.theme = 'ice';
    this.ambience = null;
    this.suspended = false;
    this.lastPlayed = {};
  }

  _masterGain() {
    return 0.8 * this.volumes.master;
  }

  _sfxGain() {
    return this.soundOn ? 0.55 * this.volumes.sfx : 0;
  }

  _bedGain() {
    return this.musicOn ? this.volumes.music : 0;
  }

  /** Call from a user gesture (pointerdown / keydown). Safe to call repeatedly. */
  unlock() {
    if (!this.available) return;
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._masterGain();
        this.master.connect(this.ctx.destination);
        this.sfx = this.ctx.createGain();
        this.sfx.gain.value = this._sfxGain();
        this.sfx.connect(this.master);
        this.bed = this.ctx.createGain();
        this.bed.gain.value = this._bedGain();
        this.bed.connect(this.master);
        this.noise = this._noiseBuffer();
        this._startAmbience();
      }
      if (this.ctx.state === 'suspended' && !this.suspended) this.ctx.resume().catch(() => {});
    } catch {
      this.available = false;
      this.ctx = null;
    }
  }

  setSound(on) {
    this.soundOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(this._sfxGain(), this.ctx.currentTime, 0.02);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.bed) this.bed.gain.setTargetAtTime(this._bedGain(), this.ctx.currentTime, 0.2);
  }

  /** @param {'master'|'sfx'|'music'} kind @param {number} v 0..1 */
  setVolume(kind, v) {
    this.volumes[kind] = Math.min(1, Math.max(0, Number(v) || 0));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'master' && this.master) this.master.gain.setTargetAtTime(this._masterGain(), t, 0.05);
    if (kind === 'sfx' && this.sfx) this.sfx.gain.setTargetAtTime(this._sfxGain(), t, 0.05);
    if (kind === 'music' && this.bed) this.bed.gain.setTargetAtTime(this._bedGain(), t, 0.1);
  }

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.ctx) this._startAmbience();
  }

  /** Pause/background: silence everything and stop the audio clock. */
  suspend() {
    this.suspended = true;
    this.ctx?.suspend().catch(() => {});
  }

  resume() {
    this.suspended = false;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _noiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _tone({ freq, to, type = 'sine', start = 0, dur = 0.12, gain = 0.3, attack = 0.005 }) {
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise({ start = 0, dur = 0.2, gain = 0.3, freq = 800, q = 0.8, type = 'lowpass' }) {
    const t = this.ctx.currentTime + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /** Plays a named cue. Frequent cues are rate-limited so pileups never get noisy. */
  play(name) {
    if (!this.ctx || !this.soundOn || this.suspended) return;
    const now = this.ctx.currentTime;
    const minGap = { crack: 0.09, ground: 0.07, coin: 0.03 }[name] || 0;
    if (minGap && now - (this.lastPlayed[name] || 0) < minGap) return;
    this.lastPlayed[name] = now;
    try {
      switch (name) {
        case 'coin':
          this._tone({ freq: NOTE(84), dur: 0.08, gain: 0.22, type: 'square' });
          this._tone({ freq: NOTE(91), start: 0.06, dur: 0.14, gain: 0.2, type: 'square' });
          break;
        case 'cash':
          [79, 83, 86, 91].forEach((n, i) => this._tone({ freq: NOTE(n), start: i * 0.045, dur: 0.14, gain: 0.2, type: 'triangle' }));
          break;
        case 'shield':
          this._tone({ freq: NOTE(84), dur: 0.45, gain: 0.18, attack: 0.03 });
          this._tone({ freq: NOTE(91), start: 0.05, dur: 0.45, gain: 0.14, attack: 0.03 });
          this._tone({ freq: NOTE(96), start: 0.1, dur: 0.4, gain: 0.1, attack: 0.03 });
          break;
        case 'expand':
          this._tone({ freq: 260, to: 880, dur: 0.28, gain: 0.2, type: 'triangle' });
          break;
        case 'shrink':
          this._tone({ freq: 880, to: 220, dur: 0.28, gain: 0.2, type: 'triangle' });
          break;
        case 'reverse':
          // Glass clink from the whiskey bottle, then the woozy two-way sweep.
          this._tone({ freq: 2637, dur: 0.12, gain: 0.1, type: 'sine' });
          this._tone({ freq: 620, to: 310, start: 0.04, dur: 0.18, gain: 0.18, type: 'sawtooth' });
          this._tone({ freq: 310, to: 620, start: 0.2, dur: 0.18, gain: 0.16, type: 'sawtooth' });
          break;
        case 'multiplier':
          [76, 83, 88, 95].forEach((n, i) => this._tone({ freq: NOTE(n), start: i * 0.05, dur: 0.12, gain: 0.18, type: 'square' }));
          break;
        case 'clone':
          this._noise({ dur: 0.35, gain: 0.18, freq: 1800, q: 1.2, type: 'bandpass' });
          this._tone({ freq: 440, to: 880, dur: 0.3, gain: 0.12, type: 'triangle' });
          this._tone({ freq: 660, to: 1320, start: 0.08, dur: 0.3, gain: 0.1, type: 'triangle' });
          break;
        case 'damage':
          this._noise({ dur: 0.35, gain: 0.5, freq: 600 });
          this._tone({ freq: 140, to: 50, dur: 0.35, gain: 0.45, type: 'sine' });
          break;
        case 'blocked':
          this._tone({ freq: 520, dur: 0.1, gain: 0.12, type: 'triangle' });
          break;
        case 'revive':
          [72, 76, 79, 84].forEach((n, i) => this._tone({ freq: NOTE(n), start: i * 0.08, dur: 0.22, gain: 0.2, type: 'triangle' }));
          break;
        case 'target':
          [84, 88, 91].forEach((n, i) => this._tone({ freq: NOTE(n), start: i * 0.07, dur: 0.25, gain: 0.16, type: 'sine' }));
          break;
        case 'win':
          [72, 76, 79, 84, 88].forEach((n, i) => this._tone({ freq: NOTE(n), start: i * 0.11, dur: 0.35, gain: 0.2, type: 'triangle' }));
          break;
        case 'lose':
          [67, 64, 60, 55].forEach((n, i) => this._tone({ freq: NOTE(n), start: i * 0.16, dur: 0.4, gain: 0.18, type: 'triangle' }));
          break;
        case 'crack':
          this._noise({ dur: 0.06, gain: 0.08, freq: 2400, type: 'highpass' });
          break;
        case 'ground':
          this._noise({ dur: 0.18, gain: 0.12, freq: 300 });
          break;
        case 'click':
          this._tone({ freq: 900, dur: 0.04, gain: 0.08, type: 'triangle' });
          break;
        default:
          break;
      }
    } catch {
      // Audio failures never affect gameplay.
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.ambience) {
      const old = this.ambience;
      old.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      setTimeout(() => old.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }), 1500);
    }
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.bed);
    const nodes = [];
    // Wind / rumble bed from filtered noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = this.theme === 'volcano' ? 'lowpass' : 'bandpass';
    f.frequency.value = this.theme === 'volcano' ? 140 : 520;
    f.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = f.frequency.value * 0.35;
    lfo.connect(lfoGain).connect(f.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = this.theme === 'volcano' ? 0.09 : 0.035;
    src.connect(f).connect(windGain).connect(gain);
    src.start();
    lfo.start();
    nodes.push(src, lfo);
    // Soft pad: two slow detuned tones per chord.
    const chords = { ice: [57, 64], volcano: [45, 52] }[this.theme] || [57, 64];
    for (const n of chords) {
      for (const detune of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = NOTE(n);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = 0.012;
        o.connect(g).connect(gain);
        o.start();
        nodes.push(o);
      }
    }
    gain.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    this.ambience = { gain, nodes };
  }
}
