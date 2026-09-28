// Logical source cells on the cliff shelves and the fall kinematics of a detached rock.
// Positions are on the gameplay plane (x, y); `z` is how far back the shelf sits.
import { CART, CLIFF, ROCK, ARENA } from '../config.js';

/** Rock centre height at the instant its bottom touches the scoop rim (its "arrival"). */
export const CONTACT_Y = ARENA.catchY + ROCK.radius;
/** Rock centre height below which it has fallen fully past the scoop tub. */
export const PAST_SCOOP_Y = ARENA.catchY - CART.scoopDepth - ROCK.radius;

let cachedCells = null;

/** Every source cell, ordered row by row. Rows alternate a half-column offset like brickwork. */
export function cliffCells() {
  if (cachedCells) return cachedCells;
  const cells = [];
  CLIFF.rows.forEach((row, rowIndex) => {
    const mid = (row.columns - 1) / 2;
    for (let col = 0; col < row.columns; col++) {
      cells.push({
        id: cells.length,
        row: rowIndex,
        col,
        x: (col - mid) * CLIFF.columnSpacing,
        y: row.y,
        z: row.z,
      });
    }
  });
  cachedCells = Object.freeze(cells.map((c) => Object.freeze(c)));
  return cachedCells;
}

/**
 * Fall profile: a short linear acceleration, then constant speed, with the rock's bottom
 * touching the scoop rim exactly `fallSeconds` after detaching. Deterministic and easy to read.
 */
export function fallProfile(y0, fallSeconds) {
  const distance = y0 - CONTACT_Y;
  const accel = Math.min(ROCK.accelSeconds, fallSeconds * 0.3);
  const speed = distance / (fallSeconds - accel / 2);
  return { accel, speed };
}

/** Height of a drop at absolute stage time t. */
export function dropYAt(drop, t) {
  if (t <= drop.detachAt) return drop.y0;
  const tau = t - drop.detachAt;
  const { accel, speed } = drop;
  if (tau < accel) return drop.y0 - (speed * tau * tau) / (2 * accel);
  return drop.y0 - speed * (tau - accel / 2);
}

/**
 * Sideways position of a drop at stage time t. Rocks pushed by wind or heat vents (and the
 * halves of a split rock) ease from their source column `x0` to their landing `x` between
 * `driftStart` and `driftEnd`; catching only ever happens at the landing `x`.
 */
export function dropXAt(drop, t) {
  if (drop.x0 === undefined || t >= drop.driftEnd) return drop.x;
  if (t <= drop.driftStart) return drop.x0;
  const p = (t - drop.driftStart) / (drop.driftEnd - drop.driftStart);
  return drop.x0 + (drop.x - drop.x0) * p * p * (3 - 2 * p);
}

/** Time at which a drop falls to height y (y below the source). */
export function dropTimeAtY(drop, y) {
  const dist = drop.y0 - y;
  const accelDist = (drop.speed * drop.accel) / 2;
  if (dist <= accelDist) return drop.detachAt + Math.sqrt((2 * drop.accel * dist) / drop.speed);
  return drop.detachAt + drop.accel + (dist - accelDist) / drop.speed;
}
