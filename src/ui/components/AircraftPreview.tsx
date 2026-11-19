// A live 3D view of an aircraft in the airline's livery.
// (Placeholder until the 3D viewer is wired in.)

import { AIRCRAFT_TYPE, typeName } from '../../sim/data/aircraft';
import type { Livery } from '../../sim/types';
import { Logo } from './ui';

export function AircraftPreview({ typeId, livery, height = 220 }: {
  typeId: string;
  livery: Livery;
  airlineName?: string;
  registration?: string;
  height?: number;
}) {
  const type = AIRCRAFT_TYPE[typeId];
  return (
    <div className="viewer" style={{ height, display: 'grid', placeItems: 'center' }}>
      <div className="col center" style={{ alignItems: 'center', gap: 8 }}>
        <Logo livery={livery} size={54} />
        <div className="muted small">{typeName(type)}</div>
      </div>
    </div>
  );
}
