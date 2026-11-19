// Market model: turns static demand into passenger flows for each airline.
//
// A "market" is an unordered airport pair. Every route an airline flies on that
// pair is an offer; passengers split between the offers by frequency, price and
// quality. On top of the local traffic, airlines with hubs collect connecting
// passengers travelling between two of their spokes.
//
// The output is a set of inflow rates (passengers per day) on each route. Flights
// then draw from booking pools that fill at those rates (see ops.ts).

import { AIRCRAFT_TYPE } from './data/aircraft';
import { AIRPORT, AIRPORTS, airportDistance, pairIndex } from './data/airports';
import { baseDemand, classSplit, expectedBoarded, frequencyCapture, leisureScore, businessScore, priceResponse, refFare, REGION_GROWTH, seasonOf } from './demand';
import { yearFraction, yearsElapsed } from './time';
import type { Aircraft, AircraftCategory, Airline, AirportId, RegionId, Route, Triple } from './types';
import type { Sim } from './sim';

export interface Market {
  key: number;
  a: AirportId;
  b: AirportId;
  dist: number;
  /** Share of demand per cabin class. */
  split: Triple;
  /** Reference demand per class, passengers/day each way. */
  base: Triple;
  /** Demand today, including season, growth, the economy and events. */
  demand: Triple;
  ref: Triple;
  leisure: number;
  business: number;
  routes: Route[];
  /**
   * The carriers that are not simulated individually. Every established market
   * already has service; newcomers have to win passengers from it.
   */
  others: OfferInput;
  /** World-factor generation this market's demand was last computed for. */
  stamp: number;
}

/** What an airline offers on a route, derived from its fleet assignment. */
export interface Offer {
  /** Departures per day in each direction. */
  freq: number;
  /** Average seats per departure by class. */
  seats: Triple;
  /** 0..1 product quality as passengers perceive it. */
  quality: number;
}

/** Share of each class's demand that the unsimulated incumbent carriers have seats for. */
const OTHERS_CAPACITY: Triple = [0.85, 0.85, 0.8];
/** At a slot-limited airport the incumbents can only field this share of the seats they would like to. */
const SLOT_SCARCITY = 0.78;
/** Typical aircraft size used by the incumbents, to turn seats into frequency. */
const OTHERS_SEATS = 165;
const OTHERS_QUALITY = 0.45;
/** Airline id used for the incumbents in competitor lists. */
export const OTHER_AIRLINES = -1;

/** How strongly premium passengers switch airline over price (economy depends on the market, see below). */
const PRICE_SENSITIVITY: Triple = [2.6, 1.6, 1.1];
/** Booking pools hold at most this many days of demand; beyond that travellers give up. */
export const POOL_DAYS = 1.25;
/** Share of an unserved city pair that one hub can win with a convenient connection. */
const CONNECT_SHARE = 0.09;
/** Where a decent non-stop exists, only this fraction of that share still connects. */
const CONNECT_VS_NONSTOP = 0.1;
/** Longest tolerated detour for a connection, relative to the direct distance. */
const MAX_DETOUR = 1.45;
/** Connections are recomputed for each airline every this many days (and whenever its network changes). */
const CONNECT_REFRESH_DAYS = 4;

const ANCILLARY_PENALTY = [0, 0.03, 0.08, 0.15];

export function getMarket(sim: Sim, a: AirportId, b: AirportId): Market {
  const key = pairIndex(a, b);
  let m = sim.markets.get(key);
  if (!m) {
    const [lo, hi] = AIRPORT[a].index < AIRPORT[b].index ? [a, b] : [b, a];
    const total = baseDemand(lo, hi);
    const split = classSplit(lo, hi);
    const A = AIRPORT[lo];
    const B = AIRPORT[hi];
    m = {
      key,
      a: lo,
      b: hi,
      dist: airportDistance(lo, hi),
      split,
      base: [total * split[0], total * split[1], total * split[2]],
      demand: [0, 0, 0],
      ref: refFare(lo, hi),
      leisure: leisureScore(A, B),
      business: businessScore(A, B),
      routes: [],
      others: { freq: 0, seats: [0, 0, 0], price: [0, 0, 0], quality: OTHERS_QUALITY, boost: 1 },
      stamp: -1,
    };
    sim.markets.set(key, m);
  }
  // Demand moves with the season, the economy and events: bring it up to date on first use each day.
  if (m.stamp !== sim.factorStamp) applyTimeFactor(sim, m);
  return m;
}

