import type { MapWall } from '../../mapStore';
import { wallPath, curveMidpoint } from '../../vision/walls';

type Pt = { x: number; y: number };

/**
 * Sight-blocking walls, GM only (players never see the geometry, only its
 * effect on line of sight and movement). Straight or bowed into an arc; a
 * bend handle on each wall's midpoint (shown while the Wall tool is active)
 * drags the curve, and double-click removes the wall. A dashed straight line
 * previews a wall being drawn.
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
  onBendStart,
  onWallClick,
}: {
  walls: MapWall[];
  zoom: number;
  /** Show the midpoint bend handles (true while the Wall tool is active). */
  showHandles: boolean;
  draftStart: Pt | null;
  draftEnd: Pt | null;
  onRemoveWall?: (id: string) => void;
  onBendStart?: (wall: MapWall, e: React.MouseEvent) => void;
  /** Single-click a wall (used by door-edit mode to convert it to a doorway). */
  onWallClick?: (id: string) => void;
}) {
  const stroke = 3 / zoom;
  const dot = 4 / zoom;
  const handleR = 5 / zoom;
  return (
    <g>
      {walls.map((w) => {
        const mid = curveMidpoint(w);
        return (
          <g key={w.id}>
            {/* Fat invisible hit path for easy double-click delete. */}
            <path
              d={wallPath(w)}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(stroke * 4, 12 / zoom)}
              strokeLinecap="round"
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
              strokeOpacity={0.85}
              pointerEvents="none"
            />
            <circle cx={w.x1} cy={w.y1} r={dot} fill="#fecdd3" pointerEvents="none" />
            <circle cx={w.x2} cy={w.y2} r={dot} fill="#fecdd3" pointerEvents="none" />
            {/* Bend handle — drag to curve the wall. */}
            {showHandles && onBendStart && (
              <circle
                cx={mid.x}
                cy={mid.y}
                r={handleR}
                fill="#fef08a"
                stroke="#f59e0b"
                strokeWidth={1 / zoom}
                style={{ cursor: 'grab' }}
                onMouseDown={(e) => { e.stopPropagation(); onBendStart(w, e); }}
              />
            )}
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
