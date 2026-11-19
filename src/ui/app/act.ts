// Helpers for running simulation actions from the interface.

import type { Result } from '../../sim/actions';
import { AIRCRAFT_TYPE, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import type { Aircraft, Airline, Route } from '../../sim/types';
import type { Sim } from '../../sim/sim';
import { game, refresh, setState, toast } from './store';

/**
 * Unwraps the result of a game action: failures become an error toast, successes
 * refresh the interface and the map. Returns the value, or undefined on failure.
 */
export function attempt<T>(result: Result<T>, okMessage?: string): T | undefined {
  if (!result.ok) {
    toast('error', result.reason);
    return undefined;
  }
  game.globe?.invalidate();
  refresh();
  if (okMessage) toast('info', okMessage);
  return result.value;
}

/** Asks for confirmation before something drastic. */
export function confirm(title: string, body: string, action: string, onConfirm: () => void, danger = true): void {
  setState({ modal: { kind: 'confirm', title, body, action, danger, onConfirm } });
}

// ───────────── Shared descriptions ─────────────

export function routeLabel(r: Pick<Route, 'a' | 'b'>): string {
  return `${r.a}–${r.b}`;
}

export function routeCities(r: Pick<Route, 'a' | 'b'>): string {
  return `${AIRPORT[r.a].city} – ${AIRPORT[r.b].city}`;
}

export function flightNumber(al: Airline, r: Route, from: string): string {
  return `${al.code}${r.flightNo + (from === r.a ? 0 : 1)}`;
}

export function aircraftTitle(ac: Aircraft): string {
  return `${typeName(AIRCRAFT_TYPE[ac.type])} ${ac.reg}`;
}

/** One-line status of an aircraft for lists. */
export function aircraftStatus(sim: Sim, ac: Aircraft): { text: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  switch (ac.phase) {
    case 'delivery': {
      const days = Math.max(0, Math.ceil((ac.next - sim.game.time) / 1440));
      return { text: `Arrives in ${days} day${days === 1 ? '' : 's'}`, tone: 'muted' };
    }
    case 'idle':
      return { text: 'Idle — not assigned', tone: 'warn' };
    case 'enroute':
      return ac.leg ? { text: `Flying ${ac.leg.from} → ${ac.leg.to}`, tone: 'good' } : { text: 'Flying', tone: 'good' };
    case 'maintenance':
      return { text: ac.note || 'In maintenance', tone: 'muted' };
    case 'grounded':
      return { text: ac.note || 'Grounded', tone: 'bad' };
    case 'turnaround':
      return { text: ac.note ? `${ac.note} at ${ac.at}` : `On the ground at ${ac.at}`, tone: ac.note.startsWith('Held') || ac.note.startsWith('Grounded') ? 'bad' : 'good' };
  }
}

export function loadFactorOf(stats: { pax: number[]; seats: number[] }): number {
  const seats = stats.seats[0] + stats.seats[1] + stats.seats[2];
  const pax = stats.pax[0] + stats.pax[1] + stats.pax[2];
  return seats > 0 ? pax / seats : NaN;
}

/** The most recent period with flights: this month if it has enough data, otherwise last month. */
export function recentStats(r: Route) {
  return r.cur.flights >= 6 || r.prev.flights === 0 ? r.cur : r.prev;
}
