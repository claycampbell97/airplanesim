// Geometry building blocks for the procedural aircraft: lofted surfaces (fuselage,
// wings, tail), bodies of revolution (nacelles, wheels) and a few small helpers.
//
// Conventions: metres, nose towards +Z, +Y up, +X is the aircraft's port (left) side.

import * as THREE from 'three';
import type { FuselageProfile } from './profile';

/** Regular grid of vertices (rows × cols) joined into triangles. */
export function gridGeometry(rows: number, cols: number, positions: Float32Array, uvs: Float32Array, flip: boolean): THREE.BufferGeometry {
  const index: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      if (flip) index.push(a, d, c, a, c, b);
      else index.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Makes two rows of a grid share normals (hides the seam where a surface closes on itself). */
function weldRows(geo: THREE.BufferGeometry, cols: number, rows: number, colA: number, colB: number): void {
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const a = i * cols + colA;
    const b = i * cols + colB;
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
}

// ───────────────────────── Fuselage ─────────────────────────

/** Stations (0 nose .. 1 tail) with rings packed where the body curves. */
export function fuselageStations(p: FuselageProfile, nose: number, barrel: number, tail: number): number[] {
  const s: number[] = [];
  const sn = p.noseLen / p.length;
  const st = 1 - p.tailLen / p.length;
  for (let i = 0; i <= nose; i++) s.push(sn * Math.pow(i / nose, 1.7));
  for (let i = 1; i < barrel; i++) s.push(sn + ((st - sn) * i) / barrel);
  for (let i = 0; i <= tail; i++) s.push(st + (1 - st) * Math.pow(i / tail, 0.85));
  return s;
}

/**
 * The fuselage skin. Texture u runs nose → tail; v runs keel → port side → crown →
 * starboard side → keel, matching livery.paintFuselage.
 */
export function fuselageGeometry(p: FuselageProfile, stations: number[], segments: number): THREE.BufferGeometry {
  const rows = stations.length;
  const cols = segments + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  for (let i = 0; i < rows; i++) {
    const s = stations[i];
    const sec = p.section(s);
    const z = p.length / 2 - s * p.length;
    for (let j = 0; j < cols; j++) {
      const alpha = -Math.PI / 2 + (2 * Math.PI * j) / segments;
      const sin = Math.sin(alpha);
      const k = (i * cols + j) * 3;
      pos[k] = sec.hw * Math.cos(alpha);
      pos[k + 1] = sin >= 0 ? sec.yMid + (sec.yTop - sec.yMid) * sin : sec.yMid + (sec.yMid - sec.yBot) * sin;
      pos[k + 2] = z;
      uv[(i * cols + j) * 2] = s;
      uv[(i * cols + j) * 2 + 1] = j / segments;
    }
  }
  const geo = gridGeometry(rows, cols, pos, uv, true);
  weldRows(geo, cols, rows, 0, segments);
  return geo;
}

// ───────────────────────── Aerofoil surfaces ─────────────────────────

export interface Station {
  /** Position of the leading edge (before mirroring): spanwise x, height y, and z. */
  x: number;
  y: number;
  zLE: number;
  chord: number;
  /** Angle of the surface from horizontal, radians (0 = flat wing, π/2 = vertical fin). */
  cant: number;
  /** Thickness to chord ratio. */
  thick: number;
  /** Incidence, radians (negative = leading edge down). */
  twist: number;
  /** Texture u. */
  u: number;
}

function thicknessAt(xi: number): number {
  return 5 * (0.2969 * Math.sqrt(xi) - 0.126 * xi - 0.3516 * xi * xi + 0.2843 * xi * xi * xi - 0.1036 * xi * xi * xi * xi);
}

function camberAt(xi: number, m: number): number {
  const pc = 0.4;
  return xi < pc ? (m / (pc * pc)) * (2 * pc * xi - xi * xi) : (m / ((1 - pc) * (1 - pc))) * (1 - 2 * pc + 2 * pc * xi - xi * xi);
}

/**
 * Lofts aerofoil sections through a list of stations. `n` is the number of points
 * per surface; `mirror` builds the starboard twin; `cap` closes the last station.
 */
export function loftGeometry(stations: Station[], n: number, camber: number, mirror: boolean, cap: boolean): THREE.BufferGeometry {
  const rows = stations.length;
  const cols = 2 * n + 1;
  const extra = cap ? 1 : 0;
  const pos = new Float32Array((rows * cols + extra) * 3);
  const uv = new Float32Array((rows * cols + extra) * 2);
  const sx = mirror ? -1 : 1;
  for (let i = 0; i < rows; i++) {
    const st = stations[i];
    const nx = -Math.sin(st.cant);
    const ny = Math.cos(st.cant);
    for (let k = 0; k < cols; k++) {
      const upper = k <= n;
      const t = upper ? (n - k) / n : (k - n) / n;
      const xi = 0.5 * (1 - Math.cos(Math.PI * t));
      const yt = thicknessAt(xi) * st.thick;
      const dn = (camberAt(xi, camber) + (upper ? yt : -yt) + (0.25 - xi) * Math.sin(st.twist)) * st.chord;
      const o = (i * cols + k) * 3;
      pos[o] = sx * (st.x + nx * dn);
      pos[o + 1] = st.y + ny * dn;
      pos[o + 2] = st.zLE - xi * st.chord;
      uv[(i * cols + k) * 2] = st.u;
      uv[(i * cols + k) * 2 + 1] = upper ? 0.5 * (1 - xi) : 0.5 + 0.5 * xi;
    }
  }
  const geo = gridGeometry(rows, cols, pos, uv, mirror);
  if (cap) {
    // Fan across the open end.
    const last = (rows - 1) * cols;
    const c = rows * cols;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < cols; k++) {
      cx += pos[(last + k) * 3]; cy += pos[(last + k) * 3 + 1]; cz += pos[(last + k) * 3 + 2];
    }
    pos[c * 3] = cx / cols; pos[c * 3 + 1] = cy / cols; pos[c * 3 + 2] = cz / cols;
    uv[c * 2] = stations[rows - 1].u; uv[c * 2 + 1] = 0.25;
    const index = Array.from(geo.index!.array as ArrayLike<number>);
    for (let k = 0; k < cols - 1; k++) {
      if (mirror) index.push(c, last + k + 1, last + k);
      else index.push(c, last + k, last + k + 1);
    }
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  return geo;
}

/** Copies the averaged normals of the last row of `a` and the first row of `b` to both (same station). */
export function weldLofts(a: THREE.BufferGeometry, rowsA: number, b: THREE.BufferGeometry, cols: number): void {
  const na = a.attributes.normal as THREE.BufferAttribute;
  const nb = b.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let k = 0; k < cols; k++) {
    const ia = (rowsA - 1) * cols + k;
    v.set(na.getX(ia) + nb.getX(k), na.getY(ia) + nb.getY(k), na.getZ(ia) + nb.getZ(k)).normalize();
    na.setXYZ(ia, v.x, v.y, v.z);
    nb.setXYZ(k, v.x, v.y, v.z);
  }
}

