import { useMemo, useState } from 'react';
import { ArrowLeft, Dices, PlaneTakeoff, Search } from 'lucide-react';
import { EMBLEMS, LIVERY_STYLES } from '../../render/aircraft/emblems';
import { AIRLINE_TEMPLATES, PLAYER_NAME_IDEAS } from '../../sim/data/airlines';
import { AIRPORT, AIRPORTS, REGION_NAMES, TIER_NAMES } from '../../sim/data/airports';
import { topMarkets } from '../../sim/demand';
import { DIFFICULTY_INFO, TUNING } from '../../sim/sim';
import type { Difficulty, Livery, RegionId } from '../../sim/types';
import { integer, money } from '../app/format';
import { newGame, setState } from '../app/store';
import { Emblem, Logo, Seg } from '../components/ui';
import { AircraftPreview } from '../components/AircraftPreview';

const PRIMARY = ['#2563eb', '#0ea5e9', '#14b8a6', '#16a34a', '#eab308', '#f97316', '#dc2626', '#db2777', '#7c3aed', '#0f172a', '#7f1d1d', '#065f46'];
const SECONDARY = ['#f59e0b', '#fde047', '#f8fafc', '#94a3b8', '#22d3ee', '#fb7185', '#a3e635', '#1e293b'];
const BASES = [
  { value: '#f4f6f8', label: 'White' },
  { value: '#d8dde4', label: 'Silver' },
  { value: '#1b2433', label: 'Midnight' },
];

function codeFrom(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words[0][0] + words[1][0];
  return (words[0] ?? 'SK').slice(0, 2).padEnd(2, 'X');
}

