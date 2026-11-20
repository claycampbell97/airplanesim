// Passenger demand and fare model.
//
// Who wants to fly where. Demand between two airports starts from how much the two
// countries travel between each other: the holiday flows, family ties, shared
// languages and trade that put ten times as many people on a plane from Britain to
// Spain as to Japan. Those country ties are fitted to real travel volumes
// (scripts/corridors-curated.txt, `npm run data:ties`). Within a pair of countries
// the traffic is shared out between airports by their size, how far apart they
// are, whether they are gateways, resorts or business centres, and whether a train
// would do the job instead.
//
// Everything here is a pure function of static airport data; time-varying effects
// (season, economy, events) are applied on top by market.ts.

import { AIRPORT, AIRPORTS, COUNTRIES, airportDistance } from './data/airports';
import type { Country } from './data/airports';
import { DOMESTIC_FIT, TIE_FIT } from './data/ties.generated';
import type { Airport, AirportId, RegionId, Triple } from './types';

/** Latent demand relative to observed traffic: people who would fly given a convenient non-stop. */
export const LATENT_DEMAND = 1.25;

/** Annual demand growth by region (the world's centre of gravity keeps moving east and south). */
export const REGION_GROWTH: Record<RegionId, number> = {
  NAM: 0.022, EUR: 0.022, OCE: 0.026, LAM: 0.032, MEA: 0.038, EAS: 0.036, SEA: 0.042, AFR: 0.045, SCA: 0.05,
};

/** The numbers that shape the model. Exported so that the calibration harness can try others. */
export const MODEL = {
  /** How steeply traffic grows with the size of the two airports. */
  mass: 0.9,
  massDomestic: 1.0,
  /** How fast traffic falls away with distance beyond the first few hundred kilometres. */
  decay: 0.8,
  decayDomestic: 0.45,
  /** Small places look to what is near: this much is added to the decay at the smallest airports. */
  decaySmall: 0.8,
  decaySmallDomestic: 1.0,
  /** Extra pull between a small airport and the nearest city big enough to be its regional centre. */
  regional: 2,
  /** Extra pull between a resort and the places its visitors come from. */
  resort: 3.0,
  /** How much more readily people from cold, high latitudes fly off to the sun. */
  sunSeekers: 1.5,
  /** How strongly an airport's outward-looking character shapes its short routes abroad (long ones in full). */
  outward: 0.6,
  /** Distance within which traffic does not fall away at all, km. */
  near: 350,
  /** Extra traffic between two centres of business. */
  business: 0.8,
  /** Tie between two airports of one country, before fitting (1 = two countries in the same bloc). */
  domestic: 4,
  /** A shared language or history multiplies the tie between two countries. */
  sphere: 2.2,
  /** Passes of the balancing that makes each airport's traffic add up. */
  balancing: 40,
};

/** Default tie between two countries of the same bloc. */
const BLOC_TIE: Record<string, number> = {
  EU: 1, NA: 1, CN: 1.5, GCC: 1.5, ASEAN: 1, ANZ: 2, CIS: 1, ARAB: 0.8, EAFR: 0.8, SADC: 0.8,
  LATAM: 0.6, SAARC: 0.6, WAFR: 0.6, CAFR: 0.6, BALK: 0.6, PAC: 0.5, CARIB: 0.4,
};

/** Regions close enough for people to hop between without it being an expedition. */
const NEIGHBOURS = new Set(['EUR-MEA', 'AFR-EUR', 'AFR-MEA', 'MEA-SCA', 'SCA-SEA', 'EAS-SCA', 'EAS-SEA', 'OCE-SEA', 'LAM-NAM']);

/** London and the cities the Channel Tunnel trains run to. */
const TUNNEL_BRITISH = new Set(['LHR', 'LGW', 'LCY', 'STN', 'LTN']);
const TUNNEL_CONTINENTAL = new Set(['CDG', 'ORY', 'BRU']);

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Key of an unordered pair of countries in the fitted ties. */
export function tieKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** How closely two countries are tied before any fitting: blocs, regions, languages and incomes. */
export function defaultTie(a: Country, b: Country): number {
  if (a.iso === b.iso) return MODEL.domestic;
  let t: number;
  if (a.bloc && a.bloc === b.bloc) t = BLOC_TIE[a.bloc] ?? 0.8;
  else if (a.region === b.region) t = 0.5;
  else if (NEIGHBOURS.has(a.region < b.region ? `${a.region}-${b.region}` : `${b.region}-${a.region}`)) t = 0.3;
  else t = 0.15;
  if (a.spheres.some((s) => b.spheres.includes(s))) t *= MODEL.sphere;
  // People cross borders more the richer they are.
  return t * a.wealth * b.wealth;
}

