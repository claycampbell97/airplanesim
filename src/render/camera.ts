// Orbit camera for the globe: drag to spin, wheel or pinch to zoom, with inertia.
// As the camera closes in it tilts towards the horizon, so regional views show
// the curve of the Earth and the atmosphere rather than a flat map.

import * as THREE from 'three';
import { DEG, latLonToVec } from '../sim/geo';

export const MIN_ALTITUDE = 0.14;
export const MAX_ALTITUDE = 7;
const MAX_LAT = 84;
const MAX_TILT = 52 * DEG;

export interface CameraPose {
  lat: number;
  lon: number;
  /** Distance from the focus point on the surface, in Earth radii. */
  altitude: number;
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function shortestLonDelta(from: number, to: number): number {
  return wrapLon(to - from);
}

export class GlobeCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Where the camera is heading. */
  target: CameraPose = { lat: 25, lon: 10, altitude: 3.4 };
  /** Where it is now. */
  pose: CameraPose = { lat: 25, lon: 10, altitude: 3.4 };
  /** Degrees per second of idle rotation (title screen). */
  autoRotate = 0;
  /** Tilt towards the horizon when zoomed in. */
  tiltEnabled = true;
  enabled = true;
  onClick: ((x: number, y: number, event: PointerEvent) => void) | null = null;
  onHover: ((x: number, y: number) => void) | null = null;
  onUserMove: (() => void) | null = null;

  private el: HTMLElement;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart = { x: 0, y: 0 };
  private dragMoved = false;
  private pinchDist = 0;
  private velocity = { lat: 0, lon: 0 };
  private lastMoveTime = 0;
  private fly: { from: CameraPose; to: CameraPose; t: number; duration: number; peak: number } | null = null;
  private focus = new THREE.Vector3();
  private north = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private disposers: (() => void)[] = [];

  constructor(el: HTMLElement, aspect: number) {
    this.el = el;
    this.camera = new THREE.PerspectiveCamera(35, aspect, 0.01, 200);
    this.bind();
    this.apply();
  }

