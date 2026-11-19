// The simulation engine: owns the game state, advances time, and exposes the
// indexes that the rest of the sim modules work against.

import { createAircraft } from './actions';
import { createRival, reviewRival, seedRival } from './ai';
import { AIRLINE_TEMPLATES } from './data/airlines';
import { AIRCRAFT_TYPE, typeName } from './data/aircraft';
import { AIRPORT, AIRPORTS } from './data/airports';
import { lapseDecisions, resolveDecision as resolve, spawnDecisions } from './decisions';
import {
  chargeFixedCosts, closeMonth, emptyLedger, ledgerProfit, ledgerRevenue, overdraftLimit, serviceLoans,
} from './finance';
import {
  aircraftAgeYears, attachRoute, cabinComfort, getMarket, refreshAllMarkets, refreshConnections, refreshMarket,
  refreshWorldFactors, routeChanged,
} from './market';
import type { Market, Offer } from './market';
import { checkObjectives, initialObjectives } from './objectives';
import { faresManaged, manageFares, tuneFares } from './pricing';
import { grantSlots, homeSlots } from './slots';
import { stepAircraft } from './ops';
import { emptyStats } from './actions';
import { dayIndex, formatMonth, monthIndex } from './time';
import { addNews, FUEL_BASE, refreshUsedMarket, stepWorld } from './world';
import type {
  Aircraft, Airline, Airport, AirportId, Difficulty, Game, Livery, Order, RegionId, Route,
} from './types';

export const SAVE_VERSION = 1;

export interface Tuning {
  startCash: number;
  /** Multiplier on passenger demand. */
  demand: number;
  /** Multiplier on operating costs. */
  cost: number;
  /** Added to loan interest rates. */
  interest: number;
  aircraftPrice: number;
  /** Size of rival fleets relative to their templates. */
  aiScale: number;
  aiAggression: number;
  fuelVolatility: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  relaxed: { startCash: 300e6, demand: 1.15, cost: 0.9, interest: -0.005, aircraftPrice: 0.92, aiScale: 0.7, aiAggression: 0.6, fuelVolatility: 0.7 },
  standard: { startCash: 150e6, demand: 1.06, cost: 0.97, interest: 0, aircraftPrice: 1, aiScale: 1, aiAggression: 1, fuelVolatility: 1 },
  ruthless: { startCash: 80e6, demand: 1, cost: 1.03, interest: 0.015, aircraftPrice: 1.04, aiScale: 1.2, aiAggression: 1.4, fuelVolatility: 1.4 },
};

export const DIFFICULTY_INFO: Record<Difficulty, { name: string; blurb: string }> = {
  relaxed: { name: 'Relaxed', blurb: 'Deep pockets, cheaper aircraft, gentle rivals. Learn the ropes.' },
  standard: { name: 'Standard', blurb: 'A fair fight. Thin margins reward good decisions.' },
  ruthless: { name: 'Ruthless', blurb: 'Little cash, volatile fuel and rivals who want your routes.' },
};

export interface NewGameOptions {
  name: string;
  code: string;
  hq: AirportId;
  livery: Livery;
  difficulty: Difficulty;
  seed?: number;
}

export type SimEventType = 'news' | 'day' | 'month' | 'objective' | 'gameover' | 'decision' | 'delivered';
type Listener = (payload: any) => void;

export class Sim {
  game: Game;
  tuning: Tuning;
  readonly airports: Airport[] = AIRPORTS;

  // Derived state, rebuilt after loading.
  markets = new Map<number, Market>();
  /** Markets that have at least one route. */
  activeMarkets = new Set<Market>();
  /** Bumped whenever the seasonal/event multipliers change. */
  factorStamp = 0;
  offers = new Map<number, Offer>();
  /** Flights per day by aircraft id, cached like the offers. */
  legs = new Map<number, number>();
  routeById = new Map<number, Route>();
  acById = new Map<number, Aircraft>();
  season = new Float32Array(AIRPORTS.length).fill(1);
  eventFactor = new Float32Array(AIRPORTS.length).fill(1);
  disruption = new Float32Array(AIRPORTS.length);
  years = 0;
  /** Demand growth multiplier per region since the start of the game. */
  growth = { NAM: 1, LAM: 1, EUR: 1, MEA: 1, AFR: 1, SCA: 1, EAS: 1, SEA: 1, OCE: 1 } as Record<RegionId, number>;
  dirtyAirlines = new Set<number>();

