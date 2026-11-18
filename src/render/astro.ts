// Where the sun and the stars are, for a given game time. Accurate to a fraction of
// a degree — plenty for a day/night terminator and the seasons.

import { EPOCH_MS } from '../sim/time';
import { DEG, latLonToVec } from '../sim/geo';
import type { Vec3 } from '../sim/geo';

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** Latitude and longitude of the point on Earth where the sun is directly overhead. */
export function subsolarPoint(time: number): { lat: number; lon: number } {
  const ms = EPOCH_MS + time * 60000;
  const days = (ms - J2000_MS) / 86400000;
  // Low-precision solar coordinates (Astronomical Almanac).
  const meanLon = (280.46 + 0.9856474 * days) % 360;
  const anomaly = ((357.528 + 0.9856003 * days) % 360) * DEG;
  const eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  const lon = (((ra / DEG - gmstDegrees(time) + 540) % 360) + 360) % 360 - 180;
  return { lat: decl / DEG, lon };
}

export function sunDirection(time: number): Vec3 {
  const p = subsolarPoint(time);
  return latLonToVec(p.lat, p.lon);
}

/** Greenwich mean sidereal time in degrees: how far the Earth has turned against the stars. */
export function gmstDegrees(time: number): number {
  const ms = EPOCH_MS + time * 60000;
  const days = (ms - J2000_MS) / 86400000;
  return (((280.46061837 + 360.98564736629 * days) % 360) + 360) % 360;
}
