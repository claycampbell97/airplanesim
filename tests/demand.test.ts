import { describe, expect, it } from 'vitest';
import { AIRPORT, AIRPORTS, airportDistance } from '../src/sim/data/airports';
import { LATENT_DEMAND, baseDemand, classSplit, refFare, seasonFactor, topMarkets } from '../src/sim/demand';
import { REFERENCE_ROUTES } from './routes.reference';

/** Millions of passengers a year the model puts between two airports, both directions. */
const yearly = (a: string, b: string) => (baseDemand(a, b) * 730) / LATENT_DEMAND / 1e6;

/** The model against the real routes in routes.reference.ts. */
function compare() {
  // The reference counts everyone on board; the model only those travelling between the two cities.
  const local = (id: string) => 1 - 0.6 * (1 - AIRPORT[id].mass / AIRPORT[id].pax);
  return REFERENCE_ROUTES.filter((r) => AIRPORT[r.a] && AIRPORT[r.b]).map((r) => {
    const real = r.real * local(r.a) * local(r.b);
    const model = yearly(r.a, r.b);
    return { ...r, real, model, err: Math.log(Math.max(model, 1e-4) / real), dist: airportDistance(r.a, r.b), domestic: AIRPORT[r.a].home === AIRPORT[r.b].home };
  });
}

