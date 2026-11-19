import { describe, expect, it } from 'vitest';
import { acquireAircraft, deliveryDays, openRoute, setFareMode, setRotation } from '../src/sim/actions';
import { expectedBoarded } from '../src/sim/demand';
import { getMarket } from '../src/sim/market';
import { suggestRoutes } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';
import { ledgerCost, ledgerProfit, ledgerRevenue } from '../src/sim/finance';
import type { Livery } from '../src/sim/types';

const LIVERY: Livery = { primary: '#2563eb', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' };

function report(sim: Sim, label: string) {
  const g = sim.game;
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

  it('manages fares: dearer where flights are full, cheaper where they are empty, untouched when manual', () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'LHR', livery: LIVERY, difficulty: 'standard', seed: 11 });
    const p = sim.player;
    p.cash += 3e9;
    p.reputation = 60;
    const fly = (dest: string, type: string, auto: boolean) => {
      const route = openRoute(sim, 0, 'LHR', dest);
      const order = acquireAircraft(sim, 0, type, { lease: true });
      if (!route.ok || !order.ok) throw new Error('setup failed');
      expect(route.value.auto).toBe(true);
      if (!auto) setFareMode(sim, route.value.id, false);
      setRotation(sim, sim.fleetOf(0)[sim.fleetOf(0).length - 1].id, [route.value.id]);
      return route.value;
    };
    // A turboprop into a huge market fills at any sensible fare; a 777 on a thin route cannot.
    const small = fly('AMS', 'at76', true);
    const big = fly('KEF', 'b779', true);
    const manual = fly('MAD', 'a20n', false);
    const manualFare = [...manual.price];
    for (let d = 0; d < 90; d++) sim.advance(1440);
    const level = (r: typeof small) => r.price[0] / getMarket(sim, r.a, r.b).ref[0];
    expect(level(small)).toBeGreaterThan(1.1);
    expect(level(big)).toBeLessThan(0.9);
    expect(manual.price).toEqual(manualFare);
    // Managed fares stay inside the band.
    for (const r of [small, big]) {
      expect(level(r)).toBeGreaterThanOrEqual(0.49);
      expect(level(r)).toBeLessThanOrEqual(2.01);
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
