// Binds keyboard and Pointer Events (mouse/touch/pen) to an InputState. Mouse/pen steer by
// hover-follow or relative drag (converted to world units via the current layout); touch
// steers by zone: hold the left or right half of the playfield to move that way.
const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);

export class InputController {
  /**
   * @param {import('./input-state.js').InputState} state
   * @param {object} o
   * @param {HTMLElement} o.playfield drag/steer surface over the scene
   * @param {() => number} o.pxPerUnit CSS pixels per world unit on the gameplay plane
   * @param {(x:number) => number} [o.worldX] playfield X → world X on the gameplay plane
   * @param {() => boolean} [o.followEnabled] whether absolute pointer-follow is on (mouse/pen)
   * @param {() => boolean} o.isActive whether gameplay input is accepted right now
   * @param {() => void} o.onPause Escape / P
   * @param {() => void} o.onRestore R
   * @param {() => void} o.onBlur window lost focus
   * @param {() => void} o.onGesture first user gesture (audio unlock)
   */
  constructor(state, o) {
    this.state = state;
    this.o = o;
    this.lastX = new Map();
    this.zones = new Map(); // touch pointerId -> 'left' | 'right'
    this._bindKeyboard();
    this._bindDrag(o.playfield, 'playfield');
    window.addEventListener('blur', () => {
      state.clear();
      o.onBlur?.();
    });
  }

  _bindKeyboard() {
    const { state, o } = this;
    window.addEventListener('keydown', (e) => {
      o.onGesture?.();
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const active = o.isActive();
      if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code)) {
        if (!active) return;
        // Arrow keys on a focused movement button would double-trigger; keep them for the game.
        e.preventDefault();
        state.keyDown(LEFT_KEYS.has(e.code) ? 'left' : 'right');
      } else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        e.preventDefault();
        o.onPause();
      } else if (e.code === 'KeyR' && !e.repeat && active) {
        e.preventDefault();
        o.onRestore();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (LEFT_KEYS.has(e.code)) state.keyUp('left');
      if (RIGHT_KEYS.has(e.code)) state.keyUp('right');
    });
  }

  _worldDelta(dxPx) {
    return dxPx / Math.max(1e-3, this.o.pxPerUnit());
  }

  _x(el, e) {
    return this.o.localX(el, e);
  }

  /** Which steering zone a touch is in: left or right half of the playfield. */
  _zoneSide(el, e) {
    return this._x(el, e) < el.clientWidth / 2 ? 'left' : 'right';
  }

  _bindDrag(el, surface) {
    const { state, o } = this;
    el.addEventListener('pointerdown', (e) => {
      o.onGesture?.();
      if (!o.isActive()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'touch') {
        // Touch zone steering: hold the left/right half of the screen to move that way.
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture can fail for synthetic pointers; the hold still works while inside */
        }
        const side = this._zoneSide(el, e);
        this.zones.set(e.pointerId, side);
        state.holdStart(side, e.pointerId);
        return;
      }
      if (!state.dragStart(e.pointerId, surface)) return; // another pointer already steers
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture can fail for synthetic pointers; drag still works while inside */
      }
      this.lastX.set(e.pointerId, this._x(el, e));
    });
    el.addEventListener('pointermove', (e) => {
      // A touch sliding across the middle switches sides without lifting.
      const zone = this.zones.get(e.pointerId);
      if (zone) {
        const side = this._zoneSide(el, e);
        if (side !== zone) {
          state.holdEnd(zone, e.pointerId);
          state.holdStart(side, e.pointerId);
          this.zones.set(e.pointerId, side);
        }
        return;
      }
      // Absolute pointer-follow (mouse/pen only): the cart tracks the hovering pointer, no
      // button needed. An active drag still takes priority.
      if (e.pointerType !== 'touch' && o.followEnabled?.() && o.isActive() && o.worldX) {
        state.setFollow(o.worldX(this._x(el, e)));
      }
      if (!state.isDragging(e.pointerId)) return;
      const x = this._x(el, e);
      const last = this.lastX.get(e.pointerId) ?? x;
      this.lastX.set(e.pointerId, x);
      state.dragMove(e.pointerId, this._worldDelta(x - last));
    });
    const end = (e) => {
      const zone = this.zones.get(e.pointerId);
      if (zone) {
        state.holdEnd(zone, e.pointerId);
        this.zones.delete(e.pointerId);
      }
      this.lastX.delete(e.pointerId);
      state.dragEnd(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Clears held keys/zones/drags (pause, blur, orientation). */
  clear() {
    this.state.clear();
    this.lastX.clear();
    this.zones.clear();
  }
}
