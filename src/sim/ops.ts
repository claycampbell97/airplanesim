// Flight operations: the aircraft state machine and the economics of each flight.

import { AIRCRAFT_TYPE, totalSeats } from './data/aircraft';
import { AIRPORT, airportDistance } from './data/airports';
import { BOOKING_SWING } from './demand';
import { earn, feeFactor, fuelPriceFor, hubDiscount, labourFactor, ownershipPerDay, spend } from './finance';
import { aircraftAgeYears, blockMinutes, getMarket, legsPerDay, maxBlockMinutes, NIGHT_STOP_BLOCK, settlePools } from './market';
import { chance, rand, randRange } from './rng';
import type { Aircraft, AircraftType, Airline, AirportId, Route, Triple } from './types';
import type { Sim } from './sim';

export const NEVER = Number.MAX_SAFE_INTEGER;

const PILOT_RATE: Record<AircraftType['category'], number> = {
  turboprop: 130, regional: 168, narrowbody: 240, widebody: 335, jumbo: 370,
};
const CABIN_RATE = 64;
const MAINT_POLICY_COST = [0.78, 0.9, 1, 1.14, 1.3];
const MAINT_POLICY_DELAY = [0.08, 0.04, 0, -0.02, -0.04];
const MAINT_POLICY_FAILURE = [2.2, 1.4, 1, 0.75, 0.55];
const MAINT_POLICY_WEAR = [1.6, 1.25, 1, 0.8, 0.65];
const ANCILLARY_RATE = [0, 8, 17, 28];

export const A_CHECK_HOURS = 500;
export const HEAVY_CHECK_INTERVAL = 2 * 525960;

export interface LegCosts {
  fuelKg: number;
  fuel: number;
  crew: number;
  maintenance: number;
  airport: number;
  navigation: number;
  service: number;
  distribution: number;
  total: number;
}

export interface AircraftProfile {
  type: string;
  cabin: Triple;
  age: number;
}

export function cabinCrewNeeded(type: AircraftType, cabin: Triple): number {
  const seats = totalSeats(cabin);
  return Math.max(Math.ceil(seats / 50), Math.round(type.cabinCrew * 0.6))
    + (cabin[1] > 0 ? Math.ceil(cabin[1] / 20) : 0)
    + (cabin[2] > 0 ? Math.ceil(cabin[2] / 6) : 0);
}

/** Direct operating costs of one flight. Shared by the live simulation and by planning estimates. */
export function legCosts(
  sim: Sim,
  al: Airline,
  p: AircraftProfile,
  from: AirportId,
  to: AirportId,
  pax: Triple,
  ticketRevenue: number,
): LegCosts {
  const t = AIRCRAFT_TYPE[p.type];
  const dist = airportDistance(from, to);
  const blockH = blockMinutes(p.type, dist) / 60;
  const seats = totalSeats(p.cabin);
  const paxTotal = pax[0] + pax[1] + pax[2];
  const load = seats > 0 ? paxTotal / seats : 0;
  const labour = labourFactor(sim, al);
  const tune = sim.tuning.cost;

  const fuelKg = (t.fuelCycle + t.fuelKm * dist * (1 + 0.1 * (dist / t.range))) * (0.88 + 0.12 * load) * (1 + 0.004 * p.age);
  const fuel = fuelKg * fuelPriceFor(sim, al);

  const pilots = t.pilots + (blockH > 8 ? 1 : 0) + (blockH > 12 ? 1 : 0);
  const crew = blockH * (pilots * PILOT_RATE[t.category] + cabinCrewNeeded(t, p.cabin) * CABIN_RATE * (blockH > 6 ? 1.2 : 1)) * labour;

  const maintenance = (blockH * t.maintHour + t.maintCycle) * 1.14 * (1 + 0.028 * p.age)
    * MAINT_POLICY_COST[al.policy.maintenance - 1] * Math.sqrt(labour);

  const A = AIRPORT[from];
  const B = AIRPORT[to];
  const fa = feeFactor(A);
  const fb = feeFactor(B);
  const airport = (t.mtow * 7.8 * fb * hubDiscount(al, to)
    + (360 + seats * 5) * fa * hubDiscount(al, from)
    + paxTotal * 5.4 * (fa + fb) * 0.5) * tune;

  const navigation = dist * 0.22 * Math.sqrt(t.mtow / 50) * tune;

  const s = al.policy.service;
  const perY = 0.5 + 0.9 * s + blockH * (0.3 + 0.7 * s);
  const service = (pax[0] * perY + pax[1] * (perY * 3.2 + 6 * s) + pax[2] * (perY * 6.5 + 15 * s)) * Math.sqrt(labour) * Math.sqrt(tune);

  const distribution = ticketRevenue * 0.045;
  return {
    fuelKg, fuel, crew, maintenance, airport, navigation, service, distribution,
    total: fuel + crew + maintenance + airport + navigation + service + distribution,
  };
}

