// Layers drawn on top of the planet: coastlines and borders, airports, route
// arcs and the aircraft flying along them.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { AIRPORT, AIRPORTS } from '../sim/data/airports';
import { latLonToVec } from '../sim/geo';
import type { Aircraft, AirportId, Route } from '../sim/types';
import type { Sim } from '../sim/sim';
import { arcPoint, arcPositions, ringPositions } from './arcs';

// ───────────────────────── Borders ─────────────────────────

export class BorderLayer {
  readonly group = new THREE.Group();
  private coast: THREE.LineSegments | null = null;
  private borders: THREE.LineSegments | null = null;

  async load(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) return;
    const view = new DataView(await res.arrayBuffer());
    const coastCount = view.getUint32(4, true);
    const borderCount = view.getUint32(8, true);
    let o = 12;
    const read = (count: number): Float32Array => {
      const segs: number[] = [];
      for (let l = 0; l < count; l++) {
        const n = view.getUint16(o, true);
        o += 2;
        let prev: [number, number, number] | null = null;
        for (let i = 0; i < n; i++) {
          const lon = (view.getInt16(o, true) / 65536) * 360;
          const lat = (view.getInt16(o + 2, true) / 65536) * 360;
          o += 4;
          const p = latLonToVec(lat, lon);
          if (prev) segs.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]);
          prev = p;
        }
      }
      return new Float32Array(segs);
    };
    const make = (positions: Float32Array, color: number): THREE.LineSegments => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
      const lines = new THREE.LineSegments(geo, mat);
      lines.scale.setScalar(1.0012);
      lines.renderOrder = 3;
      return lines;
    };
    this.coast = make(read(coastCount), 0xbfe3ff);
    this.borders = make(read(borderCount), 0xffffff);
    this.group.add(this.coast, this.borders);
  }

  /** Lines fade in as the camera approaches, where the imagery gets soft. */
  update(altitude: number, enabled: boolean, gain = 1): void {
    if (!this.coast || !this.borders) return;
    const near = 1 - THREE.MathUtils.smoothstep(altitude, 0.5, 2.6);
    (this.coast.material as THREE.LineBasicMaterial).opacity = enabled ? (0.1 + 0.3 * near) * gain : 0;
    (this.borders.material as THREE.LineBasicMaterial).opacity = enabled ? (0.05 + 0.3 * near) * gain : 0;
    this.group.visible = enabled;
  }
}

// ───────────────────────── Airports ─────────────────────────

const AIRPORT_VERT = /* glsl */ `
attribute float size;
attribute vec4 tint;
attribute float ring;
uniform float pixelRatio;
varying vec4 vTint;
varying float vRing;
void main() {
  vTint = tint;
  vRing = ring;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * pixelRatio;
}
`;

const AIRPORT_FRAG = /* glsl */ `
varying vec4 vTint;
varying float vRing;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a;
  if (vRing > 0.5) {
    // A solid core inside a thin ring marks a base.
    float core = smoothstep(0.5, 0.36, r);
    float band = smoothstep(0.62, 0.72, r) * smoothstep(1.0, 0.9, r);
    a = max(core, band);
  } else {
    a = smoothstep(1.0, 0.62, r);
  }
  gl_FragColor = vec4(vTint.rgb, vTint.a * a);
}
`;

export interface AirportStyle {
  /** Airports the player flies to. */
  served: Set<AirportId>;
  /** Player bases and their level. */
  hubs: Map<AirportId, number>;
  selected: AirportId | null;
  /** Airports to emphasise (e.g. reachable destinations while planning a route). */
  highlight: Map<AirportId, number> | null;
  accent: THREE.Color;
}

export class AirportLayer {
  readonly points: THREE.Points;
  private sizes: Float32Array;
  private tints: Float32Array;
  private rings: Float32Array;
  private material: THREE.ShaderMaterial;
  /** Final on-screen radius in CSS pixels per airport (0 = hidden), for picking and labels. */
  readonly radius: Float32Array;

