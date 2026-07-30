import { describe, it, expect } from 'vitest';
import { computeVisibility, pointInPolygon, borderWalls, cellsInVision, type Vec } from './visibility';

const W = 100;
const H = 100;

/** Shoelace area, absolute. */
function area(poly: Vec[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a / 2);
}

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ];
  it('detects inside and outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
  });
});

describe('computeVisibility — open room', () => {
  it('sees the whole canvas when there are no interior walls', () => {
    const poly = computeVisibility({ x: 50, y: 50 }, [], W, H);
    // With only the borders, the visible polygon is the full rectangle.
    expect(area(poly)).toBeGreaterThan(W * H * 0.98);
    // All four corners are visible.
    for (const c of [{ x: 2, y: 2 }, { x: 98, y: 2 }, { x: 98, y: 98 }, { x: 2, y: 98 }]) {
      expect(pointInPolygon(c, poly)).toBe(true);
    }
  });

  it('produces a closed polygon (>= 3 vertices)', () => {
    const poly = computeVisibility({ x: 30, y: 70 }, [], W, H);
    expect(poly.length).toBeGreaterThanOrEqual(3);
  });
});

describe('computeVisibility — a wall casts a shadow', () => {
  // A vertical wall segment to the right of the origin. Points directly behind
  // it (further right, same height band) must fall outside the visible polygon.
  const wall = [{ x1: 60, y1: 30, x2: 60, y2: 70 }];

  it('hides what is directly behind the wall', () => {
    const poly = computeVisibility({ x: 20, y: 50 }, wall, W, H);
    expect(pointInPolygon({ x: 80, y: 50 }, poly)).toBe(false); // shadowed
  });

  it('still sees around the wall', () => {
    const poly = computeVisibility({ x: 20, y: 50 }, wall, W, H);
    // Well above the wall's top end — line of sight is clear here.
    expect(pointInPolygon({ x: 80, y: 10 }, poly)).toBe(true);
    // In front of the wall is obviously visible.
    expect(pointInPolygon({ x: 40, y: 50 }, poly)).toBe(true);
  });

  it('removes the shadow when the wall is gone', () => {
    const poly = computeVisibility({ x: 20, y: 50 }, [], W, H);
    expect(pointInPolygon({ x: 80, y: 50 }, poly)).toBe(true);
  });
});

describe('computeVisibility — enclosed box', () => {
  // A 20×20 room around the origin; the viewpoint should see only inside it.
  const room = [
    { x1: 40, y1: 40, x2: 60, y2: 40 },
    { x1: 60, y1: 40, x2: 60, y2: 60 },
    { x1: 60, y1: 60, x2: 40, y2: 60 },
    { x1: 40, y1: 60, x2: 40, y2: 40 },
  ];

  it('confines vision to the room', () => {
    const poly = computeVisibility({ x: 50, y: 50 }, room, W, H);
    // Roughly the 20×20 interior, not the whole 100×100 canvas.
    expect(area(poly)).toBeLessThan(20 * 20 * 1.6);
    expect(area(poly)).toBeGreaterThan(20 * 20 * 0.6);
    // Inside visible, outside the walls not.
    expect(pointInPolygon({ x: 50, y: 50 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 90, y: 90 }, poly)).toBe(false);
    expect(pointInPolygon({ x: 10, y: 10 }, poly)).toBe(false);
  });
});

describe('computeVisibility — radius clamp', () => {
  it('limits sight to the given radius in an open room', () => {
    const poly = computeVisibility({ x: 50, y: 50 }, [], W, H, 20);
    // A point 30 away is beyond the 20 radius.
    expect(pointInPolygon({ x: 50, y: 82 }, poly)).toBe(false);
    // A point 10 away is within it.
    expect(pointInPolygon({ x: 50, y: 60 }, poly)).toBe(true);
    // Area is roughly a disc of r=20, not the full canvas.
    expect(area(poly)).toBeLessThan(W * H * 0.6);
  });
});

describe('cellsInVision', () => {
  // One polygon covering roughly the cells (1,1)..(2,2) on a 10px grid.
  const poly = [
    { x: 50, y: 50 }, { x: 149, y: 50 }, { x: 149, y: 149 }, { x: 50, y: 149 },
  ];

  it('returns the cells whose centres fall inside the polygon', () => {
    // 10px cells: centres at 55,65,... A poly from 50..149 covers cells whose
    // centre is in (50,149): cols/rows 5..14.
    const cells = cellsInVision([poly], 10, 200, 200);
    expect(cells).toContain('5,5');
    expect(cells).toContain('14,14');
    expect(cells).not.toContain('4,4'); // centre 45 < 50
    expect(cells).not.toContain('15,15'); // centre 155 > 149
  });

  it('is empty with no polygons or a non-positive cell', () => {
    expect(cellsInVision([], 10, 200, 200)).toEqual([]);
    expect(cellsInVision([poly], 0, 200, 200)).toEqual([]);
  });

  it('unions across multiple polygons', () => {
    const far = [{ x: 300, y: 300 }, { x: 340, y: 300 }, { x: 340, y: 340 }, { x: 300, y: 340 }];
    const cells = cellsInVision([poly, far], 10, 400, 400);
    expect(cells).toContain('5,5');   // from first poly
    expect(cells).toContain('31,31'); // from second poly (centre 315)
  });
});

describe('borderWalls', () => {
  it('returns four edges forming the canvas rectangle', () => {
    const b = borderWalls(W, H);
    expect(b).toHaveLength(4);
  });
});
