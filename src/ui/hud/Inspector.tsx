// The right-hand inspector: details of whatever was clicked on the globe.

import { ArrowUpCircle, Building2, Crosshair, Plane, Plus, Video, Waypoints, X } from 'lucide-react';
import { developHub, findRoute, hubAt } from '../../sim/actions';
import { AIRCRAFT_TYPE, CLASS_NAMES, totalSeats, typeName } from '../../sim/data/aircraft';
import { AIRPORT, airportDistance, TIER_NAMES } from '../../sim/data/airports';
import { baseDemand, topMarkets } from '../../sim/demand';
import { feeFactor, HUB_LEVEL_NAMES, hubMonthlyFee, hubSetupCost } from '../../sim/finance';
import { formatClock } from '../../sim/time';
import type { Aircraft, Airport } from '../../sim/types';
import { attempt, confirm, flightNumber } from '../app/act';
import { duration, integer, km, money, percent, signedMoney, sum3 } from '../app/format';
import { game, inspectAirport, inspectFlight, setState, showAircraft, showRoute, startPlan, useApp, useSim } from '../app/store';
import { HBars } from '../components/charts';
import { Logo, Meter } from '../components/ui';

function AirportCard({ airport }: { airport: Airport }) {
  const sim = useSim();
  const p = sim.player;
  const hub = hubAt(p, airport.id);
  const myRoutes = sim.routesOf(0).filter((r) => r.a === airport.id || r.b === airport.id);
  const markets = topMarkets(airport.id, 6);
  const nextLevel = ((hub?.level ?? 0) + 1) as 1 | 2 | 3;
  const cost = nextLevel <= 3 ? hubSetupCost(airport, nextLevel) * sim.tuning.cost : 0;
  const defaultType = sim.fleetOf(0)[0]?.type ?? 'a20n';

  // Who else is here.
  const carriers = new Map<number, number>();
  for (const r of sim.game.routes) {
    if (r.airline !== 0 && (r.a === airport.id || r.b === airport.id)) carriers.set(r.airline, (carriers.get(r.airline) ?? 0) + 1);
  }
  const rivals = [...carriers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const events = sim.game.world.events.filter((e) => e.airport === airport.id);

  const upgrade = () => confirm(
    hub ? `Upgrade ${airport.id} to a ${HUB_LEVEL_NAMES[nextLevel].toLowerCase()}?` : `Open a base at ${airport.id}?`,
    hub
      ? `${nextLevel === 2 ? 'Hubs let passengers connect between your flights here.' : 'A mega hub wins more connecting passengers and gets cheaper airport charges.'} One-off cost ${money(cost)}, then ${money(hubMonthlyFee(airport, nextLevel) * sim.tuning.cost)} a month.`
      : `A base lets you station aircraft and start routes here. One-off cost ${money(cost)}, then ${money(hubMonthlyFee(airport, 1) * sim.tuning.cost)} a month.`,
    hub ? 'Upgrade' : 'Open base',
    () => attempt(developHub(sim, 0, airport.id), hub ? `${airport.id} is now a ${HUB_LEVEL_NAMES[nextLevel].toLowerCase()}` : `Base opened at ${airport.id}`),
    false,
  );

  return (
    <aside className="inspector glass">
      <header className="panel-head">
        <div className="grow">
          <h2 className="ellipsis"><span className="mono">{airport.id}</span> · {airport.city}</h2>
          <div className="sub ellipsis">{airport.name} · {airport.countryName}</div>
        </div>
        <button className="btn ghost icon" onClick={() => inspectAirport(null)} aria-label="Close"><X /></button>
      </header>
      <div className="panel-body">
        <div className="row wrap gap-6">
          <span className="badge">{TIER_NAMES[airport.tier]}</span>
          {hub && <span className="badge gold"><Building2 />Your {HUB_LEVEL_NAMES[hub.level].toLowerCase()}</span>}
          {airport.slotLimited && <span className="badge warn">Slot-constrained</span>}
          {events.map((e) => <span key={e.id} className={`badge ${e.demand >= 1 && !e.disruption ? 'good' : 'bad'}`}>{e.title.split(' at ')[0].split(' in ')[0]}</span>)}
        </div>
        <dl className="kv small">
          <dt>Local market</dt><dd>{airport.pax >= 1 ? `${airport.pax.toFixed(1)}M` : `${integer(airport.pax * 1000)}k`} passengers a year</dd>
          <dt>Longest runway</dt><dd>{integer(airport.runway)} m{airport.effRunway < airport.runway - 80 ? ` (acts like ${integer(airport.effRunway)} m at ${integer(airport.elev)} m elevation)` : ''}</dd>
          <dt>Airport charges</dt><dd>{feeFactor(airport) > 1.6 ? 'Very high' : feeFactor(airport) > 1.2 ? 'High' : feeFactor(airport) > 0.9 ? 'Average' : 'Low'}</dd>
        </dl>

        <div className="row wrap">
          {hub ? (
            <>
              <button className="btn primary" onClick={() => startPlan(airport.id, defaultType)}><Plus />Plan a route from here</button>
              {hub.level < 3 && <button className="btn" onClick={upgrade}><ArrowUpCircle />Upgrade · {money(cost)}</button>}
            </>
          ) : (
            <>
              {p.hubs.map((h) => {
                const existing = findRoute(sim, 0, h.airport, airport.id);
                return existing ? (
                  <button key={h.airport} className="btn" onClick={() => showRoute(existing.id)}><Waypoints />Route {h.airport}–{airport.id}</button>
                ) : (
                  <button key={h.airport} className="btn primary" onClick={() => startPlan(h.airport, defaultType, null, airport.id)}><Plus />Plan from {h.airport}</button>
                );
              })}
              <button className="btn" onClick={upgrade}><Building2 />Open a base · {money(cost)}</button>
            </>
          )}
        </div>

        {!hub && p.hubs.length > 0 && (
          <div className="col gap-4 small">
            {p.hubs.map((h) => (
              <div key={h.airport} className="row between">
                <span className="muted">Demand from {h.airport}</span>
                <span className="num">{integer(baseDemand(h.airport, airport.id))} a day · {km(airportDistance(h.airport, airport.id))}</span>
              </div>
            ))}
          </div>
        )}

        {myRoutes.length > 0 && (
          <>
            <div className="section-title">Your routes here</div>
            <div className="col gap-4">
              {myRoutes.slice(0, 8).map((r) => (
                <div key={r.id} className="list-row click" style={{ padding: '5px 8px' }} onClick={() => showRoute(r.id)}>
                  <span className="mono strong">{r.a}–{r.b}</span>
                  <span className="grow muted small ellipsis">{AIRPORT[r.a === airport.id ? r.b : r.a].city}</span>
                  <span className={`small num ${r.prev.revenue - r.prev.cost < 0 ? 'bad' : ''}`}>{r.prev.flights ? money(r.prev.revenue - r.prev.cost) : '—'}</span>
                </div>
              ))}
              {myRoutes.length > 8 && <div className="tiny dim">and {myRoutes.length - 8} more</div>}
            </div>
          </>
        )}

        <div className="section-title">Biggest markets from {airport.id}</div>
        <HBars format={(v) => `${integer(v)}/day`}
          items={markets.map((m) => ({ label: <><span className="mono">{m.airport.id}</span> {m.airport.city}</>, value: m.demand, onClick: () => inspectAirport(m.airport.id, true), title: `${km(m.dist)} away` }))} />

        {rivals.length > 0 && (
          <>
            <div className="section-title">Airlines here</div>
            <div className="col gap-4 small">
              {rivals.map(([id, n]) => {
                const al = sim.game.airlines[id];
                return (
                  <div key={id} className="row between">
                    <span className="row gap-6"><Logo livery={al.livery} size={16} />{al.name}{al.hubs.some((h) => h.airport === airport.id) ? <span className="dim"> · hub</span> : null}</span>
                    <span className="num muted">{n} route{n === 1 ? '' : 's'}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function FlightCard({ ac }: { ac: Aircraft }) {
  const sim = useSim();
  const chase = useApp((s) => s.chase);
  const al = sim.game.airlines[ac.airline];
  const type = AIRCRAFT_TYPE[ac.type];
  const leg = ac.leg;
  const route = leg ? sim.routeById.get(leg.route) : undefined;
  const mine = ac.airline === 0;
  const now = sim.renderTime;
  const progress = leg ? Math.max(0, Math.min(1, (now - leg.dep) / (leg.arr - leg.dep))) : 0;
  const seats = totalSeats(ac.cabin);
  const following = game.globe?.followedAircraft === ac.id;

  return (
    <aside className="inspector glass">
      <header className="panel-head">
        <Logo livery={al.livery} size={30} />
        <div className="grow">
          <h2 className="ellipsis">
            {leg && route ? <span className="mono">{flightNumber(al, route, leg.from)}</span> : <span className="mono">{ac.reg}</span>}
            {leg && <> · {leg.from} → {leg.to}</>}
          </h2>
          <div className="sub ellipsis">{al.name} · {typeName(type)} <span className="mono">{ac.reg}</span></div>
        </div>
        <button className="btn ghost icon" onClick={() => { inspectFlight(null); setState({ chase: null }); }} aria-label="Close"><X /></button>
      </header>
      <div className="panel-body">
        {leg && ac.phase === 'enroute' ? (
          <>
            <div className="col gap-4">
              <div className="row between small">
                <span><b className="strong">{AIRPORT[leg.from].city}</b> <span className="dim mono">{formatClock(leg.dep)}</span></span>
                <span><span className="dim mono">{formatClock(leg.arr)}</span> <b className="strong">{AIRPORT[leg.to].city}</b></span>
              </div>
              <Meter value={progress} />
              <div className="row between tiny dim">
                <span>{km(airportDistance(leg.from, leg.to) * progress)} flown</span>
                <span>{duration(Math.max(0, leg.arr - now))} to go{leg.delay > 15 ? ` · departed ${Math.round(leg.delay)} min late` : ''}</span>
              </div>
            </div>
            {leg.route >= 0 ? (
              <dl className="kv small">
                <dt>On board</dt><dd>{integer(sum3(leg.pax))} of {seats} ({percent(seats ? sum3(leg.pax) / seats : 0)})</dd>
                {[0, 1, 2].map((c) => ac.cabin[c] > 0 && (
                  <div key={c} style={{ display: 'contents' }}><dt className="dim">{CLASS_NAMES[c]}</dt><dd className="muted">{leg.pax[c]} / {ac.cabin[c]}</dd></div>
                ))}
                {leg.connPax >= 1 && <><dt>Connecting</dt><dd>{integer(leg.connPax)}</dd></>}
                {mine && <><dt>Revenue</dt><dd>{money(leg.revenue)}</dd><dt>Cost</dt><dd>{money(leg.cost)}</dd>
                  <dt className="strong" style={{ color: 'var(--text)' }}>This flight</dt><dd className={leg.revenue - leg.cost < 0 ? 'bad' : 'good'}>{signedMoney(leg.revenue - leg.cost)}</dd></>}
              </dl>
            ) : <div className="muted small">Positioning flight with no passengers.</div>}
          </>
        ) : (
          <div className="muted small">{ac.note || 'On the ground'} at {AIRPORT[ac.at].city} ({ac.at}).</div>
        )}
        <div className="row wrap">
          <button className="btn" aria-pressed={following} onClick={() => { game.globe?.followAircraft(following ? null : ac.id); setState({ tick: Date.now() }); }}>
            <Crosshair />{following ? 'Stop tracking' : 'Track'}
          </button>
          {ac.phase === 'enroute' && (
            <button className="btn" aria-pressed={chase === ac.id} onClick={() => setState({ chase: chase === ac.id ? null : ac.id })} title="Fly alongside this aircraft">
              <Video />{chase === ac.id ? 'Leave flight view' : 'Flight view'}
            </button>
          )}
          {mine && <button className="btn" onClick={() => showAircraft(ac.id)}><Plane />Aircraft</button>}
          {mine && route && <button className="btn" onClick={() => showRoute(route.id)}><Waypoints />Route</button>}
        </div>
      </div>
    </aside>
  );
}

export function Inspector() {
  const airportId = useApp((s) => s.airportId);
  const flightId = useApp((s) => s.flightId);
  const sim = useSim();
  if (airportId) return <AirportCard key={airportId} airport={AIRPORT[airportId]} />;
  if (flightId !== null) {
    const ac = sim.acById.get(flightId);
    if (ac) return <FlightCard ac={ac} />;
  }
  return null;
}
