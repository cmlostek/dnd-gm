/**
 * Square grid overlay, drawn as a tiled SVG pattern across the whole canvas.
 *
 * First extraction of the Phase 0 render decomposition (see the fog/vision
 * project plan). Pure and prop-driven — no store access, no shared state — so
 * it's a safe, behaviour-neutral lift out of the MapBoard monolith. Renders
 * inside MapBoard's pan/zoom <g>, so all coordinates are logical canvas units
 * and stroke widths divide by zoom to stay 1px on screen.
 */
export default function GridLayer({
  showGrid,
  gridSize,
  canvasW,
  canvasH,
  zoom,
}: {
  showGrid: boolean;
  gridSize: number;
  canvasW: number;
  canvasH: number;
  zoom: number;
}) {
  // Below ~4px cells the grid is just noise, so MapBoard's original guard is
  // preserved here.
  if (!showGrid || gridSize < 4) return null;
  return (
    <g>
      <defs>
        <pattern id="map-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
          <path
            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
            fill="none"
            stroke="#ffffff18"
            strokeWidth={1 / zoom}
          />
        </pattern>
      </defs>
      <rect x={0} y={0} width={canvasW} height={canvasH} fill="url(#map-grid)" pointerEvents="none" />
    </g>
  );
}
