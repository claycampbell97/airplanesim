// A live 3D view of an aircraft in the airline's livery, on a turntable.

import { useEffect, useRef, useState } from 'react';
import { AircraftViewer } from '../../render/aircraft/viewer';
import { AIRCRAFT_TYPE, typeName } from '../../sim/data/aircraft';
import type { Livery } from '../../sim/types';
import { Logo } from './ui';

export function AircraftPreview({ typeId, livery, airlineName, registration, height = 220 }: {
  typeId: string;
  livery: Livery;
  airlineName?: string;
  registration?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<AircraftViewer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let viewer: AircraftViewer;
    try {
      viewer = new AircraftViewer(canvas);
    } catch {
      // No spare WebGL context: fall back to the badge.
      setFailed(true);
      return;
    }
    viewerRef.current = viewer;
    viewer.start();
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Rebuild the model when the aircraft or its paint changes. Typing a name
  // would otherwise rebuild on every keystroke, so wait for a short pause.
  const { primary, secondary, base, style, emblem } = livery;
  useEffect(() => {
    const timer = setTimeout(() => {
      viewerRef.current?.setAircraft(AIRCRAFT_TYPE[typeId], { primary, secondary, base, style, emblem }, {
        gear: true, registration, airlineName, detail: 'high',
      });
    }, viewerRef.current ? 180 : 0);
    return () => clearTimeout(timer);
  }, [typeId, primary, secondary, base, style, emblem, airlineName, registration, failed]);

  if (failed) {
    return (
      <div className="viewer" style={{ height, display: 'grid', placeItems: 'center' }}>
        <div className="col center" style={{ alignItems: 'center', gap: 8 }}>
          <Logo livery={livery} size={54} />
          <div className="muted small">{typeName(AIRCRAFT_TYPE[typeId])}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="viewer" style={{ height }}>
      <canvas ref={canvasRef} aria-label={`3D model of the ${typeName(AIRCRAFT_TYPE[typeId])}`} style={{ touchAction: 'none', cursor: 'grab' }} />
    </div>
  );
}
