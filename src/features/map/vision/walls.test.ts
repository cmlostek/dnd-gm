import { describe, it, expect } from 'vitest';
import {
  isStraightWall,
  tessellateWall,
  wallSegments,
  weldedWallSegments,
  wallPath,
  resolveMovement,
  type CurveWall,
} from './walls';
import type { Seg } from './visibility';

describe('isStraightWall', () => {
  it('is straight with no control point', () => {
    expect(isStraightWall({ x1: 0, y1: 0, x2: 10, y2: 0 })).toBe(true);
  });
  it('is straight when the control sits on the midpoint', () => {
    expect(isStraightWall({ x1: 0, y1: 0, x2: 10, y2: 0, cx: 5, cy: 0 })).toBe(true);
  });
  it('is curved when the control is pulled off the midpoint', () => {
    expect(isStraightWall({ x1: 0, y1: 0, x2: 10, y2: 0, cx: 5, cy: 8 })).toBe(false);
  });
});

describe('tessellateWall', () => {
  it('returns a single segment for a straight wall', () => {
    const segs = tessellateWall({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(segs).toEqual([{ x1: 0, y1: 0, x2: 10, y2: 0 }]);
  });

  it('samples a curved wall into many connected segments', () => {
    const segs = tessellateWall({ x1: 0, y1: 0, x2: 10, y2: 0, cx: 5, cy: 10 }, 8);
    expect(segs.length).toBe(8);
    // Endpoints preserved.
    expect(segs[0].x1).toBeCloseTo(0);
    expect(segs[0].y1).toBeCloseTo(0);
    expect(segs[segs.length - 1].x2).toBeCloseTo(10);
    expect(segs[segs.length - 1].y2).toBeCloseTo(0);
    // The curve bows toward the control point — the midpoint of a bezier with
    // control (5,10) sits at y = 5, not on the chord.
    const mid = segs[4].x1;
    expect(mid).toBeCloseTo(5, 0);
    expect(segs[4].y1).toBeGreaterThan(3);
  });

  it('is chained (each segment starts where the last ended)', () => {
    const segs = tessellateWall({ x1: 0, y1: 0, x2: 20, y2: 0, cx: 10, cy: 15 }, 6);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].x1).toBeCloseTo(segs[i - 1].x2);
      expect(segs[i].y1).toBeCloseTo(segs[i - 1].y2);
    }
  });
});

describe('wallSegments / wallPath', () => {
  it('flattens a mix of straight and curved walls', () => {
    const walls: CurveWall[] = [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 0, y1: 5, x2: 10, y2: 5, cx: 5, cy: 20 },
    ];
    const segs = wallSegments(walls);
    expect(segs.length).toBe(1 + 14); // straight + default-step curve
  });

  it('emits a line path for straight and a Q path for curved', () => {
    expect(wallPath({ x1: 0, y1: 0, x2: 10, y2: 0 })).toContain('L');
    expect(wallPath({ x1: 0, y1: 0, x2: 10, y2: 0, cx: 5, cy: 9 })).toContain('Q');
  });
});

describe('weldedWallSegments', () => {
  it('snaps a nearby door endpoint to the flanking wall, closing the gap', () => {
    // A wall ending at (10,0) and a "door" starting at (12,0) — a 2-unit gap.
    const walls: CurveWall[] = [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 12, y1: 0, x2: 22, y2: 0 },
    ];
    const segs = weldedWallSegments(walls, 5); // tol 5 > gap 2 → weld
    // The door's start is pulled onto the wall's end (10,0): no gap remains.
    const door = segs[1];
    expect(door.x1).toBe(10);
    expect(door.y1).toBe(0);
  });

  it('leaves genuinely separate walls untouched when beyond tolerance', () => {
    const walls: CurveWall[] = [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 40, y1: 0, x2: 50, y2: 0 },
    ];
    const segs = weldedWallSegments(walls, 5); // gap 30 >> tol → no weld
    expect(segs[1].x1).toBe(40);
  });

  it('welds only outer endpoints, leaving interior polyline vertices intact', () => {
    const walls: CurveWall[] = [
      { x1: 0, y1: 0, x2: 20, y2: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 20, y: 0 }] },
      { x1: 21, y1: 0, x2: 30, y2: 0 },
    ];
    const segs = weldedWallSegments(walls, 3);
    // Interior vertex (10,3) preserved on the polyline's first segment.
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 10, y2: 3 });
    // Second wall's start snapped from 21 → 20 (the polyline's welded end).
    expect(segs[2].x1).toBe(20);
  });
});

describe('resolveMovement', () => {
  // A vertical wall at x=10 from y=-100..100.
  const wall: Seg[] = [{ x1: 10, y1: -100, x2: 10, y2: 100 }];

  it('passes straight through when nothing is in the way', () => {
    const out = resolveMovement({ x: 0, y: 0 }, { x: 5, y: 5 }, []);
    expect(out).toEqual({ x: 5, y: 5 });
  });

  it('stops just short of a wall it moves straight into', () => {
    // Moving from x=0 to x=20 crosses the wall at x=10.
    const out = resolveMovement({ x: 0, y: 0 }, { x: 20, y: 0 }, wall);
    expect(out.x).toBeLessThan(10);
    expect(out.x).toBeGreaterThan(9); // right up against it
  });

  it('slides along the wall for a diagonal move into it', () => {
    // Heading down-right into the vertical wall: x is blocked, y slides.
    const out = resolveMovement({ x: 0, y: 0 }, { x: 20, y: 30 }, wall);
    expect(out.x).toBeLessThan(10);   // didn't pass through
    expect(out.y).toBeGreaterThan(20); // slid down the wall
  });

  it('lets a move parallel to a wall proceed freely', () => {
    // Moving along y with x safely left of the wall.
    const out = resolveMovement({ x: 0, y: 0 }, { x: 0, y: 40 }, wall);
    expect(out).toEqual({ x: 0, y: 40 });
  });

  it('does not tunnel through at a corner', () => {
    // An L-corner: vertical wall at x=10 and horizontal at y=10.
    const corner: Seg[] = [
      { x1: 10, y1: 0, x2: 10, y2: 100 },
      { x1: 0, y1: 10, x2: 100, y2: 10 },
    ];
    const out = resolveMovement({ x: 5, y: 5 }, { x: 30, y: 30 }, corner);
    // Must stay inside the corner (both coords short of their walls).
    expect(out.x).toBeLessThanOrEqual(10.01);
    expect(out.y).toBeLessThanOrEqual(10.01);
  });
});
