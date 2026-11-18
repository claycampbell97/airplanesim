// Core data model of the simulation.
//
// Everything reachable from `Game` is plain JSON-serialisable data so that a
// save file is simply `JSON.stringify(game)`. Derived/cached structures live on
// the `Sim` wrapper (see sim.ts) and are rebuilt after loading.

export type AirportId = string; // IATA code
export type RegionId = 'NAM' | 'LAM' | 'EUR' | 'MEA' | 'AFR' | 'SCA' | 'EAS' | 'SEA' | 'OCE';

/** Cabin classes: 0 economy, 1 business, 2 first. */
export type ClassId = 0 | 1 | 2;
export type Triple = [number, number, number];

export interface Airport {
  id: AirportId;
  index: number;
  icao: string;
  name: string;
  city: string;
  country: string;
  countryName: string;
  /** Country this airport counts as domestic with (territories map to their parent). */
  home: string;
  region: RegionId;
  bloc: string;
  lat: number;
  lon: number;
  /** Elevation in metres. */
  elev: number;
  /** Longest runway in metres. */
  runway: number;
  /** Runway length corrected for elevation (thin air needs more runway). */
  effRunway: number;
  /** Approximate annual passengers, millions. */
  pax: number;
  /** Local (origin & destination) demand mass, derived from pax and transfer share. */
  mass: number;
  /** 1 (small regional) .. 5 (mega hub). */
  tier: 1 | 2 | 3 | 4 | 5;
  /** 0..1 share of business travel. */
  business: number;
  /** 0..1 share of leisure travel. */
  leisure: number;
  /** Peak season is northern winter. */
  winterSun: boolean;
  slotLimited: boolean;
  /** Fare / local cost level of the country (1 = world reference). */
  wealth: number;
  /** Unit vector on the globe (y up, see geo.ts). */
  pos: [number, number, number];
}

export type AircraftCategory = 'turboprop' | 'regional' | 'narrowbody' | 'widebody' | 'jumbo';

/** Geometry parameters for the procedural 3D model (metres). */
export interface AircraftShape {
  length: number;
  span: number;
  /** Fuselage diameter. */
  diameter: number;
  engines: 2 | 4;
  engineMount: 'wing' | 'rear' | 'prop';
  /** Wing mounted high on the fuselage (turboprops). */
  highWing?: boolean;
  tail: 'conventional' | 'T';
  winglet: 'none' | 'blended' | 'sharklet' | 'split' | 'raked' | 'fence';
  /** Wing sweep at quarter chord, degrees. */
  sweep: number;
  /** Partial ('hump') or full-length upper deck. */
  upperDeck?: 'hump' | 'full';
  /** Engine nacelle diameter. */
  engineDiameter: number;
}

export interface AircraftType {
  id: string;
  maker: string;
  model: string;
  category: AircraftCategory;
  /** Cabin floor area expressed in standard economy seats. */
  seats: number;
  /** Maximum range with a full cabin, km. */
  range: number;
  /** Cruise speed, km/h. */
  speed: number;
  /** Cruise fuel burn, kg per km. */
  fuelKm: number;
  /** Extra fuel for taxi, take-off and climb, kg per flight. */
  fuelCycle: number;
  /** Price of a factory-new aircraft, USD. */
  price: number;
  /** Monthly operating lease for a new aircraft, USD. */
  lease: number;
  /** Maximum take-off weight, tonnes (drives landing and navigation fees). */
  mtow: number;
  /** Required runway at sea level, metres. */
  runway: number;
  /** Minimum turnaround, minutes. */
  turnaround: number;
  pilots: number;
  /** Minimum cabin crew. */
  cabinCrew: number;
  /** Maintenance cost per flight hour / per cycle for a new airframe, USD. */
  maintHour: number;
  maintCycle: number;
  /** Belly cargo capacity, tonnes. */
  cargo: number;
  /** 0..1 passenger appeal of the cabin (noise, width, pressurisation). */
  comfort: number;
  /** Still in production: can be ordered new. Otherwise second-hand only. */
  inProduction: boolean;
  /** Typical age range of second-hand examples, years. */
  usedAge: [number, number];
  blurb: string;
  shape: AircraftShape;
}

export type LiveryStyle = 'cheatline' | 'eurowhite' | 'wave' | 'tailband' | 'bellyswoop' | 'retro' | 'solid';

export interface Livery {
  /** Main brand colour. */
  primary: string;
  secondary: string;
  /** Fuselage base colour. */
  base: string;
  style: LiveryStyle;
  /** Tail logo glyph id. */
  emblem: 'chevron' | 'bird' | 'star' | 'sun' | 'wing' | 'compass' | 'wave' | 'crown' | 'leaf' | 'bolt';
}

