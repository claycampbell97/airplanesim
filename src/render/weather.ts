// Weather on the globe: each system of the simulation drawn where it is, as a
// patch of cloud wrapped onto the sphere. The map underneath stays clear, so
// that what is drawn is what matters to the flying.

import * as THREE from 'three';
import { EARTH_RADIUS_KM } from '../sim/geo';
import type { Sim } from '../sim/sim';
import type { WeatherKind } from '../sim/types';
import { activeWeather } from '../sim/weather';
import { NOISE_GLSL } from './earth';

/** Height of the weather above the surface, Earth radii: just over the cloud deck of the flight view. */
const ALTITUDE = 0.0075;
/** The cloud shield spreads a little beyond the area the system disrupts. */
const SPREAD = 1.12;
/** How far a cloud's shadow falls from it, km: exaggerated, so that it reads from orbit. */
const SHADOW_KM = 34;

const KIND: Record<WeatherKind, number> = { storm: 0, snow: 1, thunder: 2, cyclone: 3, fog: 4, sand: 5 };

const VERT = /* glsl */ `
uniform vec3 centre;
uniform vec3 east;
uniform vec3 north;
uniform float radius;
uniform float altitude;
varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = position.xy;
  // Wrap the flat patch onto the sphere around its centre.
  float d = length(position.xy);
  float a = d * radius;
  vec2 dir = d > 1e-5 ? position.xy / d : vec2(0.0);
  vec3 p = centre * cos(a) + (east * dir.x + north * dir.y) * sin(a);
  vNormal = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p * (1.0 + altitude), 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 sunDir;
uniform vec2 sunLocal;
uniform float reach;
uniform float scale;
uniform float kind;
uniform float seed;
uniform float time;
uniform float strength;
uniform float spin;
uniform float opacity;
varying vec2 vUv;
varying vec3 vNormal;
${NOISE_GLSL}

vec2 turn(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// How much cloud there is at a point of the patch (x), and its fine texture (y).
// Features are sized in kilometres (through "scale"), so that a small system is
// not a big one shrunk.
vec2 cover(vec2 uv) {
  float r = length(uv);
  if (r >= 1.0) return vec2(0.0);
  float edge = 1.0 - smoothstep(0.6, 1.0, r);
  float angle = atan(uv.y, uv.x);
  float density = 0.0;
  float fine = 0.5;

  if (kind < 1.5) {
    // A low of the middle latitudes: a comma of cloud wound round its centre.
    vec2 q = turn(uv, spin * (1.7 / (r + 0.4)) + time * 0.012 * spin) * scale;
    float n = fbm(vec3(q * 3.1, seed));
    fine = fbm(vec3(q * 12.0, seed + 4.0));
    float arm = 0.5 + 0.5 * sin(spin * angle + 3.3 * log(r + 0.12) + seed);
    density = smoothstep(0.36, 0.7, n * 0.62 + fine * 0.2 + arm * 0.36 * (1.0 - 0.45 * r));
  } else if (kind < 2.5) {
    // Thunderstorms: towers in clusters.
    vec2 q = uv * scale;
    float n = fbm(vec3(q * 10.0, seed + time * 0.01));
    fine = fbm(vec3(q * 30.0, seed * 1.7));
    density = smoothstep(0.5, 0.72, n * 0.78 + fine * 0.36);
  } else if (kind < 3.5) {
    // A tropical cyclone: tight spiral bands around a clear eye.
    vec2 q = turn(uv, spin * (3.1 / (r + 0.22)) + time * 0.05 * spin);
    float n = fbm(vec3(q * 3.0, seed));
    fine = fbm(vec3(q * 11.0, seed + 9.0));
    float arms = 0.5 + 0.5 * sin(2.0 * (spin * angle + 2.5 * log(r + 0.06)) + time * 0.08);
    float core = 1.0 - smoothstep(0.0, 0.5, r);
    density = smoothstep(0.3, 0.62, n * 0.5 + fine * 0.14 + arms * 0.46 * (1.0 - 0.6 * r) + 0.4 * core);
    density *= smoothstep(0.03, 0.075, r);
  } else if (kind < 4.5) {
    // Fog: a low sheet with ragged edges.
    vec2 q = uv * scale;
    float n = fbm(vec3(q * 12.0, seed));
    fine = fbm(vec3(q * 40.0, seed + 2.0));
    density = smoothstep(0.25, 0.6, n + 0.35 * (1.0 - r));
  } else {
    // Sand and dust: streaks drawn out downwind.
    vec2 q = turn(uv, seed) * scale;
    float n = fbm(vec3(q.x * 3.6, q.y * 12.0, seed + time * 0.015));
    fine = fbm(vec3(q.x * 12.0, q.y * 36.0, seed + 5.0));
    density = smoothstep(0.3, 0.66, n + 0.1 * fine);
  }
  return vec2(density * edge, fine);
}

void main() {
  if (length(vUv) >= 1.0) discard;
  vec2 here = cover(vUv);
  // The same weather a little way towards the sun: its shadow falls here, and
  // where it is the thicker of the two, this side of the cloud is in its shade.
  float sunward = cover(vUv + sunLocal * reach).x;
  float density = here.x;
  float fine = here.y;

  vec3 N = normalize(vNormal);
  float ndl = dot(N, sunDir);
  float day = smoothstep(-0.14, 0.24, ndl);

  // What each kind is made of: its colour, how far it hides the map, how much it stands up.
  vec3 tint = vec3(0.93, 0.945, 0.96);
  float cap = 0.86;
  float relief = 1.0;
  if (kind > 0.5 && kind < 1.5) { tint = vec3(0.97, 0.985, 1.0); cap = 0.88; }
  else if (kind > 1.5 && kind < 2.5) { tint = vec3(0.96, 0.96, 0.97); cap = 0.92; relief = 1.3; }
  else if (kind > 2.5 && kind < 3.5) { tint = vec3(0.96, 0.965, 0.975); cap = 0.95; }
  else if (kind > 3.5 && kind < 4.5) { tint = vec3(0.7, 0.72, 0.75); cap = 0.6; relief = 0.15; }
  else if (kind > 4.5) { tint = vec3(0.5, 0.31, 0.15); cap = 0.86; relief = 0.3; }

  float amount = 0.5 + 0.5 * strength;
  float cloud = min(cap, density * amount) * opacity;
  float shadow = 0.42 * sunward * amount * opacity * day * relief;
  float alpha = 1.0 - (1.0 - cloud * mix(0.9, 1.0, day)) * (1.0 - shadow);
  if (alpha < 0.004) discard;

  float flash = 0.0;
  if (kind > 1.5 && kind < 2.5) {
    // Lit from inside now and then.
    vec2 g = vUv * 6.0;
    vec3 cell = vec3(floor(g), floor(time * 5.0) + seed);
    flash = step(0.972, hash13(cell)) * density * (1.0 - smoothstep(0.1, 0.5, length(fract(g) - 0.5)));
  }

  vec3 sunColor = mix(vec3(1.0, 0.66, 0.46), vec3(1.0), smoothstep(-0.04, 0.3, ndl));
  float shade = clamp(1.0 + (density - sunward) * 0.8 * relief, 0.7, 1.1);
  float body = (0.8 + 0.3 * fine) * shade;
  vec3 color = tint * sunColor * body * (0.92 * max(ndl, 0.0) * smoothstep(-0.1, 0.12, ndl) + 0.22 * day);
  // By night the weather still shows, as a paler shape over the dark map.
  color += tint * vec3(0.1, 0.125, 0.175) * (0.6 + 0.6 * fine) * (1.0 - day);
  color += vec3(0.8, 0.86, 1.0) * flash * (2.2 - 1.4 * day);

  float lit = cloud * mix(0.9, 1.0, day) + flash * 0.4;
  gl_FragColor = vec4(color * min(1.0, lit / alpha), min(1.0, alpha + flash * 0.3));
}
`;

