import type { AircraftCategory, AircraftShape, AircraftType, Triple } from '../types';

// Aircraft catalogue. Performance and dimensions follow the real types closely;
// prices and operating costs are realistic market values rather than list prices.

type Row = Omit<AircraftType, 'shape' | 'inProduction' | 'usedAge'> & {
  inProduction?: boolean;
  usedAge?: [number, number];
  shape: AircraftShape;
};

const M = 1_000_000;
const K = 1_000;

const ROWS: Row[] = [
  // ───────────── Turboprops ─────────────
  {
    id: 'at76', maker: 'ATR', model: '72-600', category: 'turboprop',
    seats: 72, range: 1400, speed: 510, fuelKm: 1.25, fuelCycle: 150,
    price: 24 * M, lease: 165 * K, mtow: 23, runway: 1250, turnaround: 25,
    pilots: 2, cabinCrew: 2, maintHour: 420, maintCycle: 150, cargo: 0.3, comfort: 0.34,
    blurb: 'The short-hop workhorse. Sips fuel and lands almost anywhere, but slow and noisy.',
    shape: { length: 27.2, span: 27.1, diameter: 2.75, engines: 2, engineMount: 'prop', highWing: true, tail: 'T', winglet: 'none', sweep: 3, engineDiameter: 1.0 },
  },
  {
    id: 'dh8d', maker: 'De Havilland', model: 'Dash 8-400', category: 'turboprop',
    seats: 78, range: 2040, speed: 667, fuelKm: 1.75, fuelCycle: 200,
    price: 21 * M, lease: 150 * K, mtow: 30.5, runway: 1300, turnaround: 25,
    pilots: 2, cabinCrew: 2, maintHour: 520, maintCycle: 170, cargo: 0.3, comfort: 0.36,
    inProduction: false, usedAge: [5, 16],
    blurb: 'A turboprop that thinks it is a jet: nearly jet speed on thin routes and short runways.',
    shape: { length: 32.8, span: 28.4, diameter: 2.7, engines: 2, engineMount: 'prop', highWing: true, tail: 'T', winglet: 'none', sweep: 4, engineDiameter: 1.1 },
  },

  // ───────────── Regional jets ─────────────
  {
    id: 'crj9', maker: 'Bombardier', model: 'CRJ900', category: 'regional',
    seats: 88, range: 2870, speed: 830, fuelKm: 2.3, fuelCycle: 450,
    price: 16 * M, lease: 135 * K, mtow: 38, runway: 1850, turnaround: 30,
    pilots: 2, cabinCrew: 2, maintHour: 620, maintCycle: 220, cargo: 0.3, comfort: 0.4,
    inProduction: false, usedAge: [7, 18],
    blurb: 'Cheap to pick up second-hand. A slim cabin and thirsty engines for its size.',
    shape: { length: 36.2, span: 24.9, diameter: 2.7, engines: 2, engineMount: 'rear', tail: 'T', winglet: 'blended', sweep: 26, engineDiameter: 1.35 },
  },
  {
    id: 'e175', maker: 'Embraer', model: 'E175', category: 'regional',
    seats: 84, range: 3700, speed: 830, fuelKm: 2.2, fuelCycle: 450,
    price: 33 * M, lease: 225 * K, mtow: 40.4, runway: 1500, turnaround: 30,
    pilots: 2, cabinCrew: 2, maintHour: 600, maintCycle: 220, cargo: 0.4, comfort: 0.56,
    blurb: 'A comfortable two-by-two cabin with no middle seats. The regional benchmark.',
    shape: { length: 31.7, span: 28.7, diameter: 3.0, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'blended', sweep: 23, engineDiameter: 1.45 },
  },
  {
    id: 'e290', maker: 'Embraer', model: 'E190-E2', category: 'regional',
    seats: 110, range: 5280, speed: 870, fuelKm: 2.0, fuelCycle: 500,
    price: 41 * M, lease: 275 * K, mtow: 56.4, runway: 1450, turnaround: 35,
    pilots: 2, cabinCrew: 3, maintHour: 560, maintCycle: 230, cargo: 0.8, comfort: 0.66,
    blurb: 'Geared-turbofan efficiency in a small package, with surprising range and short-field legs.',
    shape: { length: 36.3, span: 33.7, diameter: 3.0, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 25, engineDiameter: 1.9 },
  },
  {
    id: 'e295', maker: 'Embraer', model: 'E195-E2', category: 'regional',
    seats: 136, range: 4800, speed: 870, fuelKm: 2.2, fuelCycle: 550,
    price: 47 * M, lease: 315 * K, mtow: 61.5, runway: 1750, turnaround: 35,
    pilots: 2, cabinCrew: 3, maintHour: 600, maintCycle: 240, cargo: 1.0, comfort: 0.66,
    blurb: 'The lowest seat cost of any small jet. Right-sized for markets too thin for a narrowbody.',
    shape: { length: 41.5, span: 35.1, diameter: 3.0, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 25, engineDiameter: 1.9 },
  },

  // ───────────── Narrowbodies ─────────────
  {
    id: 'bcs1', maker: 'Airbus', model: 'A220-100', category: 'narrowbody',
    seats: 125, range: 6390, speed: 840, fuelKm: 2.05, fuelCycle: 550,
    price: 41 * M, lease: 270 * K, mtow: 63.1, runway: 1460, turnaround: 35,
    pilots: 2, cabinCrew: 3, maintHour: 600, maintCycle: 250, cargo: 1.2, comfort: 0.76,
    blurb: 'Big windows, wide seats and steep-approach capability for the trickiest city airports.',
    shape: { length: 35.0, span: 35.1, diameter: 3.7, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'blended', sweep: 25, engineDiameter: 2.1 },
  },
  {
    id: 'bcs3', maker: 'Airbus', model: 'A220-300', category: 'narrowbody',
    seats: 148, range: 6300, speed: 840, fuelKm: 2.25, fuelCycle: 600,
    price: 47 * M, lease: 315 * K, mtow: 70.9, runway: 1890, turnaround: 38,
    pilots: 2, cabinCrew: 3, maintHour: 640, maintCycle: 260, cargo: 1.5, comfort: 0.76,
    blurb: 'Passengers love it and so do accountants. The smart way to open long, thin routes.',
    shape: { length: 38.7, span: 35.1, diameter: 3.7, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'blended', sweep: 25, engineDiameter: 2.1 },
  },
  {
    id: 'a20n', maker: 'Airbus', model: 'A320neo', category: 'narrowbody',
    seats: 180, range: 6300, speed: 833, fuelKm: 2.5, fuelCycle: 700,
    price: 53 * M, lease: 375 * K, mtow: 79, runway: 1950, turnaround: 40,
    pilots: 2, cabinCrew: 4, maintHour: 720, maintCycle: 320, cargo: 2.0, comfort: 0.63,
    blurb: 'The default answer. Efficient, flexible and easy to place anywhere in a network.',
    shape: { length: 37.6, span: 35.8, diameter: 3.95, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'sharklet', sweep: 25, engineDiameter: 2.45 },
  },
  {
    id: 'a21n', maker: 'Airbus', model: 'A321neo', category: 'narrowbody',
    seats: 228, range: 6480, speed: 833, fuelKm: 3.0, fuelCycle: 800,
    price: 61 * M, lease: 430 * K, mtow: 97, runway: 2300, turnaround: 45,
    pilots: 2, cabinCrew: 5, maintHour: 800, maintCycle: 350, cargo: 3.0, comfort: 0.63,
    blurb: 'A stretched money-maker with the lowest seat cost of any single-aisle on busy trunk routes.',
    shape: { length: 44.5, span: 35.8, diameter: 3.95, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'sharklet', sweep: 25, engineDiameter: 2.45 },
  },
  {
    id: 'a21x', maker: 'Airbus', model: 'A321XLR', category: 'narrowbody',
    seats: 220, range: 8700, speed: 833, fuelKm: 3.1, fuelCycle: 850,
    price: 69 * M, lease: 480 * K, mtow: 101, runway: 2500, turnaround: 45,
    pilots: 2, cabinCrew: 5, maintHour: 830, maintCycle: 350, cargo: 2.5, comfort: 0.63,
    blurb: 'Crosses oceans with a single aisle. Opens long-haul city pairs no widebody could fill.',
    shape: { length: 44.5, span: 35.8, diameter: 3.95, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'sharklet', sweep: 25, engineDiameter: 2.45 },
  },
  {
    id: 'b38m', maker: 'Boeing', model: '737 MAX 8', category: 'narrowbody',
    seats: 184, range: 6570, speed: 839, fuelKm: 2.55, fuelCycle: 700,
    price: 52 * M, lease: 365 * K, mtow: 82.2, runway: 2100, turnaround: 40,
    pilots: 2, cabinCrew: 4, maintHour: 720, maintCycle: 320, cargo: 2.0, comfort: 0.58,
    blurb: 'A few more seats than its rival for a little less money. The low-cost carrier staple.',
    shape: { length: 39.5, span: 35.9, diameter: 3.76, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'split', sweep: 25, engineDiameter: 2.3 },
  },
  {
    id: 'b3xm', maker: 'Boeing', model: '737 MAX 10', category: 'narrowbody',
    seats: 216, range: 5740, speed: 839, fuelKm: 2.95, fuelCycle: 800,
    price: 58 * M, lease: 405 * K, mtow: 89.8, runway: 2500, turnaround: 45,
    pilots: 2, cabinCrew: 5, maintHour: 790, maintCycle: 340, cargo: 2.6, comfort: 0.58,
    blurb: 'Maximum seats on a familiar airframe. Needs a long runway and stays close to home.',
    shape: { length: 43.8, span: 35.9, diameter: 3.76, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'split', sweep: 25, engineDiameter: 2.3 },
  },
  {
    id: 'b738', maker: 'Boeing', model: '737-800', category: 'narrowbody',
    seats: 180, range: 5440, speed: 828, fuelKm: 2.95, fuelCycle: 800,
    price: 19 * M, lease: 185 * K, mtow: 79, runway: 2100, turnaround: 40,
    pilots: 2, cabinCrew: 4, maintHour: 780, maintCycle: 330, cargo: 2.0, comfort: 0.5,
    inProduction: false, usedAge: [8, 20],
    blurb: 'Thousands built, so there is always one for sale. Cheap to own, dearer to fuel.',
    shape: { length: 39.5, span: 35.8, diameter: 3.76, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'blended', sweep: 25, engineDiameter: 2.0 },
  },
  {
    id: 'a320', maker: 'Airbus', model: 'A320ceo', category: 'narrowbody',
    seats: 174, range: 6100, speed: 828, fuelKm: 2.95, fuelCycle: 800,
    price: 16 * M, lease: 165 * K, mtow: 78, runway: 2000, turnaround: 40,
    pilots: 2, cabinCrew: 4, maintHour: 780, maintCycle: 330, cargo: 2.0, comfort: 0.52,
    inProduction: false, usedAge: [8, 22],
    blurb: 'The previous generation. A bargain way to start flying while fuel stays cheap.',
    shape: { length: 37.6, span: 34.1, diameter: 3.95, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'fence', sweep: 25, engineDiameter: 2.1 },
  },
  {
    id: 'b752', maker: 'Boeing', model: '757-200', category: 'narrowbody',
    seats: 216, range: 7250, speed: 850, fuelKm: 3.9, fuelCycle: 1100,
    price: 9 * M, lease: 120 * K, mtow: 115.7, runway: 1900, turnaround: 50,
    pilots: 2, cabinCrew: 5, maintHour: 1100, maintCycle: 450, cargo: 3.5, comfort: 0.5,
    inProduction: false, usedAge: [20, 30],
    blurb: 'An overpowered classic that leaps off short, hot and high runways. Costs a fortune to keep fed.',
    shape: { length: 47.3, span: 38.0, diameter: 3.76, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'blended', sweep: 25, engineDiameter: 2.5 },
  },

  // ───────────── Widebodies ─────────────
  {
    id: 'b763', maker: 'Boeing', model: '767-300ER', category: 'widebody',
    seats: 290, range: 11070, speed: 851, fuelKm: 5.6, fuelCycle: 1800,
    price: 15 * M, lease: 195 * K, mtow: 186.9, runway: 2400, turnaround: 65,
    pilots: 2, cabinCrew: 7, maintHour: 1350, maintCycle: 650, cargo: 10, comfort: 0.55,
    inProduction: false, usedAge: [18, 28],
    blurb: 'The cheapest ticket into long-haul flying. Old, but it crosses oceans and carries freight.',
    shape: { length: 54.9, span: 47.6, diameter: 5.03, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'blended', sweep: 31.5, engineDiameter: 2.7 },
  },
  {
    id: 'a333', maker: 'Airbus', model: 'A330-300', category: 'widebody',
    seats: 390, range: 11750, speed: 871, fuelKm: 6.5, fuelCycle: 2200,
    price: 32 * M, lease: 320 * K, mtow: 242, runway: 2500, turnaround: 75,
    pilots: 2, cabinCrew: 9, maintHour: 1400, maintCycle: 750, cargo: 15, comfort: 0.6,
    inProduction: false, usedAge: [8, 20],
    blurb: 'Lots of seats for very little money. Ideal for dense medium-haul trunk routes.',
    shape: { length: 63.7, span: 60.3, diameter: 5.64, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'fence', sweep: 30, engineDiameter: 3.0 },
  },
  {
    id: 'a339', maker: 'Airbus', model: 'A330-900', category: 'widebody',
    seats: 400, range: 13330, speed: 871, fuelKm: 5.7, fuelCycle: 2200,
    price: 112 * M, lease: 770 * K, mtow: 251, runway: 2600, turnaround: 75,
    pilots: 2, cabinCrew: 9, maintHour: 1300, maintCycle: 750, cargo: 15, comfort: 0.72,
    blurb: 'New engines and wings on a proven airframe: modern economics without the premium price.',
    shape: { length: 63.7, span: 64.0, diameter: 5.64, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'sharklet', sweep: 30, engineDiameter: 3.4 },
  },
  {
    id: 'b788', maker: 'Boeing', model: '787-8', category: 'widebody',
    seats: 330, range: 13530, speed: 903, fuelKm: 5.2, fuelCycle: 2000,
    price: 118 * M, lease: 840 * K, mtow: 227.9, runway: 2500, turnaround: 70,
    pilots: 2, cabinCrew: 8, maintHour: 1250, maintCycle: 750, cargo: 11, comfort: 0.82,
    blurb: 'A long-range scalpel. Connects mid-size cities across oceans without filling 400 seats.',
    shape: { length: 56.7, span: 60.1, diameter: 5.77, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 32, engineDiameter: 3.4 },
  },
  {
    id: 'b789', maker: 'Boeing', model: '787-9', category: 'widebody',
    seats: 390, range: 14010, speed: 903, fuelKm: 5.8, fuelCycle: 2200,
    price: 143 * M, lease: 1.03 * M, mtow: 254, runway: 2700, turnaround: 75,
    pilots: 2, cabinCrew: 9, maintHour: 1350, maintCycle: 800, cargo: 14, comfort: 0.82,
    blurb: 'The sweet spot of the family: more seats, more range, and a cabin people ask for by name.',
    shape: { length: 62.8, span: 60.1, diameter: 5.77, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 32, engineDiameter: 3.4 },
  },
  {
    id: 'b78x', maker: 'Boeing', model: '787-10', category: 'widebody',
    seats: 430, range: 11730, speed: 903, fuelKm: 6.2, fuelCycle: 2300,
    price: 158 * M, lease: 1.13 * M, mtow: 254, runway: 2800, turnaround: 80,
    pilots: 2, cabinCrew: 10, maintHour: 1420, maintCycle: 820, cargo: 16, comfort: 0.82,
    blurb: 'Stretched for capacity rather than range. Superb seat costs on busy regional trunks.',
    shape: { length: 68.3, span: 60.1, diameter: 5.77, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 32, engineDiameter: 3.4 },
  },
  {
    id: 'a359', maker: 'Airbus', model: 'A350-900', category: 'widebody',
    seats: 410, range: 15370, speed: 903, fuelKm: 6.2, fuelCycle: 2400,
    price: 153 * M, lease: 1.13 * M, mtow: 283, runway: 2600, turnaround: 80,
    pilots: 2, cabinCrew: 10, maintHour: 1380, maintCycle: 820, cargo: 16, comfort: 0.88,
    blurb: 'Quiet, spacious and able to fly almost anywhere non-stop. A flagship for premium brands.',
    shape: { length: 66.8, span: 64.75, diameter: 5.96, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'sharklet', sweep: 32, engineDiameter: 3.6 },
  },
  {
    id: 'a35k', maker: 'Airbus', model: 'A350-1000', category: 'widebody',
    seats: 470, range: 16100, speed: 903, fuelKm: 7.3, fuelCycle: 2700,
    price: 178 * M, lease: 1.33 * M, mtow: 319, runway: 2800, turnaround: 85,
    pilots: 2, cabinCrew: 11, maintHour: 1550, maintCycle: 900, cargo: 20, comfort: 0.88,
    blurb: 'The ultimate twin: jumbo capacity and ultra-long range in one airframe.',
    shape: { length: 73.8, span: 64.75, diameter: 5.96, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'sharklet', sweep: 32, engineDiameter: 3.7 },
  },
  {
    id: 'b77w', maker: 'Boeing', model: '777-300ER', category: 'widebody',
    seats: 510, range: 13650, speed: 892, fuelKm: 8.4, fuelCycle: 3000,
    price: 62 * M, lease: 590 * K, mtow: 351.5, runway: 2900, turnaround: 90,
    pilots: 2, cabinCrew: 12, maintHour: 1750, maintCycle: 1000, cargo: 24, comfort: 0.7,
    inProduction: false, usedAge: [6, 16],
    blurb: 'Enormous capacity and a cavernous cargo hold. Dominant on the densest long-haul routes.',
    shape: { length: 73.9, span: 64.8, diameter: 6.2, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 31.6, engineDiameter: 4.0 },
  },
  {
    id: 'b779', maker: 'Boeing', model: '777-9', category: 'widebody',
    seats: 540, range: 13500, speed: 905, fuelKm: 7.6, fuelCycle: 3000,
    price: 205 * M, lease: 1.55 * M, mtow: 351.5, runway: 2900, turnaround: 90,
    pilots: 2, cabinCrew: 12, maintHour: 1700, maintCycle: 1000, cargo: 24, comfort: 0.85,
    blurb: 'The largest twin ever built, with folding wingtips and the lowest seat cost in the sky.',
    shape: { length: 76.7, span: 71.8, diameter: 6.2, engines: 2, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 32, engineDiameter: 4.3 },
  },

  // ───────────── Jumbos ─────────────
  {
    id: 'b748', maker: 'Boeing', model: '747-8', category: 'jumbo',
    seats: 600, range: 14320, speed: 914, fuelKm: 10.4, fuelCycle: 4200,
    price: 70 * M, lease: 560 * K, mtow: 447.7, runway: 3050, turnaround: 105,
    pilots: 2, cabinCrew: 14, maintHour: 2500, maintCycle: 1500, cargo: 18, comfort: 0.78,
    inProduction: false, usedAge: [8, 14],
    blurb: 'The queen of the skies, final edition. Four engines, an upper deck and undeniable presence.',
    shape: { length: 76.3, span: 68.4, diameter: 6.5, engines: 4, engineMount: 'wing', tail: 'conventional', winglet: 'raked', sweep: 37.5, upperDeck: 'hump', engineDiameter: 3.0 },
  },
  {
    id: 'a388', maker: 'Airbus', model: 'A380-800', category: 'jumbo',
    seats: 780, range: 14800, speed: 903, fuelKm: 12.6, fuelCycle: 5000,
    price: 48 * M, lease: 430 * K, mtow: 575, runway: 2900, turnaround: 120,
    pilots: 2, cabinCrew: 18, maintHour: 3000, maintCycle: 1800, cargo: 9, comfort: 0.94,
    inProduction: false, usedAge: [8, 16],
    blurb: 'Two full decks of seats, and cheap to pick up now that few airlines want one. Ruinous half empty; it earns its keep where slots are scarce and a mega hub feeds it.',
    shape: { length: 72.7, span: 79.75, diameter: 7.14, engines: 4, engineMount: 'wing', tail: 'conventional', winglet: 'fence', sweep: 33.5, upperDeck: 'full', engineDiameter: 3.2 },
  },
];

