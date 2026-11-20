// Weather: systems that form, travel across the map and die, and what they do
// to flying while they are overhead.
//
// The map itself is clear. What you see on it is weather that matters: an
// Atlantic low crossing Europe, a line of thunderstorms over the American
// plains, a typhoon making for Taiwan. Each has a position, a track and a
// strength, all part of the saved game; an airport under one has delays, and
// under the core of a severe one it closes until the system has passed.

import { AIRPORT, AIRPORTS } from './data/airports';
import { DEG, EARTH_RADIUS_KM, latLonToVec } from './geo';
import type { Vec3 } from './geo';
import { chance, randRange, weightedPick } from './rng';
import { formatClock, formatDate, monthOfYear } from './time';
import type { Airport, AirportId, WeatherKind, WeatherSystem } from './types';
import type { Sim } from './sim';
import { addNews } from './world';

/** At this strength over an airport, nothing takes off or lands. */
export const WEATHER_CLOSES = 0.85;
/** No more systems than this at once, however stormy the season. */
const MOST_SYSTEMS = 12;
/** The airports' weather is worked out afresh every this many minutes. */
const BUCKET = 20;

const CYCLONE_NAMES = [
  'Alba', 'Bruno', 'Cora', 'Dario', 'Elin', 'Farid', 'Greta', 'Hugo', 'Ines', 'Jarrah', 'Kaito', 'Lior', 'Mirae',
  'Nico', 'Odile', 'Pavel', 'Quilla', 'Rafi', 'Sabela', 'Tomas', 'Ulla', 'Vasco', 'Wren', 'Xavi', 'Yara', 'Zeno',
];

type Range = [number, number];

/** Where and when a kind of weather forms, and how it behaves. */
interface Recipe {
  kind: WeatherKind;
  title: string;
  /** Chance of one forming on a day of each month, January first. */
  chance: number[];
  lat: Range;
  lon: Range;
  /** Degrees a day east and north. */
  dLon: Range;
  dLat: Range;
  /** Degrees a day by which its heading swings (anticlockwise positive). */
  turn?: Range;
  /** Radius of the affected area, km. */
  radius: Range;
  days: Range;
  strength: Range;
  /** Named, like tropical cyclones. */
  named?: boolean;
  /** Snow rather than rain: in which months, north of which latitude, and how often. */
  snow?: { months: number[]; lat: number; chance: number };
  /** How often it forms close to one of the region's airports rather than anywhere in it. */
  near?: number;
}

/** Twelve monthly chances from a few named seasons. */
function months(base: number, seasons: Record<string, number> = {}): number[] {
  const out = new Array<number>(12).fill(base);
  for (const [key, value] of Object.entries(seasons)) for (const m of key.split(',')) out[Number(m)] = value;
  return out;
}

const NORTH_WINTER = [10, 11, 0, 1, 2];