  private listen<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    this.el.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => this.el.removeEventListener(type, fn as EventListener, opts));
  }

  /** Radians of globe rotation per pixel of drag at the current zoom. */
  private radiansPerPixel(): number {
    const h = this.el.clientHeight || 800;
    const visible = 2 * this.pose.altitude * Math.tan((this.camera.fov * DEG) / 2);
    return Math.min(visible / h, 0.0045);
  }

  private bind(): void {
    this.listen('pointerdown', (e) => {
      if (!this.enabled) return;
      this.el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.dragMoved = false;
        this.velocity.lat = this.velocity.lon = 0;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.dragMoved = true;
      }
    });

    this.listen('pointermove', (e) => {
      const rect = this.el.getBoundingClientRect();
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        this.onHover?.(e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      if (!this.enabled) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0 && d > 0) this.zoomBy(this.pinchDist / d);
        this.pinchDist = d;
        return;
      }

      if (!this.dragMoved && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) < 5) return;
      this.dragMoved = true;
      this.fly = null;
      this.onUserMove?.();
      const k = this.radiansPerPixel() / DEG;
      const cosLat = Math.max(0.2, Math.cos(this.target.lat * DEG));
      const dLon = (-dx * k) / cosLat;
      const dLat = dy * k;
      this.target.lon = wrapLon(this.target.lon + dLon);
      this.target.lat = THREE.MathUtils.clamp(this.target.lat + dLat, -MAX_LAT, MAX_LAT);
      const now = performance.now();
      const dt = Math.max(1, now - this.lastMoveTime) / 1000;
      this.lastMoveTime = now;
      // Remember the drag speed for a short glide after release.
      this.velocity.lon = THREE.MathUtils.lerp(this.velocity.lon, dLon / dt, 0.5);
      this.velocity.lat = THREE.MathUtils.lerp(this.velocity.lat, dLat / dt, 0.5);
    });

    const release = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
      if (this.pointers.size === 0) {
        if (!this.dragMoved && e.type === 'pointerup') {
          const rect = this.el.getBoundingClientRect();
          this.onClick?.(e.clientX - rect.left, e.clientY - rect.top, e);
        }
        if (performance.now() - this.lastMoveTime > 80) this.velocity.lat = this.velocity.lon = 0;
      }
      this.pinchDist = 0;
    };
    this.listen('pointerup', release);
    this.listen('pointercancel', release);
    this.listen('pointerleave', () => this.onHover?.(-1, -1));

    this.listen('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this.zoomBy(Math.exp(THREE.MathUtils.clamp(delta, -300, 300) * 0.0012));
    }, { passive: false });

    this.listen('dblclick', (e) => {
      if (!this.enabled) return;
      const rect = this.el.getBoundingClientRect();
      const hit = this.pickGlobe(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) this.flyTo({ lat: hit.lat, lon: hit.lon, altitude: Math.max(MIN_ALTITUDE, this.target.altitude * 0.5) }, 0.7);
    });
  }

  zoomBy(factor: number): void {
    this.fly = null;
    this.onUserMove?.();
    this.target.altitude = THREE.MathUtils.clamp(this.target.altitude * factor, MIN_ALTITUDE, MAX_ALTITUDE);
  }

  /** Glides to a new viewpoint, lifting off a little on long hops. */
  flyTo(to: Partial<CameraPose>, duration = 1.4): void {
    const from = { ...this.pose };
    const dest: CameraPose = {
      lat: THREE.MathUtils.clamp(to.lat ?? this.target.lat, -MAX_LAT, MAX_LAT),
      lon: to.lon ?? this.target.lon,
      altitude: THREE.MathUtils.clamp(to.altitude ?? this.target.altitude, MIN_ALTITUDE, MAX_ALTITUDE),
    };
    const a = latLonToVec(from.lat, from.lon);
    const b = latLonToVec(dest.lat, dest.lon);
    const angle = Math.acos(THREE.MathUtils.clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
    this.fly = { from, to: dest, t: 0, duration, peak: Math.max(from.altitude, dest.altitude, angle * 0.85) };
    this.target = { ...dest };
    this.velocity.lat = this.velocity.lon = 0;
  }

  /** Jumps straight to a viewpoint. */
  setPose(p: Partial<CameraPose>): void {
    this.fly = null;
    this.target = { ...this.target, ...p };
    this.pose = { ...this.target };
    this.apply();
  }

  get isFlying(): boolean {
    return this.fly !== null;
  }

  get isDragging(): boolean {
    return this.pointers.size > 0 && this.dragMoved;
  }

  update(dt: number): void {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = f.t * f.t * (3 - 2 * f.t);
      this.pose.lat = f.from.lat + (f.to.lat - f.from.lat) * e;
      this.pose.lon = wrapLon(f.from.lon + shortestLonDelta(f.from.lon, f.to.lon) * e);
      // Altitude follows the direct blend plus a hump that peaks mid-flight.
      const base = Math.exp(Math.log(f.from.altitude) + (Math.log(f.to.altitude) - Math.log(f.from.altitude)) * e);
      const hump = Math.max(0, f.peak - Math.max(f.from.altitude, f.to.altitude)) * Math.sin(Math.PI * f.t);
      this.pose.altitude = base + hump;
      if (f.t >= 1) this.fly = null;
    } else {
      if (this.pointers.size === 0) {
        if (Math.abs(this.velocity.lon) + Math.abs(this.velocity.lat) > 0.01) {
          this.target.lon = wrapLon(this.target.lon + this.velocity.lon * dt);
          this.target.lat = THREE.MathUtils.clamp(this.target.lat + this.velocity.lat * dt, -MAX_LAT, MAX_LAT);
          const decay = Math.exp(-dt * 3.2);
          this.velocity.lon *= decay;
          this.velocity.lat *= decay;
        } else if (this.autoRotate) {
          this.target.lon = wrapLon(this.target.lon + this.autoRotate * dt);
        }
      }
      const k = 1 - Math.exp(-dt * 12);
      this.pose.lat += (this.target.lat - this.pose.lat) * k;
      this.pose.lon = wrapLon(this.pose.lon + shortestLonDelta(this.pose.lon, this.target.lon) * k);
      this.pose.altitude = Math.exp(Math.log(this.pose.altitude) + (Math.log(this.target.altitude) - Math.log(this.pose.altitude)) * k);
    }
    this.apply();
  }

  /** Current tilt away from straight down, radians. */
  get tilt(): number {
    if (!this.tiltEnabled) return 0;
    return MAX_TILT * (1 - THREE.MathUtils.smoothstep(this.pose.altitude, 0.2, 1.5));
  }

  private apply(): void {
    const { lat, lon, altitude } = this.pose;
    const f = latLonToVec(lat, lon);
    this.focus.set(f[0], f[1], f[2]);
    // Local north at the focus point.
    const n = latLonToVec(lat + 0.5, lon);
    this.north.set(n[0] - f[0], n[1] - f[1], n[2] - f[2]).normalize();
    const tilt = this.tilt;
    this.tmp.copy(this.focus).multiplyScalar(Math.cos(tilt)).addScaledVector(this.north, -Math.sin(tilt));
    this.camera.position.copy(this.focus).addScaledVector(this.tmp, altitude);
    this.camera.up.copy(this.north);
    this.camera.lookAt(this.focus);
    // Keep the depth range tight for precision: near plane scales with zoom.
    this.camera.near = Math.max(0.0005, altitude * 0.05);
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Height of the camera above the surface, in Earth radii. */
  get height(): number {
    return this.camera.position.length() - 1;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Latitude/longitude under a screen position, or null if it misses the globe. */
  pickGlobe(x: number, y: number): { lat: number; lon: number; point: THREE.Vector3 } | null {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const ndc = new THREE.Vector3((x / w) * 2 - 1, -(y / h) * 2 + 1, 0.5).unproject(this.camera);
    const origin = this.camera.position;
    const dir = ndc.sub(origin).normalize();
    const b = origin.dot(dir);
    const c = origin.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const point = origin.clone().addScaledVector(dir, t);
    return {
      lat: Math.asin(THREE.MathUtils.clamp(point.y, -1, 1)) / DEG,
      lon: Math.atan2(-point.z, point.x) / DEG,
      point,
    };
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
