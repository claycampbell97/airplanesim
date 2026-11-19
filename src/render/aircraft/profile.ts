// Fuselage shape: one description shared by the geometry (model.ts) and the paint
// (livery.ts), so that windows, doors and stripes land exactly where the surface is.
//
// Stations run from the nose (s = 0) to the tail (s = 1). Heights are in metres
// relative to the fuselage reference line (the widest point of the constant
// section), which is also the model's y = 0.

import type { AircraftType } from '../../sim/types';

export interface Section {
  /** Lowest point, widest point and highest point of the cross-section. */
  yBot: number;
  yMid: number;
  yTop: number;
  /** Half width at yMid. */
  hw: number;
}

export interface FuselageProfile {
  length: number;
  /** Half width of the constant section. */
  radius: number;
  noseLen: number;
  tailLen: number;
  /** Crown and keel height of the constant section (without any upper-deck hump). */
  top: number;
  bottom: number;
  /** Height of the main-deck window centres. */
  windowY: number;
  /** Height of the upper-deck window centres, if there is an upper deck. */
  upperWindowY: number | null;
  /** Stations between which upper-deck windows exist. */
  upperDeck: [number, number] | null;
  /** Height of the cabin floor. */
  floorY: number;
  section(s: number): Section;
  /** Texture v (0..0.5) of a height on the port side at station s; starboard is 1 - v. */
  vOf(s: number, h: number): number;
  /** Height at a normalised position: -1 keel, 0 widest point, +1 crown. */
  heightAt(s: number, hn: number): number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Rounded-nose profile: 0 at the tip, 1 (with zero slope) where the nose meets the barrel. */
function ogive(u: number, a: number, b: number): number {
  return Math.pow(1 - Math.pow(1 - Math.max(0, Math.min(1, u)), a), b);
}

export function isRearEngined(type: AircraftType): boolean {
  return type.shape.engineMount === 'rear';
}

export function is737(type: AircraftType): boolean {
  return type.maker === 'Boeing' && type.model.startsWith('737');
}

export function makeFuselageProfile(type: AircraftType): FuselageProfile {
  const sh = type.shape;
  const L = sh.length;
  const R = sh.diameter / 2;
  const cat = type.category;
  const full = sh.upperDeck === 'full';
  const hump = sh.upperDeck === 'hump';

  // Constant-section extents. The double-decker is taller than it is wide.
  const top = full ? R * 1.275 : R;
  const bottom = full ? -R * 1.08 : -R;

  let noseK = 1.55;
  let tailK = 3.0;
  let noseDrop = 0.2;
  let tailTip = 0.4;
  if (cat === 'turboprop') { noseK = 1.75; tailK = 3.3; noseDrop = 0.28; tailTip = 0.5; }
  else if (sh.engineMount === 'rear') { noseK = 2.05; tailK = 3.3; noseDrop = 0.25; tailTip = 0.3; }
  else if (cat === 'regional') { noseK = 1.8; tailK = 3.1; noseDrop = 0.24; tailTip = 0.42; }
  else if (cat === 'narrowbody') { noseK = is737(type) || type.id === 'b752' ? 1.65 : 1.5; tailK = 3.05; }
  else if (cat === 'widebody') { noseK = type.maker === 'Boeing' ? 1.7 : 1.55; tailK = 2.9; noseDrop = 0.26; tailTip = 0.42; }
  if (full) { noseK = 1.3; tailK = 2.75; noseDrop = 0.3; tailTip = 0.5; }
  if (hump) { noseK = 1.45; tailK = 2.7; noseDrop = 0.42; tailTip = 0.45; }

  const noseLen = noseK * sh.diameter;
  const tailLen = tailK * sh.diameter;
  const tipY = -noseDrop * R;
  const tailY = tailTip * R;
  const tailR = 0.1 * R;
  const humpH = hump ? R * 0.42 : 0;
  const humpEnd = 0.37;

  // The 747's upper deck: rises behind the radome, runs back and fairs into the crown.
  const humpAt = (s: number): number => {
    if (!hump) return 0;
    return humpH * smoothstep(0.0, (noseLen * 0.75) / L, s) * (1 - smoothstep(humpEnd, humpEnd + 0.12, s));
  };

  const section = (s: number): Section => {
    const z = Math.max(0, Math.min(1, s)) * L;
    let yTop = top + humpAt(s);
    let yBot = bottom;
    let yMid = 0;
    let hw = R;
    if (z < noseLen) {
      const u = z / noseLen;
      // The crown slopes down over the flight deck; the belly fills out much sooner.
      const ft = ogive(u, 1.45, 0.6);
      const fb = ogive(u, 2.4, 0.5);
      const fw = ogive(u, 1.9, 0.53);
      yTop = tipY + (yTop - tipY) * ft;
      yBot = tipY + (yBot - tipY) * fb;
      yMid = tipY * (1 - ogive(u, 1.6, 0.7));
      hw = R * fw;
    } else if (z > L - tailLen) {
      const v = (z - (L - tailLen)) / tailLen;
      const up = Math.pow(v, 1.5);
      yTop = yTop + (tailY + tailR - yTop) * Math.pow(v, 1.7);
      yBot = yBot + (tailY - tailR - yBot) * up;
      yMid = tailY * Math.pow(v, 1.6);
      hw = R + (tailR - R) * Math.pow(v, 1.38);
    }
    // Keep the widest point inside the section.
    yMid = Math.max(yBot + (yTop - yBot) * 0.2, Math.min(yTop - (yTop - yBot) * 0.2, yMid));
    return { yBot, yMid, yTop, hw: Math.max(hw, 0.004) };
  };

  const vOf = (s: number, h: number): number => {
    const sec = section(s);
    let sin: number;
    if (h >= sec.yMid) sin = (h - sec.yMid) / Math.max(1e-6, sec.yTop - sec.yMid);
    else sin = (h - sec.yMid) / Math.max(1e-6, sec.yMid - sec.yBot);
    const alpha = Math.asin(Math.max(-1, Math.min(1, sin)));
    return (alpha + Math.PI / 2) / (2 * Math.PI);
  };

  const heightAt = (s: number, hn: number): number => {
    const sec = section(s);
    const c = Math.max(-1, Math.min(1, hn));
    return c >= 0 ? sec.yMid + c * (sec.yTop - sec.yMid) : sec.yMid + c * (sec.yMid - sec.yBot);
  };

  // Cabin geometry.
  let windowY = R * 0.19;
  let upperWindowY: number | null = null;
  let upperDeck: [number, number] | null = null;
  if (full) {
    windowY = -R * 0.2;
    upperWindowY = R * 0.62;
    upperDeck = [(noseLen * 1.25) / L, 1 - (tailLen * 0.95) / L];
  } else if (hump) {
    windowY = R * 0.12;
    upperWindowY = top + humpH * 0.38;
    upperDeck = [(noseLen * 1.12) / L, humpEnd - 0.02];
  } else if (cat === 'widebody') {
    windowY = R * 0.2;
  }
  const floorY = windowY - 0.98;

  return { length: L, radius: R, noseLen, tailLen, top, bottom, windowY, upperWindowY, upperDeck, floorY, section, vOf, heightAt };
}
