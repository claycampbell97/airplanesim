// The flight view: a camera that flies alongside one aircraft.
//
// The planet is 6,371 km across and an airliner about 40 m, far too wide a range
// for one set of single-precision coordinates. So the aircraft is drawn in its
// own little scene measured in metres, with the aircraft fixed at the origin,
// and the world camera is placed so that the two views line up exactly.

import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AIRCRAFT_TYPE } from '../sim/data/aircraft';
import { AIRPORT } from '../sim/data/airports';
import type { Sim } from '../sim/sim';
import type { Aircraft, AircraftShape } from '../sim/types';
import { buildAircraftModel, disposeAircraftModel } from './aircraft/model';
import { createStudioEnvironment } from './aircraft/viewer';
import { altitudeProfile, arcPoint } from './arcs';

const METRES_PER_UNIT = 6_371_000;
/** The camera never goes lower than this (Earth radii), so it stays above the cloud deck. */
const MIN_ALTITUDE = 0.0082;
const FOV = 42;

// ── Contrails ──
// Each engine leaves a ribbon of condensation that widens and frays as it ages.
// Two ribbons at right angles give it some body from every viewing angle.

const TRAIL_VERT = /* glsl */ `
uniform float uLength;
uniform float uWidth;
varying vec2 vUv;
void main() {
  vUv = uv;
  float s = uv.y;
  float w = uWidth * (0.7 + 11.0 * pow(s, 0.7));
  vec3 p = vec3(position.x * w, 0.0, -uLength * s * s);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float s = vUv.y;
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float body = smoothstep(0.0, 0.85, across);
  float along = s * s;
  float puff = noise(vec2(vUv.x * 2.5, along * 420.0 + uTime * 2.2)) * 0.6 + noise(vec2(vUv.x * 6.0, along * 1500.0 + uTime * 5.0)) * 0.4;
  float a = body * body * (0.45 + 0.85 * puff);
  a *= smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.3, 1.0, s));
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * uOpacity);
}`;

const TRAIL_LENGTH = 14000;

