export interface Point { x: number; z: number }

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const wrap = (n: number, size: number): number => ((n % size) + size) % size;
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smooth(lo: number, hi: number, value: number): number {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function inPolygon(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export interface TravelPath {
  points: readonly Point[];
  ends: Float32Array;
  length: number;
}
export interface PathPose extends Point { heading: number }

export function loopPath(points: readonly Point[]): TravelPath {
  const ends = new Float32Array(points.length + 1);
  if (points.length < 3) throw new Error('A travel loop needs at least three points.');
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!Number.isFinite(length) || length < 0.001) throw new Error('Invalid path segment.');
    ends[i + 1] = ends[i]! + length;
  }
  return { points, ends, length: ends[points.length]! };
}

export function roundedBlock(x0: number, z0: number, x1: number, z1: number, radius: number): TravelPath {
  const points: Point[] = [];
  const corners = [[x1 - radius, z0 + radius], [x1 - radius, z1 - radius], [x0 + radius, z1 - radius], [x0 + radius, z0 + radius]];
  corners.forEach(([x, z], i) => {
    for (let j = 0; j <= 4; j++) {
      const angle = (-1 + i + j / 4) * Math.PI / 2;
      points.push({ x: x! + Math.cos(angle) * radius, z: z! + Math.sin(angle) * radius });
    }
  });
  return loopPath(points);
}

export function samplePath(path: TravelPath, distance: number, out: PathPose): PathPose {
  const d = wrap(distance, path.length);
  let lo = 0, hi = path.points.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d < path.ends[mid]!) hi = mid;
    else lo = mid;
  }
  const a = path.points[lo]!, b = path.points[(lo + 1) % path.points.length]!;
  const t = (d - path.ends[lo]!) / (path.ends[lo + 1]! - path.ends[lo]!);
  out.x = mix(a.x, b.x, t);
  out.z = mix(a.z, b.z, t);
  out.heading = Math.atan2(b.x - a.x, b.z - a.z);
  return out;
}
