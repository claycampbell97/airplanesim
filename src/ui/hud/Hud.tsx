// The in-game heads-up display: top bar, dock, the open panel, inspectors, news ticker and toasts.

import {
  Building2, CircleAlert, CircleCheck, Info, Landmark, LayoutDashboard, Layers, Newspaper, Pause, Plane, Play,
  Settings, SlidersHorizontal, Star, Store, Tags, Target, Trophy, Users, Waypoints, X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AIRCRAFT_TYPE, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import { ledgerProfit } from '../../sim/finance';
import { formatClock, formatDateLong } from '../../sim/time';
import { compact, money, percent, signedMoney } from '../app/format';
import {
  applySettings, dismissToast, game, inspectAirport, openPanel, setPaused, setSpeed, SPEED_LABELS, togglePanel, useApp, useSim,
} from '../app/store';
import type { PanelId } from '../app/store';
import { cx, Logo } from '../components/ui';
import { BasesPanel } from '../panels/BasesPanel';
import { FinancePanel } from '../panels/FinancePanel';
import { FleetPanel } from '../panels/FleetPanel';
import { MarketPanel } from '../panels/MarketPanel';
import { NetworkPanel } from '../panels/NetworkPanel';
import { NewsPanel } from '../panels/NewsPanel';
import { ObjectivesPanel } from '../panels/ObjectivesPanel';
import { OperationsPanel } from '../panels/OperationsPanel';
import { OverviewPanel } from '../panels/OverviewPanel';
import { RivalsPanel } from '../panels/RivalsPanel';
import { SystemPanel } from '../panels/SystemPanel';
import { Inspector } from './Inspector';
import { Modals } from './Modals';
import { Planner } from './Planner';

const DOCK: { id: PanelId; label: string; key: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', key: 'O', icon: <LayoutDashboard /> },
  { id: 'network', label: 'Routes', key: 'N', icon: <Waypoints /> },
  { id: 'fleet', label: 'Fleet', key: 'F', icon: <Plane /> },
  { id: 'market', label: 'Aircraft market', key: 'M', icon: <Store /> },
  { id: 'bases', label: 'Bases & airports', key: 'B', icon: <Building2 /> },
  { id: 'finance', label: 'Finance', key: '$', icon: <Landmark /> },
  { id: 'operations', label: 'Product & operations', key: 'P', icon: <SlidersHorizontal /> },
  { id: 'rivals', label: 'Rivals', key: 'R', icon: <Trophy /> },
  { id: 'news', label: 'News & events', key: 'E', icon: <Newspaper /> },
  { id: 'objectives', label: 'Milestones', key: 'G', icon: <Target /> },
];

function TopBar() {
  const sim = useSim();
  const paused = useApp((s) => s.paused);
  const speed = useApp((s) => s.speed);
  const p = sim.player;
  const g = sim.game;
  const week = p.daily.slice(-7);
  const avgProfit = week.length ? week.reduce((n, d) => n + d.profit, 0) / week.length : ledgerProfit(p.today);
  const avgPax = week.length ? week.reduce((n, d) => n + d.pax, 0) / week.length : p.today.pax;
  const led = p.month.ask > 0 ? p.month : p.history[p.history.length - 1];
  const lf = led && led.ask > 0 ? led.rpk / led.ask : NaN;
  const fuel = g.world.fuelPrice;
  const fuelBefore = g.world.fuelHistory[Math.max(0, g.world.fuelHistory.length - 31)] ?? fuel;
  const fuelMove = fuel / fuelBefore - 1;
  const hq = AIRPORT[p.hq];

  return (
    <header className="topbar glass">
      <button className="brand" onClick={() => togglePanel('overview')} title="Overview">
        <Logo livery={p.livery} size={32} />
        <div style={{ minWidth: 0 }}>
          <div className="name ellipsis">{p.name}</div>
          <div className="sub ellipsis"><span className="mono">{p.code}</span> · {hq.city}</div>
        </div>
      </button>
      <div className="top-stats">
        <button className="top-stat" onClick={() => togglePanel('finance')} title="Cash in the bank">
          <span className="k">Cash</span>
          <span className={cx('v', p.cash < 0 && 'bad')}>{money(p.cash)}</span>
        </button>
        <button className="top-stat" onClick={() => togglePanel('finance')} title="Average daily profit over the last week">
          <span className="k">Profit / day</span>
          <span className={cx('v', avgProfit < 0 ? 'bad' : 'good')}>{signedMoney(avgProfit)}</span>
        </button>
        <button className="top-stat hide-sm" onClick={() => togglePanel('network')} title="Passengers carried per day, last week">
          <span className="k">Passengers / day</span>
          <span className="v">{compact(avgPax)}</span>
        </button>
        <button className="top-stat hide-sm" onClick={() => togglePanel('network')} title="Share of seats filled this month">
          <span className="k">Load factor</span>
          <span className="v">{Number.isNaN(lf) ? '—' : percent(lf)}</span>
        </button>
        <button className="top-stat hide-sm" onClick={() => togglePanel('operations')} title="Brand reputation, 0–100">
          <span className="k">Reputation</span>
          <span className="v">{p.reputation.toFixed(0)}</span>
        </button>
        <button className="top-stat hide-sm" onClick={() => togglePanel('finance')} title="Jet fuel spot price and its change over 30 days">
          <span className="k">Jet fuel</span>
          <span className="v">${fuel.toFixed(2)}<small className="dim">/kg</small>
            {Math.abs(fuelMove) > 0.01 && <small className={fuelMove > 0 ? 'bad' : 'good'}>{fuelMove > 0 ? '▲' : '▼'}{Math.abs(fuelMove * 100).toFixed(0)}%</small>}
          </span>
        </button>
      </div>
      <div className="clock" title="Game date and time (UTC)">
        <span className="date">{formatDateLong(g.time)}</span>
        <span className="time">{formatClock(g.time)} UTC</span>
      </div>
      <div className="speed" role="group" aria-label="Game speed">
        <button className="pause" aria-pressed={paused} onClick={() => setPaused(!paused)} title="Pause (Space)" aria-label={paused ? 'Resume' : 'Pause'}>
          {paused ? <Play /> : <Pause />}
        </button>
        {[1, 2, 3, 4].map((s) => (
          <button key={s} aria-pressed={!paused && speed === s} onClick={() => setSpeed(s)} title={`Speed ${SPEED_LABELS[s]} (${s})`}>{SPEED_LABELS[s]}</button>
        ))}
      </div>
    </header>
  );
}

function Dock() {
  const panel = useApp((s) => s.panel);
  const sim = useSim();
  const unread = sim.game.news.reduce((n, x) => n + (x.read ? 0 : 1), 0) + sim.game.decisions.length;
  return (
    <nav className="dock glass" aria-label="Management">
      {DOCK.map((d) => (
        <button key={d.id} className="dock-btn" aria-pressed={panel === d.id} aria-label={d.label} onClick={() => togglePanel(d.id)}>
          {d.icon}
          {d.id === 'news' && unread > 0 && <span className="pip">{unread > 99 ? '99+' : unread}</span>}
          <span className="tip">{d.label} <span className="dim mono">{d.key}</span></span>
        </button>
      ))}
      <div className="dock-sep" />
      <button className="dock-btn" aria-pressed={panel === 'system'} aria-label="Game menu" onClick={() => togglePanel('system')}>
        <Settings />
        <span className="tip">Game menu</span>
      </button>
    </nav>
  );
}

function OpenPanel() {
  const panel = useApp((s) => s.panel);
  switch (panel) {
    case 'overview': return <OverviewPanel />;
    case 'network': return <NetworkPanel />;
    case 'fleet': return <FleetPanel />;
    case 'market': return <MarketPanel />;
    case 'bases': return <BasesPanel />;
    case 'finance': return <FinancePanel />;
    case 'operations': return <OperationsPanel />;
    case 'rivals': return <RivalsPanel />;
    case 'news': return <NewsPanel />;
    case 'objectives': return <ObjectivesPanel />;
    case 'system': return <SystemPanel />;
    default: return null;
  }
}

function Ticker() {
  const sim = useSim();
  const settings = useApp((s) => s.settings);
  const g = sim.game;
  const latest = g.news[g.news.length - 1];
  const events = g.world.events.length;
  return (
    <div className="ticker glass">
      {latest ? (
        <>
          <span className={cx('dot', latest.kind)} />
          <button className="feed" onClick={() => openPanel('news')} title="Open the news feed">
            <b>{latest.title}</b> — {latest.body}
          </button>
        </>
      ) : <span className="feed muted">No news yet.</span>}
      {events > 0 && <button className="btn ghost sm" onClick={() => openPanel('news')} title="World events in progress"><Star />{events}</button>}
      <span className="dim small nowrap" title="Aircraft in the air worldwide"><Plane size={12} style={{ verticalAlign: -1 }} /> {game.globe?.traffic.airborne ?? 0}</span>
      <div className="seg" role="group" aria-label="Map layers">
        <button aria-pressed={settings.labels} onClick={() => applySettings({ labels: !settings.labels })} title="Airport labels"><Tags /></button>
        <button aria-pressed={settings.rivalTraffic} onClick={() => applySettings({ rivalTraffic: !settings.rivalTraffic })} title="Other airlines' aircraft"><Users /></button>
        <button aria-pressed={settings.rivalRoutes} onClick={() => applySettings({ rivalRoutes: !settings.rivalRoutes })} title="Other airlines' routes"><Waypoints /></button>
        <button aria-pressed={settings.colorMode !== 'brand'} title={`Route colours: ${settings.colorMode === 'brand' ? 'brand' : settings.colorMode === 'profit' ? 'profitability' : 'load factor'}`}
          onClick={() => applySettings({ colorMode: settings.colorMode === 'brand' ? 'profit' : settings.colorMode === 'profit' ? 'load' : 'brand' })}>
          <Layers />{settings.colorMode !== 'brand' && <span className="tiny">{settings.colorMode === 'profit' ? 'Profit' : 'Load'}</span>}
        </button>
      </div>
    </div>
  );
}

const TOAST_ICON: Record<string, ReactNode> = {
  good: <CircleCheck className="good" />, bad: <CircleAlert className="bad" />, error: <CircleAlert className="bad" />,
  milestone: <Star style={{ color: 'var(--gold)' }} />, rival: <Users style={{ color: 'var(--series-7)' }} />, info: <Info style={{ color: 'var(--accent)' }} />,
  world: <Info />,
};

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast glass', t.kind)}
          onClick={() => { if (t.airport) inspectAirport(t.airport, true); dismissToast(t.id); }}>
          {TOAST_ICON[t.kind]}
          <div className="grow">
            <div className="t">{t.title}</div>
            {t.body && <div className="b">{t.body}</div>}
          </div>
          <button className="btn ghost icon sm" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }}><X /></button>
        </div>
      ))}
    </div>
  );
}

