/**
 * Wall geometry — tessellation and token collision.
 *
 * Walls can bow into a quadratic curve (a control point `c`); everything
 * downstream — line of sight and collision — works on straight segments, so a
 * curved wall is sampled into a short polyline here. Pure and dependency-free
 * so the maths can be tested without a store or DOM.
 */

import type { Seg, Vec } from './visibility';

/**
 * A wall as authored. Two representations, in priority order:
 *  - `points`: a polyline through ≥2 vertices (straight segments between them).
 *    This is what multi-point walls use; `x1/y1/x2/y2` mirror the first/last
 *    vertex for any legacy reader.
 *  - otherwise the legacy single segment (x1,y1)→(x2,y2), optionally bowed into
 *    a quadratic arc by a control point `cx/cy`.
 */
export type CurveWall = {
  x1: number; y1: number; x2: number; y2: number;
  cx?: number; cy?: number;
  points?: Vec[];
};

/** True when the wall is a multi-point polyline (≥2 explicit vertices). */
export function isPolyline(w: CurveWall): w is CurveWall & { points: Vec[] } {
  return Array.isArray(w.points) && w.points.length >= 2;
}

/**
 * Return a copy of `w` reshaped to the given vertices, keeping x1/y1/x2/y2 in
 * sync with the first/last point. Two points collapse back to a plain straight
 * segment (no `points`/arc); three or more store a polyline. Extra fields (id,
 * door, …) are preserved. Cleared fields are set to undefined so they drop out
 * of the JSON persisted to the scene.
 */
export function withWallPoints<T extends CurveWall>(w: T, pts: Vec[]): T {
  const first = pts[0];
  const last = pts[pts.length - 1];
  const out = { ...w, x1: first.x, y1: first.y, x2: last.x, y2: last.y, cx: undefined, cy: undefined } as T;
  out.points = pts.length > 2 ? pts : undefined;
  return out;
}

/** The wall's editable vertices — its polyline points, or the two endpoints of
 *  a legacy segment. (A legacy arc is treated as its two endpoints for editing;
 *  bending it produces a polyline.) */
export function wallPoints(w: CurveWall): Vec[] {
  if (isPolyline(w)) return w.points;
  return [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
}

/** How finely a curved wall is sampled for sight/collision. */
export const WALL_CURVE_STEPS = 14;

const EPS = 1e-6;

/** A wall is straight when it has no control point, or the control sits on the
 *  midpoint (within a hair) — so a freshly-drawn wall isn't needlessly sampled. */
export function isStraightWall(w: CurveWall): boolean {
  if (w.cx == null || w.cy == null) return true;
  const mx = (w.x1 + w.x2) / 2;
  const my = (w.y1 + w.y2) / 2;
  return Math.abs(w.cx - mx) < 0.5 && Math.abs(w.cy - my) < 0.5;
}

/** Straight segments between consecutive polyline vertices. */
function polylineSegments(pts: Vec[]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y });
  }
  return segs;
}

/** Sample a wall into straight segments (one for a straight wall). */
export function tessellateWall(w: CurveWall, steps = WALL_CURVE_STEPS): Seg[] {
  if (isPolyline(w)) return polylineSegments(w.points);
  if (isStraightWall(w)) return [{ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }];
  const cx = w.cx as number;
  const cy = w.cy as number;
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * w.x1 + 2 * mt * t * cx + t * t * w.x2,
      y: mt * mt * w.y1 + 2 * mt * t * cy + t * t * w.y2,
    });
  }
  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y });
  }
  return segs;
}

/** Flatten every wall to straight segments (for computeVisibility / collision). */
export function wallSegments(walls: CurveWall[]): Seg[] {
  return walls.flatMap((w) => tessellateWall(w));
}

/** SVG path `d` for a wall — a polyline, a straight line, or a quadratic arc. */
export function wallPath(w: CurveWall): string {
  if (isPolyline(w)) {
    return w.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }
  if (isStraightWall(w)) return `M ${w.x1} ${w.y1} L ${w.x2} ${w.y2}`;
  return `M ${w.x1} ${w.y1} Q ${w.cx} ${w.cy} ${w.x2} ${w.y2}`;
}

