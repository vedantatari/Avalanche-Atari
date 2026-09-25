// Device-independent input state. Keyboard keys, hold buttons, and drags all end up in
// one intent ({dir, dragActive, dragDelta}); the simulation applies Reverse to that intent.

export class InputState {
  constructor() {
    this.keys = new Set();
    this.holds = { left: new Set(), right: new Set() };
    this.drag = null; // { pointerId, surface }
    this.pendingDrag = 0; // world units since the last sample
    this.followX = null; // absolute pointer-follow target in world units (mouse/pen hover)
  }

  keyDown(side) {
    this.keys.add(side);
    // Keyboard steering takes over from the hovering pointer until it moves again.
    this.followX = null;
  }

  keyUp(side) {
    this.keys.delete(side);
  }

  holdStart(side, pointerId) {
    this.holds[side].add(pointerId);
  }

  holdEnd(side, pointerId) {
    this.holds[side].delete(pointerId);
  }

  /** Only one pointer steers at a time; extra fingers never steal the drag. */
  dragStart(pointerId, surface) {
    if (this.drag) return false;
    this.drag = { pointerId, surface };
    return true;
  }

  isDragging(pointerId) {
    return !!this.drag && (pointerId === undefined || this.drag.pointerId === pointerId);
  }

  dragMove(pointerId, worldDelta) {
    if (!this.isDragging(pointerId) || !Number.isFinite(worldDelta)) return;
    this.pendingDrag += worldDelta;
  }

  dragEnd(pointerId) {
    if (!this.isDragging(pointerId)) return false;
    this.drag = null;
    this.pendingDrag = 0;
    return true;
  }

  /** Absolute follow target from a hovering mouse/pen, in world units. */
  setFollow(worldX) {
    if (Number.isFinite(worldX)) this.followX = worldX;
  }

  /** Drops every held input (blur, pause, visibility loss, pointer cancel storms). */
  clear() {
    this.keys.clear();
    this.holds.left.clear();
    this.holds.right.clear();
    this.drag = null;
    this.pendingDrag = 0;
    this.followX = null;
  }

  get direction() {
    const left = this.keys.has('left') || this.holds.left.size > 0;
    const right = this.keys.has('right') || this.holds.right.size > 0;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  /** Intent for one simulation tick; drag movement is consumed, the follow target persists. */
  sample() {
    const intent = { dir: this.direction, dragActive: !!this.drag, dragDelta: this.pendingDrag, followX: this.followX };
    this.pendingDrag = 0;
    return intent;
  }
}
