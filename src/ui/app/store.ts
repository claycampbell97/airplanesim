// Application state: which screen and panel are showing, what is selected, the
// game clock, and the glue between the simulation, the globe and the interface.
//
// The simulation itself is mutable and lives outside React. Components that show
// simulation data subscribe to `tick`, which is bumped a few times a second while
// the clock runs and after every player action.

import { useSyncExternalStore } from 'react';
import { audio } from '../../audio/audio';
import type { Cue } from '../../audio/audio';
import type { GlobeHit, GlobeRenderer, Quality, SunMode } from '../../render/GlobeRenderer';
import type { RouteColorMode } from '../../render/layers';
import { AIRPORT, airportDistance } from '../../sim/data/airports';
import { AIRCRAFT_TYPE, usableRange } from '../../sim/data/aircraft';
import { baseDemand } from '../../sim/demand';
import * as actions from '../../sim/actions';
import { canOperate } from '../../sim/ops';
import * as planner from '../../sim/planner';
import { Sim } from '../../sim/sim';
import type { NewGameOptions } from '../../sim/sim';
import type { AirportId, NewsItem, NewsKind, Objective } from '../../sim/types';
import { eraseSave, listSaves, loadPrefs, readSave, savePrefs, writeSave } from './persist';
import type { SaveMeta } from './persist';

export type Screen = 'loading' | 'title' | 'newgame' | 'game';
export type PanelId =
  | 'overview' | 'network' | 'fleet' | 'market' | 'bases' | 'finance'
  | 'operations' | 'rivals' | 'news' | 'objectives' | 'system';

export interface Toast {
  id: number;
  kind: NewsKind | 'error';
  title: string;
  body?: string;
  airport?: AirportId;
}

export type Modal =
  | { kind: 'decision'; id: number }
  | { kind: 'gameover' }
  | { kind: 'confirm'; title: string; body: string; action: string; danger?: boolean; onConfirm: () => void }
  | { kind: 'acquire'; type: string; listing?: number }
  | { kind: 'help' };

/** A route being planned on the globe. */
export interface Plan {
  from: AirportId;
  /** Aircraft type the forecast is for. */
  type: string;
  /** Destination chosen by clicking. */
  to: AirportId | null;
  /** A specific aircraft to put on the route, if planning for one. */
  aircraft: number | null;
}

export interface Settings {
  quality: Quality;
  sun: SunMode;
  labels: boolean;
  borders: boolean;
  clouds: boolean;
  rivalTraffic: boolean;
  rivalRoutes: boolean;
  colorMode: RouteColorMode;
  sound: boolean;
  volume: number;
  autosave: boolean;
  pauseOnDecision: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  quality: 'high', sun: 'real', labels: true, borders: true, clouds: true, rivalTraffic: true, rivalRoutes: false,
  colorMode: 'brand', sound: true, volume: 0.5, autosave: true, pauseOnDecision: true,
};

export interface AppState {
  screen: Screen;
  progress: number;
  error: string | null;
  panel: PanelId | null;
  /** Detail views inside panels. */
  routeId: number | null;
  aircraftId: number | null;
  rivalId: number | null;
  /** Things inspected on the globe. */
  airportId: AirportId | null;
  flightId: number | null;
  plan: Plan | null;
  /** 1..4: index into SPEEDS used when the clock runs. */
  speed: number;
  paused: boolean;
  tick: number;
  toasts: Toast[];
  modal: Modal | null;
  settings: Settings;
  hover: GlobeHit | null;
  saves: SaveMeta[];
  /** The camera is locked onto this aircraft in the cinematic flight view. */
  chase: number | null;
  /** In the flight view the clock runs at a watchable pace until a speed is picked. */
  cruise: boolean;
}

/** Game minutes per real second for each speed setting. */
export const SPEEDS = [0, 20, 60, 200, 600];
export const SPEED_LABELS = ['Paused', '1×', '3×', '10×', '30×'];
/** Game minutes per real second while riding along in the flight view. */
export const CRUISE_RATE = 2.5;