export interface Hub {
  airport: AirportId;
  /** 1 base, 2 hub (connections), 3 mega hub. */
  level: 1 | 2 | 3;
  opened: number;
}

export interface Loan {
  id: number;
  principal: number;
  balance: number;
  /** Annual interest rate. */
  rate: number;
  /** Monthly instalment (principal + interest). */
  payment: number;
  monthsLeft: number;
  taken: number;
}

export interface FuelHedge {
  id: number;
  /** Share of fuel burn covered, 0..1. */
  share: number;
  price: number;
  until: number;
}

export interface Policy {
  /** In-flight product, 1 (no frills) .. 5 (luxury). */
  service: number;
  /** Unbundling / fees, 0 (all inclusive) .. 3 (pay for everything). */
  ancillary: number;
  /** Maintenance spending, 1 (legal minimum) .. 5 (gold plated). */
  maintenance: number;
  /** Pay relative to market, 0.8 .. 1.3. */
  wages: number;
  /** Brand marketing budget, USD per month. */
  marketing: number;
}

export const REVENUE_KEYS = ['ticketsY', 'ticketsJ', 'ticketsF', 'ancillary', 'cargo', 'other'] as const;
export const COST_KEYS = [
  'fuel', 'crew', 'maintenance', 'airport', 'navigation', 'service', 'distribution',
  'leases', 'depreciation', 'staff', 'marketing', 'hubs', 'interest', 'compensation', 'misc',
] as const;
export type RevenueKey = (typeof REVENUE_KEYS)[number];
export type CostKey = (typeof COST_KEYS)[number];

export interface Ledger {
  rev: Record<RevenueKey, number>;
  cost: Record<CostKey, number>;
  pax: number;
  flights: number;
  /** Available seat-km and revenue passenger-km, for load factor and yield. */
  ask: number;
  rpk: number;
  delayed: number;
  cancelled: number;
}

export interface MonthRecord extends Ledger {
  /** Month index since game start. */
  month: number;
  cashEnd: number;
  fleet: number;
  routes: number;
  reputation: number;
  valuation: number;
}

export interface AiState {
  style: 'legacy' | 'lowcost' | 'regional' | 'premium';
  aggression: number;
  /** Fare level relative to reference. */
  fareLevel: number;
  fleetCap: number;
  nextReview: number;
}

export interface Airline {
  id: number;
  name: string;
  code: string;
  isPlayer: boolean;
  livery: Livery;
  hq: AirportId;
  hubs: Hub[];
  cash: number;
  loans: Loan[];
  hedges: FuelHedge[];
  policy: Policy;
  /** 0..100 brand reputation. */
  reputation: number;
  /** 0..100 staff morale. */
  morale: number;
  /** Rolling on-time performance, 0..1. */
  otp: number;
  /** On-time performance as of the last midnight: what passengers have heard about. */
  otpDay: number;
  /** Running totals for the current day and month. */
  today: Ledger;
  month: Ledger;
  /** Completed months, oldest first. */
  history: MonthRecord[];
  /** Daily cash / profit samples for charts (most recent last). */
  daily: { day: number; cash: number; profit: number; pax: number }[];
  /** Lifetime totals. */
  totalPax: number;
  totalFlights: number;
  bankrupt: boolean;
  /** Days spent beyond the overdraft limit. */
  insolventDays: number;
  ai?: AiState;
  nextFlightNo: number;
  nextReg: number;
  founded: number;
}

export interface RouteStats {
  flights: number;
  pax: Triple;
  seats: Triple;
  connPax: number;
  revenue: number;
  cost: number;
}

export interface Route {
  id: number;
  airline: number;
  /** `a` is always one of the airline's hubs at the time of opening. */
  a: AirportId;
  b: AirportId;
  dist: number;
  /** One-way fares per class. */
  price: Triple;
  aircraft: number[];
  opened: number;
  flightNo: number;
  /** Awareness ramp-up for new routes, 0..1. */
  maturity: number;
  /** Local-demand boost from a launch promotion until this time. */
  promoUntil: number;
  /** Booking pools: waiting passengers per direction (0: a→b, 1: b→a) and class. */
  pool: [Triple, Triple];
  connPool: [Triple, Triple];
  poolTime: number;
  /** Inflow rates in passengers/day, maintained by the market model. */
  rate: [Triple, Triple];
  connRate: [Triple, Triple];
  /** Average revenue per connecting passenger on this leg. */
  connFare: Triple;
  /** Current month / previous month / lifetime statistics. */
  cur: RouteStats;
  prev: RouteStats;
  life: RouteStats;
  /** Monthly profit history for sparklines (most recent last). */
  profitHistory: number[];
  /** Consecutive loss-making months (used by the AI). */
  lossMonths: number;
}

