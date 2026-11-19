// Diagnostics (REPORT only): how do realised loads compare with what the market model expects?
import { describe, it } from 'vitest';
import { expectedBoarded } from '../src/sim/demand';
import { getMarket, offerOf } from '../src/sim/market';
import { Sim } from '../src/sim/sim';
import type { Livery } from '../src/sim/types';

const LIVERY: Livery = { primary: '#2563eb', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' };

describe('diagnostics', () => {
  it.runIf(!!process.env.DIAG)('compares modelled and realised loads', { timeout: 900_000 }, () => {
    const sim = Sim.create({ name: 'Test Air', code: 'TA', hq: 'MAN', livery: LIVERY, difficulty: 'standard', seed: 12345 });
    const months = Number(process.env.MONTHS ?? 6);
    for (let d = 0; d < months * 30.5; d++) sim.advance(1440);
    const buckets = new Map<string, { n: number; model: number; real: number; seats: number; fare: number; floor: number }>();
    for (const r of sim.game.routes) {
      const o = offerOf(sim, r);
      if (o.freq <= 0 || r.prev.flights < 4) continue;
      const m = getMarket(sim, r.a, r.b);
      let model = 0;
      let seats = 0;
      for (let c = 0; c < 3; c++) {
        if (o.seats[c] <= 0) continue;
        const local = expectedBoarded((r.rate[0][c] + r.rate[1][c]) * 0.5 / o.freq, o.seats[c]);
        const conn = Math.min(o.seats[c] - local, (r.connRate[0][c] + r.connRate[1][c]) * 0.5 / o.freq);
        model += local + Math.max(0, conn);
        seats += o.seats[c];
      }
      const realSeats = r.prev.seats[0] + r.prev.seats[1] + r.prev.seats[2];
      const realPax = r.prev.pax[0] + r.prev.pax[1] + r.prev.pax[2];
      const al = sim.game.airlines[r.airline];
      const level = r.price[0] / m.ref[0];
      const atFloor = al.ai && level <= al.ai.fareLevel * 0.8 + 0.01 ? 1 : 0;
      const key = (o.freq < 0.6 ? 'freq<0.6 ' : o.freq < 1.2 ? 'freq<1.2 ' : o.freq < 3 ? 'freq<3   ' : 'freq>=3  ') + (r.dist < 1500 ? 'short' : r.dist < 4500 ? 'medium' : 'long');
      const b = buckets.get(key) ?? { n: 0, model: 0, real: 0, seats: 0, fare: 0, floor: 0 };
      b.n += 1; b.model += model / seats; b.real += realSeats ? realPax / realSeats : 0; b.fare += level; b.floor += atFloor;
      buckets.set(key, b);
    }
    console.log('bucket              routes  modelLF  realLF  fare  atFloor');
    for (const [k, b] of [...buckets.entries()].sort()) {
      console.log(`${k.padEnd(18)} ${String(b.n).padStart(6)}  ${(b.model / b.n * 100).toFixed(0).padStart(5)}%  ${(b.real / b.n * 100).toFixed(0).padStart(5)}%  ${(b.fare / b.n * 100).toFixed(0).padStart(3)}%  ${(b.floor / b.n * 100).toFixed(0).padStart(4)}%`);
    }
  });
});
