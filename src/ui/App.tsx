// Top-level component: owns the WebGL canvas and decides which screen sits on top of it.

import { useEffect, useRef } from 'react';
import { audio } from '../audio/audio';
import { GlobeRenderer } from '../render/GlobeRenderer';
import { applySettings, bindGlobe, cancelPlan, game, getState, openPanel, refreshSaves, setChase, setPaused, setSpeed, setState, startLoop, togglePanel, togglePause, useApp } from './app/store';
import type { PanelId } from './app/store';
import { useKey } from './components/ui';
import { Hud } from './hud/Hud';
import { NewGame } from './screens/NewGame';
import { Title } from './screens/Title';

const PANEL_KEYS: Record<string, PanelId> = {
  o: 'overview', n: 'network', f: 'fleet', m: 'market', b: 'bases', '$': 'finance',
  p: 'operations', r: 'rivals', e: 'news', g: 'objectives',
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const screen = useApp((s) => s.screen);
  const progress = useApp((s) => s.progress);
  const error = useApp((s) => s.error);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let globe: GlobeRenderer;
    try {
      globe = new GlobeRenderer(canvas, getState().settings.quality, labelsRef.current!);
    } catch (e) {
      setState({ error: 'This game needs WebGL 2, which your browser or device does not seem to support.' });
      return;
    }
    bindGlobe(globe);
    globe.controls.autoRotate = 2.2;
    globe.controls.setPose({ lat: 24, lon: -30, altitude: 3.4 });
    const ro = new ResizeObserver(() => globe.resize());
    ro.observe(canvas);
    let cancelled = false;
    globe
      .load((p) => setState({ progress: p }))
      .then(async () => {
        if (cancelled) return;
        applySettings({});
        startLoop();
        await refreshSaves();
        setState({ screen: 'title', progress: 1 });
        (window as unknown as { __ready: boolean }).__ready = true;
      })
      .catch((e: Error) => setState({ error: e.message }));
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, []);

  // Every button, tab and tick box gets the same soft click.
  useEffect(() => {
    audio.arm();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button, [role="tab"], [role="button"], select, summary, input[type="checkbox"], input[type="radio"], a[href]');
      if (el && !(el as HTMLButtonElement).disabled) audio.play('click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useKey((e) => {
    const s = getState();
    if (s.screen !== 'game') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
    if (target.tagName === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (s.modal && s.modal.kind !== 'gameover' && s.modal.kind !== 'decision') setState({ modal: null });
      else if (s.plan) cancelPlan();
      else if (s.chase !== null) setChase(null);
      else if (s.airportId || s.flightId) {
        setState({ airportId: null, flightId: null });
        game.globe?.setSelection({ airport: null, aircraft: null });
      } else if (s.panel) openPanel(null);
      return;
    }
    if (s.modal) return;
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key >= '1' && e.key <= '4') setSpeed(Number(e.key));
    else if (e.key === '0' || e.key === '`') setPaused(true);
    else if (PANEL_KEYS[e.key.toLowerCase()]) togglePanel(PANEL_KEYS[e.key.toLowerCase()]);
    else if (e.key === '?') setState({ modal: { kind: 'help' } });
  });

  return (
    <div className="app">
      <canvas ref={canvasRef} className="globe-canvas" tabIndex={-1} />
      <div ref={labelsRef} className="labels" style={{ display: screen === 'game' ? undefined : 'none' }} />
      {screen === 'title' && <Title />}
      {screen === 'newgame' && <NewGame />}
      {screen === 'game' && <Hud />}
      <div className={`loading ${screen !== 'loading' && !error ? 'done' : ''}`}>
        <div className="col center" style={{ alignItems: 'center' }}>
          <div className="wordmark" style={{ fontSize: 44 }}>Skyledger</div>
          {error ? (
            <div className="bad" style={{ maxWidth: 420, textAlign: 'center', marginTop: 10 }}>{error}</div>
          ) : (
            <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
