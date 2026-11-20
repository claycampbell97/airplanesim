// Country ties: fits them to the curated travel volumes (`npm run data:ties`
// rewrites src/sim/data/ties.generated.ts), and checks that the fitted model
// still reproduces those volumes.
//
//   npm run data:ties        refit after editing scripts/corridors-curated.txt,
//                            scripts/countries-curated.txt or the airport list

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AIRPORTS, domesticShare } from '../src/sim/data/airports';
import { DOMESTIC_FIT, TIE_FIT } from '../src/sim/data/ties.generated';
import { LATENT_DEMAND, buildDemandMatrix, tieKey } from '../src/sim/demand';
import type { TieTable } from '../src/sim/demand';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Refit and rewrite the ties file: under `npm run data:ties`, or with FIT=1. */
const FITTING = !!process.env.FIT || process.env.npm_lifecycle_event === 'data:ties';
const odds = (p: number) => Math.max(1e-4, p) / Math.max(1e-4, 1 - p);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Listed corridors take up this share of a country's international traffic; the rest is left to the others. */
const COVERAGE = 0.96;

const homes = [...new Set(AIRPORTS.map((a) => a.home))];
const mass: Record<string, number> = {};
const masses: Record<string, number[]> = {};
for (const a of AIRPORTS) {
  mass[a.home] = (mass[a.home] ?? 0) + a.mass;
  (masses[a.home] ??= []).push(a.mass);
}

/** The share of a country's traffic that should stay within it. */
const domesticTarget = domesticShare;

/** Curated volumes in millions of passengers a year, keyed like the ties. */
function readCorridors(): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of readFileSync(join(root, 'scripts/corridors-curated.txt'), 'utf8').split('\n')) {
    const t = raw.replace(/#.*$/, '').trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i + 1 < t.length; i += 2) {
      for (const c of [t[0], t[i]]) if (mass[c] === undefined) throw new Error(`corridors-curated.txt: no airports in ${c}`);
      const key = tieKey(t[0], t[i]);
      if (out.has(key)) throw new Error(`corridors-curated.txt: ${key} is listed twice`);
      out.set(key, Number(t[i + 1]));
    }
  }
  return out;
}

/**
 * Targets the game's world can meet. The curated volumes say how a country's travel
 * is divided among its partners; here they are scaled, country by country, so that
 * together they fill the international traffic its airports actually have.
 */
function feasibleTargets(): Map<string, number> {
  const t = readCorridors();
  const want: Record<string, number> = {};
  const r: Record<string, number> = {};
  for (const h of homes) {
    want[h] = COVERAGE * mass[h] * (1 - domesticTarget(h));
    r[h] = 1;
  }
  for (let pass = 0; pass < 400; pass++) {
    const sum: Record<string, number> = {};
    for (const [k, v] of t) {
      const [a, b] = k.split('-');
      const x = v * r[a] * r[b];
      sum[a] = (sum[a] ?? 0) + x;
      sum[b] = (sum[b] ?? 0) + x;
    }
    for (const h of homes) if (sum[h] > 0) r[h] = clamp(r[h] * Math.pow(want[h] / sum[h], 0.5), 0.15, 6);
  }
  for (const [k, v] of t) {
    const [a, b] = k.split('-');
    t.set(k, v * r[a] * r[b]);
  }
  if (FITTING) {
    console.log('how the curated volumes were scaled to the game (1 = as written): ' + homes.filter((h) => mass[h] > 20).map((h) => `${h} ${r[h].toFixed(2)}`).join(' '));
    const sum: Record<string, number> = {};
    for (const [k, v] of t) for (const c of k.split('-')) sum[c] = (sum[c] ?? 0) + v;
    const off = homes.filter((h) => sum[h] !== undefined && Math.abs(sum[h] / want[h] - 1) > 0.1).map((h) => `${h} ${(sum[h] / want[h]).toFixed(2)}`);
    console.log('countries whose corridors could not be made to fit (filled/wanted): ' + (off.join(' ') || 'none'));
    console.log('countries with no corridors listed: ' + (homes.filter((h) => sum[h] === undefined).join(' ') || 'none'));
  }
  return t;
}

interface Measured {
  /** Millions of passengers a year between two countries, both ways. */
  pair: Map<string, number>;
  /** Share of each country's traffic that stays within it. */
  domestic: Record<string, number>;
}

