// Everything an airline can do: acquire and dispose of aircraft, open hubs and
// routes, schedule the fleet, set fares and policies. The player and the AI both
// go through these functions, so the rules are the same for everyone.

import { AIRCRAFT_TYPE, cabinFits, defaultPreset, makeCabin, totalSeats } from './data/aircraft';
import { AIRPORT, airportDistance } from './data/airports';
import {
  DAYS_PER_MONTH, earn, feeFactor, hubSetupCost, leaseCapacity, leaseCommitment, marketLease, marketValue, spend,
} from './finance';
import { attachRoute, detachRoute, findMarket, getMarket, refreshConnections, refreshMarket, routeChanged } from './market';
import { faresManaged, tuneFares } from './pricing';
import { describeShortfall, ENTRANT_SLOTS, grantSlots, HUB_SLOTS, rotationShortfall } from './slots';
import { canOperate, legCosts, NEVER, wake } from './ops';
import { randInt } from './rng';
import type { Aircraft, Airline, AirportId, Hub, Order, Policy, Route, RouteStats, Triple } from './types';
import type { Sim } from './sim';

export type Result<T = void> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: string): Result<never> => ({ ok: false, reason });

export function emptyStats(): RouteStats {
  return { flights: 0, pax: [0, 0, 0], seats: [0, 0, 0], connPax: 0, revenue: 0, cost: 0 };
}

// ───────────────────────── Registrations ─────────────────────────

const REG_PREFIX: Record<string, string> = {
  US: 'N', CA: 'C-G', GB: 'G-', IE: 'EI-', FR: 'F-H', DE: 'D-A', NL: 'PH-', BE: 'OO-', LU: 'LX-', CH: 'HB-',
  AT: 'OE-', ES: 'EC-', PT: 'CS-', IT: 'I-', GR: 'SX-', DK: 'OY-', NO: 'LN-', SE: 'SE-', FI: 'OH-', IS: 'TF-',
  PL: 'SP-', CZ: 'OK-', HU: 'HA-', RO: 'YR-', BG: 'LZ-', TR: 'TC-', RU: 'RA-', UA: 'UR-', AE: 'A6-', QA: 'A7-',
  SA: 'HZ-', KW: '9K-', BH: 'A9C-', OM: 'A4O-', IL: '4X-', JO: 'JY-', EG: 'SU-', MA: 'CN-', ZA: 'ZS-', KE: '5Y-',
  ET: 'ET-', NG: '5N-', GH: '9G-', TZ: '5H-', IN: 'VT-', PK: 'AP-', LK: '4R-', BD: 'S2-', NP: '9N-', CN: 'B-',
  HK: 'B-H', TW: 'B-', JP: 'JA', KR: 'HL', SG: '9V-', MY: '9M-', TH: 'HS-', ID: 'PK-', PH: 'RP-C', VN: 'VN-A',
  AU: 'VH-', NZ: 'ZK-', FJ: 'DQ-', BR: 'PR-', AR: 'LV-', CL: 'CC-', CO: 'HK-', PE: 'OB-', MX: 'XA-', PA: 'HP-',
  KZ: 'UP-', UZ: 'UK-', MN: 'JU-', MU: '3B-', SC: 'S7-', MV: '8Q-',
};
const NUMERIC_REG = new Set(['CN', 'TW', 'JP', 'KR', 'RU', 'PH', 'VN', 'CO', 'PE', 'PA']);

