#!/usr/bin/env node
// Builds src/sim/data/airports.generated.ts from
//   - scripts/airports-curated.txt   (which airports exist in the game + balance inputs)
//   - scripts/countries-curated.txt  (country attributes)
//   - OurAirports CSV dumps          (public-domain coordinates, names, elevations, runways)
//
//   - Natural Earth 1:10m land   (public domain, via world-atlas: which landmass each airport is on)
//
// Usage:  node scripts/build-airports.mjs [dir-with-ourairports-csv]
// Without a directory the CSVs are downloaded from the OurAirports GitHub mirror.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SOURCE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/';

async function loadCsv(name, dir) {
  if (dir && existsSync(join(dir, name))) return readFile(join(dir, name), 'utf8');
  const res = await fetch(SOURCE + name);
  if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status}`);
  return res.text();
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, embedded newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function parseTable(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/));
}

// Display-name clean-ups: shorter labels read better on the globe.
const CITY_OVERRIDES = {
  JFK: 'New York', LGA: 'New York', EWR: 'Newark', LHR: 'London', LGW: 'London', STN: 'London',
  LTN: 'London', LCY: 'London', NRT: 'Tokyo', HND: 'Tokyo', ICN: 'Seoul', GMP: 'Seoul',
  CDG: 'Paris', ORY: 'Paris', MXP: 'Milan', LIN: 'Milan', BGY: 'Bergamo', FCO: 'Rome',
  KIX: 'Osaka', ITM: 'Osaka', PVG: 'Shanghai', SHA: 'Shanghai', PEK: 'Beijing', PKX: 'Beijing',
  TPE: 'Taipei', TSA: 'Taipei', BKK: 'Bangkok', DMK: 'Bangkok', CGK: 'Jakarta', DPS: 'Bali',
  GRU: 'São Paulo', CGH: 'São Paulo', VCP: 'Campinas', GIG: 'Rio de Janeiro', SDU: 'Rio de Janeiro',
  EZE: 'Buenos Aires', AEP: 'Buenos Aires', IAD: 'Washington', DCA: 'Washington', BWI: 'Baltimore',
  ORD: 'Chicago', MDW: 'Chicago', DFW: 'Dallas', DAL: 'Dallas', IAH: 'Houston', HOU: 'Houston',
  SVO: 'Moscow', DME: 'Moscow', VKO: 'Moscow', IST: 'Istanbul', SAW: 'Istanbul', YYZ: 'Toronto',
  YTZ: 'Toronto', YUL: 'Montréal', MEX: 'Mexico City', DXB: 'Dubai', KUL: 'Kuala Lumpur',
  MNL: 'Manila', SGN: 'Ho Chi Minh City', HAN: 'Hanoi', DEL: 'Delhi', BOM: 'Mumbai',
  BLR: 'Bengaluru', MAA: 'Chennai', CCU: 'Kolkata', TFU: 'Chengdu', CTU: 'Chengdu',
  NGO: 'Nagoya', CTS: 'Sapporo', OKA: 'Okinawa', FUK: 'Fukuoka', PUS: 'Busan', CJU: 'Jeju',
  SIN: 'Singapore', HKG: 'Hong Kong', MFM: 'Macau', DOH: 'Doha', AUH: 'Abu Dhabi',
  TLV: 'Tel Aviv', CAI: 'Cairo', JNB: 'Johannesburg', CPT: 'Cape Town', LOS: 'Lagos',
  SYD: 'Sydney', MEL: 'Melbourne', AKL: 'Auckland', OOL: 'Gold Coast', HNL: 'Honolulu',
  OGG: 'Maui', KOA: 'Kona', LIH: 'Kauai', SJU: 'San Juan', CUN: 'Cancún', PUJ: 'Punta Cana',
  MBJ: 'Montego Bay', SXM: 'St Maarten', PPT: 'Tahiti', NAN: 'Nadi', MLE: 'Malé',
  MRU: 'Mauritius', SEZ: 'Seychelles', RUN: 'Réunion', KEF: 'Reykjavík', BSL: 'Basel',
  ZRH: 'Zurich', GVA: 'Geneva', MUC: 'Munich', FRA: 'Frankfurt', CGN: 'Cologne', DUS: 'Düsseldorf',
  CPH: 'Copenhagen', ARN: 'Stockholm', OSL: 'Oslo', HEL: 'Helsinki', WAW: 'Warsaw', PRG: 'Prague',
  VIE: 'Vienna', BUD: 'Budapest', OTP: 'Bucharest', ATH: 'Athens', LIS: 'Lisbon', OPO: 'Porto',
  BRU: 'Brussels', CRL: 'Charleroi', AMS: 'Amsterdam', LED: 'St Petersburg', KBP: 'Kyiv',
  TFS: 'Tenerife', LPA: 'Gran Canaria', PMI: 'Palma de Mallorca', AGP: 'Málaga', ACE: 'Lanzarote',
  FUE: 'Fuerteventura', FNC: 'Madeira', PDL: 'Azores', HER: 'Heraklion', JTR: 'Santorini',
  JMK: 'Mykonos', CFU: 'Corfu', RHO: 'Rhodes', CHQ: 'Chania', HKT: 'Phuket', USM: 'Koh Samui',
  LGK: 'Langkawi', LOP: 'Lombok', MPH: 'Boracay', CXR: 'Nha Trang', PQC: 'Phu Quoc', SAI: 'Siem Reap',
  HRG: 'Hurghada', SSH: 'Sharm el-Sheikh', ZNZ: 'Zanzibar', JRO: 'Kilimanjaro', VFA: 'Victoria Falls',
  LVI: 'Livingstone', IPC: 'Easter Island', GPS: 'Galápagos', USH: 'Ushuaia', CUZ: 'Cusco',
  LYR: 'Svalbard', GOH: 'Nuuk', FAE: 'Faroe Islands', HLE: 'St Helena', AYQ: 'Uluru',
  PBH: 'Paro', IXL: 'Leh', LXA: 'Lhasa', KTM: 'Kathmandu', GUM: 'Guam', SPN: 'Saipan',
  ROR: 'Palau', RAR: 'Rarotonga', BOB: 'Bora Bora', NOU: 'Nouméa', BDA: 'Bermuda',
  GCM: 'Grand Cayman', AUA: 'Aruba', CUR: 'Curaçao', BGI: 'Barbados', ANU: 'Antigua',
  UVF: 'St Lucia', PTP: 'Guadeloupe', FDF: 'Martinique', STT: 'St Thomas', NAS: 'Nassau',
  SID: 'Sal', RAI: 'Praia', ADZ: 'San Andrés', IGU: 'Foz do Iguaçu', IGR: 'Iguazú',
  BRC: 'Bariloche', TIV: 'Tivat', DBV: 'Dubrovnik', SPU: 'Split', AER: 'Sochi',
  AYT: 'Antalya', DLM: 'Dalaman', BJV: 'Bodrum', ADB: 'İzmir', ESB: 'Ankara', NQZ: 'Astana',
  ALA: 'Almaty', TAS: 'Tashkent', SKD: 'Samarkand', UBN: 'Ulaanbaatar', DSS: 'Dakar',
  ABJ: 'Abidjan', ACC: 'Accra', ADD: 'Addis Ababa', NBO: 'Nairobi', DAR: 'Dar es Salaam',
  EBB: 'Entebbe', KGL: 'Kigali', CMN: 'Casablanca', RAK: 'Marrakech', ALG: 'Algiers',
  TUN: 'Tunis', PTY: 'Panama City', SJO: 'San José', SAL: 'San Salvador', GUA: 'Guatemala City',
  BOG: 'Bogotá', MDE: 'Medellín', LIM: 'Lima', SCL: 'Santiago', UIO: 'Quito', GYE: 'Guayaquil',
  CCS: 'Caracas', MVD: 'Montevideo', ASU: 'Asunción', LPB: 'La Paz', VVI: 'Santa Cruz',
  BSB: 'Brasília', CNF: 'Belo Horizonte', POA: 'Porto Alegre', REC: 'Recife', SSA: 'Salvador',
  FOR: 'Fortaleza', CWB: 'Curitiba', FLN: 'Florianópolis', YVR: 'Vancouver', YYC: 'Calgary',
  YEG: 'Edmonton', YOW: 'Ottawa', YHZ: 'Halifax', YQB: 'Québec City', SNA: 'Orange County',
  OAK: 'Oakland', SJC: 'San Jose', FLL: 'Fort Lauderdale', PBI: 'West Palm Beach', RSW: 'Fort Myers',
  MSP: 'Minneapolis', DTW: 'Detroit', SEA: 'Seattle', CVG: 'Cincinnati', BDL: 'Hartford',
  RDU: 'Raleigh–Durham', JAC: 'Jackson Hole', ASE: 'Aspen', BZN: 'Bozeman', PSP: 'Palm Springs',
  FLR: 'Florence', XNN: 'Xining', CAN: 'Guangzhou',
  // Airports listed under the commune they stand in rather than the city they serve.
  EDI: 'Edinburgh', LYS: 'Lyon', VCE: 'Venice', NAP: 'Naples', DMM: 'Dammam', MRS: 'Marseille',
  GOI: 'Goa', KRK: 'Kraków', KNO: 'Medan', MLA: 'Malta', TIA: 'Tirana', ISB: 'Islamabad',
  TRN: 'Turin', SDJ: 'Sendai', MAH: 'Menorca', VRN: 'Verona', ZAG: 'Zagreb', CRK: 'Clark',
  PRN: 'Pristina', VVO: 'Vladivostok', SKP: 'Skopje', DJE: 'Djerba', EBL: 'Erbil', VRA: 'Varadero',
  LJU: 'Ljubljana', DJJ: 'Jayapura', CAY: 'Cayenne', MAJ: 'Majuro', TRW: 'Tarawa',
};

/** OurAirports municipalities sometimes carry districts or regions: "Inverness, Highland". */
function cleanCity(city) {
  return city.replace(/\s*\(.*?\)/g, '').replace(/,.*$/, '').replace(/\s*\/.*$/, '').trim();
}

const NAME_OVERRIDES = {
  BCN: 'Barcelona–El Prat', FCO: 'Rome Fiumicino', BLR: 'Kempegowda Intl', SCL: 'Arturo Merino Benítez Intl',
  BSB: 'Brasília Intl', GIG: 'Rio de Janeiro–Galeão', EZE: 'Ezeiza Intl', BSL: 'EuroAirport Basel–Mulhouse',
  HER: 'Heraklion Intl', SSA: 'Salvador Intl', TIA: 'Tirana Intl', RHO: 'Rhodes Intl', BPN: 'Sepinggan Intl',
  KOA: 'Kona Intl', SAL: 'El Salvador Intl', COR: 'Córdoba Intl', VTZ: 'Visakhapatnam Intl',
  MVD: 'Carrasco Intl', ORN: 'Oran Es-Sénia Intl', ASE: 'Aspen–Pitkin County',
};

function shortName(name) {
  return name
    .replace(/\s*\/.*$/, '')
    .replace(/\s+International Airport$/i, ' Intl')
    .replace(/\s+Airport$/i, '')
    .replace(/\s+Aerodrome$/i, '')
    .trim();
}

// ───────────── Landmasses ─────────────
//
// Two airports on the same landmass can be reached from one another by road or
// rail, which is what short flights compete with; across water they cannot.

/**
 * Airports that count as standing on the same land as another one, where a bridge,
 * tunnel or causeway joins what the coastline data shows as separate: X: 'Y' reads
 * "X is on the same land as Y".
 */
const SAME_LAND_AS = {
  JFK: 'EWR', LGA: 'EWR', YUL: 'YYZ', EYW: 'MIA', FLN: 'GRU', ICN: 'GMP', SIN: 'KUL', PEN: 'KUL',
  HKT: 'BKK', HKG: 'CAN', MFM: 'CAN', ZUH: 'CAN', XMN: 'CAN', CPH: 'FRA', TOS: 'OSL', BAH: 'RUH',
  DJE: 'TUN', KIX: 'HND', NGO: 'HND',
  // Kyushu: the Shinkansen runs through to Kagoshima.
  FUK: 'HND', KOJ: 'HND', KMJ: 'HND', NGS: 'HND',
};

async function loadLand() {
  const topo = JSON.parse(await readFile(require.resolve('world-atlas/land-10m.json'), 'utf8'));
  const land = feature(topo, topo.objects.land);
  const polys = [];
  for (const f of land.features ?? [land]) {
    const g = f.geometry;
    for (const raw of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
      // A ring that crosses the antimeridian jumps from +180 to -180: unwrap it so it is continuous.
      const rings = raw.map((ring) => {
        let shift = 0;
        const out = [ring[0]];
        for (let i = 1; i < ring.length; i++) {
          const d = ring[i][0] - ring[i - 1][0];
          if (d > 180) shift -= 360; else if (d < -180) shift += 360;
          out.push([ring[i][0] + shift, ring[i][1]]);
        }
        return out;
      });
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of rings[0]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      polys.push({ rings, minX, maxX, minY, maxY });
    }
  }
  return polys;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(p, x, y) {
  for (const sx of [x, x + 360, x - 360]) {
    if (sx < p.minX || sx > p.maxX || y < p.minY || y > p.maxY || !inRing(p.rings[0], sx, y)) continue;
    if (!p.rings.slice(1).some((hole) => inRing(hole, sx, y))) return true;
  }
  return false;
}

/** Kilometres from a point to the nearest vertex of a polygon's coast (far polygons are skipped). */
function coastDistance(p, x, y) {
  let best = Infinity;
  const rad = Math.PI / 180;
  for (const sx of [x, x + 360, x - 360]) {
    if (sx < p.minX - 1 || sx > p.maxX + 1 || y < p.minY - 1 || y > p.maxY + 1) continue;
    for (const [px, py] of p.rings[0]) {
      const dx = (px - sx) * rad * Math.cos(((py + y) / 2) * rad);
      const dy = (py - y) * rad;
      const d = 6371 * Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * A landmass number for every airport: the land polygon it stands in, or the nearest
 * one within a few kilometres (airports on reclaimed land and inshore islets), or a
 * number of its own on an island too small for the map.
 */
async function landmasses(rows) {
  const polys = await loadLand();
  const key = new Map();
  for (const r of rows) {
    const [iata, , , , , lat, lon] = r;
    let hit = polys.findIndex((p) => inPolygon(p, lon, lat));
    if (hit < 0) {
      let best = Infinity;
      polys.forEach((p, i) => {
        const d = coastDistance(p, lon, lat);
        if (d < best) { best = d; hit = i; }
      });
      if (best > 12) hit = -1;
    }
    key.set(iata, hit >= 0 ? `p${hit}` : `i${iata}`);
  }
  for (const [iata, other] of Object.entries(SAME_LAND_AS)) {
    if (key.has(iata) && key.has(other)) key.set(iata, key.get(other));
  }
  // Compact numbers, biggest landmass first.
  const count = new Map();
  for (const k of key.values()) count.set(k, (count.get(k) ?? 0) + 1);
  const order = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b));
  const index = new Map(order.map((k, i) => [k, i]));
  return new Map([...key].map(([iata, k]) => [iata, index.get(k)]));
}

async function main() {
  const dir = process.argv[2];
  const [airportsCsv, runwaysCsv, countriesCsv, curatedTxt, countriesTxt] = await Promise.all([
    loadCsv('airports.csv', dir),
    loadCsv('runways.csv', dir),
    loadCsv('countries.csv', dir),
    readFile(join(here, 'airports-curated.txt'), 'utf8'),
    readFile(join(here, 'countries-curated.txt'), 'utf8'),
  ]);

  const airports = parseCsv(airportsCsv);
  const runways = parseCsv(runwaysCsv);
  const countryNames = new Map(parseCsv(countriesCsv).map((c) => [c.code, c.name]));

  // Longest open runway per airport.
  const longest = new Map();
  for (const r of runways) {
    if (r.closed === '1') continue;
    const len = Number(r.length_ft) * 0.3048;
    if (!Number.isFinite(len)) continue;
    if (len > (longest.get(r.airport_ref) ?? 0)) longest.set(r.airport_ref, len);
  }

  const typeRank = { large_airport: 3, medium_airport: 2, small_airport: 1 };
  const byIata = new Map();
  for (const a of airports) {
    if (!a.iata_code || !(a.type in typeRank)) continue;
    const prev = byIata.get(a.iata_code);
    const score = typeRank[a.type] * 2 + (a.scheduled_service === 'yes' ? 1 : 0);
    if (!prev || score > prev.score) byIata.set(a.iata_code, { ...a, score });
  }

  const curatedCountries = new Map(parseTable(countriesTxt).map((r) => {
    const extra = Object.fromEntries(r.slice(5).map((t) => t.split('=')));
    return [r[0], { region: r[1], wealth: Number(r[2]), bloc: r[3] === '-' ? '' : r[3], parent: !r[4] || r[4] === '-' ? '' : r[4], ...extra }];
  }));
  const problems = [];
  const rows = [];
  const seen = new Set();
  const usedCountries = new Set();

  for (const tokens of parseTable(curatedTxt)) {
    const extra = Object.fromEntries(tokens.filter((t) => t.includes('=')).map((t) => t.split('=')));
    const [iata, paxStr, transferStr = '0', flags = ''] = tokens.filter((t) => !t.includes('='));
    if (seen.has(iata)) { problems.push(`duplicate ${iata}`); continue; }
    seen.add(iata);
    const a = byIata.get(iata);
    if (!a) { problems.push(`missing in OurAirports: ${iata}`); continue; }
    const runway = Math.round(longest.get(a.id) ?? 0);
    if (!runway) problems.push(`no runway data: ${iata}`);
    if (!curatedCountries.has(a.iso_country)) problems.push(`no country attributes: ${a.iso_country} (${iata})`);
    usedCountries.add(a.iso_country);
    rows.push([
      iata,
      a.icao_code || a.gps_code || a.ident,
      NAME_OVERRIDES[iata] ?? shortName(a.name),
      CITY_OVERRIDES[iata] ?? cleanCity(a.municipality ?? ''),
      a.iso_country,
      Number(Number(a.latitude_deg).toFixed(4)),
      Number(Number(a.longitude_deg).toFixed(4)),
      Math.round(Number(a.elevation_ft || 0) * 0.3048),
      runway,
      Number(paxStr),
      Number(transferStr),
      flags,
      extra.dom === undefined ? -1 : Number(extra.dom),
    ]);
  }

  const countryRows = [...usedCountries].sort().map((iso) => {
    const c = curatedCountries.get(iso) ?? { region: 'EUR', wealth: 0.8, bloc: '', parent: '' };
    // Surface travel competes poorly in poorer countries unless told otherwise.
    const rail = c.rail ?? (c.wealth < 0.8 ? 'P' : 'N');
    return [iso, countryNames.get(iso) ?? iso, c.region, c.wealth, c.bloc, c.parent, c.lang ?? '', rail, c.dom === undefined ? -1 : Number(c.dom)];
  });

  rows.sort((x, y) => y[9] - x[9] || x[0].localeCompare(y[0]));
  const land = await landmasses(rows);
  for (const r of rows) r.push(land.get(r[0]));

  const out = `// AUTO-GENERATED by scripts/build-airports.mjs — do not edit by hand.
// Geography: OurAirports (https://ourairports.com/data/, public domain).
// Traffic figures are approximate game-balance inputs, not statistics.

/** [iata, icao, name, city, countryIso, lat, lon, elevationM, runwayM, paxM, transferShare, flags, domestic share target or -1, landmass] */
export type AirportRow = [string, string, string, string, string, number, number, number, number, number, number, string, number, number];
/** [iso, name, region, wealth, bloc, parentIso, spheres, surface (H fast trains, N ordinary, P poor), domestic share target or -1] */
export type CountryRow = [string, string, string, number, string, string, string, string, number];

export const AIRPORT_ROWS: AirportRow[] = [
${rows.map((r) => '  ' + JSON.stringify(r) + ',').join('\n')}
];

export const COUNTRY_ROWS: CountryRow[] = [
${countryRows.map((r) => '  ' + JSON.stringify(r) + ',').join('\n')}
];
`;
  const dest = join(root, 'src/sim/data/airports.generated.ts');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, out);

  console.log(`wrote ${rows.length} airports in ${countryRows.length} countries -> ${dest}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log('  - ' + p);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