/** What `npm run data:ties` fits to the curated travel volumes: multipliers on the defaults. */
export interface TieTable {
  /** On the tie between two countries, by `tieKey`. */
  pair: Record<string, number>;
  /** On the tie between two airports of one country, by country. */
  domestic: Record<string, number>;
}

/** How well surface travel competes at an airport: its country's grade, with one exception. */
function surfaceOf(a: Airport): 'H' | 'N' | 'P' {
  // China's fast trains are a matter of the east: the mountains of Yunnan, Tibet,
  // Qinghai and Xinjiang are still crossed by air.
  if (a.country === 'CN' && a.lon < 103.5) return 'P';
  return COUNTRIES[a.country].surface;
}

/** Share of the trip market left to the air once road, rail and ferries have had theirs. */
export function airShare(a: Airport, b: Airport, dist: number): number {
  if (a.land !== b.land) {
    if ((TUNNEL_BRITISH.has(a.id) && TUNNEL_CONTINENTAL.has(b.id)) || (TUNNEL_BRITISH.has(b.id) && TUNNEL_CONTINENTAL.has(a.id))) return 0.2;
    // Across water only a short ferry crossing competes.
    return smoothstep(40, 180, dist);
  }
  const sa = surfaceOf(a);
  const sb = surfaceOf(b);
  // Poor roads and rails at either end leave the field to the air; fast trains need both ends.
  if (sa === 'P' || sb === 'P') return smoothstep(60, 320, dist);
  if (sa === 'H' && sb === 'H') return smoothstep(220, 900, dist);
  return smoothstep(120, 620, dist);
}

/** 1 for a resort, less for a city that is partly a holiday destination, 0 otherwise. */
function resort(a: Airport): number {
  return a.leisure >= 0.8 ? 1 : a.leisure >= 0.5 ? 0.3 : 0;
}

/**
 * How readily an airport's own residents go on holiday from it: least from resorts
 * and business hubs, most from the cold north (and the far south).
 */
function holidaymakers(a: Airport): number {
  const sun = 1 + MODEL.sunSeekers * smoothstep(38, 52, Math.abs(a.lat));
  // Holidays abroad are for those who can afford them.
  const means = Math.max(0.15, Math.min(1.2, (a.wealth - 0.6) / 0.5));
  return (1 - 0.7 * resort(a)) * (a.businessCentre ? 0.7 : 1) * sun * means;
}

/**
 * 0 for a small airport that looks to its own region, 1 for a city with ties
 * everywhere. A resort draws its visitors from afar however small its airport.
 */
function reach(a: Airport): number {
  const r = Math.max(0, Math.min(1, (Math.log10(Math.max(a.mass, 0.01)) - 0.3) / 1.2));
  return Math.max(r, a.leisure >= 0.8 ? 0.9 : a.leisure >= 0.5 ? 0.6 : 0);
}

/** Everything about a pair of airports except the tie between their countries. */
function structure(a: Airport, b: Airport, dist: number): number {
  const domestic = a.home === b.home;
  let w = Math.pow(a.mass * b.mass, domestic ? MODEL.massDomestic : MODEL.mass);
  // Distance matters a lot to small places and much less between big cities. Abroad it is
  // the gateways that have ties everywhere: a big provincial airport flies to its neighbours.
  // (And the airports that migrant workers and their families fly from, however small.)
  const far = (x: Airport) => domestic ? reach(x)
    : Math.max(reach(x) * (x.leisure >= 0.8 || x.gateway === 1 ? 1 : x.gateway > 0.1 ? 0.7 : 0.4), 1 - 1 / (1 + x.outward));
  const local = 1 - Math.min(far(a), far(b));
  const decay = domestic ? MODEL.decayDomestic + MODEL.decaySmallDomestic * local : MODEL.decay + MODEL.decaySmall * local;
  w *= Math.pow(MODEL.near / Math.max(dist, MODEL.near), decay);
  w *= airShare(a, b, dist);

  if (!domestic) {
    const long = smoothstep(3500, 6500, dist);
    // Some airports look abroad and some look inland: Kennedy and Denver, Narita and Itami.
    // It tells most on long flights; a holiday or a hop over the border starts anywhere.
    w *= Math.pow(a.outward * b.outward, MODEL.outward + (1 - MODEL.outward) * long);
    // Long-haul traffic between two countries funnels through their gateways. A resort is a
    // gateway in its own right, and holiday flights to it leave from all sorts of places.
    const ga = a.leisure >= 0.8 ? 1 : b.leisure >= 0.8 ? Math.sqrt(a.gateway) : a.gateway;
    const gb = b.leisure >= 0.8 ? 1 : a.leisure >= 0.8 ? Math.sqrt(b.gateway) : b.gateway;
    w *= 1 + long * (ga * gb - 1);
    // So does traffic between a rich country and a much poorer one, at the rich end:
    // it is mostly families visiting each other, and migrants settle in the big cities.
    // At the poor end the migrants come from the provinces as much as from the capital.
    const rich = a.wealth >= b.wealth ? a : b;
    const poor = rich === a ? b : a;
    const migrant = smoothstep(1.25, 1.6, rich.wealth / poor.wealth);
    w *= (1 + 0.6 * migrant * (rich.gateway - 1)) * Math.pow(Math.max(poor.mass, 0.5), -0.3 * migrant);
  }

  // Resorts are filled by the cities within holiday range; nobody flies from one beach to another.
  const ra = resort(a);
  const rb = resort(b);
  if (ra > 0 || rb > 0) {
    const range = 1 - 0.6 * smoothstep(4500, 8000, dist);
    // (Neighbouring islands are another matter: people hop between them all the time.)
    w *= (1 + MODEL.resort * (rb * holidaymakers(a) + ra * holidaymakers(b)) * range) * (1 - (domestic ? 0.4 : 0.8) * ra * rb * smoothstep(250, 1200, dist));
  }

  w *= 1 + MODEL.business * (a.businessCentre ? 1 : 0.25) * (b.businessCentre ? 1 : 0.25);
  return w;
}