// How often things form is set so that weather is an event: over any one place the
// sky is clear nine days in ten even in its stormy season, and a closure is rare.
const RECIPES: Recipe[] = [
  // Lows of the middle latitudes, marching east.
  { kind: 'storm', title: 'Atlantic storm', chance: months(0.05, { '11,0,1': 0.12, '10,2': 0.09, '5,6,7': 0.02 }), lat: [43, 62], lon: [-35, -8],
    dLon: [9, 14], dLat: [-1.5, 2], radius: [450, 750], days: [2.5, 4], strength: [0.3, 0.7], snow: { months: [11, 0, 1], lat: 53, chance: 0.4 } },
  { kind: 'storm', title: 'Mediterranean storm', chance: months(0.01, { '10,11,0,1,2': 0.06 }), lat: [35, 45], lon: [-9, 28],
    dLon: [5, 9], dLat: [-1, 1], radius: [350, 600], days: [1.5, 3], strength: [0.3, 0.65] },
  { kind: 'storm', title: 'Winter storm', chance: months(0.04, { '11,0,1,2': 0.11, '10,3': 0.07, '5,6,7,8': 0.015 }), lat: [34, 48], lon: [-118, -90],
    dLon: [8, 13], dLat: [-0.5, 2.5], radius: [450, 750], days: [2.5, 4], strength: [0.3, 0.75], snow: { months: NORTH_WINTER, lat: 37, chance: 0.6 } },
  { kind: 'storm', title: 'Pacific storm', chance: months(0.01, { '10,11,0,1,2': 0.06 }), lat: [33, 50], lon: [-145, -128],
    dLon: [8, 12], dLat: [-1, 1], radius: [450, 700], days: [2, 3.5], strength: [0.3, 0.65] },
  { kind: 'storm', title: 'Storm', chance: months(0.04, { '11,0,1,2': 0.09, '6,7': 0.02 }), lat: [30, 45], lon: [105, 130],
    dLon: [8, 12], dLat: [0, 2], radius: [400, 650], days: [2, 3.5], strength: [0.3, 0.65], snow: { months: [11, 0, 1, 2], lat: 36, chance: 0.5 } },
  { kind: 'storm', title: 'Southern Ocean storm', chance: months(0.03, { '5,6,7,8': 0.09 }), lat: [-46, -31], lon: [105, 150],
    dLon: [9, 13], dLat: [-1, 1], radius: [450, 700], days: [2.5, 4], strength: [0.3, 0.65] },
  { kind: 'storm', title: 'Storm', chance: months(0.03, { '5,6,7,8': 0.07 }), lat: [-46, -28], lon: [-82, -62],
    dLon: [8, 12], dLat: [-1, 1], radius: [400, 650], days: [2, 3.5], strength: [0.3, 0.6] },
  { kind: 'storm', title: 'Cape storm', chance: months(0.015, { '5,6,7,8': 0.05 }), lat: [-37, -31], lon: [8, 20],
    dLon: [7, 11], dLat: [-1, 1], radius: [400, 650], days: [1.5, 3], strength: [0.3, 0.6] },

  // Thunderstorms: where the air is warm and wet. Small, so they form where they will be met.
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.02, { '3,4,8,9': 0.1, '5,6,7': 0.18 }), lat: [27, 43], lon: [-103, -77], near: 0.6,
    dLon: [3, 6], dLat: [-0.5, 1], radius: [250, 430], days: [1, 1.8], strength: [0.3, 0.6] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.02, { '5,6,7,8': 0.12 }), lat: [25, 31], lon: [-92, -80], near: 0.6,
    dLon: [-1, 3], dLat: [-0.5, 1], radius: [220, 380], days: [0.8, 1.5], strength: [0.3, 0.6] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0, { '4,8': 0.05, '5,6,7': 0.12 }), lat: [38, 53], lon: [-6, 28], near: 0.6,
    dLon: [3, 6], dLat: [0, 1], radius: [220, 380], days: [0.8, 1.5], strength: [0.3, 0.55] },
  { kind: 'thunder', title: 'Monsoon storms', chance: months(0.01, { '5,9': 0.1, '6,7,8': 0.22 }), lat: [9, 30], lon: [71, 92], near: 0.6,
    dLon: [-2, 2], dLat: [-0.5, 1], radius: [300, 480], days: [1, 2.2], strength: [0.3, 0.65] },
  { kind: 'thunder', title: 'Tropical storms', chance: months(0.2), lat: [-8, 19], lon: [95, 126], near: 0.6,
    dLon: [-3, 1], dLat: [-0.5, 0.5], radius: [250, 420], days: [0.8, 1.6], strength: [0.3, 0.55] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.02, { '4,5,6,7,8': 0.14 }), lat: [22, 36], lon: [104, 122], near: 0.6,
    dLon: [2, 5], dLat: [0, 1], radius: [280, 450], days: [1, 2], strength: [0.3, 0.6] },
  { kind: 'thunder', title: 'Rainy-season storms', chance: months(0, { '5,6': 0.08, '7,8': 0.05 }), lat: [31, 38], lon: [126, 141], near: 0.6,
    dLon: [2, 5], dLat: [0, 1], radius: [250, 400], days: [1, 2], strength: [0.3, 0.6] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.09), lat: [-9, 11], lon: [-2, 40], near: 0.6,
    dLon: [-3, 0], dLat: [-0.5, 0.5], radius: [250, 400], days: [0.8, 1.5], strength: [0.3, 0.5] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0, { '9,10,11,0,1,2': 0.07 }), lat: [-30, -22], lon: [24, 32], near: 0.6,
    dLon: [1, 3], dLat: [-0.5, 0.5], radius: [220, 360], days: [0.7, 1.3], strength: [0.3, 0.55] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.04, { '9,10,11,0,1,2': 0.15 }), lat: [-27, -4], lon: [-62, -39], near: 0.6,
    dLon: [1, 4], dLat: [-1, 0.5], radius: [280, 450], days: [1, 1.8], strength: [0.3, 0.6] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.06), lat: [-5, 9], lon: [-81, -60], near: 0.6,
    dLon: [-2, 1], dLat: [-0.5, 0.5], radius: [230, 380], days: [0.7, 1.4], strength: [0.3, 0.55] },
  { kind: 'thunder', title: 'Thunderstorms', chance: months(0.02, { '4,5,6,7,8,9': 0.11 }), lat: [9, 26], lon: [-101, -68], near: 0.6,
    dLon: [-3, 1], dLat: [0, 1], radius: [250, 400], days: [0.8, 1.6], strength: [0.3, 0.55] },
  { kind: 'thunder', title: 'Wet-season storms', chance: months(0.01, { '11,0,1,2': 0.1 }), lat: [-21, -9], lon: [118, 152], near: 0.6,
    dLon: [-2, 1], dLat: [-0.5, 0.5], radius: [250, 400], days: [0.8, 1.6], strength: [0.3, 0.55] },

  // Tropical cyclones: rare, slow, and they shut airports.
  { kind: 'cyclone', title: 'Hurricane', named: true, chance: months(0, { '5,6,10': 0.012, '7': 0.05, '8': 0.07, '9': 0.04 }), lat: [11, 18], lon: [-56, -32],
    dLon: [-6.5, -4.5], dLat: [0.8, 1.8], turn: [-14, -7], radius: [380, 520], days: [7, 10], strength: [0.9, 1] },
  { kind: 'cyclone', title: 'Typhoon', named: true, chance: months(0, { '4,11': 0.012, '5,10': 0.03, '6,9': 0.06, '7,8': 0.08 }), lat: [8, 18], lon: [128, 150],
    dLon: [-6, -4], dLat: [0.8, 2], turn: [-12, 0], radius: [380, 540], days: [6, 9], strength: [0.9, 1] },
  { kind: 'cyclone', title: 'Hurricane', named: true, chance: months(0, { '5,9': 0.015, '6,7,8': 0.04 }), lat: [11, 16], lon: [-110, -95],
    dLon: [-5.5, -3.5], dLat: [0.5, 1.5], turn: [-6, 4], radius: [350, 480], days: [5, 7], strength: [0.9, 1] },
  { kind: 'cyclone', title: 'Cyclone', named: true, chance: months(0, { '4': 0.03, '5': 0.02, '9': 0.03, '10': 0.04 }), lat: [9, 15], lon: [84, 92],
    dLon: [-2, 0.5], dLat: [2, 3.5], turn: [-6, 2], radius: [350, 480], days: [4, 5.5], strength: [0.9, 1] },
  { kind: 'cyclone', title: 'Cyclone', named: true, chance: months(0, { '11,3': 0.015, '0,1,2': 0.04 }), lat: [-16, -10], lon: [55, 76],
    dLon: [-5, -3], dLat: [-1.8, -0.6], turn: [6, 13], radius: [360, 500], days: [6, 8], strength: [0.9, 1] },
  { kind: 'cyclone', title: 'Cyclone', named: true, chance: months(0, { '11,3': 0.015, '0,1,2': 0.04 }), lat: [-16, -10], lon: [116, 176],
    dLon: [-3.5, 1], dLat: [-2.5, -1], turn: [0, 10], radius: [360, 500], days: [5, 7], strength: [0.9, 1] },

  // Dust and sand: the Sahara in spring, the Gulf's summer shamal, north China in spring.
  { kind: 'sand', title: 'Sandstorm', chance: months(0.01, { '2,3,4,5': 0.05 }), lat: [16, 33], lon: [-10, 34], near: 0.5,
    dLon: [-1, 4], dLat: [-1, 1], radius: [300, 550], days: [1, 2], strength: [0.35, 0.7] },
  { kind: 'sand', title: 'Sandstorm', chance: months(0.01, { '2,3': 0.04, '4,5,6,7': 0.07 }), lat: [20, 33], lon: [38, 58], near: 0.6,
    dLon: [0, 3], dLat: [-1.5, 0], radius: [280, 480], days: [1, 2], strength: [0.35, 0.7] },
  { kind: 'sand', title: 'Dust storm', chance: months(0, { '2,3,4': 0.05 }), lat: [36, 43], lon: [100, 117], near: 0.5,
    dLon: [5, 9], dLat: [-1.5, 0], radius: [300, 500], days: [1, 2], strength: [0.35, 0.65] },
];

