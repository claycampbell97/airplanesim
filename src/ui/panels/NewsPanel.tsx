// News and events: decisions waiting for an answer, what is happening in the world, and the feed.

import { useEffect, useState } from 'react';
import { Newspaper } from 'lucide-react';
import { AIRPORT, REGION_NAMES } from '../../sim/data/airports';
import { formatClock, formatDate } from '../../sim/time';
import { WEATHER_CLOSES, weatherEffect, weatherReport } from '../../sim/weather';
import type { NewsKind } from '../../sim/types';
import { percent } from '../app/format';
import { game, inspectAirport, openPanel, refresh, setState, useSim } from '../app/store';
import { cx, Panel, Seg, WeatherIcon } from '../components/ui';

type Filter = 'all' | 'airline' | 'rivals' | 'world';
const FILTERS: Record<Filter, NewsKind[] | null> = {
  all: null, airline: ['info', 'good', 'bad', 'milestone'], rivals: ['rival'], world: ['world'],
};

export function NewsPanel() {
  const sim = useSim();
  const g = sim.game;
  const [filter, setFilter] = useState<Filter>('all');

  // Opening the panel marks everything as read.
  useEffect(() => {
    let changed = false;
    for (const n of g.news) if (!n.read) { n.read = true; changed = true; }
    if (changed) refresh();
  });

  const kinds = FILTERS[filter];
  const items = g.news.filter((n) => !kinds || kinds.includes(n.kind)).slice(-80).reverse();
  const events = g.world.events.filter((e) => e.end > g.time);
  // Weather that is doing something to the airline, and the worst of the rest.
  const reports = weatherReport(sim).filter((w) => w.intensity >= 0.15);
  const weather = [...reports.filter((w) => w.affected.length > 0), ...reports.filter((w) => w.affected.length === 0).slice(0, 4)];

  return (
    <Panel title="News and events" icon={<Newspaper size={20} />} onClose={() => openPanel(null)}>
      {g.decisions.length > 0 && (
        <>
          <div className="section-title">Waiting for your decision</div>
          {g.decisions.map((d) => (
            <div key={d.id} className="card row">
              <div className="grow">
                <div className="strong">{d.title}</div>
                <div className="small muted">Answer by {formatDate(d.expires)}</div>
              </div>
              <button className="btn primary sm" onClick={() => setState({ modal: { kind: 'decision', id: d.id } })}>Decide</button>
            </div>
          ))}
        </>
      )}

      {events.length > 0 && (
        <>
          <div className="section-title">Happening now</div>
          <div className="col gap-4">
            {events.map((e) => {
              const days = Math.max(1, Math.ceil((e.end - g.time) / 1440));
              const effects: string[] = [];
              if (e.demand !== 1) effects.push(`demand ${e.demand > 1 ? '+' : '−'}${percent(Math.abs(e.demand - 1))}`);
              if (e.fuel) effects.push(`fuel ${e.fuel > 1 ? '+' : '−'}${percent(Math.abs(e.fuel - 1))}`);
              if (e.disruption) effects.push(e.disruption >= 0.9 ? 'airport closed' : 'delays');
              return (
                <div key={e.id} className={cx('list-row', e.airport && 'click')} onClick={() => e.airport && inspectAirport(e.airport, true)}>
                  <span className={cx('dot', e.demand >= 1 && !e.disruption && !(e.fuel && e.fuel > 1) ? 'good' : 'bad')} style={{ width: 7, height: 7, borderRadius: 4, flex: 'none' }} />
                  <div className="grow">
                    <span className="strong">{e.title}</span>
                    <span className="muted small"> · {e.airport ? AIRPORT[e.airport].id : e.region ? REGION_NAMES[e.region] : 'worldwide'} · {effects.join(', ')}</span>
                  </div>
                  <span className="small dim nowrap">{days} day{days === 1 ? '' : 's'} left</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {weather.length > 0 && (
        <>
          <div className="section-title">Weather</div>
          <div className="col gap-4">
            {weather.map((w) => {
              const closes = w.intensity >= WEATHER_CLOSES;
              const hours = Math.max(1, Math.round((w.system.end - g.time) / 60));
              return (
                <div key={w.system.id} className="list-row click" onClick={() => game.globe?.controls.flyTo({ lat: w.lat, lon: w.lon, altitude: 0.9 })}>
                  <span className={w.affected.length ? (closes ? 'bad' : 'warn') : 'dim'} style={{ flex: 'none', display: 'flex' }}><WeatherIcon kind={w.system.kind} size={16} /></span>
                  <div className="grow">
                    <span className="strong">{w.system.title}</span>
                    <span className="muted small"> · {w.over ? 'over' : 'at sea near'} {w.near.city} · {closes ? 'closes airports under its core' : weatherEffect(w.intensity)}</span>
                    {w.affected.length > 0 && (
                      <div className="small">
                        <span className="muted">Your airports: </span>
                        {w.affected.slice(0, 6).map((a, i) => (
                          <span key={a.airport.id}>{i > 0 && ', '}<span className="mono">{a.airport.id}</span> <span className={a.strength >= WEATHER_CLOSES ? 'bad' : 'muted'}>{a.strength >= WEATHER_CLOSES ? 'closed' : weatherEffect(a.strength)}</span></span>
                        ))}
                        {w.affected.length > 6 && <span className="muted"> and {w.affected.length - 6} more</span>}
                      </div>
                    )}
                  </div>
                  <span className="small dim nowrap">{hours >= 36 ? `${Math.round(hours / 24)} days` : `${hours} h`} left</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="row between">
        <div className="section-title plain">News</div>
        <Seg value={filter} onChange={setFilter} title="Filter" options={[{ value: 'all', label: 'All' }, { value: 'airline', label: 'Your airline' }, { value: 'rivals', label: 'Rivals' }, { value: 'world', label: 'World' }]} />
      </div>
      <div className="col gap-4">
        {items.length === 0 && <div className="muted small">Nothing to report.</div>}
        {items.map((n) => (
          <div key={n.id} className={cx('list-row top', n.airport && 'click')} style={{ alignItems: 'flex-start' }} onClick={() => n.airport && inspectAirport(n.airport, true)}>
            <span className={cx('dot', n.kind)} style={{ width: 7, height: 7, borderRadius: 4, flex: 'none', marginTop: 6, background: n.kind === 'info' ? 'var(--accent)' : undefined }} />
            <div className="grow">
              <div className="strong">{n.title}</div>
              <div className="small muted" style={{ lineHeight: 1.45 }}>{n.body}</div>
            </div>
            <span className="tiny dim nowrap" style={{ marginTop: 2 }}>{formatDate(n.time)} {formatClock(n.time)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