describe('demand model', () => {
  it('puts real routes in the right league', () => {
    const rows = compare();
    const abs = rows.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
    const within = (f: number) => abs.filter((e) => e <= Math.log(f)).length / abs.length;
    if (process.env.CALIBRATE) {
      const pct = (x: number) => (x * 100).toFixed(0) + '%';
      console.log(`${rows.length} routes: median error x${Math.exp(abs[Math.floor(abs.length / 2)]).toFixed(2)}, within x1.5 ${pct(within(1.5))}, x2 ${pct(within(2))}, x3 ${pct(within(3))}, bias ${(rows.reduce((n, r) => n + r.err, 0) / rows.length).toFixed(2)}`);
      const group = (name: string, f: (r: (typeof rows)[number]) => boolean) => {
        const g = rows.filter(f);
        const a = g.map((r) => Math.abs(r.err)).sort((x, y) => x - y);
        if (g.length) console.log(`  ${name.padEnd(26)} n=${String(g.length).padStart(3)} median x${Math.exp(a[Math.floor(a.length / 2)]).toFixed(2)} bias ${(g.reduce((n, r) => n + r.err, 0) / g.length).toFixed(2)}`);
      };
      group('domestic', (r) => r.domestic);
      group('international < 1500 km', (r) => !r.domestic && r.dist < 1500);
      group('international 1500-3500', (r) => !r.domestic && r.dist >= 1500 && r.dist < 3500);
      group('international 3500-6500', (r) => !r.domestic && r.dist >= 3500 && r.dist < 6500);
      group('international > 6500', (r) => !r.domestic && r.dist >= 6500);
      group('a resort at one end', (r) => AIRPORT[r.a].leisure >= 0.8 || AIRPORT[r.b].leisure >= 0.8);
      group('gateway to gateway', (r) => !r.domestic && AIRPORT[r.a].gateway === 1 && AIRPORT[r.b].gateway === 1);
      const sorted = [...rows].sort((x, y) => y.err - x.err);
      const fmt = (r: (typeof rows)[number]) => `${r.a}-${r.b} ${r.model.toFixed(2)} vs ${r.real.toFixed(2)}`;
      console.log('most over: ' + sorted.slice(0, 40).map(fmt).join(', '));
      console.log('most under: ' + sorted.slice(-40).reverse().map(fmt).join(', '));
      for (const hub of (process.env.HUBS ?? 'MAN,LHR,DUB,PMI,JFK,DEN,CUN,DXB,SIN,SYD,DEL,HND,GRU,NBO,BOI').split(',')) {
        const total = AIRPORTS.reduce((n, a) => n + baseDemand(hub, a.id), 0);
        const top = topMarkets(hub, 25);
        console.log(`${hub} (top 25 = ${((top.reduce((n, m) => n + m.demand, 0) / total) * 100).toFixed(0)}% of its traffic): ` + top.map((m) => `${m.airport.id} ${yearly(hub, m.airport.id).toFixed(2)}`).join(', '));
      }
    }
    // Most routes within a factor of two of the real thing, nearly all within three.
    expect(Math.exp(abs[Math.floor(abs.length / 2)])).toBeLessThan(1.7);
    expect(within(2)).toBeGreaterThan(0.65);
    expect(within(3)).toBeGreaterThan(0.8);
  });

  it('sends people where they really go', () => {
    const rank = (from: string, to: string) => topMarkets(from, AIRPORTS.length).findIndex((m) => m.airport.id === to) + 1;
    // Manchester flies to Dublin, the Mediterranean and the hubs next door: not to Denver or Jeddah.
    expect(rank('MAN', 'DUB')).toBeLessThanOrEqual(3);
    for (const sun of ['PMI', 'AGP', 'ALC']) expect(rank('MAN', sun)).toBeLessThanOrEqual(12);
    for (const m of topMarkets('MAN', 12)) expect(m.dist).toBeLessThan(3500);
    expect(rank('MAN', 'JED')).toBeGreaterThan(60);
    expect(baseDemand('MAN', 'DEN')).toBeLessThan(baseDemand('MAN', 'DUB') / 20);
    expect(baseDemand('MAN', 'MNL')).toBeLessThan(baseDemand('MAN', 'DUB') / 10);
    // Heathrow is the gateway: New York is among its biggest markets, and far bigger than from Manchester.
    expect(rank('LHR', 'JFK')).toBeLessThanOrEqual(5);
    expect(baseDemand('LHR', 'JFK')).toBeGreaterThan(baseDemand('MAN', 'JFK') * 3);
    // Family ties, old empires and migrant workers.
    expect(baseDemand('LHR', 'DEL')).toBeGreaterThan(baseDemand('LHR', 'PEK') * 2);
    expect(baseDemand('CDG', 'ALG')).toBeGreaterThan(baseDemand('CDG', 'CAI') * 2);
    expect(baseDemand('MAD', 'BOG')).toBeGreaterThan(baseDemand('FRA', 'BOG') * 2);
    expect(baseDemand('DXB', 'BOM')).toBeGreaterThan(baseDemand('DXB', 'PVG'));
    expect(baseDemand('COK', 'DXB')).toBeGreaterThan(baseDemand('COK', 'SIN') * 1.2);
    // Holidays: the north flies to the sun.
    expect(baseDemand('MAN', 'PMI')).toBeGreaterThan(baseDemand('MAN', 'FRA') * 2);
    expect(baseDemand('DUS', 'AYT')).toBeGreaterThan(baseDemand('DUS', 'CDG'));
    expect(baseDemand('YYZ', 'CUN')).toBeGreaterThan(baseDemand('YYZ', 'DEN') * 2);
    // Trains: nobody flies from London to Manchester or from Paris to Lyon.
    expect(baseDemand('LHR', 'MAN')).toBeLessThan(baseDemand('LHR', 'EDI') / 10);
    expect(baseDemand('ORY', 'LYS')).toBeLessThan(baseDemand('ORY', 'NCE') / 4);
    // Water: islands fly.
    expect(baseDemand('MAN', 'BFS')).toBeGreaterThan(baseDemand('MAN', 'EDI') * 2);
    // Gateways and domestic hubs.
    expect(baseDemand('JFK', 'LHR')).toBeGreaterThan(baseDemand('DEN', 'LHR') * 4);
    expect(baseDemand('NRT', 'LAX')).toBeGreaterThan(baseDemand('ITM', 'LAX') * 20);
  });

  it('produces plausible volumes on well-known routes', () => {
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
