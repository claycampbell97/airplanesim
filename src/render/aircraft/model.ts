// Procedural airliners. Every type in the catalogue is generated from a handful of
// shape parameters (length, span, fuselage diameter, engine layout, tail and
// winglet style), so the fleet stays consistent and no model files are needed.
//
// The result is a THREE.Group in metres: nose towards +Z, +Y up, +X to port,
// origin on the fuselage reference line at mid-length.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AircraftType, Livery } from '../../sim/types';
import { finMapping, liveryPalette, paintFin, paintFuselage, paintWing } from './livery';
import type { FinPlanform } from './livery';
import {
  ellipsoid, fuselageGeometry, fuselageStations, hubGeometry, loftGeometry, plate, revolve, ring, strut, tyreGeometry, weldLofts,
} from './parts';
import type { Station } from './parts';
import { is737, makeFuselageProfile } from './profile';
import type { FuselageProfile } from './profile';

export interface AircraftModelOptions {
  /** Landing gear down (hangar) or retracted (in flight). Default true. */
  gear?: boolean;
  /** Painted on the rear fuselage. */
  registration?: string;
  /** Painted as the fuselage titles. */
  airlineName?: string;
  /** 'high' for the hangar, 'low' for distant use (fewer segments, smaller textures). */
  detail?: 'high' | 'low';
}

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type MatKey = 'paint' | 'nacelle' | 'winglet' | 'grey' | 'chrome' | 'dark' | 'core' | 'intake' | 'tyre' | 'hub' | 'wing';

/** Collects geometry per material so the finished aircraft is a handful of draw calls. */
class Assembly {
  private buckets = new Map<MatKey, THREE.BufferGeometry[]>();

  add(key: MatKey, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (matrix) g.applyMatrix4(matrix);
    // Keep only what every part has, so the buckets can be merged.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(g);
  }

  /** Adds a part and its mirror image on the starboard side. */
  addPair(key: MatKey, geo: THREE.BufferGeometry): void {
    const twin = geo.clone();
    twin.scale(-1, 1, 1);
    flipFaces(twin);
    this.add(key, geo);
    this.add(key, twin);
  }

  build(materials: Record<MatKey, THREE.Material>, group: THREE.Group): number {
    let triangles = 0;
    for (const [key, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      triangles += merged.attributes.position.count / 3;
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.castShadow = true;
      mesh.name = key;
      group.add(mesh);
    }
    return triangles;
  }
}

/** Reverses the winding of a non-indexed or indexed geometry (after mirroring). */
function flipFaces(geo: THREE.BufferGeometry): void {
  if (geo.index) {
    const idx = geo.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    geo.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name] as THREE.BufferAttribute;
      const n = a.itemSize;
      const arr = a.array as Float32Array;
      for (let i = 0; i < a.count; i += 3) {
        for (let k = 0; k < n; k++) {
          const t = arr[(i + 1) * n + k];
          arr[(i + 1) * n + k] = arr[(i + 2) * n + k];
          arr[(i + 2) * n + k] = t;
        }
      }
    }
  }
}

// ───────────────────────── Layout ─────────────────────────

interface WingLayout {
  /** Semi-span of the main panel and of the whole wing including tip devices. */
  bMain: number;
  b: number;
  apexZ: number;
  rootY: number;
  cr: number;
  ck: number;
  ct: number;
  etaK: number;
  tanLE: number;
  tanDihedral: number;
  flex: number;
  high: boolean;
}

function wingLayout(type: AircraftType, p: FuselageProfile): WingLayout {
  const sh = type.shape;
  const cat = type.category;
  const b = sh.span / 2;
  const prop = sh.engineMount === 'prop';
  const rear = sh.engineMount === 'rear';
  const raked = sh.winglet === 'raked';
  let ar = 9.6;
  if (prop) ar = 12;
  else if (cat === 'regional') ar = rear ? 8.6 : raked ? 10.6 : 9.2;
  else if (cat === 'widebody') ar = raked ? 10 : 9.5;
  else if (cat === 'jumbo') ar = 7.7;
  const mean = sh.span / ar;

  let bMain = b;
  if (sh.winglet === 'blended' || sh.winglet === 'sharklet' || sh.winglet === 'split') bMain = b * 0.962;
  else if (raked) bMain = b * 0.885;

  const cr = mean * (prop ? 1.22 : rear ? 1.75 : 1.9);
  const ck = mean * (prop ? 1.12 : 1.02);
  const ct = mean * (prop ? 0.62 : raked ? 0.34 : 0.37);
  const etaK = prop ? 0.36 : 0.31;
  const tanLE = Math.tan(sh.sweep * DEG) + (ck - ct) / (4 * bMain * (1 - etaK));
  const high = !!sh.highWing;
  const dihedral = high ? 1.2 : cat === 'jumbo' ? 7 : cat === 'widebody' ? 6 : 5.4;
  const flex = high ? 0 : raked ? 0.034 : cat === 'widebody' || cat === 'jumbo' ? 0.02 : 0.012;

  // Put the wing where the centre of gravity needs it.
  const sCG = prop ? 0.445 : rear ? 0.545 : 0.462;
  const dApex = sCG * p.length - bMain * 0.42 * tanLE - 0.25 * mean * 1.05;
  return {
    bMain, b,
    apexZ: p.length / 2 - dApex,
    rootY: high ? p.top * 0.84 : p.bottom * 0.52,
    cr, ck, ct, etaK, tanLE,
    tanDihedral: Math.tan(dihedral * DEG),
    flex, high,
  };
}

