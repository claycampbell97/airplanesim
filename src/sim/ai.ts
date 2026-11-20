// Rival airlines: how they are set up at the start of a game and how they
// manage their networks afterwards. Rivals play by the same rules and pay the
// same costs as the player.

import { acquireAircraft, closeRoute, findRoute, openRoute, setRotation } from './actions';
import { AIRCRAFT_TYPE, CABIN_PRESETS, makeCabin, totalSeats } from './data/aircraft';
import type { AirlineTemplate } from './data/airlines';
import { AIRPORT, AIRPORTS, airportDistance } from './data/airports';
import { baseDemand } from './demand';
import { emptyLedger, ledgerProfit, marketLease, DAYS_PER_MONTH } from './finance';
import { dailyRoundTrips, estimateService, getMarket, roundTripMinutes } from './market';
import { serviceFares } from './pricing';
import { planShortfall } from './slots';
import { canOperate, NEVER, planFlight } from './ops';
import { chance, hash01, rand, randInt, randRange } from './rng';
import { addNews } from './world';
import type { Aircraft, AiState, Airline, AirportId, Route, Triple } from './types';
import type { Sim } from './sim';

type Style = AiState['style'];

const FLEETS: Record<Style, { airbus: string[]; boeing: string[] }> = {
  legacy: { airbus: ['e175', 'bcs3', 'a20n', 'a21n', 'a333', 'a359'], boeing: ['e175', 'e295', 'b38m', 'b3xm', 'b788', 'b789', 'b77w'] },
  lowcost: { airbus: ['a20n', 'a21n', 'a320'], boeing: ['b38m', 'b3xm', 'b738'] },
  regional: { airbus: ['at76', 'e175', 'bcs1', 'a20n'], boeing: ['dh8d', 'e175', 'e295', 'b38m'] },
  premium: { airbus: ['bcs3', 'a20n', 'a21x', 'a359', 'a35k', 'a388'], boeing: ['bcs3', 'b38m', 'b789', 'b78x', 'b77w', 'b779'] },
};

const STYLE: Record<Style, { fare: number; service: number; ancillary: number; wages: number; reputation: number; preset: [string, string]; maxDist: number }> = {
  legacy: { fare: 1.0, service: 3, ancillary: 1, wages: 1.0, reputation: 58, preset: ['two', 'three'], maxDist: 16000 },
  lowcost: { fare: 0.84, service: 1, ancillary: 3, wages: 0.94, reputation: 46, preset: ['dense', 'dense'], maxDist: 4800 },
  regional: { fare: 1.04, service: 2, ancillary: 1, wages: 0.96, reputation: 50, preset: ['eco', 'two'], maxDist: 2600 },
  premium: { fare: 1.1, service: 5, ancillary: 0, wages: 1.08, reputation: 74, preset: ['premium', 'flagship'], maxDist: 16000 },
};

export function fleetTypes(al: Airline): string[] {
  const style = al.ai!.style;
  return hash01(al.name) < 0.5 ? FLEETS[style].airbus : FLEETS[style].boeing;
}

function cabinFor(al: Airline, typeId: string): { cabin: Triple; density: 0 | 1 | 2 } {
  const t = AIRCRAFT_TYPE[typeId];
  const wide = t.category === 'widebody' || t.category === 'jumbo';
  const id = t.category === 'turboprop' ? 'eco' : STYLE[al.ai!.style].preset[wide ? 1 : 0];
  const p = CABIN_PRESETS.find((x) => x.id === id)!;
  const first = wide ? p.first : 0;
  return { cabin: makeCabin(t, p.density, p.business, first), density: p.density };
}

interface Candidate {
  hub: AirportId;
  dest: AirportId;
  type: string;
  /** Expected profit per aircraft per day. */
  profit: number;
  /** Aircraft the market can absorb. */
  count: number;
  /**
   * How many routes one aircraft should rotate through for this market to fill it:
   * 1 for a route that keeps an aircraft busy all day, up to 4 for very thin ones.
   */
  slots: number;
}

