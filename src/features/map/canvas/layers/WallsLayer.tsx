import type { MapWall } from '../../mapStore';
import { wallPath, wallPoints } from '../../vision/walls';

type Pt = { x: number; y: number };

/**
 * Sight-blocking walls, GM only (players never see the geometry, only its
 * effect on line of sight and movement). A wall is a polyline through one or
 * more segments. While the Wall tool is active each vertex shows a drag handle
 * (alt- or right-click a handle to delete that vertex), and each segment shows
 * a smaller midpoint handle — drag it to add a bend (insert a vertex). Double-
 * click a wall to delete it. A dashed line previews a wall being drawn.
 *
 * Rendered above fog so walls stay visible while editing. Pure/prop-driven.
 */
export default function WallsLayer({
  walls,
  zoom,
  showHandles,
  draftStart,
  draftEnd,
  onRemoveWall,
  onWallClick,
  onVertexDown,
  onSegmentInsert,
  onVertexRemove,
}: {
  walls: MapWall[];
  zoom: number;
  /** Show the vertex + segment handles (true while the Wall tool is active). */
  showHandles: boolean;
  draftStart: Pt | null;
  draftEnd: Pt | null;
  onRemoveWall?: (id: string) => void;
  /** Single-click a wall (used by door-edit mode to convert it to a doorway). */
  onWallClick?: (id: string) => void;
  /** Begin dragging vertex `index` of a wall. */
  onVertexDown?: (wall: MapWall, index: number) => void;
  /** Add a bend by dragging the midpoint of segment `segIndex` (verts i…i+1). */
  onSegmentInsert?: (wall: MapWall, segIndex: number) => void;
  /** Delete vertex `index` (alt- or right-click a vertex handle). */
  onVertexRemove?: (wall: MapWall, index: number) => void;
}) {
  const stroke = 3 / zoom;
  const dot = 4 / zoom;
  const handleR = 5 / zoom;
  const midR = 3.5 / zoom;
  return (
    <g>
      {walls.map((w) => {
        const pts = wallPoints(w);
        return (
          <g key={w.id}>
            {/* Fat invisible hit path for easy double-click delete / door click. */}
            <path
              d={wallPath(w)}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(stroke * 4, 12 / zoom)}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ cursor: onWallClick || onRemoveWall ? 'pointer' : 'default' }}
              onClick={onWallClick ? () => onWallClick(w.id) : undefined}
              onDoubleClick={onRemoveWall ? () => onRemoveWall(w.id) : undefined}
            />
            <path
              d={wallPath(w)}
              fill="none"
              stroke="#fb7185"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.85}
              pointerEvents="none"
            />
            {!showHandles &&
              pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={dot} fill="#fecdd3" pointerEvents="none" />
              ))}

            {/* Segment midpoint handles — drag to insert a bend. */}
            {showHandles && onSegmentInsert &&
              pts.slice(0, -1).map((p, i) => {
                const q = pts[i + 1];
                const mx = (p.x + q.x) / 2;
                const my = (p.y + q.y) / 2;
                return (
                  <circle
                    key={`m${i}`}
                    cx={mx}
                    cy={my}
                    r={midR}
                    fill="#0f172a"
                    stroke="#fda4af"
                    strokeWidth={1 / zoom}
                    style={{ cursor: 'copy' }}
                    onMouseDown={(e) => { e.stopPropagation(); onSegmentInsert(w, i); }}
                  >
                    <title>Drag to add a bend</title>
                  </circle>
                );
              })}

            {/* Vertex handles — drag to move; alt/right-click to remove. */}
            {showHandles && onVertexDown &&
              pts.map((p, i) => (
                <circle
                  key={`v${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={handleR}
                  fill="#fef08a"
                  stroke="#f59e0b"
                  strokeWidth={1 / zoom}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if ((e.altKey || e.button === 2) && onVertexRemove) onVertexRemove(w, i);
                    else onVertexDown(w, i);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onVertexRemove?.(w, i);
                  }}
                >
                  <title>Drag to move · alt/right-click to remove</title>
                </circle>
              ))}
          </g>
        );
      })}

      {draftStart && draftEnd && (
        <line
          x1={draftStart.x} y1={draftStart.y} x2={draftEnd.x} y2={draftEnd.y}
          stroke="#fb7185"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
          pointerEvents="none"
        />
      )}
    </g>
  );
}
