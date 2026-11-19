// Revenue management: moving fares to where each cabin earns the most.
//
// Every few days a managed route asks the market model what it would carry a
// little cheaper and a little dearer, and steps each cabin's fare towards the
// better answer. Full flights get dearer until demand just fits the seats; empty
// ones get cheaper until a seat sold is no longer worth more than it costs to fill.

import { AIRPORT } from './data/airports';
import { expectedBoarded } from './demand';
import { feeFactor, labourFactor } from './finance';
import { blockMinutes, getMarket, marketInputs, offerOf, splitMarket } from './market';
import type { Market, OfferInput } from './market';
import { ancillaryPerPax } from './ops';
import type { Airline, AirportId, Route, Triple } from './types';
import type { Sim } from './sim';

/** Fares are managed within this band around the market's reference fare. */
export const FARE_FLOOR = 0.5;
export const FARE_CEILING = 2;
/** Rivals keep to their brand's price position: no ruinous fare wars, no gouging. */
const RIVAL_BAND: [number, number] = [0.8, 1.4];
/** Size of one fare move. */
const STEP = 0.04;
/** A move has to be worth at least this much more, as a share of what the cabin earns now. */
const WORTH_IT = 0.004;
/** Each managed route is looked at once in this many days. */
export const FARE_REVIEW_DAYS = 3;

/** The band a route's fares are managed in, as multiples of the reference fare. */
export function fareBand(al: Airline): [number, number] {
  if (!al.ai) return [FARE_FLOOR, FARE_CEILING];
  return [al.ai.fareLevel * RIVAL_BAND[0], al.ai.fareLevel * RIVAL_BAND[1]];
}

/** A service whose fares are being set: enough to work out what a cabin earns. */
export interface FareCase {
  a: AirportId;
  b: AirportId;
  /** Flight time gate to gate, hours. */
  hours: number;
  /** Departures per day each way. */
  freq: number;
  seats: Triple;
  /** Connecting passengers on offer per day each way, and what they pay for this leg. */
  conn: Triple;
  connFare: Triple;
}

/**
 * What one more passenger in a cabin costs to carry (catering, passenger charges,
 * sales commission), less what an economy passenger spends on extras.
 */
export function passengerCost(sim: Sim, al: Airline, s: FareCase, cls: number, fare: number): number {
  const level = al.policy.service;
  const perY = 0.5 + 0.9 * level + s.hours * (0.3 + 0.7 * level);
  const catering = (cls === 0 ? perY : cls === 1 ? perY * 3.2 + 6 * level : perY * 6.5 + 15 * level)
    * Math.sqrt(labourFactor(sim, al)) * Math.sqrt(sim.tuning.cost);
  const charges = 5.4 * (feeFactor(AIRPORT[s.a]) + feeFactor(AIRPORT[s.b])) * 0.5 * sim.tuning.cost;
  const extras = cls === 0 ? ancillaryPerPax(al, s.a, s.b) : 0;
  return catering + charges + fare * 0.045 - extras;
}

/** What a cabin earns per day and direction at a fare, given the local demand that fare attracts. */
function cabinValue(sim: Sim, al: Airline, s: FareCase, cls: number, fare: number, local: number): number {
  const boarded = s.freq * expectedBoarded(local / s.freq, s.seats[cls]);
  // Connecting passengers take the seats the local ones leave, at their prorated fare.
  const conn = Math.max(0, Math.min(s.conn[cls], s.freq * s.seats[cls] - boarded));
  return boarded * (fare - passengerCost(sim, al, s, cls, fare))
    + conn * (s.connFare[cls] - passengerCost(sim, al, s, cls, s.connFare[cls]));
}

/**
 * One round of revenue management: for each cabin, the fare among "as now", a step
 * down and a step up that earns the most. `inputs[index]` is the service being priced.
 */
