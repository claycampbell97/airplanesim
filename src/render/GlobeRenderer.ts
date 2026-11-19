// Orchestrates the 3D world view: the planet, the sky and everything drawn on top.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AIRPORT, AIRPORTS, airportDistance } from '../sim/data/airports';
import { vecToLatLon } from '../sim/geo';
import type { Sim } from '../sim/sim';
import type { Aircraft, AirportId, Route } from '../sim/types';
import { arcPoint } from './arcs';
import { gmstDegrees, sunDirection } from './astro';
import { GlobeCamera } from './camera';
import { ChaseView } from './chase';
import { Earth } from './earth';
import { LabelLayer } from './labels';
import type { LabelSpec } from './labels';
import { AirportLayer, BorderLayer, occluded, rampColor, RouteLayer, TrafficLayer } from './layers';
import type { RouteColorMode } from './layers';
import { Sky } from './sky';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

interface QualityPreset {
  pixelRatio: number;
  textures: '2k' | '4k';
  viewSteps: number;
  lightSteps: number;
  bloom: boolean;
  segments: number;
  stars: number;
  msaa: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, textures: '2k', viewSteps: 6, lightSteps: 2, bloom: false, segments: 96, stars: 2500, msaa: 0 },
  medium: { pixelRatio: 1.25, textures: '4k', viewSteps: 8, lightSteps: 3, bloom: true, segments: 128, stars: 4500, msaa: 2 },
  high: { pixelRatio: 1.75, textures: '4k', viewSteps: 12, lightSteps: 4, bloom: true, segments: 192, stars: 7000, msaa: 4 },
  ultra: { pixelRatio: 2.5, textures: '4k', viewSteps: 16, lightSteps: 5, bloom: true, segments: 256, stars: 10000, msaa: 4 },
};

/** The automatic resolution scaling never goes below this fraction of the chosen quality. */
const MIN_SCALE = 0.45;

export type SunMode = 'real' | 'studio';

export type GlobeHit =
  | { kind: 'airport'; id: AirportId; x: number; y: number }
  | { kind: 'aircraft'; id: number; x: number; y: number }
  | { kind: 'route'; id: number; x: number; y: number };

export interface GlobeLayers {
  borders: boolean;
  labels: boolean;
  clouds: boolean;
  /** Other airlines' aircraft. */
  rivalTraffic: boolean;
  /** Other airlines' route lines (only those touching the selected airport unless `allRivalRoutes`). */
  rivalRoutes: boolean;
}

export interface Planning {
  from: AirportId;
  to: AirportId | null;
  /** Range of the aircraft being planned for, km (0 = no ring). */
  rangeKm: number;
  /** Whether the hovered destination is valid. */
  ok: boolean;
  /** Destinations to emphasise, with a 0..1 strength (e.g. relative demand). */
  candidates: Map<AirportId, number> | null;
}

function loadTexture(url: string, srgb: boolean, onDone: () => void): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        onDone();
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`Could not load ${url}`)),
    );
  });
}

