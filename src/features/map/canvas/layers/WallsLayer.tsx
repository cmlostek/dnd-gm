import type { MapWall } from '../../mapStore';

type Pt = { x: number; y: number };

/**
 * Sight-blocking walls, drawn only for the GM (players never see the geometry).
 * Each wall is a grabbable line with endpoint dots so junctions are visible
 * while building a room; double-click removes it. A dashed preview follows the
 * cursor while a wall is being drawn.
 *
 * Rendered near the top of the stack so the GM can always see and edit walls,
 * even over fog. Pure/prop-driven; the wall data is authored in the scene.
 */
export default function WallsLayer({
  walls,
  zoom,
  draftStart,
  draftEnd,
  onRemoveWall,
}: {
  walls: MapWall[];
  zoom: number;
  draftStart: Pt | null;
  draftEnd: Pt | null;
  onRemoveWall?: (id: string) => void;
}) {
  const stroke = 3 / zoom;
  const dot = 4 / zoom;
  return (
    <g>
      {walls.map((w) => (
        <g key={w.id}>
          {/* Fat invisible hit line so the thin wall is easy to double-click. */}
          <line
            x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke="transparent"
            strokeWidth={Math.max(stroke * 4, 10 / zoom)}
            strokeLinecap="round"
            style={{ cursor: onRemoveWall ? 'pointer' : 'default' }}
            onDoubleClick={onRemoveWall ? () => onRemoveWall(w.id) : undefined}
          />
          <line
            x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke="#fb7185"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeOpacity={0.85}
            pointerEvents="none"
          />
          <circle cx={w.x1} cy={w.y1} r={dot} fill="#fecdd3" pointerEvents="none" />
          <circle cx={w.x2} cy={w.y2} r={dot} fill="#fecdd3" pointerEvents="none" />
        </g>
      ))}

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