/** Evaluates the best aircraft for a prospective route and what it would earn. */
function evaluate(sim: Sim, al: Airline, hub: AirportId, dest: AirportId, types: string[]): Candidate | null {
  const dist = airportDistance(hub, dest);
  const m = getMarket(sim, hub, dest);
  const fare = al.ai!.fareLevel;
  const price: Triple = [m.ref[0] * fare, m.ref[1] * fare, m.ref[2] * fare];
  const demand = m.demand[0] + m.demand[1] + m.demand[2];

  let best: Candidate | null = null;
  for (const typeId of types) {
    if (!canOperate(typeId, hub, dest).ok) continue;
    const t = AIRCRAFT_TYPE[typeId];
    // Do not put widebodies on short hops unless the market is enormous.
    if (dist < 1500 && (t.category === 'widebody' || t.category === 'jumbo') && demand < 4000) continue;
    const { cabin } = cabinFor(al, typeId);
    // Thin markets cannot keep an aircraft busy all day: see whether it fills when the
    // aircraft splits its day between two, three or four such routes.
    let slots = 1;
    let est = estimateService(sim, al, hub, dest, typeId, cabin, 1, price, t.comfort, undefined, true);
    // An aircraft far too big for the market will not be rescued by sharing it.
    if (est.loadFactor < 0.17) continue;
    // From here on, at the fares revenue management would settle on.
    let fares = serviceFares(sim, al, hub, dest, typeId, cabin, 1, t.comfort, price);
    est = estimateService(sim, al, hub, dest, typeId, cabin, 1, fares, t.comfort, undefined, true);
    while (est.loadFactor < 0.62 && slots < 4) {
      slots += 1;
      fares = serviceFares(sim, al, hub, dest, typeId, cabin, 1 / slots, t.comfort, price);
      est = estimateService(sim, al, hub, dest, typeId, cabin, 1 / slots, fares, t.comfort, undefined, true);
    }
    if (est.loadFactor < 0.55) continue;
    // No slots, no flights.
    if (planShortfall(sim, al, hub, dest, est.freq).length) continue;
    const legs = est.freq * 2;
    const ownership = marketLease(typeId, 6) / DAYS_PER_MONTH / slots;
    const plan = planFlight(sim, al, typeId, cabin, 6, ownership, hub, dest, est.pax, fares, legs);
    if (plan.profitPerDay <= 0) continue;
    // How many aircraft the market could take before load factors sag.
    const seats = totalSeats(cabin);
    const count = slots > 1 ? 1 : Math.max(1, Math.min(4, Math.floor((est.loadFactor * 1.15 * demand * 0.35) / (seats * est.freq)) + 1));
    // Compare options per whole aircraft.
    const profit = plan.profitPerDay * slots;
    if (!best || profit > best.profit) best = { hub, dest, type: typeId, profit, count, slots };
  }
  return best;
}

/** Ranked list of routes an airline could add from its hubs. */
function candidates(sim: Sim, al: Airline, limit: number, shortlistSize = 60): Candidate[] {
  const types = fleetTypes(al);
  const maxDist = STYLE[al.ai!.style].maxDist;
  const out: Candidate[] = [];
  for (const hub of al.hubs) {
    const weight = hub.airport === al.hq ? 1 : 0.75;
    const shortlist: { dest: AirportId; demand: number }[] = [];
    for (const ap of AIRPORTS) {
      if (ap.id === hub.airport) continue;
      const dist = airportDistance(hub.airport, ap.id);
      if (dist > maxDist || dist < 150) continue;
      const demand = baseDemand(hub.airport, ap.id);
      if (demand < 45) continue;
      if (findRoute(sim, al.id, hub.airport, ap.id)) continue;
      shortlist.push({ dest: ap.id, demand });
    }
    shortlist.sort((a, b) => b.demand - a.demand);
    for (const s of shortlist.slice(0, shortlistSize)) {
      const c = evaluate(sim, al, hub.airport, s.dest, types);
      if (c) { c.profit *= weight; out.push(c); }
    }
  }
  out.sort((a, b) => b.profit - a.profit);
  return out.slice(0, limit);
}

function addAircraft(sim: Sim, al: Airline, c: Candidate, route: Route, instant: boolean): Aircraft | null {
  const g = sim.game;
  if (planShortfall(sim, al, route.a, route.b, dailyRoundTrips(c.type, route.dist) / c.slots).length) return null;
  const { cabin, density } = cabinFor(al, c.type);
  const t = AIRCRAFT_TYPE[c.type];
  const age = instant ? randInt(g, 0, 14) : 0;
  let ac: Aircraft | undefined;
  if (instant || !t.inProduction) {
    // Established fleets (and out-of-production types) come from the lease market.
    const order = {
      id: g.nextId++, airline: al.id, type: c.type, deliver: g.time, cabin, density, base: c.hub,
      lease: true, price: 0, leaseRate: marketLease(c.type, age) * sim.tuning.aircraftPrice, age,
    };
    ac = sim.createAircraftFromOrder(al, order);
  } else {
    const res = acquireAircraft(sim, al.id, c.type, { lease: true, cabin, density, base: c.hub });
    if (!res.ok) return null;
    ac = g.aircraft[g.aircraft.length - 1];
  }
  setRotation(sim, ac.id, [route.id]);
  if (instant) {
    // Start somewhere in the cycle so the world is already in motion at time zero.
    ac.phase = 'turnaround';
    ac.next = g.time + rand(g) * roundTripMinutes(c.type, route.dist) * 0.5;
  }
  return ac;
}

