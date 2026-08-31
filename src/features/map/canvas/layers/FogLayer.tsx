import type { FogData } from '../../mapStore';
import { polygonToPoints, type Vec } from '../../vision/visibility';

/** A light's illuminated area: a radius disc clipped to its wall-bounded
 *  visibility polygon (computed in MapBoard). */
export type LightArea = { id: string; cx: number; cy: number; radius: number; poly: Vec[] };

/**
 * Fog of war overlay — manual, dynamic, and (Phase 3) dynamic-in-darkness.
 *
 * Overlay 1 is the base fog: a dark rect whose mask makes it clear inside the
 * party's line of sight (black), dim over explored cells (grey), and full
 * elsewhere (white). Overlay 2 only exists in a dark scene: it re-darkens the
 * in-sight-but-unlit region, so with darkness on the party sees only where
 * sight AND light overlap. Lit area per light is a radius disc clipped to that
 * light's own wall-bounded visibility polygon, so light doesn't leak through
 * walls.
 *
 * Players get near-opaque overlays (unseen/unlit = black); the GM gets a
 * translucent tint so they still read the whole map. Pure/prop-driven.
 */
export default function FogLayer({
  fog,
  isGM,
  canvasW,
  canvasH,
  visionPolys = [],
  lightAreas = [],
}: {
  fog: FogData;
  isGM: boolean;
  canvasW: number;
  canvasH: number;
  visionPolys?: Vec[][];
  lightAreas?: LightArea[];
}) {
  if (!fog.enabled) return null;

  const cell = fog.cell || 50;
  const e = 0.75; // cell inflation to avoid mask seams
  const dynamic = fog.mode === 'dynamic';
  const dark = dynamic && fog.ambientDark;

  const cellRect = (key: string, fill: string) => {
    const [cx, cy] = key.split(',').map(Number);
    if (Number.isNaN(cx) || Number.isNaN(cy)) return null;
    return (
      <rect
        key={`${fill}-${key}`}
        x={cx * cell - e} y={cy * cell - e}
        width={cell + 2 * e} height={cell + 2 * e}
        fill={fill}
      />
    );
  };

  const sightPolys = visionPolys.filter((p) => p.length >= 3);

  return (
    <g pointerEvents="none">
      <defs>
        {/* Base fog mask: white fogged, grey explored, black in-sight. */}
        <mask id="map-fog-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={canvasW} height={canvasH}>
          <rect x={0} y={0} width={canvasW} height={canvasH} fill="#ffffff" />
          {dynamic ? (
            <>
              {fog.explored.map((key) => cellRect(key, '#808080'))}
              {sightPolys.map((poly, i) => <polygon key={i} points={polygonToPoints(poly)} fill="#000000" />)}
            </>
          ) : (
            fog.revealed.map((key) => cellRect(key, '#000000'))
          )}
        </mask>

        {dark && (
          <>
            {/* One clip per light so its disc respects walls. */}
            {lightAreas.map((la) =>
              la.poly.length >= 3 ? (
                <clipPath key={la.id} id={`light-clip-${la.id}`} clipPathUnits="userSpaceOnUse">
                  <polygon points={polygonToPoints(la.poly)} />
                </clipPath>
              ) : null,
            )}
            {/* Darkness mask: black hidden, white in-sight, black lit → shows only S\L. */}
            <mask id="map-dark-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={canvasW} height={canvasH}>
              <rect x={0} y={0} width={canvasW} height={canvasH} fill="#000000" />
              {sightPolys.map((poly, i) => <polygon key={i} points={polygonToPoints(poly)} fill="#ffffff" />)}
              {lightAreas.map((la) =>
                la.poly.length >= 3 ? (
                  <circle key={la.id} cx={la.cx} cy={la.cy} r={la.radius} fill="#000000" clipPath={`url(#light-clip-${la.id})`} />
                ) : null,
              )}
            </mask>
          </>
        )}
      </defs>

      <rect x={0} y={0} width={canvasW} height={canvasH} fill="#020617" opacity={isGM ? 0.5 : 0.985} mask="url(#map-fog-mask)" />
      {dark && (
        <rect x={0} y={0} width={canvasW} height={canvasH} fill="#020617" opacity={isGM ? 0.45 : 0.9} mask="url(#map-dark-mask)" />
      )}
    </g>
  );
}
