// Aircraft market: factory-new orders and the second-hand listings.

import { useState } from 'react';
import { Store } from 'lucide-react';
import { activeDiscount, deliveryDaysFor, newLease, newPrice } from '../../sim/actions';
import { AIRCRAFT_TYPE, AIRCRAFT_TYPES, CATEGORY_NAMES, defaultPreset, makeCabin, totalSeats, typeName, usableRange } from '../../sim/data/aircraft';
import { leaseCapacity, leaseCommitment } from '../../sim/finance';
import type { AircraftCategory, AircraftType } from '../../sim/types';
import { integer, km, money } from '../app/format';
import { openPanel, setState, useSim } from '../app/store';
import { AircraftPreview } from '../components/AircraftPreview';
import { MAX_BLOCK_HOURS } from '../../sim/market';
import { cx, Meter, Panel, Seg, Tabs } from '../components/ui';

const CATEGORIES: (AircraftCategory | 'all')[] = ['all', 'turboprop', 'regional', 'narrowbody', 'widebody', 'jumbo'];

function Specs({ type }: { type: AircraftType }) {
  const preset = defaultPreset(type);
  const cabin = makeCabin(type, preset.density, preset.business, preset.first);
  return (
    <dl className="kv small">
      <dt>Typical cabin</dt>
      <dd>{totalSeats(cabin)} seats <span className="dim">({cabin.filter((s) => s > 0).join(' + ')})</span></dd>
      <dt>Range</dt><dd>{km(usableRange(type.id))} <span className="dim">with reserves ({km(type.range)} on paper)</span></dd>
      <dt>Cruise speed</dt><dd>{integer(type.speed)} km/h</dd>
      <dt>Runway needed</dt><dd>{integer(type.runway)} m</dd>
      <dt>Fuel burn</dt><dd>{type.fuelKm.toFixed(2)} kg/km <span className="dim">({((type.fuelKm / type.seats) * 100).toFixed(2)} per 100 seat-km)</span></dd>
      <dt>Turnaround</dt><dd>{type.turnaround} min</dd>
      <dt>Flying time</dt><dd>up to {MAX_BLOCK_HOURS[type.category]} hours a day</dd>
      <dt>Belly cargo</dt><dd>{type.cargo} t</dd>
      <dt>Maintenance</dt><dd>{money(type.maintHour)}/flight hour</dd>
    </dl>
  );
}

export function MarketPanel() {
  const sim = useSim();
  const p = sim.player;
  const [tab, setTab] = useState<'new' | 'used'>('new');
  const [cat, setCat] = useState<AircraftCategory | 'all'>('all');
  const [typeId, setTypeId] = useState('a20n');
  const [listingId, setListingId] = useState<number | null>(null);

  const types = AIRCRAFT_TYPES.filter((t) => t.inProduction && (cat === 'all' || t.category === cat));
  const used = sim.game.used.filter((u) => cat === 'all' || AIRCRAFT_TYPE[u.type].category === cat);
  const listing = used.find((u) => u.id === listingId) ?? used[0];
  const type = tab === 'new' ? (types.find((t) => t.id === typeId) ?? types[0]) : listing ? AIRCRAFT_TYPE[listing.type] : undefined;
  const committed = leaseCommitment(sim, p);
  const capacity = leaseCapacity(sim, p);

  return (
    <Panel wide title="Aircraft market" subtitle="Order factory-new aircraft or pick up a bargain second-hand" icon={<Store size={20} />} onClose={() => openPanel(null)}>
      <div className="row between wrap">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'new', label: 'Factory new' }, { id: 'used', label: `Second-hand (${sim.game.used.length})` }]} />
        <Seg value={cat} onChange={setCat} title="Category" options={CATEGORIES.map((c) => ({ value: c, label: c === 'all' ? 'All' : CATEGORY_NAMES[c] }))} />
      </div>

      <div className="split">
        <div className="split-list">
          {tab === 'new' && types.map((t) => {
            const discount = activeDiscount(sim, t.id);
            return (
              <button key={t.id} className={cx('card tight click row-btn', type?.id === t.id && 'selected')} style={{ padding: '9px 11px' }} onClick={() => setTypeId(t.id)}>
                <div className="row between">
                  <span className="strong">{typeName(t)}</span>
                  {discount > 0 && <span className="badge good">−{Math.round(discount * 100)}%</span>}
                </div>
                <div className="small muted">{CATEGORY_NAMES[t.category]} · {t.seats} seats · {km(usableRange(t.id))}</div>
                <div className="small"><span className="num">{money(newPrice(sim, t.id, p))}</span> <span className="dim">or {money(newLease(sim, t.id, p))}/mo</span></div>
              </button>
            );
          })}
          {tab === 'used' && used.map((u) => {
            const t = AIRCRAFT_TYPE[u.type];
            const days = Math.max(0, Math.ceil((u.expires - sim.game.time) / 1440));
            return (
              <button key={u.id} className={cx('card tight click row-btn', listing?.id === u.id && 'selected')} style={{ padding: '9px 11px' }} onClick={() => setListingId(u.id)}>
                <div className="row between">
                  <span className="strong">{typeName(t)}</span>
                  <span className="badge">{u.age} yr</span>
                </div>
                <div className="small muted">{u.seller} · {days} day{days === 1 ? '' : 's'} left</div>
                <div className="small"><span className="num">{money(u.price)}</span> <span className="dim">or {money(u.lease)}/mo</span></div>
              </button>
            );
          })}
          {tab === 'used' && used.length === 0 && <div className="muted small">Nothing on offer in this category right now. Listings change every few days.</div>}
        </div>

        {type && (
          <div className="col">
            <AircraftPreview typeId={type.id} livery={p.livery} airlineName={p.name} height={230} />
            <div>
              <div className="row between">
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>{typeName(type)}</h3>
                <span className="badge accent">{CATEGORY_NAMES[type.category]}</span>
              </div>
              <p className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>{type.blurb}</p>
            </div>
            <Specs type={type} />
            <div className="col gap-4">
              <div className="row between small"><span className="muted">Passenger comfort</span><span className="num">{Math.round(type.comfort * 100)}</span></div>
              <Meter value={type.comfort} />
            </div>
            {tab === 'used' && listing && (
              <dl className="kv small card tight">
                <dt>Age</dt><dd>{listing.age} years</dd>
                <dt>Condition</dt><dd>{Math.round(listing.condition * 100)}%</dd>
                <dt>Delivery</dt><dd>3 days</dd>
              </dl>
            )}
            <div className="row wrap">
              <button className="btn primary" onClick={() => setState({ modal: { kind: 'acquire', type: type.id, listing: tab === 'used' ? listing?.id : undefined } })}>
                {tab === 'new' ? 'Order' : 'Acquire'}…
              </button>
              <span className="small muted">
                {tab === 'new' ? `Delivered in ${deliveryDaysFor(sim, p, type.id)} days. ` : ''}
                Lease credit: {money(committed)} of {money(capacity)}/mo used.
              </span>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
