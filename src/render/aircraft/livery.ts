// Liveries: everything painted rather than modelled. The fuselage is one texture
// unwrapped around the body (nose on the left, the port side in the upper half of
// the image's v range), with windows, doors, flight-deck glazing, stripes, titles
// and registration drawn to scale. The fin and the wings get their own textures.

import type { AircraftType, Livery } from '../../sim/types';
import { EMBLEM_PATHS } from './emblems';
import type { FuselageProfile } from './profile';

// ───────────────────────── Colour helpers ─────────────────────────

export function parseColor(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [200, 200, 200];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Perceived lightness 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = parseColor(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return toHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

/** White on dark colours, deep navy on light ones. */
export function contrastOn(hex: string): string {
  return luminance(hex) > 0.42 ? '#0f172a' : '#ffffff';
}

export interface LiveryPalette {
  /** Main fuselage colour. */
  body: string;
  /** Fin colour. */
  fin: string;
  /** Emblem colour on the fin. */
  finMark: string;
  /** Fuselage title colour. */
  titles: string;
  nacelle: string;
  winglet: string;
  /** Belly / lower fuselage colour where the style has one. */
  belly: string;
}

export function liveryPalette(l: Livery): LiveryPalette {
  const body = l.base;
  const lightBody = luminance(body) > 0.42;
  // Titles must read against the body: brand colour if it contrasts, else white / navy.
  const titles = Math.abs(luminance(l.primary) - luminance(body)) > 0.22 ? l.primary : contrastOn(body);
  switch (l.style) {
    case 'solid':
      return { body, fin: body, finMark: Math.abs(luminance(l.secondary) - luminance(body)) > 0.18 ? l.secondary : contrastOn(body), titles: contrastOn(body), nacelle: body, winglet: l.secondary, belly: mixColor(body, '#000000', 0.12) };
    case 'retro':
      return { body, fin: body, finMark: l.primary, titles, nacelle: '#c9ced6', winglet: l.secondary, belly: '#b4bbc5' };
    case 'eurowhite':
      return { body, fin: l.primary, finMark: contrastOn(l.primary), titles, nacelle: body, winglet: l.primary, belly: lightBody ? mixColor(body, '#8b95a5', 0.2) : body };
    case 'cheatline':
      return { body, fin: l.primary, finMark: contrastOn(l.primary), titles, nacelle: body, winglet: l.primary, belly: body };
    default:
      return { body, fin: l.primary, finMark: contrastOn(l.primary), titles, nacelle: l.primary, winglet: l.primary, belly: body };
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const emblemCache = new Map<string, Path2D>();
function emblemPath(emblem: Livery['emblem']): Path2D {
  let p = emblemCache.get(emblem);
  if (!p) {
    p = new Path2D(EMBLEM_PATHS[emblem]);
    emblemCache.set(emblem, p);
  }
  return p;
}

const SANS = '"Inter Variable", "Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// ───────────────────────── Fuselage ─────────────────────────

export interface DoorSpec {
  /** Distance of the door centre from the nose, metres. */
  z: number;
  width: number;
  height: number;
  /** Height of the sill. */
  sill: number;
  /** Small emergency hatch rather than a full door. */
  hatch?: boolean;
}

export interface FuselagePaintOptions {
  /** Texture width in pixels (height is a quarter of it). */
  width: number;
  airlineName?: string;
  registration?: string;
  /** Distance from the nose to the middle of the wing root, for over-wing exits. */
  wingZ: number;
}

/** Doors on one side of the main deck (and upper deck), front to back. */
export function doorLayout(type: AircraftType, p: FuselageProfile, wingZ: number): { main: DoorSpec[]; upper: DoorSpec[] } {
  const L = p.length;
  const cat = type.category;
  const wide = cat === 'widebody' || cat === 'jumbo';
  const w = wide ? 1.07 : cat === 'narrowbody' ? 0.84 : 0.76;
  const h = wide ? 1.93 : cat === 'narrowbody' ? 1.85 : 1.72;
  const sill = p.floorY;
  const front = p.noseLen * (wide ? 0.86 : 0.84);
  const rear = L - p.tailLen * 0.54;
  const main: DoorSpec[] = [{ z: front, width: w, height: h, sill }];
  if (wide) {
    const count = L > 71 ? 5 : 4;
    for (let i = 1; i < count - 1; i++) main.push({ z: front + ((rear - front) * i) / (count - 1), width: w, height: h, sill });
  } else if (cat === 'narrowbody' && L > 42) {
    main.push({ z: wingZ - L * 0.115, width: w, height: h, sill }, { z: wingZ + L * 0.13, width: w, height: h, sill });
  } else if (cat === 'narrowbody') {
    // Over-wing emergency hatches.
    main.push({ z: wingZ - 0.45, width: 0.52, height: 0.95, sill: p.windowY - 0.5, hatch: true }, { z: wingZ + 0.45, width: 0.52, height: 0.95, sill: p.windowY - 0.5, hatch: true });
  }
  main.push({ z: rear, width: w, height: h, sill });
  main.sort((a, b) => a.z - b.z);

  const upper: DoorSpec[] = [];
  if (p.upperDeck && p.upperWindowY !== null) {
    const us = p.upperWindowY - 0.98;
    const [s0, s1] = p.upperDeck;
    if (type.shape.upperDeck === 'full') {
      for (const f of [0.08, 0.5, 0.93]) upper.push({ z: (s0 + (s1 - s0) * f) * L, width: 0.95, height: 1.75, sill: us });
    } else {
      upper.push({ z: (s0 + (s1 - s0) * 0.55) * L, width: 0.85, height: 1.6, sill: us });
    }
  }
  return { main, upper };
}

/** Approximate perimeter of the cross-section at a station, metres. */
function girth(p: FuselageProfile, s: number): number {
  const sec = p.section(s);
  const a = sec.hw;
  const b = (sec.yTop - sec.yBot) / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export function paintFuselage(type: AircraftType, p: FuselageProfile, livery: Livery, opts: FuselagePaintOptions): HTMLCanvasElement {
  const W = opts.width;
  const H = W / 4;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const L = p.length;
  const R = p.radius;
  const pal = liveryPalette(livery);
  const sx = W / L;
  const cat = type.category;
  const wide = cat === 'widebody' || cat === 'jumbo';

  /** Texture row for a normalised height (-1 keel .. +1 crown) on the port side. */
  const vn = (hn: number): number => (Math.asin(Math.max(-1, Math.min(1, hn))) + Math.PI / 2) / (2 * Math.PI);
  const yPort = (v: number) => v * H;
  const yStar = (v: number) => (1 - v) * H;

  const painted: { lo: (s: number) => number; hi: (s: number) => number; s0: number; s1: number; color: string }[] = [];
  /** Fills the surface between two normalised heights, on both sides, from s0 to s1. */
  const band = (lo: (s: number) => number, hi: (s: number) => number, s0: number, s1: number, color: string): void => {
    painted.push({ lo, hi, s0, s1, color });
    const n = Math.max(8, Math.ceil(((s1 - s0) * W) / 5));
    ctx.fillStyle = color;
    for (const ymap of [yPort, yStar]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        const y = ymap(vn(hi(s)));
        if (i === 0) ctx.moveTo(s * W, y); else ctx.lineTo(s * W, y);
      }
      for (let i = n; i >= 0; i--) {
        const s = s0 + ((s1 - s0) * i) / n;
        ctx.lineTo(s * W, ymap(vn(lo(s))));
      }
      ctx.closePath();
      ctx.fill();
    }
  };
  /** Normalised height of an absolute height on the constant section. */
  const hnOf = (h: number): number => (h >= 0 ? h / p.top : h / -p.bottom);
  const KEEL = () => -1;
  const CROWN = () => 1;

  // ── Base coat and style ──
  ctx.fillStyle = pal.body;
  ctx.fillRect(0, 0, W, H);

  const winN = hnOf(p.windowY);
  switch (livery.style) {
    case 'cheatline': {
      const half = hnOf(0.5) - hnOf(0);
      band(() => winN - half, () => winN + half, 0, 1, livery.primary);
      band(() => winN - half - 0.2 * half - 0.42 * half, () => winN - half - 0.2 * half, 0, 1, livery.secondary);
      break;
    }
    case 'eurowhite': {
      // Grey belly, as on most real "white tube" liveries.
      band(KEEL, () => -0.82, 0, 1, pal.belly);
      break;
    }
    case 'wave': {
      const edge = (s: number) => -1.02 + 2.1 * Math.pow(smoothstep(0.28, 0.93, s), 1.35);
      band(KEEL, (s) => edge(s) + 0.3 * smoothstep(0.3, 0.75, s), 0, 1, livery.secondary);
      band(KEEL, edge, 0, 1, livery.primary);
      break;
    }
    case 'tailband': {
      const edge = (s: number) => (s - 0.775) / 0.055;
      band(KEEL, (s) => edge(s + 0.05), 0.6, 1, livery.secondary);
      band(KEEL, (s) => edge(s + 0.028), 0.6, 1, pal.body);
      band(KEEL, edge, 0.6, 1, livery.primary);
      break;
    }
    case 'bellyswoop': {
      const edge = (s: number) => -0.42 - 0.9 * (1 - smoothstep(0, 0.17, s)) + 1.5 * Math.pow(smoothstep(0.52, 0.97, s), 1.5);
      band(KEEL, (s) => edge(s) + 0.1, 0, 1, livery.secondary);
      band(KEEL, edge, 0, 1, livery.primary);
      break;
    }
    case 'retro': {
      band(KEEL, () => winN - 0.36, 0, 1, pal.belly);
      band(() => winN - 0.16, () => winN + 0.19, 0, 1, livery.primary);
      band(() => winN - 0.27, () => winN - 0.2, 0, 1, livery.secondary);
      band(() => winN - 0.36, () => winN - 0.31, 0, 1, livery.primary);
      break;
    }
    case 'solid': {
      band(() => -0.62, () => -0.5, 0, 1, livery.secondary);
      break;
    }
  }

  // A touch of grime towards the keel, so the belly does not look freshly rendered.
  const grime = ctx.createLinearGradient(0, 0, 0, H);
  grime.addColorStop(0, 'rgba(20,24,32,0.16)');
  grime.addColorStop(0.1, 'rgba(20,24,32,0.03)');
  grime.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  grime.addColorStop(0.9, 'rgba(20,24,32,0.03)');
  grime.addColorStop(1, 'rgba(20,24,32,0.16)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, W, H);

  // ── Detail drawing helpers (both sides at once) ──
  const sides = [
    { y: (s: number, h: number) => p.vOf(s, h) * H, port: true },
    { y: (s: number, h: number) => (1 - p.vOf(s, h)) * H, port: false },
  ];
  /** Pixels per metre around the body at a station. */
  const syAt = (s: number) => H / girth(p, s);

  const doors = doorLayout(type, p, opts.wingZ);
  const lineColor = luminance(pal.body) > 0.3 ? 'rgba(30,38,52,0.55)' : 'rgba(235,240,248,0.5)';

  const drawDoor = (d: DoorSpec, side: (typeof sides)[number]): void => {
    const s = d.z / L;
    const x0 = (d.z - d.width / 2) * sx;
    const x1 = (d.z + d.width / 2) * sx;
    const ya = side.y(s, d.sill);
    const yb = side.y(s, d.sill + d.height);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = Math.max(1, W / 2600);
    roundRect(ctx, x0, Math.min(ya, yb), x1 - x0, Math.abs(yb - ya), (x1 - x0) * 0.16);
    ctx.stroke();
    if (!d.hatch) {
      // Porthole and handle.
      const yw = side.y(s, d.sill + d.height * 0.72);
      const ww = (x1 - x0) * 0.22;
      const wh = 0.3 * syAt(s) * 0.5;
      ctx.fillStyle = '#18202e';
      roundRect(ctx, (x0 + x1) / 2 - ww / 2, yw - wh, ww, wh * 2, ww * 0.45);
      ctx.fill();
      ctx.fillStyle = lineColor;
      const yh = side.y(s, d.sill + d.height * 0.45);
      ctx.fillRect(x0 + (x1 - x0) * 0.16, yh - 1, (x1 - x0) * 0.2, Math.max(1.5, W / 2000));
    }
  };

  // ── Cabin windows ──
  const winW = (type.id.startsWith('b78') ? 0.28 : 0.235) * (wide ? 1.05 : 1);
  const winH = type.id.startsWith('b78') ? 0.46 : 0.335;
  const pitch = cat === 'turboprop' || cat === 'regional' ? 0.5 : 0.53;
  const rim = luminance(pal.body) > 0.5 ? 'rgba(120,128,142,0.9)' : 'rgba(210,216,226,0.75)';

  const windowRow = (h: number, z0: number, z1: number, skip: DoorSpec[]): void => {
    const count = Math.floor((z1 - z0) / pitch);
    for (let i = 0; i <= count; i++) {
      const z = z0 + i * pitch;
      if (skip.some((d) => Math.abs(d.z - z) < d.width / 2 + (d.hatch ? -0.1 : 0.3))) continue;
      const s = z / L;
      const hh = winH * syAt(s);
      const ww = winW * sx;
      for (const side of sides) {
        const y = side.y(s, h);
        roundRect(ctx, z * sx - ww / 2, y - hh / 2, ww, hh, ww * 0.42);
        ctx.fillStyle = '#141b28';
        ctx.fill();
        ctx.strokeStyle = rim;
        ctx.lineWidth = Math.max(0.8, W / 3600);
        ctx.stroke();
        // Sky reflected in the upper part of the pane.
        ctx.fillStyle = 'rgba(120,150,190,0.28)';
        const top = side.port ? y : y - hh / 2;
        roundRect(ctx, z * sx - ww / 2 + 1, top + (side.port ? 1 : 1), ww - 2, hh / 2 - 1, ww * 0.3);
        ctx.fill();
      }
    }
  };
  const cabinStart = p.noseLen * (wide ? 0.98 : 0.97) + 0.5;
  const cabinEnd = L - p.tailLen * 0.66;
  windowRow(p.windowY, cabinStart, cabinEnd, doors.main);
  if (p.upperDeck && p.upperWindowY !== null) {
    windowRow(p.upperWindowY, p.upperDeck[0] * L + 0.6, p.upperDeck[1] * L - 0.6, doors.upper);
  }

  // ── Doors ──
  for (const side of sides) {
    for (const d of doors.main) drawDoor(d, side);
    for (const d of doors.upper) drawDoor(d, side);
  }
  // Cargo doors on the starboard belly.
  if (cat !== 'turboprop') {
    const cw = wide ? 2.7 : 1.82;
    const ch = wide ? 1.7 : 1.2;
    for (const z of [p.noseLen + L * 0.07, L - p.tailLen - L * 0.05]) {
      drawDoor({ z, width: cw, height: ch, sill: p.floorY - ch - 0.25, hatch: true }, sides[1]);
    }
  }

  // ── Flight deck glazing ──
  // The glass is the band of the nose between two heights, cut into panes by posts.
  const hump = type.shape.upperDeck === 'hump';
  const small = cat === 'turboprop' || cat === 'regional';
  const sill = hump ? R * 0.98 : small ? R * 0.3 : R * 0.27;
  const head = hump ? R * 1.27 : small ? R * 0.68 : R * 0.6;
  const aFront = hump ? 0.3 : 0.2;
  const aRear = hump ? 0.9 : 0.86;
  const posts = hump ? [0.5, 0.7] : [0.455, 0.655];
  const paneRanges: [number, number][] = [[aFront, posts[0] - 0.012], [posts[0] + 0.012, posts[1] - 0.012], [posts[1] + 0.012, aRear]];
  const alphaOf = (a: number, h: number): number | null => {
    const sec = p.section((a * p.noseLen) / L);
    if (h >= sec.yTop) return null;
    const sin = h >= sec.yMid ? (h - sec.yMid) / (sec.yTop - sec.yMid) : (h - sec.yMid) / (sec.yMid - sec.yBot);
    return Math.asin(Math.max(-1, Math.min(1, sin)));
  };
  for (const side of sides) {
    const ymap = (alpha: number) => {
      const v = (alpha + Math.PI / 2) / (2 * Math.PI);
      return side.port ? v * H : (1 - v) * H;
    };
    paneRanges.forEach(([a0, a1], pane) => {
      const lower: [number, number][] = [];
      const upper: [number, number][] = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        let lo = alphaOf(a, sill);
        if (lo === null) continue;
        // The front edge slants back from the centre post; the rear edge leans forward.
        const frontLimit = 1.5 - ((a - aFront) / 0.14) * (1.5 - lo);
        lo = Math.max(lo, frontLimit);
        if (pane === 2) lo = Math.max(lo, alphaOf(a, sill + (head - sill) * 0.9 * smoothstep(aRear - 0.14, aRear + 0.02, a)) ?? lo);
        const hi = Math.min(alphaOf(a, head) ?? Math.PI / 2, Math.PI / 2 - 0.045);
        if (hi - lo < 0.02) continue;
        const x = ((a * p.noseLen) / L) * W;
        lower.push([x, ymap(lo)]);
        upper.push([x, ymap(hi)]);
      }
      if (lower.length < 2) return;
      ctx.beginPath();
      lower.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      for (let i = upper.length - 1; i >= 0; i--) ctx.lineTo(upper[i][0], upper[i][1]);
      ctx.closePath();
      const g = ctx.createLinearGradient(lower[0][0], 0, lower[lower.length - 1][0], 0);
      g.addColorStop(0, '#1a2436');
      g.addColorStop(1, '#0b1018');
      ctx.fillStyle = g;
      ctx.fill();
      // Frames show up light on a dark fuselage, dark on a light one.
      ctx.strokeStyle = luminance(pal.body) > 0.3 ? 'rgba(15,18,24,0.9)' : 'rgba(205,214,228,0.6)';
      ctx.lineWidth = Math.max(1, W / 2400);
      ctx.stroke();
    });
  }
  // Radome seam.
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1, W / 3200);
  ctx.beginPath();
  const seam = ((hump ? 0.16 : 0.15) * p.noseLen) / L * W;
  ctx.moveTo(seam, 0);
  ctx.lineTo(seam, H);
  ctx.stroke();

  // ── Titles and registration ──
  // Text is drawn in a per-side frame where +x is the reading direction and one unit is a centimetre.
  const inFrame = (side: (typeof sides)[number], s: number, h: number, draw: () => void): void => {
    ctx.save();
    ctx.translate(s * W, side.y(s, h));
    const sy = syAt(Math.max(p.noseLen / L, Math.min(1 - p.tailLen / L, s)));
    ctx.scale(((side.port ? 1 : -1) * sx) / 100, ((side.port ? -1 : 1) * sy) / 100);
    draw();
    ctx.restore();
  };

  /** A colour that reads against whatever the style painted at a spot on the fuselage. */
  const inkAt = (z: number, h: number, preferred: string): string => {
    const s = z / L;
    const sec = p.section(s);
    const hn = h >= sec.yMid ? (h - sec.yMid) / (sec.yTop - sec.yMid) : (h - sec.yMid) / (sec.yMid - sec.yBot);
    let bg = pal.body;
    for (const b of painted) {
      if (s >= b.s0 && s <= b.s1 && hn >= b.lo(s) && hn <= b.hi(s)) bg = b.color;
    }
    return Math.abs(luminance(preferred) - luminance(bg)) > 0.2 ? preferred : contrastOn(bg);
  };

  const name = (opts.airlineName ?? '').trim();
  if (name) {
    const full = type.shape.upperDeck === 'full';
    let em = Math.max(0.85, Math.min(2.3, (wide ? 0.56 : 0.7) * R));
    let centre: number;
    if (full && p.upperWindowY !== null) {
      em = Math.min(em, p.upperWindowY - p.windowY - 1.0);
      centre = (p.windowY + p.upperWindowY) / 2;
    } else {
      // Height above the window line that the style's stripes occupy.
      const clear = livery.style === 'cheatline' ? 0.68 : livery.style === 'retro' ? 0.19 * p.top + 0.2 : 0.3;
      centre = p.windowY + clear + em * 0.56;
      // Stay off the crown, and below the upper-deck windows of a 747.
      const ceiling = hump && p.upperWindowY !== null ? p.upperWindowY - 0.45 : p.top * 0.93;
      if (centre + em * 0.4 > ceiling) {
        em = Math.max(0.6, (ceiling - p.windowY - clear) / 0.96);
        centre = p.windowY + clear + em * 0.56;
      }
    }
    const font = (size: number) => `${livery.style === 'retro' ? 'italic 700' : 'italic 800'} ${size}px ${livery.style === 'retro' ? SERIF : SANS}`;
    ctx.font = font(em * 100);
    const maxWidth = L * 0.4 * 100;
    const logo = em * 100 * 1.05;
    const gap = em * 100 * 0.3;
    let textW = ctx.measureText(name).width;
    if (logo + gap + textW > maxWidth) {
      const k = maxWidth / (logo + gap + textW);
      em *= k;
      ctx.font = font(em * 100);
      textW = ctx.measureText(name).width;
    }
    const size = em * 100;
    const block = size * 1.05 + size * 0.3 + textW;
    const zStart = doors.main[0].z + doors.main[0].width / 2 + 0.7;
    const ink = inkAt(zStart + block / 200, centre, pal.titles);
    for (const side of sides) {
      const zOrigin = side.port ? zStart : zStart + block / 100;
      inFrame(side, zOrigin / L, centre, () => {
        ctx.fillStyle = ink;
        ctx.save();
        ctx.translate(0, -size * 0.52);
        ctx.scale((size * 1.05) / 100, (size * 1.05) / 100);
        ctx.fill(emblemPath(livery.emblem));
        ctx.restore();
        ctx.font = font(size);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(name, size * 1.35, size * 0.04);
      });
    }
  }

  const reg = (opts.registration ?? '').trim();
  if (reg) {
    // Rear fuselage, above the last windows.
    const size = Math.max(0.3, Math.min(0.6, R * 0.21)) * 100;
    const z = L - p.tailLen * 0.8;
    const stripes = livery.style === 'cheatline' ? 0.68 : livery.style === 'retro' ? 0.19 * p.top + 0.2 : 0.34;
    const h = Math.min(p.windowY + stripes + size / 200 + 0.08, (p.upperWindowY ?? p.top) - size / 200 - 0.25);
    const ink = inkAt(z, h, contrastOn(pal.body));
    for (const side of sides) {
      inFrame(side, z / L, h, () => {
        ctx.font = `700 ${size}px ${SANS}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.9;
        ctx.fillText(reg, 0, 0);
      });
    }
  }
  return canvas;
}

// ───────────────────────── Fin ─────────────────────────

export interface FinPlanform {
  /** [z, y] of the four corners, metres. */
  rootLE: [number, number];
  rootTE: [number, number];
  tipLE: [number, number];
  tipTE: [number, number];
}

export interface FinMapping {
  zMax: number;
  zMin: number;
  yMin: number;
  yMax: number;
}

export function finMapping(f: FinPlanform): FinMapping {
  return {
    zMax: Math.max(f.rootLE[0], f.tipLE[0]),
    zMin: Math.min(f.rootTE[0], f.tipTE[0]),
    yMin: Math.min(f.rootLE[1], f.rootTE[1]),
    yMax: Math.max(f.tipLE[1], f.tipTE[1]),
  };
}

/** Paints the fin as seen from the port side (nose to the left). */
export function paintFin(livery: Livery, f: FinPlanform, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pal = liveryPalette(livery);
  const m = finMapping(f);
  const kx = size / (m.zMax - m.zMin);
  const ky = size / (m.yMax - m.yMin);
  const X = (z: number) => (m.zMax - z) * kx;
  const Y = (y: number) => (m.yMax - y) * ky;
  const height = m.yMax - m.yMin;
  /** Leading / trailing edge position at a height fraction. */
  const le = (t: number) => f.rootLE[0] + (f.tipLE[0] - f.rootLE[0]) * t;
  const te = (t: number) => f.rootTE[0] + (f.tipTE[0] - f.rootTE[0]) * t;

  ctx.fillStyle = pal.fin;
  ctx.fillRect(0, 0, size, size);

  /** Fills a band across the fin between two (possibly slanted) height fractions. */
  const stripe = (t0Front: number, t0Rear: number, t1Front: number, t1Rear: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(X(m.zMax + 1), Y(m.yMin + height * t0Front));
    ctx.lineTo(X(m.zMin - 1), Y(m.yMin + height * t0Rear));
    ctx.lineTo(X(m.zMin - 1), Y(m.yMin + height * t1Rear));
    ctx.lineTo(X(m.zMax + 1), Y(m.yMin + height * t1Front));
    ctx.closePath();
    ctx.fill();
  };

  switch (livery.style) {
    case 'wave':
      stripe(-0.2, 0.34, -0.08, 0.5, livery.secondary);
      break;
    case 'tailband':
      stripe(-0.3, 0.16, -0.16, 0.3, livery.secondary);
      break;
    case 'bellyswoop':
      stripe(0.02, 0.1, 0.07, 0.15, livery.secondary);
      break;
    case 'retro':
      stripe(0.1, 0.34, 0.22, 0.46, livery.primary);
      stripe(0.25, 0.49, 0.29, 0.53, livery.secondary);
      stripe(0.32, 0.56, 0.36, 0.6, livery.primary);
      break;
    case 'solid':
      stripe(-0.1, 0.12, -0.02, 0.2, livery.secondary);
      break;
    default:
      break;
  }

  // Emblem, sized to the local chord and centred a little above mid-height.
  const t = livery.style === 'retro' ? 0.72 : 0.56;
  const chord = le(t) - te(t);
  const mark = Math.min(chord * 0.66, height * (livery.style === 'retro' ? 0.34 : 0.46));
  const cz = (le(t) + te(t)) / 2 - chord * 0.03;
  const cy = m.yMin + height * t;
  ctx.save();
  ctx.translate(X(cz), Y(cy));
  ctx.scale((mark * kx) / 100, (mark * ky) / 100);
  ctx.translate(-50, -50);
  if (livery.style === 'retro') {
    ctx.fillStyle = livery.primary;
    ctx.beginPath();
    ctx.arc(50, 50, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = contrastOn(livery.primary);
    ctx.translate(14, 14);
    ctx.scale(0.72, 0.72);
  } else {
    ctx.fillStyle = pal.finMark;
  }
  ctx.fill(emblemPath(livery.emblem));
  ctx.restore();

  // Unpainted leading edge.
  ctx.fillStyle = 'rgba(214,219,226,0.92)';
  ctx.beginPath();
  ctx.moveTo(X(le(0) + 0.05), Y(m.yMin));
  ctx.lineTo(X(le(1) + 0.05), Y(m.yMax));
  ctx.lineTo(X(le(1) - (le(1) - te(1)) * 0.035), Y(m.yMax));
  ctx.lineTo(X(le(0) - (le(0) - te(0)) * 0.025), Y(m.yMin));
  ctx.closePath();
  ctx.fill();

  // Rudder hinge line.
  ctx.strokeStyle = luminance(pal.fin) > 0.4 ? 'rgba(30,38,52,0.4)' : 'rgba(240,244,250,0.3)';
  ctx.lineWidth = Math.max(1.2, size / 500);
  ctx.beginPath();
  ctx.moveTo(X(te(0.03) + (le(0.03) - te(0.03)) * 0.3), Y(m.yMin + height * 0.03));
  ctx.lineTo(X(te(0.95) + (le(0.95) - te(0.95)) * 0.32), Y(m.yMin + height * 0.95));
  ctx.stroke();
  return canvas;
}

// ───────────────────────── Wings ─────────────────────────

/**
 * Generic wing skin. u runs root → tip; v runs trailing edge (0) → leading edge
 * (0.5) over the upper surface and back to the trailing edge (1) underneath.
 */
export function paintWing(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const yU = (xi: number) => 0.5 * (1 - xi) * H; // upper surface row for a chord fraction
  const yL = (xi: number) => (0.5 + 0.5 * xi) * H;

  ctx.fillStyle = '#9aa2ae';
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = '#878f9c';
  ctx.fillRect(0, H / 2, W, H / 2);

  // Bare-metal leading edge (slats) wrapping both surfaces.
  ctx.fillStyle = '#c9cfd7';
  ctx.fillRect(0, yU(0.085), W, yL(0.06) - yU(0.085));

  const line = 'rgba(70,80,96,0.55)';
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(1, size / 700);
  const rect = (u0: number, u1: number, y0: number, y1: number, fill?: string) => {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(u0 * W, Math.min(y0, y1), (u1 - u0) * W, Math.abs(y1 - y0));
    }
    ctx.strokeRect(u0 * W, Math.min(y0, y1), (u1 - u0) * W, Math.abs(y1 - y0));
  };
  // Slat segments.
  for (const [a, b] of [[0.1, 0.27], [0.28, 0.45], [0.46, 0.63], [0.64, 0.8], [0.81, 0.9]]) rect(a, b, yU(0.085), yU(0), undefined);
  // Flaps, ailerons and spoilers on the upper surface.
  rect(0.05, 0.3, yU(1), yU(0.72), '#929aa7');
  rect(0.345, 0.66, yU(1), yU(0.74), '#929aa7');
  rect(0.7, 0.89, yU(1), yU(0.76), '#959daa');
  for (let i = 0; i < 5; i++) rect(0.2 + i * 0.09, 0.2 + (i + 1) * 0.09 - 0.006, yU(0.72), yU(0.6), '#8c94a1');
  // Same hinge lines underneath.
  rect(0.05, 0.3, yL(0.72), yL(1), undefined);
  rect(0.345, 0.66, yL(0.74), yL(1), undefined);
  rect(0.7, 0.89, yL(0.76), yL(1), undefined);
  // Walkway stripe near the root.
  ctx.fillStyle = 'rgba(40,46,58,0.35)';
  ctx.fillRect(0.02 * W, yU(0.62), 0.16 * W, Math.max(2, size / 400));
  return canvas;
}

// ───────────────────────── 2D logo ─────────────────────────

/** Canvas with an airline logo badge (rounded square, brand colours, emblem) for 2D use. */
export function renderLogo(livery: Livery, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const px = Math.max(8, Math.round(size));
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const bg = livery.style === 'solid' ? livery.base : livery.primary;
  const g = ctx.createLinearGradient(0, 0, px, px);
  g.addColorStop(0, mixColor(bg, '#ffffff', 0.14));
  g.addColorStop(1, mixColor(bg, '#000000', 0.2));
  roundRect(ctx, 0, 0, px, px, px * 0.24);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // A sliver of the second brand colour across the bottom corner.
  ctx.fillStyle = livery.secondary;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, px);
  ctx.lineTo(px, px);
  ctx.lineTo(px, px * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const mark = livery.style === 'solid' && Math.abs(luminance(livery.secondary) - luminance(bg)) > 0.18 ? livery.secondary : contrastOn(bg);
  ctx.save();
  ctx.translate(px * 0.19, px * 0.17);
  ctx.scale((px * 0.62) / 100, (px * 0.62) / 100);
  ctx.fillStyle = mark;
  ctx.fill(emblemPath(livery.emblem));
  ctx.restore();
  return canvas;
}
