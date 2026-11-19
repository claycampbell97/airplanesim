// Overview: the state of the airline at a glance, and what needs attention.

import { useState } from 'react';
import { Check, ChevronRight, CircleAlert, LayoutDashboard } from 'lucide-react';
import { AIRPORT } from '../../sim/data/airports';
import { ledgerProfit, ledgerRevenue, overdraftLimit } from '../../sim/finance';
import { playerRank } from '../../sim/objectives';
import { formatDate } from '../../sim/time';
import { loadFactorOf, routeLabel } from '../app/act';
import { compact, money, percent, signedMoney, signedPercent } from '../app/format';
import { openPanel, setState, showAircraft, showRoute, useSim } from '../app/store';
import type { PanelId } from '../app/store';
import { HBars, LineChart, Sparkline } from '../components/charts';
import { Panel, Seg, Tile } from '../components/ui';

interface Alert { tone: 'bad' | 'warn' | 'info'; text: string; action: () => void }

function FirstSteps() {
  const sim = useSim();
  const p = sim.player;
  const fleet = sim.fleetOf(0);
  const routes = sim.routesOf(0);
  const steps: { done: boolean; title: string; detail: string; panel: PanelId; cta: string }[] = [
    { done: fleet.length > 0, title: 'Get your first aircraft', detail: 'Leasing costs one month’s rent up front. A narrowbody suits busy routes; a turboprop or regional jet suits thin ones.', panel: 'market', cta: 'Aircraft market' },
    { done: routes.length > 0, title: 'Open a route', detail: 'Plan it on the globe: the forecast shows the load factor and daily profit before you commit.', panel: 'network', cta: 'Plan a route' },
    { done: routes.some((r) => r.aircraft.length > 0), title: 'Put an aircraft on the route', detail: 'A route earns nothing until an aircraft is assigned to it.', panel: 'fleet', cta: 'Fleet' },
    { done: p.totalFlights > 0, title: 'Start the clock', detail: 'Press Space or pick a speed in the top-right corner and watch your first flight leave.', panel: 'overview', cta: '' },
  ];
  const next = steps.findIndex((s) => !s.done);
  if (next < 0) return null;
  return (
    <div className="card col gap-6" style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}>
      <div className="strong" style={{ fontSize: 14 }}>Welcome aboard. Here is how to get flying:</div>
      {steps.map((s, i) => (
        <div key={i} className="row top" style={{ opacity: s.done ? 0.55 : 1 }}>
          <span className="badge" style={{ width: 22, justifyContent: 'center', padding: 0, background: s.done ? 'rgba(52,211,153,.18)' : undefined }}>
            {s.done ? <Check className="good" /> : i + 1}
          </span>
          <div className="grow">
            <div className="strong">{s.title}</div>
            {i === next && <div className="small muted">{s.detail}</div>}
          </div>
          {i === next && s.cta && <button className="btn primary sm" onClick={() => openPanel(s.panel)}>{s.cta}<ChevronRight /></button>}
        </div>
      ))}
    </div>
  );
}

