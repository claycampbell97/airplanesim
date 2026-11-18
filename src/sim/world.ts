// The world outside the airlines: fuel prices, the business cycle, weather,
// strikes, booms and busts, the second-hand aircraft market, and the news feed.

import { AIRCRAFT_TYPES, typeName } from './data/aircraft';
import { AIRPORTS, REGION_NAMES } from './data/airports';
import { marketLease, marketValue } from './finance';
import { chance, pick, rand, randInt, randNormal, randRange, weightedPick } from './rng';
import { monthOfYear } from './time';
import type { AirportId, NewsItem, NewsKind, RegionId, UsedListing, WorldEvent } from './types';
import type { Sim } from './sim';

export const FUEL_BASE = 0.85;

const LESSORS = [
  'Northfield Aero Leasing', 'Kestrel Asset Partners', 'Blue Meridian Capital', 'Halcyon Air Finance',
  'Tradewind Leasing', 'Sagan Aviation Trust', 'Ironbridge Aircraft', 'Cobalt Sky Partners',
  'Larkspur Aviation', 'Seventh Parallel Leasing',
];

export function addNews(
  sim: Sim,
  kind: NewsKind,
  title: string,
  body: string,
  extra: Partial<Pick<NewsItem, 'airport' | 'route'>> = {},
): NewsItem {
  const g = sim.game;
  const item: NewsItem = { id: g.nextId++, time: g.time, kind, title, body, read: false, ...extra };
  g.news.push(item);
  if (g.news.length > 250) g.news.splice(0, g.news.length - 250);
  sim.emit('news', item);
  return item;
}

function addEvent(sim: Sim, e: Omit<WorldEvent, 'id' | 'start'> & { start?: number }): WorldEvent {
  const g = sim.game;
  const ev: WorldEvent = { id: g.nextId++, start: g.time, ...e };
  g.world.events.push(ev);
  return ev;
}

/** Whether something happening at an airport matters to the player. */
function touchesPlayer(sim: Sim, airport?: AirportId, region?: RegionId): boolean {
  const routes = sim.routesOf(0);
  if (airport) return routes.some((r) => r.a === airport || r.b === airport) || sim.game.airlines[0].hubs.some((h) => h.airport === airport);
  if (region) return routes.some((r) => sim.airport(r.a).region === region || sim.airport(r.b).region === region);
  return true;
}

// ───────────────────────── Fuel & economy ─────────────────────────

export function fuelMultiplier(sim: Sim): number {
  let m = 1;
  for (const e of sim.game.world.events) if (e.fuel && sim.game.time >= e.start && sim.game.time < e.end) m *= e.fuel;
  return m;
}

function stepFuel(sim: Sim): void {
  const w = sim.game.world;
  const target = FUEL_BASE * fuelMultiplier(sim);
  // Mean-reverting random walk with a slowly wandering trend.
  w.fuelTrend = w.fuelTrend * 0.97 + randNormal(sim.game) * 0.0012 * sim.tuning.fuelVolatility;
  w.fuelPrice += (target - w.fuelPrice) * 0.02 + w.fuelPrice * (w.fuelTrend + randNormal(sim.game) * 0.009 * sim.tuning.fuelVolatility);
  w.fuelPrice = Math.max(0.42, Math.min(1.95, w.fuelPrice));
  w.fuelHistory.push(w.fuelPrice);
  if (w.fuelHistory.length > 730) w.fuelHistory.shift();
}

function stepEconomy(sim: Sim): void {
  const w = sim.game.world;
  // A business cycle of roughly five and a half years.
  w.economyPhase += (2 * Math.PI) / (5.5 * 365);
  const cycle = 1 + 0.045 * Math.sin(w.economyPhase);
  w.economy += (cycle - w.economy) * 0.03 + randNormal(sim.game) * 0.0008;
  w.economy = Math.max(0.85, Math.min(1.14, w.economy));
  w.economyHistory.push(w.economy);
  if (w.economyHistory.length > 730) w.economyHistory.shift();
}

// ───────────────────────── Random events ─────────────────────────

const GATHERINGS = ['World Expo', 'International Games', 'Global Climate Summit', 'Football Finals', 'Film Festival', 'Tech Congress', 'Grand Prix Week', 'Cultural Capital Year'];

