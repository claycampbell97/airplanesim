import { describe, expect, it } from 'vitest';
import { acquireAircraft, openRoute, setRotation } from '../src/sim/actions';
import { AIRPORT, airportDistance } from '../src/sim/data/airports';
import { Sim } from '../src/sim/sim';
import { monthOfYear } from '../src/sim/time';
import type { Livery, WeatherSystem } from '../src/sim/types';
import { WEATHER_CLOSES, stepWeather, weatherAt, weatherIntensity, weatherOutlook, weatherOver, weatherPosition, weatherReport } from '../src/sim/weather';

const LIVERY: Livery = { primary: '#2563eb', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' };
const DAY = 1440;

function create(hq: string, seed = 7): Sim {
  return Sim.create({ name: 'Test Air', code: 'TA', hq, livery: LIVERY, difficulty: 'relaxed', seed });
}

/** A system that sits still at full strength from a day ago until two days from now, then fades. */
function park(sim: Sim, over: string, kind: WeatherSystem['kind'], title: string, strength: number, radius = 450): WeatherSystem {
  const t = sim.game.time;
  const ap = AIRPORT[over];
  const w: WeatherSystem = { id: sim.game.nextId++, kind, title, lat: ap.lat, lon: ap.lon, dLon: 0, dLat: 0, turn: 0, radius, strength, start: t - DAY, end: t + 3 * DAY, warned: [] };
  (sim.game.world.weather ??= []).push(w);
  sim.weatherNow = null;
  return w;
}

describe('weather', () => {
  it('brings the weather of the season, and never too much of it at once', () => {
    const sim = create('LHR');
    const g = sim.game;
    const born = new Map<number, { w: WeatherSystem; month: number }>();
    let most = 0;
    for (let d = 0; d < 3 * 365; d++) {
      g.time += DAY;
      stepWeather(sim);
      const list = g.world.weather ?? [];
      most = Math.max(most, list.length);
      for (const w of list) if (!born.has(w.id)) born.set(w.id, { w, month: monthOfYear(w.start) });
    }
    const all = [...born.values()];
    const count = (kind: string) => all.filter((x) => x.w.kind === kind).length;
    expect(most).toBeLessThanOrEqual(12);
    // Every kind turns up, and in sensible numbers: storms and thunder by the hundred, cyclones by the dozen.
    expect(count('storm')).toBeGreaterThan(200);
    expect(count('thunder')).toBeGreaterThan(400);
    for (const kind of ['snow', 'fog', 'sand', 'cyclone']) expect(count(kind)).toBeGreaterThan(30);
    expect(count('cyclone')).toBeLessThan(180);

    // Snow in the northern winter only, and not in the subtropics.
    for (const x of all.filter((x) => x.w.kind === 'snow')) {
      expect([10, 11, 0, 1, 2]).toContain(x.month);
      expect(x.w.lat).toBeGreaterThan(36);
      // Off the Atlantic it is rain and wind until well north.
      if (x.w.lon > -35 && x.w.lon < -8) expect(x.w.lat).toBeGreaterThan(53);
    }
    // Hurricanes and typhoons from late spring to autumn; southern cyclones in the southern summer.
    for (const x of all.filter((x) => x.w.kind === 'cyclone')) {
      if (x.w.lat > 0) expect(x.month >= 4 && x.month <= 11).toBe(true);
      else expect([11, 0, 1, 2, 3]).toContain(x.month);
      // They are named, each in turn, and they shut airports.
      expect(x.w.title).toMatch(/^(Hurricane|Typhoon|Cyclone) [A-Z]/);
      expect(x.w.strength).toBeGreaterThanOrEqual(WEATHER_CLOSES);
    }
    const names = all.filter((x) => x.w.kind === 'cyclone').sort((x, y) => x.w.id - y.w.id).map((x) => x.w.title.split(' ')[1]);
    expect(names[0]).not.toBe(names[1]);
    // Europe's thunderstorms belong to the warm half of the year.
    for (const x of all.filter((x) => x.w.kind === 'thunder' && x.w.lat > 42 && x.w.lon > -2 && x.w.lon < 26)) expect(x.month >= 4 && x.month <= 8).toBe(true);
    // Winter is the stormy season over the North Atlantic.
    const atlantic = all.filter((x) => (x.w.kind === 'storm' || x.w.kind === 'snow') && x.w.lon > -35 && x.w.lon < -8 && x.w.lat > 44);
    const inMonths = (ms: number[]) => atlantic.filter((x) => ms.includes(x.month)).length;
    expect(inMonths([11, 0, 1])).toBeGreaterThan(inMonths([5, 6, 7]) * 2);
  });

  it('travels, builds and fades, closing what lies under its core and only delaying its fringes', () => {
    const sim = create('LHR');
    const t = sim.game.time;
    const tpe = AIRPORT.TPE;
    // A typhoon born 8 degrees east of Taipei, heading west at 4 degrees a day: overhead on the second day.
    const w: WeatherSystem = { id: 900001, kind: 'cyclone', title: 'Typhoon Test', lat: tpe.lat, lon: tpe.lon + 8, dLon: -4, dLat: 0, turn: 0, radius: 450, strength: 1, start: t, end: t + 4 * DAY, warned: [] };
    sim.game.world.weather = [w];
    sim.weatherNow = null;

    expect(weatherPosition(w, t + 2 * DAY).lon).toBeCloseTo(tpe.lon, 5);
    expect(weatherIntensity(w, t)).toBe(0);
    expect(weatherIntensity(w, t + 2 * DAY)).toBeCloseTo(1, 5);
    expect(weatherIntensity(w, t + 4 * DAY)).toBe(0);
    expect(weatherIntensity(w, t + 3.5 * DAY)).toBeLessThan(0.6);

    // Nothing yet at birth; a brush with the outer bands a day out; shut when the core is overhead; clear once it has gone.
    expect(weatherAt(sim, tpe, t)).toBe(0);
    const fringe = weatherAt(sim, tpe, t + DAY);
    expect(fringe).toBeGreaterThan(0.05);
    expect(fringe).toBeLessThan(0.5);
    expect(weatherAt(sim, tpe, t + 2 * DAY)).toBeGreaterThanOrEqual(WEATHER_CLOSES);
    expect(weatherOver(sim, tpe, t + 2 * DAY)?.system).toBe(w);
    expect(weatherAt(sim, tpe, t + 4 * DAY)).toBe(0);
    // Manila, a thousand kilometres south of its track, never notices.
    expect(airportDistance('TPE', 'MNL')).toBeGreaterThan(1000);
    for (let h = 0; h <= 96; h += 3) expect(weatherAt(sim, AIRPORT.MNL, t + h * 60)).toBe(0);

    // The forecast sees it coming.
    const outlook = weatherOutlook(sim, tpe);
    expect(outlook?.system).toBe(w);
    expect(outlook!.from).toBeGreaterThan(t);
    expect(outlook!.worst).toBeGreaterThanOrEqual(WEATHER_CLOSES);
    expect(weatherOutlook(sim, AIRPORT.MNL)).toBeNull();

    // A recurving track swings round rather than running straight.
    const curved: WeatherSystem = { ...w, id: 900002, dLon: -5, dLat: 1, turn: -12 };
    const p3 = weatherPosition(curved, t + 3 * DAY);
    const straight = weatherPosition({ ...curved, turn: 0 }, t + 3 * DAY);
    expect(p3.lat).toBeGreaterThan(straight.lat + 1);
    expect(p3.lon).toBeGreaterThan(straight.lon + 1);
  });

  it('holds flights on the ground while an airport is shut, and lets them go again afterwards', { timeout: 120_000 }, () => {
    const sim = create('LHR', 11);
    const p = sim.player;
    const route = openRoute(sim, 0, 'LHR', 'EDI');
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    p.cash += 5e8;
    for (let i = 0; i < 2; i++) expect(acquireAircraft(sim, 0, 'a20n', { lease: false }).ok).toBe(true);
    for (const ac of sim.fleetOf(0)) setRotation(sim, ac.id, [route.value.id]);
    // Let them be delivered and settle into flying. (Clear skies, so that only the staged storm counts.)
    const clear = () => {
      sim.game.world.weather = (sim.game.world.weather ?? []).filter((w) => w.title === 'Blizzard Test');
      sim.weatherNow = null;
    };
    for (let d = 0; d < 6; d++) { sim.advance(DAY); clear(); }
    const before = p.totalFlights;
    expect(before).toBeGreaterThan(4);

    // A blizzard parks itself over London: two days shut, then it clears.
    const storm = park(sim, 'LHR', 'snow', 'Blizzard Test', 0.95);
    expect(weatherAt(sim, AIRPORT.LHR, sim.game.time)).toBeGreaterThanOrEqual(WEATHER_CLOSES);
    const report = weatherReport(sim).find((r) => r.system === storm)!;
    expect(report.over).toBe(true);
    expect(report.affected.map((a) => a.airport.id)).toContain('LHR');
    expect(report.affected.find((a) => a.airport.id === 'EDI')).toBeUndefined();

    // Anything already in the air lands; nothing more leaves.
    for (let h = 0; h < 6; h++) { sim.advance(60); clear(); }
    const during = p.totalFlights;
    const notes = new Set<string>();
    for (let h = 0; h < 36; h++) {
      sim.advance(60);
      clear();
      for (const ac of sim.fleetOf(0)) notes.add(ac.note ?? '');
    }
    expect(p.totalFlights).toBe(during);
    expect(notes).toContain('Held — blizzard test over London');
    expect(p.month.cancelled + p.today.cancelled).toBeGreaterThan(0);

    // Once it has blown through, they fly again.
    for (let d = 0; d < 4; d++) { sim.advance(DAY); clear(); }
    expect(sim.game.world.weather!.find((w) => w.id === storm.id)).toBeUndefined();
    expect(p.totalFlights).toBeGreaterThan(during + 4);
  });

  it('is part of the saved game, and old saves grow weather of their own', { timeout: 180_000 }, () => {
    const sim = create('SIN', 21);
    let systems = 0;
    for (let d = 0; d < 25; d++) {
      sim.advance(DAY);
      systems = Math.max(systems, sim.game.world.weather!.length);
    }
    expect(systems).toBeGreaterThan(0);
    const copy = Sim.load(sim.serialize());
    for (let d = 0; d < 6; d++) { sim.advance(DAY); copy.advance(DAY); }
    expect(copy.serialize()).toBe(sim.serialize());

    // A save from before there was weather.
    const old = JSON.parse(sim.serialize());
    delete old.world.weather;
    const revived = Sim.load(JSON.stringify(old));
    expect(revived.game.world.weather).toEqual([]);
    let seen = 0;
    for (let d = 0; d < 20; d++) {
      revived.advance(DAY);
      seen = Math.max(seen, revived.game.world.weather!.length);
    }
    expect(seen).toBeGreaterThan(0);
  });
});
