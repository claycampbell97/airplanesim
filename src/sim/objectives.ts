// Milestones that give the player direction and a little prize money.

import { AIRCRAFT_TYPE } from './data/aircraft';
import { AIRPORT } from './data/airports';
import { ledgerProfit, totalDebt, valuation } from './finance';
import type { Objective } from './types';
import type { Sim } from './sim';

interface ObjectiveDef {
  id: string;
  title: string;
  detail: string;
  reward: number;
  /** Returns progress 0..1; 1 means achieved. */
  progress: (sim: Sim) => number;
}

const M = 1_000_000;
const ratio = (value: number, goal: number) => Math.max(0, Math.min(1, value / goal));

function monthlyPaxRank(sim: Sim): number {
  const mine = sim.player.history[sim.player.history.length - 1]?.pax ?? 0;
  let rank = 1;
  for (const al of sim.game.airlines) {
    if (al.isPlayer || al.bankrupt) continue;
    if ((al.history[al.history.length - 1]?.pax ?? 0) > mine) rank++;
  }
  return rank;
}

const ASIA = new Set(['MEA', 'SCA', 'EAS', 'SEA']);

function continentsServed(sim: Sim): number {
  const seen = new Set<string>();
  for (const r of sim.routesOf(0)) {
    for (const id of [r.a, r.b]) {
      const region = AIRPORT[id].region;
      seen.add(ASIA.has(region) ? 'ASIA' : region);
    }
  }
  return seen.size;
}

