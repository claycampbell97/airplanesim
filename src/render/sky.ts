// Everything beyond the atmosphere: the Milky Way, a field of point stars and the sun.

import * as THREE from 'three';
import { DEG } from '../sim/geo';

const STAR_VERT = /* glsl */ `
attribute float size;
attribute vec3 tint;
uniform float pixelRatio;
varying vec3 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * pixelRatio;
}
`;

const STAR_FRAG = /* glsl */ `
uniform float brightness;
varying vec3 vTint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(vTint * a * a * brightness, 1.0);
}
`;

const SUN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv - 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SUN_FRAG = /* glsl */ `
varying vec2 vUv;
void main() {
  float r = length(vUv) * 2.0;
  // A hard, very bright disc with a soft corona; bloom does the rest.
  float disc = smoothstep(0.075, 0.06, r);
  float corona = pow(max(0.0, 1.0 - r), 5.0);
  vec3 color = vec3(1.0, 0.96, 0.88) * (disc * 60.0 + corona * 2.2);
  gl_FragColor = vec4(color, 1.0);
}
`;

/** Deterministic pseudo-random stream so the sky looks the same every session. */
function mulberry(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKY_RADIUS = 60;

export class Sky {
  /** Rotates with sidereal time; holds everything fixed to the stars. */
  readonly group = new THREE.Group();
  readonly sun: THREE.Mesh;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private milkyWay: THREE.Mesh;

  constructor(milkyWayTexture: THREE.Texture, starCount: number) {
    // The Milky Way panorama is in galactic coordinates: tilt it into the
    // equatorial frame (the galactic pole sits at RA 192.86°, Dec +27.13°).
    const mwMat = new THREE.MeshBasicMaterial({ map: milkyWayTexture, side: THREE.BackSide, depthWrite: false, depthTest: false });
    mwMat.color.setScalar(1.7);
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), mwMat);
    this.milkyWay.rotation.set(62.87 * DEG, 0, 0, 'ZXY');
    this.milkyWay.rotation.y = 192.86 * DEG;
    this.milkyWay.renderOrder = -3;
    this.group.add(this.milkyWay);

    const rnd = mulberry(20270101);
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const tints = new Float32Array(starCount * 3);
    const color = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      // Uniform on the sphere.
      const z = rnd() * 2 - 1;
      const phi = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      positions[i * 3] = r * Math.cos(phi) * SKY_RADIUS;
      positions[i * 3 + 1] = z * SKY_RADIUS;
      positions[i * 3 + 2] = r * Math.sin(phi) * SKY_RADIUS;
      // Many faint stars, few bright ones.
      const mag = Math.pow(rnd(), 5);
      sizes[i] = 1.2 + mag * 2.6;
      // Colour temperature from blue-white to orange.
      const temp = rnd();
      color.setHSL(temp < 0.7 ? 0.6 : 0.08, temp < 0.7 ? 0.25 * rnd() : 0.5 * rnd(), 0.82);
      const b = 0.35 + mag * 1.6;
      tints[i * 3] = color.r * b;
      tints[i * 3 + 1] = color.g * b;
      tints[i * 3 + 2] = color.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { pixelRatio: { value: 1 }, brightness: { value: 1 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.renderOrder = -2;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: SUN_VERT,
        fragmentShader: SUN_FRAG,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.sun.scale.setScalar(22);
    this.sun.renderOrder = -1;
  }

  /** `gmst` in degrees: turns the star sphere against the Earth-fixed scene. */
  update(gmst: number, sunDir: THREE.Vector3, camera: THREE.Camera, pixelRatio: number): void {
    this.group.rotation.y = -gmst * DEG;
    this.group.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(sunDir, SKY_RADIUS * 0.9);
    this.sun.quaternion.copy(camera.quaternion);
    this.starMat.uniforms.pixelRatio.value = pixelRatio;
  }

  setBrightness(v: number): void {
    this.starMat.uniforms.brightness.value = v;
    (this.milkyWay.material as THREE.MeshBasicMaterial).color.setScalar(1.7 * v);
  }

  dispose(): void {
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.milkyWay.geometry.dispose();
    (this.milkyWay.material as THREE.Material).dispose();
    this.sun.geometry.dispose();
    (this.sun.material as THREE.Material).dispose();
  }
}
