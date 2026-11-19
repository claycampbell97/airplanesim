import { describe, expect, it } from 'vitest';
import { acquireAircraft, deliveryDays, openRoute, setFareMode, setPrice, setRotation } from '../src/sim/actions';
import { AIRPORTS, pairIndex } from '../src/sim/data/airports';
import { expectedBoarded } from '../src/sim/demand';
import { buySlots, homeSlots, sellSlot, slotsHeld, slotsUsed } from '../src/sim/slots';
import { AIRCRAFT_TYPE } from '../src/sim/data/aircraft';
import { blockMinutes, getMarket, legsPerDay, MAX_BLOCK_HOURS } from '../src/sim/market';
import { suggestRoutes } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';
import { ledgerCost, ledgerProfit, ledgerRevenue } from '../src/sim/finance';
import type { Livery } from '../src/sim/types';

const pairKeyOf = (r: { a: string; b: string }) => pairIndex(r.a, r.b);

const LIVERY: Livery = { primary: '#2563eb', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' };

function report(sim: Sim, label: string) {
  const g = sim.game;
  {
    // One line to compare runs by.
    const rivals = g.airlines.filter((a) => !a.isPlayer && a.history.length);
    const margins = rivals.map((a) => {
      const h = a.history.slice(-3);
      const rev = h.reduce((n, r) => n + ledgerRevenue(r), 0);
      return rev > 0 ? h.reduce((n, r) => n + ledgerProfit(r), 0) / rev : 0;
    }).sort((x, y) => x - y);
    let ask = 0;
    let rpk = 0;
    for (const a of rivals) for (const r of a.history.slice(-3)) { ask += r.ask; rpk += r.rpk; }
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

describe('simulation', () => {
  it('runs a world of rival airlines without blowing up', () => {
    const t0 = performance.now();
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'LHR', livery: LIVERY, difficulty: 'standard', seed: 12345 });
    const t1 = performance.now();
    const months = Number(process.env.MONTHS ?? 4);
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
        expect(Number.isFinite(r.pool[d][c])).toBe(true);
        expect(r.pool[d][c]).toBeGreaterThanOrEqual(0);
      }
    }
    // Most rivals should be making money in a normal world.
    const rivals = g.airlines.filter((a) => !a.isPlayer && a.history.length);
    const profitable = rivals.filter((a) => a.history.slice(-3).reduce((n, r) => n + ledgerProfit(r), 0) > 0);
    expect(profitable.length).toBeGreaterThan(rivals.length * 0.5);
  });

  it('round-trips through a save file', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'SIN', livery: LIVERY, difficulty: 'relaxed', seed: 99 });
    for (let d = 0; d < 20; d++) sim.advance(1440);
    const copy = Sim.load(sim.serialize());
    for (let d = 0; d < 15; d++) { sim.advance(1440); copy.advance(1440); }
    expect(copy.game.time).toBe(sim.game.time);
    expect(copy.game.aircraft.length).toBe(sim.game.aircraft.length);
    // Deterministic: the reloaded world evolves identically.
    for (let i = 0; i < sim.game.airlines.length; i++) {
      expect(copy.game.airlines[i].cash).toBeCloseTo(sim.game.airlines[i].cash, 0);
    }
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
    const cases: [string, string][] = [['DUB', 'at76'], ['MAD', 'a20n'], ['DXB', 'a20n'], ['ORD', 'b789'], ['SIN', 'a359']];
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
