import type { FogData } from '../../mapStore';
import { polygonToPoints, type Vec } from '../../vision/visibility';

/**
 * Fog of war overlay — manual or dynamic.
 *
 * A dark rectangle covers the canvas; an SVG mask decides where it shows.
 * Mask luminance drives the overlay's alpha: white = full fog, black = clear,
 * grey = the dim "explored but not currently seen" tier.
 *
 *  - manual:  white base, black holes at revealed cells.
 *  - dynamic: white base, grey at explored cells, black inside the party's
 *             current line-of-sight polygons (drawn last so sight wins).
 *
 * Players get a near-opaque overlay (unseen = black, hiding tokens in the
 * dark); the GM gets a translucent tint so they still see the whole map while
 * reading what the party can. Renders above tokens, below pings. Pure.
 */
export default function FogLayer({
  fog,
  isGM,
  canvasW,
  canvasH,
  visionPolys = [],
}: {
  fog: FogData;
  isGM: boolean;
  canvasW: number;
  canvasH: number;
  /** Current party line-of-sight polygons (dynamic mode). */
  visionPolys?: Vec[][];
}) {
  if (!fog.enabled) return null;

  const cell = fog.cell || 50;
  const e = 0.75; // cell inflation to avoid mask seams
  const dynamic = fog.mode === 'dynamic';

  const cellRect = (key: string, fill: string) => {
    const [cx, cy] = key.split(',').map(Number);
    if (Number.isNaN(cx) || Number.isNaN(cy)) return null;
    return (
      <rect
        key={`${fill}-${key}`}
        x={cx * cell - e}
        y={cy * cell - e}
        width={cell + 2 * e}
        height={cell + 2 * e}
        fill={fill}
      />
    );
  };

  return (
    <g pointerEvents="none">
      <defs>
        <mask id="map-fog-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={canvasW} height={canvasH}>
          {/* Base: everything fogged. */}
          <rect x={0} y={0} width={canvasW} height={canvasH} fill="#ffffff" />

          {dynamic ? (
            <>
              {/* Explored-but-unseen → grey (dim). */}
              {fog.explored.map((key) => cellRect(key, '#808080'))}
              {/* Current line of sight → black (clear). Drawn last so it wins. */}
              {visionPolys.map((poly, i) =>
                poly.length >= 3 ? <polygon key={i} points={polygonToPoints(poly)} fill="#000000" /> : null,
              )}
            </>
          ) : (
            // Manual: revealed cells → black (clear).
            fog.revealed.map((key) => cellRect(key, '#000000'))
          )}
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