/** A day of fog now and then, somewhere it belongs. */
const FOG_CHANCE = months(0.03, { '10,11,0,1': 0.22, '9,2': 0.1 });

function between(sim: Sim, r: Range): number {
  return randRange(sim.game, r[0], r[1]);
}

function smooth(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Where a system is at a given time. Its heading swings steadily, which is how a cyclone recurves. */
export function weatherPosition(w: WeatherSystem, time: number): { lat: number; lon: number } {
  const days = Math.max(0, Math.min(time, w.end) - w.start) / 1440;
  const turn = w.turn * DEG;
  let east = w.dLon * days;
  let north = w.dLat * days;
  if (Math.abs(turn) > 1e-5) {
    const s = Math.sin(turn * days) / turn;
    const c = (1 - Math.cos(turn * days)) / turn;
    east = w.dLon * s - w.dLat * c;
    north = w.dLon * c + w.dLat * s;
  }
  const lat = Math.max(-72, Math.min(72, w.lat + north));
  let lon = w.lon + east;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat, lon };
}

/** How strong a system is at a given time: it builds, peaks and fades. */
export function weatherIntensity(w: WeatherSystem, time: number): number {
  if (time < w.start || time >= w.end) return 0;
  const u = (time - w.start) / (w.end - w.start);
  return w.strength * smooth(0, 0.2, u) * (1 - smooth(0.75, 1, u));
}