export function ancillaryPerPax(al: Airline, a: AirportId, b: AirportId): number {
  const dist = airportDistance(a, b);
  const wealth = Math.pow(AIRPORT[a].wealth * AIRPORT[b].wealth, 0.15);
  return ANCILLARY_RATE[al.policy.ancillary] * Math.max(0.7, Math.min(1.5, 0.7 + dist / 6000)) * wealth;
}

/** Expected belly-cargo revenue for one flight. */
export function cargoRevenue(sim: Sim, typeId: string, a: AirportId, b: AirportId, noise = 1): number {
  const t = AIRCRAFT_TYPE[typeId];
  const dist = airportDistance(a, b);
  const load = Math.max(0.15, Math.min(0.9, (0.2 + 0.045 * (AIRPORT[a].tier + AIRPORT[b].tier)) * sim.game.world.economy * noise));
  const rate = dist >= 2000 ? 0.3 : 0.3 + 0.2 * (1 - dist / 2000);
  return t.cargo * load * rate * dist;
}

function post(al: Airline, c: LegCosts): void {
  spend(al, 'fuel', c.fuel);
  spend(al, 'crew', c.crew);
  spend(al, 'maintenance', c.maintenance);
  spend(al, 'airport', c.airport);
  spend(al, 'navigation', c.navigation);
  spend(al, 'service', c.service);
  spend(al, 'distribution', c.distribution);
}

// ───────────────────────── State machine ─────────────────────────

/** Advances one aircraft through every event that is due. */
export function stepAircraft(sim: Sim, ac: Aircraft): void {
  let guard = 0;
  while (ac.next <= sim.game.time && guard++ < 6) {
    const t = ac.next;
    switch (ac.phase) {
      case 'delivery':
        ac.phase = 'idle';
        ac.at = ac.base;
        ac.next = NEVER;
        ac.note = 'Awaiting assignment';
        sim.onDelivered(ac);
        if (ac.rotation.length) wake(sim, ac, t);
        break;
      case 'idle':
        ac.next = NEVER;
        break;
      case 'enroute':
        arrive(sim, ac, t);
        break;
      case 'maintenance':
      case 'grounded':
        ac.phase = 'turnaround';
        ac.note = '';
        ac.next = t;
        break;
      case 'turnaround':
        dispatch(sim, ac, t);
        break;
    }
  }
}

/** Puts an idle aircraft back to work (after it was given a rotation). */
export function wake(sim: Sim, ac: Aircraft, t = sim.game.time): void {
  if (ac.phase !== 'idle') return;
  ac.phase = 'turnaround';
  ac.next = t + 45;
  ac.note = 'Preparing for service';
}

function arrive(sim: Sim, ac: Aircraft, t: number): void {
  const leg = ac.leg!;
  const al = sim.game.airlines[ac.airline];
  const type = AIRCRAFT_TYPE[ac.type];
  const hours = (leg.arr - leg.dep) / 60;
  ac.at = leg.to;
  ac.hours += hours;
  ac.cycles += 1;
  ac.hoursSinceCheck += hours;
  ac.monthHours += hours;
  ac.condition = Math.max(0.3, ac.condition - (hours * 0.00004 + 0.00002) * MAINT_POLICY_WEAR[al.policy.maintenance - 1]);
  ac.leg = null;
  ac.phase = 'turnaround';
  ac.note = '';
  // A late arrival eats into the ground time, but there is a hard minimum to turn the aircraft.
  ac.next = t + type.turnaround;
}

function findReturnRoute(sim: Sim, ac: Aircraft): Route | null {
  for (const rid of ac.rotation) {
    const r = sim.routeById.get(rid);
    if (r && ((r.a === ac.at && r.b === ac.base) || (r.b === ac.at && r.a === ac.base))) return r;
  }
  return null;
}