/** A representative midpoint of the wall — the middle of the central segment for
 *  a polyline, the arc's t=0.5 point for a bezier, else the segment midpoint.
 *  Used to anchor the door lock badge. */
export function curveMidpoint(w: CurveWall): Vec {
  if (isPolyline(w)) {
    const pts = w.points;
    const i = Math.floor((pts.length - 1) / 2);
    return { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
  }
  if (isStraightWall(w)) return { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 };
  return {
    x: 0.25 * w.x1 + 0.5 * (w.cx as number) + 0.25 * w.x2,
    y: 0.25 * w.y1 + 0.5 * (w.cy as number) + 0.25 * w.y2,
  };
}

/** Control point that makes the curve pass through `m` at its midpoint — the
 *  inverse of curveMidpoint, so dragging the handle to `m` bends the wall
 *  through the cursor. */
export function controlThroughMidpoint(w: CurveWall, m: Vec): { cx: number; cy: number } {
  return { cx: 2 * m.x - (w.x1 + w.x2) / 2, cy: 2 * m.y - (w.y1 + w.y2) / 2 };
}

/**
 * Parametric intersection of moving segment a0→a1 with wall b0→b1. Returns t in
 * [0,1] along `a` at the crossing, or null. Near-parallel movement is ignored.
 */
function crossT(a0: Vec, a1: Vec, b0: Vec, b1: Vec): number | null {
  const rx = a1.x - a0.x;
  const ry = a1.y - a0.y;
  const sx = b1.x - b0.x;
  const sy = b1.y - b0.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null;
  const t = ((b0.x - a0.x) * sy - (b0.y - a0.y) * sx) / denom;
  const u = ((b0.x - a0.x) * ry - (b0.y - a0.y) * rx) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return null;
}

/**
 * Resolve a token move from `from` to `to` against wall `segs`, sliding along
 * whatever it hits rather than passing through or stopping dead.
 *
 * Point-based (the token's centre): it walks the intended move, and on the
 * first wall crossing it stops just short and re-aims the leftover motion along
 * that wall, repeating a few times so corners resolve. Not a full physics
 * solver — good enough for dragging a token around a dungeon.
 */
export function resolveMovement(from: Vec, to: Vec, segs: Seg[]): Vec {
  if (segs.length === 0) return to;
  let p0 = from;
  let p1 = to;
  const backoff = 0.01;

  for (let iter = 0; iter < 4; iter++) {
    // Earliest wall crossing along p0→p1.
    let bestT = Infinity;
    let hitSeg: Seg | null = null;
    for (const s of segs) {
      const t = crossT(p0, p1, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
      if (t !== null && t > EPS && t < bestT) {
        bestT = t;
        hitSeg = s;
      }
    }
    if (!hitSeg) return p1; // clear path

    // Stop just short of the wall.
    const tBack = Math.max(0, bestT - backoff);
    const contact = { x: p0.x + (p1.x - p0.x) * tBack, y: p0.y + (p1.y - p0.y) * tBack };

    // Re-aim the leftover motion along the wall direction (slide).
    const wdx = hitSeg.x2 - hitSeg.x1;
    const wdy = hitSeg.y2 - hitSeg.y1;
    const wlen = Math.hypot(wdx, wdy) || 1;
    const ux = wdx / wlen;
    const uy = wdy / wlen;
    const remX = p1.x - contact.x;
    const remY = p1.y - contact.y;
    const proj = remX * ux + remY * uy;

    p0 = contact;
    p1 = { x: contact.x + ux * proj, y: contact.y + uy * proj };
  }

  // Corner pile-up: make sure the final leg isn't still crossing a wall.
  for (const s of segs) {
    const t = crossT(p0, p1, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
    if (t !== null && t > EPS) return p0; // stay put rather than tunnel
  }
  return p1;
}
