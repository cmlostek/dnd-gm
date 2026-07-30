import { CONDITIONS } from '../../../../data/conditions';
import type { MapToken } from '../../mapStore';
import type { TokenResize, TokenResizePos } from '../types';

type Pt = { x: number; y: number };

/**
 * Tokens — the creatures/PCs on the board, with their owner-coloured ring,
 * emoji, name label, HP bar, condition chips, hover tooltip, deep-link focus
 * pulse, and (GM Edit tool) selection ring + resize handle.
 *
 * Phase 0 extraction, and the most coupled leaf: dragging and resizing write
 * MapBoard's transient state, so those start-gesture callbacks and
 * screenToLogical come in as props. Live drag position is already baked into
 * each token's x/y upstream in `visibleTokens`, so this only reads t.x/t.y.
 * CONDITIONS is static data, imported directly rather than passed.
 */
export default function TokensLayer({
  tokens,
  isGM,
  selectTool,
  editTool,
  zoom,
  focusTokenId,
  tokenResizePos,
  canDragToken,
  tokenColor,
  screenToLogical,
  onTokenDragStart,
  onTokenResizeStart,
  onRemoveToken,
}: {
  tokens: MapToken[];
  isGM: boolean;
  selectTool: boolean;
  editTool: boolean;
  zoom: number;
  focusTokenId: string | null;
  tokenResizePos: TokenResizePos | null;
  canDragToken: (t: MapToken) => boolean;
  tokenColor: (t: MapToken) => string;
  screenToLogical: (e: React.MouseEvent) => Pt;
  onTokenDragStart: (id: string, pos: Pt, offset: Pt) => void;
  onTokenResizeStart: (resize: TokenResize, pos: TokenResizePos) => void;
  /** Pre-gated: undefined when the viewer can't remove tokens. */
  onRemoveToken?: (id: string) => void;
}) {
  return (
    <>
      {tokens.map((t) => {
        const draggable = canDragToken(t) && selectTool;
        const resizable = isGM && editTool;
        const dispColor = tokenColor(t);
        const liveSize = tokenResizePos && tokenResizePos.id === t.id ? tokenResizePos.size : t.size;
        const r = liveSize / 2;
        const labelY = t.y + r + Math.max(10, 14 / zoom);
        const fontSize = Math.max(8, 11 / zoom);
        const handleR = Math.max(5, 8 / zoom);

        return (
          <g
            key={t.id}
            style={{ cursor: draggable ? 'grab' : 'default' }}
            onMouseDown={(e) => {
              if (!draggable) return;
              e.stopPropagation();
              const p = screenToLogical(e);
              onTokenDragStart(t.id, { x: t.x, y: t.y }, { x: p.x - t.x, y: p.y - t.y });
            }}
            onDoubleClick={isGM && onRemoveToken ? () => onRemoveToken(t.id) : undefined}
          >
            {/* Deep-link focus pulse — a ritual's "Map" button flags a token. */}
            {focusTokenId === t.id && (
              <circle cx={t.x} cy={t.y} r={r + 6 / zoom} fill="none" stroke="#fbbf24" strokeWidth={4 / zoom}>
                <animate attributeName="r" values={`${r + 4 / zoom};${r + 16 / zoom};${r + 4 / zoom}`} dur="1.1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="1;0.2;1" dur="1.1s" repeatCount="indefinite" />
              </circle>
            )}
            {/* Outer ring in owner's color */}
            <circle
              cx={t.x} cy={t.y} r={r + 2 / zoom}
              fill="none"
              stroke={dispColor}
              strokeWidth={3 / zoom}
              strokeDasharray={t.hidden_from_players ? `${6 / zoom} ${3 / zoom}` : undefined}
            />
            {/* Token body */}
            <circle cx={t.x} cy={t.y} r={r} fill={dispColor + '55'} stroke={dispColor} strokeWidth={1.5 / zoom} />
            {/* Emoji icon — dominantBaseline central centres it in the circle */}
            {t.emoji && (
              <text x={t.x} y={t.y} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.1} pointerEvents="none">
                {t.emoji}
              </text>
            )}
            {/* Name label */}
            <text
              x={t.x} y={labelY}
              textAnchor="middle"
              fontSize={fontSize}
              fill="#fafaf9"
              stroke="#0f172a"
              strokeWidth={3 / zoom}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {t.name}
            </text>
            {/* HP bar — below the name so the glyph stays unobstructed */}
            {(t.maxHp ?? 0) > 0 && (() => {
              const barW = r * 1.8;
              const barH = Math.max(2, 4 / zoom);
              const barX = t.x - barW / 2;
              const barY = labelY + Math.max(3, 4 / zoom);
              const pct = Math.max(0, Math.min(1, (t.hp ?? 0) / (t.maxHp ?? 1)));
              const fill = pct > 0.6 ? '#10b981' : pct > 0.25 ? '#f59e0b' : '#ef4444';
              return (
                <g pointerEvents="none">
                  <rect x={barX} y={barY} width={barW} height={barH} fill="#0f172a" opacity={0.7} rx={barH / 2} />
                  <rect x={barX} y={barY} width={barW * pct} height={barH} fill={fill} rx={barH / 2} />
                </g>
              );
            })()}
            {/* Condition icons in an arc above the token */}
            {(t.conditions ?? []).length > 0 && (() => {
              const chips = t.conditions ?? [];
              const chipR = Math.max(3, r * 0.18);
              const spacing = chipR * 2.4;
              const totalW = (chips.length - 1) * spacing;
              const startX = t.x - totalW / 2;
              const arcY = t.y - r - chipR * 1.4;
              return (
                <g pointerEvents="none">
                  {chips.map((slug, i) => {
                    const c = CONDITIONS.find((x) => x.index === slug);
                    const cx = startX + i * spacing;
                    const initial = (c?.name ?? slug).charAt(0).toUpperCase();
                    return (
                      <g key={slug}>
                        <circle cx={cx} cy={arcY} r={chipR} fill="#7f1d1d" stroke="#fda4af" strokeWidth={Math.max(0.5, 1 / zoom)} />
                        <text x={cx} y={arcY} textAnchor="middle" dominantBaseline="central" fontSize={chipR * 1.2} fill="#fef2f2" fontWeight="600">
                          {initial}
                        </text>
                        <title>{c?.name ?? slug}</title>
                      </g>
                    );
                  })}
                </g>
              );
            })()}
            {/* Hover tooltip: HP + conditions (works for non-editors too) */}
            {((t.maxHp ?? 0) > 0 || (t.conditions ?? []).length > 0) && (
              <title>
                {`${t.name}`}
                {(t.maxHp ?? 0) > 0 ? ` — HP ${t.hp ?? 0}/${t.maxHp ?? 0}` : ''}
                {(t.conditions ?? []).length > 0
                  ? ` — ${(t.conditions ?? []).map((s) => CONDITIONS.find((c) => c.index === s)?.name ?? s).join(', ')}`
                  : ''}
              </title>
            )}
            {/* Edit-tool selection ring + resize handle (GM only) */}
            {resizable && (
              <>
                <circle
                  cx={t.x} cy={t.y} r={r + 4 / zoom}
                  fill="none"
                  stroke="#0ea5e9"
                  strokeOpacity={0.6}
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                  pointerEvents="none"
                />
                <rect
                  x={t.x + r - handleR}
                  y={t.y + r - handleR}
                  width={handleR * 2}
                  height={handleR * 2}
                  fill="#0ea5e9"
                  stroke="#fafaf9"
                  strokeWidth={1 / zoom}
                  style={{ cursor: 'nwse-resize' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const p = screenToLogical(e);
                    onTokenResizeStart({ id: t.id, ox: p.x - t.x - r, oy: p.y - t.y - r }, { id: t.id, size: t.size });
                  }}
                />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
