// Milestones: long-term goals with a little prize money attached.

import { Check, Target } from 'lucide-react';
import { objectiveProgress } from '../../sim/objectives';
import { formatDate } from '../../sim/time';
import { money } from '../app/format';
import { openPanel, useSim } from '../app/store';
import { Meter, Panel } from '../components/ui';

export function ObjectivesPanel() {
  const sim = useSim();
  const list = sim.game.objectives;
  const done = list.filter((o) => o.done);
  const open = list.filter((o) => !o.done).map((o) => ({ o, progress: objectiveProgress(sim, o.id) })).sort((a, b) => b.progress - a.progress);
  const earned = done.reduce((n, o) => n + o.reward, 0);

  return (
    <Panel title="Milestones" icon={<Target size={20} />} onClose={() => openPanel(null)}
      subtitle={`${done.length} of ${list.length} reached · ${money(earned)} in bonuses`}>
      <div className="col gap-6">
        {open.map(({ o, progress }) => (
          <div key={o.id} className="card tight col gap-6">
            <div className="row between">
              <div>
                <span className="strong">{o.title}</span>
                <span className="muted small"> · {o.detail}</span>
              </div>
              <span className="badge gold">{money(o.reward)}</span>
            </div>
            <Meter value={progress} />
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <>
          <div className="section-title">Reached</div>
          <div className="col gap-4">
            {[...done].sort((a, b) => b.doneAt - a.doneAt).map((o) => (
              <div key={o.id} className="list-row">
                <Check size={15} className="good" />
                <div className="grow"><span className="strong">{o.title}</span> <span className="muted small">· {o.detail}</span></div>
                <span className="tiny dim nowrap">{formatDate(o.doneAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
