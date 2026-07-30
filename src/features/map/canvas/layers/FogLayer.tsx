import type { FogData } from '../../mapStore';

/**
 * Manual fog of war overlay.
 *
 * A dark rectangle covers the whole canvas; an SVG mask punches holes where the
 * GM has revealed cells (white = fog shows, black cell = hole). Players get a
 * near-opaque overlay, so anything unrevealed — including tokens sitting in the
 * dark — is hidden. The GM gets a translucent tint instead, so they still see
 * the entire map but can tell at a glance what the party can and can't see.
 *
 * Renders above tokens (so fog actually covers them) but below pings. Pure and
 * prop-driven; the shared/authored fog state lives in the scene.
 */
export default function FogLayer({
  fog,
  isGM,
  canvasW,
  canvasH,
}: {
  fog: FogData;
  isGM: boolean;
  canvasW: number;
  canvasH: number;
}) {
  if (!fog.enabled) return null;

  const cell = fog.cell || 50;
  // Inflate each revealed cell slightly so adjacent squares overlap and don't
  // leave hairline fog seams between them from mask anti-aliasing.
  const e = 0.75;

  return (
    <g pointerEvents="none">
      <defs>
        <mask id="map-fog-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={canvasW} height={canvasH}>
          {/* White = overlay visible (fogged) everywhere by default. */}
          <rect x={0} y={0} width={canvasW} height={canvasH} fill="#ffffff" />
          {/* Black = revealed holes where the overlay is cut away. */}
          {fog.revealed.map((key) => {
            const [cx, cy] = key.split(',').map(Number);
            if (Number.isNaN(cx) || Number.isNaN(cy)) return null;
            return (
              <rect
                key={key}
                x={cx * cell - e}
                y={cy * cell - e}
                width={cell + 2 * e}
                height={cell + 2 * e}
                fill="#000000"
              />
            );
          })}
        </mask>
      </defs>
      <rect
        x={0}
        y={0}
        width={canvasW}
        height={canvasH}
        fill="#020617"
        opacity={isGM ? 0.5 : 0.985}
        mask="url(#map-fog-mask)"
      />
    </g>
  );
}