function dispatch(sim: Sim, ac: Aircraft, t: number): void {
  const al = sim.game.airlines[ac.airline];
  const type = AIRCRAFT_TYPE[ac.type];

  if (ac.at !== ac.base) {
    const back = findReturnRoute(sim, ac);
    if (back) fly(sim, ac, back, ac.base, t);
    else ferry(sim, ac, ac.base, t);
    return;
  }

  // At base: scheduled maintenance comes first.
  if (t - ac.lastHeavyCheck >= HEAVY_CHECK_INTERVAL) {
    const cost = type.maintHour * 350 * (1 + 0.02 * aircraftAgeYears(sim, ac)) * Math.sqrt(labourFactor(sim, al));
    spend(al, 'maintenance', cost);
    ac.monthProfit -= cost;
    ac.lastHeavyCheck = t;
    ac.hoursSinceCheck = 0;
    ac.condition = Math.min(1, ac.condition + 0.25);
    ac.phase = 'maintenance';
    ac.note = 'Heavy maintenance check';
    ac.next = t + 5 * 1440;
    return;
  }
  if (ac.hoursSinceCheck >= A_CHECK_HOURS) {
    const cost = type.maintHour * 10 * Math.sqrt(labourFactor(sim, al));
    spend(al, 'maintenance', cost);
    ac.monthProfit -= cost;
    ac.hoursSinceCheck = 0;
    ac.condition = Math.min(1, ac.condition + 0.01);
    ac.phase = 'maintenance';
    ac.note = 'Line maintenance check';
    ac.next = t + 8 * 60;
    return;
  }

  // Pick the next route in the rotation that is still valid.
  const n = ac.rotation.length;
  const before = ac.rotIndex;
  for (let i = 0; i < n; i++) {
    ac.rotIndex = (ac.rotIndex + 1) % n;
    const r = sim.routeById.get(ac.rotation[ac.rotIndex]);
    if (!r) continue;
    const dest = r.a === ac.base ? r.b : r.b === ac.base ? r.a : null;
    if (dest) {
      // Daily flying hours: the out-and-back has to fit in the time the aircraft has in hand.
      const cap = maxBlockMinutes(ac.type);
      const perMinute = cap / 1440;
      const inHand = Math.min(cap, (ac.duty ?? cap) + (t - (ac.dutyTime ?? t)) * perMinute);
      const need = 2 * blockMinutes(ac.type, r.dist);
      const enough = Math.min(need, cap);
      ac.duty = inHand;
      ac.dutyTime = t;
      if (inHand < enough - 0.5) {
        ac.rotIndex = before;
        ac.note = 'Crew rest and daily checks';
        ac.next = t + Math.ceil((enough - inHand) / perMinute);
        return;
      }
      if (fly(sim, ac, r, dest, t)) ac.duty = inHand - need;
      return;
    }
  }
  ac.phase = 'idle';
  ac.note = 'Awaiting assignment';
  ac.next = NEVER;
}

/** Positioning flight without passengers. */
function ferry(sim: Sim, ac: Aircraft, to: AirportId, t: number): void {
  const al = sim.game.airlines[ac.airline];
  const costs = legCosts(sim, al, { type: ac.type, cabin: [0, 0, 0], age: aircraftAgeYears(sim, ac) }, ac.at, to, [0, 0, 0], 0);
  post(al, costs);
  ac.monthProfit -= costs.total;
  const block = blockMinutes(ac.type, airportDistance(ac.at, to));
  ac.leg = { route: -1, from: ac.at, to, dep: t, arr: t + block, pax: [0, 0, 0], connPax: 0, revenue: 0, cost: costs.total, delay: 0 };
  ac.phase = 'enroute';
  ac.note = 'Positioning flight';
  ac.next = t + block;
}

/** Local solar hour (0..24) at an airport. */
export function localHour(lon: number, t: number): number {
  return (((t / 60 + lon / 15) % 24) + 24) % 24;
}