export function findMarket(sim: Sim, a: AirportId, b: AirportId): Market | undefined {
  return sim.markets.get(pairIndex(a, b));
}

/** Combined multiplier for season, growth, economy, events and difficulty on a city pair. */
export function timeFactor(sim: Sim, a: AirportId, b: AirportId): number {
  const A = AIRPORT[a];
  const B = AIRPORT[b];
  const wa = A.leisure / (A.leisure + B.leisure);
  const season = wa * sim.season[A.index] + (1 - wa) * sim.season[B.index];
  const growth = Math.sqrt(sim.growth[A.region] * sim.growth[B.region]);
  return season * growth * sim.game.world.economy * sim.eventFactor[A.index] * sim.eventFactor[B.index] * sim.tuning.demand;
}

function applyTimeFactor(sim: Sim, m: Market): void {
  m.stamp = sim.factorStamp;
  const f = timeFactor(sim, m.a, m.b);
  m.demand[0] = m.base[0] * f;
  m.demand[1] = m.base[1] * f;
  m.demand[2] = m.base[2] * f;

  // Incumbents scale their schedules with the market: except where an airport has no
  // slots left to give, and they cannot keep up with demand.
  const o = m.others;
  const scarce = (AIRPORT[m.a].slotLimited ? SLOT_SCARCITY : 1) * (AIRPORT[m.b].slotLimited ? SLOT_SCARCITY : 1);
  const daily = (m.demand[0] * OTHERS_CAPACITY[0] + m.demand[1] * OTHERS_CAPACITY[1] + m.demand[2] * OTHERS_CAPACITY[2]) * scarce;
  // Thin markets are poorly served or not at all: this is where newcomers find room.
  const presence = Math.max(0, Math.min(1, (daily - 60) / 140));
  o.freq = Math.min(16, (daily / OTHERS_SEATS) * presence);
  for (let c = 0; c < 3; c++) {
    o.seats[c] = o.freq > 0 ? (m.demand[c] * OTHERS_CAPACITY[c] * scarce * presence) / o.freq : 0;
    o.price[c] = m.ref[c];
  }
}

/** Refreshes the per-airport seasonal and event multipliers. Called once per game day. */
export function refreshWorldFactors(sim: Sim): void {
  const g = sim.game;
  sim.factorStamp += 1;
  const yf = yearFraction(g.time);
  sim.years = yearsElapsed(g.time);
  for (const region of Object.keys(REGION_GROWTH) as RegionId[]) {
    sim.growth[region] = Math.exp(REGION_GROWTH[region] * sim.years);
  }
  for (const a of AIRPORTS) {
    sim.season[a.index] = seasonOf(a, yf);
    sim.eventFactor[a.index] = 1;
    sim.disruption[a.index] = 0;
  }
  for (const e of g.world.events) {
    if (g.time < e.start || g.time >= e.end) continue;
    for (const a of AIRPORTS) {
      if (e.airport ? a.id === e.airport : e.region ? a.region === e.region : true) {
        // A pair touches two airports, so world/region events apply their square root at each end.
        sim.eventFactor[a.index] *= e.airport ? e.demand : Math.sqrt(e.demand);
        if (e.disruption) sim.disruption[a.index] = Math.max(sim.disruption[a.index], e.disruption);
      }
    }
  }
}

// ───────────────────────── Offers ─────────────────────────