/** A system as it is at one moment. */
export interface ActiveWeather {
  system: WeatherSystem;
  lat: number;
  lon: number;
  pos: Vec3;
  intensity: number;
}

/** Every system as it stands at a moment (for drawing and for looking ahead). */
export function activeWeather(sim: Sim, time: number): ActiveWeather[] {
  const out: ActiveWeather[] = [];
  for (const w of sim.game.world.weather ?? []) {
    const intensity = weatherIntensity(w, time);
    if (intensity <= 0) continue;
    const { lat, lon } = weatherPosition(w, time);
    out.push({ system: w, lat, lon, pos: latLonToVec(lat, lon), intensity });
  }
  return out;
}

/** The systems as they stand now, kept for a few minutes at a time. */
function current(sim: Sim, time: number): ActiveWeather[] {
  const bucket = Math.floor(time / BUCKET);
  if (!sim.weatherNow || sim.weatherNow.bucket !== bucket) sim.weatherNow = { bucket, list: activeWeather(sim, bucket * BUCKET) };
  return sim.weatherNow.list;
}

/** How hard a system bears on a place: full strength over its core, nothing at its edge. */
function bearing(a: ActiveWeather, pos: ArrayLike<number>): number {
  const dot = a.pos[0] * pos[0] + a.pos[1] * pos[1] + a.pos[2] * pos[2];
  if (dot < 0.9) return 0;
  const km = Math.acos(Math.min(1, dot)) * EARTH_RADIUS_KM;
  const r = a.system.radius;
  if (km >= r) return 0;
  return a.intensity * (km <= 0.45 * r ? 1 : (r - km) / (0.55 * r));
}

