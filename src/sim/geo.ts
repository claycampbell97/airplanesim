// Spherical geometry helpers. The globe uses a right-handed frame with +Y through the
// north pole and +X through (lat 0, lon 0), matching three.js' SphereGeometry UVs
// for an equirectangular texture.

export const EARTH_RADIUS_KM = 6371;
export const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export function latLonToVec(lat: number, lon: number): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), Math.sin(la), -c * Math.sin(lo)];
}

export function vecToLatLon(v: ArrayLike<number>): { lat: number; lon: number } {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, v[1] / len))) / DEG,
    lon: Math.atan2(-v[2], v[0]) / DEG,
  };
}

/** Central angle between two unit vectors, radians. */
export function angleBetween(a: ArrayLike<number>, b: ArrayLike<number>): number {
  // atan2 form stays accurate for both tiny and near-antipodal angles.
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.atan2(Math.hypot(cx, cy, cz), dot);
}

export function distanceKm(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return angleBetween(a, b) * EARTH_RADIUS_KM;
}

/** Great-circle interpolation between unit vectors. `out` receives a unit vector. */
export function slerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Vec3 | Float32Array | number[] = [0, 0, 0]): typeof out {
  const omega = angleBetween(a, b);
  if (omega < 1e-9) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return out;
  }
  const s = Math.sin(omega);
  const ka = Math.sin((1 - t) * omega) / s;
  const kb = Math.sin(t * omega) / s;
  out[0] = a[0] * ka + b[0] * kb;
  out[1] = a[1] * ka + b[1] * kb;
  out[2] = a[2] * ka + b[2] * kb;
  return out;
}

/** Initial compass bearing from a to b, degrees clockwise from north. */
export function bearing(latA: number, lonA: number, latB: number, lonB: number): number {
  const p1 = latA * DEG, p2 = latB * DEG, dl = (lonB - lonA) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}