/** Minutes from pushback to arrival at the gate. */
export function blockMinutes(typeId: string, dist: number): number {
  const t = AIRCRAFT_TYPE[typeId];
  const overhead = t.category === 'turboprop' ? 22 : t.category === 'regional' || t.category === 'narrowbody' ? 30 : 38;
  return (dist / t.speed) * 60 + overhead;
}

/** Minutes for one out-and-back on a route including both turnarounds. */
export function roundTripMinutes(typeId: string, dist: number): number {
  return 2 * (blockMinutes(typeId, dist) + AIRCRAFT_TYPE[typeId].turnaround);
}

/** Share of the calendar an aircraft is available after maintenance downtime. */
export const AVAILABILITY = 0.96;
/** Flights shorter than this do not depart at night (curfews, and nobody wants a 3 a.m. hop). */
export const NIGHT_STOP_BLOCK = 300;
/** Share of the day in which short flights may depart. */
const DAY_WINDOW = 18.25 / 24;

/**
 * The most an aircraft flies in a day, in hours gate to gate. Crews run out of duty
 * time, schedules have to meet the hours people want to travel, and the aircraft
 * needs its daily checks: nobody gets twenty hours a day out of an airliner.
 */
export const MAX_BLOCK_HOURS: Record<AircraftCategory, number> = {
  turboprop: 10, regional: 11, narrowbody: 12.5, widebody: 15.5, jumbo: 15,
};

export function maxBlockMinutes(typeId: string): number {
  return MAX_BLOCK_HOURS[AIRCRAFT_TYPE[typeId].category] * 60;
}

/** Round trips per day one aircraft can fly on a route, allowing for night stops, daily hours and maintenance. */
export function dailyRoundTrips(typeId: string, dist: number): number {
  const block = blockMinutes(typeId, dist);
  const window = block < NIGHT_STOP_BLOCK ? DAY_WINDOW : 1;
  const natural = (1440 / roundTripMinutes(typeId, dist)) * window;
  return Math.min(natural, maxBlockMinutes(typeId) / (2 * block)) * AVAILABILITY;
}

/** Daily departures per direction that an aircraft contributes to each route in its rotation. */
export function rotationFrequency(sim: Sim, ac: Aircraft, rotation: number[] = ac.rotation): number {
  let cycle = 0;
  let night = 0;
  let block = 0;
  for (const rid of rotation) {
    const r = sim.routeById.get(rid);
    if (!r) continue;
    const rt = roundTripMinutes(ac.type, r.dist);
    const b = blockMinutes(ac.type, r.dist);
    cycle += rt;
    block += 2 * b;
    if (b < NIGHT_STOP_BLOCK) night += rt;
  }
  if (cycle <= 0) return 0;
  // Night stops only cost time on the short sectors of a rotation.
  const window = 1 - (1 - DAY_WINDOW) * (night / cycle);
  return Math.min((1440 / cycle) * window, maxBlockMinutes(ac.type) / block) * AVAILABILITY;
}

/** Flights (in either direction) an aircraft makes per day across its whole rotation. */
export function legsPerDay(sim: Sim, ac: Aircraft): number {
  let routes = 0;
  for (const rid of ac.rotation) if (sim.routeById.has(rid)) routes += 1;
  return 2 * routes * rotationFrequency(sim, ac);
}

export function aircraftAgeYears(sim: Sim, ac: Aircraft): number {
  return Math.max(0, (sim.game.time - ac.built) / 525960);
}

/** 0..1 cabin appeal of one aircraft. */
export function cabinComfort(sim: Sim, ac: Aircraft): number {
  const t = AIRCRAFT_TYPE[ac.type];
  // Whole days only, so the result does not depend on the minute it is asked for.
  const age = Math.max(0, (sim.game.day * 1440 - ac.built) / 525960);
  const density = ac.density === 0 ? -0.12 : ac.density === 2 ? 0.12 : 0;
  return Math.max(0, Math.min(1, t.comfort * (1 - Math.min(0.25, age * 0.01)) + density));
}