let structural: Float32Array | null = null;

/** The structural weights of every pair: they do not depend on the country ties, so they are worked out once. */
export function structuralWeights(): Float32Array {
  if (structural) return structural;
  const n = AIRPORTS.length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = structure(AIRPORTS[i], AIRPORTS[j], airportDistance(AIRPORTS[i].id, AIRPORTS[j].id));
      m[i * n + j] = w;
      m[j * n + i] = w;
    }
  }
  // A small airport leans on its regional centre: the nearest city of its own country that
  // is at least twice its size and worth flying to rather than driving.
  for (const a of AIRPORTS) {
    if (a.mass >= 10) continue;
    let centre: Airport | null = null;
    let nearest = Infinity;
    for (const b of AIRPORTS) {
      if (b.home !== a.home || b.mass < 2 * a.mass) continue;
      const dist = airportDistance(a.id, b.id);
      if (dist < nearest && dist < 2600 && airShare(a, b, dist) > 0.3) {
        nearest = dist;
        centre = b;
      }
    }
    if (!centre) continue;
    const boost = 1 + MODEL.regional * (1 - a.mass / 10);
    m[a.index * n + centre.index] *= boost;
    m[centre.index * n + a.index] *= boost;
  }
  return (structural = m);
}

/** Forgets the cached weights (after the model's numbers have been changed by the calibration harness). */
export function resetDemand(): void {
  structural = null;
  matrix = null;
}

/**
 * Builds the full origin–destination matrix: structural weights times country
 * ties, then balanced (iterative proportional fitting) so that the demand touching
 * each airport adds up to what a place of its size really generates. This keeps
 * remote islands and small markets honest: all their traffic lands on the few
 * routes they have.
 */
export function buildDemandMatrix(ties: TieTable = { pair: TIE_FIT, domestic: DOMESTIC_FIT }): Float32Array {
  const n = AIRPORTS.length;
  const m = new Float32Array(structuralWeights());

  // Country ties, looked up once per pair of countries.
  const homes = [...new Set(AIRPORTS.map((a) => a.home))];
  const homeIndex = new Map(homes.map((h, i) => [h, i]));
  const tie = new Float32Array(homes.length * homes.length);
  for (let x = 0; x < homes.length; x++) {
    for (let y = x; y < homes.length; y++) {
      const fit = x === y ? ties.domestic[homes[x]] ?? 1 : ties.pair[tieKey(homes[x], homes[y])] ?? 1;
      const t = defaultTie(COUNTRIES[homes[x]], COUNTRIES[homes[y]]) * fit;
      tie[x * homes.length + y] = t;
      tie[y * homes.length + x] = t;
    }
  }
  const home = AIRPORTS.map((a) => homeIndex.get(a.home)!);
  for (let i = 0; i < n; i++) {
    const row = i * n;
    const hi = home[i] * homes.length;
    for (let j = 0; j < n; j++) m[row + j] *= tie[hi + home[j]];
  }

  // Daily one-way local passengers a city would generate with ideal service.
  const target = AIRPORTS.map((a) => (LATENT_DEMAND * a.mass * 1e6) / 730);
  const scale = new Float64Array(n);
  for (let iter = 0; iter < MODEL.balancing; iter++) {
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

let matrix: Float32Array | null = null;

/**
 * Passengers per day wanting to fly one way between two airports, all classes,
 * at reference fares with ample service. Symmetric.
 */
export function baseDemand(aId: AirportId, bId: AirportId): number {
  if (aId === bId) return 0;
  matrix ??= buildDemandMatrix();
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