export type AircraftPhase = 'delivery' | 'idle' | 'turnaround' | 'enroute' | 'maintenance' | 'grounded';

export interface Leg {
  route: number;
  from: AirportId;
  to: AirportId;
  dep: number;
  arr: number;
  pax: Triple;
  connPax: number;
  revenue: number;
  cost: number;
  delay: number;
}

export interface Aircraft {
  id: number;
  airline: number;
  type: string;
  reg: string;
  owned: boolean;
  /** Monthly lease payment (0 when owned). */
  leaseRate: number;
  /** Earliest time the lease can be returned without penalty. */
  leaseEnd: number;
  /** Price paid when bought. */
  cost: number;
  /** Current book value (owned aircraft). */
  book: number;
  /** Manufacture time in game minutes (negative for aircraft older than the game). */
  built: number;
  acquired: number;
  /** Installed seats per class. */
  cabin: Triple;
  /** 0 dense, 1 standard, 2 spacious economy pitch. */
  density: 0 | 1 | 2;
  base: AirportId;
  /** Routes flown in rotation, each as an out-and-back from the base. */
  rotation: number[];
  rotIndex: number;
  phase: AircraftPhase;
  /** Airport the aircraft is at when on the ground. */
  at: AirportId;
  leg: Leg | null;
  /** Time of the next state change. */
  next: number;
  hours: number;
  cycles: number;
  hoursSinceCheck: number;
  lastHeavyCheck: number;
  /** 1 = factory fresh, lower = worn. */
  condition: number;
  /** Month-to-date utilisation. */
  monthHours: number;
  monthFlights: number;
  monthProfit: number;
  /** Text shown in the UI for the current status. */
  note: string;
  /** Rival bookkeeping: number of thin routes this aircraft is meant to share its day between. */
  partTime?: number;
}

export interface Order {
  id: number;
  airline: number;
  type: string;
  deliver: number;
  cabin: Triple;
  density: 0 | 1 | 2;
  base: AirportId;
  lease: boolean;
  price: number;
  leaseRate: number;
  /** Second-hand aircraft: age in years at delivery. */
  age: number;
}

export interface UsedListing {
  id: number;
  type: string;
  age: number;
  price: number;
  lease: number;
  condition: number;
  expires: number;
  seller: string;
}

export type NewsKind = 'info' | 'good' | 'bad' | 'world' | 'rival' | 'milestone';

export interface NewsItem {
  id: number;
  time: number;
  kind: NewsKind;
  title: string;
  body: string;
  /** Optional thing to focus on the globe. */
  airport?: AirportId;
  route?: number;
  read: boolean;
}

export interface WorldEvent {
  id: number;
  type: string;
  title: string;
  start: number;
  end: number;
  /** Demand multiplier applied to an airport, a region or the whole world. */
  airport?: AirportId;
  region?: RegionId;
  demand: number;
  /** Multiplier on the fuel price. */
  fuel?: number;
  /** Share of flights disrupted at the airport. */
  disruption?: number;
}

export interface Decision {
  id: number;
  type: string;
  title: string;
  body: string;
  options: { label: string; detail: string }[];
  expires: number;
  data: Record<string, number | string>;
}

export interface Objective {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  doneAt: number;
  reward: number;
}

export type Difficulty = 'relaxed' | 'standard' | 'ruthless';

export interface World {
  /** USD per kg of jet fuel. */
  fuelPrice: number;
  fuelTrend: number;
  fuelHistory: number[];
  /** Global demand index (1 = trend). */
  economy: number;
  economyPhase: number;
  economyHistory: number[];
  events: WorldEvent[];
}

export interface Game {
  version: number;
  seed: number;
  rng: number;
  difficulty: Difficulty;
  /** Game minutes since the epoch (see time.ts). */
  time: number;
  day: number;
  month: number;
  airlines: Airline[];
  aircraft: Aircraft[];
  routes: Route[];
  orders: Order[];
  used: UsedListing[];
  news: NewsItem[];
  decisions: Decision[];
  objectives: Objective[];
  world: World;
  nextId: number;
  /** Tutorial progress flags. */
  flags: Record<string, number>;
  over: boolean;
}

export const PLAYER = 0;
