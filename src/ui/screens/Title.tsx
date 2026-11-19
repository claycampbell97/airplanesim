import { useRef, useState } from 'react';
import { FolderOpen, FileUp, Play, Plus, Trash2 } from 'lucide-react';
import { formatDate } from '../../sim/time';
import { money } from '../app/format';
import { loadGame, loadGameFromText, removeSave, setState, slotName, useApp } from '../app/store';

export function Title() {
  const saves = useApp((s) => s.saves);
  const [showSaves, setShowSaves] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = saves[0];

  return (
    <div className="title-screen">
      <div className="wordmark">Skyledger</div>
      <p className="tagline">
        Build an airline from a single aircraft into a global network. Every airport, every route and every
        rival is live on a real-time 3D Earth.
      </p>
      <div className="title-actions">
        <button className="btn primary lg" onClick={() => setState({ screen: 'newgame' })}><Plus />New airline</button>
        {latest && (
          <button className="btn lg" onClick={() => void loadGame(latest.slot)}>
            <Play />Continue {latest.airline}
          </button>
        )}
        {saves.length > 0 && (
          <button className="btn lg ghost" onClick={() => setShowSaves((v) => !v)}><FolderOpen />Load game</button>
        )}
        <button className="btn lg ghost" onClick={() => fileRef.current?.click()}><FileUp />Import save file</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) loadGameFromText(await file.text());
            e.target.value = '';
          }} />
      </div>
      {showSaves && (
        <div className="glass col gap-4" style={{ marginTop: 18, padding: 10, width: 'min(520px, 100%)' }}>
          {saves.map((s) => (
            <div key={s.slot} className="list-row click" onClick={() => void loadGame(s.slot)}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: 'none' }} />
              <div className="grow">
                <div className="strong ellipsis">{s.airline} <span className="dim small">· {slotName(s.slot)}</span></div>
                <div className="small muted">{formatDate(s.time)} · {s.fleet} aircraft · {money(s.cash)} · {s.hq}</div>
              </div>
              <button className="btn ghost icon sm" title="Delete this save" aria-label={`Delete ${slotName(s.slot)}`}
                onClick={(e) => { e.stopPropagation(); void removeSave(s.slot); }}><Trash2 /></button>
            </div>
          ))}
        </div>
      )}
      <div className="tiny dim" style={{ marginTop: 26, maxWidth: 640 }}>
        Earth imagery © Solar System Scope (CC BY 4.0), based on NASA data. Airport data from OurAirports. Borders from Natural Earth.
        All airlines are fictional.
      </div>
    </div>
  );
}