export const AIRCRAFT_TYPES: AircraftType[] = ROWS.map((r) => ({
  ...r,
  inProduction: r.inProduction ?? true,
  usedAge: r.usedAge ?? [2, 12],
}));

export const AIRCRAFT_TYPE: Record<string, AircraftType> = {};
for (const t of AIRCRAFT_TYPES) AIRCRAFT_TYPE[t.id] = t;

export const CATEGORY_NAMES: Record<AircraftCategory, string> = {
  turboprop: 'Turboprop',
  regional: 'Regional jet',
  narrowbody: 'Narrowbody',
  widebody: 'Widebody',
  jumbo: 'Jumbo',
};

export function typeName(t: AircraftType): string {
  return `${t.maker} ${t.model}`;
}

export const CLASS_NAMES = ['Economy', 'Business', 'First'] as const;
export const CLASS_CODES = ['Y', 'J', 'F'] as const;
export const DENSITY_NAMES = ['High density', 'Standard', 'Extra legroom'] as const;

/** Floor space taken by one seat of each class, in standard economy seats. */
export function seatSpace(type: AircraftType, density: 0 | 1 | 2): Triple {
  const wide = type.category === 'widebody' || type.category === 'jumbo';
  const y = density === 0 ? 0.92 : density === 2 ? 1.12 : 1;
  return [y, wide ? 3.0 : 1.9, wide ? 5.5 : 3.2];
}

