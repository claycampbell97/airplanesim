// Developer harness: renders the globe on its own, driven by URL parameters, so
// that views can be captured and compared without playing the game.
//
//   ?dev=globe&lat=48&lon=10&alt=1.2&t=720&q=high&sun=real
//   ?dev=globe&sim=LHR&days=20&routes=8      (a quick demo airline based at LHR)
//
// `t` is game time in minutes; `q` the quality preset; `rate` game minutes per second.

import { acquireAircraft, openRoute, setRotation } from '../sim/actions';
import { suggestRoutes } from '../sim/planner';
import { Sim } from '../sim/sim';
import { GlobeRenderer } from '../render/GlobeRenderer';
import type { Quality } from '../render/GlobeRenderer';

const LABEL_CSS = `
.ap-label{position:absolute;left:0;top:0;font:600 11px/1.2 Inter,system-ui,sans-serif;color:#dbeafe;white-space:nowrap;pointer-events:none;text-shadow:0 0 4px #000,0 0 2px #000;will-change:transform}
.ap-label b{font-weight:700;letter-spacing:.04em}
.ap-label span{margin-left:5px;font-weight:500;opacity:.75}
.ap-label[data-kind=hub]{color:#ffd166}
.ap-label[data-kind=served]{color:#99f6e4}
.ap-label[data-kind=selected]{color:#fff}
`;

export async function runHarness(params: URLSearchParams): Promise<void> {
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const style = document.createElement('style');
  style.textContent = LABEL_CSS;
  document.head.appendChild(style);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none';
  document.body.append(canvas, labels);

  const num = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback);
  const globe = new GlobeRenderer(canvas, (params.get('q') as Quality) ?? 'high', labels);
  await globe.load();
  globe.controls.setPose({ lat: num('lat', 30), lon: num('lon', 0), altitude: num('alt', 3.2) });
  globe.sunMode = params.get('sun') === 'studio' ? 'studio' : 'real';
  if (params.get('clouds') === '0') globe.setLayers({ clouds: false });
  if (params.get('rivals') === '1') globe.setLayers({ rivalRoutes: true });

  let sim: Sim | null = null;
  const hq = params.get('sim');
  if (hq) {
    sim = Sim.create({
      name: 'Demo Air', code: 'DM', hq, difficulty: 'relaxed', seed: 42,
      livery: { primary: params.get('color') ?? '#22d3ee', secondary: '#f59e0b', base: '#f8fafc', style: 'cheatline', emblem: 'chevron' },
    });
    const routes = num('routes', 8);
    const types = (params.get('types') ?? 'a20n,b789').split(',');
    for (let i = 0; i < routes; i++) {
      const type = types[i % types.length];
      const plan = suggestRoutes(sim, sim.player, hq, type, 1)[0];
      if (!plan) continue;
      const route = openRoute(sim, 0, plan.a, plan.b);
      if (!route.ok) continue;
      sim.player.cash += 5e8;
      const order = acquireAircraft(sim, 0, type, { lease: false });
      if (order.ok) setRotation(sim, sim.fleetOf(0)[sim.fleetOf(0).length - 1].id, [route.value.id]);
    }
    for (let d = 0; d < num('days', 30); d++) sim.advance(1440);
    sim.advance(num('t', 720));
    globe.setSim(sim);
    if (params.get('select')) globe.setSelection({ airport: params.get('select') });
  }
  const start = sim ? sim.game.time : num('t', 720);
  const rate = num('rate', 0);

  let last = performance.now();
  let frames = 0;
  let elapsed = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    if (sim && rate) sim.advance(dt * rate);
    globe.frame(dt, sim ? sim.renderTime : start + elapsed * rate, rate > 150);
    frames++;
    if (frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(loop);
  };
  window.addEventListener('resize', () => globe.resize());
  requestAnimationFrame(loop);
  Object.assign(window, { __globe: globe, __sim: sim });
}
