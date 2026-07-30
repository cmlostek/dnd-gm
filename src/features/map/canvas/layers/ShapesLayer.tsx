import type { MapShape } from '../../mapStore';
import type { ShapeDrag, ShapeDragPos } from '../types';

type Pt = { x: number; y: number };

/**
 * Persisted AoE shapes (circle / square / cone) plus the dashed live preview
 * of the shape the GM is currently dragging out.
 *
 * Phase 0 extraction. Shape drag needs MapBoard's drag state, so the setter
 * (via onShapeDragStart) and the coordinate helper are props; double-click
 * removal is passed pre-gated (undefined when the viewer can't remove).
 */
export default function ShapesLayer({
  shapes,
  draggable,
  zoom,
  shapeDragPos,
  screenToLogical,
  onShapeDragStart,
  onRemoveShape,
  // Draft preview
  drawTool,
  drafting,
  draftEnd,
  draftColor,
}: {
  shapes: MapShape[];
  /** Shapes are grab-draggable only in the GM's Select tool. */
  draggable: boolean;
  zoom: number;
  shapeDragPos: ShapeDragPos | null;
  screenToLogical: (e: React.MouseEvent) => Pt;
  onShapeDragStart: (drag: ShapeDrag, pos: ShapeDragPos) => void;
  /** Pre-gated: undefined when the viewer can't remove shapes. */
  onRemoveShape?: (id: string) => void;
  /** The active draw tool, for rendering the in-progress draft. */
  drawTool: 'circle' | 'square' | 'cone' | null;
  drafting: Pt | null;
  draftEnd: Pt | null;
  draftColor: string;
}) {
  return (
    <>
      {shapes.map((s) => {
        const onDbl = onRemoveShape ? () => onRemoveShape(s.id) : undefined;
        const live = shapeDragPos && shapeDragPos.id === s.id;
        const lx = live ? shapeDragPos.x : s.x;
        const ly = live ? shapeDragPos.y : s.y;
        const onMouseDown = draggable
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              const p = screenToLogical(e);
              onShapeDragStart({ id: s.id, ox: p.x - s.x, oy: p.y - s.y }, { id: s.id, x: s.x, y: s.y });
            }
          : undefined;
        const cursor = draggable ? (live ? 'grabbing' : 'grab') : 'default';
        if (s.kind === 'circle') {
          return (
            <circle
              key={s.id} cx={lx} cy={ly} r={s.r}
              fill={s.color} stroke={s.color.slice(0, 7)} strokeWidth={2 / zoom}
              onDoubleClick={onDbl} onMouseDown={onMouseDown} style={{ cursor }}
            />
          );
        }
        if (s.kind === 'square') {
          return (
            <rect
              key={s.id} x={lx} y={ly} width={s.w} height={s.h}
              fill={s.color} stroke={s.color.slice(0, 7)} strokeWidth={2 / zoom}
              onDoubleClick={onDbl} onMouseDown={onMouseDown} style={{ cursor }}
            />
          );
        }
        if (s.kind === 'cone') {
          const len = Math.hypot(s.dx, s.dy);
          if (len === 0) return null;
          const ux = s.dx / len; const uy = s.dy / len;
          const px = -uy; const py = ux;
          const half = len / 2;
          const tipX = lx + s.dx; const tipY = ly + s.dy;
          return (
            <polygon
              key={s.id}
              points={`${lx},${ly} ${tipX + px * half},${tipY + py * half} ${tipX - px * half},${tipY - py * half}`}
              fill={s.color} stroke={s.color.slice(0, 7)} strokeWidth={2 / zoom}
              onDoubleClick={onDbl} onMouseDown={onMouseDown} style={{ cursor }}
            />
          );
        }
        return null;
      })}

      {/* Dashed preview of the shape being dragged out; cleared on mouseup. */}
      {drafting && draftEnd && drawTool && (() => {
        const dx = draftEnd.x - drafting.x;
        const dy = draftEnd.y - drafting.y;
        const dash = `${6 / zoom} ${4 / zoom}`;
        const sw = 2 / zoom;
        if (drawTool === 'circle') {
          const r = Math.hypot(dx, dy);
          return (
            <g pointerEvents="none">
              <circle
                cx={drafting.x} cy={drafting.y} r={r}
                fill={draftColor} fillOpacity={0.25} stroke={draftColor}
                strokeWidth={sw} strokeDasharray={dash}
              />
            </g>
          );
        }
        if (drawTool === 'square') {
          return (
            <g pointerEvents="none">
              <rect
                x={Math.min(drafting.x, draftEnd.x)}
                y={Math.min(drafting.y, draftEnd.y)}
                width={Math.abs(dx)} height={Math.abs(dy)}
                fill={draftColor} fillOpacity={0.25} stroke={draftColor}
                strokeWidth={sw} strokeDasharray={dash}
              />
            </g>
          );
        }
        // Cone: triangle from origin to cursor with a 60° spread (~SRD cone).
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const half = len * Math.tan((Math.PI / 180) * 30);
        const px = -uy * half;
        const py = ux * half;
        const ax = drafting.x + dx + px;
        const ay = drafting.y + dy + py;
        const bx = drafting.x + dx - px;
        const by = drafting.y + dy - py;
        return (
          <g pointerEvents="none">
            <polygon
              points={`${drafting.x},${drafting.y} ${ax},${ay} ${bx},${by}`}
              fill={draftColor} fillOpacity={0.25} stroke={draftColor}
              strokeWidth={sw} strokeDasharray={dash}
            />
          </g>
        );
      })()}
    </>
  );
}
