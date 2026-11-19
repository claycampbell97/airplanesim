// Dialogs: decisions, confirmations, aircraft orders, help and the end of the game.

import { useEffect, useState } from 'react';
import { acquireAircraft, deliveryDays, newLease, newPrice } from '../../sim/actions';
import { AIRCRAFT_TYPE, CLASS_NAMES, makeCabin, presetsFor, defaultPreset, totalSeats, typeName } from '../../sim/data/aircraft';
import { AIRPORT } from '../../sim/data/airports';
import { leaseCapacity, leaseCommitment, valuation } from '../../sim/finance';
import { formatDate } from '../../sim/time';
import { attempt } from '../app/act';
import { integer, money } from '../app/format';
import { game, loadGame, quitToTitle, refresh, setState, toast, useApp, useSim } from '../app/store';
import type { Modal } from '../app/store';
import { Seg } from '../components/ui';

function close(): void {
  setState({ modal: null });
}

function Shell({ title, children, footer, wide, onDismiss }: {
  title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; onDismiss?: () => void;
}) {
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onDismiss?.(); }}>
      <div className={`modal glass ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function DecisionModal({ id }: { id: number }) {
  const sim = useSim();
  const d = sim.game.decisions.find((x) => x.id === id);
  // The decision lapsed (or was settled elsewhere) while the dialog was open.
  useEffect(() => {
    if (!d) close();
  }, [d]);
  if (!d) return null;
  return (
    <Shell title={d.title}>
      <p className="muted" style={{ lineHeight: 1.55 }}>{d.body}</p>
      <div className="col gap-6">
        {d.options.map((o, i) => (
          <button key={i} className="option" onClick={() => { sim.resolveDecision(d.id, i); close(); refresh(); }}>
            <b>{o.label}</b>
            <span>{o.detail}</span>
          </button>
        ))}
      </div>
      <div className="tiny dim">Decide by {formatDate(d.expires)}, or the last option is taken for you.</div>
    </Shell>
  );
}

function ConfirmModal({ modal }: { modal: Extract<Modal, { kind: 'confirm' }> }) {
  return (
    <Shell title={modal.title} onDismiss={close}
      footer={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className={`btn ${modal.danger ? 'danger' : 'primary'}`} onClick={() => { close(); modal.onConfirm(); }}>{modal.action}</button>
      </>}>
      <p className="muted" style={{ lineHeight: 1.55 }}>{modal.body}</p>
    </Shell>
  );
}

function AcquireModal({ modal }: { modal: Extract<Modal, { kind: 'acquire' }> }) {
  const sim = useSim();
  const p = sim.player;
  const type = AIRCRAFT_TYPE[modal.type];
  const listing = modal.listing !== undefined ? sim.game.used.find((u) => u.id === modal.listing) : undefined;
  const presets = presetsFor(type);
  const [presetId, setPresetId] = useState(defaultPreset(type).id);
  const [lease, setLease] = useState(true);
  const [count, setCount] = useState(1);
  const bases = p.hubs.filter((h) => AIRPORT[h.airport].effRunway >= type.runway);
  const [base, setBase] = useState(bases[0]?.airport ?? p.hq);

  if (modal.listing !== undefined && !listing) {
    return <Shell title="No longer available" onDismiss={close} footer={<button className="btn" onClick={close}>Close</button>}>
      <p className="muted">Someone else took that aircraft.</p>
    </Shell>;
  }

  const preset = presets.find((x) => x.id === presetId) ?? presets[0];
  const cabin = makeCabin(type, preset.density, preset.business, preset.first);
  const price = listing ? listing.price : newPrice(sim, type.id, p);
  const rate = listing ? listing.lease : newLease(sim, type.id, p);
  const n = listing ? 1 : count;
  const upfront = (lease ? rate : price) * n;
  const days = listing ? 3 : deliveryDays(type.id);
  const capacity = leaseCapacity(sim, p);
  const committed = leaseCommitment(sim, p);
  const overLease = lease && committed + rate * n > capacity;
  const tooPoor = p.cash < upfront;

  const order = () => {
    let done = 0;
    for (let i = 0; i < n; i++) {
      const res = acquireAircraft(sim, 0, type.id, { lease, cabin, density: preset.density, base, listing: listing?.id });
      if (!res.ok) { toast('error', res.reason); break; }
      done++;
    }
    if (done > 0) {
      game.globe?.invalidate();
      refresh();
      toast('good', `${done > 1 ? `${done} × ` : ''}${typeName(type)} ${lease ? 'leased' : 'ordered'}`, `Delivery to ${base} on ${formatDate(sim.game.time + days * 1440)}.`, undefined, 'cash');
      setState({ modal: null, panel: 'fleet' });
    }
  };

  return (
    <Shell title={`${listing ? 'Acquire' : 'Order'} ${typeName(type)}`} onDismiss={close}
      footer={<>
        <button className="btn ghost" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={tooPoor || overLease || bases.length === 0} onClick={order}>
          {lease ? 'Sign lease' : 'Buy'} · {money(upfront)}{lease ? ' deposit' : ''}
        </button>
      </>}>
      {listing && <div className="small muted">{listing.age}-year-old aircraft from {listing.seller}, condition {Math.round(listing.condition * 100)}%.</div>}
      <div className="row wrap gap-14">
        <div className="field">
          <span className="label">Financing</span>
          <Seg value={lease ? 'lease' : 'buy'} onChange={(v) => setLease(v === 'lease')} title="Financing"
            options={[{ value: 'lease', label: `Lease · ${money(rate)}/mo` }, { value: 'buy', label: `Buy · ${money(price)}` }]} />
        </div>
        {!listing && (
          <div className="field">
            <span className="label">Quantity</span>
            <Seg value={count} onChange={setCount} title="Quantity" options={[1, 2, 3, 5].map((v) => ({ value: v, label: String(v) }))} />
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="acq-cabin">Cabin</label>
        <select id="acq-cabin" className="select" value={preset.id} onChange={(e) => setPresetId(e.target.value)}>
          {presets.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.detail}</option>)}
        </select>
        <div className="small muted">
          {totalSeats(cabin)} seats: {cabin.map((s, i) => (s > 0 ? `${s} ${CLASS_NAMES[i].toLowerCase()}` : null)).filter(Boolean).join(', ')}. You can refit later.
        </div>
      </div>
      <div className="field">
        <label htmlFor="acq-base">Based at</label>
        {bases.length ? (
          <select id="acq-base" className="select" value={base} onChange={(e) => setBase(e.target.value)}>
            {bases.map((h) => <option key={h.airport} value={h.airport}>{h.airport} — {AIRPORT[h.airport].city}</option>)}
          </select>
        ) : <div className="bad small">None of your bases has a runway long enough ({integer(type.runway)} m needed).</div>}
      </div>
      <dl className="kv card tight">
        <dt>{lease ? 'Deposit due now' : 'Price'}</dt><dd>{money(upfront)}</dd>
        {lease && <><dt>Monthly lease</dt><dd>{money(rate * n)} <span className="dim">(12-month minimum)</span></dd></>}
        <dt>Delivery</dt><dd>{formatDate(sim.game.time + days * 1440)} <span className="dim">({days} days)</span></dd>
        <dt>Cash after</dt><dd className={tooPoor ? 'bad' : undefined}>{money(p.cash - upfront)}</dd>
        {lease && <><dt>Lease credit used</dt><dd className={overLease ? 'bad' : undefined}>{money(committed + rate * n)} of {money(capacity)}/mo</dd></>}
      </dl>
      {overLease && <div className="small bad">Lessors will not extend this much credit yet. Grow your revenue, order fewer, or buy outright.</div>}
      {tooPoor && !overLease && <div className="small bad">Not enough cash. {lease ? '' : 'Leasing needs far less up front, or take a loan in Finance.'}</div>}
    </Shell>
  );
}

function GameOverModal() {
  const sim = useSim();
  const p = sim.player;
  const saves = useApp((s) => s.saves);
  const months = p.history.length;
  return (
    <Shell title={`${p.name} has ceased operations`}
      footer={<>
        {saves[0] && <button className="btn" onClick={() => void loadGame(saves[0].slot)}>Load last save</button>}
        <button className="btn primary" onClick={quitToTitle}>Back to the title screen</button>
      </>}>
      <p className="muted" style={{ lineHeight: 1.55 }}>
        The banks have called in their loans and the aircraft are being repossessed. It was a good run.
      </p>
      <dl className="kv card tight">
        <dt>Survived</dt><dd>{months} month{months === 1 ? '' : 's'}</dd>
        <dt>Passengers carried</dt><dd>{integer(p.totalPax)}</dd>
        <dt>Flights operated</dt><dd>{integer(p.totalFlights)}</dd>
        <dt>Peak valuation</dt><dd>{money(Math.max(valuation(sim, p), ...p.history.map((h) => h.valuation)))}</dd>
      </dl>
    </Shell>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Pause or resume'], ['1 – 4', 'Game speed'], ['O N F M B', 'Overview, routes, fleet, market, bases'],
  ['$ P R E G', 'Finance, operations, rivals, news, milestones'], ['Esc', 'Close the current panel or cancel planning'],
  ['Drag', 'Spin the globe'], ['Scroll / pinch', 'Zoom'], ['Double-click', 'Zoom in on a point'], ['?', 'This help'],
];

function HelpModal() {
  return (
    <Shell title="How to play" onDismiss={close} wide footer={<button className="btn primary" onClick={close}>Got it</button>}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="col gap-6 muted" style={{ lineHeight: 1.55 }}>
          <p><b className="strong" style={{ color: 'var(--text)' }}>1. Get an aircraft.</b> Lease or buy one in the aircraft market. Leasing is cheap up front; buying costs less in the long run.</p>
          <p><b className="strong" style={{ color: 'var(--text)' }}>2. Open a route.</b> In Routes, choose “New route”, pick an aircraft type and click a destination. The forecast uses the same model as the live game.</p>
          <p><b className="strong" style={{ color: 'var(--text)' }}>3. Tune it.</b> Aim for load factors around 80%. Fuller than that? Raise fares. Emptier? Cut fares, use a smaller aircraft, or share one aircraft between several thin routes.</p>
          <p><b className="strong" style={{ color: 'var(--text)' }}>4. Build a hub.</b> When many routes meet at a hub, passengers connect between them and fill seats that local demand alone would not.</p>
          <p><b className="strong" style={{ color: 'var(--text)' }}>5. Mind the cash.</b> Fuel prices swing, seasons turn and rivals react. Hedge fuel when it is cheap and keep a reserve for winter.</p>
        </div>
        <table className="tbl compact">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k}><td><span className="code">{k}</span></td><td className="muted">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

export function Modals() {
  const modal = useApp((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'decision': return <DecisionModal id={modal.id} />;
    case 'confirm': return <ConfirmModal modal={modal} />;
    case 'acquire': return <AcquireModal modal={modal} />;
    case 'gameover': return <GameOverModal />;
    case 'help': return <HelpModal />;
  }
}

export { attempt };