export class ChaseView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 30000);
  readonly pass: RenderPass;
  aircraftId: number | null = null;

  /** Camera orbit around the aircraft: azimuth and elevation in radians, distance in metres. */
  private az = 0.55;
  private el = 0.2;
  private dist = 120;
  private length = 40;
  private model: THREE.Group | null = null;
  private trails = new THREE.Group();
  private trailGeometry = new THREE.PlaneGeometry(1, 1, 1, 56);
  private trailMaterial = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: {
      uLength: { value: TRAIL_LENGTH },
      uWidth: { value: 2 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private sun = new THREE.DirectionalLight(0xfff4e2, 3.4);
  private hemi = new THREE.HemisphereLight(0xa9cbff, 0x1d2a44, 1);
  private fill = new THREE.DirectionalLight(0x9db8ff, 0.5);
  private clock = 0;

  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();
  private right = new THREE.Vector3();
  private local = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private frame = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private sunLocal = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer) {
    this.scene.environment = createStudioEnvironment(renderer);
    this.scene.add(this.sun, this.hemi, this.fill, this.trails);
    this.pass = new RenderPass(this.scene, this.camera);
    // Draw over the finished world image: keep its colours, start a fresh depth buffer.
    this.pass.clear = false;
    this.pass.clearDepth = true;
    this.pass.enabled = false;
  }

  get active(): boolean {
    return this.aircraftId !== null;
  }

  begin(sim: Sim, ac: Aircraft): void {
    this.end();
    const al = sim.game.airlines[ac.airline];
    this.model = buildAircraftModel(AIRCRAFT_TYPE[ac.type], al.livery, {
      gear: false, registration: ac.reg, airlineName: al.name, detail: 'high',
    });
    this.scene.add(this.model);
    this.length = (this.model.userData.length as number) ?? AIRCRAFT_TYPE[ac.type].shape.length;
    this.buildTrails(AIRCRAFT_TYPE[ac.type].shape);
    this.dist = this.length * 2.3;
    this.az = 0.55;
    this.el = 0.2;
    this.aircraftId = ac.id;
    this.pass.enabled = true;
  }

  /** One contrail per jet engine, starting a little way behind the tail. */
  private buildTrails(shape: AircraftShape): void {
    this.trails.clear();
    // Turboprops cruise too low and too warm to leave one.
    if (shape.engineMount === 'prop') return;
    const half = shape.span / 2;
    const xs = shape.engineMount === 'rear'
      ? [shape.diameter / 2 + shape.engineDiameter * 0.7]
      : shape.engines === 4 ? [half * 0.29, half * 0.57] : [half * 0.33];
    const y = shape.engineMount === 'rear' ? shape.diameter * 0.15 : -shape.diameter * 0.4;
    this.trailMaterial.uniforms.uWidth.value = shape.engineDiameter * 1.15;
    for (const x of xs) {
      for (const side of [1, -1]) {
        for (const roll of [0, Math.PI / 2]) {
          const ribbon = new THREE.Mesh(this.trailGeometry, this.trailMaterial);
          ribbon.position.set(side * x, y, -shape.length * 0.85);
          ribbon.rotation.z = roll;
          ribbon.frustumCulled = false;
          ribbon.renderOrder = 2;
          this.trails.add(ribbon);
        }
      }
    }
  }

  end(): void {
    this.trails.clear();
    if (this.model) {
      this.scene.remove(this.model);
      disposeAircraftModel(this.model);
      this.model = null;
    }
    this.aircraftId = null;
    this.pass.enabled = false;
  }

  orbit(dx: number, dy: number): void {
    this.az -= dx * 0.006;
    this.el = THREE.MathUtils.clamp(this.el + dy * 0.005, -0.4, 1.25);
  }

  zoom(factor: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist * factor, this.length * 0.85, this.length * 12);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Places both cameras for this frame. Returns false when the flight is over
   * (the aircraft has landed or no longer exists).
   */
  update(sim: Sim, time: number, dt: number, sunWorld: THREE.Vector3, world: THREE.PerspectiveCamera): boolean {
    const ac = this.aircraftId !== null ? sim.acById.get(this.aircraftId) : undefined;
    const leg = ac?.leg;
    if (!ac || !leg || ac.phase !== 'enroute' || time >= leg.arr) return false;

    const t = THREE.MathUtils.clamp((time - leg.dep) / (leg.arr - leg.dep), 0, 1);
    const a = AIRPORT[leg.from].pos;
    const b = AIRPORT[leg.to].pos;
    const dist = sim.routeById.get(leg.route)?.dist ?? Math.acos(THREE.MathUtils.clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) * 6371;
    arcPoint(a, b, t, dist, this.p);
    const e = 0.003;
    if (t + e <= 1) this.fwd.subVectors(arcPoint(a, b, t + e, dist, this.q), this.p).normalize();
    else this.fwd.subVectors(this.p, arcPoint(a, b, t - e, dist, this.q)).normalize();

    this.up.copy(this.p).normalize();
    // Soften the exaggerated climb and descent angles of the stylised flight path.
    this.fwd.addScaledVector(this.up, -0.6 * this.fwd.dot(this.up)).normalize();
    const r = this.p.length();
    if (r < 1 + MIN_ALTITUDE) this.p.multiplyScalar((1 + MIN_ALTITUDE) / r);
    this.right.crossVectors(this.up, this.fwd).normalize();
    this.up.crossVectors(this.fwd, this.right);
    this.basis.makeBasis(this.right, this.up, this.fwd);
    this.frame.setFromRotationMatrix(this.basis);

    // The aircraft's own scene: aircraft at the origin, nose along +Z.
    const ce = Math.cos(this.el);
    this.local.set(Math.sin(this.az) * ce, Math.sin(this.el), -Math.cos(this.az) * ce).multiplyScalar(this.dist);
    this.camera.position.copy(this.local);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, this.length * 0.02, this.length * 0.06);
    this.camera.updateMatrixWorld();

    // The world camera: the same view, expressed in planet coordinates.
    world.position.copy(this.p)
      .addScaledVector(this.right, this.local.x / METRES_PER_UNIT)
      .addScaledVector(this.up, this.local.y / METRES_PER_UNIT)
      .addScaledVector(this.fwd, this.local.z / METRES_PER_UNIT);
    world.quaternion.copy(this.frame).multiply(this.camera.quaternion);
    world.fov = FOV;
    world.near = 0.00025;
    world.far = 150;
    world.updateProjectionMatrix();
    world.updateMatrixWorld();

    // Light the aircraft with the real sun, as seen from its own frame.
    this.inverse.copy(this.frame).invert();
    this.sunLocal.copy(sunWorld).applyQuaternion(this.inverse);
    const day = THREE.MathUtils.smoothstep(sunWorld.dot(this.p) / this.p.length(), -0.14, 0.16);
    this.sun.position.copy(this.sunLocal).multiplyScalar(1000);
    this.sun.intensity = 2.3 * day;
    // Low sun turns warm.
    const low = 1 - THREE.MathUtils.smoothstep(this.sunLocal.y, 0.0, 0.35);
    this.sun.color.setRGB(1, 0.95 - 0.35 * low, 0.88 - 0.55 * low);
    this.hemi.intensity = 0.14 + 0.6 * day;
    this.fill.position.set(-this.sunLocal.x, 0.4, -this.sunLocal.z).multiplyScalar(1000);
    this.fill.intensity = 0.08 + 0.22 * day;
    this.scene.environmentIntensity = 0.08 + 0.42 * day;

    // Contrails only form in the cold air of the cruise.
    const u = this.trailMaterial.uniforms;
    u.uOpacity.value = 0.62 * THREE.MathUtils.smoothstep(altitudeProfile(t, dist), 0.72, 0.98);
    (u.uColor.value as THREE.Color).copy(this.sun.color).multiplyScalar(0.05 + 0.85 * day);
    u.uTime.value = this.clock;

    this.clock += dt;
    const animate = this.model?.userData.update as ((dt: number, t: number) => void) | undefined;
    animate?.(dt, this.clock);
    return true;
  }

  dispose(): void {
    this.end();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.scene.environment?.dispose();
  }
}

export { FOV as CHASE_FOV };
