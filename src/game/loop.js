// Fixed-timestep driver with render interpolation. Large gaps (tab switches, debugger
// pauses, slow frames) are clamped instead of replayed, so there is never a catch-up burst.
import { LOOP, TICK_RATE } from '../config.js';

export class FixedStepLoop {
  /**
   * @param {object} hooks
   * @param {(dt:number) => void} hooks.step one fixed simulation tick
   * @param {(alpha:number, frameDt:number) => void} hooks.render draw with interpolation factor
   * @param {() => boolean} [hooks.shouldStep] whether simulation time may advance this frame
   */
  constructor({ step, render, shouldStep = () => true }) {
    this.stepFn = step;
    this.renderFn = render;
    this.shouldStep = shouldStep;
    this.dt = 1 / TICK_RATE;
    this.accumulator = 0;
    this.last = null;
    this.timeScale = 1;
    this.running = false;
    this.rafId = 0;
    this._frame = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(this._frame);
      this.frame(now);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = null;
    this.rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Forget elapsed wall time (call when resuming from pause or visibility loss). */
  resetClock() {
    this.last = null;
    this.accumulator = 0;
  }

  /** Processes one animation frame at timestamp `now` (ms). Exposed for tests. */
  frame(now) {
    let frameDt = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    if (!(frameDt >= 0)) frameDt = 0;
    frameDt = Math.min(frameDt, LOOP.maxFrameDelta);

    if (this.shouldStep()) {
      this.accumulator += frameDt * this.timeScale;
      let ticks = 0;
      while (this.accumulator >= this.dt && ticks < LOOP.maxTicksPerFrame) {
        this.stepFn(this.dt);
        this.accumulator -= this.dt;
        ticks++;
        if (!this.shouldStep()) break;
      }
      if (ticks >= LOOP.maxTicksPerFrame) this.accumulator = 0;
      if (!this.shouldStep()) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }
    const alpha = this.shouldStep() ? this.accumulator / this.dt : 1;
    this.renderFn(alpha, frameDt);
  }
}
