// Game menu: saving, loading, display and sound settings.

import { useRef } from 'react';
import { CircleHelp, FileDown, FileUp, LogOut, Save, Settings } from 'lucide-react';
import type { Quality } from '../../render/GlobeRenderer';
import { formatDate } from '../../sim/time';
import { DIFFICULTY_INFO } from '../../sim/sim';
import { confirm } from '../app/act';
import { money } from '../app/format';
import { downloadText } from '../app/persist';
import { applySettings, game, loadGame, loadGameFromText, openPanel, quitToTitle, saveGame, setState, slotName, toast, useApp, useSim } from '../app/store';
import { Panel, Seg, Slider } from '../components/ui';

const SLOTS = ['slot1', 'slot2', 'slot3'];

export function SystemPanel() {
  const sim = useSim();
  const settings = useApp((s) => s.settings);
  const saves = useApp((s) => s.saves);
  const fileRef = useRef<HTMLInputElement>(null);
  const p = sim.player;

  return (
    <Panel title="Game menu" icon={<Settings size={20} />} onClose={() => openPanel(null)}
      subtitle={`${p.name} · ${DIFFICULTY_INFO[sim.game.difficulty].name} · ${formatDate(sim.game.time)}`}>
      <div className="section-title">Save and load</div>
      <div className="col gap-4">
        {['autosave', ...SLOTS].map((slot) => {
          const meta = saves.find((s) => s.slot === slot);
          return (
            <div key={slot} className="list-row">
              <div className="grow">
                <div className="strong">{slotName(slot)}</div>
                <div className="small muted">
                  {meta ? `${meta.airline} · ${formatDate(meta.time)} · ${meta.fleet} aircraft · ${money(meta.cash)}` : slot === 'autosave' ? 'Written at the end of every month' : 'Empty'}
                </div>
              </div>
              {slot !== 'autosave' && <button className="btn sm" onClick={() => void saveGame(slot)}><Save />Save</button>}
              {meta && (
                <button className="btn sm ghost" onClick={() => confirm(`Load ${slotName(slot)}?`, 'Unsaved progress in the current game will be lost.', 'Load', () => void loadGame(slot), false)}>Load</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => downloadText(`${p.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${formatDate(sim.game.time).replace(/ /g, '-')}.skyledger.json`, sim.serialize())}>
          <FileDown />Export to a file
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}><FileUp />Import from a file</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) loadGameFromText(await file.text());
            e.target.value = '';
          }} />
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.autosave} onChange={(e) => applySettings({ autosave: e.target.checked })} />
        Autosave at the end of every month
      </label>

      <div className="section-title">Display</div>
      <div className="row between wrap">
        <span className="muted">Graphics quality</span>
        <Seg value={settings.quality} title="Graphics quality"
          onChange={(v: Quality) => {
            const needsReload = (v === 'low') !== (settings.quality === 'low');
            applySettings({ quality: v });
            if (needsReload) toast('info', 'Texture detail changes after a reload', 'Reload the page to apply the new texture resolution.');
          }}
          options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }]} />
      </div>
      <div className="row between wrap">
        <span className="muted">Lighting</span>
        <Seg value={settings.sun} onChange={(v) => applySettings({ sun: v })} title="Lighting"
          options={[{ value: 'real', label: 'Real day and night', title: 'The sun is where it really is for the game date and time' }, { value: 'studio', label: 'Always daylight', title: 'The side you are looking at is always lit' }]} />
      </div>
      <div className="grid-2">
        <label className="check"><input type="checkbox" checked={settings.clouds} onChange={(e) => applySettings({ clouds: e.target.checked })} />Clouds</label>
        <label className="check"><input type="checkbox" checked={settings.borders} onChange={(e) => applySettings({ borders: e.target.checked })} />Coastlines and borders</label>
        <label className="check"><input type="checkbox" checked={settings.labels} onChange={(e) => applySettings({ labels: e.target.checked })} />Airport labels</label>
        <label className="check"><input type="checkbox" checked={settings.rivalTraffic} onChange={(e) => applySettings({ rivalTraffic: e.target.checked })} />Other airlines' aircraft</label>
        <label className="check"><input type="checkbox" checked={settings.rivalRoutes} onChange={(e) => applySettings({ rivalRoutes: e.target.checked })} />Other airlines' routes</label>
        <label className="check"><input type="checkbox" checked={game.globe?.controls.tiltEnabled ?? true} onChange={(e) => { if (game.globe) game.globe.controls.tiltEnabled = e.target.checked; setState({ tick: Date.now() }); }} />Tilt the view when zoomed in</label>
      </div>

      <div className="section-title">Sound and pace</div>
      <label className="check"><input type="checkbox" checked={settings.sound} onChange={(e) => applySettings({ sound: e.target.checked })} />Sound effects</label>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'center' }}>
        <span className="muted">Volume</span>
        <Slider label="Volume" min={0} max={100} value={Math.round(settings.volume * 100)} onChange={(v) => applySettings({ volume: v / 100 })} />
      </div>
      <label className="check"><input type="checkbox" checked={settings.pauseOnDecision} onChange={(e) => applySettings({ pauseOnDecision: e.target.checked })} />Pause when a decision is needed</label>

      <div className="row wrap" style={{ marginTop: 6 }}>
        <button className="btn" onClick={() => setState({ modal: { kind: 'help' } })}><CircleHelp />How to play</button>
        <button className="btn danger" onClick={() => confirm('Leave this game?', 'Anything since the last save will be lost.', 'Quit to title', quitToTitle)}><LogOut />Quit to title</button>
      </div>
      <div className="tiny dim" style={{ lineHeight: 1.6 }}>
        Earth imagery © Solar System Scope, CC BY 4.0, based on NASA data. Airport data: OurAirports (public domain). Coastlines and borders: Natural Earth (public domain).
        Every airline in this game is fictional. Traffic figures are approximations for gameplay, not statistics.
      </div>
    </Panel>
  );
}