let state: AppState = {
  screen: 'loading', progress: 0, error: null,
  panel: null, routeId: null, aircraftId: null, rivalId: null, airportId: null, flightId: null, plan: null,
  speed: 1, paused: true, tick: 0, toasts: [], modal: null,
  settings: loadPrefs(DEFAULT_SETTINGS), hover: null, saves: [], chase: null, cruise: false,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Subscribes a component to part of the app state. The selector must return a primitive or a stable reference. */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/** The live simulation and the globe; set once a game is running. */
export const game: { sim: Sim | null; globe: GlobeRenderer | null } = { sim: null, globe: null };

/** Returns the simulation and re-renders the caller whenever it has changed. */
export function useSim(): Sim {
  useApp((s) => s.tick);
  return game.sim!;
}

/** Call after any action that changes simulation state, so the interface catches up. */
export function refresh(): void {
  setState({ tick: state.tick + 1 });
}

// ───────────── Toasts ─────────────

let toastId = 1;

const TOAST_CUES: Partial<Record<Toast['kind'], Cue>> = {
  error: 'error', good: 'good', bad: 'bad', milestone: 'milestone', rival: 'rival',
};

/** Shows a notification. `cue` overrides the sound that goes with it (null for silence). */
export function toast(kind: Toast['kind'], title: string, body?: string, airport?: AirportId, cue?: Cue | null): void {
  if (cue !== null) audio.play(cue ?? TOAST_CUES[kind] ?? 'notify');
  const t: Toast = { id: toastId++, kind, title, body, airport };
  setState({ toasts: [...state.toasts.slice(-3), t] });
  setTimeout(() => dismissToast(t.id), kind === 'error' ? 5000 : 7000);
}

export function dismissToast(id: number): void {
  if (state.toasts.some((t) => t.id === id)) setState({ toasts: state.toasts.filter((t) => t.id !== id) });
}

// ───────────── Settings ─────────────

export function applySettings(patch: Partial<Settings>): void {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  savePrefs(settings);
  audio.configure(settings.sound, settings.volume);
  const globe = game.globe;
  if (!globe) return;
  globe.sunMode = settings.sun;
  globe.setLayers({
    labels: settings.labels, borders: settings.borders, clouds: settings.clouds,
    rivalTraffic: settings.rivalTraffic, rivalRoutes: settings.rivalRoutes,
  });
  globe.setColorMode(settings.colorMode);
  if (patch.quality) globe.setQuality(settings.quality);
}

// ───────────── Clock ─────────────

export function setPaused(paused: boolean): void {
  if (state.paused !== paused) setState({ paused });
}

export function togglePause(): void {
  setPaused(!state.paused);
}

export function setSpeed(speed: number): void {
  setState({ speed: Math.max(1, Math.min(4, speed)), paused: false, cruise: false });
}

/** Game minutes per real second right now. */
export function currentRate(): number {
  if (!game.sim || state.paused || state.screen !== 'game') return 0;
  return state.chase !== null && state.cruise ? CRUISE_RATE : SPEEDS[state.speed];
}

let running = false;
let lastFrame = 0;
let lastTick = 0;

/** Starts the frame loop: advances the simulation and draws the globe. */
export function startLoop(): void {
  if (running) return;
  running = true;
  lastFrame = performance.now();
  const frame = (now: number) => {
    if (!running) return;
    // A background tab or a long pause must not turn into a huge time jump.
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const { sim, globe } = game;
    const rate = currentRate();
    if (sim && rate > 0) sim.advance(dt * rate);
    if (globe) {
      // On the title screen time drifts gently so the terminator moves.
      const time = sim ? sim.renderTime : titleTime(dt);
      globe.frame(dt, time, rate >= 200);
      if (globe.chasedAircraft !== null) {
        audio.setScene('flight');
        audio.setFlight(globe.chaseProximity, globe.chaseJets);
      } else {
        audio.setScene(state.screen === 'loading' ? 'silent' : 'globe');
      }
    }
    if (sim && now - lastTick > (rate > 0 ? 220 : 1000)) {
      lastTick = now;
      setState({ tick: state.tick + 1 });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

let idleTime = 9 * 60;
function titleTime(dt: number): number {
  idleTime += dt * 4;
  return idleTime;
}

// ───────────── Game lifecycle ─────────────

const NEWS_TOASTS: NewsKind[] = ['good', 'bad', 'milestone', 'rival', 'info'];
let unbind: (() => void)[] = [];

function bindSim(sim: Sim): void {
  for (const u of unbind) u();
  game.sim = sim;
  game.globe?.setSim(sim);
  unbind = [
    sim.on('news', (item: NewsItem) => {
      if (NEWS_TOASTS.includes(item.kind)) toast(item.kind, item.title, item.body, item.airport);
    }),
    sim.on('decision', (d: { id: number }) => {
      setState({ modal: { kind: 'decision', id: d.id } });
      audio.play('notify');
      if (state.settings.pauseOnDecision) setPaused(true);
    }),
    sim.on('month', () => {
      if (state.settings.autosave) void saveGame('autosave', true);
      game.globe?.invalidate();
    }),
    sim.on('objective', (_o: Objective) => refresh()),
    sim.on('gameover', () => {
      setState({ modal: { kind: 'gameover' }, paused: true });
      audio.play('bad');
    }),
  ];
  document.documentElement.style.setProperty('--accent', accentFor(sim.player.livery.primary));
  document.documentElement.style.setProperty('--brand', sim.player.livery.primary);
}

/** A readable accent on dark surfaces derived from the airline's brand colour. */
export function accentFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#5eead4';
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Lift dark colours towards white until they are light enough to read.
  const lum = () => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let guard = 0;
  while (lum() < 150 && guard++ < 20) {
    r = Math.min(255, Math.round(r + (255 - r) * 0.12 + 6));
    g = Math.min(255, Math.round(g + (255 - g) * 0.12 + 6));
    b = Math.min(255, Math.round(b + (255 - b) * 0.12 + 6));
  }
  return `rgb(${r} ${g} ${b})`;
}

function enterGame(sim: Sim): void {
  bindSim(sim);
  const hq = AIRPORT[sim.player.hq];
  setState({
    screen: 'game', panel: sim.fleetOf(0).length === 0 ? 'overview' : null, paused: true, modal: null, plan: null,
    routeId: null, aircraftId: null, rivalId: null, airportId: null, flightId: null, toasts: [], chase: null, cruise: false, tick: state.tick + 1,
  });
  const globe = game.globe;
  if (globe) {
    globe.controls.autoRotate = 0;
    globe.controls.flyTo({ lat: hq.lat, lon: hq.lon, altitude: 1.5 }, 2.2);
    applySettings({});
  }
}

export function newGame(opts: NewGameOptions): void {
  try {
    enterGame(Sim.create(opts));
    audio.play('launch');
  } catch (e) {
    toast('error', 'Could not start the game', String((e as Error).message ?? e));
  }
}

function metaOf(sim: Sim, slot: string): SaveMeta {
  const p = sim.player;
  return {
    slot, airline: p.name, code: p.code, hq: p.hq, time: sim.game.time, cash: p.cash,
    fleet: sim.fleetOf(0).length, savedAt: Date.now(), difficulty: sim.game.difficulty, color: p.livery.primary,
  };
}

export async function saveGame(slot: string, quiet = false): Promise<void> {
  const sim = game.sim;
  if (!sim) return;
  try {
    await writeSave(metaOf(sim, slot), sim.serialize());
    setState({ saves: await listSaves() });
    if (!quiet) toast('info', 'Game saved', slot === 'autosave' ? 'Autosave updated.' : `Saved to ${slotName(slot)}.`);
  } catch (e) {
    if (!quiet) toast('error', 'Saving failed', String((e as Error).message ?? e));
  }
}

export function slotName(slot: string): string {
  return slot === 'autosave' ? 'Autosave' : `Slot ${slot.replace('slot', '')}`;
}

export async function loadGame(slot: string): Promise<void> {
  try {
    const data = await readSave(slot);
    if (!data) throw new Error('That save could not be found');
    enterGame(Sim.load(data));
  } catch (e) {
    toast('error', 'Could not load the save', String((e as Error).message ?? e));
  }
}

export function loadGameFromText(text: string): void {
  try {
    enterGame(Sim.load(text));
  } catch (e) {
    toast('error', 'Could not load that file', String((e as Error).message ?? e));
  }
}

export async function removeSave(slot: string): Promise<void> {
  try {
    await eraseSave(slot);
  } catch (e) {
    toast('error', 'Could not remove the save', String((e as Error).message ?? e));
  }
  setState({ saves: await listSaves() });
}

export function quitToTitle(): void {
  for (const u of unbind) u();
  unbind = [];
  game.sim = null;
  game.globe?.setSim(null);
  if (game.globe) {
    game.globe.controls.autoRotate = 2.2;
    game.globe.controls.flyTo({ altitude: 3.4 }, 2);
  }
  game.globe?.setChase(null);
  setState({ screen: 'title', panel: null, modal: null, plan: null, paused: true, airportId: null, flightId: null, chase: null, cruise: false });
  void listSaves().then((saves) => setState({ saves }));
}

export async function refreshSaves(): Promise<void> {
  setState({ saves: await listSaves() });
}

// ───────────── Panels and selection ─────────────

export function openPanel(panel: PanelId | null): void {
  if (panel !== state.panel) audio.play(panel ? 'open' : 'close');
  setState({ panel, routeId: null, aircraftId: null, rivalId: null });
}

export function togglePanel(panel: PanelId): void {
  openPanel(state.panel === panel ? null : panel);
}

export function showRoute(id: number | null, focus = true): void {
  setState({ panel: id !== null ? 'network' : state.panel, routeId: id, airportId: null, flightId: null });
  const globe = game.globe;
  const r = id !== null ? game.sim?.routeById.get(id) : null;
  globe?.setSelection({ route: id, airport: null, aircraft: null });
  if (r && focus) globe?.focusRoute(r);
}

export function showAircraft(id: number | null): void {
  setState({ panel: id !== null ? 'fleet' : state.panel, aircraftId: id });
  game.globe?.setSelection({ aircraft: id });
}

export function showRival(id: number | null): void {
  setState({ panel: 'rivals', rivalId: id });
}

export function inspectAirport(id: AirportId | null, focus = false): void {
  setState({ airportId: id, flightId: null });
  game.globe?.setSelection({ airport: id, aircraft: null });
  if (id && focus) game.globe?.focusAirport(id);
}

export function inspectFlight(id: number | null): void {
  setState({ flightId: id, airportId: null });
  game.globe?.setSelection({ aircraft: id, airport: null });
}

// ───────────── Route planning ─────────────

/** Destinations worth a look from an airport with a given aircraft, scaled 0..1 by demand. */
function planCandidates(from: AirportId, type: string): Map<AirportId, number> {
  const t = AIRCRAFT_TYPE[type];
  const out = new Map<AirportId, number>();
  let max = 0;
  const list: [AirportId, number][] = [];
  for (const id of Object.keys(AIRPORT)) {
    if (id === from) continue;
    if (!canOperate(type, from, id).ok) continue;
    const d = baseDemand(from, id);
    if (d < 20) continue;
    list.push([id, d]);
    if (d > max) max = d;
  }
  list.sort((a, b) => b[1] - a[1]);
  for (const [id, d] of list.slice(0, 90)) out.set(id, Math.sqrt(d / max));
  return out;
}

function syncPlan(plan: Plan | null): void {
  const globe = game.globe;
  if (!globe) return;
  if (!plan) {
    globe.setPlanning(null);
    return;
  }
  const hover = state.hover?.kind === 'airport' && state.hover.id !== plan.from ? state.hover.id : null;
  const to = plan.to ?? hover;
  globe.setPlanning({
    from: plan.from,
    to,
    rangeKm: usableRange(plan.type),
    ok: to ? canOperate(plan.type, plan.from, to).ok : true,
    candidates: planCandidatesCached(plan.from, plan.type),
  });
}

let candidateKey = '';
let candidateCache: Map<AirportId, number> | null = null;
function planCandidatesCached(from: AirportId, type: string): Map<AirportId, number> {
  const key = `${from}:${type}`;
  if (key !== candidateKey || !candidateCache) {
    candidateKey = key;
    candidateCache = planCandidates(from, type);
  }
  return candidateCache;
}

export function startPlan(from: AirportId, type: string, aircraft: number | null = null, to: AirportId | null = null): void {
  const plan: Plan = { from, type, to, aircraft };
  setState({ plan, panel: null, airportId: null, flightId: null });
  game.globe?.setSelection({ airport: null, route: null, aircraft: null });
  syncPlan(plan);
  const a = AIRPORT[from];
  const range = usableRange(type) / 6371;
  game.globe?.controls.flyTo({ lat: a.lat, lon: a.lon, altitude: Math.max(0.9, Math.min(3.6, range * 1.5)) }, 1.4);
}

export function updatePlan(patch: Partial<Plan>): void {
  if (!state.plan) return;
  const plan = { ...state.plan, ...patch };
  setState({ plan });
  syncPlan(plan);
}

export function cancelPlan(): void {
  setState({ plan: null });
  syncPlan(null);
}

// ───────────── Globe events ─────────────

/** Enters or leaves the cinematic flight view alongside an aircraft. */
export function setChase(id: number | null): void {
  const globe = game.globe;
  if (!globe) return;
  const before = globe.chasedAircraft;
  globe.setChase(id);
  const active = globe.chasedAircraft;
  if (active !== before) audio.play('whoosh');
  setState({
    chase: active, cruise: active !== null,
    panel: active !== null ? null : state.panel, flightId: active ?? state.flightId, airportId: active !== null ? null : state.airportId,
  });
}

export function bindGlobe(globe: GlobeRenderer): void {
  game.globe = globe;
  globe.onChaseEnd = (id) => {
    const ac = game.sim?.acById.get(id);
    setState({ chase: null, cruise: false });
    if (ac) toast('info', `${ac.reg} has landed at ${AIRPORT[ac.at].city}`, undefined, ac.at);
  };
  globe.onHover = (hit) => {
    setState({ hover: hit });
    if (state.plan && !state.plan.to) syncPlan(state.plan);
  };
  globe.onPick = (hit) => {
    if (state.screen !== 'game' || state.chase !== null) return;
    if (state.plan) {
      if (hit?.kind === 'airport' && hit.id !== state.plan.from) updatePlan({ to: hit.id });
      else if (!hit) updatePlan({ to: null });
      return;
    }
    if (!hit) {
      if (state.airportId || state.flightId) {
        setState({ airportId: null, flightId: null });
        globe.setSelection({ airport: null, aircraft: null });
      }
      return;
    }
    if (hit.kind === 'airport') inspectAirport(hit.id);
    else if (hit.kind === 'aircraft') inspectFlight(hit.id);
    else showRoute(hit.id, false);
  };
}

// Handy for debugging and automated play-throughs: available in development
// builds, or anywhere with ?debug in the address.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  Object.assign(window as object, {
    __app: {
      game, getState, setState, openPanel, setSpeed, setPaused, startPlan, showRoute, showAircraft, inspectAirport, inspectFlight, setChase,
      newGame, saveGame, loadGame, quitToTitle, audio,
      sim: { actions, planner }, airports: AIRPORT,
    },
  });
}
