// Money: ledgers, fixed costs, loans, valuation and credit.

import { AIRCRAFT_TYPE } from './data/aircraft';
import { AIRPORT } from './data/airports';
import { monthIndex } from './time';
import { COST_KEYS, REVENUE_KEYS } from './types';
import type { Aircraft, Airline, Airport, CostKey, Ledger, Loan, MonthRecord, RevenueKey } from './types';
import type { Sim } from './sim';

export const DAYS_PER_MONTH = 30.44;

export function emptyLedger(): Ledger {
  const rev = {} as Record<RevenueKey, number>;
  const cost = {} as Record<CostKey, number>;
  for (const k of REVENUE_KEYS) rev[k] = 0;
  for (const k of COST_KEYS) cost[k] = 0;
  return { rev, cost, pax: 0, flights: 0, ask: 0, rpk: 0, delayed: 0, cancelled: 0 };
}

export function ledgerRevenue(l: Ledger): number {
  let t = 0;
  for (const k of REVENUE_KEYS) t += l.rev[k];
  return t;
}

export function ledgerCost(l: Ledger): number {
  let t = 0;
  for (const k of COST_KEYS) t += l.cost[k];
  return t;
}

export function ledgerProfit(l: Ledger): number {
  return ledgerRevenue(l) - ledgerCost(l);
}

/** Books revenue and receives the cash. */
export function earn(al: Airline, key: RevenueKey, amount: number): void {
  if (!amount) return;
  al.today.rev[key] += amount;
  al.month.rev[key] += amount;
  al.cash += amount;
}

/** Books a cost and pays it (depreciation is booked but costs no cash). */
export function spend(al: Airline, key: CostKey, amount: number): void {
  if (!amount) return;
  al.today.cost[key] += amount;
  al.month.cost[key] += amount;
  if (key !== 'depreciation') al.cash -= amount;
}

// ───────────────────────── Cost levels ─────────────────────────

/** Local price level of an airport: landing, handling and terminal fees scale with it. */
export function feeFactor(ap: Airport): number {
  return (0.55 + 0.21 * ap.tier) * (ap.slotLimited ? 1.3 : 1) * Math.pow(ap.wealth, 0.6);
}

/** Wage level of an airline: pay policy × cost of living at its headquarters. */
export function labourFactor(sim: Sim, al: Airline): number {
  return al.policy.wages * Math.pow(AIRPORT[al.hq].wealth, 0.6) * sim.tuning.cost;
}

/** Discount on airport charges at an airline's own hubs. */
export function hubDiscount(al: Airline, airport: string): number {
  for (const h of al.hubs) if (h.airport === airport) return h.level === 3 ? 0.7 : h.level === 2 ? 0.8 : 0.9;
  return 1;
}

export const HUB_LEVEL_NAMES = ['', 'Base', 'Hub', 'Mega hub'];

/** One-off cost to open a base (level 1) or upgrade it to the given level. */
export function hubSetupCost(ap: Airport, level: 1 | 2 | 3): number {
  const perTier = level === 1 ? 1_500_000 : level === 2 ? 5_000_000 : 14_000_000;
  return perTier * ap.tier * Math.pow(ap.wealth, 0.6);
}

export function hubMonthlyFee(ap: Airport, level: 1 | 2 | 3): number {
  const perTier = level === 1 ? 30_000 : level === 2 ? 110_000 : 280_000;
  return perTier * ap.tier * Math.pow(ap.wealth, 0.6);
}

/** Effective fuel price for an airline once its hedges are taken into account. */
export function fuelPriceFor(sim: Sim, al: Airline): number {
  const spot = sim.game.world.fuelPrice;
  let covered = 0;
  let cost = 0;
  for (const h of al.hedges) {
    if (sim.game.time >= h.until) continue;
    const share = Math.min(h.share, 1 - covered);
    covered += share;
    cost += share * h.price;
  }
  const blended = cost + (1 - covered) * spot;
  // The player's sustainable-fuel commitment carries a premium.
  return al.isPlayer && sim.game.time < (sim.game.flags.safUntil ?? 0) ? blended * 1.04 : blended;
}