function letters(n: number, count: number): string {
  let s = '';
  for (let i = 0; i < count; i++) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function makeRegistration(al: Airline): string {
  const country = AIRPORT[al.hq].country;
  const prefix = REG_PREFIX[country] ?? `${country}-`;
  const n = al.nextReg++;
  // Spread the sequence so consecutive aircraft do not look like AAA, AAB, AAC.
  const mixed = (n * 7919 + al.id * 104729) % 17576;
  if (country === 'US') return `N${100 + ((n * 37 + al.id * 211) % 900)}${al.code}`;
  if (NUMERIC_REG.has(country)) return `${prefix}${1000 + ((n * 53 + al.id * 977) % 9000)}`;
  return `${prefix}${letters(mixed, prefix.length > 2 && !prefix.endsWith('-') ? 3 : prefix.endsWith('-') && prefix.length === 2 ? 4 : 3)}`;
}

// ───────────────────────── Fleet ─────────────────────────

export interface AcquireOptions {
  lease: boolean;
  cabin?: Triple;
  density?: 0 | 1 | 2;
  base?: AirportId;
  /** Second-hand listing to take instead of ordering new. */
  listing?: number;
}

export function deliveryDays(typeId: string): number {
  const c = AIRCRAFT_TYPE[typeId].category;
  return c === 'turboprop' || c === 'regional' ? 10 : c === 'narrowbody' ? 16 : 28;
}

/**
 * Delivery time for this airline right now. A new airline's very first aircraft
 * comes out of the lessor's stock within days, so that the game opens with
 * flying rather than with waiting.
 */
export function deliveryDaysFor(sim: Sim, al: Airline, typeId: string): number {
  const days = deliveryDays(typeId);
  return al.isPlayer && al.totalFlights === 0 && sim.fleetOf(al.id).length === 0 ? Math.min(3, days) : days;
}

/** Manufacturer discount currently on offer to the player for a type (0 if none). */
export function activeDiscount(sim: Sim, typeId: string): number {
  return sim.game.time < (sim.game.flags[`discount:${typeId}`] ?? 0) ? 0.12 : 0;
}

/** Price of a factory-new aircraft after difficulty adjustments and any discount. */
export function newPrice(sim: Sim, typeId: string, al?: Airline): number {
  const discount = al?.isPlayer ? activeDiscount(sim, typeId) : 0;
  return AIRCRAFT_TYPE[typeId].price * sim.tuning.aircraftPrice * (1 - discount);
}

export function newLease(sim: Sim, typeId: string, al?: Airline): number {
  const discount = al?.isPlayer ? activeDiscount(sim, typeId) : 0;
  return AIRCRAFT_TYPE[typeId].lease * sim.tuning.aircraftPrice * (1 - discount);
}

export function acquireAircraft(sim: Sim, airlineId: number, typeId: string, opts: AcquireOptions): Result<Order> {
  const g = sim.game;
  const al = g.airlines[airlineId];
  const type = AIRCRAFT_TYPE[typeId];
  if (!type) return fail('Unknown aircraft type');

  const base = opts.base ?? al.hq;
  if (!al.hubs.some((h) => h.airport === base)) return fail('Aircraft must be based at one of your bases');
  if (AIRPORT[base].effRunway < type.runway) return fail(`The runway at ${base} is too short for this aircraft`);

  const preset = defaultPreset(type);
  const density = opts.density ?? preset.density;
  const cabin = opts.cabin ?? makeCabin(type, density, preset.business, preset.first);
  if (!cabinFits(type, cabin, density)) return fail('That cabin layout does not fit in this aircraft');
  if (totalSeats(cabin) <= 0) return fail('The cabin needs at least one seat');

  let price: number;
  let lease: number;
  let age = 0;
  let days: number;
  const listing = opts.listing !== undefined ? g.used.find((u) => u.id === opts.listing) : undefined;
  if (opts.listing !== undefined) {
    if (!listing || listing.type !== typeId) return fail('That aircraft is no longer on the market');
    price = listing.price;
    lease = listing.lease;
    age = listing.age;
    days = 3;
  } else {
    if (!type.inProduction) return fail('This type is out of production — look for one on the second-hand market');
    price = newPrice(sim, typeId, al);
    lease = newLease(sim, typeId, al);
    days = deliveryDaysFor(sim, al, typeId);
  }

  if (opts.lease) {
    if (al.isPlayer) {
      if (leaseCommitment(sim, al) + lease > leaseCapacity(sim, al)) {
        return fail('Lessors will not extend more credit yet — grow revenue, or buy the aircraft outright');
      }
      if (al.cash < lease) return fail('Not enough cash for the lease deposit');
    }
    // One month in advance as a security deposit.
    spend(al, 'leases', lease);
  } else {
    if (al.cash < price) return fail('Not enough cash — consider leasing or taking a loan');
    al.cash -= price;
  }
  if (listing) g.used.splice(g.used.indexOf(listing), 1);

  const order: Order = {
    id: g.nextId++, airline: airlineId, type: typeId, deliver: g.time + days * 1440,
    cabin: [cabin[0], cabin[1], cabin[2]], density, base, lease: opts.lease, price, leaseRate: lease, age,
  };
  // The aircraft exists immediately in "delivery" state so it shows up in fleet lists.
  createAircraft(sim, al, order, listing?.condition);
  return ok(order);
}

export function createAircraft(sim: Sim, al: Airline, order: Order, condition?: number): Aircraft {
  const g = sim.game;
  const built = order.deliver - order.age * 525960;
  const ac: Aircraft = {
    id: g.nextId++,
    airline: al.id,
    type: order.type,
    reg: makeRegistration(al),
    owned: !order.lease,
    leaseRate: order.lease ? order.leaseRate : 0,
    leaseEnd: order.deliver + 365 * 1440,
    cost: order.lease ? 0 : order.price,
    book: order.lease ? 0 : order.price,
    built,
    acquired: order.deliver,
    cabin: order.cabin,
    density: order.density,
    base: order.base,
    rotation: [],
    rotIndex: -1,
    phase: 'delivery',
    at: order.base,
    leg: null,
    next: order.deliver,
    hours: order.age * 3200,
    cycles: Math.round(order.age * 1300),
    hoursSinceCheck: 0,
    lastHeavyCheck: order.deliver - (order.age > 0 ? randInt(g, 0, 500) * 1440 : 0),
    condition: condition ?? Math.max(0.55, 1 - order.age * 0.018),
    monthHours: 0,
    monthFlights: 0,
    monthProfit: 0,
    note: 'On delivery',
  };
  g.aircraft.push(ac);
  sim.indexAircraft(ac);
  return ac;
}

function isOnGroundAtBase(ac: Aircraft): boolean {
  return ac.phase === 'idle' || (ac.phase === 'turnaround' && ac.at === ac.base) || ac.phase === 'maintenance';
}

function removeAircraft(sim: Sim, ac: Aircraft): void {
  clearRotation(sim, ac);
  const g = sim.game;
  g.aircraft.splice(g.aircraft.indexOf(ac), 1);
  sim.unindexAircraft(ac);
}

/** Sale value of an owned aircraft today. */
export function resaleValue(sim: Sim, ac: Aircraft): number {
  const age = Math.max(0, (sim.game.time - ac.built) / 525960);
  return marketValue(ac.type, age, ac.condition) * 0.9;
}

export function leaseReturnPenalty(sim: Sim, ac: Aircraft): number {
  return sim.game.time < ac.leaseEnd ? ac.leaseRate * 3 : 0;
}

export function disposeAircraft(sim: Sim, acId: number): Result<number> {
  const ac = sim.acById.get(acId);
  if (!ac) return fail('Aircraft not found');
  const al = sim.game.airlines[ac.airline];
  if (ac.phase === 'delivery') return fail('The aircraft has not been delivered yet');
  if (ac.rotation.length > 0 || !isOnGroundAtBase(ac)) return fail('Take the aircraft out of service first — it must be unassigned and at its base');
  let proceeds = 0;
  if (ac.owned) {
    proceeds = resaleValue(sim, ac);
    al.cash += proceeds;
    // Book the gain or loss against the carrying value.
    const gain = proceeds - ac.book;
    if (gain >= 0) { al.today.rev.other += gain; al.month.rev.other += gain; }
    else { al.today.cost.misc -= gain; al.month.cost.misc -= gain; }
  } else {
    const penalty = leaseReturnPenalty(sim, ac);
    spend(al, 'leases', penalty);
    proceeds = -penalty;
  }
  removeAircraft(sim, ac);
  return ok(proceeds);
}

export function refitCost(typeId: string): number {
  const t = AIRCRAFT_TYPE[typeId];
  return 60_000 + t.seats * 2_200;
}

export function reconfigureCabin(sim: Sim, acId: number, cabin: Triple, density: 0 | 1 | 2): Result {
  const ac = sim.acById.get(acId);
  if (!ac) return fail('Aircraft not found');
  const al = sim.game.airlines[ac.airline];
  const type = AIRCRAFT_TYPE[ac.type];
  if (!cabinFits(type, cabin, density)) return fail('That cabin layout does not fit in this aircraft');
  if (totalSeats(cabin) <= 0) return fail('The cabin needs at least one seat');
  if (ac.phase === 'delivery') {
    // Still at the factory: changes are free.
    ac.cabin = [cabin[0], cabin[1], cabin[2]];
    ac.density = density;
    return ok(undefined);
  }
  if (!isOnGroundAtBase(ac)) return fail('The aircraft must be on the ground at its base');
  const cost = refitCost(ac.type);
  if (al.cash < cost) return fail('Not enough cash for the refit');
  spend(al, 'maintenance', cost);
  ac.cabin = [cabin[0], cabin[1], cabin[2]];
  ac.density = density;
  ac.phase = 'maintenance';
  ac.note = 'Cabin refit';
  ac.next = sim.game.time + 3 * 1440;
  for (const rid of ac.rotation) {
    const r = sim.routeById.get(rid);
    if (r) routeChanged(sim, r);
  }
  return ok(undefined);
}

export function rebaseAircraft(sim: Sim, acId: number, base: AirportId): Result {
  const ac = sim.acById.get(acId);
  if (!ac) return fail('Aircraft not found');
  const al = sim.game.airlines[ac.airline];
  if (!al.hubs.some((h) => h.airport === base)) return fail('Not one of your bases');
  if (ac.base === base) return ok(undefined);
  if (AIRPORT[base].effRunway < AIRCRAFT_TYPE[ac.type].runway) return fail(`The runway at ${base} is too short for this aircraft`);
  if (ac.rotation.length > 0 || !(ac.phase === 'idle' || ac.phase === 'delivery')) {
    return fail('Unassign the aircraft from its routes before moving it');
  }
  if (ac.phase === 'idle') {
    const costs = legCosts(sim, al, { type: ac.type, cabin: [0, 0, 0], age: 0 }, ac.base, base, [0, 0, 0], 0);
    spend(al, 'fuel', costs.fuel);
    spend(al, 'crew', costs.crew);
    spend(al, 'airport', costs.airport);
    spend(al, 'navigation', costs.navigation);
  }
  ac.base = base;
  ac.at = base;
  return ok(undefined);
}

// ───────────────────────── Hubs ─────────────────────────

export function hubAt(al: Airline, airport: AirportId): Hub | undefined {
  return al.hubs.find((h) => h.airport === airport);
}

/** Opens a base at an airport, or upgrades an existing one by one level. */
export function developHub(sim: Sim, airlineId: number, airport: AirportId): Result<Hub> {
  const al = sim.game.airlines[airlineId];
  const ap = AIRPORT[airport];
  const existing = hubAt(al, airport);
  const level = ((existing?.level ?? 0) + 1) as 1 | 2 | 3;
  if (level > 3) return fail('Already a mega hub');
  const cost = hubSetupCost(ap, level) * sim.tuning.cost;
  if (al.cash < cost) return fail('Not enough cash');
  al.cash -= cost;
  sim.revision++;
  // Building up a base at a slot-limited airport comes with slots from the airport's pool.
  if (al.isPlayer) grantSlots(al, airport, HUB_SLOTS[level]);
  if (existing) {
    existing.level = level;
    sim.dirtyAirlines.add(airlineId);
    return ok(existing);
  }
  const hub: Hub = { airport, level: 1, opened: sim.game.time };
  al.hubs.push(hub);
  return ok(hub);
}

export function closeHub(sim: Sim, airlineId: number, airport: AirportId): Result {
  const al = sim.game.airlines[airlineId];
  if (airport === al.hq) return fail('You cannot close your headquarters');
  const hub = hubAt(al, airport);
  if (!hub) return fail('Not one of your bases');
  if (sim.fleetOf(airlineId).some((a) => a.base === airport)) return fail('Move the aircraft based here first');
  if (sim.routesOf(airlineId).some((r) => r.a === airport && !hubAt(al, r.b))) return fail('Close the routes that depend on this base first');
  al.hubs.splice(al.hubs.indexOf(hub), 1);
  sim.revision++;
  // Routes between two bases stay open, re-anchored at the other end.
  for (const r of sim.routesOf(airlineId)) {
    if (r.a === airport) flipRoute(sim, r);
  }
  sim.dirtyAirlines.add(airlineId);
  return ok(undefined);
}

function flipRoute(sim: Sim, r: Route): void {
  [r.a, r.b] = [r.b, r.a];
  r.rate.reverse();
  r.connRate.reverse();
}

// ───────────────────────── Routes ─────────────────────────

/** One-off cost of launching a route: station set-up, slots and paperwork. */
export function routeSetupCost(sim: Sim, al: Airline, a: AirportId, b: AirportId): number {
  let cost = 60_000;
  const stations = new Set<string>();
  for (const h of al.hubs) stations.add(h.airport);
  for (const r of sim.routesOf(al.id)) { stations.add(r.a); stations.add(r.b); }
  for (const id of [a, b]) {
    const ap = AIRPORT[id];
    if (!stations.has(id)) cost += 120_000 * feeFactor(ap);
    if (ap.slotLimited) cost += 900_000;
  }
  return cost * sim.tuning.cost;
}

export function findRoute(sim: Sim, airlineId: number, a: AirportId, b: AirportId): Route | undefined {
  return findMarket(sim, a, b)?.routes.find((r) => r.airline === airlineId);
}

export function openRoute(sim: Sim, airlineId: number, a: AirportId, b: AirportId, priceLevel = 1): Result<Route> {
  const g = sim.game;
  const al = g.airlines[airlineId];
  if (a === b) return fail('Pick two different airports');
  if (!AIRPORT[a] || !AIRPORT[b]) return fail('Unknown airport');
  if (!hubAt(al, a)) {
    if (hubAt(al, b)) [a, b] = [b, a];
    else return fail('One end of the route must be one of your bases');
  }
  if (findRoute(sim, airlineId, a, b)) return fail('You already fly this route');
  const dist = airportDistance(a, b);
  if (dist < 60) return fail('These airports are too close together');

  const cost = routeSetupCost(sim, al, a, b);
  if (al.cash < cost && al.isPlayer) return fail('Not enough cash to launch the route');
  spend(al, 'misc', cost);

  const m = getMarket(sim, a, b);
  const route: Route = {
    id: g.nextId++, airline: airlineId, a, b, dist,
    price: [Math.round(m.ref[0] * priceLevel), Math.round(m.ref[1] * priceLevel), Math.round(m.ref[2] * priceLevel)],
    aircraft: [],
    opened: g.time,
    flightNo: al.nextFlightNo,
    maturity: 0.4,
    promoUntil: 0,
    rate: [[0, 0, 0], [0, 0, 0]],
    connRate: [[0, 0, 0], [0, 0, 0]],
    connFare: [m.ref[0] * 0.6, m.ref[1] * 0.6, m.ref[2] * 0.6],
    cur: emptyStats(), prev: emptyStats(), life: emptyStats(),
    profitHistory: [],
    lossMonths: 0,
  };
  if (al.isPlayer) {
    route.auto = al.autoFares !== false;
    // The set-up fee at a slot-limited airport buys a newcomer's first pair of slots.
    for (const id of [a, b]) if (AIRPORT[id].slotLimited && !(al.slots?.[id])) grantSlots(al, id, ENTRANT_SLOTS);
  }
  al.nextFlightNo += 2;
  g.routes.push(route);
  sim.indexRoute(route);
  attachRoute(sim, route);
  routeChanged(sim, route);
  return ok(route);
}

export function closeRoute(sim: Sim, routeId: number): Result {
  const r = sim.routeById.get(routeId);
  if (!r) return fail('Route not found');
  for (const id of [...r.aircraft]) {
    const ac = sim.acById.get(id);
    if (ac) setRotation(sim, ac.id, ac.rotation.filter((x) => x !== routeId));
  }
  detachRoute(sim, r);
  const g = sim.game;
  g.routes.splice(g.routes.indexOf(r), 1);
  sim.unindexRoute(r);
  sim.offers.delete(r.id);
  const m = findMarket(sim, r.a, r.b);
  if (m) for (const other of m.routes) routeChanged(sim, other);
  sim.dirtyAirlines.add(r.airline);
  return ok(undefined);
}

function clearRotation(sim: Sim, ac: Aircraft): void {
  for (const rid of ac.rotation) {
    const r = sim.routeById.get(rid);
    if (!r) continue;
    const i = r.aircraft.indexOf(ac.id);
    if (i >= 0) r.aircraft.splice(i, 1);
    routeChanged(sim, r);
  }
  ac.rotation = [];
  ac.rotIndex = -1;
}

/**
 * Sets the routes an aircraft flies. It works through them in order, each as an
 * out-and-back from its base, then starts again.
 */
export function setRotation(sim: Sim, acId: number, routeIds: number[]): Result {
  const ac = sim.acById.get(acId);
  if (!ac) return fail('Aircraft not found');
  const unique = [...new Set(routeIds)];
  for (const rid of unique) {
    const r = sim.routeById.get(rid);
    if (!r || r.airline !== ac.airline) return fail('Route not found');
    if (r.a !== ac.base && r.b !== ac.base) return fail(`${r.a}–${r.b} does not start at this aircraft's base (${ac.base})`);
    const check = canOperate(ac.type, r.a, r.b);
    if (!check.ok) return fail(check.reason!);
  }
  const owner = sim.game.airlines[ac.airline];
  if (owner.isPlayer) {
    const short = rotationShortfall(sim, owner, ac, unique);
    if (short.length) return fail(describeShortfall(short[0]));
  }
  const before = new Set(ac.rotation);
  for (const rid of ac.rotation) {
    if (unique.includes(rid)) continue;
    const r = sim.routeById.get(rid);
    if (!r) continue;
    const i = r.aircraft.indexOf(ac.id);
    if (i >= 0) r.aircraft.splice(i, 1);
  }
  for (const rid of unique) {
    const r = sim.routeById.get(rid)!;
    if (!r.aircraft.includes(ac.id)) r.aircraft.push(ac.id);
  }
  ac.rotation = unique;
  ac.rotIndex = -1;
  sim.legs.delete(ac.id);
  const al = sim.game.airlines[ac.airline];
  for (const rid of new Set([...before, ...unique])) {
    const r = sim.routeById.get(rid);
    if (!r) continue;
    routeChanged(sim, r);
    // A change of capacity calls for new fares at once, not three days from now.
    if (faresManaged(al, r) && tuneFares(sim, r, undefined, 30)) refreshMarket(sim, getMarket(sim, r.a, r.b));
  }
  if (unique.length > 0) wake(sim, ac);
  else if (ac.phase === 'turnaround' && ac.at === ac.base) {
    ac.phase = 'idle';
    ac.next = NEVER;
    ac.note = 'Awaiting assignment';
  }
  return ok(undefined);
}

export function assignToRoute(sim: Sim, acId: number, routeId: number, exclusive = false): Result {
  const ac = sim.acById.get(acId);
  if (!ac) return fail('Aircraft not found');
  if (ac.rotation.includes(routeId)) return ok(undefined);
  return setRotation(sim, acId, exclusive ? [routeId] : [...ac.rotation, routeId]);
}

export function unassignFromRoute(sim: Sim, acId: number, routeId: number): Result {
  const ac = sim.acById.get(acId);
  if (!ac) return fail('Aircraft not found');
  return setRotation(sim, acId, ac.rotation.filter((r) => r !== routeId));
}

export function setPrice(sim: Sim, routeId: number, price: Triple): Result {
  const r = sim.routeById.get(routeId);
  if (!r) return fail('Route not found');
  const m = getMarket(sim, r.a, r.b);
  for (let c = 0; c < 3; c++) {
    r.price[c] = Math.round(Math.max(m.ref[c] * 0.3, Math.min(m.ref[c] * 3, price[c])));
  }
  routeChanged(sim, r);
  return ok(undefined);
}

/** Hands a route's fares to revenue management, or takes them back. */
export function setFareMode(sim: Sim, routeId: number, auto: boolean): Result {
  const r = sim.routeById.get(routeId);
  if (!r) return fail('Route not found');
  r.auto = auto;
  if (auto && tuneFares(sim, r, undefined, 30)) refreshMarket(sim, getMarket(sim, r.a, r.b));
  return ok(undefined);
}

/** Sets how new routes are priced and, optionally, switches every existing route too. */
export function setAutoFares(sim: Sim, airlineId: number, auto: boolean, existing = true): void {
  const al = sim.game.airlines[airlineId];
  al.autoFares = auto;
  if (existing) for (const r of sim.routesOf(airlineId)) setFareMode(sim, r.id, auto);
}

export function promoCost(sim: Sim, r: Route): number {
  const m = getMarket(sim, r.a, r.b);
  return Math.max(40_000, (m.demand[0] + m.demand[1]) * m.ref[0] * 1.2);
}

export function launchPromo(sim: Sim, routeId: number): Result {
  const r = sim.routeById.get(routeId);
  if (!r) return fail('Route not found');
  const al = sim.game.airlines[r.airline];
  if (sim.game.time < r.promoUntil) return fail('A promotion is already running on this route');
  const cost = promoCost(sim, r);
  if (al.cash < cost) return fail('Not enough cash');
  spend(al, 'marketing', cost);
  r.promoUntil = sim.game.time + 45 * 1440;
  r.maturity = Math.min(1, r.maturity + 0.25);
  routeChanged(sim, r);
  return ok(undefined);
}

// ───────────────────────── Policies & finance ─────────────────────────

export function setPolicy(sim: Sim, airlineId: number, patch: Partial<Policy>): void {
  const al = sim.game.airlines[airlineId];
  const p = { ...al.policy, ...patch };
  p.service = Math.max(1, Math.min(5, Math.round(p.service)));
  p.ancillary = Math.max(0, Math.min(3, Math.round(p.ancillary)));
  p.maintenance = Math.max(1, Math.min(5, Math.round(p.maintenance)));
  p.wages = Math.max(0.8, Math.min(1.3, p.wages));
  p.marketing = Math.max(0, p.marketing);
  al.policy = p;
  sim.offers.clear();
  for (const r of sim.routesOf(airlineId)) routeChanged(sim, r);
  refreshConnections(sim, al);
}

/** Monthly fuel burn in kg, estimated from the last completed month (or this one so far). */
export function monthlyFuelKg(sim: Sim, al: Airline): number {
  const last = al.history[al.history.length - 1];
  const cost = last ? last.cost.fuel : al.month.cost.fuel * (DAYS_PER_MONTH / Math.max(1, sim.game.day % 30 || 30));
  return cost / Math.max(0.1, sim.game.world.fuelPrice);
}

export function hedgeQuote(sim: Sim, al: Airline, share: number, months: number): { price: number; fee: number } {
  const spot = sim.game.world.fuelPrice;
  // Locking in for longer costs a little more per kilo, plus an arrangement fee.
  const price = spot * (1 + 0.012 * months);
  const fee = Math.max(50_000, monthlyFuelKg(sim, al) * months * share * spot * 0.015);
  return { price, fee };
}

export function buyHedge(sim: Sim, airlineId: number, share: number, months: number): Result {
  const al = sim.game.airlines[airlineId];
  const g = sim.game;
  let covered = 0;
  for (const h of al.hedges) if (g.time < h.until) covered += h.share;
  if (covered + share > 1.0001) return fail('You cannot hedge more than 100% of your fuel');
  const q = hedgeQuote(sim, al, share, months);
  if (al.cash < q.fee) return fail('Not enough cash for the arrangement fee');
  spend(al, 'misc', q.fee);
  al.hedges.push({ id: g.nextId++, share, price: q.price, until: g.time + months * 30.44 * 1440 });
  return ok(undefined);
}

export function receiveWindfall(al: Airline, amount: number): void {
  earn(al, 'other', amount);
}

export { marketLease };
