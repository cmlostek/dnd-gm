/**
 * Line-of-sight visibility polygon (Phase 2 foundation).
 *
 * Classic endpoint ray-casting: from a viewpoint, cast rays at every wall
 * endpoint (plus a hair to either side so rays slip past corners and catch
 * what's behind them), keep each ray's nearest wall hit, then sort those hits
 * by angle to form the polygon of everything the viewpoint can see.
 *
 * Pure and dependency-free so it can be tested exhaustively without a store,
 * DOM, or SVG. The map's four borders are always added as walls, so with
 * unlimited range every ray terminates on a wall and the polygon is closed.
 *
 * Complexity is O(endpoints × segments) per viewpoint — recompute on drag-end,
 * not per-frame, and cap walls per scene (see the wall tool). Not built for
 * thousands of walls.
 */

export type Seg = { x1: number; y1: number; x2: number; y2: number };
export type Vec = { x: number; y: number };

const EPS_ANGLE = 0.00008; // radians nudged either side of each corner
const EPS_DENOM = 1e-9;

/**
 * Nearest positive-t intersection of a ray (origin + t·dir, dir unit) with a
 * segment. Returns the distance t (= world distance since dir is unit) or null.
 */
function rayHit(ox: number, oy: number, dx: number, dy: number, s: Seg): number | null {
  const sdx = s.x2 - s.x1;
  const sdy = s.y2 - s.y1;
  const denom = dx * sdy - dy * sdx;
  if (Math.abs(denom) < EPS_DENOM) return null; // parallel
  const t = ((s.x1 - ox) * sdy - (s.y1 - oy) * sdx) / denom;
  const u = ((s.x1 - ox) * dy - (s.y1 - oy) * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

/** The four canvas edges as wall segments. */
export function borderWalls(w: number, h: number): Seg[] {
  return [
    { x1: 0, y1: 0, x2: w, y2: 0 },
    { x1: w, y1: 0, x2: w, y2: h },
    { x1: w, y1: h, x2: 0, y2: h },
    { x1: 0, y1: h, x2: 0, y2: 0 },
  ];
}

/**
 * Compute the visibility polygon from `origin` against `walls`, bounded by a
 * `w`×`h` canvas. `radius` (default unlimited) clamps how far sight reaches.
 * Returns polygon vertices in angular order (empty if origin is outside bounds).
 */
export function computeVisibility(
  origin: Vec,
  walls: Seg[],
  w: number,
  h: number,
  radius = Infinity,
): Vec[] {
  const { x: ox, y: oy } = origin;
  const segs = [...walls, ...borderWalls(w, h)];

  // Unique endpoints → candidate ray angles.
  const angles: number[] = [];
  for (const s of segs) {
    angles.push(Math.atan2(s.y1 - oy, s.x1 - ox));
    angles.push(Math.atan2(s.y2 - oy, s.x2 - ox));
  }

  const hits: { ang: number; x: number; y: number }[] = [];
  for (const base of angles) {
    for (const da of [-EPS_ANGLE, 0, EPS_ANGLE]) {
      const ang = base + da;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      let best = radius;
      let found = radius !== Infinity; // with a radius, the arc itself is a valid stop
      for (const s of segs) {
        const t = rayHit(ox, oy, dx, dy, s);
        if (t !== null && t < best) {
          best = t;
          found = true;
        }
      }
      if (!found) continue;
      hits.push({ ang, x: ox + dx * best, y: oy + dy * best });
    }
  }

  hits.sort((a, b) => a.ang - b.ang);
  return hits.map((p) => ({ x: p.x, y: p.y }));
}

/** Ray-crossing point-in-polygon test. */
export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Serialize a polygon to an SVG points string. */
export function polygonToPoints(poly: Vec[]): string {
  return poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}
