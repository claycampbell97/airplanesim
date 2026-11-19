// Passenger demand and fare model.
//
// Demand between two airports follows a gravity model: it grows with the local
// traffic "mass" of both ends, falls off gently with distance, and is shaped by
// how closely the two countries are tied together. Everything here is a pure
// function of static airport data; time-varying effects (season, economy, events)
// are applied on top by market.ts.

import { AIRPORT, AIRPORTS, airportDistance, pairKey } from './data/airports';
import { hash01 } from './rng';
import type { Airport, AirportId, RegionId, Triple } from './types';

/** Latent demand relative to observed traffic: people who would fly given a convenient non-stop. */
const LATENT_DEMAND = 1.25;

/** Travel affinity between two countries in the same bloc (1 = like domestic). */
const BLOC_AFFINITY: Record<string, number> = {
  EU: 0.7, NA: 0.6, CN: 1.0, GCC: 0.9, ASEAN: 0.9, ANZ: 1.0, CARIB: 0.6, LATAM: 0.8,
  CIS: 0.7, SAARC: 0.7, EAFR: 0.9, WAFR: 0.9, CAFR: 0.8, SADC: 0.9, ARAB: 0.8, BALK: 0.6, PAC: 0.8,
};

/** Annual demand growth by region (the world's centre of gravity keeps moving east and south). */
export const REGION_GROWTH: Record<RegionId, number> = {
  NAM: 0.022, EUR: 0.022, OCE: 0.026, LAM: 0.032, MEA: 0.038, EAS: 0.036, SEA: 0.042, AFR: 0.045, SCA: 0.05,
};

// Total local mass per home country, used to boost the trunk routes of countries
// whose traffic is concentrated in a handful of cities (Sydney–Melbourne, Tokyo–Sapporo).
const countryMass: Record<string, number> = {};
for (const a of AIRPORTS) countryMass[a.home] = (countryMass[a.home] ?? 0) + a.mass;

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** 0..1: how global a city's travel ties are. Small towns fly to their region, world cities fly everywhere. */
function reach(a: Airport): number {
  const r = Math.max(0, Math.min(1, (Math.log10(Math.max(a.mass, 0.01)) - 0.3) / 1.5));
  // Resorts draw visitors from far away however small the airport is.
  return a.leisure > 0.7 ? Math.max(r, 0.55) : r;
}

function affinity(a: Airport, b: Airport): number {
  if (a.home === b.home) {
    const share = (a.mass + b.mass) / countryMass[a.home];
    const boost = 1 + 4 * Math.pow(share, 1.1);
    // Europe's domestic trunks compete with high-speed rail.
    return Math.min(boost, a.region === 'EUR' ? 1.4 : 3);
  }
  if (a.bloc && a.bloc === b.bloc) return BLOC_AFFINITY[a.bloc] ?? 0.6;
  if (a.region === b.region) return 0.6;
  // Intercontinental traffic concentrates on gateway airports.
  const lo = Math.min(a.tier, b.tier);
  const hi = Math.max(a.tier, b.tier);
  let gateway = lo >= 5 ? 2.6 : hi >= 5 && lo >= 4 ? 1.7 : lo >= 4 ? 1.1 : lo >= 3 ? 0.65 : 0.35;
  // ...except for resorts, which are fed by whichever big city is on the other end.
  if (a.leisure > 0.7 || b.leisure > 0.7) gateway = Math.max(gateway, hi >= 5 ? 1.5 : hi >= 4 ? 1.0 : 0.6);
  return 0.45 * gateway;
}

