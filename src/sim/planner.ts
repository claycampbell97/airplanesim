// Route planning for the player: what would this aircraft earn on that route?
// Everything here uses the live market model, so forecasts match what happens
// once the route is flown (give or take the weather).

import { newLease } from './actions';
import { AIRCRAFT_TYPE, defaultPreset, makeCabin, totalSeats } from './data/aircraft';
import { AIRPORTS, airportDistance } from './data/airports';
import { baseDemand } from './demand';
import { DAYS_PER_MONTH, ownershipPerDay } from './finance';
import { aircraftAgeYears, cabinComfort, estimateService, getMarket } from './market';
import type { RouteEstimate } from './market';
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
  price?: Triple;
  cabin?: Triple;
  density?: 0 | 1 | 2;
  /** Plan for a specific aircraft rather than a factory-new one. */
  aircraft?: Aircraft;
  /** The existing route, if this is a what-if on a route already flown. */
  existing?: Route;
}

export function planRoute(sim: Sim, al: Airline, a: AirportId, b: AirportId, typeId: string, opts: PlanOptions = {}): RoutePlan {
  const type = AIRCRAFT_TYPE[typeId];
  const ac = opts.aircraft;
  const preset = defaultPreset(type);
  const density = ac?.density ?? opts.density ?? preset.density;
  const cabin = ac?.cabin ?? opts.cabin ?? makeCabin(type, density, preset.business, preset.first);
  const m = getMarket(sim, a, b);
  const price = opts.price ?? opts.existing?.price ?? [Math.round(m.ref[0]), Math.round(m.ref[1]), Math.round(m.ref[2])];
  const count = opts.count ?? 1;
  const check = canOperate(typeId, a, b);
  const comfort = ac ? cabinComfort(sim, ac) : Math.max(0, Math.min(1, type.comfort + (density === 0 ? -0.12 : density === 2 ? 0.12 : 0)));
  const estimate = estimateService(sim, al, a, b, typeId, cabin, count, price, comfort, opts.existing);
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
    if (dist > type.range || dist < 120 || ap.effRunway < type.runway) continue;
    const demand = baseDemand(hub, ap.id);
    if (demand < 25) continue;
    shortlist.push({ id: ap.id, demand });
  }
  shortlist.sort((x, y) => y.demand - x.demand);
  const out: RoutePlan[] = [];
  for (const s of shortlist.slice(0, 160)) {
    const plan = planRoute(sim, al, hub, s.id, typeId, opts);
    if (plan.feasible) out.push(plan);
  }
  out.sort((x, y) => y.profitPerDay - x.profitPerDay);
  return out.slice(0, limit);
}

/** Total seats of a plan's cabin. */
export function planSeats(plan: RoutePlan): number {
  return totalSeats(plan.cabin);
}