export function hedgedShare(sim: Sim, al: Airline): number {
  let covered = 0;
  for (const h of al.hedges) if (sim.game.time < h.until) covered += h.share;
  return Math.min(1, covered);
}

// ───────────────────────── Aircraft values ─────────────────────────

const USEFUL_LIFE_YEARS = 25;
const RESIDUAL = 0.08;

/** Market value of an aircraft of the given age as a fraction of its new price. */
export function ageValueFactor(ageYears: number): number {
  // Steeper early depreciation, flattening towards the residual.
  const t = Math.min(1, ageYears / USEFUL_LIFE_YEARS);
  return RESIDUAL + (1 - RESIDUAL) * Math.pow(1 - t, 1.6);
}

export function marketValue(typeId: string, ageYears: number, condition: number): number {
  const t = AIRCRAFT_TYPE[typeId];
  // Out-of-production types have no "new" price: the catalogue price is for a mid-life example.
  const newPrice = t.inProduction ? t.price : t.price / ageValueFactor((t.usedAge[0] + t.usedAge[1]) / 2);
  return newPrice * ageValueFactor(ageYears) * (0.75 + 0.25 * condition);
}

export function marketLease(typeId: string, ageYears: number): number {
  const t = AIRCRAFT_TYPE[typeId];
  const newLease = t.inProduction ? t.lease : t.lease / (0.35 + 0.65 * ageValueFactor((t.usedAge[0] + t.usedAge[1]) / 2));
  return newLease * (0.35 + 0.65 * ageValueFactor(ageYears));
}

/** Daily cost of having an aircraft, used to attribute ownership to routes. */
export function ownershipPerDay(ac: Aircraft): number {
  if (!ac.owned) return ac.leaseRate / DAYS_PER_MONTH;
  // Depreciation plus the cost of the capital tied up.
  return (ac.cost * (1 - RESIDUAL)) / (USEFUL_LIFE_YEARS * 365) + (ac.book * 0.05) / 365;
}

export function dailyDepreciation(ac: Aircraft): number {
  if (!ac.owned) return 0;
  return Math.min(ac.book, (ac.cost * (1 - RESIDUAL)) / (USEFUL_LIFE_YEARS * 365));
}

// ───────────────────────── Balance sheet ─────────────────────────

export function fleetValue(sim: Sim, al: Airline): number {
  let v = 0;
  for (const ac of sim.fleetOf(al.id)) if (ac.owned) v += ac.book;
  return v;
}

export function totalDebt(al: Airline): number {
  let d = 0;
  for (const l of al.loans) d += l.balance;
  return d;
}

export function hubAssets(al: Airline): number {
  let v = 0;
  for (const h of al.hubs) {
    const ap = AIRPORT[h.airport];
    for (let lv = 1; lv <= h.level; lv++) v += hubSetupCost(ap, lv as 1 | 2 | 3) * 0.5;
  }
  return v;
}

export function equity(sim: Sim, al: Airline): number {
  return al.cash + fleetValue(sim, al) + hubAssets(al) - totalDebt(al);
}

/** Profit over the trailing `months` completed months plus the current one, annualised. */
export function annualisedProfit(al: Airline, months = 12): number {
  const recent = al.history.slice(-months);
  if (recent.length === 0) return 0;
  let p = 0;
  for (const r of recent) p += ledgerProfit(r);
  return (p / recent.length) * 12;
}

export function annualisedRevenue(al: Airline, months = 12): number {
  const recent = al.history.slice(-months);
  if (recent.length === 0) return ledgerRevenue(al.month) * 12;
  let p = 0;
  for (const r of recent) p += ledgerRevenue(r);
  return (p / recent.length) * 12;
}

