// Fleet: every aircraft, what it is doing, and where it is assigned.

import { useState } from 'react';
import { ArrowLeft, Crosshair, Plane, Plus, Store, Trash2, Waypoints, Wrench } from 'lucide-react';
import {
  disposeAircraft, leaseReturnPenalty, rebaseAircraft, reconfigureCabin, refitCost, resaleValue, setRotation,
} from '../../sim/actions';
import { AIRCRAFT_TYPE, CLASS_NAMES, DENSITY_NAMES, makeCabin, presetsFor, totalSeats, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import { aircraftAgeYears, rotationFrequency } from '../../sim/market';
import { canOperate } from '../../sim/ops';
import { formatDate, monthStart } from '../../sim/time';
import type { Aircraft } from '../../sim/types';
import { aircraftStatus, aircraftTitle, attempt, confirm, routeLabel } from '../app/act';
import { integer, money, signedMoney } from '../app/format';
import { game, inspectFlight, openPanel, setState, showAircraft, showRoute, startPlan, useApp, useSim } from '../app/store';
import { AircraftPreview } from '../components/AircraftPreview';
import { cx, Empty, Meter, Panel, Th, useSort } from '../components/ui';

type SortKey = 'type' | 'base' | 'status' | 'util' | 'profit' | 'age';

function AircraftDetail({ ac }: { ac: Aircraft }) {
  const sim = useSim();
  const p = sim.player;
  const type = AIRCRAFT_TYPE[ac.type];
  const status = aircraftStatus(sim, ac);
  const age = aircraftAgeYears(sim, ac);
  const routes = ac.rotation.map((id) => sim.routeById.get(id)).filter((r) => !!r);
  const freq = rotationFrequency(sim, ac);
  const candidates = sim.routesOf(0).filter((r) => !ac.rotation.includes(r.id) && (r.a === ac.base || r.b === ac.base) && canOperate(ac.type, r.a, r.b).ok);
  const presets = presetsFor(type);
  const [presetId, setPresetId] = useState('');
  const preset = presets.find((x) => x.id === presetId);
  const otherBases = p.hubs.filter((h) => h.airport !== ac.base && AIRPORT[h.airport].effRunway >= type.runway);
  const delivered = ac.phase !== 'delivery';

  const dispose = () => {
    const owned = ac.owned;
    const amount = owned ? resaleValue(sim, ac) : leaseReturnPenalty(sim, ac);
    confirm(
      owned ? `Sell ${ac.reg}?` : `Return ${ac.reg} to the lessor?`,
      owned
        ? `You will receive about ${money(amount)} for this ${age.toFixed(0)}-year-old ${typeName(type)}.`
        : amount > 0
          ? `The lease runs until ${formatDate(ac.leaseEnd)}. Returning early costs ${money(amount)} (three months' rent).`
          : 'The minimum term has passed, so there is no penalty.',
      owned ? 'Sell aircraft' : 'Return aircraft',
      () => {
        if (attempt(disposeAircraft(sim, ac.id), owned ? `${ac.reg} sold` : `${ac.reg} returned`) !== undefined) showAircraft(null);
      },
    );
  };

  return (
    <>
      <div className="row">
        <button className="btn ghost sm" onClick={() => showAircraft(null)}><ArrowLeft />All aircraft</button>
        <div className="grow" />
        <span className={cx('badge', status.tone === 'good' && 'good', status.tone === 'warn' && 'warn', status.tone === 'bad' && 'bad')}>{status.text}</span>
      </div>
      <AircraftPreview typeId={ac.type} livery={p.livery} airlineName={p.name} registration={ac.reg} height={210} />

      <div className="grid-2">
        <dl className="kv small card tight">
          <dt>Age</dt><dd>{age.toFixed(1)} years</dd>
          <dt>Flight hours</dt><dd>{integer(ac.hours)}</dd>
          <dt>Flights</dt><dd>{integer(ac.cycles)}</dd>
          <dt>This month</dt><dd>{ac.monthFlights} flights · <span className={ac.monthProfit < 0 ? 'bad' : 'good'}>{signedMoney(ac.monthProfit)}</span></dd>
        </dl>
        <dl className="kv small card tight">
          <dt>Based at</dt><dd>{ac.base} · {AIRPORT[ac.base].city}</dd>
          <dt>{ac.owned ? 'Book value' : 'Lease'}</dt>
          <dd>{ac.owned ? money(ac.book) : `${money(ac.leaseRate)}/mo`}</dd>
          <dt>{ac.owned ? 'Resale today' : 'Minimum term'}</dt>
          <dd>{ac.owned ? money(resaleValue(sim, ac)) : sim.game.time < ac.leaseEnd ? `until ${formatDate(ac.leaseEnd)}` : 'completed'}</dd>
          <dt>Cabin</dt><dd>{ac.cabin.map((s, i) => (s > 0 ? `${s}${'YJF'[i]}` : null)).filter(Boolean).join(' · ')}</dd>
        </dl>
      </div>
      <div className="col gap-4">
        <div className="row between small"><span className="muted">Airframe condition</span><span className="num">{Math.round(ac.condition * 100)}%</span></div>
        <Meter value={ac.condition} color={ac.condition < 0.6 ? 'var(--status-serious)' : undefined} />
      </div>

      <div className="section-title">Rotation</div>
      {routes.length === 0 ? (
        <div className="muted small">
          {delivered ? 'This aircraft is not assigned to any route and is earning nothing.' : 'You can line up routes now; flying starts on delivery.'}
        </div>
      ) : (
        <div className="col gap-4">
          {routes.map((r) => (
            <div key={r.id} className="list-row click" onClick={() => showRoute(r.id)}>
              <Waypoints size={15} className="dim" />
              <div className="grow">
                <span className="mono strong">{routeLabel(r)}</span> <span className="muted small">{AIRPORT[r.a].city} – {AIRPORT[r.b].city}</span>
              </div>
              <span className="small muted num">{freq.toFixed(1)} flights/day each way</span>
              <button className="btn ghost icon sm" title="Take off this route" aria-label={`Take off ${routeLabel(r)}`}
                onClick={(e) => { e.stopPropagation(); attempt(setRotation(sim, ac.id, ac.rotation.filter((x) => x !== r.id))); }}><Trash2 /></button>
            </div>
          ))}
          {routes.length > 1 && <div className="tiny dim">The aircraft flies each route in turn as an out-and-back from {ac.base}, then starts again.</div>}
        </div>
      )}
      <div className="row wrap">
        {candidates.length > 0 && (
          <select className="select" value="" aria-label="Add a route to the rotation"
            onChange={(e) => { if (e.target.value) attempt(setRotation(sim, ac.id, [...ac.rotation, Number(e.target.value)])); }}>
            <option value="">Add an existing route…</option>
            {candidates.map((r) => <option key={r.id} value={r.id}>{routeLabel(r)} — {AIRPORT[r.a === ac.base ? r.b : r.a].city}</option>)}
          </select>
        )}
        <button className="btn" onClick={() => startPlan(ac.base, ac.type, ac.id)}><Plus />Plan a new route</button>
        {ac.phase === 'enroute' && (
          <button className="btn" onClick={() => { inspectFlight(ac.id); game.globe?.followAircraft(ac.id); setState({ panel: null }); }}><Crosshair />Track on the globe</button>
        )}
      </div>

      <div className="section-title">Cabin and base</div>
      <div className="row wrap">
        <select className="select" value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label="Cabin layout">
          <option value="">Refit the cabin…</option>
          {presets.map((x) => {
            const c = makeCabin(type, x.density, x.business, x.first);
            return <option key={x.id} value={x.id}>{x.name} — {totalSeats(c)} seats</option>;
          })}
        </select>
        {preset && (
          <button className="btn" onClick={() => {
            const c = makeCabin(type, preset.density, preset.business, preset.first);
            if (attempt(reconfigureCabin(sim, ac.id, c, preset.density), delivered ? 'Refit under way: back in service in 3 days' : 'Cabin changed') !== undefined) setPresetId('');
          }}>
            <Wrench />{delivered ? `Refit for ${money(refitCost(ac.type))}` : 'Change (free before delivery)'}
          </button>
        )}
        {otherBases.length > 0 && (
          <select className="select" value="" aria-label="Move to another base"
            onChange={(e) => { if (e.target.value) attempt(rebaseAircraft(sim, ac.id, e.target.value), `Moved to ${e.target.value}`); }}>
            <option value="">Move to another base…</option>
            {otherBases.map((h) => <option key={h.airport} value={h.airport}>{h.airport} — {AIRPORT[h.airport].city}</option>)}
          </select>
        )}
      </div>
      {preset && (
        <div className="small muted">
          {DENSITY_NAMES[preset.density]} economy. {makeCabin(type, preset.density, preset.business, preset.first).map((s, i) => (s > 0 ? `${s} ${CLASS_NAMES[i].toLowerCase()}` : null)).filter(Boolean).join(', ')}.
        </div>
      )}

      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn danger" disabled={!delivered} onClick={dispose}>
          <Trash2 />{ac.owned ? 'Sell aircraft' : 'Return to lessor'}
        </button>
        {ac.rotation.length > 0 && delivered && <span className="small dim">Unassign it and let it return to base first.</span>}
      </div>
    </>
  );
}

export function FleetPanel() {
  const sim = useSim();
  const selected = useApp((s) => s.aircraftId);
  const [sort, onSort] = useSort<SortKey>('profit');
  const fleet = sim.fleetOf(0);
  const ac = selected !== null ? sim.acById.get(selected) : undefined;
  const dayOfMonth = Math.max(1, (sim.game.time - monthStart(sim.game.month)) / 1440);

  const rows = fleet.map((a) => ({
    a,
    type: typeName(AIRCRAFT_TYPE[a.type]),
    status: aircraftStatus(sim, a),
    util: a.monthHours / dayOfMonth,
    age: aircraftAgeYears(sim, a),
  }));
  rows.sort((x, y) => {
    const k = sort.key;
    const v = k === 'type' ? x.type.localeCompare(y.type) : k === 'base' ? x.a.base.localeCompare(y.a.base)
      : k === 'status' ? x.status.text.localeCompare(y.status.text) : k === 'util' ? x.util - y.util
        : k === 'age' ? x.age - y.age : x.a.monthProfit - y.a.monthProfit;
    return v * sort.dir;
  });
  const idle = fleet.filter((a) => a.phase === 'idle').length;

  return (
    <Panel title={ac ? aircraftTitle(ac) : 'Fleet'} icon={<Plane size={20} />} onClose={() => openPanel(null)}
      subtitle={ac ? undefined : `${fleet.length} aircraft${idle ? ` · ${idle} idle` : ''}`}
      actions={!ac && <button className="btn sm" onClick={() => openPanel('market')}><Store />Aircraft market</button>}>
      {ac ? <AircraftDetail key={ac.id} ac={ac} /> : fleet.length === 0 ? (
        <Empty title="You have no aircraft yet" action={<button className="btn primary" onClick={() => openPanel('market')}><Store />Open the aircraft market</button>}>
          Lease one to get started: a turboprop or regional jet for thin local routes, a narrowbody for busy ones.
        </Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <Th k="type" sort={sort} onSort={onSort}>Aircraft</Th>
              <Th k="base" sort={sort} onSort={onSort}>Base</Th>
              <Th k="status" sort={sort} onSort={onSort}>Status</Th>
              <th>Routes</th>
              <Th k="util" sort={sort} onSort={onSort} right>Hours/day</Th>
              <Th k="profit" sort={sort} onSort={onSort} right>Month</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, type, status, util }) => (
              <tr key={a.id} className="click" onClick={() => showAircraft(a.id)}>
                <td><div className="strong">{type}</div><div className="tiny dim mono">{a.reg}</div></td>
                <td className="mono">{a.base}</td>
                <td><span className={cx('small', status.tone === 'bad' && 'bad', status.tone === 'warn' && 'warn', status.tone === 'muted' && 'muted')}>{status.text}</span></td>
                <td className="small muted">{a.rotation.length ? a.rotation.map((id) => { const r = sim.routeById.get(id); return r ? (r.a === a.base ? r.b : r.a) : '?'; }).join(', ') : '—'}</td>
                <td className="r">{a.phase === 'delivery' ? '—' : util.toFixed(1)}</td>
                <td className={cx('r', a.monthProfit < 0 ? 'bad' : a.monthProfit > 0 ? 'good' : 'dim')}>{a.monthFlights ? signedMoney(a.monthProfit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
