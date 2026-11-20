import { AIRPORT_ROWS, COUNTRY_ROWS } from './airports.generated';
import { latLonToVec, distanceKm } from '../geo';
import type { Airport, AirportId, RegionId } from '../types';

export interface Country {
  iso: string;
  name: string;
  region: RegionId;
  wealth: number;
  bloc: string;
  parent: string;
  /** Language and historical spheres the country belongs to. */
  spheres: string[];
  /** How well surface travel competes on short trips: fast trains, ordinary, or poor. */
  surface: 'H' | 'N' | 'P';
  /** Share of the country's airport passengers flying within it (-1 where not given). */
  domestic: number;
}

export const COUNTRIES: Record<string, Country> = {};
for (const [iso, name, region, wealth, bloc, parent, spheres, surface, domestic] of COUNTRY_ROWS) {
  COUNTRIES[iso] = {
    iso, name, region: region as RegionId, wealth, bloc, parent,
    spheres: spheres ? spheres.split(',') : [], surface: surface as Country['surface'], domestic,
  };
}

export const REGION_NAMES: Record<RegionId, string> = {
  NAM: 'North America',
  LAM: 'Latin America',
  EUR: 'Europe',
  MEA: 'Middle East',
  AFR: 'Africa',
  SCA: 'South & Central Asia',
  EAS: 'East Asia',
  SEA: 'South-East Asia',
  OCE: 'Oceania',
};

function tierOf(pax: number): Airport['tier'] {
  if (pax >= 45) return 5;
  if (pax >= 20) return 4;
  if (pax >= 8) return 3;
  if (pax >= 2.5) return 2;
  return 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Gateway weight of a secondary gateway, and of an airport that is not one at all. */
const SECONDARY_GATEWAY = 0.5;
const NOT_A_GATEWAY = 0.12;

// Each country's busiest airport is its gateway whether or not it is marked as one.
const busiest: Record<string, { id: string; mass: number }> = {};
for (const row of AIRPORT_ROWS) {
  const mass = row[9] * (1 - row[10]);
  if (!busiest[row[4]] || mass > busiest[row[4]].mass) busiest[row[4]] = { id: row[0], mass };
}

// How outward-looking each airport is next to its country as a whole, from the curated
// shares of passengers flying within the country.
const homeOf = (iso: string) => COUNTRIES[iso].parent || iso;
const inland: Record<string, { mass: number; domestic: number; airports: number }> = {};
const shareOf = (row: (typeof AIRPORT_ROWS)[number]) => (row[12] >= 0 ? row[12] : Math.max(0, COUNTRIES[homeOf(row[4])].domestic));
for (const row of AIRPORT_ROWS) {
  const c = (inland[homeOf(row[4])] ??= { mass: 0, domestic: 0, airports: 0 });
  const mass = row[9] * (1 - row[10]);
  c.mass += mass;
  c.domestic += mass * shareOf(row);
  c.airports += 1;
}
const odds = (p: number) => Math.max(0.003, Math.min(0.997, p)) / (1 - Math.max(0.003, Math.min(0.997, p)));
function outwardOf(row: (typeof AIRPORT_ROWS)[number]): number {
  const c = inland[homeOf(row[4])];
  if (c.airports < 2 || c.domestic <= 0) return 1;
  return odds(1 - shareOf(row)) / odds(1 - c.domestic / c.mass);
}

/**
 * Share of a country's airport passengers flying within it, as its airports' curated
 * shares add up: but no airport can send its neighbours more domestic passengers
 * than they are prepared to take between them (the capital of a country whose
 * provincial airports are mostly missing from the game has fewer places to fly to).
 */
export function domesticShare(home: string): number {
  const c = inland[home];
  if (!c || c.airports < 2) return 0;
  let total = 0;
  for (const row of AIRPORT_ROWS) {
    if (homeOf(row[4]) !== home) continue;
    const own = row[9] * (1 - row[10]) * shareOf(row);
    total += Math.min(own, 0.9 * (c.domestic - own));
  }
  return total / c.mass;
}

export const AIRPORTS: Airport[] = AIRPORT_ROWS.map((row, index) => {
  const [id, icao, name, city, iso, lat, lon, elev, runway, pax, transfer, flags, , land] = row;
  const c = COUNTRIES[iso];
  const strongLeisure = flags.includes('T');
  const someLeisure = flags.includes('t');
  const biz = flags.includes('B');
  const leisure = strongLeisure ? 0.8 : someLeisure ? 0.5 : 0.25;
  const business = clamp(0.24 + (biz ? 0.2 : 0) - (strongLeisure ? 0.16 : someLeisure ? 0.07 : 0) + (c.wealth - 0.85) * 0.25, 0.05, 0.6);
  return {
    id,
    index,
    icao,
    name,
    city,
    country: iso,
    countryName: c.name,
    home: c.parent || iso,
    region: c.region,
    bloc: c.bloc,
    lat,
    lon,
    elev,
    runway,
    effRunway: Math.round(runway / (1 + Math.max(0, elev) / 8000)),
    pax,
    // Connecting passengers never leave the terminal, so they do not count as local demand.
    mass: pax * (1 - transfer),
    tier: tierOf(pax),
    business,
    businessCentre: biz,
    leisure,
    winterSun: flags.includes('W'),
    slotLimited: flags.includes('S'),
    gateway: flags.includes('G') || busiest[iso].id === id ? 1 : flags.includes('g') ? SECONDARY_GATEWAY : NOT_A_GATEWAY,
    land,
    outward: outwardOf(row),
    wealth: c.wealth,
    pos: latLonToVec(lat, lon),
  };
});

export const AIRPORT: Record<AirportId, Airport> = {};
for (const a of AIRPORTS) AIRPORT[a.id] = a;

export function airport(id: AirportId): Airport {
  return AIRPORT[id];
}

export function pairKey(a: AirportId, b: AirportId): string {
  return a < b ? a + b : b + a;
}

let distances: Float32Array | null = null;

function buildDistances(): Float32Array {
  const n = AIRPORTS.length;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const km = distanceKm(AIRPORTS[i].pos, AIRPORTS[j].pos);
      d[i * n + j] = km;
      d[j * n + i] = km;
    }
  }
  return d;
}

/** Great-circle distance between two airports in km. */
export function airportDistance(a: AirportId, b: AirportId): number {
  distances ??= buildDistances();
  return distances[AIRPORT[a].index * AIRPORTS.length + AIRPORT[b].index];
}

/** Stable numeric key for an unordered airport pair. */
export function pairIndex(a: AirportId, b: AirportId): number {
  const i = AIRPORT[a].index;
  const j = AIRPORT[b].index;
  return i < j ? i * AIRPORTS.length + j : j * AIRPORTS.length + i;
}

export const TIER_NAMES = ['', 'Regional', 'Secondary', 'Major', 'International', 'Mega hub'];
