import { describe, expect, it } from 'vitest';
import { AIRPORTS, airportDistance } from '../src/sim/data/airports';
import { baseDemand, classSplit, refFare, seasonFactor, topMarkets } from '../src/sim/demand';

const PAIRS: [string, string][] = [
  ['LHR', 'JFK'], ['LHR', 'DXB'], ['LHR', 'SIN'], ['LHR', 'AMS'], ['LHR', 'EDI'], ['LHR', 'MAD'],
  ['LAX', 'SFO'], ['JFK', 'LAX'], ['ATL', 'ORD'], ['SYD', 'MEL'], ['HND', 'CTS'], ['GMP', 'CJU'],
  ['DEL', 'BOM'], ['PEK', 'SHA'], ['CGH', 'SDU'], ['JNB', 'CPT'], ['MAD', 'BCN'], ['SYD', 'LAX'],
  ['LGW', 'PMI'], ['JFK', 'CUN'], ['CUN', 'PUJ'], ['INV', 'LHR'], ['BOI', 'SEA'], ['DXB', 'BOM'],
  ['SIN', 'KUL'], ['HKG', 'TPE'], ['CDG', 'RUN'], ['YYZ', 'YVR'], ['GRU', 'EZE'], ['NBO', 'ADD'],
  ['KEF', 'GOH'], ['PPT', 'LAX'], ['HLE', 'JNB'],
];

describe('demand model', () => {
  it('produces plausible volumes on well-known routes', () => {
    if (process.env.CALIBRATE) {
      console.log('pair        dist   pax/day   Y%   J%   F%   fareY  fareJ  fareF');
      for (const [a, b] of PAIRS) {
        const d = baseDemand(a, b);
        const s = classSplit(a, b);
        const f = refFare(a, b);
        console.log(
          `${a}-${b}  ${airportDistance(a, b).toFixed(0).padStart(6)}  ${d.toFixed(0).padStart(7)}  ${(s[0] * 100).toFixed(0).padStart(3)}  ${(s[1] * 100).toFixed(1).padStart(4)}  ${(s[2] * 100).toFixed(1).padStart(4)}  ${f[0].toFixed(0).padStart(5)}  ${f[1].toFixed(0).padStart(5)}  ${f[2].toFixed(0).padStart(5)}`,
        );
      }
      for (const hub of ['LHR', 'JFK', 'SIN', 'DEN', 'BOI', 'NBO', 'INV']) {
        const total = AIRPORTS.reduce((n, a) => n + baseDemand(hub, a.id), 0);
        const actual = (AIRPORTS.find((a) => a.id === hub)!.mass * 1e6) / 2 / 365;
        console.log(`${hub}: model total ${total.toFixed(0)}/day vs local departures ${actual.toFixed(0)}/day; top: ` +
          topMarkets(hub, 8).map((m) => `${m.airport.id} ${m.demand.toFixed(0)}`).join(', '));
      }
      for (const hub of ['SYD', 'PPT', 'HNL', 'DXB', 'DOH', 'CUN', 'MLE', 'KEF', 'ANC', 'GRU', 'JNB', 'DEL', 'PVG', 'HND', 'CDG', 'IST', 'YYZ', 'MEX']) {
        console.log(`${hub}: ` + topMarkets(hub, 10).map((m) => `${m.airport.id} ${m.demand.toFixed(0)}`).join(', '));
      }
      const ranked: [string, number][] = [];
      for (let i = 0; i < AIRPORTS.length; i++) for (let j = i + 1; j < AIRPORTS.length; j++) ranked.push([AIRPORTS[i].id + '-' + AIRPORTS[j].id, baseDemand(AIRPORTS[i].id, AIRPORTS[j].id)]);
      ranked.sort((x, y) => y[1] - x[1]);
      console.log('top 40: ' + ranked.slice(0, 40).map((r) => `${r[0]} ${r[1].toFixed(0)}`).join(', '));
      const all: number[] = [];
      for (let i = 0; i < AIRPORTS.length; i++) for (let j = i + 1; j < AIRPORTS.length; j++) all.push(baseDemand(AIRPORTS[i].id, AIRPORTS[j].id));
      all.sort((x, y) => y - x);
      console.log(`pairs: ${all.length}; >5000: ${all.filter((x) => x > 5000).length}; >1000: ${all.filter((x) => x > 1000).length}; >300: ${all.filter((x) => x > 300).length}; >100: ${all.filter((x) => x > 100).length}; world total/day: ${(all.reduce((a, b) => a + b, 0) * 2).toFixed(0)}`);
    }
    // Dense trunk routes carry thousands a day, thin ones a few dozen.
    expect(baseDemand('LHR', 'JFK')).toBeGreaterThan(1200);
    expect(baseDemand('LHR', 'JFK')).toBeLessThan(8000);
    expect(baseDemand('SYD', 'MEL')).toBeGreaterThan(5000);
    expect(baseDemand('LAX', 'SFO')).toBeGreaterThan(1200);
    expect(baseDemand('KEF', 'GOH')).toBeLessThan(200);
    // Resort-to-resort markets are thin compared with city-to-resort ones.
    expect(baseDemand('CUN', 'PUJ')).toBeLessThan(baseDemand('JFK', 'CUN') / 5);
    // Symmetric.
    expect(baseDemand('JFK', 'LHR')).toBe(baseDemand('LHR', 'JFK'));
  });

  it('prices long-haul premium cabins well above economy', () => {
    const [y, j, f] = refFare('LHR', 'JFK');
    expect(y).toBeGreaterThan(250);
    expect(y).toBeLessThan(550);
    expect(j / y).toBeGreaterThan(3);
    expect(f / y).toBeGreaterThan(5);
  });

  it('peaks leisure routes in the right season', () => {
    // Mediterranean beach route: July beats January.
    expect(seasonFactor('LGW', 'PMI', 0.55)).toBeGreaterThan(seasonFactor('LGW', 'PMI', 0.05) * 1.25);
    // Caribbean winter-sun route: January beats July.
    expect(seasonFactor('JFK', 'CUN', 0.05)).toBeGreaterThan(seasonFactor('JFK', 'CUN', 0.55) * 1.2);
  });
});
