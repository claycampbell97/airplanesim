// Bases and airports: where aircraft are stationed, and a browser for every airport in the world.

import { useMemo, useState } from 'react';
import { ArrowUpCircle, Building2, LocateFixed, Plus, Search, Trash2 } from 'lucide-react';
import { closeHub, developHub } from '../../sim/actions';
import { AIRPORT, AIRPORTS, REGION_NAMES, TIER_NAMES } from '../../sim/data/airports';
import { baseDemand } from '../../sim/demand';
import { HUB_LEVEL_NAMES, hubMonthlyFee, hubSetupCost } from '../../sim/finance';
import { formatDate } from '../../sim/time';
import type { RegionId } from '../../sim/types';
import { attempt, confirm } from '../app/act';
import { integer, money } from '../app/format';
import { inspectAirport, openPanel, startPlan, useSim } from '../app/store';
import { Panel } from '../components/ui';

const LEVEL_BLURB = ['', 'Station aircraft and start routes here.', 'Passengers connect between your flights; cheaper airport charges.', 'The strongest pull for connecting passengers and the lowest charges.'];

export function BasesPanel() {
  const sim = useSim();
  const p = sim.player;
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<RegionId | 'ALL'>('ALL');
  const defaultType = sim.fleetOf(0)[0]?.type ?? 'a20n';

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AIRPORTS.filter((a) => {
      if (region !== 'ALL' && a.region !== region) return false;
      if (!q) return true;
      return a.id.toLowerCase().startsWith(q) || a.city.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.countryName.toLowerCase().includes(q);
    }).slice(0, 40);
  }, [query, region]);

  return (
    <Panel title="Bases and airports" icon={<Building2 size={20} />} onClose={() => openPanel(null)}
      subtitle={`${p.hubs.length} base${p.hubs.length === 1 ? '' : 's'} · every route starts at one of them`}>
      <div className="col gap-6">
        {p.hubs.map((h) => {
          const ap = AIRPORT[h.airport];
          const based = sim.fleetOf(0).filter((a) => a.base === h.airport).length;
          const routes = sim.routesOf(0).filter((r) => r.a === h.airport || r.b === h.airport).length;
          const next = (h.level + 1) as 2 | 3;
          const fee = (hubMonthlyFee(ap, h.level) - (h.airport === p.hq ? hubMonthlyFee(ap, 1) : 0)) * sim.tuning.cost;
          return (
            <div key={h.airport} className="card col gap-6">
              <div className="row between">
                <div>
                  <div className="strong" style={{ fontSize: 14 }}><span className="mono">{ap.id}</span> · {ap.city} {h.airport === p.hq && <span className="badge gold" style={{ marginLeft: 4 }}>Headquarters</span>}</div>
                  <div className="small muted">{HUB_LEVEL_NAMES[h.level]} · {based} aircraft · {routes} route{routes === 1 ? '' : 's'} · {money(fee)} a month{h.opened > 0 ? ` · since ${formatDate(h.opened)}` : ''}</div>
                </div>
                <button className="btn ghost icon" title="Show on the globe" aria-label={`Show ${ap.id} on the globe`} onClick={() => inspectAirport(ap.id, true)}><LocateFixed /></button>
              </div>
              <div className="small muted">{LEVEL_BLURB[h.level]}</div>
              <div className="row wrap">
                <button className="btn sm" onClick={() => startPlan(ap.id, defaultType)}><Plus />Plan a route</button>
                {h.level < 3 && (
                  <button className="btn sm" title={LEVEL_BLURB[next]}
                    onClick={() => confirm(`Upgrade ${ap.id} to a ${HUB_LEVEL_NAMES[next].toLowerCase()}?`,
                      `${LEVEL_BLURB[next]} One-off cost ${money(hubSetupCost(ap, next) * sim.tuning.cost)}, then ${money(hubMonthlyFee(ap, next) * sim.tuning.cost)} a month.`,
                      'Upgrade', () => attempt(developHub(sim, 0, ap.id), `${ap.id} upgraded`), false)}>
                    <ArrowUpCircle />Upgrade to {HUB_LEVEL_NAMES[next].toLowerCase()} · {money(hubSetupCost(ap, next) * sim.tuning.cost)}
                  </button>
                )}
                {h.airport !== p.hq && (
                  <button className="btn sm danger" onClick={() => confirm(`Close the base at ${ap.id}?`, 'Aircraft must be moved and dependent routes closed first. The set-up cost is not refunded.', 'Close base',
                    () => attempt(closeHub(sim, 0, ap.id), `Base at ${ap.id} closed`))}><Trash2 />Close</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-title">Find an airport</div>
      <div className="row gap-6">
        <div className="grow" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }} />
          <input className="input" style={{ width: '100%', paddingLeft: 30 }} placeholder="Search city, airport, country or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" value={region} onChange={(e) => setRegion(e.target.value as RegionId | 'ALL')} aria-label="Region">
          <option value="ALL">All regions</option>
          {(Object.keys(REGION_NAMES) as RegionId[]).map((r) => <option key={r} value={r}>{REGION_NAMES[r]}</option>)}
        </select>
      </div>
      <table className="tbl compact">
        <thead><tr><th>Airport</th><th>Size</th><th className="r">Runway</th><th className="r">Demand from {p.hq}</th><th className="r">Base cost</th></tr></thead>
        <tbody>
          {results.map((a) => (
            <tr key={a.id} className="click" onClick={() => inspectAirport(a.id, true)}>
              <td><span className="code">{a.id}</span> <span className="strong">{a.city}</span> <span className="dim small">{a.countryName}</span></td>
              <td className="muted small">{TIER_NAMES[a.tier]}</td>
              <td className="r muted">{integer(a.effRunway)} m</td>
              <td className="r">{a.id === p.hq ? '—' : `${integer(baseDemand(p.hq, a.id))}/day`}</td>
              <td className="r muted">{p.hubs.some((h) => h.airport === a.id) ? 'Your base' : money(hubSetupCost(a, 1) * sim.tuning.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.length === 0 && <div className="muted small">No airports match.</div>}
    </Panel>
  );
}
