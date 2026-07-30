import type { ImageLayer } from '../../mapStore';
import type { LayerDrag, LayerDragPos } from '../types';

/**
 * The stack of positioned images composing a scene (battlemat + overlays).
 *
 * Phase 0 extraction. Not fully pure — layer move/resize in the GM's Edit tool
 * needs to write MapBoard's drag state — so the setters and the coordinate
 * helper come in as props. Everything else (which layers exist, whether the
 * viewer is the GM, current tool, zoom) is passed down; no store access here.
 *
 * Hidden layers vanish for players but render at 25% for the GM so they can see
 * what's queued. Array order is z-order: earlier entries sit underneath.
 */
export default function ImageLayers({
  layers,
  isGM,
  editing,
  zoom,
  layerDragPos,
  screenToLogical,
  onLayerDragStart,
}: {
  layers: ImageLayer[];
  isGM: boolean;
  /** True when the GM's Edit tool is active (layers become draggable). */
  editing: boolean;
  zoom: number;
  layerDragPos: LayerDragPos | null;
  screenToLogical: (e: React.MouseEvent) => { x: number; y: number };
  onLayerDragStart: (drag: LayerDrag, pos: LayerDragPos) => void;
}) {
  return (
    <>
      {layers.map((layer) => {
        if (layer.hidden && !isGM) return null;
        const draggable = isGM && editing;
        const live = layerDragPos && layerDragPos.id === layer.id;
        const lx = live ? layerDragPos.x : layer.x;
        const ly = live ? layerDragPos.y : layer.y;
        const lw = live ? layerDragPos.w : layer.w;
        const lh = live ? layerDragPos.h : layer.h;
        const handleR = Math.max(6, 10 / zoom);
        return (
          <g key={layer.id}>
            <image
              href={layer.url}
              x={lx}
              y={ly}
              width={lw}
              height={lh}
              preserveAspectRatio="none"
              opacity={layer.hidden ? 0.25 : 1}
              transform={
                layer.rotation
                  ? `rotate(${layer.rotation} ${lx + lw / 2} ${ly + lh / 2})`
                  : undefined
              }
              pointerEvents={draggable ? 'all' : 'none'}
              style={{ cursor: draggable ? (live ? 'grabbing' : 'move') : 'default' }}
              onMouseDown={
                draggable
                  ? (e) => {
                      e.stopPropagation();
                      const p = screenToLogical(e);
                      onLayerDragStart(
                        { id: layer.id, mode: 'move', ox: p.x - layer.x, oy: p.y - layer.y },
                        { id: layer.id, x: layer.x, y: layer.y, w: layer.w, h: layer.h },
                      );
                    }
                  : undefined
              }
            />
            {draggable && (
              <>
                <rect
                  x={lx + lw - handleR}
                  y={ly + lh - handleR}
                  width={handleR * 2}
                  height={handleR * 2}
                  fill="#0ea5e9"
                  stroke="#fafaf9"
                  strokeWidth={1 / zoom}
                  style={{ cursor: 'nwse-resize' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const p = screenToLogical(e);
                    onLayerDragStart(
                      {
                        id: layer.id,
                        mode: 'resize',
                        ox: p.x - (layer.x + layer.w),
                        oy: p.y - (layer.y + layer.h),
                        startW: layer.w,
                        startH: layer.h,
                        startX: layer.x,
                        startY: layer.y,
                      },
                      { id: layer.id, x: layer.x, y: layer.y, w: layer.w, h: layer.h },
                    );
                  }}
                />
                <rect
                  x={lx}
                  y={ly}
                  width={lw}
                  height={lh}
                  fill="none"
                  stroke="#0ea5e9"
                  strokeOpacity={0.5}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                  strokeWidth={1 / zoom}
                  pointerEvents="none"
                />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
