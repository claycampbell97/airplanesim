#!/usr/bin/env node
// Builds public/data/borders.bin — coastlines and country borders as compact
// quantised polylines, from Natural Earth 1:50m (public domain) via the
// `world-atlas` npm package.
//
// File layout (little endian):
//   uint32  magic 'SKYB'
//   uint32  coastline polyline count
//   uint32  border polyline count
//   then for every polyline (coastlines first):
//     uint16  point count
//     int16   lon, lat pairs, quantised to 360/65536 degrees

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const topo = JSON.parse(await readFile(require.resolve('world-atlas/countries-50m.json'), 'utf8'));

const coast = mesh(topo, topo.objects.countries, (a, b) => a === b).coordinates;
const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b).coordinates;

/** Douglas–Peucker simplification in degrees; keeps the file small without visible loss. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let worst = -1, worstDist = tolerance * tolerance;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((points[i][0] - ax) * dx + (points[i][1] - ay) * dy) / len2));
      const px = ax + t * dx - points[i][0], py = ay + t * dy - points[i][1];
      const d = px * px + py * py;
      if (d > worstDist) { worstDist = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

function prepare(lines, tolerance) {
  const out = [];
  for (const line of lines) {
    const s = simplify(line, tolerance);
    // uint16 point counts: split very long polylines, repeating the joint vertex.
    for (let i = 0; i < s.length - 1; i += 60000) out.push(s.slice(i, i + 60001));
  }
  return out.filter((l) => l.length >= 2);
}

const coastLines = prepare(coast, 0.012);
const borderLines = prepare(borders, 0.012);
const all = [...coastLines, ...borderLines];
const points = all.reduce((n, l) => n + l.length, 0);

const buf = Buffer.alloc(12 + all.length * 2 + points * 4);
buf.write('SKYB', 0, 'ascii');
buf.writeUInt32LE(coastLines.length, 4);
buf.writeUInt32LE(borderLines.length, 8);
let o = 12;
const q = (deg) => Math.max(-32768, Math.min(32767, Math.round((deg / 360) * 65536)));
for (const line of all) {
  buf.writeUInt16LE(line.length, o); o += 2;
  for (const [lon, lat] of line) {
    buf.writeInt16LE(q(lon), o); o += 2;
    buf.writeInt16LE(q(lat), o); o += 2;
  }
}

const dest = join(here, '../public/data/borders.bin');
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, buf);
console.log(`coastlines: ${coastLines.length} lines, borders: ${borderLines.length} lines, ${points} points, ${(buf.length / 1024).toFixed(0)} KB -> ${dest}`);
