// Flight paths: great-circle arcs lifted off the surface.
//
// Altitudes are exaggerated (a real cruise altitude would be invisible at this
// scale) but keep the shape of a real flight: climb, long level cruise, descent.

import * as THREE from 'three';
import { angleBetween } from '../sim/geo';

/** Visual cruise altitude in Earth radii for a flight of the given length. */
export function cruiseAltitude(distKm: number): number {
  return Math.min(0.03, 0.0065 + 0.0215 * (distKm / 9000));
}

/** 0 at both ends, 1 during the cruise. */
export function altitudeProfile(t: number, distKm: number): number {
  // Roughly the first and last 260 km are spent climbing and descending.
  const c = Math.max(0.08, Math.min(0.5, 260 / Math.max(distKm, 1)));
  const up = THREE.MathUtils.smoothstep(t, 0, c);
  const down = 1 - THREE.MathUtils.smoothstep(t, 1 - c, 1);
  return up * down;
}

/**
 * Point on the flight path between two unit vectors at parameter t (0..1).
 * The result is scaled so its length is 1 + altitude.
 */
export function arcPoint(a: ArrayLike<number>, b: ArrayLike<number>, t: number, distKm: number, out: THREE.Vector3): THREE.Vector3 {
  const omega = angleBetween(a, b);
  let x: number, y: number, z: number;
  if (omega < 1e-9) {
    x = a[0]; y = a[1]; z = a[2];
  } else {
    const s = Math.sin(omega);
    const ka = Math.sin((1 - t) * omega) / s;
    const kb = Math.sin(t * omega) / s;
    x = a[0] * ka + b[0] * kb;
    y = a[1] * ka + b[1] * kb;
    z = a[2] * ka + b[2] * kb;
  }
  const r = 1 + cruiseAltitude(distKm) * altitudeProfile(t, distKm);
  return out.set(x * r, y * r, z * r);
}

/** Number of line segments that gives a smooth arc of the given length. */
export function arcSegments(distKm: number): number {
  return Math.max(12, Math.min(72, Math.round(distKm / 180)));
}

/** Flat array of xyz positions along the path, `segments + 1` points. */
export function arcPositions(a: ArrayLike<number>, b: ArrayLike<number>, distKm: number, segments = arcSegments(distKm)): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    arcPoint(a, b, i / segments, distKm, v);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Small circle on the globe: every point at `angle` radians from `centre`. */
export function ringPositions(centre: ArrayLike<number>, angle: number, radius = 1.002, segments = 180): Float32Array {
  const c = new THREE.Vector3(centre[0], centre[1], centre[2]).normalize();
  const ref = Math.abs(c.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(c, ref).normalize();
  const w = new THREE.Vector3().crossVectors(c, u);
  const out = new Float32Array((segments + 1) * 3);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const x = c.x * cosA + (u.x * Math.cos(phi) + w.x * Math.sin(phi)) * sinA;
    const y = c.y * cosA + (u.y * Math.cos(phi) + w.y * Math.sin(phi)) * sinA;
    const z = c.z * cosA + (u.z * Math.cos(phi) + w.z * Math.sin(phi)) * sinA;
    out[i * 3] = x * radius;
    out[i * 3 + 1] = y * radius;
    out[i * 3 + 2] = z * radius;
  }
  return out;
}