export function airlineQualityBase(al: Airline): number {
  const service = (al.policy.service - 1) / 4;
  const rep = al.reputation / 100;
  const otp = Math.max(0, Math.min(1, (al.otpDay - 0.6) / 0.35));
  return 0.35 * service + 0.25 * rep + 0.15 * otp - ANCILLARY_PENALTY[al.policy.ancillary];
}

export function computeOffer(sim: Sim, route: Route): Offer {
  const al = sim.game.airlines[route.airline];
  let freq = 0;
  let comfort = 0;
  const seats: Triple = [0, 0, 0];
  for (const id of route.aircraft) {
    const ac = sim.acById.get(id);
    if (!ac || ac.phase === 'delivery') continue;
    const f = rotationFrequency(sim, ac);
    freq += f;
    comfort += f * cabinComfort(sim, ac);
    seats[0] += f * ac.cabin[0];
    seats[1] += f * ac.cabin[1];
    seats[2] += f * ac.cabin[2];
  }
  if (freq > 0) {
    comfort /= freq;
    seats[0] /= freq; seats[1] /= freq; seats[2] /= freq;
  }
  const quality = Math.max(0, Math.min(1, airlineQualityBase(al) + 0.25 * comfort));
  return { freq, seats, quality };
}

export function offerOf(sim: Sim, route: Route): Offer {
  let o = sim.offers.get(route.id);
  if (!o) {
    o = computeOffer(sim, route);
    sim.offers.set(route.id, o);
  }
  return o;
}

// ───────────────────────── Local market share ─────────────────────────

export interface OfferInput {
  freq: number;
  seats: Triple;
  price: Triple;
  quality: number;
  /** Awareness ramp (0..1) × promotion boost. */
  boost: number;
}

/**
 * Splits a market between competing offers. Returns passengers/day per direction
 * for each offer and class.
 */
export function splitMarket(m: Market, offers: OfferInput[]): Triple[] {
  const out: Triple[] = offers.map(() => [0, 0, 0]);
  const attr: number[] = new Array(offers.length);
  const cap: number[] = new Array(offers.length);
  for (let c = 0; c < 3; c++) {
    // Holidaymakers shop on price and forgive a bare-bones product; business travellers
    // and premium cabins are the other way round.
    const priceWeight = c === 0 ? 2.2 + 1.2 * m.leisure : PRICE_SENSITIVITY[c];
    const qualityWeight = c === 0 ? 1.25 - 0.75 * m.leisure : 1.3;
    let totalFreq = 0;
    let totalAttr = 0;
    for (let i = 0; i < offers.length; i++) {
      const o = offers[i];
      let a = 0;
      if (o.freq > 0 && o.seats[c] > 0) {
        const x = o.price[c] / m.ref[c];
        a = Math.pow(o.freq, 1.15) * Math.exp(-priceWeight * (x - 1)) * Math.pow(0.5 + o.quality, qualityWeight);
        totalFreq += o.freq;
      }
      attr[i] = a;
      totalAttr += a;
    }
    if (totalAttr <= 0) continue;

    // Market size responds to the share-weighted price and to how much service exists.
    let priceIndex = 0;
    for (let i = 0; i < offers.length; i++) priceIndex += (attr[i] / totalAttr) * (offers[i].price[c] / m.ref[c]);
    const volume = m.demand[c] * frequencyCapture(totalFreq) * priceResponse(c, priceIndex, m.leisure, m.business);

    // First pass: ideal split. Second pass: passengers who cannot get a seat on their
    // first choice partly rebook on a competitor with space.
    let spill = 0;
    let spareAttr = 0;
    for (let i = 0; i < offers.length; i++) {
      const o = offers[i];
      const want = volume * (attr[i] / totalAttr) * o.boost;
      cap[i] = o.freq * o.seats[c];
      out[i][c] = want; // above capacity this keeps the pressure on: full flights, the pool cap limits the rest
      if (want > cap[i]) spill += want - cap[i];
      else if (attr[i] > 0) spareAttr += attr[i];
    }
    if (spill > 0 && spareAttr > 0) {
      const recaptured = spill * 0.5;
      for (let i = 0; i < offers.length; i++) {
        if (attr[i] > 0 && out[i][c] <= cap[i]) out[i][c] += recaptured * (attr[i] / spareAttr);
      }
    }
  }
  return out;
}