function spawnEvents(sim: Sim): void {
  const g = sim.game;
  const month = monthOfYear(g.time);
  const northWinter = month === 11 || month <= 1;
  const northSummer = month >= 5 && month <= 8;

  // A big gathering lifts demand to one city.
  if (chance(g, 1 / 28)) {
    const ap = weightedPick(g, AIRPORTS, (a) => (a.tier >= 3 ? a.mass : 0));
    if (ap && !g.world.events.some((e) => e.airport === ap.id)) {
      const name = pick(g, GATHERINGS);
      const days = randInt(g, 12, 30);
      const boost = randRange(g, 1.3, 1.6);
      addEvent(sim, { type: 'gathering', title: `${name} in ${ap.city}`, end: g.time + days * 1440, airport: ap.id, demand: boost });
      if (touchesPlayer(sim, ap.id)) {
        addNews(sim, 'good', `${name} comes to ${ap.city}`, `Demand for flights to ${ap.city} (${ap.id}) is up about ${Math.round((boost - 1) * 100)}% for the next ${days} days.`, { airport: ap.id });
      } else if (ap.tier >= 5) {
        addNews(sim, 'world', `${name} opens in ${ap.city}`, `Airlines serving ${ap.id} are adding capacity for the next ${days} days.`, { airport: ap.id });
      }
    }
  }

  // Weather.
  if (chance(g, 1 / 10)) {
    const ap = weightedPick(g, AIRPORTS, (a) => {
      const north = a.lat > 35;
      const tropics = Math.abs(a.lat) < 28;
      let w = Math.sqrt(a.mass);
      if (north && northWinter) w *= 3;
      if (tropics && northSummer && a.lat > 5) w *= 2.5;
      return w;
    });
    if (ap && !g.world.events.some((e) => e.airport === ap.id && e.disruption)) {
      const snow = ap.lat > 35 && northWinter;
      const storm = Math.abs(ap.lat) < 28 && ap.lat > 5 && northSummer;
      const severe = chance(g, 0.3);
      const kind = snow ? (severe ? 'Blizzard' : 'Heavy snow') : storm ? (severe ? (ap.lon > 60 ? 'Typhoon' : 'Hurricane') : 'Tropical storm') : severe ? 'Severe storms' : pick(g, ['Dense fog', 'Thunderstorms', 'High winds']);
      const days = severe ? randInt(g, 1, 3) : 1;
      addEvent(sim, {
        type: 'weather', title: `${kind} at ${ap.city}`, end: g.time + days * 1440, airport: ap.id,
        demand: severe ? 0.75 : 0.95, disruption: severe ? 0.95 : randRange(g, 0.3, 0.6),
      });
      if (touchesPlayer(sim, ap.id)) {
        addNews(sim, 'bad', `${kind} hits ${ap.city}`, severe
          ? `${ap.name} (${ap.id}) is closed for about ${days} day${days > 1 ? 's' : ''}. Your flights there are held on the ground.`
          : `Expect delays at ${ap.id} today.`, { airport: ap.id });
      }
    }
  }

  // Industrial action.
  if (chance(g, 1 / 45)) {
    const ap = weightedPick(g, AIRPORTS, (a) => (a.tier >= 3 ? a.mass : 0));
    if (ap && !g.world.events.some((e) => e.airport === ap.id)) {
      const days = randInt(g, 2, 4);
      const who = pick(g, ['Air traffic controllers', 'Ground handlers', 'Security staff', 'Baggage handlers']);
      addEvent(sim, { type: 'strike', title: `Strike at ${ap.city}`, end: g.time + days * 1440, airport: ap.id, demand: 0.85, disruption: 0.6 });
      if (touchesPlayer(sim, ap.id)) {
        addNews(sim, 'bad', `${who} strike at ${ap.id}`, `Long delays are expected at ${ap.name} for the next ${days} days.`, { airport: ap.id });
      }
    }
  }

  // Tourism fashions.
  if (chance(g, 1 / 50)) {
    const ap = weightedPick(g, AIRPORTS, (a) => (a.leisure > 0.45 ? a.mass : 0));
    if (ap && !g.world.events.some((e) => e.airport === ap.id)) {
      const up = chance(g, 0.62);
      const days = randInt(g, 60, 130);
      addEvent(sim, { type: 'tourism', title: up ? `${ap.city} is in fashion` : `${ap.city} loses its shine`, end: g.time + days * 1440, airport: ap.id, demand: up ? randRange(g, 1.2, 1.35) : randRange(g, 0.75, 0.85) });
      if (touchesPlayer(sim, ap.id) || ap.tier >= 4) {
        addNews(sim, up ? 'good' : 'bad', up ? `${ap.city} named destination of the year` : `Tourists turn away from ${ap.city}`,
          up ? `Travel writers cannot stop talking about ${ap.city}. Leisure demand to ${ap.id} is elevated for the coming months.`
            : `A run of bad press has dented bookings to ${ap.id} for the coming months.`, { airport: ap.id });
      }
    }
  }

  // Fuel shocks.
  if (chance(g, 1 / 230) && !g.world.events.some((e) => e.fuel)) {
    const up = chance(g, 0.6);
    const days = randInt(g, 70, 160);
    const mult = up ? randRange(g, 1.25, 1.5) : randRange(g, 0.72, 0.85);
    addEvent(sim, { type: 'fuel', title: up ? 'Oil supply squeeze' : 'Oil glut', end: g.time + days * 1440, demand: 1, fuel: mult });
    addNews(sim, up ? 'bad' : 'good', up ? 'Oil supply squeeze sends jet fuel soaring' : 'Oil glut pushes jet fuel lower',
      up ? 'Analysts expect fuel prices to climb sharply over the coming weeks. Airlines with hedges are protected.'
        : 'Fuel is getting cheaper. A good moment to lock in prices for the months ahead.');
  }

  // The wider economy.
  if (chance(g, 1 / 800) && !g.world.events.some((e) => e.type === 'recession' || e.type === 'boom')) {
    const days = randInt(g, 240, 420);
    addEvent(sim, { type: 'recession', title: 'Global recession', end: g.time + days * 1440, demand: 0.88 });
    addNews(sim, 'bad', 'Global recession declared', 'Companies are cutting travel budgets and families are staying home. Expect weaker demand everywhere, premium cabins especially.');
  } else if (chance(g, 1 / 600) && !g.world.events.some((e) => e.type === 'recession' || e.type === 'boom')) {
    const days = randInt(g, 200, 360);
    addEvent(sim, { type: 'boom', title: 'Travel boom', end: g.time + days * 1440, demand: 1.08 });
    addNews(sim, 'good', 'The world is travelling again', 'Consumer confidence is high and airports are packed. Demand is running well above trend.');
  }

  if (chance(g, 1 / 420)) {
    const region = pick(g, Object.keys(REGION_NAMES) as RegionId[]);
    if (!g.world.events.some((e) => e.region === region)) {
      const up = chance(g, 0.6);
      const days = randInt(g, 120, 240);
      addEvent(sim, { type: 'regional', title: up ? `${REGION_NAMES[region]} surges` : `${REGION_NAMES[region]} slows`, end: g.time + days * 1440, region, demand: up ? 1.1 : 0.9 });
      if (touchesPlayer(sim, undefined, region)) {
        addNews(sim, up ? 'good' : 'bad', up ? `Economic surge in ${REGION_NAMES[region]}` : `Slowdown in ${REGION_NAMES[region]}`,
          up ? 'Strong growth is lifting travel demand across the region.' : 'A regional slowdown is weighing on travel demand.');
      }
    }
  }

  // Rare: ash cloud grounds a whole region for a few days.
  if (chance(g, 1 / 2500)) {
    const region = pick(g, ['EUR', 'EAS', 'SEA', 'LAM'] as RegionId[]);
    const days = randInt(g, 3, 6);
    addEvent(sim, { type: 'ash', title: `Volcanic ash over ${REGION_NAMES[region]}`, end: g.time + days * 1440, region, demand: 0.6, disruption: 0.92 });
    addNews(sim, 'bad', `Volcanic ash closes skies over ${REGION_NAMES[region]}`, `An eruption has grounded flights across the region for around ${days} days.`);
  }
}

