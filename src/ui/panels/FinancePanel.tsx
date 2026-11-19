// Finance: income statement, balance sheet and borrowing, and fuel hedging.

import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { buyHedge, hedgeQuote, monthlyFuelKg } from '../../sim/actions';
import {
  annuity, availableCredit, CREDIT_RATINGS, creditLimit, creditScore, equity, fleetValue, fuelPriceFor, hedgedShare, hubAssets,
  leaseCapacity, leaseCommitment, ledgerCost, ledgerProfit, ledgerRevenue, loanRate, overdraftLimit, repayLoan, takeLoan, totalDebt, valuation,
} from '../../sim/finance';
import { formatDate, formatMonthShort } from '../../sim/time';
import type { CostKey, Ledger, RevenueKey } from '../../sim/types';
import { attempt } from '../app/act';
import { money, percent } from '../app/format';
import { openPanel, refresh, toast, useSim } from '../app/store';
import { ColumnChart, LineChart, SegBar, SERIES, StackedColumns } from '../components/charts';
import { cx, Meter, Panel, Seg, Slider, Tabs, Tile } from '../components/ui';

const REVENUE_ROWS: [RevenueKey, string][] = [
  ['ticketsY', 'Economy tickets'], ['ticketsJ', 'Business tickets'], ['ticketsF', 'First-class tickets'],
  ['ancillary', 'Fees and extras'], ['cargo', 'Cargo'], ['other', 'Other income'],
];
const COST_ROWS: [CostKey, string][] = [
  ['fuel', 'Fuel'], ['crew', 'Flight and cabin crew'], ['maintenance', 'Maintenance'], ['airport', 'Airport charges'],
  ['navigation', 'Navigation charges'], ['service', 'Passenger service'], ['distribution', 'Sales and distribution'],
  ['leases', 'Aircraft leases'], ['depreciation', 'Depreciation'], ['staff', 'Ground staff and offices'], ['marketing', 'Marketing'],
  ['hubs', 'Base facilities'], ['interest', 'Interest'], ['compensation', 'Passenger compensation'], ['misc', 'Other'],
];

/** Cost lines folded into seven groups, in a fixed order so each keeps its colour. */
const COST_GROUPS: { name: string; keys: CostKey[] }[] = [
  { name: 'Fuel', keys: ['fuel'] },
  { name: 'Crew and staff', keys: ['crew', 'staff'] },
  { name: 'Maintenance', keys: ['maintenance'] },
  { name: 'Airports and navigation', keys: ['airport', 'navigation'] },
  { name: 'Service and sales', keys: ['service', 'distribution', 'marketing'] },
  { name: 'Aircraft', keys: ['leases', 'depreciation'] },
  { name: 'Other', keys: ['hubs', 'interest', 'compensation', 'misc'] },
];

function sumLedgers(list: Ledger[]): Ledger | null {
  if (!list.length) return null;
  const out: Ledger = JSON.parse(JSON.stringify(list[0]));
  for (const l of list.slice(1)) {
    for (const k of Object.keys(out.rev) as RevenueKey[]) out.rev[k] += l.rev[k];
    for (const k of Object.keys(out.cost) as CostKey[]) out.cost[k] += l.cost[k];
    out.pax += l.pax; out.flights += l.flights; out.ask += l.ask; out.rpk += l.rpk;
  }
  return out;
}