/** Sends an aircraft off on a flight. Returns false if it could not leave yet (night stop, strike, closure, fault). */
function fly(sim: Sim, ac: Aircraft, route: Route, to: AirportId, t: number): boolean {
  const g = sim.game;
  const al = g.airlines[ac.airline];
  const from = ac.at;
  const A = AIRPORT[from];
  const B = AIRPORT[to];

  // Short flights stop for the night; long-haul departures run around the clock.
  if (blockMinutes(ac.type, route.dist) < NIGHT_STOP_BLOCK) {
    const h = localHour(A.lon, t);
    if (h >= 23 || h < 5.25) {
      const wait = ((5.25 - h + 24) % 24) * 60 + rand(g) * 70;
      ac.note = 'Night stop';
      ac.next = t + wait;
      return false;
    }
  }
  const age = aircraftAgeYears(sim, ac);
  const policy = al.policy.maintenance - 1;

  // A strike grounds the whole airline.
  if (al.isPlayer && g.time < (g.flags.strikeUntil ?? 0)) {
    ac.note = 'Grounded — crew on strike';
    ac.next = t + 240;
    al.today.cancelled += 1;
    al.month.cancelled += 1;
    return false;
  }

  // Closed airports hold everything on the ground.
  const closure = Math.max(sim.disruption[A.index], sim.disruption[B.index]);
  if (closure >= 0.9) {
    ac.note = `Held — ${sim.disruption[A.index] >= 0.9 ? A.city : B.city} closed`;
    ac.next = t + 180;
    al.today.cancelled += 1;
    al.month.cancelled += 1;
    return false;
  }

  // Technical fault before departure: the aircraft is stuck until it is fixed.
  const pFail = 0.0016 * (1 + 3 * (1 - ac.condition)) * MAINT_POLICY_FAILURE[policy] * (1 + age / 25);
  if (chance(g, pFail)) {
    const type = AIRCRAFT_TYPE[ac.type];
    const repair = type.maintHour * randRange(g, 15, 60);
    spend(al, 'maintenance', repair);
    ac.monthProfit -= repair;
    ac.phase = 'grounded';
    ac.note = 'Grounded — technical fault';
    ac.next = t + randRange(g, 6, 30) * 60;
    al.today.cancelled += 1;
    al.month.cancelled += 1;
    al.otp = al.otp * 0.985;
    sim.onGrounded(ac, repair);
    return false;
  }

  // Boarding: take waiting passengers from the booking pools.
  const dir = from === route.a ? 0 : 1;
  settlePools(sim, route);
  const pax: Triple = [0, 0, 0];
  let connPax = 0;
  let tickets = 0;
  const ticketsByClass: Triple = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const local = route.pool[dir][c];
    const conn = route.connPool[dir][c];
    if (local + conn <= 0 || ac.cabin[c] <= 0) continue;
    // How many of those waiting want this particular departure varies a good deal
    // from flight to flight. Those who cannot get a seat on it go elsewhere.
    const u = 1 - BOOKING_SWING + 2 * BOOKING_SWING * rand(g);
    const wantLocal = local * u;
    const wantConn = conn * u;
    // Full-fare local passengers get seats before prorated connections.
    const takenLocal = Math.min(ac.cabin[c], Math.floor(wantLocal + rand(g)));
    const takenConn = Math.max(0, Math.min(ac.cabin[c] - takenLocal, Math.floor(wantConn + rand(g))));
    route.pool[dir][c] = Math.max(0, local - Math.max(wantLocal, takenLocal));
    route.connPool[dir][c] = Math.max(0, conn - Math.max(wantConn, takenConn));
    const taken = takenLocal + takenConn;
    if (taken <= 0) continue;
    pax[c] = taken;
    connPax += takenConn;
    ticketsByClass[c] = takenLocal * route.price[c] + takenConn * route.connFare[c];
    tickets += ticketsByClass[c];
  }
  const paxTotal = pax[0] + pax[1] + pax[2];

  // Delays.
  let pDelay = 0.1 + (A.tier > 3 ? 0.05 * (A.tier - 3) : 0) + (B.tier > 3 ? 0.03 : 0)
    + (1 - ac.condition) * 0.25 + MAINT_POLICY_DELAY[policy]
    + sim.disruption[A.index] * 0.6 + sim.disruption[B.index] * 0.3 + (al.morale < 40 ? 0.06 : 0);
  pDelay = Math.max(0.03, Math.min(0.9, pDelay));
  let delay = 0;
  if (chance(g, pDelay)) {
    const mean = closure > 0.3 ? 110 : 34;
    delay = 16 + -Math.log(1 - rand(g) * 0.999) * mean;
  }

  const ancillary = pax[0] * ancillaryPerPax(al, from, to);
  const cargo = cargoRevenue(sim, ac.type, from, to, 0.8 + 0.4 * rand(g));
  const costs = legCosts(sim, al, { type: ac.type, cabin: ac.cabin, age }, from, to, pax, tickets);
  let compensation = 0;
  if (delay > 180) compensation = paxTotal * 110 * Math.pow(A.wealth * B.wealth, 0.3);

  earn(al, 'ticketsY', ticketsByClass[0]);
  earn(al, 'ticketsJ', ticketsByClass[1]);
  earn(al, 'ticketsF', ticketsByClass[2]);
  earn(al, 'ancillary', ancillary);
  earn(al, 'cargo', cargo);
  post(al, costs);
  spend(al, 'compensation', compensation);

  const block = blockMinutes(ac.type, route.dist);
  const revenue = tickets + ancillary + cargo;
  // Route profitability also carries the aircraft's ownership cost: a day of it spread
  // over the flights the aircraft makes in a day, idle hours included.
  const legs = legsPerDay(sim, ac);
  const ownership = legs > 0 ? ownershipPerDay(ac) / legs : 0;
  const cost = costs.total + compensation + ownership;

  const seats = totalSeats(ac.cabin);
  for (const l of [al.today, al.month]) {
    l.pax += paxTotal;
    l.flights += 1;
    l.ask += seats * route.dist;
    l.rpk += paxTotal * route.dist;
    if (delay > 15) l.delayed += 1;
  }
  al.totalPax += paxTotal;
  al.totalFlights += 1;
  al.otp = al.otp * 0.992 + (delay > 15 ? 0 : 0.008);

  const s = route.cur;
  s.flights += 1;
  s.connPax += connPax;
  s.revenue += revenue;
  s.cost += cost;
  for (let c = 0; c < 3; c++) {
    s.pax[c] += pax[c];
    s.seats[c] += ac.cabin[c];
  }
  ac.monthFlights += 1;
  ac.monthProfit += revenue - cost;

  ac.leg = { route: route.id, from, to, dep: t + delay, arr: t + delay + block, pax, connPax, revenue, cost, delay };
  ac.phase = 'enroute';
  ac.note = '';
  ac.next = t + delay + block;
  if (delay > 180) sim.onLongDelay(ac, delay);
  return true;
}