function routeBoost(sim: Sim, r: Route): number {
  return r.maturity * (sim.game.time < r.promoUntil ? 1.3 : 1);
}

/** Every offer on a market as the share model sees it: its routes in order, then the incumbents. */
export function marketInputs(sim: Sim, m: Market): OfferInput[] {
  const inputs: OfferInput[] = [];
  for (const r of m.routes) {
    const o = offerOf(sim, r);
    inputs.push({ freq: o.freq, seats: o.seats, price: r.price, quality: o.quality, boost: routeBoost(sim, r) });
  }
  inputs.push(m.others);
  return inputs;
}

/** Recomputes local inflow rates for every route on a market. */
export function refreshMarket(sim: Sim, m: Market): void {
  if (m.stamp !== sim.factorStamp) applyTimeFactor(sim, m);
  if (m.routes.length === 0) return;
  const split = splitMarket(m, marketInputs(sim, m));
  for (let i = 0; i < m.routes.length; i++) {
    const r = m.routes[i];
    settlePools(sim, r);
    for (let c = 0; c < 3; c++) {
      r.rate[0][c] = split[i][c];
      r.rate[1][c] = split[i][c];
    }
  }
}

/** Brings a route's booking pools up to the current time. */
export function settlePools(sim: Sim, r: Route): void {
  const now = sim.game.time;
  const days = (now - r.poolTime) / 1440;
  if (days <= 0) return;
  r.poolTime = now;
  for (let d = 0; d < 2; d++) {
    for (let c = 0; c < 3; c++) {
      const rate = r.rate[d][c];
      r.pool[d][c] = Math.min(r.pool[d][c] + rate * days, rate * POOL_DAYS);
      const crate = r.connRate[d][c];
      r.connPool[d][c] = Math.min(r.connPool[d][c] + crate * days, crate * POOL_DAYS);
    }
  }
}

// ───────────────────────── Connecting traffic ─────────────────────────

interface Spoke {
  other: AirportId;
  dist: number;
  freq: number;
  seats: Triple;
  /** Price relative to the reference fare, per class. */
  priceIndex: Triple;
  ref: Triple;
  maturity: number;
}

interface LiveSpoke extends Spoke {
  route: Route;
  /** Direction index on the route for hub→other. */
  out: 0 | 1;
}

/** 1 when travellers between a and b have a decent non-stop alternative, 0 when they have none. */
function nonstopStrength(sim: Sim, m: Market): number {
  let freq = m.others.freq;
  for (const r of m.routes) freq += offerOf(sim, r).freq;
  return Math.min(1, freq / 1.5);
}

// Scratch outputs of connectFlow (avoids allocating in the inner loop).
const flowPax: Triple = [0, 0, 0];
const flowLeg1: Triple = [0, 0, 0];
const flowLeg2: Triple = [0, 0, 0];

/**
 * Connecting passengers per day (each way) between two spokes of a hub, and what
 * each of them pays for the first and second leg. Results are left in the scratch
 * arrays; returns false when the pair cannot be connected sensibly.
 */
