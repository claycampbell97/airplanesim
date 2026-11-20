// Route planning for the player: what would this aircraft earn on that route?
// Everything here uses the live market model, so forecasts match what happens
// once the route is flown (give or take the weather).

import { newLease } from './actions';
import { AIRCRAFT_TYPE, defaultPreset, makeCabin, totalSeats, usableRange } from './data/aircraft';
import { AIRPORTS, airportDistance } from './data/airports';
import { baseDemand } from './demand';
import { DAYS_PER_MONTH, ownershipPerDay } from './finance';
import { aircraftAgeYears, cabinComfort, dailyRoundTrips, estimateService, getMarket } from './market';
import type { OfferInput, RouteEstimate } from './market';
import { serviceFares } from './pricing';
import { canOperate, planFlight } from './ops';
import type { FlightPlan } from './ops';
import type { Aircraft, Airline, AirportId, Route, Triple } from './types';
import type { Sim } from './sim';

export interface RoutePlan {
  a: AirportId;
  b: AirportId;
  dist: number;
  type: string;
  cabin: Triple;
  price: Triple;
  feasible: boolean;
  reason?: string;
  estimate: RouteEstimate;
  flight: FlightPlan;
  /** Expected profit per day across all the aircraft considered. */
  profitPerDay: number;
  /** Expected profit as a share of revenue. */
  margin: number;
}

export interface PlanOptions {
  /** Number of aircraft flying the route full-time (may be fractional for shared rotations). */
  count?: number;
  /** Fares to assume. Left out, the plan uses the fares revenue management would settle on (if the airline uses it). */
  price?: Triple;
  cabin?: Triple;
  density?: 0 | 1 | 2;
  /** Plan for a specific aircraft rather than a factory-new one. */
  aircraft?: Aircraft;
  /** The existing route, if this is a what-if on a route already flown. */
  existing?: Route;
  /** A rough fare estimate is enough (for ranking many candidates quickly). */
  quick?: boolean;
  /** How well known the route is: 1 once established, about 0.6 on average in its first month. */
  boost?: number;
  /** Assume a rival moves in with a matching service. */
  contested?: boolean;
}

/** Awareness of a new route averaged over its first month (it starts at 0.4 and builds daily). */
export const FIRST_MONTH_BOOST = 0.6;

/** Whether a route's fares would be looked after by revenue management. */
function managed(al: Airline, existing?: Route): boolean {
  if (al.ai) return true;
  return existing ? !!existing.auto : al.autoFares !== false;
}

export function planRoute(sim: Sim, al: Airline, a: AirportId, b: AirportId, typeId: string, opts: PlanOptions = {}): RoutePlan {
  const type = AIRCRAFT_TYPE[typeId];
  const ac = opts.aircraft;
  const preset = defaultPreset(type);
  const density = ac?.density ?? opts.density ?? preset.density;
  const cabin = ac?.cabin ?? opts.cabin ?? makeCabin(type, density, preset.business, preset.first);
  const m = getMarket(sim, a, b);
  const count = opts.count ?? 1;
  const check = canOperate(typeId, a, b);
  const comfort = ac ? cabinComfort(sim, ac) : Math.max(0, Math.min(1, type.comfort + (density === 0 ? -0.12 : density === 2 ? 0.12 : 0)));
  const boost = opts.boost ?? 1;
  // "What if a rival moves in": someone matching this service at a slightly keener fare.
  const rival: OfferInput | undefined = opts.contested
    ? { freq: dailyRoundTrips(typeId, m.dist) * count, seats: cabin, price: [m.ref[0] * 0.95, m.ref[1] * 0.95, m.ref[2] * 0.95], quality: 0.5, boost: 1 }
    : undefined;
  const level = al.ai?.fareLevel ?? 1;
  const start: Triple = opts.existing ? [opts.existing.price[0], opts.existing.price[1], opts.existing.price[2]]
    : [Math.round(m.ref[0] * level), Math.round(m.ref[1] * level), Math.round(m.ref[2] * level)];
  const price = opts.price ?? (managed(al, opts.existing) && check.ok
    ? serviceFares(sim, al, a, b, typeId, cabin, count, comfort, start, { existing: opts.existing, exact: !opts.quick, connections: true, boost, rival })
    : start);
  const estimate = estimateService(sim, al, a, b, typeId, cabin, count, price, comfort, opts.existing, false, boost, rival);
  const age = ac ? aircraftAgeYears(sim, ac) : 0;
  const ownDay = (ac ? ownershipPerDay(ac) : newLease(sim, typeId, al) / DAYS_PER_MONTH) * count;
  const legs = estimate.freq * 2;
  const flight = planFlight(sim, al, typeId, cabin, age, ownDay, a, b, estimate.pax, price, legs, estimate.conn, estimate.connFare);
  return {
    a, b, dist: m.dist, type: typeId, cabin, price,
    feasible: check.ok, reason: check.reason,
    estimate, flight,
    profitPerDay: flight.profitPerDay,
    margin: flight.revenue > 0 ? flight.profit / flight.revenue : 0,
  };
}

/**
 * The most promising new routes from a base for a given aircraft type, ranked by
 * expected daily profit.
 */
export function suggestRoutes(sim: Sim, al: Airline, hub: AirportId, typeId: string, limit = 12, opts: PlanOptions = {}): RoutePlan[] {
  const type = AIRCRAFT_TYPE[typeId];
  const existing = new Set(sim.routesOf(al.id).map((r) => (r.a === hub ? r.b : r.b === hub ? r.a : '')));
  const shortlist: { id: AirportId; demand: number }[] = [];
  for (const ap of AIRPORTS) {
    if (ap.id === hub || existing.has(ap.id)) continue;
    const dist = airportDistance(hub, ap.id);
    if (dist > usableRange(typeId) || dist < 120 || ap.effRunway < type.runway) continue;
    const demand = baseDemand(hub, ap.id);
    if (demand < 25) continue;
    shortlist.push({ id: ap.id, demand });
  }
  shortlist.sort((x, y) => y.demand - x.demand);
  // Rank everything on a quick fare estimate, then work the front-runners out properly.
  const rough: RoutePlan[] = [];
  for (const s of shortlist.slice(0, 160)) {
    const plan = planRoute(sim, al, hub, s.id, typeId, { ...opts, quick: true });
    if (plan.feasible) rough.push(plan);
  }
  rough.sort((x, y) => y.profitPerDay - x.profitPerDay);
  const out = rough.slice(0, limit * 2).map((r) => planRoute(sim, al, hub, r.b, typeId, opts));
  out.sort((x, y) => y.profitPerDay - x.profitPerDay);
  return out.slice(0, limit);
}

/** A route forecast with its range: the first month, once established, and if a rival moves in. */
export interface RouteForecast {
  established: RoutePlan;
  firstMonth: RoutePlan;
  contested: RoutePlan;
}

export function forecastRoute(sim: Sim, al: Airline, a: AirportId, b: AirportId, typeId: string, opts: PlanOptions = {}): RouteForecast {
  return {
    established: planRoute(sim, al, a, b, typeId, opts),
    firstMonth: planRoute(sim, al, a, b, typeId, { ...opts, boost: FIRST_MONTH_BOOST }),
    contested: planRoute(sim, al, a, b, typeId, { ...opts, contested: true }),
  };
}

/** Total seats of a plan's cabin. */
export function planSeats(plan: RoutePlan): number {
  return totalSeats(plan.cabin);
}