  constructor() {
    const n = AIRPORTS.length;
    const positions = new Float32Array(n * 3);
    for (const a of AIRPORTS) {
      positions[a.index * 3] = a.pos[0] * 1.0018;
      positions[a.index * 3 + 1] = a.pos[1] * 1.0018;
      positions[a.index * 3 + 2] = a.pos[2] * 1.0018;
    }
    this.sizes = new Float32Array(n);
    this.tints = new Float32Array(n * 4);
    this.rings = new Float32Array(n);
    this.radius = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tints, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('ring', new THREE.BufferAttribute(this.rings, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { pixelRatio: { value: 1 } },
      vertexShader: AIRPORT_VERT,
      fragmentShader: AIRPORT_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.renderOrder = 6;
    this.points.frustumCulled = false;
  }

  update(style: AirportStyle, altitude: number, pixelRatio: number): void {
    this.material.uniforms.pixelRatio.value = pixelRatio;
    // Small airports only appear once the camera is close enough to tell them apart.
    const zoom = 1 - THREE.MathUtils.smoothstep(altitude, 0.4, 3.2);
    for (const a of AIRPORTS) {
      const i = a.index;
      let size = 0;
      let r = 0.75, g = 0.86, b = 1.0, alpha = 0;
      let ring = 0;
      const hub = style.hubs.get(a.id);
      const boost = style.highlight?.get(a.id);
      if (hub) {
        size = 13 + hub * 2.5;
        r = 1.0; g = 0.82; b = 0.36; alpha = 1; ring = 1;
      } else if (style.served.has(a.id)) {
        size = 8.5 + a.tier * 0.5;
        r = style.accent.r; g = style.accent.g; b = style.accent.b; alpha = 1;
      } else {
        const visible = THREE.MathUtils.clamp((a.tier - 1) / 4 + zoom * 1.25 - 0.25, 0, 1);
        size = (2.6 + a.tier * 0.95) * (0.75 + 0.5 * zoom);
        alpha = visible * (0.38 + 0.1 * a.tier);
      }
      if (boost !== undefined) {
        size = Math.max(size, 6 + boost * 9);
        if (!hub) { r = 0.55 + 0.45 * (1 - boost); g = 1.0; b = 0.75; }
        alpha = Math.max(alpha, 0.55 + 0.45 * boost);
      } else if (style.highlight && !hub) {
        alpha *= 0.35;
      }
      if (style.selected === a.id) {
        size += 6;
        r = g = b = 1.25; alpha = 1; ring = 1;
      }
      this.sizes[i] = size;
      this.rings[i] = ring;
      this.tints[i * 4] = r;
      this.tints[i * 4 + 1] = g;
      this.tints[i * 4 + 2] = b;
      this.tints[i * 4 + 3] = alpha;
      this.radius[i] = alpha > 0.05 ? size / 2 : 0;
    }
    const geo = this.points.geometry;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.tint.needsUpdate = true;
    geo.attributes.ring.needsUpdate = true;
  }
}

// ───────────────────────── Routes ─────────────────────────

export type RouteColorMode = 'brand' | 'profit' | 'load';

function segmentsFor(routes: Route[], color: (r: Route) => THREE.Color): { positions: Float32Array; colors: Float32Array } {
  const pos: number[] = [];
  const col: number[] = [];
  for (const r of routes) {
    const pts = arcPositions(AIRPORT[r.a].pos, AIRPORT[r.b].pos, r.dist);
    const c = color(r);
    for (let i = 0; i + 3 < pts.length; i += 3) {
      pos.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

const GOOD = new THREE.Color(0x4ade80);
const POOR = new THREE.Color(0xf87171);
const EVEN = new THREE.Color(0xfbbf24);

/** Red → amber → green for a value in -1..1. */
export function rampColor(v: number, out = new THREE.Color()): THREE.Color {
  const t = THREE.MathUtils.clamp(v, -1, 1);
  return t < 0 ? out.copy(EVEN).lerp(POOR, -t) : out.copy(EVEN).lerp(GOOD, t);
}

export class RouteLayer {
  readonly group = new THREE.Group();
  private player: LineSegments2;
  private rivals: LineSegments2;
  private highlight: Line2;
  private preview: Line2;
  private range: Line2;
  private materials: LineMaterial[] = [];
  private dashOffset = 0;

  constructor() {
    const mat = (opts: ConstructorParameters<typeof LineMaterial>[0]): LineMaterial => {
      const m = new LineMaterial({ transparent: true, depthWrite: false, worldUnits: false, ...opts });
      this.materials.push(m);
      return m;
    };
    this.rivals = new LineSegments2(new LineSegmentsGeometry(), mat({ vertexColors: true, linewidth: 1, opacity: 0.22 }));
    this.player = new LineSegments2(new LineSegmentsGeometry(), mat({ vertexColors: true, linewidth: 2.1, opacity: 0.95 }));
    this.highlight = new Line2(new LineGeometry(), mat({ color: 0xffffff, linewidth: 3.6, opacity: 1 }));
    this.preview = new Line2(new LineGeometry(), mat({ color: 0xffffff, linewidth: 2.6, opacity: 0.95, dashed: true, dashSize: 0.012, gapSize: 0.008 }));
    this.range = new Line2(new LineGeometry(), mat({ color: 0x7dd3fc, linewidth: 1.4, opacity: 0.55, dashed: true, dashSize: 0.02, gapSize: 0.014 }));
    this.rivals.renderOrder = 4;
    this.player.renderOrder = 5;
    this.range.renderOrder = 5;
    this.highlight.renderOrder = 7;
    this.preview.renderOrder = 7;
    for (const o of [this.rivals, this.player, this.highlight, this.preview, this.range]) {
      o.visible = false;
      o.frustumCulled = false;
      this.group.add(o);
    }
  }

  setResolution(width: number, height: number): void {
    for (const m of this.materials) m.resolution.set(width, height);
  }

  setPlayerRoutes(routes: Route[], color: (r: Route) => THREE.Color): void {
    this.fill(this.player, routes, color);
  }

  setRivalRoutes(routes: Route[], color: (r: Route) => THREE.Color): void {
    this.fill(this.rivals, routes, color);
  }

  private fill(obj: LineSegments2, routes: Route[], color: (r: Route) => THREE.Color): void {
    obj.visible = routes.length > 0;
    if (!routes.length) return;
    const { positions, colors } = segmentsFor(routes, color);
    // Instanced buffers cannot grow in place: swap in a fresh geometry.
    obj.geometry.dispose();
    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);
    geo.setColors(colors);
    obj.geometry = geo;
  }

  private setLine(obj: Line2, positions: Float32Array | null): void {
    obj.visible = !!positions;
    if (!positions) return;
    obj.geometry.dispose();
    const geo = new LineGeometry();
    geo.setPositions(positions);
    obj.geometry = geo;
    obj.computeLineDistances();
  }

  setHighlight(a: AirportId | null, b: AirportId | null, dist = 0): void {
    this.setLine(this.highlight, a && b ? arcPositions(AIRPORT[a].pos, AIRPORT[b].pos, dist, 96) : null);
  }

  setPreview(a: AirportId | null, b: AirportId | null, dist = 0, ok = true): void {
    this.setLine(this.preview, a && b ? arcPositions(AIRPORT[a].pos, AIRPORT[b].pos, dist, 96) : null);
    (this.preview.material as LineMaterial).color.set(ok ? 0xffffff : 0xf87171);
  }

  /** Circle showing how far an aircraft can fly from an airport. */
  setRange(centre: AirportId | null, rangeKm = 0): void {
    this.setLine(this.range, centre ? ringPositions(AIRPORT[centre].pos, Math.min(Math.PI * 0.995, rangeKm / 6371), 1.003, 240) : null);
  }

  update(dt: number): void {
    // March the dashes along the planned route.
    this.dashOffset -= dt * 0.03;
    (this.preview.material as LineMaterial).dashOffset = this.dashOffset;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const o of [this.rivals, this.player, this.highlight, this.preview, this.range]) o.geometry.dispose();
  }
}

// ───────────────────────── Traffic ─────────────────────────

/** A compact airliner silhouette, one unit long, nose towards +Z. */
function planeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], b: number[], c: number[], shade: number) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(shade, shade, shade);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], shade: number) => {
    tri(a, b, c, shade);
    tri(a, c, d, shade);
  };
  // Fuselage: a six-sided spindle.
  const w = 0.05;
  const stations = [
    { z: 0.5, r: 0.0 }, { z: 0.4, r: w * 0.8 }, { z: 0.2, r: w }, { z: -0.25, r: w }, { z: -0.5, r: w * 0.25 },
  ];
  const sides = 6;
  for (let s = 0; s < stations.length - 1; s++) {
    const a = stations[s];
    const b = stations[s + 1];
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      const shade = 0.72 + 0.28 * Math.max(0, Math.sin((t0 + t1) / 2));
      quad(
        [Math.cos(t0) * a.r, Math.sin(t0) * a.r, a.z], [Math.cos(t1) * a.r, Math.sin(t1) * a.r, a.z],
        [Math.cos(t1) * b.r, Math.sin(t1) * b.r, b.z], [Math.cos(t0) * b.r, Math.sin(t0) * b.r, b.z], shade,
      );
    }
  }
  for (const side of [-1, 1]) {
    // Swept main wing.
    quad([side * 0.04, 0, 0.14], [side * 0.5, 0.01, -0.13], [side * 0.5, 0.01, -0.2], [side * 0.04, 0, -0.1], 0.86);
    // Tailplane.
    quad([side * 0.02, 0.01, -0.36], [side * 0.19, 0.015, -0.47], [side * 0.19, 0.015, -0.5], [side * 0.02, 0.01, -0.46], 0.8);
  }
  // Fin.
  quad([0, 0.03, -0.3], [0, 0.2, -0.47], [0, 0.2, -0.52], [0, 0.03, -0.49], 0.66);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export interface TrafficHit {
  aircraft: Aircraft;
  x: number;
  y: number;
}