export function createRival(sim: Sim, tpl: AirlineTemplate, id: number): Airline {
  const g = sim.game;
  const st = STYLE[tpl.style];
  const size = Math.max(4, Math.round(tpl.size * sim.tuning.aiScale));
  const al: Airline = {
    id, name: tpl.name, code: tpl.code, isPlayer: false, livery: tpl.livery, hq: tpl.hq,
    hubs: [tpl.hq, ...(tpl.hubs ?? [])].map((airport, i) => ({ airport, level: (i === 0 ? 3 : 2) as 2 | 3, opened: g.time })),
    cash: size * 9_000_000,
    loans: [], hedges: [],
    policy: { service: st.service, ancillary: st.ancillary, maintenance: 3, wages: st.wages, marketing: size * 22_000 },
    reputation: st.reputation + randRange(g, -5, 5),
    morale: 60,
    repDay: 0,
    otp: 0.82,
    otpDay: 0.82,
    today: emptyLedger(), month: emptyLedger(), history: [], daily: [],
    totalPax: 0, totalFlights: 0, bankrupt: false, insolventDays: 0,
    ai: { style: tpl.style, aggression: sim.tuning.aiAggression * randRange(g, 0.7, 1.3), fareLevel: st.fare, fleetCap: Math.round(size * 1.8), nextReview: g.time + randInt(g, 5, 34) * 1440 },
    nextFlightNo: 100 + randInt(g, 0, 8) * 100,
    nextReg: randInt(g, 0, 400),
    founded: g.time - randInt(g, 8, 60) * 525960,
  };
  al.repDay = al.reputation;
  return al;
}

/** Finds an aircraft already flying one thin route that could take a second one. */
function findSharer(sim: Sim, al: Airline, c: Candidate): Aircraft | undefined {
  return sim.fleetOf(al.id).find((ac) => ac.type === c.type && ac.base === c.hub && ac.partTime === c.slots && ac.rotation.length < c.slots);
}

function launch(sim: Sim, al: Airline, c: Candidate, instant: boolean): Route | null {
  // The slots may have gone to an earlier launch since this candidate was weighed up.
  if (planShortfall(sim, al, c.hub, c.dest, dailyRoundTrips(c.type, airportDistance(c.hub, c.dest)) / c.slots).length) return null;
  const res = openRoute(sim, al.id, c.hub, c.dest, al.ai!.fareLevel);
  if (!res.ok) return null;
  const route = res.value;
  if (c.slots > 1) {
    const partner = findSharer(sim, al, c);
    if (partner) {
      setRotation(sim, partner.id, [...partner.rotation, route.id]);
      return route;
    }
  }
  const ac = addAircraft(sim, al, c, route, instant);
  if (ac && c.slots > 1) ac.partTime = c.slots;
  return route;
}

/** Builds a rival's opening network. */
export function seedRival(sim: Sim, al: Airline, size: number): void {
  let budget = size;
  const list = candidates(sim, al, size * 3, 140);
  for (const c of list) {
    if (budget <= 0) break;
    const before = sim.fleetOf(al.id).length;
    const route = launch(sim, al, c, true);
    if (!route) continue;
    route.maturity = 1;
    route.opened = sim.game.time - randInt(sim.game, 200, 3000) * 1440;
    const n = Math.min(budget, c.count);
    for (let i = 1; i < n; i++) addAircraft(sim, al, c, route, true);
    budget -= sim.fleetOf(al.id).length - before;
  }
  // Opening costs were charged for an imaginary past: give the money back.
  al.cash = Math.max(al.cash, size * 9_000_000);
  al.today = emptyLedger();
  al.month = emptyLedger();
}

function loadFactor(r: Route): number {
  const seats = r.prev.seats[0] + r.prev.seats[1] + r.prev.seats[2];
  const pax = r.prev.pax[0] + r.prev.pax[1] + r.prev.pax[2];
  return seats > 0 ? pax / seats : 0;
}