function stepFares(sim: Sim, al: Airline, m: Market, inputs: OfferInput[], index: number, s: FareCase, fare: Triple, band: [number, number]): Triple {
  const mine = inputs[index];
  const keep = mine.price;
  const clampFare = (cls: number, f: number) => Math.round(Math.max(m.ref[cls] * band[0], Math.min(m.ref[cls] * band[1], f)));
  const options = [1, 1 - STEP, 1 + STEP].map((k) => {
    const f: Triple = [clampFare(0, fare[0] * k), clampFare(1, fare[1] * k), clampFare(2, fare[2] * k)];
    mine.price = f;
    return { fare: f, local: splitMarket(m, inputs)[index] };
  });
  mine.price = keep;

  const next: Triple = [options[0].fare[0], options[0].fare[1], options[0].fare[2]];
  for (let c = 0; c < 3; c++) {
    if (s.seats[c] <= 0) continue;
    const stay = cabinValue(sim, al, s, c, options[0].fare[c], options[0].local[c]);
    let bestValue = stay + Math.abs(stay) * WORTH_IT;
    for (let i = 1; i < options.length; i++) {
      const v = cabinValue(sim, al, s, c, options[i].fare[c], options[i].local[c]);
      if (v > bestValue) {
        bestValue = v;
        next[c] = options[i].fare[c];
      }
    }
  }
  return next;
}

function caseOf(sim: Sim, r: Route): FareCase | null {
  const offer = offerOf(sim, r);
  if (offer.freq <= 0) return null;
  const first = sim.acById.get(r.aircraft[0]);
  return {
    a: r.a, b: r.b,
    hours: (first ? blockMinutes(first.type, r.dist) : (r.dist / 820) * 60 + 30) / 60,
    freq: offer.freq, seats: offer.seats,
    conn: [(r.connRate[0][0] + r.connRate[1][0]) * 0.5, (r.connRate[0][1] + r.connRate[1][1]) * 0.5, (r.connRate[0][2] + r.connRate[1][2]) * 0.5],
    connFare: r.connFare,
  };
}

/**
 * Moves each cabin's fare on a live route towards the level that earns more, by
 * up to `rounds` steps. Returns true if any fare changed; the caller refreshes the market.
 */
export function tuneFares(sim: Sim, r: Route, m: Market = getMarket(sim, r.a, r.b), rounds = 2): boolean {
  const s = caseOf(sim, r);
  const index = m.routes.indexOf(r);
  if (!s || index < 0) return false;
  const al = sim.game.airlines[r.airline];
  const band = fareBand(al);
  const inputs = marketInputs(sim, m);
  let changed = false;
  for (let i = 0; i < rounds; i++) {
    const next = stepFares(sim, al, m, inputs, index, s, r.price, band);
    if (next[0] === r.price[0] && next[1] === r.price[1] && next[2] === r.price[2]) break;
    r.price = next;
    inputs[index].price = next;
    changed = true;
  }
  return changed;
}

/**
 * The fares revenue management would settle on for a service, found by running the
 * same steps to rest against a copy of the market. Used for forecasts.
 */
export function settledFares(sim: Sim, al: Airline, m: Market, inputs: OfferInput[], index: number, s: FareCase, start: Triple): Triple {
  const band = fareBand(al);
  let fare = start;
  for (let round = 0; round < 30; round++) {
    const next = stepFares(sim, al, m, inputs, index, s, fare, band);
    if (next[0] === fare[0] && next[1] === fare[1] && next[2] === fare[2]) break;
    fare = next;
  }
  return fare;
}

/** Whether revenue management sets this route's fares. Rivals always use it. */
export function faresManaged(al: Airline, r: Route): boolean {
  return al.ai ? true : !!r.auto;
}

/**
 * The daily round: a third of all managed routes have their fares reviewed.
 * Call before the markets are refreshed for the day.
 */
export function manageFares(sim: Sim): void {
  const day = sim.game.day;
  for (const m of sim.activeMarkets) {
    for (const r of m.routes) {
      if ((day + r.id) % FARE_REVIEW_DAYS !== 0) continue;
      const al = sim.game.airlines[r.airline];
      if (al.bankrupt || !faresManaged(al, r)) continue;
      tuneFares(sim, r, m);
    }
  }
}