export const OBJECTIVES: ObjectiveDef[] = [
  { id: 'first_aircraft', title: 'Wheels', detail: 'Take delivery of your first aircraft', reward: 0.5 * M, progress: (s) => (s.fleetOf(0).some((a) => a.phase !== 'delivery') ? 1 : 0) },
  { id: 'first_route', title: 'Open for business', detail: 'Open your first route', reward: 0.5 * M, progress: (s) => (s.routesOf(0).length ? 1 : 0) },
  { id: 'first_flight', title: 'Positive rate', detail: 'Complete your first flight', reward: 0.5 * M, progress: (s) => (s.player.totalFlights > 0 ? 1 : 0) },
  { id: 'first_profit', title: 'In the black', detail: 'Finish a month with a profit', reward: 2 * M, progress: (s) => (s.player.history.some((h) => ledgerProfit(h) > 0 && h.flights > 0) ? 1 : 0) },
  { id: 'fleet_5', title: 'A proper fleet', detail: 'Operate 5 aircraft', reward: 2 * M, progress: (s) => ratio(s.fleetOf(0).length, 5) },
  { id: 'fleet_15', title: 'Regional player', detail: 'Operate 15 aircraft', reward: 5 * M, progress: (s) => ratio(s.fleetOf(0).length, 15) },
  { id: 'fleet_40', title: 'Major carrier', detail: 'Operate 40 aircraft', reward: 15 * M, progress: (s) => ratio(s.fleetOf(0).length, 40) },
  { id: 'fleet_100', title: 'Armada', detail: 'Operate 100 aircraft', reward: 50 * M, progress: (s) => ratio(s.fleetOf(0).length, 100) },
  { id: 'pax_100k', title: 'First hundred thousand', detail: 'Carry 100,000 passengers', reward: 1 * M, progress: (s) => ratio(s.player.totalPax, 100_000) },
  { id: 'pax_1m', title: 'Millionaire', detail: 'Carry 1 million passengers', reward: 4 * M, progress: (s) => ratio(s.player.totalPax, 1_000_000) },
  { id: 'pax_10m', title: 'Household name', detail: 'Carry 10 million passengers', reward: 20 * M, progress: (s) => ratio(s.player.totalPax, 10_000_000) },
  { id: 'pax_50m', title: 'Moving nations', detail: 'Carry 50 million passengers', reward: 60 * M, progress: (s) => ratio(s.player.totalPax, 50_000_000) },
  { id: 'second_base', title: 'Branching out', detail: 'Open a second base', reward: 2 * M, progress: (s) => ratio(s.player.hubs.length, 2) },
  { id: 'mega_hub', title: 'Fortress hub', detail: 'Develop a mega hub', reward: 10 * M, progress: (s) => (s.player.hubs.some((h) => h.level >= 3) ? 1 : 0) },
  { id: 'connections', title: 'Connecting the dots', detail: 'Carry 5,000 connecting passengers in a month', reward: 5 * M, progress: (s) => ratio(Math.max(0, ...s.routesOf(0).map(() => 0), s.connectingLastMonth()), 5000) },
  { id: 'long_haul', title: 'Going long', detail: 'Fly a route longer than 6,000 km', reward: 3 * M, progress: (s) => ratio(Math.max(0, ...s.routesOf(0).filter((r) => r.life.flights + r.cur.flights + r.prev.flights > 0).map((r) => r.dist)), 6000) },
  { id: 'ultra_long', title: 'Ultra long haul', detail: 'Fly a route longer than 13,000 km', reward: 10 * M, progress: (s) => ratio(Math.max(0, ...s.routesOf(0).filter((r) => r.life.flights + r.cur.flights + r.prev.flights > 0).map((r) => r.dist)), 13000) },
  { id: 'continents', title: 'Six continents', detail: 'Serve all six inhabited continents', reward: 25 * M, progress: (s) => ratio(continentsServed(s), 6) },
  { id: 'high_altitude', title: 'Thin air', detail: 'Serve an airport above 2,500 m', reward: 2 * M, progress: (s) => (s.routesOf(0).some((r) => AIRPORT[r.a].elev > 2500 || AIRPORT[r.b].elev > 2500) ? 1 : 0) },
  { id: 'flagship', title: 'Flagship', detail: 'Operate a widebody with a first-class cabin', reward: 5 * M, progress: (s) => (s.fleetOf(0).some((a) => a.cabin[2] > 0 && a.phase !== 'delivery' && AIRCRAFT_TYPE[a.type].category !== 'narrowbody') ? 1 : 0) },
  { id: 'otp_90', title: 'Clockwork', detail: 'Reach 90% on-time performance after 1,000 flights', reward: 4 * M, progress: (s) => (s.player.totalFlights >= 1000 ? ratio(s.player.otp, 0.9) : ratio(s.player.totalFlights, 1000) * 0.5) },
  { id: 'rep_70', title: 'Well regarded', detail: 'Reach a reputation of 70', reward: 5 * M, progress: (s) => ratio(s.player.reputation, 70) },
  { id: 'rep_90', title: 'World class', detail: 'Reach a reputation of 90', reward: 20 * M, progress: (s) => ratio(s.player.reputation, 90) },
  { id: 'value_500m', title: 'Half a billion', detail: 'Company valuation of $500M', reward: 5 * M, progress: (s) => ratio(valuation(s, s.player), 500 * M) },
  { id: 'value_2b', title: 'Unicorn of the skies', detail: 'Company valuation of $2B', reward: 20 * M, progress: (s) => ratio(valuation(s, s.player), 2000 * M) },
  { id: 'value_10b', title: 'Blue chip', detail: 'Company valuation of $10B', reward: 100 * M, progress: (s) => ratio(valuation(s, s.player), 10_000 * M) },
  { id: 'debt_free', title: 'Owe nothing', detail: 'Run 20+ aircraft with no debt', reward: 10 * M, progress: (s) => (s.fleetOf(0).length >= 20 && totalDebt(s.player) === 0 ? 1 : ratio(s.fleetOf(0).length, 20) * 0.5) },
  { id: 'top_10', title: 'Top ten', detail: 'Rank among the ten largest airlines by monthly passengers', reward: 15 * M, progress: (s) => (s.player.history.length ? ratio(11 - Math.min(40, monthlyPaxRank(s)), 1) : 0) },
  { id: 'number_one', title: 'Number one', detail: 'Become the largest airline in the world', reward: 150 * M, progress: (s) => (s.player.history.length && monthlyPaxRank(s) === 1 ? 1 : 0) },
];

export function initialObjectives(): Objective[] {
  return OBJECTIVES.map((o) => ({ id: o.id, title: o.title, detail: o.detail, done: false, doneAt: 0, reward: o.reward }));
}

export function objectiveProgress(sim: Sim, id: string): number {
  const def = OBJECTIVES.find((o) => o.id === id);
  return def ? def.progress(sim) : 0;
}

/** Marks newly achieved objectives and pays their rewards. Returns the ones just completed. */
export function checkObjectives(sim: Sim): Objective[] {
  const done: Objective[] = [];
  for (const o of sim.game.objectives) {
    if (o.done) continue;
    const def = OBJECTIVES.find((d) => d.id === o.id);
    if (def && def.progress(sim) >= 1) {
      o.done = true;
      o.doneAt = sim.game.time;
      sim.player.cash += o.reward;
      sim.player.today.rev.other += o.reward;
      sim.player.month.rev.other += o.reward;
      done.push(o);
    }
  }
  return done;
}

export function playerRank(sim: Sim): number {
  return monthlyPaxRank(sim);
}
