import type { MapLight } from '../../mapStore';

/**
 * Light-source markers, GM only (players just experience the illumination the
 * lights produce, in FogLayer). Each light shows a small glowing dot and a
 * dashed radius ring so the GM can see reach while placing; double-click
 * removes it. Rendered above fog so it's always visible while editing.
 *
 * Pure/prop-driven — light data is authored in the scene, the illumination
 * geometry is computed in MapBoard and drawn by FogLayer.
 */
export default function LightsLayer({
  lights,
  zoom,
  onRemoveLight,
  onLightDown,
  dragId,
  dragPos,
}: {
  lights: MapLight[];
  zoom: number;
  onRemoveLight?: (id: string) => void;
  /** GM: begin dragging a light marker (mousedown on it). */
  onLightDown?: (id: string, e: React.MouseEvent) => void;
  /** The light currently being dragged + its live position (renders there). */
  dragId?: string | null;
  dragPos?: { x: number; y: number } | null;
}) {
  const r = 5 / zoom;
  return (
    <g>
      {lights.map((l) => {
        const live = dragId === l.id && dragPos ? dragPos : l;
        const lx = live.x;
        const ly = live.y;
        return (
          <g key={l.id}>
            {/* Reach ring */}
            <circle
              cx={lx} cy={ly} r={l.radius}
              fill="none"
              stroke="#fbbf24"
              strokeOpacity={0.35}
              strokeWidth={1 / zoom}
              strokeDasharray={`${6 / zoom} ${5 / zoom}`}
              pointerEvents="none"
            />
            {/* Fat invisible hit target — drag to move, double-click to delete */}
            <circle
              cx={lx} cy={ly} r={Math.max(r * 2.4, 12 / zoom)}
              fill="transparent"
              style={{ cursor: onLightDown ? (dragId === l.id ? 'grabbing' : 'grab') : onRemoveLight ? 'pointer' : 'default' }}
              onMouseDown={onLightDown ? (e) => { e.stopPropagation(); onLightDown(l.id, e); } : undefined}
              onDoubleClick={onRemoveLight ? () => onRemoveLight(l.id) : undefined}
            />
            {/* Glow + core */}
            <circle cx={lx} cy={ly} r={r * 1.8} fill="#fbbf24" opacity={0.25} pointerEvents="none" />
            <circle cx={lx} cy={ly} r={r} fill="#fde68a" stroke="#f59e0b" strokeWidth={1 / zoom} pointerEvents="none" />
          </g>
        );
      })}
    </g>
  );
}