  private routesByAirline = new Map<number, Route[]>();
  private fleetByAirline = new Map<number, Aircraft[]>();
  private listeners = new Map<SimEventType, Set<Listener>>();
  /** Fraction of a minute carried over between frames. */
  private carry = 0;
  /** Earliest pending aircraft event; lets most ticks skip the fleet scan. */
  nextScan = 0;
  /** Bumped whenever routes or hubs change, so views know to rebuild. */
  revision = 0;
  /** Cumulative milliseconds spent in each part of the simulation (diagnostics). */
  profile = { flights: 0, world: 0, airlines: 0, rivals: 0, markets: 0 };

  private constructor(game: Game) {
    this.game = game;
    this.tuning = TUNING[game.difficulty];
    for (const r of game.routes) this.indexRoute(r);
    for (const a of game.aircraft) this.indexAircraft(a);
    refreshWorldFactors(this);
    // Passenger flow rates are part of the saved state; only the lookup structures are rebuilt.
    for (const r of game.routes) attachRoute(this, r);
  }

  // ───────────── Construction ─────────────

  static create(opts: NewGameOptions): Sim {
    const seed = opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0);
    const tuning = TUNING[opts.difficulty];
    const player: Airline = {
      id: 0, name: opts.name, code: opts.code.toUpperCase().slice(0, 2), isPlayer: true, livery: opts.livery, hq: opts.hq,
      hubs: [{ airport: opts.hq, level: 2, opened: 0 }],
      cash: tuning.startCash, loans: [], hedges: [],
      policy: { service: 3, ancillary: 1, maintenance: 3, wages: 1, marketing: 100_000 },
      reputation: 38, morale: 62, otp: 0.85, otpDay: 0.85,
      today: emptyLedger(), month: emptyLedger(), history: [], daily: [],
      totalPax: 0, totalFlights: 0, bankrupt: false, insolventDays: 0,
      nextFlightNo: 101, nextReg: 1, founded: 0,
    };
    grantSlots(player, opts.hq, homeSlots(AIRPORT[opts.hq]));
    // Begin at breakfast time at the home base, so the first view of it is in daylight.
    const startMinute = Math.round(((((7 - AIRPORT[opts.hq].lon / 15) % 24) + 24) % 24) * 60);
    const game: Game = {
      version: SAVE_VERSION, seed, rng: seed, difficulty: opts.difficulty,
      time: startMinute, day: 0, month: 0,
      airlines: [player], aircraft: [], routes: [], orders: [], used: [], news: [], decisions: [],
      objectives: initialObjectives(),
      world: {
        fuelPrice: FUEL_BASE, fuelTrend: 0, fuelHistory: [FUEL_BASE],
        economy: 1, economyPhase: (seed % 628) / 100, economyHistory: [1], events: [],
      },
      nextId: 1, flags: {}, over: false,
    };
    const sim = new Sim(game);

    // Rivals. Each is seeded with an established network and fleet.
    for (const tpl of AIRLINE_TEMPLATES) {
      const al = createRival(sim, tpl, game.airlines.length);
      game.airlines.push(al);
    }
    for (const al of game.airlines) {
      if (al.isPlayer) continue;
      const tpl = AIRLINE_TEMPLATES[al.id - 1];
      seedRival(sim, al, Math.max(4, Math.round(tpl.size * tuning.aiScale)));
    }
    refreshUsedMarket(sim, true);
    refreshAllMarkets(sim, true);

