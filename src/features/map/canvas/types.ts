/**
 * Shared transient-interaction types for the map canvas.
 *
 * These describe in-flight drag gestures — state that lives in MapBoard but is
 * read/produced by the extracted layer components. Kept in one place so the
 * layers and the orchestrator can't drift out of sync as Phase 0 proceeds.
 */

/** An image layer being moved or resized by its corner handle. */
export type LayerDrag =
  | { id: string; mode: 'move'; ox: number; oy: number }
  | {
      id: string;
      mode: 'resize';
      ox: number;
      oy: number;
      startW: number;
      startH: number;
      startX: number;
      startY: number;
    };

/** Live position/size of the layer currently being dragged (preview before commit). */
export type LayerDragPos = { id: string; x: number; y: number; w: number; h: number };

/** A shape being dragged. */
export type ShapeDrag = { id: string; ox: number; oy: number };

/** Live position of the shape currently being dragged. */
export type ShapeDragPos = { id: string; x: number; y: number };