/** Leading-edge position, chord and height of the wing at a spanwise x (main panel). */
function wingAt(w: WingLayout, x: number): { zLE: number; chord: number; y: number; slope: number; eta: number } {
  const eta = Math.max(0, Math.min(1, x / w.bMain));
  const chord = eta <= w.etaK ? lerp(w.cr, w.ck, eta / w.etaK) : lerp(w.ck, w.ct, (eta - w.etaK) / (1 - w.etaK));
  const y = w.rootY + x * w.tanDihedral + w.flex * w.b * (x / w.b) * (x / w.b);
  const slope = w.tanDihedral + (2 * w.flex * x) / w.b;
  return { zLE: w.apexZ - x * w.tanLE, chord, y, slope, eta };
}

function mainWingStations(w: WingLayout): Station[] {
  const etas = [0, 0.07, 0.14, 0.22, w.etaK, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 0.98, 1];
  return etas.map((eta) => {
    const a = wingAt(w, eta * w.bMain);
    return {
      x: eta * w.bMain, y: a.y, zLE: a.zLE, chord: a.chord, cant: Math.atan(a.slope),
      thick: lerp(0.15, 0.105, eta), twist: lerp(1.8, -3, eta) * DEG, u: eta * 0.9,
    };
  });
}

// ───────────────────────── Materials ─────────────────────────

function paint(color: string, map?: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : new THREE.Color(color),
    map: map ?? null,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.0,
  });
}

