import { describe, expect, it } from 'vitest';
import { acquireAircraft, closeRoute, disposeAircraft, openRoute, setRotation } from '../src/sim/actions';
import { AIRCRAFT_TYPE } from '../src/sim/data/aircraft';
import { getMarket } from '../src/sim/market';
import { equity, ledgerCost, ledgerProfit, ledgerRevenue, leaseCapacity, leaseCommitment, valuation } from '../src/sim/finance';
import { suggestRoutes } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';
import type { Difficulty, Livery } from '../src/sim/types';

const LIVERY: Livery = { primary: '#2563eb', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' };
const VERBOSE = !!process.env.REPORT;

/**
 * A simple but sensible player: leases the aircraft that promises the best
 * return on the best available route from its home base, whenever lessors and
 * the bank balance allow, and leaves fares at the market reference.
 */
function runBot(hq: string, difficulty: Difficulty, types: string[], months: number, seed = 7) {
  const sim = Sim.create({ name: 'Bot Air', code: 'BT', hq, livery: LIVERY, difficulty, seed });
  const p = sim.player;
  const log: string[] = [];
  const forecasts = new Map<number, { lf: number; profit: number }>();
  for (let m = 0; m < months; m++) {
    // Expand at the start of each month.
    for (let tries = 0; tries < 3; tries++) {
      if (p.cash < 12e6) break;
      let best: { type: string; plan: ReturnType<typeof suggestRoutes>[number] } | null = null;
      for (const type of types) {
        const lease = AIRCRAFT_TYPE[type].lease * sim.tuning.aircraftPrice;
        if (leaseCommitment(sim, p) + lease > leaseCapacity(sim, p)) continue;
        const plans = suggestRoutes(sim, p, hq, type, 1);
        if (plans.length && plans[0].profitPerDay > 0 && (!best || plans[0].profitPerDay > best.plan.profitPerDay)) best = { type, plan: plans[0] };
      }
      if (!best) break;
      const route = openRoute(sim, 0, best.plan.a, best.plan.b);
      if (!route.ok) break;
      forecasts.set(route.value.id, { lf: best.plan.estimate.loadFactor, profit: best.plan.profitPerDay * 30 });
      const order = acquireAircraft(sim, 0, best.type, { lease: true });
      if (!order.ok) break;
      const ac = sim.fleetOf(0)[sim.fleetOf(0).length - 1];
      setRotation(sim, ac.id, [route.value.id]);
    }
    for (let d = 0; d < 30; d++) sim.advance(1440);

    // Basic housekeeping any player would do: redeploy aircraft from routes that keep
    // losing money. (Fares are left to revenue management.)
    for (const r of [...sim.routesOf(0)]) {
      if (r.prev.flights < 8) continue;
      if (r.lossMonths >= 3) {
        const planes = r.aircraft.map((id) => sim.acById.get(id)!);
        closeRoute(sim, r.id);
        for (const ac of planes) {
          const plans = suggestRoutes(sim, p, hq, ac.type, 1, { aircraft: ac });
          if (plans.length && plans[0].profitPerDay > 0) {
            const opened = openRoute(sim, 0, plans[0].a, plans[0].b);
            if (opened.ok) setRotation(sim, ac.id, [opened.value.id]);
          } else disposeAircraft(sim, ac.id);
        }
      }
    }
    const rec = p.history[p.history.length - 1];
    if (rec) {
      const rev = ledgerRevenue(rec);
      log.push(`  m${String(m + 1).padStart(2)} fleet ${String(sim.fleetOf(0).length).padStart(3)} routes ${String(sim.routesOf(0).length).padStart(3)} cash ${(p.cash / 1e6).toFixed(1).padStart(8)}M rev ${(rev / 1e6).toFixed(2).padStart(7)}M profit ${(ledgerProfit(rec) / 1e6).toFixed(2).padStart(7)}M margin ${(rev ? (ledgerProfit(rec) / rev) * 100 : 0).toFixed(0).padStart(4)}% LF ${(rec.ask ? (rec.rpk / rec.ask) * 100 : 0).toFixed(0)}% rep ${p.reputation.toFixed(0)} equity ${(equity(sim, p) / 1e6).toFixed(0)}M value ${(valuation(sim, p) / 1e6).toFixed(0)}M`);
    }
  }
  if (VERBOSE) {
    console.log(`\n=== ${hq} / ${difficulty} / ${types.join(',')} ===`);
    console.log(log.filter((_, i) => i < 6 || i % 3 === 2).join('\n'));
    const last = p.history[p.history.length - 1];
    const cost = ledgerCost(last);
    console.log('  cost mix: ' + Object.entries(last.cost).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${((v / cost) * 100).toFixed(0)}%`).join(', '));
    const conn = sim.routesOf(0).reduce((n, r) => n + r.prev.connPax, 0);
    console.log(`  connecting share ${((conn / Math.max(1, last.pax)) * 100).toFixed(0)}%`);
    console.log('  routes: ' + sim.routesOf(0).slice(0, 12).map((r) => {
      const seats = r.prev.seats[0] + r.prev.seats[1] + r.prev.seats[2];
      const pax = r.prev.pax[0] + r.prev.pax[1] + r.prev.pax[2];
      const f = forecasts.get(r.id);
      const level = r.price[0] / getMarket(sim, r.a, r.b).ref[0];
      return `${r.a}-${r.b} LF ${seats ? ((pax / seats) * 100).toFixed(0) : 0}% (fc ${f ? (f.lf * 100).toFixed(0) : '?'}%) fare ${(level * 100).toFixed(0)}% ${((r.prev.revenue - r.prev.cost) / 1e3).toFixed(0)}k (fc ${f ? (f.profit / 1e3).toFixed(0) : '?'}k)`;
    }).join(' | '));
  }
  return sim;
}

describe('balance', () => {
  it('lets a sensible player build a profitable airline on standard difficulty', () => {
    const months = Number(process.env.MONTHS ?? 18);
    const sim = runBot('MAN', 'standard', ['a20n', 'e295', 'at76'], months);
    const p = sim.player;
    expect(p.bankrupt).toBe(false);
    expect(sim.fleetOf(0).length).toBeGreaterThanOrEqual(3);
    // A hands-off strategy should hover around break-even: neither a death spiral
    // nor a licence to print money.
    const recent = p.history.slice(-12);
    const margin = recent.reduce((n, r) => n + ledgerProfit(r), 0) / recent.reduce((n, r) => n + ledgerRevenue(r), 0);
    expect(margin).toBeGreaterThan(-0.12);
    expect(margin).toBeLessThan(0.35);
  });

  it.runIf(VERBOSE)('reports the opening moves on offer at a range of home bases', { timeout: 300_000 }, () => {
    const difficulty = (process.env.DIFFICULTY ?? 'standard') as Difficulty;
    console.log(`\n=== opening moves (${difficulty}): profitable suggestions out of 8, and the best daily profit ===`);
    for (const hq of ['LHR', 'MAN', 'JFK', 'ATL', 'DEN', 'BOI', 'SIN', 'HND', 'DXB', 'GRU', 'SYD', 'JNB', 'DEL', 'LIS', 'KEF']) {
      const sim = Sim.create({ name: 'Bot Air', code: 'BT', hq, livery: LIVERY, difficulty, seed: 7 });
      const cells = ['at76', 'e295', 'a20n', 'b789'].map((type) => {
        const plans = suggestRoutes(sim, sim.player, hq, type, 8);
        const good = plans.filter((x) => x.profitPerDay > 0);
        const best = plans[0];
        return `${type} ${good.length}/${plans.length} ${best ? `${best.b} ${(best.profitPerDay / 1e3).toFixed(1)}k` : '-'}`.padEnd(24);
      });
      console.log(`  ${hq}  ${cells.join('')}`);
    }
  });

  it.runIf(VERBOSE)('reports what widebodies can earn once an airline is established', { timeout: 900_000 }, () => {
    const months = Number(process.env.MONTHS ?? 14);
    for (const hq of ['LHR', 'SIN', 'JFK']) {
      const sim = runBot(hq, 'standard', ['a20n', 'e295', 'a21n'], months);
      const p = sim.player;
      console.log(`\n=== widebodies from ${hq} after ${months} months: fleet ${sim.fleetOf(0).length}, reputation ${p.reputation.toFixed(0)}, hub level ${p.hubs[0].level} ===`);
      for (const type of ['b789', 'a359', 'b77w', 'a388']) {
        const plans = suggestRoutes(sim, p, hq, type, 6);
        console.log(`  ${type}: ` + plans.map((x) => `${x.b} ${(x.profitPerDay / 1e3).toFixed(0)}k LF ${(x.estimate.loadFactor * 100).toFixed(0)}%`).join(' | '));
      }
    }
  });

  it.runIf(VERBOSE)('reports other starting points', { timeout: 900_000 }, () => {
    const months = Number(process.env.MONTHS ?? 18);
    runBot('SIN', 'standard', ['a20n', 'b789', 'a21n'], months);
    runBot('GRU', 'ruthless', ['a20n', 'e295', 'at76'], months);
    runBot('BOI', 'standard', ['at76', 'e175', 'a20n'], months);
  });
});
