// Slots: the right to a daily departure at an airport with no room to spare.
//
// At the world's most congested airports an airline can only schedule as many
// departures as it holds slots for. Supply there is short of demand, so flights
// fill and fares are firm: the way to carry more is a bigger aircraft per slot.

import { AIRPORT } from './data/airports';
import { earn, feeFactor, spend } from './finance';
import { rotationFrequency } from './market';
import type { Aircraft, Airline, Airport, AirportId } from './types';
import type { Sim } from './sim';

/** Departures a day that an airport of this size handles in all. */
export function airportDepartures(ap: Airport): number {
  return (ap.pax * 1e6) / (2 * 365 * 150);
}

/** Slots a new airline is given at its home airport. */
export function homeSlots(ap: Airport): number {
  return Math.max(10, Math.round(0.02 * airportDepartures(ap)));
}

/** Slots that come with a route's set-up fee the first time an airline flies to a slot-limited airport. */
export const ENTRANT_SLOTS = 2;
/** Extra slots granted with each level of base built at a slot-limited airport. */
export const HUB_SLOTS = [0, 4, 6, 10];
/** Fraction of the going price paid when slots are handed back. */
const RESALE = 0.6;
/** Rounding slack: frequencies are fractions of a flight. */
const SLACK = 0.05;

/**
 * Daily departure slots an airline holds at an airport: Infinity where they are not
 * rationed. Rivals hold what an established airline of their standing would.
 */
export function slotsHeld(al: Airline, airport: AirportId): number {
  const ap = AIRPORT[airport];
  if (!ap.slotLimited) return Infinity;
  if (!al.ai) return al.slots?.[airport] ?? 0;
  const total = airportDepartures(ap);
  if (airport === al.hq) return Math.round(0.28 * total);
  if (al.hubs.some((h) => h.airport === airport)) return Math.round(0.12 * total);
  return Math.max(3, Math.round(0.012 * total));
}

/** Daily departures an airline's assigned aircraft make from an airport (optionally leaving one aircraft out). */
export function slotsUsed(sim: Sim, al: Airline, airport: AirportId, except?: Aircraft): number {
  let used = 0;
  for (const r of sim.routesOf(al.id)) {
    if (r.a !== airport && r.b !== airport) continue;
    for (const id of r.aircraft) {
      const ac = sim.acById.get(id);
      if (ac && ac !== except) used += rotationFrequency(sim, ac);
    }
  }
  return used;
}

export function slotsFree(sim: Sim, al: Airline, airport: AirportId): number {
  const held = slotsHeld(al, airport);
  return held === Infinity ? Infinity : held - slotsUsed(sim, al, airport);
}

export interface SlotShortfall {
  airport: AirportId;
  /** Daily departures the plan needs there, and how many slots are free for it. */
  need: number;
  free: number;
}

/** Slots free at an airport for a plan: a player's first route there comes with a newcomer's pair. */
export function slotsFreeFor(sim: Sim, al: Airline, airport: AirportId, newRoute = false): number {
  const free = slotsFree(sim, al, airport);
  return newRoute && !al.ai && !(al.slots?.[airport]) ? free + ENTRANT_SLOTS : free;
}

/**
 * Slot-limited ends of a route where `freq` more daily departures would not fit.
 * Pass `newRoute` when the route does not exist yet.
 */
export function planShortfall(sim: Sim, al: Airline, a: AirportId, b: AirportId, freq: number, newRoute = false): SlotShortfall[] {
  const out: SlotShortfall[] = [];
  for (const airport of [a, b]) {
    if (!AIRPORT[airport].slotLimited) continue;
    const free = slotsFreeFor(sim, al, airport, newRoute);
    if (freq > free + SLACK) out.push({ airport, need: freq, free: Math.max(0, free) });
  }
  return out;
}

/** Whole slots to buy to cover a shortfall. */
export function slotsToBuy(s: SlotShortfall): number {
  return Math.max(1, Math.ceil(s.need - s.free - SLACK));
}

