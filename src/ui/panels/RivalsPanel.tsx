// Rivals: the league table, and a closer look at any competitor.

import { ArrowLeft, LocateFixed, Trophy } from 'lucide-react';
import { findRoute } from '../../sim/actions';
import { AIRCRAFT_TYPE, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import { HUB_LEVEL_NAMES, ledgerProfit, ledgerRevenue } from '../../sim/finance';
import { offerOf } from '../../sim/market';
import type { Airline } from '../../sim/types';
import { loadFactorOf, routeLabel } from '../app/act';
import { compact, dollars, money, percent } from '../app/format';
import { inspectAirport, openPanel, showRival, showRoute, useApp, useSim } from '../app/store';
import { HBars } from '../components/charts';
import { cx, Logo, Panel, Th, useSort } from '../components/ui';

type SortKey = 'pax' | 'fleet' | 'routes' | 'revenue' | 'margin' | 'rep';

const STYLE_NAMES = { legacy: 'Full-service network carrier', lowcost: 'Low-cost carrier', regional: 'Regional carrier', premium: 'Premium carrier' };

function monthStats(al: Airline) {
  const h = al.history.slice(-3);
  if (!h.length) return { pax: al.month.pax, revenue: ledgerRevenue(al.month), margin: NaN };
  const revenue = h.reduce((n, r) => n + ledgerRevenue(r), 0) / h.length;
  const profit = h.reduce((n, r) => n + ledgerProfit(r), 0) / h.length;
  return { pax: h.reduce((n, r) => n + r.pax, 0) / h.length, revenue, margin: revenue > 0 ? profit / revenue : NaN };
}

function RivalDetail({ al }: { al: Airline }) {
  const sim = useSim();
  const fleet = sim.fleetOf(al.id);
  const routes = sim.routesOf(al.id);
  const byType = new Map<string, number>();
  for (const ac of fleet) byType.set(ac.type, (byType.get(ac.type) ?? 0) + 1);
  const stats = monthStats(al);
  const shared = routes.map((r) => ({ theirs: r, mine: findRoute(sim, 0, r.a, r.b) })).filter((x) => x.mine);
  const busiest = [...routes].sort((a, b) => offerOf(sim, b).freq - offerOf(sim, a).freq).slice(0, 8);

  return (
    <>
      <div className="row">
        <button className="btn ghost sm" onClick={() => showRival(null)}><ArrowLeft />All airlines</button>
        <div className="grow" />
        <button className="btn sm" onClick={() => inspectAirport(al.hq, true)}><LocateFixed />Show {al.hq} on the globe</button>
      </div>
      <div className="row gap-14">
        <Logo livery={al.livery} size={54} />
        <div>
          <div className="strong" style={{ fontSize: 17 }}>{al.name} <span className="code">{al.code}</span></div>
          <div className="muted small">{al.ai ? STYLE_NAMES[al.ai.style] : 'Your airline'} · based in {AIRPORT[al.hq].city}</div>
        </div>
      </div>
      <div className="grid-4">
        <div className="tile"><div className="k">Fleet</div><div className="v">{fleet.length}</div></div>
        <div className="tile"><div className="k">Routes</div><div className="v">{routes.length}</div></div>
        <div className="tile"><div className="k">Passengers / month</div><div className="v">{compact(stats.pax)}</div></div>
        <div className="tile"><div className="k">Margin</div><div className={cx('v', stats.margin < 0 && 'bad')}>{Number.isNaN(stats.margin) ? '—' : percent(stats.margin)}</div></div>
      </div>
      <div className="row wrap gap-6">
        {al.hubs.map((h) => (
          <button key={h.airport} className="btn sm" onClick={() => inspectAirport(h.airport, true)}>
            <span className="mono">{h.airport}</span> {HUB_LEVEL_NAMES[h.level]}
          </button>
        ))}
      </div>

      <div className="section-title">Fleet</div>
      <HBars format={(v) => String(v)} items={[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ label: typeName(AIRCRAFT_TYPE[id]), value: n }))} />

      {shared.length > 0 && (
        <>
          <div className="section-title">Head to head with you</div>
          <table className="tbl compact">
            <thead><tr><th>Route</th><th className="r">Their fare</th><th className="r">Your fare</th><th className="r">Their flights</th><th className="r">Your load</th></tr></thead>
            <tbody>
              {shared.map(({ theirs, mine }) => (
                <tr key={theirs.id} className="click" onClick={() => showRoute(mine!.id)}>
                  <td className="mono strong">{routeLabel(mine!)}</td>
                  <td className="r">{dollars(theirs.price[0])}</td>
                  <td className={cx('r', mine!.price[0] > theirs.price[0] * 1.05 && 'warn')}>{dollars(mine!.price[0])}</td>
                  <td className="r">{offerOf(sim, theirs).freq.toFixed(1)}/day</td>
                  <td className="r">{mine!.prev.flights ? percent(loadFactorOf(mine!.prev)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="section-title">Busiest routes</div>
      <table className="tbl compact">
        <thead><tr><th>Route</th><th className="r">Flights/day</th><th className="r">Economy fare</th><th className="r">Load</th></tr></thead>
        <tbody>
          {busiest.map((r) => (
            <tr key={r.id} className="click" onClick={() => inspectAirport(r.b, true)}>
              <td><span className="mono strong">{routeLabel(r)}</span> <span className="dim small">{AIRPORT[r.b].city}</span></td>
              <td className="r">{(offerOf(sim, r).freq * 2).toFixed(1)}</td>
              <td className="r">{dollars(r.price[0])}</td>
              <td className="r">{r.prev.flights ? percent(loadFactorOf(r.prev)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function RivalsPanel() {
  const sim = useSim();
  const rivalId = useApp((s) => s.rivalId);
  const [sort, onSort] = useSort<SortKey>('pax');
  const rival = rivalId !== null ? sim.game.airlines[rivalId] : undefined;

  const rows = sim.game.airlines.filter((a) => !a.bankrupt).map((al) => ({
    al, ...monthStats(al), fleet: sim.fleetOf(al.id).length, routes: sim.routesOf(al.id).length,
  }));
  const byPax = [...rows].sort((a, b) => b.pax - a.pax);
  const rankOf = new Map(byPax.map((r, i) => [r.al.id, i + 1]));
  const num = (v: number) => (Number.isNaN(v) ? -Infinity : v);
  rows.sort((x, y) => {
    const k = sort.key;
    const v = k === 'pax' ? x.pax - y.pax : k === 'fleet' ? x.fleet - y.fleet : k === 'routes' ? x.routes - y.routes
      : k === 'revenue' ? x.revenue - y.revenue : k === 'margin' ? num(x.margin) - num(y.margin) : x.al.reputation - y.al.reputation;
    return v * sort.dir;
  });
  const totalPax = rows.reduce((n, r) => n + r.pax, 0);
  const mine = rows.find((r) => r.al.id === 0);

  return (
    <Panel wide title={rival ? rival.name : 'Rivals'} icon={<Trophy size={20} />} onClose={() => openPanel(null)}
      subtitle={rival ? undefined : `${rows.length} airlines${mine && totalPax > 0 ? ` · you carry ${percent(mine.pax / totalPax, 1)} of their combined passengers` : ''}`}>
      {rival ? <RivalDetail key={rival.id} al={rival} /> : (
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Airline</th>
              <th>Home</th>
              <Th k="fleet" sort={sort} onSort={onSort} right>Fleet</Th>
              <Th k="routes" sort={sort} onSort={onSort} right>Routes</Th>
              <Th k="pax" sort={sort} onSort={onSort} right>Passengers/mo</Th>
              <Th k="revenue" sort={sort} onSort={onSort} right>Revenue/mo</Th>
              <Th k="margin" sort={sort} onSort={onSort} right>Margin</Th>
              <Th k="rep" sort={sort} onSort={onSort} right>Reputation</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.al.id} className={cx('click', r.al.id === 0 && 'sel')} onClick={() => showRival(r.al.id)}>
                <td className="dim">{rankOf.get(r.al.id)}</td>
                <td><div className="row gap-6"><Logo livery={r.al.livery} size={20} /><span className="strong">{r.al.name}</span></div></td>
                <td className="mono muted">{r.al.hq}</td>
                <td className="r">{r.fleet}</td>
                <td className="r">{r.routes}</td>
                <td className="r">{compact(r.pax)}</td>
                <td className="r">{money(r.revenue)}</td>
                <td className={cx('r', r.margin < 0 && 'bad')}>{Number.isNaN(r.margin) ? '—' : percent(r.margin)}</td>
                <td className="r">{r.al.reputation.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