/** What is under the pointer on the globe. */
function HoverTip() {
  const hover = useApp((s) => s.hover);
  const plan = useApp((s) => s.plan);
  const sim = useSim();
  if (!hover || plan) return null;
  let title: ReactNode = null;
  let body: ReactNode = null;
  if (hover.kind === 'airport') {
    const a = AIRPORT[hover.id];
    const hub = sim.player.hubs.find((h) => h.airport === a.id);
    title = <><span className="mono">{a.id}</span> · {a.city}</>;
    body = <>{a.name}, {a.countryName}{hub ? ' · your base' : ''}</>;
  } else if (hover.kind === 'aircraft') {
    const ac = sim.acById.get(hover.id);
    if (!ac || !ac.leg) return null;
    const al = sim.game.airlines[ac.airline];
    const r = sim.routeById.get(ac.leg.route);
    const no = r ? `${al.code}${r.flightNo + (ac.leg.from === r.a ? 0 : 1)}` : `${al.code} ferry`;
    title = <><span className="mono">{no}</span> · {ac.leg.from} → {ac.leg.to}</>;
    body = <>{al.name} · {typeName(AIRCRAFT_TYPE[ac.type])}</>;
  } else {
    const r = sim.routeById.get(hover.id);
    if (!r) return null;
    title = <><span className="mono">{r.a}–{r.b}</span></>;
    body = <>{AIRPORT[r.a].city} to {AIRPORT[r.b].city} · click for details</>;
  }
  return (
    <div className="tooltip" style={{ left: hover.x + 16, top: hover.y + 14 }}>
      <div className="tt-title">{title}</div>
      <div className="muted">{body}</div>
    </div>
  );
}

export function Hud() {
  const plan = useApp((s) => s.plan);
  return (
    <div className="hud">
      <TopBar />
      {!plan && <Dock />}
      {!plan && <OpenPanel />}
      {plan ? <Planner /> : <Inspector />}
      <HoverTip />
      <Toasts />
      <Ticker />
      <Modals />
    </div>
  );
}