function canvasTexture(canvas: HTMLCanvasElement, flipY: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = flipY;
  tex.anisotropy = 8;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

let haloTexture: THREE.CanvasTexture | null = null;
function lightHalo(): THREE.Texture {
  if (!haloTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    haloTexture = new THREE.CanvasTexture(c);
    haloTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return haloTexture;
}

interface Lamp {
  sprite: THREE.Sprite;
  bulb: THREE.Mesh;
  /** 'steady' | 'strobe' | 'beacon' */
  mode: string;
  phase: number;
  size: number;
}

// ───────────────────────── Engines ─────────────────────────

interface FanRef {
  object: THREE.Object3D;
  /** Radians per second when idling on the ground / running in flight. */
  idle: number;
  run: number;
  blur?: THREE.Mesh;
}

/** Turbofan nacelle with its intake at the local origin, pointing along +Z. */
function addTurbofan(asm: Assembly, group: THREE.Group, fans: FanRef[], pos: THREE.Vector3, D: number, Ln: number, seg: number, bladeMat: THREE.Material, mirrorX: boolean): void {
  const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
  // Outer cowl, aft to front.
  asm.add('nacelle', revolve([
    [0.415 * D, -Ln], [0.452 * D, -0.84 * Ln], [0.488 * D, -0.6 * Ln], [0.5 * D, -0.38 * Ln],
    [0.496 * D, -0.22 * Ln], [0.482 * D, -0.1 * Ln], [0.464 * D, -0.04 * Ln],
  ], seg), m);
  // Polished intake lip.
  asm.add('chrome', revolve([
    [0.464 * D, -0.04 * Ln], [0.455 * D, -0.014 * Ln], [0.44 * D, 0], [0.425 * D, -0.012 * Ln], [0.416 * D, -0.045 * Ln],
  ], seg), m);
  // Intake duct down to the fan face.
  asm.add('intake', revolve([[0.416 * D, -0.045 * Ln], [0.412 * D, -0.12 * Ln], [0.41 * D, -0.215 * Ln]], seg), m);
  const backing = new THREE.CircleGeometry(0.41 * D, seg);
  backing.translate(0, 0, -0.23 * Ln);
  asm.add('dark', backing, m);
  // Bypass duct seen from behind, and the darkness inside it.
  asm.add('dark', revolve([[0.408 * D, -0.72 * Ln], [0.404 * D, -Ln + 0.004]], seg), m);
  const exit = ring(0.27 * D, 0.406 * D, seg, true);
  exit.translate(0, 0, -0.8 * Ln);
  asm.add('dark', exit, m);
  // Core cowl, nozzle and plug.
  const zc = -Ln;
  asm.add('core', revolve([[0.185 * D, zc - 0.36 * D], [0.245 * D, zc - 0.12 * D], [0.295 * D, zc + 0.1 * D], [0.31 * D, -0.78 * Ln]], seg), m);
  const nozzle = ring(0.09 * D, 0.186 * D, seg, true);
  nozzle.translate(0, 0, zc - 0.35 * D);
  asm.add('dark', nozzle, m);
  asm.add('core', revolve([[0.0005, zc - 0.7 * D], [0.06 * D, zc - 0.52 * D], [0.11 * D, zc - 0.37 * D], [0.118 * D, zc - 0.28 * D]], Math.max(8, seg / 2)), m);

  // Fan: spinner plus blades, on its own node so it can turn.
  const fan = new THREE.Group();
  fan.position.set(pos.x, pos.y, pos.z - 0.2 * Ln);
  const spinner = revolve([[0.125 * D, 0], [0.095 * D, 0.07 * D], [0.05 * D, 0.13 * D], [0.0005, 0.165 * D]], Math.max(10, seg / 2));
  const blades: number[] = [];
  const count = 22;
  const r0 = 0.12 * D;
  const r1 = 0.405 * D;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Each blade is a twisted quad: steep pitch at the hub, flatter at the tip, swept in rotation.
    const quad: number[][] = [];
    for (const [r, w, pitch, lean] of [[r0, 0.055 * D, 62 * DEG, 0], [r1, 0.085 * D, 28 * DEG, 0.12]] as number[][]) {
      const dx = (w / 2) * Math.cos(pitch);
      const dz = (w / 2) * Math.sin(pitch);
      // Local blade frame: radial = +Y, chord in X (tangential) and Z (axial).
      for (const s of [-1, 1]) {
        const tx = s * dx + lean * r;
        const ty = r;
        const tz = s * dz;
        quad.push([tx * ca - ty * sa, tx * sa + ty * ca, tz]);
      }
    }
    blades.push(...quad[0], ...quad[1], ...quad[3], ...quad[0], ...quad[3], ...quad[2]);
  }
  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
  bladeGeo.computeVertexNormals();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  const spinnerMesh = new THREE.Mesh(spinner, bladeMat);
  fan.add(bladeMesh, spinnerMesh);
  group.add(fan);
  fans.push({ object: fan, idle: mirrorX ? -1.1 : 1.1, run: mirrorX ? -9 : 9 });
}

/** Turboprop nacelle with the propeller plane at the local origin. */
function addTurboprop(asm: Assembly, group: THREE.Group, fans: FanRef[], pos: THREE.Vector3, D: number, back: number, propRadius: number, seg: number, propMat: THREE.Material, running: boolean): void {
  const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z).multiply(new THREE.Matrix4().makeScale(1, 1.18, 1));
  asm.add('nacelle', revolve([
    [0.0005, -back], [0.16 * D, -0.94 * back], [0.36 * D, -0.76 * back], [0.47 * D, -0.5 * back], [0.5 * D, -0.3 * back],
    [0.49 * D, -0.14 * back], [0.42 * D, -0.05 * back], [0.31 * D, -0.012 * back],
  ], seg), m);
  // Chin air intake.
  const scoop = ellipsoid(0.17 * D, 0.1 * D, 0.2 * D, 10, 8);
  scoop.translate(0, -0.36 * D, -0.07 * back);
  asm.add('dark', scoop, m);
  // Exhaust stub.
  const pipe = new THREE.CylinderGeometry(0.07 * D, 0.085 * D, 0.5 * D, 10, 1, true);
  pipe.rotateX(Math.PI / 2);
  pipe.translate(0.3 * D, -0.12 * D, -0.72 * back);
  asm.add('dark', pipe, m);

  const prop = new THREE.Group();
  prop.position.copy(pos);
  const spinner = new THREE.Mesh(revolve([[0.31 * D, -0.02 * D], [0.29 * D, 0.1 * D], [0.2 * D, 0.32 * D], [0.09 * D, 0.5 * D], [0.0005, 0.58 * D]], seg), propMat);
  prop.add(spinner);
  const bladePos: number[] = [];
  const bladeCol: number[] = [];
  const stations: [number, number, number][] = [[0.17, 0.065, 62], [0.4, 0.12, 46], [0.68, 0.13, 33], [0.9, 0.105, 26], [1.0, 0.045, 23]];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts: number[][] = [];
    const cols: number[][] = [];
    stations.forEach(([rf, cf, pitch], k) => {
      const r = rf * propRadius;
      const dx = ((cf * propRadius) / 2) * Math.cos(pitch * DEG);
      const dz = ((cf * propRadius) / 2) * Math.sin(pitch * DEG);
      for (const s of [-1, 1]) {
        const tx = s * dx;
        pts.push([tx * ca - r * sa, tx * sa + r * ca, s * dz + 0.12 * D]);
        // Yellow warning tips.
        cols.push(k >= 3 ? [0.95, 0.74, 0.08] : [0.07, 0.075, 0.085]);
      }
    });
    for (let k = 0; k < stations.length - 1; k++) {
      const q = [pts[k * 2], pts[k * 2 + 1], pts[k * 2 + 2], pts[k * 2 + 3]];
      const c = [cols[k * 2], cols[k * 2 + 1], cols[k * 2 + 2], cols[k * 2 + 3]];
      bladePos.push(...q[0], ...q[1], ...q[3], ...q[0], ...q[3], ...q[2]);
      bladeCol.push(...c[0], ...c[1], ...c[3], ...c[0], ...c[3], ...c[2]);
    }
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(bladeCol, 3));
  bg.computeVertexNormals();
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const blades = new THREE.Mesh(bg, bladeMat);
  blades.castShadow = true;
  prop.add(blades);
  // A faint disc stands in for motion blur when the engine is running.
  const disc = new THREE.CircleGeometry(propRadius, 40);
  disc.translate(0, 0, 0.12 * D);
  const blur = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: 0xcfd6e2, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
  blur.visible = running;
  prop.add(blur);
  if (!running) prop.rotation.z = 0.3 + pos.x * 0.37;
  group.add(prop);
  fans.push({ object: prop, idle: 0, run: pos.x > 0 ? 17 : -17, blur });
}

// ───────────────────────── The aircraft ─────────────────────────