/** 0..1: how bad the weather is at an airport. */
export function weatherAt(sim: Sim, ap: Airport, time: number): number {
  let worst = 0;
  for (const a of current(sim, time)) {
    const b = bearing(a, ap.pos);
    if (b > worst) worst = b;
  }
  return worst;
}

/** The system that is doing most to an airport, if any is. */
export function weatherOver(sim: Sim, ap: Airport, time: number): { system: WeatherSystem; strength: number } | null {
  let best: { system: WeatherSystem; strength: number } | null = null;
  for (const a of current(sim, time)) {
    const b = bearing(a, ap.pos);
    if (b > 0.05 && (!best || b > best.strength)) best = { system: a.system, strength: b };
  }
  return best;
}

/** 0..1: how disrupted an airport is, by weather or by anything else (strikes, ash). */
export function disruptionAt(sim: Sim, ap: Airport, time: number): number {
  return Math.max(sim.disruption[ap.index], weatherAt(sim, ap, time));
}

/** A system's name as it reads in the middle of a sentence: "Typhoon Mirae", but "dense fog". */
export function weatherName(w: WeatherSystem): string {
  return w.kind === 'cyclone' ? w.title : w.title.toLowerCase();
}

/** In words, how weather of a given strength shows at an airport. */
export function weatherEffect(strength: number): string {
  if (strength >= WEATHER_CLOSES) return 'airport closed';
  if (strength >= 0.5) return 'long delays';
  if (strength >= 0.25) return 'delays';
  return 'some delays';
}

/** When a system will first bear on an airport at least this hard in the coming hours, and how hard at worst. */
function arrival(sim: Sim, w: WeatherSystem, ap: Airport, hours: number, least: number): { time: number; worst: number } | null {
  let first = -1;
  let worst = 0;
  for (let h = 0; h <= hours; h += 3) {
    const t = sim.game.time + h * 60;
    const intensity = weatherIntensity(w, t);
    if (intensity <= 0) continue;
    const { lat, lon } = weatherPosition(w, t);
    const b = bearing({ system: w, lat, lon, pos: latLonToVec(lat, lon), intensity }, ap.pos);
    if (b >= least && first < 0) first = t;
    if (b > worst) worst = b;
  }
  return first < 0 ? null : { time: first, worst };
}

/** What the coming hours hold for an airport: the system that will bear on it hardest, when it arrives and how bad it gets. */
export function weatherOutlook(sim: Sim, ap: Airport, hours = 42): { system: WeatherSystem; from: number; worst: number } | null {
  let best: { system: WeatherSystem; from: number; worst: number } | null = null;
  for (const w of sim.game.world.weather ?? []) {
    const hit = arrival(sim, w, ap, hours, 0.25);
    if (hit && (!best || hit.worst > best.worst)) best = { system: w, from: hit.time, worst: hit.worst };
  }
  return best;
}

/** A system as the news would describe it: where it is, and which of an airline's airports are under it. */
export interface WeatherReport {
  system: WeatherSystem;
  lat: number;
  lon: number;
  intensity: number;
  /** The biggest airport under it, or failing that the nearest one. */
  near: Airport;
  /** Whether `near` is under it. */
  over: boolean;
  /** The airline's airports under it now, worst first. */
  affected: { airport: Airport; strength: number }[];
}

