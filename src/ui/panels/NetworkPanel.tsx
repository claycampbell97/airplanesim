// Routes: the network list, and the detail view where fares and aircraft are managed.

import { useEffect, useState } from 'react';
import { ArrowLeft, Megaphone, Plus, RefreshCw, Trash2, Waypoints, X } from 'lucide-react';
import { assignToRoute, closeRoute, launchPromo, promoCost, setPrice, unassignFromRoute } from '../../sim/actions';
import { AIRCRAFT_TYPE, AIRCRAFT_TYPES, CLASS_NAMES, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import { blockMinutes, dailyRoundTrips, getMarket, offerOf, OTHER_AIRLINES, rotationFrequency } from '../../sim/market';
import { canOperate } from '../../sim/ops';
import { planRoute } from '../../sim/planner';
import { formatDate, formatMonthShort } from '../../sim/time';
import type { Route, Triple } from '../../sim/types';
import { attempt, confirm, loadFactorOf, recentStats, routeCities, routeLabel } from '../app/act';
import { dollars, duration, integer, km, money, percent, signedMoney, sum3 } from '../app/format';
import { openPanel, showAircraft, showRoute, startPlan, useApp, useSim } from '../app/store';
import { ColumnChart, Sparkline } from '../components/charts';
import { cx, Empty, Logo, Panel, Slider, Th, Tile, useSort } from '../components/ui';

type SortKey = 'route' | 'dist' | 'freq' | 'load' | 'profit';

function loadTone(lf: number): string | undefined {
  if (Number.isNaN(lf)) return 'dim';
  return lf < 0.6 ? 'bad' : lf < 0.7 ? 'warn' : undefined;
}

function Fares({ route }: { route: Route }) {
  const sim = useSim();
  const p = sim.player;
  const m = getMarket(sim, route.a, route.b);
  const [draft, setDraft] = useState<Triple>([route.price[0], route.price[1], route.price[2]]);
  // Follow outside changes (e.g. another route selected, or a rival-driven reset).
  useEffect(() => setDraft([route.price[0], route.price[1], route.price[2]]), [route.id, route.price[0], route.price[1], route.price[2]]);

  const offer = offerOf(sim, route);
  const first = route.aircraft.map((id) => sim.acById.get(id)).find((a) => !!a);
  const forecast = first && offer.freq > 0
    ? planRoute(sim, p, route.a, route.b, first.type, {
      existing: route, price: draft, aircraft: first, count: offer.freq / dailyRoundTrips(first.type, route.dist),
    })
    : null;
  const changed = draft.some((v, i) => v !== route.price[i]);
  const commit = (next: Triple) => attempt(setPrice(sim, route.id, next));

  return (
    <div className="col gap-6">
      {[0, 1, 2].map((c) => {
        if (offer.seats[c] <= 0 && route.aircraft.length > 0) return null;
        const pct = Math.round((draft[c] / m.ref[c]) * 100);
        return (
          <div key={c} style={{ display: 'grid', gridTemplateColumns: '78px 1fr 132px', gap: 12, alignItems: 'center' }}>
            <span className="muted">{CLASS_NAMES[c]}</span>
            <Slider label={`${CLASS_NAMES[c]} fare`} min={50} max={200} step={1} value={Math.max(50, Math.min(200, pct))}
              onChange={(v) => setDraft((d) => { const n: Triple = [d[0], d[1], d[2]]; n[c] = Math.round((m.ref[c] * v) / 100); return n; })}
              onCommit={(v) => { const n: Triple = [draft[0], draft[1], draft[2]]; n[c] = Math.round((m.ref[c] * v) / 100); commit(n); }} />
            <span className="num right"><b className="strong">{dollars(draft[c])}</b> <span className={cx('small', pct > 115 ? 'warn' : pct < 85 ? 'good' : 'dim')}>{pct}%</span></span>
          </div>
        );
      })}
      <div className="row between small">
        <span className="muted">
          {forecast
            ? <>At these fares: about <b className="strong" style={{ color: 'var(--text)' }}>{percent(forecast.estimate.loadFactor)}</b> full, <b className={cx('strong', forecast.profitPerDay < 0 ? 'bad' : 'good')}>{signedMoney(forecast.profitPerDay)}</b>/day</>
            : 'Assign an aircraft to see a forecast.'}
        </span>
        <button className="btn ghost sm" onClick={() => commit([Math.round(m.ref[0]), Math.round(m.ref[1]), Math.round(m.ref[2])])} title="Set all fares to the market reference"><RefreshCw />Market fares</button>
      </div>
      {changed && <div className="tiny dim">Release the slider to apply.</div>}
    </div>
  );
}

function RouteDetail({ route }: { route: Route }) {
  const sim = useSim();
  const p = sim.player;
  const m = getMarket(sim, route.a, route.b);
  const offer = offerOf(sim, route);
  const stats = recentStats(route);
  const lf = loadFactorOf(stats);
  const paxPerFlight = stats.flights ? sum3(stats.pax) / stats.flights : NaN;
  const lastProfit = route.prev.flights ? route.prev.revenue - route.prev.cost : NaN;
  const connShare = sum3(stats.pax) > 0 ? stats.connPax / sum3(stats.pax) : 0;
  const assigned = route.aircraft.map((id) => sim.acById.get(id)).filter((a) => !!a);
  const assignable = sim.fleetOf(0).filter((a) => !a.rotation.includes(route.id) && (a.base === route.a || a.base === route.b) && canOperate(a.type, route.a, route.b).ok);
  const promoActive = sim.game.time < route.promoUntil;
  const rivals = m.routes.filter((r) => r !== route).map((r) => ({ r, o: offerOf(sim, r) })).filter((x) => x.o.freq > 0);
  const typeHint = assigned[0]?.type ?? 'a20n';

  return (
    <>
      <div className="row">
        <button className="btn ghost sm" onClick={() => showRoute(null)}><ArrowLeft />All routes</button>
        <div className="grow" />
        <span className="small muted">{km(route.dist)} · {duration(blockMinutes(typeHint, route.dist))} · flights {p.code}{route.flightNo}/{route.flightNo + 1}</span>
      </div>

      <div className="grid-4">
        <Tile label="Load factor" value={<span className={loadTone(lf)}>{Number.isNaN(lf) ? '—' : percent(lf)}</span>} note={route.cur.flights >= 6 ? 'this month' : 'last month'} />
        <Tile label="Flights a day" value={(offer.freq * 2).toFixed(1)} note={`${offer.freq.toFixed(1)} each way`} />
        <Tile label="Passengers / flight" value={Number.isNaN(paxPerFlight) ? '—' : integer(paxPerFlight)} note={connShare > 0.02 ? `${percent(connShare)} connecting` : undefined} />
        <Tile label="Profit last month" value={<span className={lastProfit < 0 ? 'bad' : undefined}>{Number.isNaN(lastProfit) ? '—' : money(lastProfit)}</span>}
          note={route.prev.revenue > 0 ? `${percent((route.prev.revenue - route.prev.cost) / route.prev.revenue)} margin` : undefined} />
      </div>
      {route.maturity < 0.98 && (
        <div className="small muted">New route: travellers are still discovering it ({percent(route.maturity)} of its potential). {promoActive ? 'A promotion is running.' : ''}</div>
      )}

      <div className="section-title">Fares</div>
      <Fares route={route} />

      <div className="section-title">Aircraft on this route</div>
      {assigned.length === 0 && <div className="warn small">No aircraft assigned: this route is not being flown.</div>}
      <div className="col gap-4">
        {assigned.map((a) => (
          <div key={a.id} className="list-row click" onClick={() => showAircraft(a.id)}>
            <div className="grow"><span className="strong">{typeName(AIRCRAFT_TYPE[a.type])}</span> <span className="mono dim small">{a.reg}</span></div>
            <span className="small muted num">{a.cabin.map((s, i) => (s > 0 ? `${s}${'YJF'[i]}` : null)).filter(Boolean).join(' · ')}</span>
            <span className="small muted num">{rotationFrequency(sim, a).toFixed(1)}/day{a.rotation.length > 1 ? ` · shared with ${a.rotation.length - 1}` : ''}</span>
            <button className="btn ghost icon sm" title="Take off this route" aria-label={`Take ${a.reg} off this route`}
              onClick={(e) => { e.stopPropagation(); attempt(unassignFromRoute(sim, a.id, route.id)); }}><X /></button>
          </div>
        ))}
      </div>
      <div className="row wrap">
        {assignable.length > 0 && (
          <select className="select" value="" aria-label="Assign an aircraft"
            onChange={(e) => { if (e.target.value) attempt(assignToRoute(sim, Number(e.target.value), route.id)); }}>
            <option value="">Assign an aircraft…</option>
            {assignable.map((a) => (
              <option key={a.id} value={a.id}>
                {typeName(AIRCRAFT_TYPE[a.type])} {a.reg} — {a.rotation.length ? `also flies ${a.rotation.length} other` : a.phase === 'delivery' ? 'on delivery' : 'idle'}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={() => openPanel('market')}><Plus />Get another aircraft</button>
        <button className="btn" disabled={promoActive} title="A 45-day advertising push: more local passengers and a faster ramp-up"
          onClick={() => attempt(launchPromo(sim, route.id), 'Promotion launched')}>
          <Megaphone />{promoActive ? `Promotion until ${formatDate(route.promoUntil)}` : `Promote · ${money(promoCost(sim, route))}`}
        </button>
      </div>

      <div className="section-title">Market</div>
      <div className="small muted">
        About <b className="strong" style={{ color: 'var(--text)' }}>{integer(sum3(m.demand))}</b> people a day want to fly each way
        ({integer(m.demand[0])} economy, {integer(m.demand[1])} business{m.demand[2] >= 1 ? `, ${integer(m.demand[2])} first` : ''}).
      </div>
      <table className="tbl compact">
        <thead><tr><th>Airline</th><th className="r">Flights/day</th><th className="r">Seats/day</th><th className="r">Economy fare</th></tr></thead>
        <tbody>
          <tr className="sel">
            <td><div className="row gap-6"><Logo livery={p.livery} size={16} /><span className="strong">{p.name}</span></div></td>
            <td className="r">{offer.freq.toFixed(1)}</td>
            <td className="r">{integer(offer.freq * sum3(offer.seats))}</td>
            <td className="r">{dollars(route.price[0])}</td>
          </tr>
          {rivals.map(({ r, o }) => {
            const al = sim.game.airlines[r.airline];
            return (
              <tr key={r.id}>
                <td><div className="row gap-6"><Logo livery={al.livery} size={16} />{al.name}</div></td>
                <td className="r">{o.freq.toFixed(1)}</td>
                <td className="r">{integer(o.freq * sum3(o.seats))}</td>
                <td className="r">{dollars(r.price[0])}</td>
              </tr>
            );
          })}
          {m.others.freq > 0 && (
            <tr>
              <td className="muted">Other airlines</td>
              <td className="r">{m.others.freq.toFixed(1)}</td>
              <td className="r">{integer(m.others.freq * sum3(m.others.seats))}</td>
              <td className="r">{dollars(m.others.price[0])}</td>
            </tr>
          )}
        </tbody>
      </table>
      {rivals.length === 0 && m.others.freq === 0 && <div className="small good">You have this market to yourself.</div>}

      {route.profitHistory.length > 1 && (
        <>
          <div className="section-title">Monthly profit</div>
          <ColumnChart name="Profit" values={route.profitHistory} format={(v) => money(v)}
            labels={route.profitHistory.map((_, i) => formatMonthShort(sim.game.month - route.profitHistory.length + i))} />
        </>
      )}

      <div className="row">
        <button className="btn danger" onClick={() => confirm(`Close ${routeLabel(route)}?`,
          'The aircraft on it will finish their flights and return to base. Reopening the route later means paying the set-up costs again.',
          'Close route', () => { if (attempt(closeRoute(sim, route.id), `${routeLabel(route)} closed`) !== undefined) showRoute(null, false); })}>
          <Trash2 />Close route
        </button>
      </div>
    </>
  );
}

function NewRouteBar() {
  const sim = useSim();
  const p = sim.player;
  const owned = [...new Set(sim.fleetOf(0).map((a) => a.type))];
  const [base, setBase] = useState(p.hq);
  const [type, setType] = useState(owned[0] ?? 'a20n');
  const others = AIRCRAFT_TYPES.filter((t) => !owned.includes(t.id));
  return (
    <div className="card row wrap">
      <div className="field">
        <label htmlFor="nr-base">From</label>
        <select id="nr-base" className="select" value={base} onChange={(e) => setBase(e.target.value)}>
          {p.hubs.map((h) => <option key={h.airport} value={h.airport}>{h.airport} — {AIRPORT[h.airport].city}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="nr-type">Plan for</label>
        <select id="nr-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {owned.length > 0 && <optgroup label="In your fleet">{owned.map((id) => <option key={id} value={id}>{typeName(AIRCRAFT_TYPE[id])}</option>)}</optgroup>}
          <optgroup label="Other types">{others.map((t) => <option key={t.id} value={t.id}>{typeName(t)}</option>)}</optgroup>
        </select>
      </div>
      <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => startPlan(base, type)}><Plus />Plan on the globe</button>
    </div>
  );
}

export function NetworkPanel() {
  const sim = useSim();
  const selected = useApp((s) => s.routeId);
  const [sort, onSort] = useSort<SortKey>('profit');
  const routes = sim.routesOf(0);
  const route = selected !== null ? sim.routeById.get(selected) : undefined;

  const rows = routes.map((r) => {
    const stats = recentStats(r);
    return { r, freq: offerOf(sim, r).freq * 2, lf: loadFactorOf(stats), profit: r.prev.flights ? r.prev.revenue - r.prev.cost : NaN };
  });
  const num = (v: number) => (Number.isNaN(v) ? -Infinity : v);
  rows.sort((x, y) => {
    const k = sort.key;
    const v = k === 'route' ? routeLabel(x.r).localeCompare(routeLabel(y.r)) : k === 'dist' ? x.r.dist - y.r.dist
      : k === 'freq' ? x.freq - y.freq : k === 'load' ? num(x.lf) - num(y.lf) : num(x.profit) - num(y.profit);
    return v * sort.dir;
  });

  return (
    <Panel title={route ? `${routeLabel(route)}` : 'Routes'} icon={<Waypoints size={20} />} onClose={() => { showRoute(null, false); openPanel(null); }}
      subtitle={route ? routeCities(route) : `${routes.length} route${routes.length === 1 ? '' : 's'} from ${sim.player.hubs.length} base${sim.player.hubs.length === 1 ? '' : 's'}`}>
      {route && route.airline === 0 ? <RouteDetail key={route.id} route={route} /> : (
        <>
          <NewRouteBar />
          {routes.length === 0 ? (
            <Empty title="No routes yet">Choose a base and an aircraft type above, then click a destination on the globe. The planner forecasts passengers and profit before you commit.</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <Th k="route" sort={sort} onSort={onSort}>Route</Th>
                  <Th k="dist" sort={sort} onSort={onSort} right>Distance</Th>
                  <Th k="freq" sort={sort} onSort={onSort} right>Flights/day</Th>
                  <Th k="load" sort={sort} onSort={onSort} right>Load</Th>
                  <Th k="profit" sort={sort} onSort={onSort} right>Last month</Th>
                  <th className="r">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, freq, lf, profit }) => (
                  <tr key={r.id} className="click" onClick={() => showRoute(r.id)}>
                    <td>
                      <div className="strong mono">{routeLabel(r)}</div>
                      <div className="tiny dim">{AIRPORT[r.b].city}{r.aircraft.length === 0 ? ' · no aircraft' : ''}</div>
                    </td>
                    <td className="r muted">{km(r.dist)}</td>
                    <td className={cx('r', freq === 0 && 'warn')}>{freq.toFixed(1)}</td>
                    <td className={cx('r', loadTone(lf))}>{Number.isNaN(lf) ? '—' : percent(lf)}</td>
                    <td className={cx('r', profit < 0 ? 'bad' : undefined)}>{Number.isNaN(profit) ? '—' : money(profit)}</td>
                    <td className="r"><div style={{ display: 'inline-block' }}><Sparkline values={r.profitHistory.slice(-12)} width={72} height={22} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}

export { OTHER_AIRLINES };