const MAX_PLANES = 4096;

export class TrafficLayer {
  readonly group = new THREE.Group();
  private planes: THREE.InstancedMesh;
  private trails: THREE.Mesh;
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  /** Aircraft drawn this frame, parallel to `shown*` arrays. */
  private shown: Aircraft[] = [];
  private shownPos = new Float32Array(MAX_PLANES * 3);
  private count = 0;
  showRivals = true;
  /** Aircraft to draw larger and brighter. */
  selected: number | null = null;
  /** Aircraft not to draw as an icon (a detailed model takes its place). */
  hidden: number | null = null;

  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();
  private right = new THREE.Vector3();
  private side = new THREE.Vector3();
  private view = new THREE.Vector3();
  private color = new THREE.Color();

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.planes = new THREE.InstancedMesh(planeGeometry(), mat, MAX_PLANES);
    this.planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.planes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLANES * 3), 3);
    this.planes.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.planes.count = 0;
    this.planes.frustumCulled = false;
    this.planes.renderOrder = 8;

    this.trailPos = new Float32Array(MAX_PLANES * 12);
    this.trailCol = new Float32Array(MAX_PLANES * 12);
    const index = new Uint32Array(MAX_PLANES * 6);
    for (let i = 0; i < MAX_PLANES; i++) {
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    this.trails = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 7;
    this.group.add(this.trails, this.planes);
  }

  /**
   * Places every airborne aircraft on its flight path.
   * @param time game time in minutes (with sub-minute precision)
   */
  update(sim: Sim, time: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    const list = sim.game.aircraft;
    const m = this.planes.instanceMatrix.array as Float32Array;
    const colors = this.planes.instanceColor!.array as Float32Array;
    const camPos = camera.position;
    // World size of one CSS pixel at unit distance.
    const pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
    const playerColor = sim.player.livery.primary;
    this.color.set(playerColor);
    // Lift dark brand colours so the icon stays readable on the night side.
    const hsl = { h: 0, s: 0, l: 0 };
    this.color.getHSL(hsl);
    this.color.setHSL(hsl.h, Math.min(1, hsl.s * 0.6), Math.max(0.78, hsl.l));
    const pr = this.color.r, pg = this.color.g, pb = this.color.b;
    // From far away the background traffic shrinks and dims so the player's fleet stands out.
    const far = THREE.MathUtils.smoothstep(camPos.length() - 1, 0.9, 3.4);
    const rivalPx = THREE.MathUtils.lerp(13, 7.5, far);
    const rivalGain = THREE.MathUtils.lerp(1, 0.62, far);

    let n = 0;
    this.shown.length = 0;
    for (let i = 0; i < list.length && n < MAX_PLANES; i++) {
      const ac = list[i];
      const leg = ac.leg;
      if (!leg || ac.phase !== 'enroute') continue;
      const mine = ac.airline === 0;
      if (!mine && !this.showRivals) continue;
      if (ac.id === this.hidden) continue;
      const span = leg.arr - leg.dep;
      const t = (time - leg.dep) / span;
      if (t < 0 || t > 1) continue;
      const a = AIRPORT[leg.from];
      const b = AIRPORT[leg.to];
      const dist = sim.routeById.get(leg.route)?.dist ?? distOf(a.pos, b.pos);
      arcPoint(a.pos, b.pos, t, dist, this.p);
      const dtFwd = 0.004;
      if (t + dtFwd <= 1) {
        arcPoint(a.pos, b.pos, t + dtFwd, dist, this.q);
        this.fwd.subVectors(this.q, this.p).normalize();
      } else {
        arcPoint(a.pos, b.pos, t - dtFwd, dist, this.q);
        this.fwd.subVectors(this.p, this.q).normalize();
      }
      this.up.copy(this.p).normalize();
      this.right.crossVectors(this.up, this.fwd).normalize();
      this.up.crossVectors(this.fwd, this.right);

      const camDist = this.p.distanceTo(camPos);
      const selected = ac.id === this.selected;
      // Constant size on screen, a little larger for the player's own fleet.
      const px = (mine ? 21 : rivalPx) * (selected ? 1.5 : 1);
      const s = px * pixel * camDist;
      const o = n * 16;
      m[o] = this.right.x * s; m[o + 1] = this.right.y * s; m[o + 2] = this.right.z * s; m[o + 3] = 0;
      m[o + 4] = this.up.x * s; m[o + 5] = this.up.y * s; m[o + 6] = this.up.z * s; m[o + 7] = 0;
      m[o + 8] = this.fwd.x * s; m[o + 9] = this.fwd.y * s; m[o + 10] = this.fwd.z * s; m[o + 11] = 0;
      m[o + 12] = this.p.x; m[o + 13] = this.p.y; m[o + 14] = this.p.z; m[o + 15] = 1;

      const c = n * 3;
      let r = 0.5 * rivalGain, g = 0.58 * rivalGain, bl = 0.72 * rivalGain;
      if (mine) { r = pr * 1.15; g = pg * 1.15; bl = pb * 1.15; }
      if (selected) { r = 1.6; g = 1.6; bl = 1.6; }
      colors[c] = r; colors[c + 1] = g; colors[c + 2] = bl;

      // Contrail: a tapering streak behind the aircraft, facing the camera.
      const trailLen = s * (mine ? 3.2 : 2.4);
      this.view.subVectors(camPos, this.p).normalize();
      this.side.crossVectors(this.fwd, this.view).normalize().multiplyScalar(s * 0.07);
      const tp = n * 12;
      const tail = this.q.copy(this.p).addScaledVector(this.fwd, -trailLen - s * 0.45);
      const head = this.p.clone().addScaledVector(this.fwd, -s * 0.45);
      const tpos = this.trailPos;
      tpos[tp] = tail.x; tpos[tp + 1] = tail.y; tpos[tp + 2] = tail.z;
      tpos[tp + 3] = tail.x; tpos[tp + 4] = tail.y; tpos[tp + 5] = tail.z;
      tpos[tp + 6] = head.x - this.side.x; tpos[tp + 7] = head.y - this.side.y; tpos[tp + 8] = head.z - this.side.z;
      tpos[tp + 9] = head.x + this.side.x; tpos[tp + 10] = head.y + this.side.y; tpos[tp + 11] = head.z + this.side.z;
      const k = mine ? 0.5 : 0.22;
      const tc = this.trailCol;
      tc[tp] = tc[tp + 1] = tc[tp + 2] = tc[tp + 3] = tc[tp + 4] = tc[tp + 5] = 0;
      tc[tp + 6] = tc[tp + 9] = r * k; tc[tp + 7] = tc[tp + 10] = g * k; tc[tp + 8] = tc[tp + 11] = bl * k;

      this.shownPos[n * 3] = this.p.x; this.shownPos[n * 3 + 1] = this.p.y; this.shownPos[n * 3 + 2] = this.p.z;
      this.shown.push(ac);
      n++;
    }
    this.count = n;
    this.planes.count = n;
    this.planes.instanceMatrix.needsUpdate = true;
    this.planes.instanceColor!.needsUpdate = true;
    const geo = this.trails.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, n * 6);
  }

  /** Current position of an aircraft on its flight path, if it is airborne. */
  positionOf(sim: Sim, ac: Aircraft, time: number, out: THREE.Vector3, forward?: THREE.Vector3): boolean {
    const leg = ac.leg;
    if (!leg || ac.phase !== 'enroute') return false;
    const t = THREE.MathUtils.clamp((time - leg.dep) / (leg.arr - leg.dep), 0, 1);
    const a = AIRPORT[leg.from];
    const b = AIRPORT[leg.to];
    const dist = sim.routeById.get(leg.route)?.dist ?? distOf(a.pos, b.pos);
    arcPoint(a.pos, b.pos, t, dist, out);
    if (forward) {
      const e = 0.004;
      const tmp = new THREE.Vector3();
      if (t + e <= 1) forward.subVectors(arcPoint(a.pos, b.pos, t + e, dist, tmp), out).normalize();
      else forward.subVectors(out, arcPoint(a.pos, b.pos, t - e, dist, tmp)).normalize();
    }
    return true;
  }

  /** Nearest aircraft to a screen position, within `maxPx`. */
  pick(x: number, y: number, camera: THREE.Camera, width: number, height: number, maxPx: number, playerOnly = false): TrafficHit | null {
    let best: TrafficHit | null = null;
    let bestD = maxPx * maxPx;
    const v = new THREE.Vector3();
    const camPos = camera.position;
    for (let i = 0; i < this.count; i++) {
      const ac = this.shown[i];
      if (playerOnly && ac.airline !== 0) continue;
      v.set(this.shownPos[i * 3], this.shownPos[i * 3 + 1], this.shownPos[i * 3 + 2]);
      // Skip aircraft hidden behind the planet.
      if (occluded(v, camPos)) continue;
      v.project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * width;
      const sy = (-v.y * 0.5 + 0.5) * height;
      // The player's own aircraft are easier to hit than the background traffic.
      const d = ((sx - x) ** 2 + (sy - y) ** 2) * (ac.airline === 0 ? 0.45 : 1);
      if (d < bestD) {
        bestD = d;
        best = { aircraft: ac, x: sx, y: sy };
      }
    }
    return best;
  }

  get airborne(): number {
    return this.count;
  }

  dispose(): void {
    this.planes.geometry.dispose();
    (this.planes.material as THREE.Material).dispose();
    this.trails.geometry.dispose();
    (this.trails.material as THREE.Material).dispose();
  }
}

function distOf(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) * 6371;
}

/** True when the segment from the camera to a point above the surface passes through the planet. */
export function occluded(point: THREE.Vector3, camPos: THREE.Vector3): boolean {
  const dx = point.x - camPos.x, dy = point.y - camPos.y, dz = point.z - camPos.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = -(camPos.x * dx + camPos.y * dy + camPos.z * dz) / len2;
  if (t <= 0 || t >= 1) return false;
  const cx = camPos.x + dx * t, cy = camPos.y + dy * t, cz = camPos.z + dz * t;
  return cx * cx + cy * cy + cz * cz < 0.985;
}