/** What the airline would fetch if sold: assets plus a multiple of earnings and brand. */
export function valuation(sim: Sim, al: Airline): number {
  const earnings = Math.max(0, annualisedProfit(al));
  const brand = annualisedRevenue(al) * 0.25 * (al.reputation / 100);
  return Math.max(0, equity(sim, al) + earnings * 6 + brand);
}

export const CREDIT_RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'] as const;

/** 0 (best) .. 6 (worst). */
export function creditScore(sim: Sim, al: Airline): number {
  const eq = equity(sim, al);
  const debt = totalDebt(al);
  const assets = Math.max(1, eq + debt);
  const leverage = debt / assets;
  const profit = annualisedProfit(al, 6);
  const revenue = Math.max(1, annualisedRevenue(al, 6));
  const margin = al.history.length ? profit / revenue : 0;
  let score = 2.5 + leverage * 4 - margin * 8 - Math.min(1.5, Math.log10(Math.max(1, assets / 50e6)));
  if (al.cash < 0) score += 1.5;
  return Math.max(0, Math.min(6, Math.round(score)));
}

export function loanRate(sim: Sim, al: Airline): number {
  return 0.045 + creditScore(sim, al) * 0.0125 + sim.tuning.interest;
}

/** Most the banks will lend in total. */
export function creditLimit(sim: Sim, al: Airline): number {
  const collateral = fleetValue(sim, al) * 0.6 + hubAssets(al) * 0.4;
  const earnings = Math.max(0, annualisedProfit(al, 6)) * 2.5;
  return Math.max(25_000_000, collateral + earnings + sim.tuning.startCash * 0.25);
}

/**
 * Lessors only extend so much: the total monthly lease bill an airline may
 * commit to grows with its equity and its revenue.
 */
export function leaseCapacity(sim: Sim, al: Airline): number {
  return Math.max(1_500_000, Math.max(0, equity(sim, al)) * 0.012 + (annualisedRevenue(al, 3) / 12) * 0.12);
}

export function leaseCommitment(sim: Sim, al: Airline): number {
  let total = 0;
  for (const ac of sim.fleetOf(al.id)) if (!ac.owned) total += ac.leaseRate;
  return total;
}

export function availableCredit(sim: Sim, al: Airline): number {
  return Math.max(0, creditLimit(sim, al) - totalDebt(al));
}

/** How far below zero cash may go before the airline counts as insolvent. */
export function overdraftLimit(sim: Sim, al: Airline): number {
  return Math.max(8_000_000, (fleetValue(sim, al) + hubAssets(al)) * 0.1);
}

