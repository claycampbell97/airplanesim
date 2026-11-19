// Product and operations: the policies that shape cost, quality and reliability.

import { SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { setPolicy } from '../../sim/actions';
import { dailyFixedCosts, DAYS_PER_MONTH } from '../../sim/finance';
import { airlineQualityBase } from '../../sim/market';
import type { Policy } from '../../sim/types';
import { money, percent } from '../app/format';
import { game, openPanel, refresh, useSim } from '../app/store';
import { HBars } from '../components/charts';
import { Meter, Panel, Slider, Tile } from '../components/ui';

const SERVICE = [
  ['No frills', 'A seat and a seatbelt. Cheapest to run; passengers choose you on price alone.'],
  ['Basic', 'Paid snacks and a smile. A modest saving over full service.'],
  ['Full service', 'Meals, drinks and entertainment included. The industry standard.'],
  ['Premium', 'Better food, generous drinks, amenity kits. Noticeably more appealing, noticeably dearer.'],
  ['Luxury', 'Fine dining and lounges. Wins premium travellers; expensive on every seat.'],
];
const ANCILLARY = [
  ['All inclusive', 'Bags, seats and meals are in the fare. Passengers love it.'],
  ['Light fees', 'Charges for extra bags and seat selection. A little income for little annoyance.'],
  ['Unbundled', 'Most extras cost money. Good income on every economy seat; some travellers look elsewhere.'],
  ['Pay for everything', 'Fees for cabin bags, check-in, water. Lucrative, and resented.'],
];
const MAINTENANCE = [
  ['Legal minimum', 'Defer everything deferrable. Cheap, but expect breakdowns, delays and auditors.'],
  ['Lean', 'Trimmed budgets. More technical delays than average.'],
  ['Standard', 'By the book.'],
  ['Thorough', 'Extra inspections and spares on hand. Fewer delays, slower wear.'],
  ['Gold-plated', 'Parts replaced early, spare engines everywhere. The most reliable fleet money can buy.'],
];
const MARKETING_STEPS = [0, 50_000, 100_000, 200_000, 350_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000];

function PolicyRow({ title, value, children, name, detail }: { title: string; value: ReactNode; name: string; detail: string; children: ReactNode }) {
  return (
    <div className="card col gap-6">
      <div className="row between">
        <span className="strong">{title}</span>
        <span className="badge accent">{value}</span>
      </div>
      {children}
      <div className="small"><b className="strong">{name}.</b> <span className="muted">{detail}</span></div>
    </div>
  );
}

export function OperationsPanel() {
  const sim = useSim();
  const p = sim.player;
  const policy = p.policy;
  const set = (patch: Partial<Policy>) => {
    setPolicy(sim, 0, patch);
    game.globe?.invalidate();
    refresh();
  };
  const fixed = dailyFixedCosts(sim, p);
  const marketingIndex = Math.max(0, MARKETING_STEPS.findIndex((v) => v >= policy.marketing));
  const quality = Math.max(0, Math.min(1, airlineQualityBase(p) + 0.15));
  const target = sim.reputationTarget(p);

  return (
    <Panel title="Product and operations" icon={<SlidersHorizontal size={20} />} onClose={() => openPanel(null)}
      subtitle="What passengers get, what staff are paid and how well the fleet is kept">
      <div className="grid-4">
        <Tile label="Reputation" value={p.reputation.toFixed(0)} delta={`${target >= p.reputation ? '+' : '−'}${Math.abs(target - p.reputation).toFixed(0)}`} deltaGood={target >= p.reputation} note={`heading for ${target.toFixed(0)}`} />
        <Tile label="On time" value={p.totalFlights ? percent(p.otp) : '—'} note="within 15 minutes" />
        <Tile label="Staff morale" value={p.morale.toFixed(0)} note={p.morale < 45 ? 'strike risk' : p.morale > 70 ? 'motivated' : 'steady'} />
        <Tile label="Product rating" value={Math.round(quality * 100)} note="as travellers see it" />
      </div>

      <PolicyRow title="In-flight service" value={`Level ${policy.service}`} name={SERVICE[policy.service - 1][0]} detail={SERVICE[policy.service - 1][1]}>
        <Slider label="In-flight service" min={1} max={5} value={policy.service} onChange={(v) => set({ service: v })} />
      </PolicyRow>
      <PolicyRow title="Fees and extras" value={ANCILLARY[policy.ancillary][0]} name={ANCILLARY[policy.ancillary][0]} detail={ANCILLARY[policy.ancillary][1]}>
        <Slider label="Fees and extras" min={0} max={3} value={policy.ancillary} onChange={(v) => set({ ancillary: v })} />
      </PolicyRow>
      <PolicyRow title="Maintenance" value={`Level ${policy.maintenance}`} name={MAINTENANCE[policy.maintenance - 1][0]} detail={MAINTENANCE[policy.maintenance - 1][1]}>
        <Slider label="Maintenance" min={1} max={5} value={policy.maintenance} onChange={(v) => set({ maintenance: v })} />
      </PolicyRow>
      <PolicyRow title="Pay" value={`${Math.round(policy.wages * 100)}% of market`}
        name={policy.wages < 0.95 ? 'Below market' : policy.wages > 1.08 ? 'Above market' : 'Market rate'}
        detail={policy.wages < 0.95 ? 'Cheaper crews and offices, falling morale, and a union that remembers.' : policy.wages > 1.08 ? 'Motivated staff give better service and rarely strike. Every flight costs more.' : 'Fair pay keeps morale steady.'}>
        <Slider label="Pay" min={80} max={130} step={1} value={Math.round(policy.wages * 100)} onChange={(v) => set({ wages: v / 100 })} />
      </PolicyRow>
      <PolicyRow title="Marketing" value={`${money(policy.marketing)} a month`} name="Brand advertising"
        detail="Keeps your name in travellers' minds. The bigger the airline, the more it takes to move the needle.">
        <Slider label="Marketing budget" min={0} max={MARKETING_STEPS.length - 1} value={marketingIndex} onChange={(v) => set({ marketing: MARKETING_STEPS[v] })} />
      </PolicyRow>

      <div className="section-title">Fixed costs each month</div>
      <HBars format={(v) => money(v)} items={[
        { label: 'Aircraft leases', value: fixed.leases * DAYS_PER_MONTH },
        { label: 'Ground staff and offices', value: fixed.staff * DAYS_PER_MONTH },
        { label: 'Depreciation', value: fixed.depreciation * DAYS_PER_MONTH },
        { label: 'Base facilities', value: fixed.hubs * DAYS_PER_MONTH },
        { label: 'Marketing', value: fixed.marketing * DAYS_PER_MONTH },
        { label: 'Overdraft interest', value: fixed.interest * DAYS_PER_MONTH },
      ].filter((i) => i.value > 0).sort((a, b) => b.value - a.value)} />
      <div className="col gap-4">
        <div className="row between small"><span className="muted">Airframe condition, fleet average</span>
          <span className="num">{sim.fleetOf(0).length ? percent(sim.fleetOf(0).reduce((n, a) => n + a.condition, 0) / sim.fleetOf(0).length) : '—'}</span></div>
        <Meter value={sim.fleetOf(0).length ? sim.fleetOf(0).reduce((n, a) => n + a.condition, 0) / sim.fleetOf(0).length : 0} />
      </div>
    </Panel>
  );
}