function measure(m: Float32Array): Measured {
  const n = AIRPORTS.length;
  const index = new Map(homes.map((h, i) => [h, i]));
  const home = AIRPORTS.map((a) => index.get(a.home)!);
  const flow = new Float64Array(homes.length * homes.length);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) flow[home[i] * homes.length + home[j]] += m[i * n + j];
  const pair = new Map<string, number>();
  const domestic: Record<string, number> = {};
  const perYear = (2 * 365) / 1e6 / LATENT_DEMAND;
  for (let x = 0; x < homes.length; x++) {
    let total = 0;
    for (let y = 0; y < homes.length; y++) total += flow[x * homes.length + y];
    domestic[homes[x]] = total > 0 ? flow[x * homes.length + x] / total : 0;
    for (let y = x + 1; y < homes.length; y++) pair.set(tieKey(homes[x], homes[y]), flow[x * homes.length + y] * perYear);
  }
  return { pair, domestic };
}

function fit(targets: Map<string, number>, rounds = 30): TieTable {
  const ties: TieTable = { pair: {}, domestic: {} };
  for (const k of targets.keys()) ties.pair[k] = 1;
  for (const h of homes) {
    // No domestic flying at all where the share is nil.
    if (masses[h].length > 1) ties.domestic[h] = domesticTarget(h) === 0 ? 0.01 : 1;
  }
  for (let round = 0; round < rounds; round++) {
    const now = measure(buildDemandMatrix(ties));
    for (const [k, want] of targets) {
      const have = now.pair.get(k) ?? 0;
      ties.pair[k] = clamp(ties.pair[k] * clamp(Math.pow(want / Math.max(have, 1e-6), 0.75), 0.3, 3), 0.01, 400);
    }
    for (const h of Object.keys(ties.domestic)) {
      const want = domesticTarget(h);
      if (want <= 0) continue;
      ties.domestic[h] = clamp(ties.domestic[h] * clamp(Math.pow(odds(want) / odds(now.domestic[h]), 0.75), 0.3, 3), 0.01, 400);
    }
  }
  return ties;
}

/** Share of each airport's traffic that stays within its country. */
function airportDomestic(m: Float32Array): Record<string, number> {
  const n = AIRPORTS.length;
  const out: Record<string, number> = {};
  for (const a of AIRPORTS) {
    let total = 0;
    let inland = 0;
    for (const b of AIRPORTS) {
      const f = m[a.index * n + b.index];
      total += f;
      if (b.home === a.home) inland += f;
    }
    out[a.id] = total > 0 ? inland / total : 0;
  }
  return out;
}