// ───────────────────────── Bodies of revolution ─────────────────────────

/**
 * Surface of revolution about the +Z axis. `profile` is a list of [radius, z];
 * list it with z increasing for an outward-facing surface, decreasing for an
 * inward-facing one (ducts, intakes).
 */
export function revolve(profile: [number, number][], segments: number): THREE.BufferGeometry {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** Flat ring (annulus) in the XY plane facing -Z (aft) or +Z. */
export function ring(inner: number, outer: number, segments: number, facingAft: boolean): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(inner, outer, segments);
  if (facingAft) geo.rotateY(Math.PI);
  return geo;
}

/** Cylinder between two points. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, radius: number, segments = 10, radiusB = radius): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(radiusB, radius, len, segments, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  geo.applyQuaternion(q);
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

/** Tyre with rounded shoulders, axle along X, centred on the origin. */
export function tyreGeometry(radius: number, width: number, segments: number): THREE.BufferGeometry {
  const w = width / 2;
  const pts: [number, number][] = [
    [radius * 0.52, -w], [radius * 0.86, -w], [radius * 0.97, -w * 0.72], [radius, -w * 0.3],
    [radius, w * 0.3], [radius * 0.97, w * 0.72], [radius * 0.86, w], [radius * 0.52, w],
  ];
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/** Wheel hub: a shallow dished disc on both faces, axle along X. */
export function hubGeometry(radius: number, width: number, segments: number): THREE.BufferGeometry {
  const w = width / 2;
  const pts: [number, number][] = [[0.001, -w * 0.55], [radius * 0.3, -w * 0.6], [radius * 0.54, -w * 0.92], [radius * 0.54, w * 0.92], [radius * 0.3, w * 0.6], [0.001, w * 0.55]];
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/** Thin plate: a polygon given as [y, z] points, extruded ±half along X about `x`. Flat shaded. */
export function plate(points: [number, number][], x: number, half: number, halfBack = half): THREE.BufferGeometry {
  const n = points.length;
  const pos: number[] = [];
  // Thickness may taper from the first points (front) to the last (back): interpolate by z.
  let zMax = -Infinity, zMin = Infinity;
  for (const [, z] of points) { zMax = Math.max(zMax, z); zMin = Math.min(zMin, z); }
  const halfAt = (z: number) => half + (halfBack - half) * ((zMax - z) / Math.max(1e-6, zMax - zMin));
  const L = points.map(([y, z]) => [x + halfAt(z), y, z]);
  const Rr = points.map(([y, z]) => [x - halfAt(z), y, z]);
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let i = 1; i < n - 1; i++) {
    tri(L[0], L[i], L[i + 1]);
    tri(Rr[0], Rr[i + 1], Rr[i]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(L[i], Rr[i], Rr[j]);
    tri(L[i], Rr[j], L[j]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.computeVertexNormals();
  // Make sure faces point outwards whichever way the polygon was wound.
  fixWinding(geo, new THREE.Vector3(x, points.reduce((s, q) => s + q[0], 0) / n, points.reduce((s, q) => s + q[1], 0) / n));
  return geo;
}

/** Flips triangles whose normal points towards `centre` (for convex-ish closed shapes). */
export function fixWinding(geo: THREE.BufferGeometry, centre: THREE.Vector3): void {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), mid = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    nrm.crossVectors(b.clone().sub(a), c.clone().sub(a));
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre);
    if (nrm.dot(mid) < 0) {
      p.setXYZ(i + 1, c.x, c.y, c.z);
      p.setXYZ(i + 2, b.x, b.y, b.z);
    }
  }
  geo.computeVertexNormals();
}

/** Stretched sphere (fairings, pods). */
export function ellipsoid(rx: number, ry: number, rz: number, wSeg = 14, hSeg = 10): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg);
  geo.scale(rx, ry, rz);
  return geo;
}