interface Patch {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export class WeatherLayer {
  readonly group = new THREE.Group();
  /** Systems now drawn, with where their centres are: for labels. */
  readonly shown: { id: number; title: string; pos: THREE.Vector3; strength: number }[] = [];
  private geometry = new THREE.PlaneGeometry(2, 2, 28, 28);
  private patches = new Map<number, Patch>();
  private clock = 0;
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.renderOrder = 1;
  }

  private make(): Patch {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        centre: { value: new THREE.Vector3(1, 0, 0) },
        east: { value: new THREE.Vector3(0, 0, -1) },
        north: { value: new THREE.Vector3(0, 1, 0) },
        radius: { value: 0.1 },
        altitude: { value: ALTITUDE },
        sunDir: { value: new THREE.Vector3(1, 0, 0) },
        sunLocal: { value: new THREE.Vector2(0, 0) },
        reach: { value: 0.03 },
        scale: { value: 1 },
        kind: { value: 0 },
        seed: { value: 0 },
        time: { value: 0 },
        strength: { value: 1 },
        spin: { value: 1 },
        opacity: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    // The vertices are placed by the shader, far from where the flat patch sits.
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    return { mesh, material };
  }

  /**
   * Moves every system to where it is at `time` (game minutes) and lights it.
   * `dt` is real seconds, for the slow turning of the clouds.
   */
  update(sim: Sim | null, time: number, dt: number, sun: THREE.Vector3, visible: boolean, opacity = 1): void {
    this.clock += dt;
    this.shown.length = 0;
    this.group.visible = visible && !!sim;
    const seen = new Set<number>();
    if (sim && visible) {
      for (const a of activeWeather(sim, time)) {
        const w = a.system;
        seen.add(w.id);
        let patch = this.patches.get(w.id);
        if (!patch) {
          patch = this.make();
          this.patches.set(w.id, patch);
        }
        const u = patch.material.uniforms;
        const centre = u.centre.value as THREE.Vector3;
        centre.set(a.pos[0], a.pos[1], a.pos[2]);
        // Local east and north at the centre (the systems keep clear of the poles).
        const east = (u.east.value as THREE.Vector3).crossVectors(this.up, centre).normalize();
        const north = (u.north.value as THREE.Vector3).crossVectors(centre, east).normalize();
        const spread = w.radius * SPREAD;
        u.radius.value = spread / EARTH_RADIUS_KM;
        (u.sunDir.value as THREE.Vector3).copy(sun);
        // Which way the sun lies across the patch, and how far the cloud throws its shadow.
        (u.sunLocal.value as THREE.Vector2).set(sun.dot(east), sun.dot(north));
        u.reach.value = SHADOW_KM / spread;
        u.scale.value = spread / 800;
        u.kind.value = KIND[w.kind];
        u.seed.value = (w.id * 12.9898) % 97;
        u.time.value = this.clock;
        u.strength.value = Math.min(1, a.intensity / 0.6);
        // Storms turn anticlockwise north of the equator and clockwise south of it.
        u.spin.value = a.lat >= 0 ? 1 : -1;
        u.opacity.value = opacity * Math.min(1, a.intensity / 0.12);
        patch.mesh.visible = true;
        this.shown.push({ id: w.id, title: w.title, pos: centre, strength: a.intensity });
      }
    }
    for (const [id, patch] of this.patches) {
      if (seen.has(id)) continue;
      this.group.remove(patch.mesh);
      patch.material.dispose();
      this.patches.delete(id);
    }
  }

  dispose(): void {
    for (const patch of this.patches.values()) patch.material.dispose();
    this.patches.clear();
    this.geometry.dispose();
  }
}