/** The weather of the moment, worst first, with what it is doing to the airports an airline flies from. */
export function weatherReport(sim: Sim, airline = 0): WeatherReport[] {
  const time = sim.game.time;
  const mine = new Set<AirportId>(sim.game.airlines[airline].hubs.map((h) => h.airport));
  for (const r of sim.routesOf(airline)) {
    mine.add(r.a);
    mine.add(r.b);
  }
  const out: WeatherReport[] = [];
  for (const a of activeWeather(sim, time)) {
    let near: Airport | null = null;
    let nearScore = 0;
    let nearest: Airport = AIRPORTS[0];
    let nearestDot = -2;
    const affected: { airport: Airport; strength: number }[] = [];
    for (const ap of AIRPORTS) {
      const dot = a.pos[0] * ap.pos[0] + a.pos[1] * ap.pos[1] + a.pos[2] * ap.pos[2];
      if (dot > nearestDot) {
        nearestDot = dot;
        nearest = ap;
      }
      const b = bearing(a, ap.pos);
      if (b <= 0) continue;
      // Named for a big city close to its centre rather than a bigger one at its edge.
      const km = Math.acos(Math.min(1, dot)) * EARTH_RADIUS_KM;
      const score = ap.mass / (1 + (km / 150) ** 2);
      if (score > nearScore) {
        nearScore = score;
        near = ap;
      }
      if (b > 0.05 && mine.has(ap.id)) affected.push({ airport: ap, strength: b });
    }
    affected.sort((x, y) => y.strength - x.strength);
    out.push({ system: a.system, lat: a.lat, lon: a.lon, intensity: a.intensity, near: near ?? nearest, over: !!near, affected });
  }
  out.sort((x, y) => y.affected.length - x.affected.length || y.intensity - x.intensity);
  return out;
}

/** Weather has to be at least this bad at one of the player's airports to make the news. */
const NEWSWORTHY = 0.5;

