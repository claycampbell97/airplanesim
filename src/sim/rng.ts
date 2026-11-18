// Deterministic random numbers. The generator state is a single integer stored in the
// game state, so a saved game continues with exactly the same sequence.

import type { Game } from './types';

/** mulberry32 step: returns the next state and a float in [0, 1). */
function step(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export function rand(g: Game): number {
  const [s, v] = step(g.rng);
  g.rng = s;
  return v;
}

export function randRange(g: Game, lo: number, hi: number): number {
  return lo + (hi - lo) * rand(g);
}

/** Integer in [lo, hi] inclusive. */
export function randInt(g: Game, lo: number, hi: number): number {
  return lo + Math.floor(rand(g) * (hi - lo + 1));
}

export function chance(g: Game, p: number): boolean {
  return rand(g) < p;
}

export function pick<T>(g: Game, items: readonly T[]): T {
  return items[Math.floor(rand(g) * items.length)];
}

/** Approximately normal(0, 1) via the sum of uniforms. */
export function randNormal(g: Game): number {
  return (rand(g) + rand(g) + rand(g) + rand(g) - 2) * 1.732;
}

export function weightedPick<T>(g: Game, items: readonly T[], weight: (item: T) => number): T | undefined {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return undefined;
  let r = rand(g) * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** Stable hash of a string to [0, 1) — for per-market variety that never changes. */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