/** True when the cabin fits the airframe. */
export function cabinFits(type: AircraftType, cabin: Triple, density: 0 | 1 | 2): boolean {
  return cabinUsed(type, cabin, density) <= type.seats + 1e-6;
}

export function cabinUsed(type: AircraftType, cabin: Triple, density: 0 | 1 | 2): number {
  const s = seatSpace(type, density);
  return cabin[0] * s[0] + cabin[1] * s[1] + cabin[2] * s[2];
}

/**
 * Builds a cabin from the share of floor space given to business and first class;
 * economy fills whatever is left.
 */
export function makeCabin(type: AircraftType, density: 0 | 1 | 2, businessShare: number, firstShare: number): Triple {
  const s = seatSpace(type, density);
  const f = Math.floor((type.seats * firstShare) / s[2]);
  const j = Math.floor((type.seats * businessShare) / s[1]);
  const y = Math.floor((type.seats - f * s[2] - j * s[1]) / s[0] + 1e-6);
  return [Math.max(0, y), j, f];
}

export interface CabinPreset {
  id: string;
  name: string;
  detail: string;
  density: 0 | 1 | 2;
  business: number;
  first: number;
}

export const CABIN_PRESETS: CabinPreset[] = [
  { id: 'dense', name: 'All economy, high density', detail: 'Maximum seats, minimum legroom', density: 0, business: 0, first: 0 },
  { id: 'eco', name: 'All economy', detail: 'Single class at standard pitch', density: 1, business: 0, first: 0 },
  { id: 'two', name: 'Two class', detail: 'A modest business cabin up front', density: 1, business: 0.14, first: 0 },
  { id: 'premium', name: 'Premium heavy', detail: 'Large business cabin, roomy economy', density: 2, business: 0.3, first: 0 },
  { id: 'three', name: 'Three class', detail: 'First, business and economy', density: 1, business: 0.26, first: 0.07 },
  { id: 'flagship', name: 'Flagship', detail: 'Suites, a huge business cabin, roomy economy', density: 2, business: 0.36, first: 0.12 },
];

/** Presets that make sense for a type (first class needs a widebody). */
export function presetsFor(type: AircraftType): CabinPreset[] {
  const wide = type.category === 'widebody' || type.category === 'jumbo';
  if (type.category === 'turboprop') return CABIN_PRESETS.filter((p) => p.id === 'dense' || p.id === 'eco');
  return CABIN_PRESETS.filter((p) => wide || p.first === 0);
}

export function defaultPreset(type: AircraftType): CabinPreset {
  const id = type.category === 'turboprop' ? 'eco' : type.category === 'widebody' || type.category === 'jumbo' ? 'three' : 'two';
  return CABIN_PRESETS.find((p) => p.id === id)!;
}

export function totalSeats(cabin: Triple): number {
  return cabin[0] + cabin[1] + cabin[2];
}