function connectFlow(sim: Sim, hubFactor: number, s1: Spoke, s2: Spoke): boolean {
  if (s1.other === s2.other) return false;
  const direct = airportDistance(s1.other, s2.other);
  if (direct < 500) return false;
  const detour = (s1.dist + s2.dist) / direct;
  if (detour > MAX_DETOUR) return false;

  const m = getMarket(sim, s1.other, s2.other);
  const total = m.demand[0] + m.demand[1] + m.demand[2];
  if (total < 0.5) return false;

  let share = CONNECT_SHARE * Math.min(1, Math.pow((MAX_DETOUR - detour) / 0.35, 0.7));
  share *= 1 - (1 - CONNECT_VS_NONSTOP) * nonstopStrength(sim, m);
  // Good connections need banks of flights: a couple of departures a day leave long layovers.
  share *= hubFactor * Math.min(1, Math.sqrt(s1.freq * s2.freq) / 3) * Math.min(s1.maturity, s2.maturity);

  let any = false;
  for (let c = 0; c < 3; c++) {
    flowPax[c] = 0;
    if (s1.seats[c] <= 0 || s2.seats[c] <= 0) continue;
    const x = (s1.priceIndex[c] + s2.priceIndex[c]) / 2;
    const pax = m.demand[c] * share * priceResponse(c, x, m.leisure, m.business);
    if (pax <= 0) continue;
    // Through fares are discounted against the non-stop and prorated by leg.
    const fare = 0.8 * m.ref[c] * x;
    flowPax[c] = pax;
    flowLeg1[c] = fare * (s1.ref[c] / (s1.ref[c] + s2.ref[c]));
    flowLeg2[c] = fare - flowLeg1[c];
    any = true;
  }
  return any;
}

function hubFactorOf(al: Airline, level: number): number {
  const quality = 0.7 + 0.6 * Math.max(0, airlineQualityBase(al) + 0.15);
  return (level >= 3 ? 1.25 : 1) * quality;
}

function liveSpokes(sim: Sim, al: Airline, hub: AirportId): LiveSpoke[] {
  const spokes: LiveSpoke[] = [];
  for (const r of sim.routesOf(al.id)) {
    if (r.a !== hub && r.b !== hub) continue;
    const offer = offerOf(sim, r);
    if (offer.freq <= 0) continue;
    const m = getMarket(sim, r.a, r.b);
    spokes.push({
      route: r,
      other: r.a === hub ? r.b : r.a,
      out: r.a === hub ? 0 : 1,
      dist: r.dist,
      freq: offer.freq,
      seats: offer.seats,
      priceIndex: [r.price[0] / m.ref[0], r.price[1] / m.ref[1], r.price[2] / m.ref[2]],
      ref: m.ref,
      maturity: r.maturity,
    });
  }
  return spokes;
}

/**
 * Recomputes connecting-passenger inflows for one airline: travellers between two
 * spokes of a hub who accept a change of planes. Fares are prorated between the
 * two legs, so connecting passengers pay less per leg than local ones.
 */
export function refreshConnections(sim: Sim, al: Airline): void {
  const routes = sim.routesOf(al.id);
  const revenue = new Map<number, Triple>();
  const volume = new Map<number, Triple>();
  for (const r of routes) {
    settlePools(sim, r);
    r.connRate = [[0, 0, 0], [0, 0, 0]];
    revenue.set(r.id, [0, 0, 0]);
    volume.set(r.id, [0, 0, 0]);
  }

  for (const hub of al.hubs) {
    if (hub.level < 2) continue;
    const spokes = liveSpokes(sim, al, hub.airport);
    const factor = hubFactorOf(al, hub.level);
    for (let i = 0; i < spokes.length; i++) {
      const s1 = spokes[i];
      const rev1 = revenue.get(s1.route.id)!;
      const vol1 = volume.get(s1.route.id)!;
      for (let j = i + 1; j < spokes.length; j++) {
        const s2 = spokes[j];
        if (!connectFlow(sim, factor, s1, s2)) continue;
        const rev2 = revenue.get(s2.route.id)!;
        const vol2 = volume.get(s2.route.id)!;
        for (let c = 0; c < 3; c++) {
          const pax = flowPax[c];
          if (pax <= 0) continue;
          // s1.other → hub → s2.other, and the reverse.
          s1.route.connRate[1 - s1.out][c] += pax;
          s2.route.connRate[s2.out][c] += pax;
          s2.route.connRate[1 - s2.out][c] += pax;
          s1.route.connRate[s1.out][c] += pax;
          rev1[c] += 2 * pax * flowLeg1[c];
          vol1[c] += 2 * pax;
          rev2[c] += 2 * pax * flowLeg2[c];
          vol2[c] += 2 * pax;
        }
      }
    }
  }

  for (const r of routes) {
    const rev = revenue.get(r.id)!;
    const vol = volume.get(r.id)!;
    const m = getMarket(sim, r.a, r.b);
    const offer = offerOf(sim, r);
    for (let c = 0; c < 3; c++) {
      // Connecting flows cannot crowd out more than the aircraft can carry.
      const cap = offer.freq * offer.seats[c];
      for (let d = 0; d < 2; d++) r.connRate[d][c] = Math.min(r.connRate[d][c], cap);
      r.connFare[c] = vol[c] > 0 ? rev[c] / vol[c] : m.ref[c] * 0.6;
    }
  }
}