/** Monthly management review for one rival. */
export function reviewRival(sim: Sim, al: Airline): void {
  const g = sim.game;
  const ai = al.ai!;
  const fleet = sim.fleetOf(al.id);

  // Hand back aircraft that have been parked.
  for (const ac of [...fleet]) {
    if (ac.phase === 'idle' && ac.rotation.length === 0) sim.removeAircraft(ac);
  }

  let grown = false;
  for (const r of [...sim.routesOf(al.id)]) {
    if (r.prev.flights < 4) continue;
    const lf = loadFactor(r);
    const margin = r.prev.revenue > 0 ? (r.prev.revenue - r.prev.cost) / r.prev.revenue : -1;
    const m = getMarket(sim, r.a, r.b);

    // (Fares are looked after by revenue management: see pricing.ts.)
    if (margin < -0.06) r.lossMonths += 1;
    else r.lossMonths = Math.max(0, r.lossMonths - 1);

    // A thin route that cannot fill its own aircraft: fold it into another thin route's rotation.
    if (r.lossMonths >= 2 && r.aircraft.length === 1 && lf < 0.6) {
      const mine = sim.acById.get(r.aircraft[0]);
      const partner = mine && mine.rotation.length === 1 ? sim.fleetOf(al.id).find((ac) =>
        ac !== mine && ac.type === mine.type && ac.base === mine.base && ac.rotation.length >= 1 && ac.rotation.length < 4
        && ac.rotation.every((rid) => { const o = sim.routeById.get(rid); return !!o && o.aircraft.length === 1 && loadFactor(o) < 0.7; })) : undefined;
      if (mine && partner) {
        setRotation(sim, partner.id, [...partner.rotation, r.id]);
        // From now on it shares its day between them, and goes on doing so if one is dropped.
        partner.partTime = Math.max(partner.partTime ?? 1, partner.rotation.length);
        setRotation(sim, mine.id, []);
        r.lossMonths = 0;
        continue;
      }
    }

    if (r.lossMonths >= 3) {
      if (r.aircraft.length > 1) {
        const ac = sim.acById.get(r.aircraft[r.aircraft.length - 1]);
        if (ac) setRotation(sim, ac.id, []);
        r.lossMonths = 1;
      } else {
        const rivalsLeft = m.routes.length - 1;
        closeRoute(sim, r.id);
        if (touchesPlayerMarket(sim, r)) {
          addNews(sim, 'rival', `${al.name} drops ${r.a}–${r.b}`, rivalsLeft > 0 ? 'The route was losing money.' : 'The route was losing money, leaving the market unserved.', { airport: r.b });
        }
      }
      continue;
    }

    // Add capacity where flights are full and profitable (one aircraft per review at most).
    if (!grown && lf > 0.9 && margin > 0.12 && sim.fleetOf(al.id).length < ai.fleetCap && al.cash > 0 && chance(g, 0.1 * ai.aggression)) {
      const sample = sim.acById.get(r.aircraft[0]);
      if (sample && sample.rotation.length === 1) {
        addAircraft(sim, al, { hub: r.a, dest: r.b, type: sample.type, profit: 0, count: 1, slots: 1 }, r, false);
        grown = true;
      }
    }
  }

  // Expansion.
  const last = al.history[al.history.length - 1];
  const healthy = last ? ledgerProfit(last) > 0 : true;
  if (!grown && healthy && al.cash > 20_000_000 && sim.fleetOf(al.id).length < ai.fleetCap && chance(g, 0.3 * ai.aggression)) {
    const list = candidates(sim, al, 6);
    if (list.length) {
      const c = list[Math.floor(rand(g) * Math.min(3, list.length))];
      const route = launch(sim, al, c, false);
      if (route) {
        if (touchesPlayerMarket(sim, route)) {
          const mine = findRoute(sim, 0, c.hub, c.dest);
          addNews(sim, 'rival', `${al.name} launches ${c.hub}–${c.dest}`,
            mine ? 'They are going head to head with you on this route. Watch your load factors.' : `A new competitor at ${AIRPORT[c.dest].city}.`, { airport: c.dest });
        }
      }
    }
  }

  // Deep trouble: restructure rather than vanish, so the world stays populated.
  if (al.cash < -ai.fleetCap * 4_000_000) {
    const routes = [...sim.routesOf(al.id)].sort((a, b) => (a.prev.revenue - a.prev.cost) - (b.prev.revenue - b.prev.cost));
    for (const r of routes.slice(0, Math.ceil(routes.length * 0.3))) closeRoute(sim, r.id);
    al.cash = ai.fleetCap * 2_000_000;
    al.reputation = Math.max(20, al.reputation - 8);
    addNews(sim, 'rival', `${al.name} enters restructuring`, 'After heavy losses the airline is cutting a third of its network under creditor protection.');
  }

  ai.nextReview = g.time + 30 * 1440;
}

function touchesPlayerMarket(sim: Sim, r: Route): boolean {
  const p = sim.game.airlines[0];
  if (p.hubs.some((h) => h.airport === r.a || h.airport === r.b)) return true;
  return !!findRoute(sim, 0, r.a, r.b);
}

export { NEVER };
