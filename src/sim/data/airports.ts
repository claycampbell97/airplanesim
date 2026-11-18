import { AIRPORT_ROWS, COUNTRY_ROWS } from './airports.generated';
import { latLonToVec, distanceKm } from '../geo';
import type { Airport, AirportId, RegionId } from '../types';

interface Country {
  iso: string;
  name: string;
  region: RegionId;
  wealth: number;
  bloc: string;
  parent: string;
}

export const COUNTRIES: Record<string, Country> = {};
for (const [iso, name, region, wealth, bloc, parent] of COUNTRY_ROWS) {
  COUNTRIES[iso] = { iso, name, region: region as RegionId, wealth, bloc, parent };
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

export const AIRPORTS: Airport[] = AIRPORT_ROWS.map((row, index) => {
  const [id, icao, name, city, iso, lat, lon, elev, runway, pax, transfer, flags] = row;
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
    leisure,
    winterSun: flags.includes('W'),
    slotLimited: flags.includes('S'),
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