/**
 * Connecting passengers a prospective spoke would pick up from an airline's existing
 * network at a hub: passengers/day each way per class, and their average leg fare.
 */
export function estimateConnections(
  sim: Sim,
  al: Airline,
  hub: AirportId,
  dest: AirportId,
  freq: number,
  seats: Triple,
  price: Triple,
  exclude?: Route,
): { pax: Triple; fare: Triple } {
  const pax: Triple = [0, 0, 0];
  const revenue: Triple = [0, 0, 0];
  const level = al.hubs.find((h) => h.airport === hub)?.level ?? 0;
  const m = getMarket(sim, hub, dest);
  if (level >= 2 && freq > 0) {
    const mine: Spoke = {
      other: dest, dist: m.dist, freq, seats,
      priceIndex: [price[0] / m.ref[0], price[1] / m.ref[1], price[2] / m.ref[2]],
      ref: m.ref, maturity: 1,
    };
    const factor = hubFactorOf(al, level);
    for (const s of liveSpokes(sim, al, hub)) {
      if (s.route === exclude) continue;
      if (!connectFlow(sim, factor, mine, s)) continue;
      for (let c = 0; c < 3; c++) {
        pax[c] += flowPax[c];
        revenue[c] += flowPax[c] * flowLeg1[c];
      }
    }
  }
  const fare: Triple = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    pax[c] = Math.min(pax[c], freq * seats[c]);
    fare[c] = pax[c] > 0 ? revenue[c] / Math.max(pax[c], 1e-9) : m.ref[c] * 0.6;
  }
  return { pax, fare };
}

// ───────────────────────── Bookkeeping ─────────────────────────

export function attachRoute(sim: Sim, r: Route): void {
  const m = getMarket(sim, r.a, r.b);
  if (!m.routes.includes(r)) m.routes.push(r);
  sim.activeMarkets.add(m);
}

export function detachRoute(sim: Sim, r: Route): void {
  const m = findMarket(sim, r.a, r.b);
  if (!m) return;
  const i = m.routes.indexOf(r);
  if (i >= 0) m.routes.splice(i, 1);
  if (m.routes.length === 0) sim.activeMarkets.delete(m);
}

/** Call after anything that changes what an airline offers on a route. */
export function routeChanged(sim: Sim, r: Route): void {
  sim.offers.delete(r.id);
  refreshMarket(sim, getMarket(sim, r.a, r.b));
  sim.dirtyAirlines.add(r.airline);
}

/**
 * Daily refresh: every market's local split, and each airline's connecting flows
 * on a rolling schedule (they change slowly unless the network itself changes).
 */
export function refreshAllMarkets(sim: Sim, everything = false): void {
  sim.offers.clear();
  for (const m of sim.activeMarkets) refreshMarket(sim, m);
  const day = sim.game.day;
  for (const al of sim.game.airlines) {
    if (al.bankrupt) continue;
    if (everything || sim.dirtyAirlines.has(al.id) || (day + al.id) % CONNECT_REFRESH_DAYS === 0) refreshConnections(sim, al);
  }
  sim.dirtyAirlines.clear();
}

// ───────────────────────── Planning estimates ─────────────────────────