export function annuity(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function takeLoan(sim: Sim, al: Airline, amount: number, months: number): Loan | null {
  if (amount <= 0 || amount > availableCredit(sim, al) + 1) return null;
  const rate = loanRate(sim, al);
  const loan: Loan = {
    id: sim.game.nextId++,
    principal: amount,
    balance: amount,
    rate,
    payment: annuity(amount, rate, months),
    monthsLeft: months,
    taken: sim.game.time,
  };
  al.loans.push(loan);
  al.cash += amount;
  return loan;
}

export function repayLoan(al: Airline, loanId: number, amount?: number): boolean {
  const loan = al.loans.find((l) => l.id === loanId);
  if (!loan) return false;
  const pay = Math.min(loan.balance, amount ?? loan.balance, Math.max(0, al.cash));
  if (pay <= 0) return false;
  loan.balance -= pay;
  al.cash -= pay;
  if (loan.balance < 1) al.loans.splice(al.loans.indexOf(loan), 1);
  else loan.payment = annuity(loan.balance, loan.rate, Math.max(1, loan.monthsLeft));
  return true;
}

/** Monthly instalments: interest is a cost, the rest reduces the balance. */
export function serviceLoans(al: Airline): void {
  for (const loan of [...al.loans]) {
    const interest = (loan.balance * loan.rate) / 12;
    const principal = Math.min(loan.balance, loan.payment - interest);
    spend(al, 'interest', interest);
    al.cash -= principal;
    loan.balance -= principal;
    loan.monthsLeft -= 1;
    if (loan.balance < 1 || loan.monthsLeft <= 0) {
      al.cash -= Math.max(0, loan.balance);
      al.loans.splice(al.loans.indexOf(loan), 1);
    }
  }
}

// ───────────────────────── Fixed costs ─────────────────────────

/** Airports an airline has to staff. */
export function stationsOf(sim: Sim, al: Airline): Set<string> {
  const s = new Set<string>();
  for (const h of al.hubs) s.add(h.airport);
  for (const r of sim.routesOf(al.id)) { s.add(r.a); s.add(r.b); }
  return s;
}

export interface FixedCosts {
  leases: number;
  depreciation: number;
  staff: number;
  marketing: number;
  hubs: number;
  /** Overdraft interest. */
  interest: number;
}

/** Costs that accrue every day regardless of flying. */
export function dailyFixedCosts(sim: Sim, al: Airline): FixedCosts {
  const fleet = sim.fleetOf(al.id);
  let leases = 0;
  let depreciation = 0;
  for (const ac of fleet) {
    if (ac.phase === 'delivery') continue;
    if (ac.owned) depreciation += dailyDepreciation(ac);
    else leases += ac.leaseRate / DAYS_PER_MONTH;
  }

  const labour = labourFactor(sim, al);
  let stationCost = 0;
  for (const id of stationsOf(sim, al)) stationCost += 18_000 * feeFactor(AIRPORT[id]);
  const active = fleet.filter((a) => a.phase !== 'delivery').length;
  const admin = 220_000 + 32_000 * active + (annualisedRevenue(al, 3) * 0.025) / 12;
  const staff = ((stationCost + admin) * labour) / DAYS_PER_MONTH;

  let hubs = 0;
  for (const h of al.hubs) {
    // The home base comes with the airline: its level-1 fee is waived.
    const ap = AIRPORT[h.airport];
    hubs += hubMonthlyFee(ap, h.level) - (h.airport === al.hq ? hubMonthlyFee(ap, 1) : 0);
  }

  const interest = al.cash < 0 ? (-al.cash * 0.16) / 365 : 0;
  return {
    leases,
    depreciation,
    staff,
    marketing: al.policy.marketing / DAYS_PER_MONTH,
    hubs: (hubs * sim.tuning.cost) / DAYS_PER_MONTH,
    interest,
  };
}

export function chargeFixedCosts(sim: Sim, al: Airline): void {
  const f = dailyFixedCosts(sim, al);
  spend(al, 'leases', f.leases);
  spend(al, 'depreciation', f.depreciation);
  spend(al, 'staff', f.staff);
  spend(al, 'marketing', f.marketing);
  spend(al, 'hubs', f.hubs);
  spend(al, 'interest', f.interest);
  for (const ac of sim.fleetOf(al.id)) {
    if (ac.owned && ac.phase !== 'delivery') ac.book = Math.max(0, ac.book - dailyDepreciation(ac));
  }
}

export function closeMonth(sim: Sim, al: Airline): MonthRecord {
  const rec: MonthRecord = {
    ...al.month,
    rev: { ...al.month.rev },
    cost: { ...al.month.cost },
    month: monthIndex(sim.game.time) - 1,
    cashEnd: al.cash,
    fleet: sim.fleetOf(al.id).length,
    routes: sim.routesOf(al.id).length,
    reputation: al.reputation,
    valuation: 0,
  };
  al.history.push(rec);
  rec.valuation = valuation(sim, al);
  // Rivals only need recent history; the player's full record feeds the charts.
  const keep = al.isPlayer ? 240 : 36;
  if (al.history.length > keep) al.history.splice(0, al.history.length - keep);
  al.month = emptyLedger();
  return rec;
}