function Statement() {
  const sim = useSim();
  const p = sim.player;
  const history = p.history;
  const last = history[history.length - 1];
  const year = sumLedgers(history.slice(-12));
  const cols: { title: string; ledger: Ledger | null }[] = [
    { title: 'This month', ledger: p.month },
    { title: 'Last month', ledger: last ?? null },
    { title: history.length >= 12 ? 'Last 12 months' : `Last ${history.length} months`, ledger: year },
  ];
  const cell = (key: string, v: number | undefined) => (
    <td key={key} className="r">{v ? money(v) : <span className="dim">—</span>}</td>
  );
  const recent = history.slice(-24);
  const costMonths = history.slice(-12);
  const basis = last ?? p.month;
  const rev = ledgerRevenue(basis);

  return (
    <>
      <div className="grid-4">
        <Tile label={last ? 'Revenue last month' : 'Revenue so far'} value={money(rev)} />
        <Tile label="Costs" value={money(ledgerCost(basis))} />
        <Tile label="Profit" value={<span className={ledgerProfit(basis) < 0 ? 'bad' : undefined}>{money(ledgerProfit(basis))}</span>} />
        <Tile label="Margin" value={rev > 0 ? percent(ledgerProfit(basis) / rev, 1) : '—'} />
      </div>

      {recent.length > 1 && (
        <>
          <div className="section-title">Profit by month</div>
          <ColumnChart name="Profit" values={recent.map(ledgerProfit)} labels={recent.map((r) => formatMonthShort(r.month))} format={(v) => money(v, Math.abs(v) >= 1e6 ? 1 : 0)} />
        </>
      )}

      {rev > 0 && (
        <>
          <div className="section-title">Where the money comes from</div>
          <SegBar parts={REVENUE_ROWS.map(([k, name], i) => ({ label: name, value: basis.rev[k], color: SERIES[i] }))} />
          <div className="legend">
            {REVENUE_ROWS.filter(([k]) => basis.rev[k] > 0).map(([k, name]) => (
              <span className="key" key={k}><i className="sw" style={{ background: SERIES[REVENUE_ROWS.findIndex((r) => r[0] === k)] }} />{name} <b className="num" style={{ color: 'var(--text)' }}>{percent(basis.rev[k] / rev)}</b></span>
            ))}
          </div>
        </>
      )}

      {costMonths.length > 1 && (
        <>
          <div className="section-title">Costs by month</div>
          <StackedColumns labels={costMonths.map((r) => formatMonthShort(r.month))} format={(v) => money(v, Math.abs(v) >= 1e6 ? 1 : 0)}
            series={COST_GROUPS.map((g, i) => ({ name: g.name, color: SERIES[i], values: costMonths.map((r) => g.keys.reduce((n, k) => n + r.cost[k], 0)) }))} />
        </>
      )}

      <div className="section-title">Income statement</div>
      <table className="tbl compact">
        <thead><tr><th></th>{cols.map((c) => <th key={c.title} className="r">{c.title}</th>)}</tr></thead>
        <tbody>
          {REVENUE_ROWS.map(([k, name]) => (
            <tr key={k}><td className="muted">{name}</td>{cols.map((c) => cell(c.title, c.ledger?.rev[k]))}</tr>
          ))}
          <tr><td className="strong">Revenue</td>{cols.map((c) => <td key={c.title} className="r strong">{c.ledger ? money(ledgerRevenue(c.ledger)) : '—'}</td>)}</tr>
          {COST_ROWS.map(([k, name]) => (
            <tr key={k}><td className="muted">{name}</td>{cols.map((c) => cell(c.title, c.ledger?.cost[k]))}</tr>
          ))}
          <tr><td className="strong">Costs</td>{cols.map((c) => <td key={c.title} className="r strong">{c.ledger ? money(ledgerCost(c.ledger)) : '—'}</td>)}</tr>
        </tbody>
        <tfoot>
          <tr><td>Profit</td>{cols.map((c) => <td key={c.title} className={cx('r', c.ledger && ledgerProfit(c.ledger) < 0 && 'bad')}>{c.ledger ? money(ledgerProfit(c.ledger)) : '—'}</td>)}</tr>
        </tfoot>
      </table>
    </>
  );
}