export interface RouteEstimate {
  dist: number;
  blockMinutes: number;
  /** Departures per day each way. */
  freq: number;
  demand: Triple;
  ref: Triple;
  /** Expected passengers per departure by class (local and connecting together). */
  pax: Triple;
  /** Of which connecting through the hub. */
  conn: Triple;
  /** Average fare a connecting passenger pays for this leg. */
  connFare: Triple;
  seats: Triple;
  loadFactor: number;
  competitors: { airline: number; freq: number; price: Triple; seats: Triple }[];
  /** Expected share of local economy demand. */
  share: number;
}

/**
 * Predicts how a (possibly hypothetical) service would perform on a market, using
 * exactly the same share and connection models as the live simulation.
 */
export function estimateService(
  sim: Sim,
  al: Airline,
  a: AirportId,
  b: AirportId,
  typeId: string,
  cabin: Triple,
  aircraftCount: number,
  price: Triple,
  comfort: number,
  existing?: Route,
  /** Skip the connecting-traffic estimate (cheaper; used when ranking many candidates). */
  localOnly = false,
): RouteEstimate {
  const m = getMarket(sim, a, b);
  const freq = aircraftCount > 0 ? dailyRoundTrips(typeId, m.dist) * aircraftCount : 0;
  const quality = Math.max(0, Math.min(1, airlineQualityBase(al) + 0.25 * comfort));
  const inputs: OfferInput[] = [];
  const competitors: RouteEstimate['competitors'] = [];
  for (const r of m.routes) {
    if (r === existing || (r.airline === al.id && !existing)) continue;
    const o = offerOf(sim, r);
    inputs.push({ freq: o.freq, seats: o.seats, price: r.price, quality: o.quality, boost: routeBoost(sim, r) });
    if (o.freq > 0) competitors.push({ airline: r.airline, freq: o.freq, price: r.price, seats: o.seats });
  }
  inputs.push(m.others);
  if (m.others.freq > 0) competitors.push({ airline: OTHER_AIRLINES, freq: m.others.freq, price: m.others.price, seats: m.others.seats });
  inputs.push({ freq, seats: cabin, price, quality, boost: 1 });
  const split = splitMarket(m, inputs);
  const mine = split[split.length - 1];

  // Whichever end is a hub feeds connections (both ends, if both are hubs).
  const connPax: Triple = [0, 0, 0];
  const connRev: Triple = [0, 0, 0];
  if (!localOnly && freq > 0) {
    for (const [hub, dest] of [[a, b], [b, a]] as const) {
      const e = estimateConnections(sim, al, hub, dest, freq, cabin, price, existing);
      for (let c = 0; c < 3; c++) {
        connPax[c] += e.pax[c];
        connRev[c] += e.pax[c] * e.fare[c];
      }
    }
  }

  const pax: Triple = [0, 0, 0];
  const conn: Triple = [0, 0, 0];
  const connFare: Triple = [0, 0, 0];
  let seatsTotal = 0;
  let paxTotal = 0;
  for (let c = 0; c < 3; c++) {
    // Local passengers board first; connections fill what is left.
    const local = freq > 0 ? expectedBoarded(mine[c] / freq, cabin[c]) : 0;
    conn[c] = freq > 0 ? Math.min(cabin[c] - local, expectedBoarded(connPax[c] / freq, cabin[c])) : 0;
    connFare[c] = connPax[c] > 0 ? connRev[c] / connPax[c] : m.ref[c] * 0.6;
    pax[c] = local + conn[c];
    seatsTotal += cabin[c];
    paxTotal += pax[c];
  }
  let totalY = 0;
  for (const s of split) totalY += s[0];
  return {
    dist: m.dist,
    blockMinutes: blockMinutes(typeId, m.dist),
    freq,
    demand: [m.demand[0], m.demand[1], m.demand[2]],
    ref: m.ref,
    pax,
    conn,
    connFare,
    seats: cabin,
    loadFactor: seatsTotal > 0 ? paxTotal / seatsTotal : 0,
    competitors,
    share: totalY > 0 ? mine[0] / totalY : 0,
  };
}