/** Slot-limited airports where giving an aircraft this rotation would need more slots than the airline has free. */
export function rotationShortfall(sim: Sim, al: Airline, ac: Aircraft, rotation: number[]): SlotShortfall[] {
  const out: SlotShortfall[] = [];
  const freq = rotationFrequency(sim, ac, rotation);
  const before = rotationFrequency(sim, ac);
  const touched = new Map<AirportId, { now: number; then: number }>();
  const count = (ids: number[], key: 'now' | 'then', f: number) => {
    for (const rid of ids) {
      const r = sim.routeById.get(rid);
      if (!r) continue;
      for (const airport of [r.a, r.b]) {
        if (!AIRPORT[airport].slotLimited) continue;
        const t = touched.get(airport) ?? { now: 0, then: 0 };
        t[key] += f;
        touched.set(airport, t);
      }
    }
  };
  count(ac.rotation, 'now', before);
  count(rotation, 'then', freq);
  for (const [airport, t] of touched) {
    // Flying less from an airport is always allowed, however few slots are held.
    if (t.then <= t.now + 1e-9) continue;
    const free = slotsHeld(al, airport) - slotsUsed(sim, al, airport, ac);
    if (t.then > free + SLACK) out.push({ airport, need: t.then, free: Math.max(0, free) });
  }
  return out;
}

export function describeShortfall(s: SlotShortfall): string {
  const ap = AIRPORT[s.airport];
  return `Not enough slots at ${ap.city} (${s.airport}): this needs ${s.need.toFixed(1)} departures a day and ${s.free.toFixed(1)} are free. Buy slots there, or fly fewer, larger aircraft`;
}

// ───────────── Buying and selling (the player) ─────────────

export function grantSlots(al: Airline, airport: AirportId, n: number): void {
  if (!AIRPORT[airport].slotLimited || n <= 0) return;
  al.slots ??= {};
  al.slots[airport] = (al.slots[airport] ?? 0) + n;
}

/** Price of one more daily slot: the more an airline already holds, the dearer the next. */
export function slotPrice(sim: Sim, al: Airline, airport: AirportId, held = al.slots?.[airport] ?? 0): number {
  return 450_000 * feeFactor(AIRPORT[airport]) * (1 + held / 20) * sim.tuning.cost;
}

/** Total price of the next `n` slots. */
export function slotsCost(sim: Sim, al: Airline, airport: AirportId, n: number): number {
  const held = al.slots?.[airport] ?? 0;
  let cost = 0;
  for (let i = 0; i < n; i++) cost += slotPrice(sim, al, airport, held + i);
  return cost;
}

export function slotRefund(sim: Sim, al: Airline, airport: AirportId): number {
  const held = al.slots?.[airport] ?? 0;
  return held > 0 ? RESALE * slotPrice(sim, al, airport, held - 1) : 0;
}

export function buySlots(sim: Sim, airlineId: number, airport: AirportId, n = 1): { ok: true; value: number } | { ok: false; reason: string } {
  const al = sim.game.airlines[airlineId];
  if (!AIRPORT[airport]?.slotLimited) return { ok: false, reason: 'Slots are not rationed at this airport' };
  const cost = slotsCost(sim, al, airport, n);
  if (al.cash < cost) return { ok: false, reason: 'Not enough cash for the slots' };
  spend(al, 'misc', cost);
  grantSlots(al, airport, n);
  return { ok: true, value: cost };
}

export function sellSlot(sim: Sim, airlineId: number, airport: AirportId): { ok: true; value: number } | { ok: false; reason: string } {
  const al = sim.game.airlines[airlineId];
  const held = al.slots?.[airport] ?? 0;
  if (held <= 0) return { ok: false, reason: 'You hold no slots here' };
  if (slotsUsed(sim, al, airport) > held - 1 + SLACK) return { ok: false, reason: 'All of your slots here are in use' };
  const refund = slotRefund(sim, al, airport);
  al.slots![airport] = held - 1;
  earn(al, 'other', refund);
  return { ok: true, value: refund };
}