export class GlobeRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly controls: GlobeCamera;
  quality: Quality;
  sunMode: SunMode = 'real';
  /** Unit vector towards the sun in the Earth-fixed frame. */
  readonly sun = new THREE.Vector3(1, 0, 0);
  readonly layers: GlobeLayers = { borders: true, labels: true, clouds: true, rivalTraffic: true, rivalRoutes: false };
  colorMode: RouteColorMode = 'brand';

  earth: Earth | null = null;
  sky: Sky | null = null;
  readonly borders = new BorderLayer();
  readonly airports = new AirportLayer();
  readonly routes = new RouteLayer();
  readonly traffic = new TrafficLayer();

  onPick: ((hit: GlobeHit | null, event: PointerEvent) => void) | null = null;
  onHover: ((hit: GlobeHit | null) => void) | null = null;
  /** Called when the flight view ends by itself because the aircraft landed. */
  onChaseEnd: ((aircraftId: number) => void) | null = null;
  private chase: ChaseView | null = null;

  private sim: Sim | null = null;
  private labels: LabelLayer | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private textures: THREE.Texture[] = [];
  private studioBlend = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private tmpSun = new THREE.Vector3();
  private tmpStudio = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private v = new THREE.Vector3();

  // View state driven by the UI.
  private selectedAirport: AirportId | null = null;
  private selectedRoute: number | null = null;
  private planning: Planning | null = null;
  private following: number | null = null;
  private lastRevision = -1;
  private styleDirty = true;
  private accent = new THREE.Color('#5eead4');
  private served = new Set<AirportId>();
  private hubs = new Map<AirportId, number>();
  private hover: GlobeHit | null = null;
  private frameCount = 0;
  private time = 0;
  private skyFade = 0;

  /** Lower the render resolution automatically when frames take too long. */
  adaptive = true;
  private scale = 1;
  private frameMs = 16;
  private slowFor = 0;
  private smoothFor = 0;
  private sinceSharpen = 60;
  private retryAfter = 10;

  constructor(canvas: HTMLCanvasElement, quality: Quality, labelRoot?: HTMLElement) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.controls = new GlobeCamera(canvas, 1);
    if (labelRoot) this.labels = new LabelLayer(labelRoot);

    this.scene.add(this.borders.group, this.routes.group, this.airports.points, this.traffic.group);

    this.controls.onClick = (x, y, e) => this.onPick?.(this.pick(x, y), e);
    this.controls.onHover = (x, y) => {
      const hit = x < 0 ? null : this.pick(x, y);
      if (!sameHit(hit, this.hover)) {
        this.hover = hit;
        this.canvas.style.cursor = hit ? 'pointer' : '';
        this.onHover?.(hit);
      }
    };
    this.controls.onUserMove = () => {
      this.following = null;
    };
    this.controls.onFreeDrag = (dx, dy) => this.chase?.orbit(dx, dy);
    this.controls.onFreeZoom = (factor) => this.chase?.zoom(factor);
  }

  /** Loads textures and builds the scene. `onProgress` receives 0..1. */
  async load(onProgress?: (p: number) => void): Promise<void> {
    const q = QUALITY[this.quality];
    const base = import.meta.env.BASE_URL;
    let done = 0;
    const tick = () => onProgress?.(++done / 5);
    const [day, night, aux, stars] = await Promise.all([
      loadTexture(`${base}textures/earth_day_${q.textures}.jpg`, true, tick),
      loadTexture(`${base}textures/earth_night_${q.textures}.jpg`, true, tick),
      loadTexture(`${base}textures/earth_aux_${q.textures}.jpg`, false, tick),
      loadTexture(`${base}textures/stars_${q.textures}.jpg`, true, tick),
      this.borders.load(`${base}data/borders.bin`).then(tick, tick),
    ]);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const t of [day, night, aux]) t.anisotropy = aniso;
    this.textures = [day, night, aux, stars];

    this.earth = new Earth({ day, night, aux }, { viewSteps: q.viewSteps, lightSteps: q.lightSteps, segments: q.segments });
    this.scene.add(this.earth.group);
    this.sky = new Sky(stars, q.stars);
    this.scene.add(this.sky.group, this.sky.sun);
    this.buildComposer();
    this.resize();
  }

  private buildComposer(): void {
    const q = QUALITY[this.quality];
    const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.controls.camera));
    this.chase ??= new ChaseView(this.renderer);
    this.composer.addPass(this.chase.pass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.34, 0.55, 1.0);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Matches the drawing buffer to the canvas' CSS size. Call on layout changes. */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].pixelRatio) * this.scale;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(w, h);
    this.controls.resize(w, h);
    this.chase?.resize(w / h);
    this.routes.setResolution(w, h);
  }

  /**
   * Dynamic resolution: on a GPU that cannot keep up, a slightly softer image
   * beats a slide show. Sharpness is given back, cautiously, when there is room.
   */
  private adapt(dt: number): void {
    if (!this.adaptive || document.hidden) return;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;
    this.sinceSharpen += dt;
    if (this.frameMs > 27) {
      this.slowFor += dt;
      this.smoothFor = 0;
    } else {
      this.slowFor = 0;
      this.smoothFor = this.frameMs < 19 ? this.smoothFor + dt : 0;
    }
    let next = this.scale;
    if (this.slowFor > 1.5 && this.scale > MIN_SCALE) {
      next = Math.max(MIN_SCALE, this.scale * 0.8);
      // The last attempt to sharpen did not hold: wait longer before the next one.
      if (this.sinceSharpen < 6) this.retryAfter = Math.min(300, this.retryAfter * 2);
    } else if (this.smoothFor > this.retryAfter && this.scale < 1) {
      next = Math.min(1, this.scale * 1.25);
      this.sinceSharpen = 0;
    }
    if (next === this.scale) return;
    this.scale = next;
    this.slowFor = 0;
    this.smoothFor = 0;
    this.frameMs = 20;
    this.resize();
  }

  /** The automatic resolution scale currently in force (1 = full quality). */
  get renderScale(): number {
    return this.scale;
  }

  get viewport(): { width: number; height: number; pixelRatio: number } {
    return { width: this.width, height: this.height, pixelRatio: this.pixelRatio };
  }

  // ───────────── State from the game ─────────────

  setSim(sim: Sim | null): void {
    this.sim = sim;
    this.lastRevision = -1;
    this.styleDirty = true;
    this.selectedAirport = null;
    this.selectedRoute = null;
    this.planning = null;
    this.following = null;
    this.routes.setHighlight(null, null);
    this.routes.setPreview(null, null);
    this.routes.setRange(null);
    this.leaveChase();
    if (!sim) {
      this.routes.setPlayerRoutes([], () => this.accent);
      this.routes.setRivalRoutes([], () => this.accent);
      this.labels?.clear();
    }
  }

  setSelection(sel: { airport?: AirportId | null; route?: number | null; aircraft?: number | null }): void {
    if (sel.airport !== undefined && sel.airport !== this.selectedAirport) {
      this.selectedAirport = sel.airport;
      this.styleDirty = true;
    }
    if (sel.route !== undefined && sel.route !== this.selectedRoute) {
      this.selectedRoute = sel.route;
      const r = sel.route !== null ? this.sim?.routeById.get(sel.route) : undefined;
      this.routes.setHighlight(r?.a ?? null, r?.b ?? null, r?.dist ?? 0);
    }
    if (sel.aircraft !== undefined) this.traffic.selected = sel.aircraft;
  }

  /** Shows a route being planned: a range ring, highlighted destinations and a preview arc. */
  setPlanning(p: Planning | null): void {
    const prev = this.planning;
    this.planning = p;
    if (!p) {
      this.routes.setPreview(null, null);
      this.routes.setRange(null);
    } else {
      if (!prev || prev.from !== p.from || prev.rangeKm !== p.rangeKm) this.routes.setRange(p.rangeKm > 0 ? p.from : null, p.rangeKm);
      if (!prev || prev.to !== p.to || prev.from !== p.from || prev.ok !== p.ok) {
        this.routes.setPreview(p.to ? p.from : null, p.to, p.to ? airportDistance(p.from, p.to) : 0, p.ok);
      }
    }
    this.styleDirty = true;
  }

  setLayers(patch: Partial<GlobeLayers>): void {
    Object.assign(this.layers, patch);
    this.earth?.setCloudsVisible(this.layers.clouds);
    this.traffic.showRivals = this.layers.rivalTraffic;
    this.styleDirty = true;
    if (!this.layers.labels) this.labels?.update([], this.width, this.height, 0);
  }

  setColorMode(mode: RouteColorMode): void {
    this.colorMode = mode;
    this.styleDirty = true;
  }

  /** Marks route colours and airport markers for a rebuild (after prices, profits etc. change). */
  invalidate(): void {
    this.styleDirty = true;
  }

  // ───────────── Camera helpers ─────────────

  focusAirport(id: AirportId, altitude?: number): void {
    const a = AIRPORT[id];
    this.following = null;
    this.controls.flyTo({ lat: a.lat, lon: a.lon, altitude: altitude ?? Math.min(this.controls.target.altitude, 1.3) });
  }

  focusRoute(route: Pick<Route, 'a' | 'b' | 'dist'>): void {
    const a = AIRPORT[route.a];
    const b = AIRPORT[route.b];
    arcPoint(a.pos, b.pos, 0.5, route.dist, this.v);
    const mid = vecToLatLon([this.v.x, this.v.y, this.v.z]);
    this.following = null;
    // Frame the whole arc: altitude grows with the angular span.
    const angle = route.dist / 6371;
    this.controls.flyTo({ lat: mid.lat, lon: mid.lon, altitude: THREE.MathUtils.clamp(angle * 1.9 + 0.25, 0.5, 4.2) });
  }

  /** Keeps the camera centred on an aircraft until the user moves the view. */
  followAircraft(id: number | null): void {
    this.following = id;
    if (id !== null) this.controls.target.altitude = Math.min(this.controls.target.altitude, 1.1);
  }

  get followedAircraft(): number | null {
    return this.following;
  }

  /** Enters (or with null, leaves) the flight view alongside an airborne aircraft. */
  setChase(id: number | null): void {
    const chase = this.chase;
    if (!chase || !this.sim) return;
    if (id === chase.aircraftId) return;
    const ac = id !== null ? this.sim.acById.get(id) : undefined;
    if (ac && ac.phase === 'enroute') {
      chase.begin(this.sim, ac);
      this.controls.free = true;
      this.traffic.hidden = ac.id;
      this.following = null;
    } else {
      this.leaveChase();
    }
  }

  get chasedAircraft(): number | null {
    return this.chase?.aircraftId ?? null;
  }

  /** In the flight view: how close the camera is to the aircraft (0..1), for the sound. */
  get chaseProximity(): number {
    return this.chase?.proximity ?? 0;
  }

  get chaseJets(): boolean {
    return this.chase?.jets ?? true;
  }

  private leaveChase(): void {
    const chase = this.chase;
    if (!chase || !chase.active) return;
    const id = chase.aircraftId!;
    chase.end();
    this.controls.free = false;
    this.traffic.hidden = null;
    const cam = this.controls.camera;
    cam.fov = 35;
    // Pick the globe view back up above wherever the aircraft was.
    const ll = vecToLatLon([cam.position.x, cam.position.y, cam.position.z]);
    this.controls.setPose({ lat: ll.lat, lon: ll.lon, altitude: 0.5 });
    this.controls.flyTo({ altitude: 1.3 }, 1.6);
    this.following = this.sim?.acById.has(id) ? id : null;
  }

  /** Screen position (CSS pixels) of an airport, or null if it is on the far side. */
  airportScreen(id: AirportId): { x: number; y: number } | null {
    const a = AIRPORT[id];
    this.v.set(a.pos[0], a.pos[1], a.pos[2]);
    if (occluded(this.v, this.controls.camera.position)) return null;
    this.v.project(this.controls.camera);
    if (this.v.z > 1) return null;
    return { x: (this.v.x * 0.5 + 0.5) * this.width, y: (-this.v.y * 0.5 + 0.5) * this.height };
  }

  // ───────────── Picking ─────────────

  pick(x: number, y: number): GlobeHit | null {
    const cam = this.controls.camera;
    if (this.sim && !this.planning) {
      const plane = this.traffic.pick(x, y, cam, this.width, this.height, 16);
      if (plane) return { kind: 'aircraft', id: plane.aircraft.id, x: plane.x, y: plane.y };
    }
    // Airports.
    let best: GlobeHit | null = null;
    let bestD = Infinity;
    const camPos = cam.position;
    for (const a of AIRPORTS) {
      const radius = this.airports.radius[a.index];
      if (radius <= 0) continue;
      this.v.set(a.pos[0], a.pos[1], a.pos[2]);
      if (occluded(this.v, camPos)) continue;
      this.v.project(cam);
      if (this.v.z > 1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * this.width;
      const sy = (-this.v.y * 0.5 + 0.5) * this.height;
      const d = Math.hypot(sx - x, sy - y);
      const reach = Math.max(11, radius + 6);
      // Bigger markers win ties so that hubs are easy to hit among small fields.
      const score = d - radius * 0.6;
      if (d <= reach && score < bestD) {
        bestD = score;
        best = { kind: 'airport', id: a.id, x: sx, y: sy };
      }
    }
    if (best) return best;
    // The player's route arcs.
    if (this.sim && !this.planning) {
      let bestRoute: GlobeHit | null = null;
      let bestDist = 7;
      for (const r of this.sim.routesOf(0)) {
        const a = AIRPORT[r.a].pos;
        const b = AIRPORT[r.b].pos;
        let px = NaN, py = NaN;
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
          arcPoint(a, b, i / steps, r.dist, this.v);
          if (occluded(this.v, camPos)) { px = NaN; continue; }
          this.v.project(cam);
          const sx = (this.v.x * 0.5 + 0.5) * this.width;
          const sy = (-this.v.y * 0.5 + 0.5) * this.height;
          if (!Number.isNaN(px)) {
            const d = distToSegment(x, y, px, py, sx, sy);
            if (d < bestDist) {
              bestDist = d;
              bestRoute = { kind: 'route', id: r.id, x, y };
            }
          }
          px = sx;
          py = sy;
        }
      }
      if (bestRoute) return bestRoute;
    }
    return null;
  }

  // ───────────── Per-frame ─────────────

  private rebuildStyle(): void {
    const sim = this.sim;
    this.served.clear();
    this.hubs.clear();
    if (sim) {
      const p = sim.player;
      this.accent.set(p.livery.primary);
      const hsl = { h: 0, s: 0, l: 0 };
      this.accent.getHSL(hsl);
      // Keep the hue but make sure it glows against a dark planet.
      this.accent.setHSL(hsl.h, Math.max(0.55, hsl.s), THREE.MathUtils.clamp(hsl.l, 0.6, 0.72));
      for (const h of p.hubs) this.hubs.set(h.airport, h.level);
      const routes = sim.routesOf(0);
      for (const r of routes) { this.served.add(r.a); this.served.add(r.b); }

      const brand = this.accent.clone().multiplyScalar(1.25);
      const tmp = new THREE.Color();
      const colorOf = (r: Route): THREE.Color => {
        if (this.colorMode === 'brand' || r.prev.flights === 0) return brand;
        if (this.colorMode === 'profit') {
          const margin = r.prev.revenue > 0 ? (r.prev.revenue - r.prev.cost) / r.prev.revenue : -1;
          return rampColor(margin / 0.25, tmp).multiplyScalar(1.2).clone();
        }
        const seats = r.prev.seats[0] + r.prev.seats[1] + r.prev.seats[2];
        const pax = r.prev.pax[0] + r.prev.pax[1] + r.prev.pax[2];
        return rampColor(((seats ? pax / seats : 0) - 0.72) / 0.2, tmp).multiplyScalar(1.2).clone();
      };
      this.routes.setPlayerRoutes(routes, colorOf);

      // Rival routes: everything, or just those at the selected airport.
      let rivals: Route[] = [];
      if (this.layers.rivalRoutes) {
        rivals = sim.game.routes.filter((r) => r.airline !== 0);
      } else if (this.selectedAirport) {
        const id = this.selectedAirport;
        rivals = sim.game.routes.filter((r) => r.airline !== 0 && (r.a === id || r.b === id));
      }
      const rivalColor = new THREE.Color();
      const cache = new Map<number, THREE.Color>();
      this.routes.setRivalRoutes(rivals, (r) => {
        let c = cache.get(r.airline);
        if (!c) {
          c = rivalColor.clone().set(sim.game.airlines[r.airline].livery.primary);
          c.getHSL(hsl);
          c.setHSL(hsl.h, Math.min(0.75, hsl.s), THREE.MathUtils.clamp(hsl.l, 0.55, 0.7));
          cache.set(r.airline, c);
        }
        return c;
      });
    }
    this.styleDirty = false;
  }

  private updateLabels(): void {
    if (!this.labels || !this.layers.labels) return;
    const cam = this.controls.camera;
    const camPos = cam.position;
    const altitude = this.controls.pose.altitude;
    const near = altitude < 1.25;
    const specs: LabelSpec[] = [];
    for (const a of AIRPORTS) {
      const radius = this.airports.radius[a.index];
      if (radius <= 0) continue;
      this.v.set(a.pos[0], a.pos[1], a.pos[2]);
      if (occluded(this.v, camPos)) continue;
      this.v.project(cam);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.02 || Math.abs(this.v.y) > 1.02) continue;
      const hub = this.hubs.get(a.id);
      const served = this.served.has(a.id);
      const boost = this.planning?.candidates?.get(a.id);
      const selected = this.selectedAirport === a.id || this.planning?.to === a.id;
      let priority = a.pax + a.tier * 8;
      let kind = 'plain';
      if (boost !== undefined) { priority += 120 + boost * 200; kind = 'candidate'; }
      if (served) { priority += 400; kind = 'served'; }
      if (hub) { priority += 900; kind = 'hub'; }
      if (selected) { priority += 5000; kind = 'selected'; }
      // Unserved minor airports only earn a label when zoomed in.
      if (kind === 'plain' && a.tier < 4 && altitude > 1.6 - a.tier * 0.3) continue;
      specs.push({
        id: a.id,
        x: (this.v.x * 0.5 + 0.5) * this.width,
        y: (-this.v.y * 0.5 + 0.5) * this.height,
        priority,
        code: a.id,
        name: near || hub || selected ? a.city : undefined,
        kind,
        offset: radius,
      });
    }
    const max = Math.round(THREE.MathUtils.lerp(70, 26, THREE.MathUtils.smoothstep(altitude, 0.5, 3.2)));
    this.labels.update(specs, this.width, this.height, max);
  }

  /**
   * Positions the sun for the given game time. At high game speeds the real sun
   * would strobe around the planet, so the light blends towards a fixed key light
   * over the camera's shoulder instead.
   */
  private updateSun(time: number, dt: number, fast: boolean): void {
    const wantStudio = this.sunMode === 'studio' || fast ? 1 : 0;
    this.studioBlend += (wantStudio - this.studioBlend) * (1 - Math.exp(-dt * 2.5));
    const real = sunDirection(time);
    this.tmpSun.set(real[0], real[1], real[2]);
    if (this.studioBlend > 0.001) {
      const cam = this.controls.camera;
      this.tmpStudio.copy(cam.position).normalize();
      // Offset to the upper left of the view for pleasing relief shading.
      this.tmpRight.setFromMatrixColumn(cam.matrixWorld, 0);
      this.tmpUp.setFromMatrixColumn(cam.matrixWorld, 1);
      this.tmpStudio.addScaledVector(this.tmpRight, -0.55).addScaledVector(this.tmpUp, 0.35).normalize();
      this.tmpSun.lerp(this.tmpStudio, this.studioBlend).normalize();
    }
    this.sun.copy(this.tmpSun);
  }

  /**
   * Advances animations and draws one frame.
   * @param dt real seconds since the previous frame
   * @param time game time in minutes
   * @param fast true when the game clock is running too fast for a real day/night cycle
   */
  frame(dt: number, time: number, fast = false): void {
    if (!this.earth || !this.sky || !this.composer) return;
    const sim = this.sim;
    this.time = time;
    this.frameCount++;
    this.adapt(dt);

    if (sim && this.following !== null) {
      const ac = sim.acById.get(this.following);
      if (ac && this.traffic.positionOf(sim, ac, time, this.v)) {
        const ll = vecToLatLon([this.v.x, this.v.y, this.v.z]);
        this.controls.target.lat = ll.lat;
        this.controls.target.lon = ll.lon;
      } else if (ac) {
        const ap = AIRPORT[ac.at];
        this.controls.target.lat = ap.lat;
        this.controls.target.lon = ap.lon;
      } else {
        this.following = null;
      }
    }

    this.controls.update(dt);
    this.updateSun(time, dt, fast);
    const chase = this.chase;
    if (chase?.active) {
      if (!sim || !chase.update(sim, time, dt, this.sun, this.controls.camera)) {
        const id = chase.aircraftId!;
        this.leaveChase();
        this.onChaseEnd?.(id);
      }
    }
    const chasing = !!chase?.active;
    // In the flight view the camera sits just above the clouds: treat it as fully zoomed in.
    const altitude = chasing ? 0.2 : this.controls.pose.altitude;
    this.earth.setSun(this.sun);
    this.earth.update(dt, this.controls.camera.position.length() - 1, chasing ? 1 : 0);
    this.sky.update(gmstDegrees(time), this.sun, this.controls.camera, this.pixelRatio);
    // Inside the atmosphere the daytime sky drowns out the stars.
    const daylight = chasing ? THREE.MathUtils.smoothstep(this.sun.dot(this.controls.camera.position) / this.controls.camera.position.length(), -0.1, 0.2) : 0;
    this.skyFade += (daylight - this.skyFade) * (1 - Math.exp(-dt * 3));
    this.sky.setBrightness(1 - 0.92 * this.skyFade);

    if (sim) {
      if (sim.revision !== this.lastRevision) {
        this.lastRevision = sim.revision;
        this.styleDirty = true;
      }
      if (this.styleDirty) this.rebuildStyle();
      this.traffic.update(sim, time, this.controls.camera, this.height);
    } else if (this.styleDirty) {
      this.rebuildStyle();
    }
    // The map overlays are drawn for the view from orbit; from the flight deck
    // of a chase plane they would be poles and billboards in the sky.
    this.traffic.group.visible = !!sim && !chasing;
    this.routes.group.visible = !chasing;
    this.airports.points.visible = !chasing;
    this.borders.update(altitude, this.layers.borders, chasing ? 0.1 + 0.26 * daylight : 1);
    this.airports.update(
      { served: this.served, hubs: this.hubs, selected: this.planning?.to ?? this.selectedAirport, highlight: this.planning?.candidates ?? null, accent: this.accent },
      altitude,
      this.pixelRatio,
    );
    this.routes.update(dt);
    if (chasing) this.labels?.update([], this.width, this.height, 0);
    else if (this.frameCount % 2 === 0 || this.controls.isDragging) this.updateLabels();

    this.composer.render(dt);
  }

  /** Current game time as last rendered. */
  get renderedTime(): number {
    return this.time;
  }

  /** Where an aircraft is right now on screen, if visible. */
  aircraftScreen(ac: Aircraft): { x: number; y: number } | null {
    if (!this.sim || !this.traffic.positionOf(this.sim, ac, this.time, this.v)) return null;
    if (occluded(this.v, this.controls.camera.position)) return null;
    this.v.project(this.controls.camera);
    return { x: (this.v.x * 0.5 + 0.5) * this.width, y: (-this.v.y * 0.5 + 0.5) * this.height };
  }

  setQuality(quality: Quality): void {
    // Texture tier changes need a reload; everything else applies in place.
    this.quality = quality;
    // A deliberate choice of quality starts again from full resolution.
    this.scale = 1;
    this.retryAfter = 10;
    const q = QUALITY[quality];
    this.earth?.setAtmosphereQuality(q.viewSteps, q.lightSteps);
    if (this.bloom) this.bloom.enabled = q.bloom;
    this.resize();
  }

  dispose(): void {
    this.controls.dispose();
    this.earth?.dispose();
    this.sky?.dispose();
    this.routes.dispose();
    this.traffic.dispose();
    this.chase?.dispose();
    this.labels?.clear();
    for (const t of this.textures) t.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

function sameHit(a: GlobeHit | null, b: GlobeHit | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