    const hq = AIRPORT[opts.hq];
    addNews(sim, 'info', `${opts.name} is cleared for take-off`,
      `Your new airline is headquartered at ${hq.name} (${hq.id}). Acquire an aircraft, open a route and start flying.`, { airport: hq.id });
    game.news[game.news.length - 1].read = true;
    return sim;
  }

  serialize(): string {
    return JSON.stringify(this.game);
  }

  static load(json: string): Sim {
    const game = JSON.parse(json) as Game;
    if (!game || typeof game !== 'object' || !Array.isArray(game.airlines)) throw new Error('Not a save file');
    if (game.version !== SAVE_VERSION) throw new Error(`Save file is from an incompatible version (${game.version})`);
    return new Sim(game);
  }

  // ───────────── Lookups ─────────────

  get player(): Airline {
    return this.game.airlines[0];
  }

  airport(id: AirportId): Airport {
    return AIRPORT[id];
  }

  routesOf(airlineId: number): Route[] {
    return this.routesByAirline.get(airlineId) ?? [];
  }

  fleetOf(airlineId: number): Aircraft[] {
    return this.fleetByAirline.get(airlineId) ?? [];
  }

  indexRoute(r: Route): void {
    this.revision++;
    this.routeById.set(r.id, r);
    let list = this.routesByAirline.get(r.airline);
    if (!list) this.routesByAirline.set(r.airline, (list = []));
    list.push(r);
  }

  unindexRoute(r: Route): void {
    this.revision++;
    this.routeById.delete(r.id);
    const list = this.routesByAirline.get(r.airline);
    if (list) list.splice(list.indexOf(r), 1);
  }

  indexAircraft(ac: Aircraft): void {
    this.acById.set(ac.id, ac);
    let list = this.fleetByAirline.get(ac.airline);
    if (!list) this.fleetByAirline.set(ac.airline, (list = []));
    list.push(ac);
    this.nextScan = 0;
  }

  unindexAircraft(ac: Aircraft): void {
    this.acById.delete(ac.id);
    const list = this.fleetByAirline.get(ac.airline);
    if (list) list.splice(list.indexOf(ac), 1);
  }

  createAircraftFromOrder(al: Airline, order: Order): Aircraft {
    const ac = createAircraft(this, al, order);
    ac.phase = 'idle';
    return ac;
  }

  /** Removes an aircraft outright (used by rivals handing back leases). */
  removeAircraft(ac: Aircraft): void {
    for (const rid of ac.rotation) {
      const r = this.routeById.get(rid);
      if (!r) continue;
      const i = r.aircraft.indexOf(ac.id);
      if (i >= 0) r.aircraft.splice(i, 1);
      this.offers.delete(r.id);
    }
    this.legs.delete(ac.id);
    this.game.aircraft.splice(this.game.aircraft.indexOf(ac), 1);
    this.unindexAircraft(ac);
  }

  connectingLastMonth(): number {
    let n = 0;
    for (const r of this.routesOf(0)) n += r.prev.connPax;
    return n;
  }

  // ───────────── Events ─────────────

  on(type: SimEventType, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(type: SimEventType, payload?: unknown): void {
    const set = this.listeners.get(type);
    if (set) for (const fn of set) fn(payload);
  }

  onDelivered(ac: Aircraft): void {
    // The routes it was promised to gain capacity now: bring their demand and fares up to date.
    const al = this.game.airlines[ac.airline];
    for (const rid of ac.rotation) {
      const r = this.routeById.get(rid);
      if (!r) continue;
      routeChanged(this, r);
      if (faresManaged(al, r) && tuneFares(this, r, undefined, 30)) refreshMarket(this, getMarket(this, r.a, r.b));
    }
    if (ac.airline !== 0) return;
    const t = AIRCRAFT_TYPE[ac.type];
    addNews(this, 'good', `${typeName(t)} ${ac.reg} delivered`, `Your new aircraft has arrived at ${ac.base} and is ready to be assigned to a route.`, { airport: ac.base });
    this.emit('delivered', ac);
  }

  onGrounded(ac: Aircraft, repair: number): void {
    if (ac.airline !== 0) return;
    addNews(this, 'bad', `${ac.reg} grounded at ${ac.at}`,
      `A technical fault has taken the aircraft out of service until engineers can fix it. Repair bill: $${Math.round(repair / 1000)}k.`, { airport: ac.at });
  }

  onLongDelay(ac: Aircraft, delay: number): void {
    const al = this.game.airlines[ac.airline];
    al.reputation = Math.max(0, al.reputation - 0.15);
    if (ac.airline !== 0 || !ac.leg) return;
    if (this.game.flags.lastDelayNews && this.game.time - this.game.flags.lastDelayNews < 3 * 1440) return;
    this.game.flags.lastDelayNews = this.game.time;
    addNews(this, 'bad', `${Math.round(delay / 60)}-hour delay on ${ac.leg.from}–${ac.leg.to}`,
      'Stranded passengers have been paid compensation. Repeated long delays will hurt your reputation.', { airport: ac.leg.from });
  }

  // ───────────── Time ─────────────

  /** Game time including the sub-minute remainder, for smooth rendering. */
  get renderTime(): number {
    return this.game.time + this.carry;
  }

  /** Advances the simulation by a number of game minutes (may be fractional). */
  advance(minutes: number): void {
    if (this.game.over) return;
    this.carry += minutes;
    let whole = Math.floor(this.carry);
    this.carry -= whole;
    while (whole-- > 0 && !this.game.over) this.tick();
  }

  private tick(): void {
    const g = this.game;
    g.time += 1;

    if (this.dirtyAirlines.size) {
      for (const id of this.dirtyAirlines) refreshConnections(this, g.airlines[id]);
      this.dirtyAirlines.clear();
    }

    // Aircraft events carry their own exact times, so they can be worked through in
    // batches a few minutes apart rather than by walking the whole fleet every minute.
    if (g.time >= this.nextScan && (g.time & 3) === 0) {
      const t0 = performance.now();
      let next = Number.MAX_SAFE_INTEGER;
      const list = g.aircraft;
      for (let i = 0; i < list.length; i++) {
        const ac = list[i];
        if (ac.next <= g.time) stepAircraft(this, ac);
        if (ac.next < next) next = ac.next;
      }
      this.nextScan = next;
      this.profile.flights += performance.now() - t0;
    }

    if (g.time % 1440 === 0) this.endOfDay();
  }

  private endOfDay(): void {
    const g = this.game;
    g.day = dayIndex(g.time);
    const prof = this.profile;
    let t0 = performance.now();
    const lap = (key: keyof typeof prof) => {
      const t = performance.now();
      prof[key] += t - t0;
      t0 = t;
    };

    stepWorld(this);
    refreshWorldFactors(this);
    lapseDecisions(this);
    lap('world');

    for (const al of g.airlines) {
      if (al.bankrupt) continue;
      this.dailyAirline(al);
    }

    const month = monthIndex(g.time);
    if (month !== g.month) {
      g.month = month;
      this.endOfMonth();
    }
    // Reputations and on-time records just moved: forget yesterday's product ratings.
    this.offers.clear();
    this.legs.clear();
    lap('airlines');

    for (const al of g.airlines) {
      if (al.ai && !al.bankrupt && g.time >= al.ai.nextReview) reviewRival(this, al);
    }
    lap('rivals');

    manageFares(this);
    refreshAllMarkets(this);
    lap('markets');

    for (const o of checkObjectives(this)) {
      addNews(this, 'milestone', `Milestone: ${o.title}`, `${o.detail}.${o.reward ? ` Bonus: $${(o.reward / 1e6).toFixed(1)}M.` : ''}`);
      this.emit('objective', o);
    }
    this.nextScan = 0;
    this.emit('day', g.day);
  }

  /** Where an airline's reputation is heading, given its product, punctuality, fleet and marketing. */
  reputationTarget(al: Airline): number {
    const fleet = this.fleetOf(al.id).filter((a) => a.phase !== 'delivery');
    let comfort = 0.5;
    let age = 8;
    if (fleet.length) {
      comfort = 0;
      age = 0;
      for (const ac of fleet) {
        comfort += cabinComfort(this, ac);
        age += aircraftAgeYears(this, ac);
      }
      comfort /= fleet.length;
      age /= fleet.length;
    }
    const service = (al.policy.service - 1) / 4;
    const otp = Math.max(0, Math.min(1, (al.otp - 0.6) / 0.35));
    const young = Math.max(0, Math.min(1, 1 - age / 22));
    const lastPax = al.history[al.history.length - 1]?.pax ?? al.month.pax;
    const need = 150_000 + lastPax * 0.9;
    const marketing = 1 - Math.exp(-al.policy.marketing / need);
    return 12 + 26 * service + 12 * comfort + 18 * otp + 8 * young + 16 * marketing + 8 * (al.morale / 100);
  }

  private dailyAirline(al: Airline): void {
    const g = this.game;
    chargeFixedCosts(this, al);

    al.reputation += (this.reputationTarget(al) - al.reputation) * 0.035;
    al.reputation = Math.max(0, Math.min(100, al.reputation));

    const profit = ledgerProfit(al.today);
    const moraleTarget = Math.max(5, Math.min(98, 50 + (al.policy.wages - 1) * 150 + (profit > 0 ? 6 : -4)));
    al.morale += (moraleTarget - al.morale) * 0.05;

    for (const r of this.routesOf(al.id)) r.maturity = Math.min(1, r.maturity + 1 / 75);

    al.otpDay = al.otp;
    al.daily.push({ day: g.day, cash: al.cash, profit, pax: al.today.pax });
    const keep = al.isPlayer ? 420 : 60;
    if (al.daily.length > keep) al.daily.splice(0, al.daily.length - keep);
    al.today = emptyLedger();
    al.hedges = al.hedges.filter((h) => h.until > g.time);

    if (al.isPlayer) this.checkSolvency(al);
  }

  private checkSolvency(al: Airline): void {
    const limit = overdraftLimit(this, al);
    if (al.cash < -limit) {
      al.insolventDays += 1;
      const d = al.insolventDays;
      if (d === 1) addNews(this, 'bad', 'Overdraft limit breached', `You owe the bank more than your $${Math.round(limit / 1e6)}M overdraft allows. Raise cash within 45 days — sell aircraft, cut routes or take a loan — or the airline will be wound up.`);
      else if (d === 20) addNews(this, 'bad', 'Creditors are circling', '25 days remain to get back inside your overdraft limit.');
      else if (d === 38) addNews(this, 'bad', 'Final warning from the bank', 'One week remains before the airline is declared insolvent.');
      else if (d >= 45) {
        al.bankrupt = true;
        this.game.over = true;
        addNews(this, 'bad', `${al.name} ceases operations`, 'The airline has been declared insolvent and its aircraft repossessed.');
        this.emit('gameover', al);
      }
    } else if (al.insolventDays > 0) {
      al.insolventDays = 0;
      addNews(this, 'good', 'Back within your overdraft', 'The bank has stood down its lawyers.');
    }
  }

  private endOfMonth(): void {
    const g = this.game;
    for (const al of g.airlines) {
      if (al.bankrupt) continue;
      serviceLoans(al);
      const rec = closeMonth(this, al);
      if (al.isPlayer) {
        const profit = ledgerProfit(rec);
        const revenue = ledgerRevenue(rec);
        if (rec.flights > 0) {
          addNews(this, profit >= 0 ? 'good' : 'bad', `${formatMonth(rec.month)}: ${profit >= 0 ? 'profit' : 'loss'} of $${(Math.abs(profit) / 1e6).toFixed(2)}M`,
            `Revenue $${(revenue / 1e6).toFixed(2)}M from ${Math.round(rec.pax).toLocaleString()} passengers on ${rec.flights.toLocaleString()} flights.`);
        }
      }
    }
    for (const r of g.routes) {
      const s = r.cur;
      r.life.flights += s.flights;
      r.life.connPax += s.connPax;
      r.life.revenue += s.revenue;
      r.life.cost += s.cost;
      for (let c = 0; c < 3; c++) {
        r.life.pax[c] += s.pax[c];
        r.life.seats[c] += s.seats[c];
      }
      r.profitHistory.push(s.revenue - s.cost);
      if (r.profitHistory.length > 24) r.profitHistory.shift();
      // The player's routes track their losing streak here; rivals do it in their own review.
      if (r.airline === 0) r.lossMonths = s.flights > 0 && s.revenue < s.cost ? r.lossMonths + 1 : 0;
      r.prev = s;
      r.cur = emptyStats();
    }
    for (const ac of g.aircraft) {
      ac.monthHours = 0;
      ac.monthFlights = 0;
      ac.monthProfit = 0;
    }
    spawnDecisions(this);
    this.emit('month', g.month);
  }

  resolveDecision(id: number, option: number): void {
    resolve(this, id, option);
  }
}