/** Raw gravity weight between two airports, before balancing. */
function gravity(a: Airport, b: Airport): number {
  const dist = airportDistance(a.id, b.id);
  let d = Math.pow(a.mass * b.mass, 0.8);
  // Very short hops lose to road and rail.
  d *= smoothstep(80, 420, dist);
  // Distance matters a lot between small places and hardly at all between world cities.
  const decay = 1.1 - 0.8 * Math.sqrt(reach(a) * reach(b));
  d *= Math.pow(1000 / Math.max(dist, 1000), decay);
  d *= affinity(a, b);

  // Nobody flies from one beach resort to another; cities feed the resorts within reach.
  const resortA = a.leisure > 0.7;
  const resortB = b.leisure > 0.7;
  if (resortA && resortB) d *= 0.3;
  else if (resortA || resortB) d *= dist < 5500 ? 1.25 : 0.55;

  // Every market has its own character: diaspora, trade links, rivalries. Far-flung
  // pairs vary the most — some world cities are closely tied, others barely at all.
  const h = hash01(pairKey(a.id, b.id));
  d *= a.region === b.region ? 0.65 + 0.9 * Math.pow(h, 1.5) : 0.3 + 1.7 * h * h;
  return d;
}

let matrix: Float32Array | null = null;

/**
 * Builds the full origin–destination matrix. The raw gravity weights are balanced
 * (iterative proportional fitting) so that the demand touching each airport adds
 * up to what a city of its size really generates. This keeps remote islands
 * and small markets honest: all their traffic lands on the few routes they have.
 */
function buildMatrix(): Float32Array {
  const n = AIRPORTS.length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = gravity(AIRPORTS[i], AIRPORTS[j]);
      m[i * n + j] = w;
      m[j * n + i] = w;
    }
  }
  // Daily one-way local passengers a city would generate with ideal service.
  const target = AIRPORTS.map((a) => (LATENT_DEMAND * a.mass * 1e6) / 730);
  const scale = new Float64Array(n);
  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const row = i * n;
      for (let j = 0; j < n; j++) sum += m[row + j];
      scale[i] = sum > 0 ? Math.sqrt(target[i] / sum) : 1;
    }
    for (let i = 0; i < n; i++) {
      const row = i * n;
      const si = scale[i];
      for (let j = 0; j < n; j++) m[row + j] *= si * scale[j];
    }
  }
  return m;
}

/**
 * Passengers per day wanting to fly one way between two airports, all classes,
 * at reference fares with ample service. Symmetric.
 */
export function baseDemand(aId: AirportId, bId: AirportId): number {
  if (aId === bId) return 0;
  matrix ??= buildMatrix();
  return matrix[AIRPORT[aId].index * AIRPORTS.length + AIRPORT[bId].index];
}

/** 0..1 business character of a city pair. */
export function businessScore(a: Airport, b: Airport): number {
  return (a.business + b.business) / 2;
}

/** 0..1 leisure character of a city pair (the more leisure-heavy end dominates). */
export function leisureScore(a: Airport, b: Airport): number {
  return Math.max(a.leisure, b.leisure) * 0.7 + Math.min(a.leisure, b.leisure) * 0.3;
}

/** Share of demand travelling in each cabin class. */
export function classSplit(aId: AirportId, bId: AirportId): Triple {
  const a = AIRPORT[aId];
  const b = AIRPORT[bId];
  const dist = airportDistance(aId, bId);
  const biz = businessScore(a, b);
  const j = Math.max(0.03, Math.min(0.2, 0.03 + 0.22 * biz + (dist > 3000 ? 0.02 : 0)));
  const f = dist > 2500 ? Math.max(0.003, Math.min(0.02, 0.03 * biz)) : 0.0015;
  return [1 - j - f, j, f];
}

