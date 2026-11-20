import { describe, expect, it } from 'vitest';
import { acquireAircraft, buyHedge, closeRoute, deliveryDays, developHub, launchPromo, openRoute, setAutoFares, setFareMode, setPolicy, setPrice, setRotation } from '../src/sim/actions';
import { AIRPORTS, pairIndex } from '../src/sim/data/airports';
import { baseDemand, expectedBoarded } from '../src/sim/demand';
import { buySlots, homeSlots, sellSlot, slotsHeld, slotsUsed } from '../src/sim/slots';
import { AIRCRAFT_TYPE } from '../src/sim/data/aircraft';
import { blockMinutes, getMarket, legsPerDay, MAX_BLOCK_HOURS, sectorFit, VIA_HUBS } from '../src/sim/market';
import { canOperate } from '../src/sim/ops';
import { planRoute, suggestRoutes } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';
import { ledgerCost, ledgerProfit, ledgerRevenue, takeLoan } from '../src/sim/finance';
import type { Livery } from '../src/sim/types';

const pairKeyOf = (r: { a: string; b: string }) => pairIndex(r.a, r.b);

const LIVERY: Livery = { primary: '#2563eb', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' };

function report(sim: Sim, label: string) {
  const g = sim.game;
  {
    // One line to compare runs by.
    const rivals = g.airlines.filter((a) => !a.isPlayer && a.history.length);
    const margins = rivals.map((a) => {
      // A full year where there is one, so that the season does not colour the answer.
      const h = a.history.slice(-12);
      const rev = h.reduce((n, r) => n + ledgerRevenue(r), 0);
      return rev > 0 ? h.reduce((n, r) => n + ledgerProfit(r), 0) / rev : 0;
    }).sort((x, y) => x - y);
    let ask = 0;
    let rpk = 0;
    for (const a of rivals) for (const r of a.history.slice(-12)) { ask += r.ask; rpk += r.rpk; }
    const fare = g.routes.length ? g.routes.reduce((n, r) => n + r.price[0] / sim.markets.get(pairKeyOf(r))!.ref[0], 0) / g.routes.length : 0;
    console.log(`SUMMARY ${label}: ${margins.filter((m) => m > 0).length}/${rivals.length} rivals profitable, median margin ${(margins[Math.floor(margins.length / 2)] * 100).toFixed(1)}%, quartiles ${(margins[Math.floor(margins.length / 4)] * 100).toFixed(1)}% / ${(margins[Math.floor(margins.length * 0.75)] * 100).toFixed(1)}%, load factor ${((rpk / Math.max(1, ask)) * 100).toFixed(1)}%, mean fare level ${(fare * 100).toFixed(0)}%, aircraft ${g.aircraft.length}, routes ${g.routes.length}`);
  }
  console.log(`\n== ${label}: day ${g.day}, aircraft ${g.aircraft.length}, routes ${g.routes.length}, markets ${sim.markets.size}, fuel ${g.world.fuelPrice.toFixed(3)}, economy ${g.world.economy.toFixed(3)}`);
  console.log('airline                   fleet routes   cash$M   rev$M/mo  margin   LF    yield  rep  otp');
  for (const al of g.airlines) {
    const h = al.history.slice(-3);
    if (!h.length) continue;
    const rev = h.reduce((n, r) => n + ledgerRevenue(r), 0) / h.length;
    const cost = h.reduce((n, r) => n + ledgerCost(r), 0) / h.length;
    const ask = h.reduce((n, r) => n + r.ask, 0);
    const rpk = h.reduce((n, r) => n + r.rpk, 0);
    if (process.env.BREAKDOWN && (al.id < 4 || al.id % 9 === 0)) {
      const tot: Record<string, number> = {};
      for (const r of h) for (const [k, v] of Object.entries(r.cost)) tot[k] = (tot[k] ?? 0) + v;
      const sum = Object.values(tot).reduce((a, b) => a + b, 0);
      console.log('   costs: ' + Object.entries(tot).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${((v / sum) * 100).toFixed(0)}%`).join(', ') + ` | CASK ${((sum / Math.max(1, ask)) * 100).toFixed(2)}c RASK ${((rev * h.length / Math.max(1, ask)) * 100).toFixed(2)}c | flights/ac/day ${(h.reduce((n, r) => n + r.flights, 0) / h.length / 30.4 / Math.max(1, sim.fleetOf(al.id).length)).toFixed(1)}`);
    }
    console.log(
      `${al.name.padEnd(24)} ${String(sim.fleetOf(al.id).length).padStart(5)} ${String(sim.routesOf(al.id).length).padStart(6)} ${(al.cash / 1e6).toFixed(0).padStart(8)} ${(rev / 1e6).toFixed(1).padStart(9)} ${(((rev - cost) / Math.max(1, rev)) * 100).toFixed(1).padStart(6)}% ${(ask ? (rpk / ask) * 100 : 0).toFixed(0).padStart(4)}% ${(rpk ? (rev * h.length / rpk) * 100 : 0).toFixed(1).padStart(6)} ${al.reputation.toFixed(0).padStart(4)} ${(al.otp * 100).toFixed(0).padStart(4)}`,
    );
  }
}

/** Where two games first differ: '' when they are the same to the last digit. */
function difference(x: Sim, y: Sim): string {
  const a = x.serialize();
  const b = y.serialize();
  if (a === b) return '';
  const out: string[] = [];
  const walk = (u: any, v: any, path: string) => {
    if (out.length >= 8 || u === v) return;
    if (u && v && typeof u === 'object' && typeof v === 'object') {
      for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) walk(u[k], v[k], `${path}.${k}`);
    } else out.push(`${path}: ${JSON.stringify(u)} vs ${JSON.stringify(v)}`);
  };
  walk(JSON.parse(a), JSON.parse(b), 'game');
  return out.join('; ');
}

describe('simulation', () => {
  it('runs a world of rival airlines without blowing up', { timeout: 300_000 }, () => {
    const t0 = performance.now();
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'LHR', livery: LIVERY, difficulty: 'standard', seed: Number(process.env.SEED ?? 3) });
    const t1 = performance.now();
    // A little over a year: airlines lose money in a northern winter and make it back in
    // summer, so anything shorter says more about the season than about the economy.
    // (The seed sets where the business cycle starts: this one begins on trend. A world
    // that opens in a downturn sees about half its airlines lose money in the first year.)
    const months = Number(process.env.MONTHS ?? 13);
    for (let d = 0; d < months * 30; d++) sim.advance(1440);
    const t2 = performance.now();
    if (process.env.REPORT) {
      console.log(`create ${(t1 - t0).toFixed(0)} ms; ${(months * 30)} days in ${(t2 - t1).toFixed(0)} ms = ${((t2 - t1) / (months * 30)).toFixed(2)} ms/day`);
      console.log('profile ms/day: ' + Object.entries(sim.profile).map(([k, v]) => `${k} ${(v / (months * 30)).toFixed(1)}`).join(', '));
      report(sim, 'rivals only');
    }
    const g = sim.game;
    expect(g.aircraft.length).toBeGreaterThan(200);
    for (const al of g.airlines) {
      expect(Number.isFinite(al.cash)).toBe(true);
      expect(Number.isFinite(al.reputation)).toBe(true);
    }
    for (const r of g.routes) {
      for (let d = 0; d < 2; d++) for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(r.rate[d][c])).toBe(true);
        expect(r.rate[d][c]).toBeGreaterThanOrEqual(0);
      }
    }
    // Most rivals should be making money over a year in a normal world, without it being easy.
    const rivals = g.airlines.filter((a) => !a.isPlayer && a.history.length);
    const yearProfit = (a: (typeof rivals)[number]) => a.history.slice(-12).reduce((n, r) => n + ledgerProfit(r), 0);
    const yearRevenue = (a: (typeof rivals)[number]) => a.history.slice(-12).reduce((n, r) => n + ledgerRevenue(r), 0);
    const profitable = rivals.filter((a) => yearProfit(a) > 0);
    expect(profitable.length).toBeGreaterThan(rivals.length * 0.65);
    const margins = rivals.map((a) => yearProfit(a) / Math.max(1, yearRevenue(a))).sort((x, y) => x - y);
    const median = margins[Math.floor(margins.length / 2)];
    expect(median).toBeGreaterThan(0.02);
    expect(median).toBeLessThan(0.16);
    // Aircraft fly with realistic loads: neither half empty nor implausibly full.
    let ask = 0;
    let rpk = 0;
    for (const a of rivals) for (const r of a.history.slice(-12)) { ask += r.ask; rpk += r.rpk; }
    expect(rpk / ask).toBeGreaterThan(0.74);
    expect(rpk / ask).toBeLessThan(0.9);
  });

  it('round-trips through a save file', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'SIN', livery: LIVERY, difficulty: 'relaxed', seed: 99 });
    for (let d = 0; d < 20; d++) sim.advance(1440);
    const copy = Sim.load(sim.serialize());
    for (let d = 0; d < 15; d++) { sim.advance(1440); copy.advance(1440); }
    expect(copy.game.time).toBe(sim.game.time);
    expect(copy.game.aircraft.length).toBe(sim.game.aircraft.length);
    // Deterministic: the reloaded world evolves identically.
    expect(difference(sim, copy)).toBe('');
  });

  it('replays exactly from a save, whatever was done just before it', { timeout: 180_000 }, () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 21 });
    sim.player.cash += 4e8;
    const fly = (s: Sim, dest: string, type: string) => {
      const r = openRoute(s, 0, 'MAN', dest);
      if (!r.ok || !acquireAircraft(s, 0, type, { lease: true }).ok) return;
      const fleet = s.fleetOf(0);
      setRotation(s, fleet[fleet.length - 1].id, [r.value.id]);
    };
    const answer = (s: Sim) => { for (const d of [...s.game.decisions]) s.resolveDecision(d.id, 0); };
    for (const [dest, type] of [['DUB', 'at76'], ['AMS', 'a20n'], ['BCN', 'a20n'], ['EDI', 'at76'], ['JFK', 'a21n']]) fly(sim, dest, type);
    for (let d = 0; d < 45; d++) sim.advance(1440);
    // The middle of an afternoon, with aircraft in the air and a decision or two waiting.
    sim.advance(517);
    expect(sim.fleetOf(0).some((a) => a.phase === 'enroute')).toBe(true);

    // Earlier in the day a rival on one of these routes, and one of ours, ran hours late:
    // reputations have moved since midnight.
    const shared = sim.routesOf(0).map((r) => getMarket(sim, r.a, r.b).routes.find((x) => x.airline !== 0)).find((x) => x)!;
    expect(shared).toBeDefined();
    sim.onLongDelay(sim.fleetOf(shared.airline)[0], 300);
    sim.onLongDelay(sim.fleetOf(0)[0], 300);

    // A burst of moves, then a save before the clock has run another minute.
    const burst = (s: Sim) => {
      const routes = s.routesOf(0);
      const fleet = s.fleetOf(0);
      fly(s, 'CDG', 'a20n');
      setFareMode(s, routes[0].id, false);
      setPrice(s, routes[0].id, [routes[0].price[0] * 1.1, routes[0].price[1], routes[0].price[2] * 0.9]);
      launchPromo(s, routes[1].id);
      developHub(s, 0, 'DUB');
      buyHedge(s, 0, 0.4, 6);
      takeLoan(s, s.player, 15e6, 36);
      setRotation(s, fleet[2].id, [routes[1].id, routes[2].id]);
      answer(s);
    };
    burst(sim);
    const copy = Sim.load(sim.serialize());
    expect(difference(sim, copy)).toBe('');
    for (let h = 0; h < 6; h++) {
      sim.advance(60); copy.advance(60);
      expect(difference(sim, copy)).toBe('');
    }

    // The same moves made in both games land the same way: first ones that stir every
    // market we fly in, rivals' offers and all, then the rest.
    const reprice = (s: Sim) => {
      for (const r of s.routesOf(0)) setPrice(s, r.id, [r.price[0] + 2, r.price[1], r.price[2]]);
    };
    reprice(sim); reprice(copy);
    expect(difference(sim, copy)).toBe('');
    const later = (s: Sim) => {
      const routes = s.routesOf(0);
      const fleet = s.fleetOf(0);
      closeRoute(s, routes[3].id);
      setRotation(s, fleet[3].id, [routes[0].id]);
      setAutoFares(s, 0, false);
      setAutoFares(s, 0, true);
      buySlots(s, 0, 'AMS', 2);
      fly(s, 'LHR', 'a20n');
      setPolicy(s, 0, { service: 4, ancillary: 2, marketing: 250_000 });
    };
    later(sim); later(copy);
    expect(difference(sim, copy)).toBe('');
    // Through a month end, answering whatever comes up in the same way in both.
    for (let d = 0; d < 36; d++) {
      sim.advance(1440); copy.advance(1440);
      answer(sim); answer(copy);
      expect(difference(sim, copy)).toBe('');
    }
    expect(sim.player.totalFlights).toBeGreaterThan(1500);
  });

  it('finishes the day before announcing the end of a month, so that an autosave holds a whole day', { timeout: 120_000 }, () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 8 });
    const plan = suggestRoutes(sim, sim.player, 'MAN', 'a20n', 1)[0];
    const route = openRoute(sim, 0, plan.a, plan.b);
    expect(route.ok && acquireAircraft(sim, 0, 'a20n', { lease: true }).ok).toBe(true);
    if (route.ok) setRotation(sim, sim.fleetOf(0)[0].id, [route.value.id]);
    // What the interface does: save on hearing that a month has ended.
    const saves: string[] = [];
    sim.on('month', () => saves.push(sim.serialize()));
    while (saves.length < 2) sim.advance(1440);
    const copy = Sim.load(saves[1]);
    expect(copy.game.time % 1440).toBe(0);
    copy.advance(sim.game.time - copy.game.time);
    expect(difference(sim, copy)).toBe('');
    for (let d = 0; d < 8; d++) { sim.advance(1440); copy.advance(1440); }
    expect(difference(sim, copy)).toBe('');
  });

  it('gets a new airline flying within the first week', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 5 });
    const p = sim.player;
    const plan = suggestRoutes(sim, p, p.hq, 'a20n', 1)[0];
    expect(plan).toBeDefined();
    const route = openRoute(sim, 0, plan.a, plan.b);
    expect(route.ok).toBe(true);
    // The first aircraft comes out of the lessor's stock; later ones wait for the factory.
    const first = acquireAircraft(sim, 0, 'a20n', { lease: true });
    const second = acquireAircraft(sim, 0, 'a20n', { lease: true });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok || !route.ok) return;
    expect(first.value.deliver - sim.game.time).toBe(3 * 1440);
    expect(second.value.deliver - sim.game.time).toBe(deliveryDays('a20n') * 1440);
    setRotation(sim, sim.fleetOf(0)[0].id, [route.value.id]);
    for (let d = 0; d < 7; d++) sim.advance(1440);
    expect(p.totalFlights).toBeGreaterThan(0);
    expect(p.totalPax).toBeGreaterThan(0);
  });

  it('expects fewer passengers than seats or demand when bookings swing', () => {
    expect(expectedBoarded(50, 180)).toBe(50);
    expect(expectedBoarded(400, 180)).toBe(180);
    // Demand equal to capacity: some flights go out with empty seats, others leave people behind.
    const even = expectedBoarded(180, 180);
    expect(even).toBeLessThan(180);
    expect(even).toBeGreaterThan(150);
    // More demand never means fewer passengers.
    let last = 0;
    for (let d = 0; d <= 400; d += 10) {
      const b = expectedBoarded(d, 180);
      expect(b).toBeGreaterThanOrEqual(last);
      expect(b).toBeLessThanOrEqual(Math.min(d, 180) + 1e-9);
      last = b;
    }
  });

  it('manages fares: up from too cheap, down from too dear, and never on a manual route', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 11 });
    const p = sim.player;
    p.cash += 3e9;
    p.reputation = 60;
    const fly = (dest: string, level: number, auto: boolean) => {
      const route = openRoute(sim, 0, 'MAN', dest);
      const order = acquireAircraft(sim, 0, 'a20n', { lease: true });
      if (!route.ok || !order.ok) throw new Error('setup failed');
      expect(route.value.auto).toBe(true);
      const r = route.value;
      if (!setRotation(sim, sim.fleetOf(0)[sim.fleetOf(0).length - 1].id, [r.id]).ok) throw new Error(`could not assign ${dest}`);
      // Start from a fare that is plainly wrong, by hand, then hand over (or not).
      setFareMode(sim, r.id, false);
      const ref = getMarket(sim, r.a, r.b).ref;
      setPrice(sim, r.id, [ref[0] * level, ref[1] * level, ref[2] * level]);
      return r;
    };
    const level = (r: ReturnType<typeof fly>) => r.price[0] / getMarket(sim, r.a, r.b).ref[0];
    const cheap = fly('MAD', 0.5, true);
    const dear = fly('FCO', 2, true);
    const manual = fly('BCN', 1.6, false);
    for (let d = 0; d < 20; d++) sim.advance(1440);
    // Aircraft delivered and flying: now let revenue management loose on two of them.
    setFareMode(sim, cheap.id, true);
    setFareMode(sim, dear.id, true);
    const manualFare = [...manual.price];
    for (let d = 0; d < 60; d++) sim.advance(1440);
    expect(level(cheap)).toBeGreaterThan(0.6);
    expect(level(dear)).toBeLessThan(1.6);
    expect(manual.price).toEqual(manualFare);
    // Managed fares stay inside the band.
    for (const r of [cheap, dear]) {
      expect(level(r)).toBeGreaterThanOrEqual(0.49);
      expect(level(r)).toBeLessThanOrEqual(2.01);
    }
    // And a managed route out-earns the same aircraft left at a fare nobody will pay.
    const profit = (r: typeof cheap) => r.prev.revenue - r.prev.cost;
    expect(profit(dear)).toBeGreaterThan(profit(manual));
  });

  it('keeps aircraft to realistic daily hours, and flies as often as the frequency model says', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 21 });
    const p = sim.player;
    p.cash += 3e9;
    // Short, medium and long sectors.
    const cases: [string, string][] = [['DUB', 'at76'], ['MAD', 'a20n'], ['TLV', 'a20n'], ['ORD', 'b789'], ['SIN', 'a359']];
    const flown = cases.map(([dest, type]) => {
      const route = openRoute(sim, 0, 'MAN', dest);
      const order = acquireAircraft(sim, 0, type, { lease: true });
      if (!route.ok || !order.ok) throw new Error(`setup failed for ${dest}`);
      const ac = sim.fleetOf(0)[sim.fleetOf(0).length - 1];
      if (!setRotation(sim, ac.id, [route.value.id]).ok) throw new Error(`could not assign ${dest}`);
      return { ac, route: route.value };
    });
    for (let d = 0; d < 40; d++) sim.advance(1440);
    // (Lifetime figures already include last month's.)
    const startFlights = flown.map((f) => f.route.cur.flights + f.route.life.flights);
    const days = 60;
    for (let d = 0; d < days; d++) sim.advance(1440);
    flown.forEach(({ ac, route }, i) => {
      const flights = route.cur.flights + route.life.flights - startFlights[i];
      const perDay = flights / days;
      const hours = (perDay * blockMinutes(ac.type, route.dist)) / 60;
      if (process.env.REPORT) console.log(`${ac.type} ${route.a}-${route.b} ${Math.round(route.dist)} km: ${perDay.toFixed(2)} flights/day (model ${legsPerDay(sim, ac).toFixed(2)}), ${hours.toFixed(2)} h/day, block ${blockMinutes(ac.type, route.dist).toFixed(0)} min, ac.hours/day ${(ac.hours / 100).toFixed(2)}`);
      expect(hours).toBeLessThanOrEqual(MAX_BLOCK_HOURS[AIRCRAFT_TYPE[ac.type].category] * 1.02);
      // Within a tenth of the forecast frequency (faults and delays cost a little).
      expect(perDay).toBeGreaterThan(legsPerDay(sim, ac) * 0.88);
      expect(perDay).toBeLessThan(legsPerDay(sim, ac) * 1.08);
    });
  });

  it('fits aircraft to their missions and gives long routes a rival in the change of planes', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 21 });
    const p = sim.player;
    // On paper an A320neo reaches New York from Manchester; with reserves into the wind it does not.
    expect(AIRCRAFT_TYPE.a20n.range).toBeGreaterThan(getMarket(sim, 'MAN', 'JFK').dist);
    expect(canOperate('a20n', 'MAN', 'JFK').ok).toBe(false);
    expect(canOperate('a21n', 'MAN', 'JFK').ok).toBe(true);
    // Nobody wants two and a half hours in a turboprop: its best routes are the short ones.
    expect(sectorFit('at76', 300)).toBeCloseTo(0, 6);
    expect(sectorFit('at76', 1000)).toBeLessThan(-0.3);
    expect(sectorFit('a20n', 1000)).toBeCloseTo(0, 6);
    const props = suggestRoutes(sim, p, 'MAN', 'at76', 5);
    expect(props.length).toBeGreaterThan(0);
    for (const plan of props) expect(plan.dist).toBeLessThan(800);
    // A jet from Manchester earns its keep on the big markets of the Mediterranean and the capitals nearby.
    const jets = suggestRoutes(sim, p, 'MAN', 'a20n', 6);
    for (const plan of jets) {
      expect(plan.dist).toBeLessThan(3600);
      expect(baseDemand(plan.a, plan.b)).toBeGreaterThan(400);
    }
    // A short hop has no connecting rival; a long thin route always has one, however alone you are on it.
    expect(getMarket(sim, 'MAN', 'DUB').via.freq).toBe(0);
    const thin = getMarket(sim, 'MAN', 'JNB');
    expect(thin.via.freq).toBeGreaterThan(1);
    const alone = planRoute(sim, p, 'MAN', 'JNB', 'b789');
    expect(alone.estimate.competitors.some((c) => c.airline === VIA_HUBS && c.pax > 0)).toBe(true);
    expect(alone.estimate.share).toBeLessThan(0.9);
    // ...which keeps the fare on it within sight of the going rate.
    expect(alone.price[0]).toBeLessThan(alone.estimate.ref[0] * 1.5);
  });

  it('rations departures at slot-limited airports', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'LHR', livery: LIVERY, difficulty: 'standard', seed: 31 });
    const p = sim.player;
    p.cash += 3e9;
    const home = homeSlots(sim.airport('LHR'));
    expect(slotsHeld(p, 'LHR')).toBe(home);
    expect(slotsHeld(p, 'MAN')).toBe(Infinity);

    // Short flights eat slots quickly: keep adding aircraft to Amsterdam until Heathrow says no.
    const route = openRoute(sim, 0, 'LHR', 'AMS');
    if (!route.ok) throw new Error('setup failed');
    // The first route to another slot-limited airport comes with a newcomer's pair of slots.
    expect(slotsHeld(p, 'AMS')).toBe(2);
    buySlots(sim, 0, 'AMS', 40);
    let refused = '';
    let flying = 0;
    for (let i = 0; i < 12 && !refused; i++) {
      const order = acquireAircraft(sim, 0, 'a20n', { lease: false });
      if (!order.ok) throw new Error(order.reason);
      const res = setRotation(sim, sim.fleetOf(0)[sim.fleetOf(0).length - 1].id, [route.value.id]);
      if (res.ok) flying += 1;
      else refused = res.reason;
    }
    expect(refused).toMatch(/Not enough slots at London/);
    expect(flying).toBeGreaterThan(0);
    expect(slotsUsed(sim, p, 'LHR')).toBeLessThanOrEqual(home + 0.05);

    // Buying slots makes room for the aircraft that was turned away.
    const before = p.cash;
    const bought = buySlots(sim, 0, 'LHR', 6);
    expect(bought.ok).toBe(true);
    expect(p.cash).toBeLessThan(before);
    const parked = sim.fleetOf(0)[sim.fleetOf(0).length - 1];
    expect(setRotation(sim, parked.id, [route.value.id]).ok).toBe(true);

    // Slots in use cannot be sold; taking an aircraft off always works and frees them.
    while (sellSlot(sim, 0, 'LHR').ok) { /* sell the spare ones */ }
    expect(slotsUsed(sim, p, 'LHR')).toBeGreaterThan(slotsHeld(p, 'LHR') - 1);
    expect(setRotation(sim, parked.id, []).ok).toBe(true);
    expect(sellSlot(sim, 0, 'LHR').ok).toBe(true);
  });

  it('grandfathers slots when loading a save from before slots existed', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'LHR', livery: LIVERY, difficulty: 'standard', seed: 51 });
    sim.player.cash += 1e9;
    const route = openRoute(sim, 0, 'LHR', 'AMS');
    if (!route.ok) throw new Error('setup failed');
    buySlots(sim, 0, 'AMS', 6);
    acquireAircraft(sim, 0, 'a20n', { lease: true });
    expect(setRotation(sim, sim.fleetOf(0)[0].id, [route.value.id]).ok).toBe(true);
    const used = slotsUsed(sim, sim.player, 'AMS');
    expect(used).toBeGreaterThan(3);

    // An old save knows nothing of slots.
    const old = JSON.parse(sim.serialize());
    delete old.airlines[0].slots;
    for (const key of Object.keys(old.flags)) if (key.startsWith('slots:')) delete old.flags[key];
    const loaded = Sim.load(JSON.stringify(old));
    expect(slotsHeld(loaded.player, 'LHR')).toBeGreaterThanOrEqual(homeSlots(loaded.airport('LHR')));
    expect(slotsHeld(loaded.player, 'AMS')).toBeGreaterThanOrEqual(Math.floor(used));
    // What was flying can keep flying: putting the same rotation back is not refused.
    const ac = loaded.fleetOf(0)[0];
    expect(setRotation(loaded, ac.id, [...ac.rotation]).ok).toBe(true);
  });

  it('keeps rivals within their slots', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 41 });
    for (let d = 0; d < 120; d++) sim.advance(1440);
    const limited = AIRPORTS.filter((a) => a.slotLimited);
    expect(limited.length).toBeGreaterThan(10);
    for (const al of sim.game.airlines) {
      if (!al.ai) continue;
      for (const ap of limited) {
        // (Rivals plan with estimated frequencies, so allow them a flight's worth of slack.)
        expect(slotsUsed(sim, al, ap.id)).toBeLessThanOrEqual(slotsHeld(al, ap.id) + 1);
      }
    }
  });

  it('lapses an unanswered decision on its stated day', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 5 });
    const g = sim.game;
    g.decisions.push({
      id: g.nextId++, expires: g.time + 2 * 1440, type: 'endorsement', title: 'Test', body: 'Test',
      options: [{ label: 'Yes', detail: '' }, { label: 'No', detail: '' }], data: {},
    });
    sim.advance(1440);
    expect(g.decisions.length).toBe(1);
    for (let d = 0; d < 2; d++) sim.advance(1440);
    expect(g.decisions.length).toBe(0);
  });
});
