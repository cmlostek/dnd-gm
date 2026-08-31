import type { MapWall } from '../../mapStore';
import { wallPath, curveMidpoint } from '../../vision/walls';

/**
 * Doorways — visible to everyone (unlike plain walls, which are GM-only).
 *
 * A closed door draws as a solid line, an open door as a dashed line; a locked
 * door gets a warmer tint and a small lock glyph. Hovering shows the door's
 * name and state via a native tooltip. The GM can click a door to toggle it
 * open/closed (locked doors must be unlocked first, from the Walls panel);
 * players only see and pass through open doors.
 */
export type DoorHover = {
  name: string;
  open: boolean;
  locked: boolean;
  /** Screen coordinates of the pointer, for positioning the tooltip. */
  x: number;
  y: number;
};

export default function DoorsLayer({
  doors,
  zoom,
  isGM,
  onToggleOpen,
  onHover,
  onHoverEnd,
}: {
  doors: MapWall[];
  zoom: number;
  isGM: boolean;
  /** GM-only: toggle a door open/closed (ignored for locked doors). */
  onToggleOpen?: (id: string) => void;
  /** Hover a door — drives the styled tooltip rendered by MapBoard. */
  onHover?: (h: DoorHover) => void;
  onHoverEnd?: () => void;
}) {
  const stroke = 3.5 / zoom;
  const dash = `${7 / zoom} ${5 / zoom}`;
  const lockR = 6 / zoom;

  return (
    <g>
      {doors.map((w) => {
        const d = w.door;
        if (!d) return null;
        const mid = curveMidpoint(w);
        const color = d.locked ? '#f87171' : d.open ? '#4ade80' : '#fbbf24';
        const hover = (e: React.MouseEvent) =>
          onHover?.({ name: d.name?.trim() || 'Door', open: d.open, locked: d.locked, x: e.clientX, y: e.clientY });
        const clickable = isGM && !!onToggleOpen && !d.locked;
        return (
          <g key={w.id}>
            {/* Fat invisible hit path — carries the hover tooltip for everyone
                and the GM open/close click. */}
            <path
              d={wallPath(w)}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(stroke * 4, 14 / zoom)}
              strokeLinecap="round"
              style={{ cursor: clickable ? 'pointer' : 'default' }}
              onClick={clickable ? () => onToggleOpen!(w.id) : undefined}
              onMouseEnter={hover}
              onMouseMove={hover}
              onMouseLeave={() => onHoverEnd?.()}
            />
            <path
              d={wallPath(w)}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeOpacity={0.95}
              strokeDasharray={d.open ? dash : undefined}
              pointerEvents="none"
            />
            {/* Lock badge at the door's midpoint. */}
            {d.locked && (
              <g pointerEvents="none" transform={`translate(${mid.x},${mid.y})`}>
                <circle r={lockR} fill="#450a0a" stroke="#f87171" strokeWidth={1 / zoom} />
                <path
                  d={`M ${-lockR * 0.4} ${-lockR * 0.05} h ${lockR * 0.8} v ${lockR * 0.5} h ${-lockR * 0.8} z
                      M ${-lockR * 0.25} ${-lockR * 0.05} v ${-lockR * 0.3} a ${lockR * 0.25} ${lockR * 0.25} 0 0 1 ${lockR * 0.5} 0 v ${lockR * 0.3}`}
                  fill="none"
                  stroke="#fecaca"
                  strokeWidth={1 / zoom}
                  strokeLinejoin="round"
                />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