/** A list as it is written: "A", "A and B", "A, B and C". */
function listed(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Tells the player about bad weather on its way to the airports they fly from:
 * once for each system, naming everywhere it will hit. Run-of-the-mill delays
 * are left to the map and the airport cards.
 */
function warn(sim: Sim): void {
  const p = sim.player;
  const mine = new Set<AirportId>(p.hubs.map((h) => h.airport));
  for (const r of sim.routesOf(0)) {
    mine.add(r.a);
    mine.add(r.b);
  }
  if (!mine.size) return;
  const now = sim.game.time;
  for (const w of sim.game.world.weather ?? []) {
    if (w.strength < NEWSWORTHY) continue;
    const hits: { ap: Airport; time: number; worst: number }[] = [];
    for (const id of mine) {
      if (w.warned.includes(id)) continue;
      const hit = arrival(sim, w, AIRPORT[id], 42, NEWSWORTHY);
      if (!hit) continue;
      w.warned.push(id);
      hits.push({ ap: AIRPORT[id], time: hit.time, worst: hit.worst });
    }
    if (!hits.length) continue;
    hits.sort((x, y) => y.worst - x.worst || x.time - y.time);
    const first = hits.reduce((t, h) => Math.min(t, h.time), Infinity);
    const here = first - now < 180;
    const shut = hits.filter((h) => h.worst >= WEATHER_CLOSES);
    const slow = hits.filter((h) => h.worst < WEATHER_CLOSES);
    const names = (list: typeof hits) => listed(list.slice(0, 5).map((h) => `${h.ap.city} (${h.ap.id})`)) + (list.length > 5 ? ` and ${list.length - 5} more` : '');
    const when = here ? '' : ` from ${formatDate(first)}, ${formatClock(first)}`;
    const parts: string[] = [];
    if (shut.length) parts.push(`${names(shut)} ${here ? (shut.length > 1 ? 'are' : 'is') + ' closed' : 'will close'} while it passes${when}: flights there are held on the ground.`);
    if (slow.length) parts.push(`${shut.length ? 'Long delays too' : 'Expect long delays'} at ${names(slow)}${shut.length ? '' : when}.`);
    addNews(sim, shut.length ? 'bad' : 'info', `${w.title} ${here ? 'over' : 'heading for'} ${hits[0].ap.city}`, parts.join(' '), { airport: hits[0].ap.id });
  }
}

function spawn(sim: Sim, recipe: Recipe, lat: number, lon: number): void {
  const g = sim.game;
  const month = monthOfYear(g.time);
  let kind = recipe.kind;
  let title = recipe.title;
  const strength = between(sim, recipe.strength);
  if (recipe.snow?.months.includes(month) && lat > recipe.snow.lat && chance(g, recipe.snow.chance)) {
    kind = 'snow';
    title = strength > 0.6 ? 'Blizzard' : 'Snowstorm';
  }
  if (recipe.named) {
    const n = g.flags.cyclones ?? 0;
    g.flags.cyclones = n + 1;
    title = `${recipe.title} ${CYCLONE_NAMES[n % CYCLONE_NAMES.length]}`;
  }
  (g.world.weather ??= []).push({
    id: g.nextId++, kind, title, lat, lon,
    dLon: between(sim, recipe.dLon), dLat: between(sim, recipe.dLat), turn: recipe.turn ? between(sim, recipe.turn) : 0,
    radius: between(sim, recipe.radius), strength,
    start: g.time, end: g.time + Math.round(between(sim, recipe.days) * 1440), warned: [],
  });
}

/** The day's weather: what has blown itself out, what is forming, and who should be told. */
export function stepWeather(sim: Sim): void {
  const g = sim.game;
  const list = (g.world.weather ??= []);
  g.world.weather = list.filter((w) => w.end > g.time);
  sim.weatherNow = null;
  const month = monthOfYear(g.time);

  for (const recipe of RECIPES) {
    if (!chance(g, recipe.chance[month]) || g.world.weather.length >= MOST_SYSTEMS) continue;
    let lat = between(sim, recipe.lat);
    let lon = between(sim, recipe.lon);
    if (recipe.near && chance(g, recipe.near)) {
      const ap = weightedPick(g, AIRPORTS, (a) => (a.lat >= recipe.lat[0] && a.lat <= recipe.lat[1] && a.lon >= recipe.lon[0] && a.lon <= recipe.lon[1] ? Math.sqrt(a.mass) : 0));
      if (ap) {
        lat = ap.lat + randRange(g, -1.2, 1.2);
        lon = ap.lon + randRange(g, -1.5, 1.5);
      }
    }
    spawn(sim, recipe, lat, lon);
  }

  // Fog settles where winters are cool and damp: it does not travel, and is gone in a day.
  if (chance(g, FOG_CHANCE[month]) && g.world.weather.length < MOST_SYSTEMS) {
    const ap = weightedPick(g, AIRPORTS, (a) => {
      if (a.lat < 22 || a.lat > 57) return 0;
      // The plains of north India are the fog capital of the flying world.
      return Math.sqrt(a.mass) * (a.country === 'IN' && a.lat > 24 ? 4 : 1);
    });
    if (ap) {
      g.world.weather.push({
        id: g.nextId++, kind: 'fog', title: 'Dense fog', lat: ap.lat, lon: ap.lon, dLon: 0, dLat: 0, turn: 0,
        radius: randRange(g, 150, 280), strength: randRange(g, 0.35, 0.6),
        start: g.time, end: g.time + Math.round(randRange(g, 0.5, 1.2) * 1440), warned: [],
      });
    }
  }

  warn(sim);
}