// ───────────────────────── Planning ─────────────────────────

export interface FlightPlan {
  revenue: number;
  tickets: number;
  ancillary: number;
  cargo: number;
  costs: LegCosts;
  ownership: number;
  profit: number;
  /** Profit per day for one aircraft flying this route continuously. */
  profitPerDay: number;
}

/** Economics of one flight carrying the given passengers, for route planning. */
export function planFlight(
  sim: Sim,
  al: Airline,
  typeId: string,
  cabin: Triple,
  age: number,
  ownershipDay: number,
  a: AirportId,
  b: AirportId,
  pax: Triple,
  price: Triple,
  legsPerDay: number,
  /** Connecting passengers included in `pax`, and the prorated fare they pay for this leg. */
  conn: Triple = [0, 0, 0],
  connFare: Triple = [0, 0, 0],
): FlightPlan {
  let tickets = 0;
  for (let c = 0; c < 3; c++) tickets += (pax[c] - conn[c]) * price[c] + conn[c] * connFare[c];
  const ancillary = pax[0] * ancillaryPerPax(al, a, b);
  const cargo = cargoRevenue(sim, typeId, a, b);
  const costs = legCosts(sim, al, { type: typeId, cabin, age }, a, b, pax, tickets);
  const ownership = legsPerDay > 0 ? ownershipDay / legsPerDay : 0;
  const revenue = tickets + ancillary + cargo;
  const profit = revenue - costs.total - ownership;
  return { revenue, tickets, ancillary, cargo, costs, ownership, profit, profitPerDay: profit * legsPerDay };
}

/** Whether an aircraft type can operate between two airports, and if not, why. */
export function canOperate(typeId: string, a: AirportId, b: AirportId): { ok: boolean; reason?: string } {
  const t = AIRCRAFT_TYPE[typeId];
  const dist = airportDistance(a, b);
  if (dist > t.range) return { ok: false, reason: `Out of range (${Math.round(dist).toLocaleString()} km, max ${t.range.toLocaleString()} km)` };
  for (const id of [a, b]) {
    const ap = AIRPORT[id];
    if (ap.effRunway < t.runway) {
      return { ok: false, reason: `Runway at ${ap.id} too short (${ap.effRunway.toLocaleString()} m effective, needs ${t.runway.toLocaleString()} m)` };
    }
  }
  return { ok: true };
}

export function marketOf(sim: Sim, r: Route) {
  return getMarket(sim, r.a, r.b);
}
