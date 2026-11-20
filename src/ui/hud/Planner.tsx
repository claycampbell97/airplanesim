// Route planning mode: pick a destination on the globe and see what the route would earn.

import { useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { acquireAircraft, findRoute, newLease, noteForecast, openRoute, routeSetupCost, setRotation } from '../../sim/actions';
import { AIRCRAFT_TYPE, AIRCRAFT_TYPES, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import { leaseCapacity, leaseCommitment } from '../../sim/finance';
import { OTHER_AIRLINES, VIA_HUBS } from '../../sim/market';
import { forecastRoute, suggestRoutes } from '../../sim/planner';
import { buySlots, planShortfall, slotsCost, slotsFreeFor, slotsToBuy } from '../../sim/slots';
import { formatDate } from '../../sim/time';
import { deliveryDaysFor } from '../../sim/actions';
import { attempt } from '../app/act';
import { compact, duration, integer, km, money, percent, signedMoney, sum3 } from '../app/format';
import { cancelPlan, game, refresh, showRoute, toast, updatePlan, useApp, useSim } from '../app/store';
import { cx, Seg } from '../components/ui';

export function Planner() {
  const sim = useSim();
  const plan = useApp((s) => s.plan)!;
  const hover = useApp((s) => s.hover);
  const p = sim.player;
  const [count, setCount] = useState(1);
  const aircraft = plan.aircraft !== null ? sim.acById.get(plan.aircraft) : undefined;
  const type = AIRCRAFT_TYPE[plan.type];
  const owned = [...new Set(sim.fleetOf(0).map((a) => a.type))];

  const suggestions = useMemo(
    () => suggestRoutes(sim, p, plan.from, plan.type, 7, aircraft ? { aircraft } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.from, plan.type, plan.aircraft, sim.revision],
  );

  const hovered = hover?.kind === 'airport' && hover.id !== plan.from ? hover.id : null;
  const to = plan.to ?? hovered;
  const existing = to ? findRoute(sim, 0, plan.from, to) : undefined;
  // A specific aircraft that already flies other routes only gives this one a share of its day.
  const share = aircraft ? 1 / (aircraft.rotation.length + 1) : count;
  // Three views of the same plan: once established, in its first month, and with a rival on the route.
  const range = useMemo(
    () => (to ? forecastRoute(sim, p, plan.from, to, plan.type, { aircraft, count: share }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.from, to, plan.type, plan.aircraft, share, sim.revision, sim.game.day],
  );
  const forecast = range?.established ?? null;
  const dest = to ? AIRPORT[to] : null;
  const setup = to ? routeSetupCost(sim, p, plan.from, to) : 0;
  const idle = sim.fleetOf(0).filter((a) => a.type === plan.type && a.base === plan.from && a.rotation.length === 0);
  const lease = newLease(sim, plan.type, p);
  const canLease = leaseCommitment(sim, p) + lease * count <= leaseCapacity(sim, p) && p.cash >= lease * count + setup;
  // Slot-limited airports at either end, and whether the plan fits in the slots held there.
  const slotEnds = to && forecast ? [plan.from, to].filter((id) => AIRPORT[id].slotLimited) : [];
  // (An aircraft that already flies other routes splits its day: it needs no more slots at its own base.)
  const sharing = !!aircraft && aircraft.rotation.length > 0;
  const short = to && forecast && !existing
    ? planShortfall(sim, p, plan.from, to, forecast.estimate.freq, true).filter((s) => !(sharing && s.airport === plan.from))
    : [];
  const blocked = short.length > 0;

  const launch = (mode: 'only' | 'assign' | 'idle' | 'lease') => {
    if (!to) return;
    if (mode !== 'only' && blocked) {
      toast('error', `Not enough slots at ${AIRPORT[short[0].airport].city}`, 'Buy the slots first, or open the route and add aircraft later.');
      return;
    }
    const route = attempt(openRoute(sim, 0, plan.from, to), undefined, 'launch');
    if (!route) return;
    if (mode !== 'only' && forecast) noteForecast(sim, route.id, forecast.estimate.loadFactor, forecast.profitPerDay);
    if (mode === 'assign' && aircraft) {
      attempt(setRotation(sim, aircraft.id, [...aircraft.rotation, route.id]), undefined, null);
    } else if (mode === 'idle') {
      for (const ac of idle.slice(0, count)) attempt(setRotation(sim, ac.id, [route.id]), undefined, null);
    } else if (mode === 'lease') {
      const days = deliveryDaysFor(sim, p, plan.type);
      let done = 0;
      for (let i = 0; i < count; i++) {
        const res = acquireAircraft(sim, 0, plan.type, { lease: true, base: plan.from });
        if (!res.ok) { toast('error', res.reason); break; }
        const ac = sim.fleetOf(0)[sim.fleetOf(0).length - 1];
        const assigned = setRotation(sim, ac.id, [route.id]);
        if (!assigned.ok) toast('error', assigned.reason);
        done++;
      }
      if (done) toast('good', `${done} × ${typeName(type)} leased for ${route.a}–${route.b}`, `Flying starts on delivery, ${formatDate(sim.game.time + days * 1440)}.`, undefined, null);
    }
    game.globe?.invalidate();
    refresh();
    cancelPlan();
    showRoute(route.id, false);
  };

  return (
    <>
      <div className="planner glass">
        <div className="row wrap">
          <span className="strong">New route from</span>
          <select className="select" value={plan.from} onChange={(e) => updatePlan({ from: e.target.value, to: null })} aria-label="Origin base" disabled={!!aircraft}>
            {p.hubs.map((h) => <option key={h.airport} value={h.airport}>{h.airport} — {AIRPORT[h.airport].city}</option>)}
          </select>
          <span className="muted">with</span>
          {aircraft ? (
            <span className="badge accent">{typeName(type)} {aircraft.reg}</span>
          ) : (
            <select className="select" value={plan.type} onChange={(e) => updatePlan({ type: e.target.value, to: null })} aria-label="Aircraft type">
              {owned.length > 0 && <optgroup label="In your fleet">{owned.map((id) => <option key={id} value={id}>{typeName(AIRCRAFT_TYPE[id])}</option>)}</optgroup>}
              <optgroup label="Other types">{AIRCRAFT_TYPES.filter((t) => !owned.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{typeName(t)}</option>)}</optgroup>
            </select>
          )}
          <div className="grow" />
          <button className="btn" onClick={cancelPlan}><X />Cancel</button>
        </div>
        <div className="row wrap gap-6">
          <span className="small muted">Best bets:</span>
          {suggestions.length === 0 && <span className="small dim">No profitable destinations in range for this aircraft.</span>}
          {suggestions.map((s) => (
            <button key={s.b} className="btn sm" aria-pressed={plan.to === s.b} onClick={() => { updatePlan({ to: s.b }); game.globe?.focusRoute({ a: s.a, b: s.b, dist: s.dist }); }}
              style={plan.to === s.b ? { borderColor: 'var(--accent)' } : undefined} title={`${AIRPORT[s.b].city}: ${percent(s.estimate.loadFactor)} full, ${signedMoney(s.profitPerDay)} a day`}>
              <span className="mono">{s.b}</span>
              <span className={s.profitPerDay < 0 ? 'bad' : 'good'}>{signedMoney(s.profitPerDay)}</span>
            </button>
          ))}
        </div>
        <div className="tiny dim">The ring shows the range of the {typeName(type)}. Brighter airports have more demand from {plan.from}. Click one to plan it.</div>
      </div>

      {dest && forecast && (
        <aside className="inspector glass">
          <header className="panel-head">
            <div className="grow">
              <h2><span className="mono">{plan.from}–{dest.id}</span></h2>
              <div className="sub ellipsis">{AIRPORT[plan.from].city} to {dest.city}, {dest.countryName}</div>
            </div>
            {plan.to && <button className="btn ghost icon" onClick={() => updatePlan({ to: null })} aria-label="Clear destination"><X /></button>}
          </header>
          <div className="panel-body">
            {existing ? (
              <div className="warn small">You already fly this route. Open it in Routes to add aircraft.</div>
            ) : !forecast.feasible ? (
              <div className="bad small">{forecast.reason}</div>
            ) : (
              <>
                {!aircraft && (
                  <div className="row between">
                    <span className="muted small">Aircraft on the route</span>
                    <Seg value={count} onChange={setCount} title="Aircraft on the route" options={[0.5, 1, 2, 3].map((v) => ({ value: v, label: v === 0.5 ? '½' : String(v), title: v === 0.5 ? 'Half an aircraft: shared with another route' : undefined }))} />
                  </div>
                )}
                <div className="grid-2">
                  <div className="tile"><div className="k">Expected load</div><div className={cx('v', forecast.estimate.loadFactor < 0.6 && 'bad')}>{percent(forecast.estimate.loadFactor)}</div></div>
                  <div className="tile"><div className="k">Profit a day</div><div className={cx('v', forecast.profitPerDay < 0 ? 'bad' : 'good')}>{signedMoney(forecast.profitPerDay)}</div></div>
                </div>
                {range && (
                  <dl className="kv small" title="The same plan at other moments: while travellers are still discovering the route, and if a competitor matches your flights">
                    <dt>In the first month</dt>
                    <dd><span className={range.firstMonth.profitPerDay < 0 ? 'bad' : 'good'}>{signedMoney(range.firstMonth.profitPerDay)}</span> <span className="dim">· {percent(range.firstMonth.estimate.loadFactor)} full</span></dd>
                    <dt>If a rival moves in</dt>
                    <dd><span className={range.contested.profitPerDay < 0 ? 'bad' : 'good'}>{signedMoney(range.contested.profitPerDay)}</span> <span className="dim">· {percent(range.contested.estimate.loadFactor)} full</span></dd>
                  </dl>
                )}
                <dl className="kv small">
                  <dt>Distance</dt><dd>{km(forecast.dist)} · {duration(forecast.estimate.blockMinutes)}</dd>
                  <dt>Flights</dt><dd>{(forecast.estimate.freq * 2).toFixed(1)} a day ({forecast.estimate.freq.toFixed(1)} each way)</dd>
                  <dt>The market</dt>
                  <dd>{integer(sum3(forecast.estimate.demand))} passengers a day each way <span className="dim">({compact(sum3(forecast.estimate.demand) * 730)} a year)</span></dd>
                  <dt>Your share</dt><dd>{percent(forecast.estimate.share)} <span className="dim">of those who travel</span></dd>
                  <dt>Passengers per flight</dt><dd>{integer(sum3(forecast.estimate.pax))} of {sum3(forecast.cabin)} seats</dd>
                  {sum3(forecast.estimate.conn) >= 1 && <><dt>…of which connecting</dt><dd>{integer(sum3(forecast.estimate.conn))}</dd></>}
                  <dt>Economy fare</dt><dd>${forecast.price[0]} <span className="dim">({percent(forecast.price[0] / forecast.estimate.ref[0])} of the going rate)</span></dd>
                  {slotEnds.map((id) => (
                    <div key={id} style={{ display: 'contents' }}>
                      <dt>Slots at {id}</dt>
                      <dd>{forecast.estimate.freq.toFixed(1)} needed · {Math.max(0, slotsFreeFor(sim, p, id, true)).toFixed(1)} free</dd>
                    </div>
                  ))}
                </dl>
                {short.map((s) => {
                  const n = slotsToBuy(s);
                  const cost = slotsCost(sim, p, s.airport, n);
                  return (
                    <div key={s.airport} className="card tight col gap-6">
                      <div className="small warn">{AIRPORT[s.airport].city} is full: you need {n} more slot{n === 1 ? '' : 's'} there to fly this, or a plan with fewer, larger aircraft.</div>
                      <button className="btn sm" disabled={p.cash < cost} title={p.cash < cost ? 'Not enough cash' : undefined}
                        onClick={() => attempt(buySlots(sim, 0, s.airport, n), `${n} slot${n === 1 ? '' : 's'} bought at ${s.airport}`, 'cash')}>
                        <Plus />Buy {n} slot{n === 1 ? '' : 's'} at {s.airport} · {money(cost)}
                      </button>
                    </div>
                  );
                })}
                <div className="section-title">Per flight</div>
                <dl className="kv small">
                  <dt>Revenue</dt><dd>{money(forecast.flight.revenue)}</dd>
                  <dt>Fuel</dt><dd>{money(forecast.flight.costs.fuel)}</dd>
                  <dt>Crew</dt><dd>{money(forecast.flight.costs.crew)}</dd>
                  <dt>Maintenance</dt><dd>{money(forecast.flight.costs.maintenance)}</dd>
                  <dt>Airports and navigation</dt><dd>{money(forecast.flight.costs.airport + forecast.flight.costs.navigation)}</dd>
                  <dt>Service and sales</dt><dd>{money(forecast.flight.costs.service + forecast.flight.costs.distribution)}</dd>
                  <dt>Aircraft</dt><dd>{money(forecast.flight.ownership)}</dd>
                  <dt className="strong" style={{ color: 'var(--text)' }}>Profit</dt>
                  <dd className={forecast.flight.profit < 0 ? 'bad' : 'good'}>{signedMoney(forecast.flight.profit)} <span className="dim">({percent(forecast.margin)})</span></dd>
                </dl>
                <div className="section-title">Who you are up against</div>
                {forecast.estimate.competitors.length === 0 ? <div className="small good">Nobody flies this route, and it is too short to be worth changing planes for. It would be yours alone.</div> : (
                  <div className="col gap-4 small">
                    {!forecast.estimate.competitors.some((c) => c.airline !== VIA_HUBS) && <div className="good">Nobody flies this route non-stop: today people change planes on the way.</div>}
                    {forecast.estimate.competitors.map((c, i) => (
                      <div key={i} className="row between">
                        <span className="muted">{c.airline === OTHER_AIRLINES ? 'Other airlines' : c.airline === VIA_HUBS ? 'Changing planes elsewhere' : sim.game.airlines[c.airline].name}</span>
                        <span className="num">{c.airline === VIA_HUBS ? '' : `${c.freq.toFixed(1)} flights · `}{integer(c.pax)} passengers · ${Math.round(c.price[0])}</span>
                      </div>
                    ))}
                    <div className="tiny dim">Passengers a day each way they would keep once you are flying.</div>
                  </div>
                )}
                <div className="tiny dim">{p.autoFares === false
                  ? 'At the going rate for fares and today\'s demand, once the route is established.'
                  : 'At the fares revenue management would settle on and today\'s demand, once the route is established.'} Seasons, fuel prices and your reputation will move it.</div>
              </>
            )}
          </div>
          {!existing && forecast.feasible && (
            <footer className="panel-foot" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between small"><span className="muted">Set-up cost</span><span className="num strong">{money(setup)}</span></div>
              {aircraft ? (
                <button className="btn primary block" disabled={blocked} title={blocked ? 'Not enough slots' : undefined} onClick={() => launch('assign')}><Check />Open and assign {aircraft.reg}</button>
              ) : (
                <>
                  {idle.length > 0 && (
                    <button className="btn primary block" disabled={blocked} title={blocked ? 'Not enough slots' : undefined} onClick={() => launch('idle')}><Check />Open and assign {idle.length >= count && count >= 1 ? (count > 1 ? `${count} idle aircraft` : idle[0].reg) : idle[0].reg}</button>
                  )}
                  <button className={cx('btn block', idle.length === 0 && 'primary')} disabled={!canLease || count < 1 || blocked} onClick={() => launch('lease')}
                    title={blocked ? 'Not enough slots' : canLease ? undefined : 'Not enough cash or lease credit'}>
                    <Plus />Open and lease {count >= 1 ? count : 1} new · {money(lease * Math.max(1, count))}/mo
                  </button>
                  <button className="btn ghost block" onClick={() => launch('only')}>Open the route only</button>
                </>
              )}
            </footer>
          )}
        </aside>
      )}
    </>
  );
}