function Balance() {
  const sim = useSim();
  const p = sim.player;
  const credit = availableCredit(sim, p);
  const rate = loanRate(sim, p);
  const [amount, setAmount] = useState(10);
  const [term, setTerm] = useState(60);
  const max = Math.floor(credit / 1e6);
  const loanAmount = Math.min(amount, max) * 1e6;
  const debt = totalDebt(p);
  const eq = equity(sim, p);
  const history = p.history.slice(-36);
  const committed = leaseCommitment(sim, p);
  const capacity = leaseCapacity(sim, p);

  return (
    <>
      <div className="grid-4">
        <Tile label="Valuation" value={money(valuation(sim, p))} title="What the airline would fetch if sold: equity plus a multiple of earnings and brand" />
        <Tile label="Equity" value={<span className={eq < 0 ? 'bad' : undefined}>{money(eq)}</span>} />
        <Tile label="Debt" value={money(debt)} />
        <Tile label="Credit rating" value={CREDIT_RATINGS[creditScore(sim, p)]} note={`loans at ${percent(rate, 1)}`} />
      </div>
      <dl className="kv card tight small">
        <dt>Cash</dt><dd className={p.cash < 0 ? 'bad' : undefined}>{money(p.cash)}</dd>
        <dt>Owned aircraft (book value)</dt><dd>{money(fleetValue(sim, p))}</dd>
        <dt>Base facilities</dt><dd>{money(hubAssets(p))}</dd>
        <dt>Loans outstanding</dt><dd>{money(-debt)}</dd>
        <dt>Overdraft limit</dt><dd>{money(overdraftLimit(sim, p))}</dd>
      </dl>
      {history.length > 1 && (
        <>
          <div className="section-title">Valuation</div>
          <LineChart height={150} format={(v) => money(v, 0)} zeroBased labels={history.map((r) => formatMonthShort(r.month))}
            series={[{ name: 'Valuation', color: 'var(--series-1)', values: history.map((r) => r.valuation) }]} />
        </>
      )}

      <div className="section-title">Loans</div>
      {p.loans.length === 0 ? <div className="small muted">No loans outstanding.</div> : (
        <table className="tbl compact">
          <thead><tr><th>Taken</th><th className="r">Balance</th><th className="r">Rate</th><th className="r">Payment</th><th className="r">Left</th><th></th></tr></thead>
          <tbody>
            {p.loans.map((l) => (
              <tr key={l.id}>
                <td className="muted">{formatDate(l.taken)}</td>
                <td className="r">{money(l.balance)}</td>
                <td className="r">{percent(l.rate, 1)}</td>
                <td className="r">{money(l.payment)}/mo</td>
                <td className="r">{l.monthsLeft} mo</td>
                <td className="r"><button className="btn sm" disabled={p.cash <= 0} onClick={() => { if (repayLoan(p, l.id)) { refresh(); toast('info', 'Loan repaid'); } }}>Repay</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="card col gap-6">
        <div className="row between">
          <span className="strong">Borrow</span>
          <span className="small muted">Up to {money(credit)} available of a {money(creditLimit(sim, p))} limit</span>
        </div>
        {max >= 1 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 12, alignItems: 'center' }}>
              <Slider label="Loan amount" min={1} max={max} value={Math.min(amount, max)} onChange={setAmount} />
              <span className="num strong right">{money(loanAmount)}</span>
            </div>
            <div className="row between wrap">
              <Seg value={term} onChange={setTerm} title="Term" options={[{ value: 24, label: '2 years' }, { value: 60, label: '5 years' }, { value: 120, label: '10 years' }]} />
              <span className="small muted">{percent(rate, 1)} interest · {money(annuity(loanAmount, rate, term))} a month</span>
              <button className="btn primary" onClick={() => { if (takeLoan(sim, p, loanAmount, term)) { refresh(); toast('good', `Borrowed ${money(loanAmount)}`, undefined, undefined, 'cash'); } }}>Take loan</button>
            </div>
          </>
        ) : <div className="small muted">The banks will not lend more for now. Owned aircraft and steady profits raise your limit.</div>}
      </div>

      <div className="section-title">Leasing</div>
      <div className="col gap-4">
        <div className="row between small"><span className="muted">Lease commitments</span><span className="num">{money(committed)} of {money(capacity)} a month</span></div>
        <Meter value={capacity > 0 ? committed / capacity : 0} />
        <div className="tiny dim">Lessors extend more credit as your revenue and equity grow.</div>
      </div>
    </>
  );
}

function Fuel() {
  const sim = useSim();
  const p = sim.player;
  const w = sim.game.world;
  const history = w.fuelHistory.slice(-365);
  const covered = hedgedShare(sim, p);
  const [share, setShare] = useState(0.5);
  const [months, setMonths] = useState(6);
  const quote = hedgeQuote(sim, p, share, months);
  const burn = monthlyFuelKg(sim, p);
  const last = p.history[p.history.length - 1];
  const avg = history.reduce((n, v) => n + v, 0) / Math.max(1, history.length);

  return (
    <>
      <div className="grid-4">
        <Tile label="Spot price" value={`$${w.fuelPrice.toFixed(3)}`} note="per kg" />
        <Tile label="You pay" value={`$${fuelPriceFor(sim, p).toFixed(3)}`} note={covered > 0 ? `${percent(covered)} hedged` : 'unhedged'} />
        <Tile label="12-month average" value={`$${avg.toFixed(3)}`} delta={`${w.fuelPrice >= avg ? '+' : '−'}${Math.abs((w.fuelPrice / avg - 1) * 100).toFixed(0)}%`} deltaGood={w.fuelPrice <= avg} note="today vs average" />
        <Tile label="Fuel bill" value={last ? money(last.cost.fuel) : '—'} note={last ? `${percent(last.cost.fuel / Math.max(1, ledgerCost(last)))} of costs` : 'last month'} />
      </div>
      <div className="section-title">Jet fuel price, last {history.length} days</div>
      <LineChart height={170} format={(v) => `$${v.toFixed(2)}`} labels={history.map((_, i) => formatDate(sim.game.time - (history.length - 1 - i) * 1440))}
        series={[{ name: 'Spot price per kg', color: 'var(--series-1)', values: history }]} />

      <div className="section-title">Hedging</div>
      <div className="small muted">
        A hedge fixes the price you pay for part of your fuel. It protects you when prices jump, and costs you when they fall.
      </div>
      {p.hedges.length > 0 && (
        <table className="tbl compact">
          <thead><tr><th>Cover</th><th className="r">Fixed price</th><th className="r">Until</th><th className="r">Against spot</th></tr></thead>
          <tbody>
            {p.hedges.map((h) => (
              <tr key={h.id}>
                <td>{percent(h.share)} of fuel</td>
                <td className="r">${h.price.toFixed(3)}</td>
                <td className="r muted">{formatDate(h.until)}</td>
                <td className={cx('r', h.price <= w.fuelPrice ? 'good' : 'bad')}>{h.price <= w.fuelPrice ? 'saving' : 'costing'} {percent(Math.abs(1 - h.price / w.fuelPrice))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="card col gap-6">
        <div className="row between wrap">
          <div className="field">
            <span className="label">Share of fuel</span>
            <Seg value={share} onChange={setShare} title="Share of fuel" options={[0.25, 0.5, 0.75, 1].map((v) => ({ value: v, label: percent(v) }))} />
          </div>
          <div className="field">
            <span className="label">For</span>
            <Seg value={months} onChange={setMonths} title="Duration" options={[3, 6, 12].map((v) => ({ value: v, label: `${v} months` }))} />
          </div>
        </div>
        <div className="row between wrap">
          <span className="small muted">Locks in ${quote.price.toFixed(3)}/kg · arrangement fee {money(quote.fee)}{burn > 0 ? ` · about ${money(burn * share * quote.price)} of fuel a month` : ''}</span>
          <button className="btn primary" disabled={covered + share > 1.0001 || burn <= 0}
            onClick={() => attempt(buyHedge(sim, 0, share, months), `Hedged ${percent(share)} of fuel for ${months} months`)}>Buy hedge</button>
        </div>
        {burn <= 0 && <div className="tiny dim">Fly for a while first: hedges are sized from your fuel consumption.</div>}
        {covered + share > 1.0001 && burn > 0 && <div className="tiny warn">That would cover more than all of your fuel.</div>}
      </div>
    </>
  );
}

export function FinancePanel() {
  const [tab, setTab] = useState<'statement' | 'balance' | 'fuel'>('statement');
  return (
    <Panel title="Finance" icon={<Landmark size={20} />} onClose={() => openPanel(null)}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'statement', label: 'Income' }, { id: 'balance', label: 'Balance sheet and loans' }, { id: 'fuel', label: 'Fuel' }]} />
      {tab === 'statement' ? <Statement /> : tab === 'balance' ? <Balance /> : <Fuel />}
    </Panel>
  );
}