/** How far the model is from the targets: |log ratio| over the corridors of at least `floor` million. */
function errors(now: Measured, targets: Map<string, number>, floor: number): { key: string; want: number; have: number; err: number }[] {
  const out = [];
  for (const [key, want] of targets) {
    if (want < floor) continue;
    const have = now.pair.get(key) ?? 0;
    out.push({ key, want, have, err: Math.abs(Math.log(Math.max(have, 1e-6) / want)) });
  }
  return out.sort((x, y) => y.err - x.err);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

function write(ties: TieTable): void {
  const num = (v: number) => Number(v.toPrecision(3));
  const lines = (o: Record<string, number>) => {
    const keys = Object.keys(o).sort();
    const rows: string[] = [];
    for (let i = 0; i < keys.length; i += 8) rows.push('  ' + keys.slice(i, i + 8).map((k) => `'${k}': ${num(o[k])},`).join(' '));
    return rows.join('\n');
  };
  writeFileSync(join(root, 'src/sim/data/ties.generated.ts'), `// AUTO-GENERATED by \`npm run data:ties\` — do not edit by hand.
// Country-to-country travel ties fitted to scripts/corridors-curated.txt and the
// domestic shares in scripts/countries-curated.txt.

/** Multiplier on the default tie between two countries, keyed "AA-BB" in alphabetical order. */
export const TIE_FIT: Record<string, number> = {
${lines(ties.pair)}
};

/** Multiplier on an airport's domestic traffic. */
export const DOMESTIC_FIT: Record<string, number> = {
${lines(ties.domestic)}
};
`);
}

describe('country ties', () => {
  it.runIf(FITTING)('fits the ties to the curated travel volumes', { timeout: 600_000 }, () => {
    const targets = feasibleTargets();
    const ties = fit(targets);
    const now = measure(buildDemandMatrix(ties));
    const big = errors(now, targets, 0.5);
    const all = errors(now, targets, 0);
    console.log(`fitted ${targets.size} corridors: median error ${(median(all.map((e) => e.err)) * 100).toFixed(1)}%, of those over 0.5M ${(median(big.map((e) => e.err)) * 100).toFixed(1)}%`);
    console.log('worst of those over 0.5M: ' + big.slice(0, 12).map((e) => `${e.key} wanted ${e.want.toFixed(2)} got ${e.have.toFixed(2)}`).join('; '));
    console.log('domestic shares of countries (wanted/got): ' + homes.filter((h) => mass[h] > 20 && masses[h].length > 1)
      .map((h) => `${h} ${(domesticTarget(h) * 100).toFixed(0)}/${(now.domestic[h] * 100).toFixed(0)}`).join(' '));
    const got = airportDomestic(buildDemandMatrix(ties));
    console.log('domestic shares of airports (curated/got): ' + ['JFK', 'LAX', 'MIA', 'DEN', 'ATL', 'LAS', 'MCO', 'HNL', 'LHR', 'MAN', 'EDI', 'BFS', 'NRT', 'HND', 'KIX', 'ITM', 'ICN', 'GMP', 'CJU', 'PVG', 'SHA', 'PEK',
      'DEL', 'COK', 'GRU', 'CGH', 'CUN', 'MEX', 'TIJ', 'YYZ', 'YVR', 'SYD', 'CNS', 'BKK', 'DMK', 'HKT', 'IST', 'AYT', 'MAD', 'TFS', 'BIO', 'CDG', 'ORY', 'FCO', 'CTA', 'SVO', 'JNB', 'DUR', 'JED', 'CGK', 'DPS']
      .map((id) => `${id} ${((1 - AIRPORTS.find((a) => a.id === id)!.outward / (AIRPORTS.find((a) => a.id === id)!.outward + odds(domesticShare(AIRPORTS.find((a) => a.id === id)!.home)))) * 100).toFixed(0)}/${(got[id] * 100).toFixed(0)}`).join(' '));
    const clamped = Object.entries(ties.pair).filter(([, v]) => v <= 0.0101 || v >= 399).map(([k, v]) => `${k} ${v >= 399 ? 'max' : 'min'}`);
    console.log(`ties at the limit: ${clamped.length}: ${clamped.slice(0, 40).join(', ')}`);
    const mults = Object.values(ties.pair).sort((a, b) => a - b);
    console.log(`tie multipliers: min ${mults[0].toFixed(3)}, 10% ${mults[Math.floor(mults.length * 0.1)].toFixed(2)}, median ${median(mults).toFixed(2)}, 90% ${mults[Math.floor(mults.length * 0.9)].toFixed(2)}, max ${mults[mults.length - 1].toFixed(1)}`);
    // How much of each big country's traffic is left to corridors nobody listed, and where it goes.
    const listed: Record<string, number> = {};
    const total: Record<string, number> = {};
    const loose: { key: string; v: number }[] = [];
    for (const [k, v] of now.pair) {
      for (const c of k.split('-')) {
        total[c] = (total[c] ?? 0) + v;
        if (targets.has(k)) listed[c] = (listed[c] ?? 0) + v;
      }
      if (!targets.has(k)) loose.push({ key: k, v });
    }
    console.log('share of international traffic on unlisted corridors: ' + homes.filter((h) => mass[h] > 25)
      .map((h) => `${h} ${((1 - (listed[h] ?? 0) / total[h]) * 100).toFixed(0)}%`).join(' '));
    loose.sort((x, y) => y.v - x.v);
    console.log('biggest unlisted corridors: ' + loose.slice(0, 40).map((x) => `${x.key} ${x.v.toFixed(2)}`).join(', '));
    write(ties);
  });

  it('reproduces the curated travel volumes', () => {
    const targets = feasibleTargets();
    const m = buildDemandMatrix({ pair: TIE_FIT, domestic: DOMESTIC_FIT });
    const now = measure(m);
    // If this fails after an edit to the curated data, refit: npm run data:ties.
    expect(Object.keys(TIE_FIT).length).toBe(targets.size);
    const big = errors(now, targets, 0.5);
    expect(median(big.map((e) => e.err))).toBeLessThan(0.1);
    expect(big.filter((e) => e.err > Math.log(1.6)).length / big.length).toBeLessThan(0.05);
    for (const h of ['US', 'CN', 'IN', 'JP', 'GB', 'ES', 'DE', 'FR', 'BR', 'AU']) {
      expect(Math.abs(now.domestic[h] - domesticTarget(h))).toBeLessThan(0.05);
    }
    // Gateways and domestic hubs are told apart.
    const inland = airportDomestic(m);
    expect(inland.JFK).toBeLessThan(0.65);
    expect(inland.DEN).toBeGreaterThan(0.85);
    expect(inland.NRT).toBeLessThan(0.45);
    expect(inland.ICN).toBeLessThan(0.1);
    // The ties that everyone knows.
    const v = (a: string, b: string) => now.pair.get(tieKey(a, b))!;
    expect(v('GB', 'ES')).toBeGreaterThan(v('GB', 'JP') * 10);
    expect(v('US', 'MX')).toBeGreaterThan(v('US', 'DE') * 2);
    expect(v('IN', 'AE')).toBeGreaterThan(v('IN', 'DE') * 4);
  });
});
