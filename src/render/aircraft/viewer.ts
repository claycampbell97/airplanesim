// The hangar: a small self-contained showroom that renders one aircraft on a
// turntable. It owns its own WebGL context so it can live inside any panel of the
// interface, independent of the globe.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AircraftType, Livery } from '../../sim/types';
import { buildAircraftModel, disposeAircraftModel } from './model';
import type { AircraftModelOptions } from './model';

const DEG = Math.PI / 180;

/**
 * Soft studio reflections for glossy paint. Assign the result to
 * `scene.environment`; the caller owns (and should dispose) the texture.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.035).texture;
  room.dispose();
  pmrem.dispose();
  return texture;
}

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [t, color] of stops) g.addColorStop(t, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class AircraftViewer {
  /** Slowly turn the aircraft when the user is not dragging it. */
  autoRotate = true;

  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.5, 4000);
  private controls: OrbitControls;
  private turntable = new THREE.Group();
  private model: THREE.Group | null = null;
  private mirror: THREE.Group | null = null;
  private floor: THREE.Mesh;
  private glow: THREE.Mesh;
  private rim: THREE.Mesh;
  private key: THREE.DirectionalLight;
  private env: THREE.Texture;
  private textures: THREE.Texture[] = [];
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private sinceInput = 10;
  private dragging = false;
  private spin = 0;
  /** Camera distance that frames the aircraft, and the user's zoom relative to it. */
  private frameDistance = 60;
  /** Half the larger of length and span, and the overall height. */
  private radius = 30;
  private tall = 10;
  private width = 0;
  private height = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.env = createStudioEnvironment(this.renderer);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.9;

    // Lighting: a warm key with shadows, a cool fill and a rim from behind.
    this.key = new THREE.DirectionalLight(0xfff3e2, 2.6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.04;
    this.key.shadow.radius = 6;
    const fill = new THREE.DirectionalLight(0xbdd3ff, 0.75);
    fill.position.set(0.9, 0.4, -0.3);
    const back = new THREE.DirectionalLight(0xffffff, 1.5);
    back.position.set(0.25, 0.45, -1);
    this.scene.add(this.key, this.key.target, fill, back, new THREE.HemisphereLight(0xe2ebff, 0x0d1320, 0.4));

    // Floor: a dark disc lit by a pool of light in the middle, fading out at the edge
    // so the stage blends into any dark panel. The pool is part of the floor's own
    // colour, which lets the aircraft's shadow fall across it.
    const fade = radialTexture([[0, '#ffffff'], [0.55, '#ffffff'], [0.85, '#303030'], [1, '#000000']]);
    const pool = radialTexture([[0, '#3a4660'], [0.22, '#2a344a'], [0.5, '#1a2233'], [0.8, '#0f1522'], [1, '#090d16']]);
    const glowTex = radialTexture([[0, 'rgba(110,150,225,0.5)'], [0.4, 'rgba(70,105,180,0.18)'], [1, 'rgba(40,70,140,0)']]);
    this.textures.push(fade, pool, glowTex);
    const disc = new THREE.CircleGeometry(1, 96);
    disc.rotateX(-Math.PI / 2);
    // Matte and slightly see-through: the mirrored aircraft underneath reads as a
    // soft reflection in a polished floor.
    this.floor = new THREE.Mesh(disc, new THREE.MeshLambertMaterial({ map: pool, transparent: true, alphaMap: fade, opacity: 0.915 }));
    this.floor.receiveShadow = true;
    this.floor.renderOrder = 1;
    // A faint bloom over the pool.
    this.glow = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.16 }));
    this.glow.position.y = 0.004;
    this.glow.renderOrder = 2;
    // Turntable edge.
    const ringGeo = new THREE.RingGeometry(0.992, 1, 160);
    ringGeo.rotateX(-Math.PI / 2);
    this.rim = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x7aa2e8, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rim.position.y = 0.006;
    this.rim.renderOrder = 2;
    this.scene.add(this.floor, this.glow, this.rim, this.turntable);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.minPolarAngle = 12 * DEG;
    this.controls.maxPolarAngle = 89.2 * DEG;
    this.controls.addEventListener('start', () => {
      this.dragging = true;
      this.sinceInput = 0;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
      this.sinceInput = 0;
    });
    canvas.addEventListener('wheel', this.onWheel, { passive: true });

    this.resize();
    this.setView(38, 12);
  }

  private onWheel = (): void => {
    this.sinceInput = 0;
  };

  /** Swaps the displayed aircraft (rebuilds the model). */
  setAircraft(type: AircraftType, livery: Livery, opts: AircraftModelOptions = {}): void {
    if (this.disposed) return;
    const zoom = this.zoom;
    this.clearModel();
    const model = buildAircraftModel(type, livery, opts);
    const u = model.userData as { groundY: number; length: number; span: number; height: number };
    model.position.y = -u.groundY;
    this.model = model;
    this.turntable.add(model);

    // Floor reflection: the same meshes, flipped below the floor (they share geometry and materials).
    const mirror = new THREE.Group();
    for (const child of model.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh.material instanceof THREE.MeshBasicMaterial) continue;
      const twin = new THREE.Mesh(mesh.geometry, mesh.material);
      twin.position.copy(mesh.position);
      mirror.add(twin);
    }
    mirror.position.y = u.groundY;
    mirror.scale.y = -1;
    this.mirror = mirror;
    this.turntable.add(mirror);

    // Stage and shadow sized to the aircraft.
    this.radius = 0.5 * Math.max(u.length, u.span);
    this.tall = u.height;
    const reach = 0.5 * Math.hypot(u.length, u.span);
    this.floor.scale.setScalar(reach * 2.1);
    this.glow.scale.setScalar(reach * 1.5);
    this.rim.scale.setScalar(reach * 1.12);
    const r = reach * 1.08;
    this.key.position.set(-0.55 * r * 3, 1.0 * r * 3, 0.7 * r * 3);
    this.key.target.position.set(0, 0, 0);
    const cam = this.key.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = r * 0.5;
    cam.far = r * 7;
    cam.updateProjectionMatrix();

    this.controls.target.set(0, u.height * 0.36, 0);
    this.reframe(zoom);
  }

  private clearModel(): void {
    if (this.mirror) {
      // The reflection only borrows the model's geometry and materials.
      this.turntable.remove(this.mirror);
      this.mirror.clear();
      this.mirror = null;
    }
    if (this.model) {
      this.turntable.remove(this.model);
      disposeAircraftModel(this.model);
      this.model = null;
    }
  }

  /** How far the user has zoomed relative to the framing distance (1 = framed). */
  private get zoom(): number {
    const d = this.camera.position.distanceTo(this.controls.target);
    return d > 0 && this.frameDistance > 0 ? this.frameDistance / d : 1;
  }

  /** Recomputes the distance at which the whole aircraft fits, keeping the current view direction. */
  private reframe(zoom = 1): void {
    const aspect = this.camera.aspect;
    const tanV = Math.tan((this.camera.fov * DEG) / 2);
    const tanH = tanV * aspect;
    // Wide enough for the aircraft side-on or head-on, tall enough for a three-quarter view.
    this.frameDistance = 1.07 * Math.max((this.radius * 1.03) / tanH, (0.5 * this.tall + 0.3 * this.radius) / tanV);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.25, 0.75);
    dir.normalize();
    const z = Math.max(0.45, Math.min(2.4, zoom));
    this.camera.position.copy(this.controls.target).addScaledVector(dir, this.frameDistance / z);
    this.controls.minDistance = this.frameDistance * 0.38;
    this.controls.maxDistance = this.frameDistance * 2.2;
    this.camera.near = Math.max(0.2, this.frameDistance * 0.02);
    this.camera.far = this.frameDistance * 12;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Places the camera: `azimuth` in degrees from the nose towards the port side
   * (0 = head-on, 90 = port beam, 180 = from behind), `elevation` above the horizon.
   * Also resets the turntable so the view is repeatable.
   */
  setView(azimuth: number, elevation: number, zoom = 1): void {
    const az = azimuth * DEG;
    const el = Math.max(1, Math.min(78, elevation)) * DEG;
    const d = this.frameDistance / Math.max(0.45, Math.min(2.4, zoom));
    this.turntable.rotation.y = 0;
    this.camera.position.set(
      this.controls.target.x + d * Math.sin(az) * Math.cos(el),
      this.controls.target.y + d * Math.sin(el),
      this.controls.target.z + d * Math.cos(az) * Math.cos(el),
    );
    this.controls.update();
  }

  /** Call on layout changes. */
  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    if (w === this.width && h === this.height) return;
    const zoom = this.zoom;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.reframe(zoom);
  }

  /** Renders a single frame (used by the loop, and handy when paused). */
  render(dt = 0): void {
    if (this.disposed) return;
    this.time += dt;
    this.sinceInput += dt;
    // Ease the turntable in and out around user input.
    const want = this.autoRotate && !this.dragging && this.sinceInput > 2.2 ? 1 : 0;
    this.spin += (want - this.spin) * Math.min(1, dt * 2.5);
    this.turntable.rotation.y += this.spin * 0.24 * dt;
    this.controls.update();
    const update = this.model?.userData.update as ((dt: number, t: number) => void) | undefined;
    update?.(dt, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // Follow the element if the layout changed without anyone telling us.
    if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height) this.resize();
    this.render(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.sinceInput = 10;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.controls.dispose();
    this.clearModel();
    for (const mesh of [this.floor, this.glow, this.rim]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const t of this.textures) t.dispose();
    this.key.shadow.map?.dispose();
    this.env.dispose();
    this.renderer.dispose();
    // Give the context back straight away; browsers only allow a handful at once.
    this.renderer.forceContextLoss();
  }
}
