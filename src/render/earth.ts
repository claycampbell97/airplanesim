// The planet: surface, cloud deck and atmosphere.
//
// Everything is lit by a single directional sun in the Earth-fixed frame. The
// surface shader blends the daytime map into city lights across the terminator,
// adds relief shading from the elevation map, sun glint on water and cloud
// shadows. The atmosphere is a ray-marched single-scattering shell, which gives
// the blue limb, the haze towards the horizon and red sunsets for free.

import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`;

const SPHERE_VERT = /* glsl */ `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D auxMap;
uniform vec3 sunDir;
uniform vec2 texel;
uniform float cloudShift;
uniform float detail;
uniform float closeUp;
uniform float cloudShadows;
uniform float glintAmount;
varying vec3 vPos;
varying vec2 vUv;
${NOISE_GLSL}

void main() {
  vec3 N = normalize(vPos);
  vec3 V = normalize(cameraPosition - vPos);
  // Local east / north on the sphere (degenerate only exactly at the poles).
  vec3 east = normalize(vec3(N.z, 0.0, -N.x) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(N, east);
  float cosLat = max(0.12, sqrt(1.0 - N.y * N.y));

  vec3 aux = texture2D(auxMap, vUv).rgb;
  float land = smoothstep(0.3, 0.7, aux.g);

  // Relief: central differences on the elevation channel.
  // (A slightly wide kernel keeps compression artefacts in the map from showing up as ripples.)
  vec2 k = texel * 1.6;
  float hE = texture2D(auxMap, vUv + vec2(k.x, 0.0)).r - texture2D(auxMap, vUv - vec2(k.x, 0.0)).r;
  float hN = texture2D(auxMap, vUv + vec2(0.0, k.y)).r - texture2D(auxMap, vUv - vec2(0.0, k.y)).r;
  vec3 Nb = normalize(N - 3.0 * land * (hE / cosLat * east + hN * north));

  vec3 albedo = texture2D(dayMap, vUv).rgb;

  // Procedural fine detail fades in when the camera is close, where the maps run out of pixels.
  float grain = 0.0;
  if (detail > 0.001) {
    grain = fbm(N * 260.0) * 0.6 + fbm(N * 900.0) * 0.4 - 0.5;
    albedo *= 1.0 + grain * detail * mix(0.18, 0.55, land);
    Nb = normalize(Nb + (vnoise(N * 700.0) - 0.5) * detail * 0.22 * land * east + (vnoise(N * 700.0 + 9.7) - 0.5) * detail * 0.22 * land * north);
  }
  // Seen from just above the clouds the imagery is far past its resolution: lay a
  // finer, field-and-forest sized grain over it.
#ifdef CLOSE_UP
  {
    float fine = fbm(N * 2600.0) * 0.55 + fbm(N * 9000.0) * 0.45 - 0.5;
    albedo *= 1.0 + fine * closeUp * mix(0.1, 0.7, land);
    Nb = normalize(Nb + (vnoise(N * 5200.0) - 0.5) * closeUp * 0.18 * land * east + (vnoise(N * 5200.0 + 3.1) - 0.5) * closeUp * 0.18 * land * north);
  }
#endif

  // Open water is darker and less saturated than the map suggests.
  vec3 water = albedo * vec3(0.42, 0.56, 0.62) + vec3(0.0015, 0.004, 0.009);
  albedo = mix(water, albedo, land);

  float ndl = dot(N, sunDir);
  float ndlB = dot(Nb, sunDir);
  float day = smoothstep(-0.1, 0.22, ndl);

  // Sunlight reddens as it grazes the atmosphere near the terminator.
  vec3 sunColor = mix(vec3(1.0, 0.5, 0.26), vec3(1.0, 0.98, 0.95), smoothstep(-0.02, 0.32, ndl));

  // Shadows of the cloud deck, displaced away from the sun.
  vec2 toSun = vec2(dot(sunDir, east) / cosLat, dot(sunDir, north)) * 0.0022;
  float cloudAbove = cloudShadows * smoothstep(0.12, 0.8, texture2D(auxMap, vUv + vec2(cloudShift, 0.0)).b);
  float cloudShadow = smoothstep(0.12, 0.8, texture2D(auxMap, vUv + vec2(cloudShift, 0.0) + toSun).b);
  float shadow = 1.0 - 0.5 * cloudShadow * cloudShadows;

  float diffuse = max(ndlB, 0.0) * smoothstep(-0.06, 0.1, ndl);
  vec3 color = albedo * sunColor * diffuse * shadow * 1.25;
  // Sky light fills the shadows on the day side.
  color += albedo * vec3(0.05, 0.075, 0.12) * day;

  // Sun glint and sky reflection on water.
  vec3 Nw = N;
  if (detail > 0.001) Nw = normalize(N + (vec3(vnoise(N * 1500.0), vnoise(N * 1500.0 + 4.1), vnoise(N * 1500.0 + 8.3)) - 0.5) * 0.02 * detail);
  vec3 H = normalize(sunDir + V);
  float nh = max(dot(Nw, H), 0.0);
  // From orbit the glint is kept small, so that it is not taken for weather on the
  // clear map; in the flight view it is the sea shining through the gaps in the cloud.
  float glint = (pow(nh, mix(260.0, 70.0, closeUp)) * mix(0.03, 0.8, closeUp) + pow(nh, mix(1600.0, 420.0, closeUp)) * mix(0.16, 2.4, closeUp)) * mix(glintAmount, 1.0, closeUp);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  float wet = (1.0 - land) * (1.0 - 0.75 * cloudAbove);
  color += sunColor * glint * wet * smoothstep(0.0, 0.15, ndl);
  color += vec3(0.1, 0.18, 0.3) * fresnel * wet * day * 0.5;

  // City lights on the night side, dimmed under cloud.
  vec3 lights = texture2D(nightMap, vUv).rgb;
  float lum = max(max(lights.r, lights.g), lights.b);
  vec3 glow = lights * smoothstep(0.035, 0.22, lum) * vec3(1.0, 0.82, 0.6);
#ifdef CLOSE_UP
  {
    // From cruising height a city is not a smudge of light but districts and
    // streets: break the map up into them. Far away, where a street is smaller
    // than a pixel, settle on the average instead of shimmering.
    vec3 q = N * 26000.0;
    float streets = smoothstep(0.2, 0.62, vnoise(q) * vnoise(q * 2.3 + 11.0) * 2.2);
    float district = smoothstep(0.25, 0.8, fbm(N * 2400.0));
    float fine = 1.0 - smoothstep(0.3, 1.1, length(fwidth(q)));
    float pattern = (0.1 + 0.5 * district) + 2.6 * district * mix(0.3, streets, fine);
    glow *= mix(1.0, 0.62 * pattern, closeUp);
  }
#endif
  color += glow * (1.0 - day) * (1.0 - 0.55 * cloudAbove) * 2.4;
  // A whisper of moonlight so the night side is not a black hole.
  color += albedo * vec3(0.012, 0.016, 0.028) * (1.0 - day);

  gl_FragColor = vec4(color, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D auxMap;
uniform vec3 sunDir;
uniform vec2 texel;
uniform float cloudShift;
uniform float detail;
uniform float closeUp;
uniform float opacity;
varying vec3 vPos;
varying vec2 vUv;
${NOISE_GLSL}

void main() {
  vec3 N = normalize(vPos);
  vec3 east = normalize(vec3(N.z, 0.0, -N.x) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(N, east);
  float cosLat = max(0.12, sqrt(1.0 - N.y * N.y));
  vec2 uv = vUv + vec2(cloudShift, 0.0);

  float c = texture2D(auxMap, uv).b;
  if (detail > 0.001) {
    // Break up the soft edges of the cloud map with wispy structure.
    float n = fbm(N * 340.0 + vec3(cloudShift * 40.0)) - 0.5;
    c = clamp(c + n * detail * 0.55 * smoothstep(0.03, 0.4, c), 0.0, 1.0);
  }
  float lo = 0.1;
  float hi = 0.72;
#ifdef CLOSE_UP
  {
    // Up close, give the deck billowing edges and a firmer outline.
    float n2 = fbm(N * 1700.0 + vec3(cloudShift * 90.0)) * 0.6 + fbm(N * 5200.0) * 0.4 - 0.5;
    c = clamp(c + n2 * closeUp * 0.7 * smoothstep(0.02, 0.45, c), 0.0, 1.0);
    lo = mix(0.1, 0.24, closeUp);
    hi = mix(0.72, 0.5, closeUp);
  }
#endif
  float alpha = smoothstep(lo, hi, c);
  if (alpha < 0.003) discard;

  // Fake volume: treat density as height and shade its slope.
  vec2 k = texel * 2.5;
  float cE = texture2D(auxMap, uv + vec2(k.x, 0.0)).b - texture2D(auxMap, uv - vec2(k.x, 0.0)).b;
  float cN = texture2D(auxMap, uv + vec2(0.0, k.y)).b - texture2D(auxMap, uv - vec2(0.0, k.y)).b;
  vec3 Nc = normalize(N - 0.9 * (cE / cosLat * east + cN * north));

  float ndl = dot(N, sunDir);
  float day = smoothstep(-0.14, 0.24, ndl);
  vec3 sunColor = mix(vec3(1.0, 0.46, 0.24), vec3(1.0), smoothstep(-0.04, 0.3, ndl));
  float diffuse = max(dot(Nc, sunDir), 0.0) * smoothstep(-0.1, 0.12, ndl);
  vec3 color = sunColor * (diffuse * 1.05 + 0.16 * day) * mix(0.82, 1.0, c);
  color += vec3(0.01, 0.013, 0.02) * (1.0 - day);

  gl_FragColor = vec4(color, alpha * opacity * mix(0.5, 1.0, day));
}
`;

const ATMOSPHERE_FRAG = /* glsl */ `
uniform vec3 sunDir;
uniform float planetRadius;
uniform float atmoRadius;
uniform vec3 betaR;
uniform float betaM;
uniform float scaleR;
uniform float scaleM;
uniform float intensity;
varying vec3 vPos;

#define PI 3.14159265359

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1.0, -1.0);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPos - cameraPosition);
  vec2 ta = raySphere(ro, rd, atmoRadius);
  if (ta.x > ta.y || ta.y < 0.0) discard;
  float t0 = max(ta.x, 0.0);
  float t1 = ta.y;
  vec2 tp = raySphere(ro, rd, planetRadius);
  if (tp.x < tp.y && tp.x > 0.0) t1 = min(t1, tp.x);

  float seg = (t1 - t0) / float(VIEW_STEPS);
  // Jitter the sample positions to trade banding for fine noise.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;

  for (int i = 0; i < VIEW_STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + jitter) * seg);
    float h = max(length(p) - planetRadius, 0.0);
    float dR = exp(-h / scaleR) * seg;
    float dM = exp(-h / scaleM) * seg;
    odR += dR;
    odM += dM;

    // Optical depth towards the sun. Samples that dip below the surface become
    // very dense, which produces the planet's shadow without a separate test.
    float lt = raySphere(p, sunDir, atmoRadius).y;
    float lseg = lt / float(LIGHT_STEPS);
    float lR = 0.0;
    float lM = 0.0;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      vec3 q = p + sunDir * ((float(j) + 0.5) * lseg);
      float hq = length(q) - planetRadius;
      float dense = hq < 0.0 ? 60.0 : 1.0;
      hq = max(hq, 0.0);
      lR += exp(-hq / scaleR) * lseg * dense;
      lM += exp(-hq / scaleM) * lseg * dense;
    }
    vec3 atten = exp(-(betaR * (odR + lR) + betaM * 1.1 * (odM + lM)));
    sumR += dR * atten;
    sumM += dM * atten;
  }

  float mu = dot(rd, sunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.78;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 color = intensity * (sumR * betaR * phaseR + sumM * betaM * phaseM);
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface EarthTextures {
  day: THREE.Texture;
  night: THREE.Texture;
  aux: THREE.Texture;
}

export interface EarthOptions {
  /** Ray-march steps along the view ray / towards the sun. */
  viewSteps: number;
  lightSteps: number;
  segments: number;
}

export const CLOUD_ALTITUDE = 0.0055;
export const ATMOSPHERE_HEIGHT = 0.028;

export class Earth {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  readonly clouds: THREE.Mesh;
  readonly atmosphere: THREE.Mesh;
  private surfaceMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private atmoMat: THREE.ShaderMaterial;
  private cloudShift = 0;
  private closeUp = 0;
  private closeUpCompiled = false;

  constructor(tex: EarthTextures, opts: EarthOptions) {
    const image = tex.aux.image as { width?: number; height?: number } | undefined;
    const texel = new THREE.Vector2(1 / (image?.width ?? 4096), 1 / (image?.height ?? 2048));
    const sun = new THREE.Vector3(1, 0, 0);

    this.surfaceMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: tex.day },
        nightMap: { value: tex.night },
        auxMap: { value: tex.aux },
        sunDir: { value: sun },
        texel: { value: texel },
        cloudShift: { value: 0 },
        detail: { value: 0 },
        closeUp: { value: 0 },
        cloudShadows: { value: 1 },
        glintAmount: { value: 1 },
      },
      vertexShader: SPHERE_VERT,
      fragmentShader: SURFACE_FRAG,
    });
    const geo = new THREE.SphereGeometry(1, opts.segments, opts.segments / 2);
    this.surface = new THREE.Mesh(geo, this.surfaceMat);
    this.surface.renderOrder = 0;

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        auxMap: { value: tex.aux },
        sunDir: { value: sun },
        texel: { value: texel },
        cloudShift: { value: 0 },
        detail: { value: 0 },
        closeUp: { value: 0 },
        opacity: { value: 1 },
      },
      vertexShader: SPHERE_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(geo, this.cloudMat);
    this.clouds.scale.setScalar(1 + CLOUD_ALTITUDE);
    this.clouds.renderOrder = 1;

    // Scale heights are exaggerated a little relative to the shell so that a
    // handful of samples resolve them; the coefficients keep real optical depths.
    const scaleR = ATMOSPHERE_HEIGHT * 0.2;
    const scaleM = ATMOSPHERE_HEIGHT * 0.09;
    this.atmoMat = new THREE.ShaderMaterial({
      defines: { VIEW_STEPS: opts.viewSteps, LIGHT_STEPS: opts.lightSteps },
      uniforms: {
        sunDir: { value: sun },
        planetRadius: { value: 1 },
        atmoRadius: { value: 1 + ATMOSPHERE_HEIGHT },
        betaR: { value: new THREE.Vector3(0.046, 0.108, 0.265).multiplyScalar(1 / scaleR) },
        betaM: { value: 0.03 / scaleM },
        scaleR: { value: scaleR },
        scaleM: { value: scaleM },
        intensity: { value: 5.5 },
      },
      vertexShader: SPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1 + ATMOSPHERE_HEIGHT, 96, 48), this.atmoMat);
    this.atmosphere.renderOrder = 2;

    this.group.add(this.surface, this.clouds, this.atmosphere);
  }

  setSun(dir: THREE.Vector3): void {
    (this.surfaceMat.uniforms.sunDir.value as THREE.Vector3).copy(dir);
  }

  /** How strongly the sun glints off the sea as seen from orbit, 0..1. */
  setGlint(amount: number): void {
    this.surfaceMat.uniforms.glintAmount.value = amount;
  }

  /**
   * `altitude` is the camera's height above the surface in Earth radii. `closeUp`
   * (0..1) is 1 when the camera skims the cloud tops in the flight view.
   */
  update(dtSeconds: number, altitude: number, closeUp = 0): void {
    const k = 1 - Math.exp(-dtSeconds * 3);
    this.closeUp += (closeUp - this.closeUp) * k;
    this.surfaceMat.uniforms.closeUp.value = this.closeUp;
    this.cloudMat.uniforms.closeUp.value = this.closeUp;
    // The extra detail is compiled in only while it is needed, so the view from
    // orbit never pays for it.
    const detailed = closeUp > 0 || this.closeUp > 0.004;
    if (detailed !== this.closeUpCompiled) {
      this.closeUpCompiled = detailed;
      for (const m of [this.surfaceMat, this.cloudMat]) {
        if (detailed) m.defines = { ...m.defines, CLOSE_UP: '' };
        else if (m.defines) delete m.defines.CLOSE_UP;
        m.needsUpdate = true;
      }
    }
    this.setCloudDeck(this.closeUp);
    // A deeper sky around the aircraft than the thin limb seen from orbit.
    this.atmoMat.uniforms.intensity.value = 5.5 + 5.5 * this.closeUp;
    // Weather drifts slowly eastwards.
    this.cloudShift = (this.cloudShift + dtSeconds * 0.00022) % 1;
    const detail = THREE.MathUtils.smoothstep(1.4 - altitude, 0, 1.25);
    this.surfaceMat.uniforms.cloudShift.value = this.cloudShift;
    this.surfaceMat.uniforms.detail.value = detail;
    this.cloudMat.uniforms.cloudShift.value = this.cloudShift;
    this.cloudMat.uniforms.detail.value = detail;
  }

  /**
   * How much of the cloud deck to draw, 0..1. The map seen from orbit is kept clear
   * (the weather that matters is drawn by the weather layer); the deck belongs to the
   * flight view, where it is scenery.
   */
  setCloudDeck(amount: number): void {
    this.clouds.visible = amount > 0.004;
    this.cloudMat.uniforms.opacity.value = amount;
    this.surfaceMat.uniforms.cloudShadows.value = amount;
  }

  setAtmosphereQuality(viewSteps: number, lightSteps: number): void {
    this.atmoMat.defines.VIEW_STEPS = viewSteps;
    this.atmoMat.defines.LIGHT_STEPS = lightSteps;
    this.atmoMat.needsUpdate = true;
  }

  dispose(): void {
    this.surface.geometry.dispose();
    this.atmosphere.geometry.dispose();
    this.surfaceMat.dispose();
    this.cloudMat.dispose();
    this.atmoMat.dispose();
  }
}
