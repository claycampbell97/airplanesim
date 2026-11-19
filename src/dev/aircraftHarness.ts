// Developer harness for the aircraft models: shows the hangar viewer full-window,
// driven by URL parameters, so that every type and livery can be captured.
//
//   ?dev=aircraft&type=a20n&style=cheatline&primary=%232563eb&secondary=%23f59e0b
//       &base=%23ffffff&emblem=bird&az=35&el=12&zoom=1&gear=1&name=Demo%20Air&reg=G-DEMO
//       &detail=high&stats=1&w=420&h=260
//
// With `az` the turntable is stopped and the camera placed at that azimuth
// (degrees from the nose towards port) and elevation.

import { AIRCRAFT_TYPE } from '../sim/data/aircraft';
import type { Livery } from '../sim/types';
import { renderLogo } from '../render/aircraft/livery';
import { AircraftViewer } from '../render/aircraft/viewer';

export async function runAircraftHarness(params: URLSearchParams): Promise<void> {
  document.body.style.cssText = 'margin:0;overflow:hidden;background:radial-gradient(1100px 640px at 50% 58%,#15233d 0%,#0b1220 55%,#070b14 100%);height:100vh;font:12px/1.4 system-ui,sans-serif;color:#cbd5e1';
  const canvas = document.createElement('canvas');
  const w = params.get('w');
  const h = params.get('h');
  canvas.style.cssText = w && h
    ? `position:fixed;left:24px;top:24px;width:${w}px;height:${h}px;display:block;border:1px solid #1e293b;border-radius:10px;background:#0a101c`
    : 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
  document.body.appendChild(canvas);

  const type = AIRCRAFT_TYPE[params.get('type') ?? 'a20n'] ?? AIRCRAFT_TYPE.a20n;
  const livery: Livery = {
    primary: params.get('primary') ?? '#2563eb',
    secondary: params.get('secondary') ?? '#f59e0b',
    base: params.get('base') ?? '#f8fafc',
    style: (params.get('style') as Livery['style']) ?? 'cheatline',
    emblem: (params.get('emblem') as Livery['emblem']) ?? 'bird',
  };
  const viewer = new AircraftViewer(canvas);
  viewer.setAircraft(type, livery, {
    gear: params.get('gear') !== '0',
    airlineName: params.get('name') ?? 'Skyledger',
    registration: params.get('reg') ?? 'G-SKYL',
    detail: params.get('detail') === 'low' ? 'low' : 'high',
  });
  if (params.has('az')) {
    viewer.autoRotate = false;
    viewer.setView(Number(params.get('az')), Number(params.get('el') ?? 12), Number(params.get('zoom') ?? 1));
  }
  // Close-up inspection: &look=x,y,z (metres, y measured from the ground) &dist=metres
  if (params.has('look')) {
    const [x, y, z] = (params.get('look') ?? '0,0,0').split(',').map(Number);
    const inner = viewer as unknown as { controls: { target: { set(x: number, y: number, z: number): void }; minDistance: number; update(): void }; camera: { position: { set(x: number, y: number, z: number): void }; near: number; updateProjectionMatrix(): void } };
    const az = (Number(params.get('az') ?? 40) * Math.PI) / 180;
    const el = (Number(params.get('el') ?? 10) * Math.PI) / 180;
    const d = Number(params.get('dist') ?? 12);
    inner.controls.minDistance = 0.5;
    inner.controls.target.set(x, y, z);
    inner.camera.position.set(x + d * Math.sin(az) * Math.cos(el), y + d * Math.sin(el), z + d * Math.cos(az) * Math.cos(el));
    inner.camera.near = 0.1;
    inner.camera.updateProjectionMatrix();
    inner.controls.update();
  }
  viewer.start();
  window.addEventListener('resize', () => viewer.resize());

  if (params.get('stats') === '1') {
    const model = (viewer as unknown as { model: { userData: { triangles: number; buildMs: number; length: number; span: number; height: number } } }).model;
    const info = document.createElement('div');
    info.style.cssText = 'position:fixed;left:12px;bottom:10px;display:flex;gap:10px;align-items:center';
    const logo = renderLogo(livery, 40);
    logo.style.cssText = 'width:40px;height:40px';
    const text = document.createElement('div');
    const u = model.userData;
    text.textContent = `${type.maker} ${type.model} · ${u.triangles.toLocaleString()} triangles · built in ${u.buildMs.toFixed(0)} ms · ${u.length.toFixed(1)} × ${u.span.toFixed(1)} × ${u.height.toFixed(1)} m`;
    info.append(logo, text);
    document.body.appendChild(info);
  }

  let frames = 0;
  const wait = () => {
    if (++frames >= 6) (window as unknown as { __ready: boolean }).__ready = true;
    else requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
  // Build-time benchmark for the console: await __bench() → [{ type, ms, triangles }].
  const bench = async (rounds = 3) => {
    const { AIRCRAFT_TYPES } = await import('../sim/data/aircraft');
    const { buildAircraftModel, disposeAircraftModel } = await import('../render/aircraft/model');
    const out: { type: string; ms: number; low: number; triangles: number }[] = [];
    for (const t of AIRCRAFT_TYPES) {
      let best = Infinity;
      let bestLow = Infinity;
      let triangles = 0;
      for (let i = 0; i < rounds; i++) {
        let t0 = performance.now();
        const m = buildAircraftModel(t, livery, { airlineName: 'Skyledger', registration: 'G-SKYL' });
        best = Math.min(best, performance.now() - t0);
        triangles = m.userData.triangles as number;
        disposeAircraftModel(m);
        t0 = performance.now();
        const l = buildAircraftModel(t, livery, { detail: 'low', gear: false });
        bestLow = Math.min(bestLow, performance.now() - t0);
        disposeAircraftModel(l);
      }
      out.push({ type: t.id, ms: Math.round(best * 10) / 10, low: Math.round(bestLow * 10) / 10, triangles });
    }
    return out;
  };
  Object.assign(window, { __viewer: viewer, __bench: bench });
}