function expireEvents(sim: Sim): void {
  const g = sim.game;
  g.world.events = g.world.events.filter((e) => e.end > g.time);
}

// ───────────────────────── Second-hand market ─────────────────────────

function makeListing(sim: Sim): UsedListing {
  const g = sim.game;
  const type = weightedPick(g, AIRCRAFT_TYPES, (t) => (t.inProduction ? 1 : 2.4))!;
  const age = randInt(g, type.usedAge[0], type.usedAge[1]);
  const condition = Math.max(0.5, Math.min(0.95, 0.98 - age * 0.017 + randRange(g, -0.07, 0.07)));
  return {
    id: g.nextId++,
    type: type.id,
    age,
    condition,
    price: Math.round((marketValue(type.id, age, condition) * randRange(g, 0.9, 1.12) * sim.tuning.aircraftPrice) / 10_000) * 10_000,
    lease: Math.round((marketLease(type.id, age) * randRange(g, 0.92, 1.1) * sim.tuning.aircraftPrice) / 1_000) * 1_000,
    expires: g.time + randInt(g, 20, 60) * 1440,
    seller: pick(g, LESSORS),
  };
}

export function refreshUsedMarket(sim: Sim, initial = false): void {
  const g = sim.game;
  g.used = g.used.filter((u) => u.expires > g.time);
  const target = 14;
  let tries = 0;
  while (g.used.length < target && tries++ < 40) {
    if (!initial && g.used.length >= 9 && rand(g) > 0.25) break;
    const l = makeListing(sim);
    // Avoid a market flooded with one type.
    if (g.used.filter((u) => u.type === l.type).length >= 2) continue;
    g.used.push(l);
  }
}

export function listingTitle(l: UsedListing): string {
  const t = AIRCRAFT_TYPES.find((x) => x.id === l.type)!;
  return `${typeName(t)}, ${l.age} years old`;
}

// ───────────────────────── Daily step ─────────────────────────

export function stepWorld(sim: Sim): void {
  expireEvents(sim);
  stepFuel(sim);
  stepEconomy(sim);
  spawnEvents(sim);
  refreshUsedMarket(sim);
}
