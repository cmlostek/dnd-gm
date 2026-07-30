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
}: {
  lights: MapLight[];
  zoom: number;
  onRemoveLight?: (id: string) => void;
}) {
  const r = 5 / zoom;
  return (
    <g>
      {lights.map((l) => (
        <g key={l.id}>
          {/* Reach ring */}
          <circle
            cx={l.x} cy={l.y} r={l.radius}
            fill="none"
            stroke="#fbbf24"
            strokeOpacity={0.35}
            strokeWidth={1 / zoom}
            strokeDasharray={`${6 / zoom} ${5 / zoom}`}
            pointerEvents="none"
          />
          {/* Fat invisible hit target for easy double-click delete */}
          <circle
            cx={l.x} cy={l.y} r={Math.max(r * 2.4, 12 / zoom)}
            fill="transparent"
            style={{ cursor: onRemoveLight ? 'pointer' : 'default' }}
            onDoubleClick={onRemoveLight ? () => onRemoveLight(l.id) : undefined}
          />
          {/* Glow + core */}
          <circle cx={l.x} cy={l.y} r={r * 1.8} fill="#fbbf24" opacity={0.25} pointerEvents="none" />
          <circle cx={l.x} cy={l.y} r={r} fill="#fde68a" stroke="#f59e0b" strokeWidth={1 / zoom} pointerEvents="none" />
        </g>
      ))}
    </g>
  );
}
