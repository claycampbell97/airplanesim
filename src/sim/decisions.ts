// Dilemmas put to the player: union demands, supplier offers, audits, rescues.

import { AIRCRAFT_TYPES, typeName } from './data/aircraft';
import { setPolicy } from './actions';
import { equity, ledgerCost, overdraftLimit, spend } from './finance';
import { chance, pick, randRange } from './rng';
import { addNews } from './world';
import type { Decision } from './types';
import type { Sim } from './sim';

function push(sim: Sim, d: Omit<Decision, 'id' | 'expires'> & { days?: number }): void {
  const g = sim.game;
  if (g.decisions.some((x) => x.type === d.type)) return;
  const decision: Decision = { id: g.nextId++, expires: g.time + (d.days ?? 20) * 1440, type: d.type, title: d.title, body: d.body, options: d.options, data: d.data };
  g.decisions.push(decision);
  sim.emit('decision', decision);
}

const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

/** Called once a month: maybe put a new decision in front of the player. */
export function spawnDecisions(sim: Sim): void {
  const g = sim.game;
  const p = sim.player;
  const fleet = sim.fleetOf(0).length;

  // Unanswered decisions lapse; the default is always the cautious option.
  for (const d of [...g.decisions]) {
    if (g.time >= d.expires) resolveDecision(sim, d.id, d.options.length - 1, true);
  }
  if (fleet === 0) return;

  const last = p.history[p.history.length - 1];
  const crewMonthly = last ? last.cost.crew + last.cost.staff : 0;

  if (crewMonthly > 0 && chance(g, p.morale < 48 ? 0.5 : 0.04)) {
    const bonus = crewMonthly * 0.6;
    push(sim, {
      type: 'union',
      title: 'The pilots’ union wants a pay rise',
      body: `Crew morale stands at ${Math.round(p.morale)}. Union representatives are asking for 5% across the board and hint at industrial action if they are ignored.`,
      options: [
        { label: 'Agree to 5%', detail: 'Wage level rises permanently. Morale improves sharply.' },
        { label: `Offer a one-off bonus (${money(bonus)})`, detail: 'Costs cash now, keeps the pay scale. Morale improves.' },
        { label: 'Refuse', detail: 'Saves money. Morale drops and a strike is possible.' },
      ],
      data: { bonus },
    });
    return;
  }

  if (p.policy.maintenance <= 2 && fleet >= 3 && chance(g, 0.22)) {
    const fine = Math.max(400_000, (last?.cost.maintenance ?? 0) * 0.5);
    push(sim, {
      type: 'audit',
      title: 'Safety regulator finds shortcomings',
      body: 'An unannounced audit has flagged deferred maintenance across your fleet. The regulator proposes a fine and a mandatory improvement plan.',
      options: [
        { label: `Pay the fine (${money(fine)}) and fix it`, detail: 'Maintenance budget is raised to the standard level.' },
        { label: 'Contest the findings', detail: 'A coin toss: walk away clean, or pay double with a public reprimand.' },
      ],
      data: { fine },
    });
    return;
  }

  if (!g.flags.rescued && p.cash < 0 && p.cash < -overdraftLimit(sim, p) * 0.6) {
    const amount = Math.max(40_000_000, overdraftLimit(sim, p) * 3);
    push(sim, {
      type: 'rescue',
      title: 'An investor offers a lifeline',
      body: `A private equity fund will inject ${money(amount)} in exchange for a seat on the board. They will insist on belt-tightening: this offer will not be repeated.`,
      options: [
        { label: `Accept ${money(amount)}`, detail: 'Cash arrives immediately. Reputation takes a knock.' },
        { label: 'Decline', detail: 'Keep full control and find another way.' },
      ],
      data: { amount },
      days: 30,
    });
    return;
  }

  if (chance(g, 0.1)) {
    const type = pick(g, AIRCRAFT_TYPES.filter((t) => t.inProduction));
    push(sim, {
      type: 'discount',
      title: `${type.maker} offers a deal on the ${type.model}`,
      body: `To win you as a customer, ${type.maker} will take 12% off any ${typeName(type)} you order or lease new in the next 45 days.`,
      options: [{ label: 'Good to know', detail: 'The discount is applied automatically in the aircraft market.' }],
      data: { aircraft: type.id },
      days: 2,
    });
    return;
  }

  if (fleet >= 4 && chance(g, 0.05)) {
    const fee = Math.max(1_500_000, (last ? ledgerCost(last) : 0) * 0.04);
    push(sim, {
      type: 'endorsement',
      title: 'A film star wants to front your brand',
      body: 'Their agent proposes a year-long campaign: safety video, magazine covers, the works.',
      options: [
        { label: `Sign the deal (${money(fee)})`, detail: 'A lasting boost to reputation.' },
        { label: 'Pass', detail: 'Let the flying speak for itself.' },
      ],
      data: { fee },
    });
    return;
  }

  if (fleet >= 4 && !g.flags.safUntil && chance(g, 0.04)) {
    push(sim, {
      type: 'saf',
      title: 'Commit to sustainable aviation fuel?',
      body: 'A supplier offers a blend of sustainable fuel for a year. It costs more, but travellers and corporate accounts notice.',
      options: [
        { label: 'Commit for a year', detail: 'Fuel costs 4% more. Reputation improves.' },
        { label: 'Not now', detail: 'No change.' },
      ],
      data: {},
    });
  }
}