export function buildAircraftModel(type: AircraftType, livery: Livery, opts: AircraftModelOptions = {}): THREE.Group {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const sh = type.shape;
  const cat = type.category;
  const high = (opts.detail ?? 'high') === 'high';
  const gearDown = opts.gear ?? true;
  const p = makeFuselageProfile(type);
  const w = wingLayout(type, p);
  const pal = liveryPalette(livery);
  const L = p.length;
  const R = p.radius;
  const D = sh.engineDiameter;
  const prop = sh.engineMount === 'prop';
  const rear = sh.engineMount === 'rear';
  const wide = cat === 'widebody' || cat === 'jumbo';
  const seg = high ? 28 : 14;
  const nAir = high ? 10 : 6;
  /** World z of a point `d` metres behind the nose. */
  const zAt = (d: number) => L / 2 - d;

  const group = new THREE.Group();
  group.name = `${type.maker} ${type.model}`;
  const asm = new Assembly();

  // ── Textures and materials ──
  const wingZ = L / 2 - (w.apexZ - w.cr * 0.5);
  const fuselageTex = canvasTexture(
    paintFuselage(type, p, livery, { width: high ? 4096 : 2048, airlineName: opts.airlineName, registration: opts.registration, wingZ }),
    false,
  );
  const wingTex = canvasTexture(paintWing(high ? 1024 : 512), false);
  const materials: Record<MatKey, THREE.Material> = {
    paint: paint(pal.body),
    nacelle: paint(pal.nacelle),
    winglet: paint(pal.winglet),
    grey: new THREE.MeshStandardMaterial({ color: 0xaab0ba, roughness: 0.55, metalness: 0.25 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.16, metalness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.7, metalness: 0.4 }),
    core: new THREE.MeshStandardMaterial({ color: 0x74787f, roughness: 0.38, metalness: 0.9 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.5 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.92, metalness: 0 }),
    hub: new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.35, metalness: 0.85 }),
    wing: new THREE.MeshPhysicalMaterial({ map: wingTex, roughness: 0.45, metalness: 0.25, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  };
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide });

  // ── Fuselage ──
  const stations = fuselageStations(p, high ? 16 : 9, high ? 8 : 3, high ? 16 : 9);
  const fuselage = new THREE.Mesh(fuselageGeometry(p, stations, high ? 40 : 20), paint('#ffffff', fuselageTex));
  fuselage.castShadow = true;
  fuselage.name = 'fuselage';
  group.add(fuselage);
  let triangles = fuselage.geometry.index!.count / 3;
  // APU exhaust.
  const tailSec = p.section(1);
  const apu = ring(0, tailSec.hw * 0.98, 12, true);
  apu.translate(0, (tailSec.yTop + tailSec.yBot) / 2, -L / 2 - 0.002);
  asm.add('dark', apu);

  // ── Wings ──
  const main = mainWingStations(w);
  const tip = main[main.length - 1];
  const wingStations: Station[] = [...main];
  let tipLampX = w.bMain;
  let tipLampY = tip.y;
  let tipLampZ = tip.zLE - tip.chord * 0.3;
  const wingletStations: Station[] = [];
  const style = sh.winglet;

  if (style === 'raked') {
    const ext = w.b - w.bMain;
    const tanMax = Math.tan(57 * DEG);
    for (let k = 1; k <= 6; k++) {
      const f = k / 6;
      const x = w.bMain + ext * f;
      const base = wingAt(w, w.bMain);
      const y = base.y + ext * f * base.slope + 0.3 * ext * f * f;
      wingStations.push({
        x, y,
        zLE: tip.zLE - ext * (w.tanLE * f + ((tanMax - w.tanLE) * f * f) / 2),
        chord: tip.chord * lerp(1, 0.16, Math.pow(f, 1.15)),
        cant: Math.atan(base.slope + 0.6 * f),
        thick: lerp(0.105, 0.08, f), twist: tip.twist, u: 0.9 + 0.1 * f,
      });
    }
    const last = wingStations[wingStations.length - 1];
    tipLampX = last.x; tipLampY = last.y; tipLampZ = last.zLE - last.chord * 0.5;
  } else if (style === 'none' || style === 'fence') {
    // Rounded tip.
    wingStations.push({ ...tip, x: tip.x + tip.chord * 0.06, zLE: tip.zLE - tip.chord * 0.12, chord: tip.chord * 0.8, thick: tip.thick * 0.7, u: 0.95 });
    wingStations.push({ ...tip, x: tip.x + tip.chord * 0.1, zLE: tip.zLE - tip.chord * 0.3, chord: tip.chord * 0.5, thick: tip.thick * 0.35, u: 1 });
    tipLampX = tip.x + tip.chord * 0.08;
  } else {
    // Blended winglet, sharklet or the upper half of a split scimitar: sweep the tip up through an arc.
    const cantMax = (style === 'blended' ? 74 : style === 'split' ? 68 : wide ? 66 : 80) * DEG;
    const height = tip.chord * (style === 'split' ? 1.95 : wide ? 1.85 : 1.8);
    const radius = tip.chord * (style === 'sharklet' ? 0.75 : 0.55);
    const cant0 = tip.cant;
    const arcLen = radius * (cantMax - cant0);
    const arcRise = radius * (Math.cos(cant0) - Math.cos(cantMax));
    const straight = Math.max(0.2, (height - arcRise) / Math.sin(cantMax));
    const total = arcLen + straight;
    const tanMax = Math.tan((style === 'sharklet' ? 44 : 52) * DEG);
    wingletStations.push({ ...tip, u: 0.9 });
    const steps = high ? 10 : 6;
    for (let k = 1; k <= steps; k++) {
      const sp = (total * k) / steps;
      let x: number, y: number, cant: number;
      if (sp <= arcLen) {
        cant = cant0 + sp / radius;
        x = tip.x + radius * (Math.sin(cant) - Math.sin(cant0));
        y = tip.y + radius * (Math.cos(cant0) - Math.cos(cant));
      } else {
        cant = cantMax;
        const d = sp - arcLen;
        x = tip.x + radius * (Math.sin(cantMax) - Math.sin(cant0)) + d * Math.cos(cantMax);
        y = tip.y + arcRise + d * Math.sin(cantMax);
      }
      const f = sp / total;
      wingletStations.push({
        x, y,
        zLE: tip.zLE - total * (w.tanLE * f + ((tanMax - w.tanLE) * f * f) / 2),
        chord: tip.chord * lerp(1, 0.3, Math.pow(f, 0.9)),
        cant, thick: lerp(0.105, 0.085, f), twist: tip.twist * (1 - f), u: 0.9 + 0.1 * f,
      });
    }
    tipLampX = tip.x + radius * 0.4; tipLampY = tip.y + 0.05;
  }

  for (const mirror of [false, true]) {
    const wingGeo = loftGeometry(wingStations, nAir, 0.018, mirror, wingletStations.length === 0);
    if (wingletStations.length) {
      const wl = loftGeometry(wingletStations, nAir, 0.01, mirror, true);
      weldLofts(wingGeo, wingStations.length, wl, 2 * nAir + 1);
      asm.add('winglet', wl);
    }
    asm.add('wing', wingGeo);
  }

  if (style === 'split') {
    // The scimitar's lower blade.
    const lower: Station[] = [];
    const len = tip.chord * 0.95;
    for (let k = 0; k <= 5; k++) {
      const f = k / 5;
      const cant = tip.cant - Math.min(1, f * 2.2) * (62 * DEG + tip.cant);
      lower.push({
        x: tip.x - 0.08 * tip.chord + len * f * 0.52, y: tip.y - 0.04 - len * f * 0.82 * Math.min(1, f * 1.6 + 0.2),
        zLE: tip.zLE - tip.chord * (0.32 + 0.75 * f), chord: tip.chord * lerp(0.6, 0.14, f),
        cant, thick: 0.09, twist: 0, u: 0.95,
      });
    }
    for (const mirror of [false, true]) asm.add('winglet', loftGeometry(lower, Math.max(4, nAir - 3), 0, mirror, true));
  }
  if (style === 'fence') {
    // Arrow-shaped plate above and below the tip.
    const c = tip.chord;
    const h = c * (cat === 'jumbo' ? 0.62 : 0.5);
    const x = tip.x + c * 0.09;
    const y = tip.y;
    const z0 = tip.zLE - c * 0.12;
    const fence = plate([[y, z0], [y + h, z0 - c * 0.72], [y + h, z0 - c * 0.98], [y, z0 - c * 0.9], [y - h * 0.8, z0 - c * 0.98], [y - h * 0.8, z0 - c * 0.74]], x, 0.035);
    asm.addPair('winglet', fence);
  }

  // Flap-track fairings under the trailing edge.
  if (!prop) {
    const fairingEtas = wide ? [0.17, 0.4, 0.62, 0.82] : [0.19, 0.44, 0.7];
    for (const eta of fairingEtas) {
      const a = wingAt(w, eta * w.bMain);
      const g = ellipsoid(0.045 * a.chord + 0.06, 0.05 * a.chord + 0.05, 0.3 * a.chord, 10, 8);
      g.translate(eta * w.bMain, a.y - 0.055 * a.chord - 0.04, a.zLE - a.chord * 0.9);
      asm.addPair('grey', g);
    }
  }

  // Wing-to-body fairing.
  if (!w.high) {
    const belly = ellipsoid(R * 1.04, R * 0.5, w.cr * 0.8, 20, 12);
    belly.translate(0, p.bottom * 0.8, w.apexZ - w.cr * 0.56);
    asm.add('paint', belly);
  } else {
    const hump = ellipsoid(R * 0.78, R * 0.3, w.cr * 0.78, 16, 10);
    hump.translate(0, p.top * 0.9, w.apexZ - w.cr * 0.5);
    asm.add('paint', hump);
  }

  // ── Ground reference and gear layout (needed for engine clearance) ──
  let clearance = 1.72;
  if (cat === 'turboprop') clearance = type.id === 'dh8d' ? 1.05 : 0.74;
  else if (cat === 'regional') clearance = rear ? 1.05 : 1.28;
  else if (cat === 'narrowbody') clearance = is737(type) ? 1.42 : 1.72;
  else if (cat === 'widebody') clearance = 2.35;
  else if (cat === 'jumbo') clearance = 2.5;
  const groundY = p.bottom - clearance;

  // ── Engines ──
  const fans: FanRef[] = [];
  const engineEtas = prop ? [0.3] : sh.engines === 4 ? [0.335, 0.61] : [is737(type) ? 0.3 : 0.33];
  const classic = ['b738', 'a320', 'b752', 'b763', 'a333', 'crj9', 'e175'].includes(type.id);
  let nacelleX = 0;
  if (prop) {
    const propRadius = sh.span * 0.073;
    for (const eta of engineEtas) {
      const x = eta * w.bMain;
      const a = wingAt(w, x);
      const front = a.chord * 0.74;
      const back = front + a.chord * (type.id === 'dh8d' ? 1.3 : 0.86);
      for (const side of [1, -1]) {
        addTurboprop(asm, group, fans, new THREE.Vector3(side * x, a.y - 0.3 * D, a.zLE + front), D, back, propRadius, seg, bladeMat, !gearDown);
      }
      nacelleX = x;
    }
  } else if (rear) {
    const Ln = D * 1.95;
    const x = R + 0.82 * D;
    const y = R * 0.34;
    const zFront = zAt(L * 0.705);
    for (const side of [1, -1]) {
      addTurbofan(asm, group, fans, new THREE.Vector3(side * x, y, zFront), D, Ln, seg, bladeMat, side < 0);
      // Stub pylon to the fuselage.
      const width = x - 0.35 * D - R * 0.8;
      const stub = new THREE.BoxGeometry(width, D * 0.16, Ln * 0.55);
      stub.translate(side * (R * 0.8 + width / 2), y, zFront - Ln * 0.55);
      asm.add('paint', stub);
    }
  } else {
    const Ln = D * (classic ? 1.72 : 1.56);
    for (const eta of engineEtas) {
      const x = eta * w.bMain;
      const a = wingAt(w, x);
      const lower = a.y - 0.075 * a.chord;
      const forward = is737(type) ? 0.8 : 0.64;
      const zFront = a.zLE + forward * Ln;
      let y = lower - 0.5 * D - 0.07 * D;
      // Big fans under a low wing have to be tucked up to clear the ground.
      const minClear = wide ? 0.55 : 0.45;
      if (y - 0.5 * D < groundY + minClear) y = groundY + minClear + 0.5 * D;
      for (const side of [1, -1]) {
        addTurbofan(asm, group, fans, new THREE.Vector3(side * x, y, zFront), D, Ln, seg, bladeMat, side < 0);
        // Pylon from the top of the nacelle to the wing's lower surface.
        const top = y + 0.47 * D;
        const pylon = plate(
          [[top, zFront - 0.16 * Ln], [Math.max(top + 0.02, lower + 0.07 * a.chord), a.zLE + 0.02 * a.chord], [lower + 0.01 * a.chord, a.zLE - 0.42 * a.chord], [y + 0.36 * D, zFront - 1.02 * Ln], [y + 0.3 * D, zFront - 0.75 * Ln]],
          side * x, 0.085 * D, 0.045 * D,
        );
        asm.add('nacelle', pylon);
      }
      nacelleX = Math.max(nacelleX, x);
    }
  }

  // ── Tail ──
  const tTail = sh.tail === 'T';
  const finSpan = Math.max(1.38 * sh.diameter, Math.min(2.05 * sh.diameter, 0.155 * Math.sqrt(sh.span * L))) * (tTail ? 0.9 : 1) * (sh.upperDeck === 'full' ? 1.08 : 1);
  const finRoot = finSpan * (tTail ? 0.98 : 1.02);
  const finTipChord = finSpan * (tTail ? 0.6 : 0.34);
  const finSweep = Math.tan((prop ? 33 : wide ? 44 : 41) * DEG);
  const finTE = zAt(L - 0.55 * sh.diameter);
  const finLE = finTE + finRoot;
  const sLE = (L / 2 - finLE) / L;
  const sTE = (L / 2 - finTE) / L;
  const finBase = Math.min(p.section(sLE).yTop, p.section(sTE).yTop) - 0.12 * R;
  const finStations: Station[] = [0, 0.18, 0.38, 0.58, 0.78, 0.92, 1].map((t) => ({
    x: 0, y: finBase + t * (finSpan + 0.12 * R), zLE: finLE - t * finSpan * finSweep, chord: lerp(finRoot, finTipChord, t),
    cant: Math.PI / 2, thick: lerp(0.11, 0.09, t), twist: 0, u: t,
  }));
  const finTop = finStations[finStations.length - 1];
  const planform: FinPlanform = {
    rootLE: [finLE, finBase], rootTE: [finTE, finBase],
    tipLE: [finTop.zLE, finTop.y], tipTE: [finTop.zLE - finTop.chord, finTop.y],
  };
  const finGeo = loftGeometry(finStations, nAir, 0, false, true);
  {
    // Project the fin onto its side for the tail texture.
    const m = finMapping(planform);
    const pos = finGeo.attributes.position as THREE.BufferAttribute;
    const uv = finGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (m.zMax - pos.getZ(i)) / (m.zMax - m.zMin), (pos.getY(i) - m.yMin) / (m.yMax - m.yMin));
    }
  }
  const finTex = canvasTexture(paintFin(livery, planform, high ? 1024 : 512), true);
  const fin = new THREE.Mesh(finGeo, paint('#ffffff', finTex));
  fin.castShadow = true;
  fin.name = 'fin';
  group.add(fin);
  triangles += finGeo.index!.count / 3;

  // Dorsal fillet ahead of the fin on the types that have one.
  if (is737(type) || prop || rear) {
    const len = finRoot * (prop ? 0.9 : 0.75);
    const yb = p.section((L / 2 - (finLE + len)) / L).yTop - 0.05;
    asm.add('paint', plate([[finBase + finSpan * 0.2, finLE - finSpan * 0.2 * finSweep + 0.02], [yb, finLE + len], [finBase, finLE - 0.1]], 0, 0.05, 0.09));
  }

  // Horizontal stabiliser.
  const stabSpan = sh.span * (prop ? 0.275 : tTail ? 0.33 : 0.36);
  const bh = stabSpan / 2;
  const stabRoot = stabSpan * (tTail ? 0.25 : 0.31);
  const stabTip = stabSpan * (tTail ? 0.13 : 0.11);
  const stabSweep = Math.tan((prop ? 10 : tTail ? 31 : 34) * DEG);
  let stabLE: number, stabY: number, stabDihedral: number;
  if (tTail) {
    stabLE = finTop.zLE + stabRoot * 0.12;
    stabY = finTop.y - 0.03;
    stabDihedral = prop ? 0 : -2.5 * DEG;
  } else {
    const dTE = L - 0.45 * sh.diameter;
    stabLE = zAt(dTE - stabRoot);
    const sMid = (dTE - stabRoot * 0.5) / L;
    stabY = p.section(sMid).yMid + 0.12 * R;
    stabDihedral = 6.5 * DEG;
  }
  const stabStations: Station[] = [0, 0.25, 0.5, 0.75, 0.92, 1].map((t) => ({
    x: t * bh, y: stabY + t * bh * Math.tan(stabDihedral), zLE: stabLE - t * bh * stabSweep, chord: lerp(stabRoot, stabTip, t),
    cant: stabDihedral, thick: lerp(0.1, 0.085, t), twist: 0, u: t * 0.9,
  }));
  for (const mirror of [false, true]) asm.add('wing', loftGeometry(stabStations, Math.max(5, nAir - 2), 0, mirror, true));
  if (tTail) {
    // Bullet fairing where the stabiliser sits on the fin.
    const bullet = ellipsoid(0.16 * finTipChord, 0.13 * finTipChord, 0.62 * finTipChord, 12, 8);
    bullet.translate(0, finTop.y, finTop.zLE - finTipChord * 0.42);
    asm.add('paint', bullet);
  }

  // ATR-style main gear sponsons on the fuselage sides.
  const zMain = zAt(Math.min(L * 0.62, (L / 2 - w.apexZ) + w.cr * (prop ? 0.62 : 0.72)));
  const sponson = type.id === 'at76';
  if (sponson) {
    const pod = ellipsoid(0.62, 0.52, 2.5, 12, 8);
    pod.translate(R * 0.82, p.bottom * 0.72, zMain);
    asm.addPair('paint', pod);
  }

  // ── Landing gear ──
  if (gearDown) {
    const rm = cat === 'turboprop' ? 0.42 : cat === 'regional' ? 0.47 : cat === 'narrowbody' ? 0.57 : cat === 'widebody' ? 0.66 : 0.69;
    const rn = cat === 'turboprop' ? 0.28 : cat === 'regional' ? 0.31 : cat === 'narrowbody' ? 0.38 : cat === 'widebody' ? 0.5 : 0.56;
    const wm = rm * 0.74;
    const wn = rn * 0.66;
    const wheelSeg = high ? 20 : 12;
    const addWheel = (x: number, y: number, z: number, r: number, width: number) => {
      const t = tyreGeometry(r, width, wheelSeg);
      t.translate(x, y, z);
      asm.add('tyre', t);
      const h = hubGeometry(r, width, wheelSeg);
      h.translate(x, y, z);
      asm.add('hub', h);
    };
    const leg = (top: THREE.Vector3, axleY: number, radius: number, brace: THREE.Vector3 | null) => {
      const mid = new THREE.Vector3(top.x, lerp(top.y, axleY, 0.55), top.z);
      const foot = new THREE.Vector3(top.x, axleY, top.z);
      asm.add('grey', strut(top, mid, radius, 10));
      asm.add('chrome', strut(mid, foot, radius * 0.62, 10));
      if (brace) asm.add('grey', strut(new THREE.Vector3(top.x, lerp(top.y, axleY, 0.5), top.z), brace, radius * 0.45, 8));
    };

    // Nose gear.
    const zNose = zAt(p.noseLen * (wide ? 0.74 : 0.8));
    const noseTop = p.section((L / 2 - zNose) / L).yBot + 0.25;
    const noseAxle = groundY + rn;
    leg(new THREE.Vector3(0, noseTop, zNose), noseAxle, rn * 0.3, new THREE.Vector3(0, noseTop, zNose - 1.3 * rn - 0.4));
    asm.add('grey', strut(new THREE.Vector3(-wn * 0.75, noseAxle, zNose), new THREE.Vector3(wn * 0.75, noseAxle, zNose), rn * 0.16, 8));
    for (const s of [1, -1]) addWheel(s * (wn * 0.5 + rn * 0.22), noseAxle, zNose, rn, wn);
    // Nose gear doors.
    for (const s of [1, -1]) {
      asm.add('paint', plate([[noseTop - 0.2, zNose + rn * 1.5], [noseTop - 0.2 - rn * 1.25, zNose + rn * 1.3], [noseTop - 0.2 - rn * 1.25, zNose - rn * 0.8], [noseTop - 0.2, zNose - rn * 1.0]], s * (rn * 0.95 + 0.1), 0.02));
    }

    // Main gear.
    const dh8 = type.id === 'dh8d';
    let track = Math.min(0.09 * sh.span, 6.0);
    if (sponson) track = R * 0.82 + 0.35;
    else if (dh8) track = nacelleX;
    else if (rear) track = 0.085 * sh.span;
    const axleCount = !wide ? 1 : type.id === 'b77w' || type.id === 'b779' ? 3 : 2;
    const axleGap = rm * 2.3;
    const mainLeg = (x: number, z: number, topY: number, axles: number) => {
      const axleY = groundY + rm;
      for (const s of [1, -1]) {
        const top = new THREE.Vector3(s * x, topY, z);
        leg(top, axleY + (axles > 1 ? rm * 0.35 : 0), rm * 0.26, sponson || dh8 ? null : new THREE.Vector3(s * Math.max(0.2, x - 1.4 * rm - 0.5), topY, z));
        if (axles > 1) {
          // Bogie beam.
          const half = ((axles - 1) * axleGap) / 2;
          asm.add('grey', strut(new THREE.Vector3(s * x, axleY + rm * 0.05, z + half), new THREE.Vector3(s * x, axleY + rm * 0.05, z - half), rm * 0.2, 8));
        }
        for (let a = 0; a < axles; a++) {
          const za = z + (axles > 1 ? ((axles - 1) / 2 - a) * axleGap : 0);
          asm.add('grey', strut(new THREE.Vector3(s * x - wm * 0.9, axleY, za), new THREE.Vector3(s * x + wm * 0.9, axleY, za), rm * 0.15, 8));
          for (const o of [1, -1]) addWheel(s * x + o * (wm * 0.5 + rm * 0.2), axleY, za, rm, wm);
        }
        // Gear door hanging outboard of the leg.
        if (!sponson && !dh8) {
          asm.add('paint', plate([[topY, z + rm * 1.1], [topY - (topY - axleY) * 0.55, z + rm * 0.9], [topY - (topY - axleY) * 0.55, z - rm * 0.9], [topY, z - rm * 1.1]], s * (x + wm + rm * 0.45), 0.02));
        }
      }
    };
    let legTop: number;
    if (sponson) legTop = p.bottom * 0.72 - 0.2;
    else if (dh8) legTop = wingAt(w, track).y - 0.3 * D - 0.5 * D;
    else legTop = wingAt(w, track).y - 0.06 * wingAt(w, track).chord;
    mainLeg(track, zMain, legTop, axleCount);
    if (cat === 'jumbo') {
      // Body gear under the fuselage, a little further aft.
      const full = sh.upperDeck === 'full';
      mainLeg(full ? R * 0.62 : R * 0.56, zMain - rm * 4.6, p.bottom * 0.86, full ? 3 : 2);
    }
  }

  // Blade antennas along the spine and the keel.
  for (const [d, up] of [[0.21, 1], [0.6, 1], [0.27, -1], [0.7, -1]] as [number, number][]) {
    const sec = p.section(d);
    const y0 = up > 0 ? sec.yTop - 0.03 : sec.yBot + 0.03;
    const hgt = (0.2 + 0.025 * R) * up;
    const z = zAt(L * d);
    asm.add('paint', plate([[y0, z + 0.2], [y0 + hgt, z - 0.08], [y0 + hgt, z - 0.18], [y0, z - 0.18]], 0, 0.016));
  }

  // ── Lights ──
  const lamps: Lamp[] = [];
  const lampSize = Math.max(0.5, Math.min(1.5, sh.span / 40));
  const addLamp = (x: number, y: number, z: number, color: number, mode: string, phase: number, scale = 1) => {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06 * lampSize * scale, 8, 6), new THREE.MeshBasicMaterial({ color }));
    bulb.position.set(x, y, z);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightHalo(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.set(x, y, z);
    const size = 0.85 * lampSize * scale;
    sprite.scale.setScalar(size);
    group.add(bulb, sprite);
    lamps.push({ sprite, bulb, mode, phase, size });
  };
  addLamp(tipLampX, tipLampY, tipLampZ + 0.1, 0xff2a22, 'steady', 0);
  addLamp(-tipLampX, tipLampY, tipLampZ + 0.1, 0x22ff55, 'steady', 0);
  addLamp(tipLampX, tipLampY, tipLampZ - 0.25, 0xffffff, 'strobe', 0, 1.5);
  addLamp(-tipLampX, tipLampY, tipLampZ - 0.25, 0xffffff, 'strobe', 0, 1.5);
  addLamp(0, (tailSec.yTop + tailSec.yBot) / 2, -L / 2 - 0.05, 0xffffff, 'strobe', 0.5, 1.2);
  addLamp(0, p.section(0.42).yTop + 0.07, zAt(L * 0.42), 0xff2a22, 'beacon', 0, 1.3);
  addLamp(0, p.bottom - (w.high ? 0.07 : R * 0.32), zAt(L * 0.5), 0xff2a22, 'beacon', 0.5, 1.3);

  triangles += asm.build(materials, group);
  for (const f of fans) {
    f.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
  }

  // ── Animation ──
  const running = !gearDown;
  const update = (dt: number, time: number): void => {
    for (const f of fans) {
      const rate = running ? f.run : f.idle;
      if (rate) f.object.rotation.z += rate * dt;
    }
    for (const lamp of lamps) {
      let on = 1;
      if (lamp.mode === 'strobe') {
        const ph = (time + lamp.phase * 1.3) % 1.3;
        on = ph < 0.06 || (ph > 0.16 && ph < 0.22) ? 1 : 0;
      } else if (lamp.mode === 'beacon') {
        const ph = (time + lamp.phase * 1.1) % 1.1;
        on = ph < 0.13 ? 1 : 0;
      }
      lamp.sprite.visible = on > 0;
      lamp.bulb.visible = lamp.mode === 'steady' || on > 0;
    }
  };
  update(0, 0);

  const finTopY = finTop.y;
  group.userData = {
    groundY,
    length: L,
    span: sh.span,
    height: finTopY - groundY,
    top: finTopY,
    triangles: Math.round(triangles),
    buildMs: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
    update,
  };
  return group;
}

/** Frees every GPU resource owned by a model built with buildAircraftModel. */
export function disposeAircraftModel(group: THREE.Group): void {
  const seen = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // (Sprites share one built-in geometry: leave it alone.)
    if (mesh.geometry && !(o as THREE.Sprite).isSprite) mesh.geometry.dispose();
    const mat = (o as THREE.Mesh | THREE.Sprite).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (seen.has(m)) continue;
      seen.add(m);
      const map = (m as THREE.MeshStandardMaterial).map;
      // The light halo is shared between models; everything else belongs to this one.
      if (map && map !== haloTexture) map.dispose();
      m.dispose();
    }
  });
  group.clear();
}