export function OverviewPanel() {
  const sim = useSim();
  const p = sim.player;
  const g = sim.game;
  const [chart, setChart] = useState<'cash' | 'profit'>('cash');
  const fleet = sim.fleetOf(0);
  const routes = sim.routesOf(0);
  const last = p.history[p.history.length - 1];
  const before = p.history[p.history.length - 2];
  const monthProfit = ledgerProfit(p.month);
  const lf = p.month.ask > 0 ? p.month.rpk / p.month.ask : last && last.ask > 0 ? last.rpk / last.ask : NaN;
  const flights = p.month.flights + p.month.cancelled;
  const daily = p.daily.slice(-90);
  const rank = p.history.length ? playerRank(sim) : null;

  const alerts: Alert[] = [];
  if (p.cash < 0) {
    const limit = overdraftLimit(sim, p);
    alerts.push({ tone: 'bad', text: p.cash < -limit ? `Over your overdraft limit — ${45 - p.insolventDays} days to fix it` : `Overdrawn by ${money(-p.cash)} (limit ${money(limit)}), paying 16% interest`, action: () => openPanel('finance') });
  }
  for (const d of g.decisions) alerts.push({ tone: 'warn', text: `Decision needed: ${d.title}`, action: () => setState({ modal: { kind: 'decision', id: d.id } }) });
  for (const ac of fleet) {
    if (ac.phase === 'idle') alerts.push({ tone: 'warn', text: `${ac.reg} is idle at ${ac.base}`, action: () => showAircraft(ac.id) });
    else if (ac.phase === 'grounded') alerts.push({ tone: 'bad', text: `${ac.reg} is grounded at ${ac.at}`, action: () => showAircraft(ac.id) });
  }
  for (const r of routes) {
    if (r.aircraft.length === 0) alerts.push({ tone: 'warn', text: `${routeLabel(r)} has no aircraft`, action: () => showRoute(r.id) });
    else if (r.lossMonths >= 2) alerts.push({ tone: 'bad', text: `${routeLabel(r)} has lost money ${r.lossMonths} months running`, action: () => showRoute(r.id) });
    else if (r.prev.flights > 8 && loadFactorOf(r.prev) > 0.93) alerts.push({ tone: 'info', text: `${routeLabel(r)} is ${percent(loadFactorOf(r.prev))} full — room to raise fares or add capacity`, action: () => showRoute(r.id) });
  }
  const arriving = fleet.filter((a) => a.phase === 'delivery');

  const ranked = routes.filter((r) => r.prev.flights > 0).map((r) => ({ r, profit: r.prev.revenue - r.prev.cost })).sort((a, b) => b.profit - a.profit);

  return (
    <Panel title="Overview" icon={<LayoutDashboard size={20} />} onClose={() => openPanel(null)}
      subtitle={`${AIRPORT[p.hq].city} · ${fleet.length} aircraft · ${routes.length} routes${rank ? ` · #${rank} worldwide by passengers` : ''}`}>
      <FirstSteps />

      <div className="grid-4">
        <Tile label="Cash" value={<span className={p.cash < 0 ? 'bad' : undefined}>{money(p.cash)}</span>} onClick={() => openPanel('finance')}>
          <Sparkline values={daily.map((d) => d.cash)} />
        </Tile>
        <Tile label="Profit this month" value={<span className={monthProfit < 0 ? 'bad' : undefined}>{money(monthProfit)}</span>}
          note={last ? `${signedMoney(ledgerProfit(last))} last month` : undefined} onClick={() => openPanel('finance')}>
          <Sparkline values={daily.map((d) => d.profit)} />
        </Tile>
        <Tile label="Passengers" value={compact(p.month.pax)} title="Passengers carried so far this month"
          delta={last && before && before.pax > 0 ? signedPercent(last.pax / before.pax - 1, 0) : undefined}
          deltaGood={last && before && before.pax > 0 ? last.pax >= before.pax : null} note={last && before ? 'last month' : 'this month'}>
          <Sparkline values={daily.map((d) => d.pax)} />
        </Tile>
        <Tile label="Load factor" value={Number.isNaN(lf) ? '—' : percent(lf)} note={flights ? `${percent(p.otp)} on time` : undefined} onClick={() => openPanel('network')} />
      </div>

      {daily.length > 2 && (
        <div className="col gap-6">
          <div className="row between">
            <div className="section-title plain">{chart === 'cash' ? 'Cash balance' : 'Daily profit'} · last {daily.length} days</div>
            <Seg value={chart} onChange={setChart} title="Chart" options={[{ value: 'cash', label: 'Cash' }, { value: 'profit', label: 'Daily profit' }]} />
          </div>
          <LineChart height={160} format={(v) => money(v, Math.abs(v) >= 1e6 ? 1 : 0)} zeroBased={chart === 'profit'}
            labels={daily.map((d) => formatDate(d.day * 1440))}
            series={[{ name: chart === 'cash' ? 'Cash' : 'Profit', color: 'var(--series-1)', values: daily.map((d) => (chart === 'cash' ? d.cash : d.profit)) }]} />
        </div>
      )}

      {(alerts.length > 0 || arriving.length > 0) && (
        <>
          <div className="section-title">Needs attention</div>
          <div className="col gap-4">
            {alerts.slice(0, 8).map((a, i) => (
              <div key={i} className="list-row click" onClick={a.action}>
                <CircleAlert size={15} className={a.tone === 'bad' ? 'bad' : a.tone === 'warn' ? 'warn' : 'dim'} />
                <span className="grow">{a.text}</span>
                <ChevronRight size={14} className="dim" />
              </div>
            ))}
            {alerts.length > 8 && <div className="tiny dim" style={{ paddingLeft: 10 }}>and {alerts.length - 8} more</div>}
            {arriving.map((ac) => (
              <div key={ac.id} className="list-row click" onClick={() => showAircraft(ac.id)}>
                <Check size={15} className="dim" />
                <span className="grow muted">{ac.reg} arrives on {formatDate(ac.next)}{ac.rotation.length === 0 ? ' — no route lined up yet' : ''}</span>
                <ChevronRight size={14} className="dim" />
              </div>
            ))}
          </div>
        </>
      )}

      {ranked.length > 0 && (
        <>
          <div className="section-title">Routes by profit last month</div>
          <HBars format={(v) => money(v)}
            items={[...ranked.slice(0, 5), ...(ranked.length > 7 ? ranked.slice(-2) : ranked.slice(5))].map(({ r, profit }) => ({
              label: <><span className="mono">{routeLabel(r)}</span> {AIRPORT[r.b].city}</>, value: profit, onClick: () => showRoute(r.id),
            }))} />
        </>
      )}

      {last && (
        <div className="small muted">
          Last month: revenue {money(ledgerRevenue(last))}, {compact(last.pax)} passengers on {compact(last.flights)} flights, reputation {p.reputation.toFixed(0)}.
        </div>
      )}
    </Panel>
  );
}