export function resolveDecision(sim: Sim, id: number, option: number, lapsed = false): void {
  const g = sim.game;
  const d = g.decisions.find((x) => x.id === id);
  if (!d) return;
  g.decisions.splice(g.decisions.indexOf(d), 1);
  const p = sim.player;

  switch (d.type) {
    case 'union':
      if (option === 0) {
        setPolicy(sim, 0, { wages: p.policy.wages + 0.05 });
        p.morale = Math.min(100, p.morale + 14);
        addNews(sim, 'info', 'Pay deal agreed', 'Crews welcome the 5% rise.');
      } else if (option === 1) {
        spend(p, 'crew', Number(d.data.bonus));
        p.morale = Math.min(100, p.morale + 8);
        addNews(sim, 'info', 'Bonus accepted', 'The union recommends the one-off payment to its members.');
      } else {
        p.morale = Math.max(0, p.morale - 14);
        if (chance(g, 0.45)) {
          g.flags.strikeUntil = g.time + 3 * 1440;
          p.reputation = Math.max(0, p.reputation - 3);
          addNews(sim, 'bad', 'Your pilots walk out', 'A three-day strike has grounded the airline. No flights will depart until it ends.');
        } else {
          addNews(sim, 'info', lapsed ? 'The union’s deadline passes' : 'The union backs down', 'There will be no strike this time, but the mood in the crew room is sour.');
        }
      }
      break;
    case 'audit':
      if (option === 0) {
        spend(p, 'misc', Number(d.data.fine));
        setPolicy(sim, 0, { maintenance: Math.max(3, p.policy.maintenance) });
        addNews(sim, 'info', 'Fine paid', 'Your maintenance programme has been brought up to standard.');
      } else if (chance(g, 0.5)) {
        addNews(sim, 'good', 'Regulator withdraws its findings', 'Your lawyers earned their fee.');
      } else {
        spend(p, 'misc', Number(d.data.fine) * 2);
        p.reputation = Math.max(0, p.reputation - 6);
        addNews(sim, 'bad', 'Regulator doubles the fine', 'The appeal failed and the reprimand was published.');
      }
      break;
    case 'rescue':
      if (option === 0) {
        p.cash += Number(d.data.amount);
        p.reputation = Math.max(0, p.reputation - 5);
        g.flags.rescued = 1;
        addNews(sim, 'info', 'Rescue funding secured', `The fund now holds a stake in ${p.name}. Equity stands at ${money(Math.max(0, equity(sim, p)))}.`);
      }
      break;
    case 'discount':
      g.flags[`discount:${d.data.aircraft}`] = g.time + 45 * 1440;
      break;
    case 'endorsement':
      if (option === 0 && !lapsed) {
        spend(p, 'marketing', Number(d.data.fee));
        p.reputation = Math.min(100, p.reputation + randRange(g, 4, 7));
        addNews(sim, 'good', 'Campaign launched', 'Your new brand ambassador is everywhere.');
      }
      break;
    case 'saf':
      if (option === 0 && !lapsed) {
        g.flags.safUntil = g.time + 365 * 1440;
        p.reputation = Math.min(100, p.reputation + 4);
        addNews(sim, 'good', 'Sustainable fuel programme begins', 'Corporate travel buyers have taken note.');
      }
      break;
  }
}
