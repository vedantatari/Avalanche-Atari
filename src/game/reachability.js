// Validates that a stage offers enough scoring a real cart could actually collect.
// Longest-path DP over helpful arrivals: a catch can follow another only if the cart can
// travel between them at a human share of top speed. Multiplier rocks count: a route that
// catches a ×N rock earns ×N on its scoring catches for the next multiplierSeconds.
import { BASE_SCOOP_WIDTH, CART_MAX_SPEED, EFFECTS, FAIRNESS, ROCK } from '../config.js';
import { itemEffect, scoreValue } from './items.js';

const multiplierOf = (type) => itemEffect(type).multiplier || 0;

export function maxReachableScore(drops, options = {}) {
  const speed = (options.speed ?? CART_MAX_SPEED) * (options.speedShare ?? FAIRNESS.reachSpeedShare);
  // Touching needs the cart centre within this distance of the rock.
  const catchHalf = options.catchHalf ?? BASE_SCOOP_WIDTH / 2 + ROCK.radius * ROCK.catchOverlapFraction;
  const startX = options.startX ?? 0;
  const window = EFFECTS.multiplierSeconds;

  const nodes = drops
    .filter((d) => scoreValue(d.type) > 0 || multiplierOf(d.type) > 1)
    .sort((a, b) => a.arriveAt - b.arriveAt);
  const n = nodes.length;
  // states[i]: Map from "index of the multiplier rock last caught on the route" (-1 = none)
  // to the best route score ending with a catch of node i.
  const states = new Array(n);
  let overall = 0;

  for (let i = 0; i < n; i++) {
    const di = nodes[i];
    const mult = multiplierOf(di.type);
    const out = new Map();
    const extend = (k, score) => {
      // A multiplier older than its window has expired by the time this rock arrives.
      const active = k >= 0 && di.arriveAt - nodes[k].arriveAt < window ? k : -1;
      const nextK = mult > 1 ? i : active;
      const gain = mult > 1 ? 0 : scoreValue(di.type) * (active >= 0 ? multiplierOf(nodes[active].type) : 1);
      const total = score + gain;
      if (!(out.get(nextK) >= total)) out.set(nextK, total);
    };
    // Reachable directly from the start position at t = 0?
    if (Math.max(0, Math.abs(di.x - startX) - catchHalf) <= speed * di.arriveAt) extend(-1, 0);
    for (let j = 0; j < i; j++) {
      const dj = nodes[j];
      const travel = Math.max(0, Math.abs(di.x - dj.x) - catchHalf);
      if (travel > speed * (di.arriveAt - dj.arriveAt) + 1e-9) continue;
      for (const [k, score] of states[j]) extend(k, score);
    }
    states[i] = out;
    for (const score of out.values()) if (score > overall) overall = score;
  }
  return overall;
}