/** One-way reference fares per class: what the market considers a fair price. */
export function refFare(aId: AirportId, bId: AirportId): Triple {
  const a = AIRPORT[aId];
  const b = AIRPORT[bId];
  const dist = airportDistance(aId, bId);
  // Fares track local incomes only weakly: thin supply keeps prices up in poorer markets.
  const wealth = Math.pow(a.wealth * b.wealth, 0.15);
  // Thin markets command a premium: they are flown by small, expensive aircraft and
  // travellers have few alternatives. Dense trunk routes are priced to the bone.
  const demand = baseDemand(aId, bId);
  const thinness = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(demand, 1) / 60) / 1.2));
  // The premium is a short-haul phenomenon; on long thin routes people simply connect instead.
  const thin = 1 + 0.6 * thinness * Math.max(0, Math.min(1, (3200 - dist) / 2200));
  const y = (26 + 0.31 * Math.pow(dist, 0.78)) * wealth * thin * (0.94 + 0.3 * businessScore(a, b));
  return [y, y * (2.4 + Math.min(1.4, dist / 5000)), y * (4 + Math.min(3, dist / 3500))];
}

/**
 * How demand responds to price. `x` is price / reference fare; returns a
 * multiplier (1 at the reference fare). Leisure travellers are far more price
 * sensitive than business and first class.
 */
export function priceResponse(cls: number, x: number, leisure: number, business: number): number {
  const e = cls === 0 ? 3 + 1.2 * leisure - 0.8 * business : cls === 1 ? 2.2 : 1.8;
  return 2 / (1 + Math.pow(Math.max(0.05, x), e));
}

/** Share of the potential market that actually travels, given total daily departures. */
export function frequencyCapture(freq: number): number {
  return freq <= 0 ? 0 : freq / (freq + 0.6);
}

/** Seasonal multiplier for one airport. `yearFrac` is 0 at 1 January. */
export function seasonOf(a: Airport, yearFrac: number): number {
  const tropical = Math.abs(a.lat) < 15;
  const amp = (0.04 + 0.26 * a.leisure) * (tropical && !a.winterSun ? 0.4 : 1);
  const peak = a.winterSun || a.lat < -15 ? 0.04 : 0.56;
  return 1 + amp * Math.cos(2 * Math.PI * (yearFrac - peak));
}

/** Seasonal multiplier for a city pair; the leisure end sets the rhythm. */
export function seasonFactor(aId: AirportId, bId: AirportId, yearFrac: number): number {
  const a = AIRPORT[aId];
  const b = AIRPORT[bId];
  const wa = a.leisure / (a.leisure + b.leisure);
  return Math.pow(seasonOf(a, yearFrac), wa) * Math.pow(seasonOf(b, yearFrac), 1 - wa);
}

/** Long-run growth multiplier for a city pair after `years`. */
export function growthFactor(aId: AirportId, bId: AirportId, years: number): number {
  const rate = (REGION_GROWTH[AIRPORT[aId].region] + REGION_GROWTH[AIRPORT[bId].region]) / 2;
  return Math.exp(rate * years);
}

/** Strongest markets from an airport, by base demand. */
export function topMarkets(from: AirportId, count: number, filter?: (a: Airport) => boolean): { airport: Airport; demand: number; dist: number }[] {
  const out: { airport: Airport; demand: number; dist: number }[] = [];
  for (const a of AIRPORTS) {
    if (a.id === from || (filter && !filter(a))) continue;
    out.push({ airport: a, demand: baseDemand(from, a.id), dist: airportDistance(from, a.id) });
  }
  out.sort((x, y) => y.demand - x.demand);
  return out.slice(0, count);
}

/**
 * Bookings for one departure vary by this much either side of the average, which is
 * why an airline that prices to fill every seat on average still flies with some empty.
 */
export const BOOKING_SWING = 0.35;

/**
 * Passengers boarded per flight on average when `demand` people want each flight
 * and there are `seats`: a flight sized exactly to its average demand leaves seats
 * empty on quiet days and people behind on busy ones.
 */
export function expectedBoarded(demand: number, seats: number): number {
  if (seats <= 0 || demand <= 0) return 0;
  const lo = 1 - BOOKING_SWING;
  const hi = 1 + BOOKING_SWING;
  if (demand * hi <= seats) return demand;
  if (demand * lo >= seats) return seats;
  const u = seats / demand;
  return (demand * (u * u - lo * lo) * 0.5 + seats * (hi - u)) / (hi - lo);
}