export function NewGame() {
  const [name, setName] = useState('Skyledger Air');
  const [code, setCode] = useState('SK');
  const [codeEdited, setCodeEdited] = useState(false);
  const [livery, setLivery] = useState<Livery>({ primary: '#2563eb', secondary: '#f59e0b', base: '#f4f6f8', style: 'cheatline', emblem: 'chevron' });
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [hq, setHq] = useState('MAN');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<RegionId | 'ALL'>('ALL');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AIRPORTS.filter((a) => {
      if (region !== 'ALL' && a.region !== region) return false;
      if (!q) return true;
      return a.id.toLowerCase().startsWith(q) || a.city.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.countryName.toLowerCase().includes(q);
    }).slice(0, 80);
  }, [query, region]);

  const airport = AIRPORT[hq];
  const markets = useMemo(() => topMarkets(hq, 6), [hq]);
  const rivals = AIRLINE_TEMPLATES.filter((t) => t.hq === hq || t.hubs?.includes(hq));
  const tuning = TUNING[difficulty];
  const valid = name.trim().length >= 2 && /^[A-Z0-9]{2}$/.test(code);

  const updateName = (v: string) => {
    setName(v);
    if (!codeEdited) setCode(codeFrom(v));
  };

  return (
    <div className="hud">
      <div className="setup glass">
        <header className="panel-head">
          <button className="btn ghost icon" onClick={() => setState({ screen: 'title' })} aria-label="Back"><ArrowLeft /></button>
          <div className="grow">
            <h2>Found your airline</h2>
            <div className="sub">Choose an identity, a home base and how hard you want it to be.</div>
          </div>
        </header>
        <div className="setup-body">
          <div className="setup-col">
            <div className="row top gap-14">
              <Logo livery={livery} size={64} />
              <div className="col grow gap-6">
                <div className="field">
                  <label htmlFor="airline-name">Airline name</label>
                  <div className="row gap-6">
                    <input id="airline-name" className="input grow" value={name} maxLength={28} onChange={(e) => updateName(e.target.value)} />
                    <button className="btn icon" title="Suggest a name" aria-label="Suggest a name"
                      onClick={() => updateName(PLAYER_NAME_IDEAS[Math.floor(Math.random() * PLAYER_NAME_IDEAS.length)])}><Dices /></button>
                  </div>
                </div>
                <div className="field" style={{ width: 110 }}>
                  <label htmlFor="airline-code">Flight code</label>
                  <input id="airline-code" className="input mono" value={code} maxLength={2}
                    onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setCodeEdited(true); }} />
                </div>
              </div>
            </div>

            <AircraftPreview typeId="a20n" livery={livery} airlineName={name} height={200} />

            <div className="field">
              <span className="label">Brand colour</span>
              <div className="swatches">
                {PRIMARY.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} aria-pressed={livery.primary === c} aria-label={`Brand colour ${c}`}
                    onClick={() => setLivery({ ...livery, primary: c })} />
                ))}
                <input type="color" value={livery.primary} aria-label="Custom brand colour" style={{ width: 30, height: 26, padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
                  onChange={(e) => setLivery({ ...livery, primary: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <span className="label">Accent colour</span>
              <div className="swatches">
                {SECONDARY.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} aria-pressed={livery.secondary === c} aria-label={`Accent colour ${c}`}
                    onClick={() => setLivery({ ...livery, secondary: c })} />
                ))}
                <input type="color" value={livery.secondary} aria-label="Custom accent colour" style={{ width: 30, height: 26, padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
                  onChange={(e) => setLivery({ ...livery, secondary: e.target.value })} />
              </div>
            </div>
            <div className="row wrap gap-14">
              <div className="field">
                <label htmlFor="livery-style">Livery</label>
                <select id="livery-style" className="select" value={livery.style} onChange={(e) => setLivery({ ...livery, style: e.target.value as Livery['style'] })}>
                  {LIVERY_STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="label">Fuselage</span>
                <Seg value={livery.base} onChange={(v) => setLivery({ ...livery, base: v })} options={BASES} title="Fuselage colour" />
              </div>
            </div>
            <div className="field">
              <span className="label">Tail emblem</span>
              <div className="swatches">
                {EMBLEMS.map((e) => (
                  <button key={e} className="emblem-pick" aria-pressed={livery.emblem === e} aria-label={`Emblem ${e}`} onClick={() => setLivery({ ...livery, emblem: e })}>
                    <Emblem emblem={e} size={22} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setup-col">
            <div className="field">
              <span className="label">Difficulty</span>
              <Seg value={difficulty} onChange={setDifficulty} title="Difficulty"
                options={(Object.keys(DIFFICULTY_INFO) as Difficulty[]).map((d) => ({ value: d, label: DIFFICULTY_INFO[d].name }))} />
              <div className="small muted">{DIFFICULTY_INFO[difficulty].blurb} Starting capital <b className="strong" style={{ color: 'var(--text)' }}>{money(tuning.startCash)}</b>.</div>
            </div>

            <div className="field">
              <span className="label">Headquarters</span>
              <div className="row gap-6">
                <div className="grow" style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }} />
                  <input className="input" style={{ width: '100%', paddingLeft: 30 }} placeholder="Search city, airport or code" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <select className="select" value={region} onChange={(e) => setRegion(e.target.value as RegionId | 'ALL')} aria-label="Region">
                  <option value="ALL">All regions</option>
                  {(Object.keys(REGION_NAMES) as RegionId[]).map((r) => <option key={r} value={r}>{REGION_NAMES[r]}</option>)}
                </select>
              </div>
            </div>
            <div style={{ flex: '1 1 150px', minHeight: 150, maxHeight: 230, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 11 }}>
              {list.map((a) => (
                <div key={a.id} className="list-row click" onClick={() => setHq(a.id)}
                  style={a.id === hq ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' } : undefined}>
                  <span className="code">{a.id}</span>
                  <div className="grow ellipsis"><span className="strong">{a.city}</span> <span className="dim small">{a.countryName}</span></div>
                  <span className="small muted num">{a.pax >= 1 ? `${a.pax.toFixed(0)}M` : `${(a.pax * 1000).toFixed(0)}k`} pax</span>
                </div>
              ))}
              {list.length === 0 && <div className="muted small" style={{ padding: 14 }}>No airports match.</div>}
            </div>

            <div className="card col gap-6">
              <div className="row between">
                <div>
                  <div className="strong" style={{ fontSize: 14 }}>{airport.city} <span className="code" style={{ marginLeft: 4 }}>{airport.id}</span></div>
                  <div className="small muted">{airport.name} · {airport.countryName}</div>
                </div>
                <span className="badge">{TIER_NAMES[airport.tier]}</span>
              </div>
              <dl className="kv small">
                <dt>Local market</dt><dd>{airport.pax.toFixed(1)}M passengers a year</dd>
                <dt>Longest runway</dt><dd>{integer(airport.runway)} m{airport.elev > 1200 ? ` at ${integer(airport.elev)} m elevation` : ''}</dd>
                <dt>Rivals based here</dt><dd>{rivals.length ? rivals.map((r) => r.name).join(', ') : 'None'}</dd>
              </dl>
              <div className="small muted">
                Strongest markets: {markets.map((m) => `${m.airport.id} (${integer(m.demand)}/day)`).join(' · ')}
              </div>
              <div className="tiny dim">
                {airport.tier >= 4
                  ? 'A big market with plenty of demand — and established competitors, high fees and scarce slots.'
                  : airport.tier >= 3
                    ? 'A solid mid-size market: room to grow without fighting the giants on day one.'
                    : 'A small market. Thin routes suit turboprops and regional jets; growth will take patience.'}
              </div>
            </div>
          </div>
        </div>
        <footer className="panel-foot">
          <div className="grow small muted">You start with cash and no aircraft. Lease or buy your first one in the aircraft market.</div>
          <button className="btn primary lg" disabled={!valid}
            onClick={() => newGame({ name: name.trim(), code, hq, livery, difficulty })}>
            <PlaneTakeoff />Start flying
          </button>
        </footer>
      </div>
    </div>
  );
}
