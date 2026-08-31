import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useMap, MAX_DAMAGE_LOG, type DamageLogEntry, type MapShape, type MapToken, type MapScene } from './mapStore';
import GridLayer from './canvas/layers/GridLayer';
import PingsLayer from './canvas/layers/PingsLayer';
import ImageLayers from './canvas/layers/ImageLayers';
import ShapesLayer from './canvas/layers/ShapesLayer';
import TokensLayer from './canvas/layers/TokensLayer';
import FogLayer from './canvas/layers/FogLayer';
import WallsLayer from './canvas/layers/WallsLayer';
import DoorsLayer, { type DoorHover } from './canvas/layers/DoorsLayer';
import LightsLayer from './canvas/layers/LightsLayer';
import type { LightArea } from './canvas/layers/FogLayer';
import { computeVisibility, cellsInVision, type Vec } from './vision/visibility';
import { weldedWallSegments, wallPoints, withWallPoints, resolveMovement } from './vision/walls';
import { DEFAULT_LIGHT_RADIUS, type MapWall } from './mapStore';
import type { LayerDrag, LayerDragPos, ShapeDrag, ShapeDragPos, TokenResize, TokenResizePos } from './canvas/types';
import { hpBarClass, hpPercent } from '../hpBar';
import { CONDITIONS } from '../../data/conditions';

/** Conditions allowed on map tokens — full SRD list minus Exhaustion, which
 *  needs a numeric tracker that doesn't fit the toggle UI. */
const TOKEN_CONDITIONS = CONDITIONS.filter((c) => c.index !== 'exhaustion');
import { useInitiativeStore } from '../initiative/initiativeStore';
import { useNpcStore } from '../npcs/npcStore';
import { useParty } from '../party/partyStore';
import { useSession } from '../session/sessionStore';
import { useStore } from '../../store';
import { supabase } from '../../lib/supabase';
import { userCollabColor } from '../notes/collabProvider';
import PageHeader from '../../components/PageHeader';
import { useVisibilityReload } from '../../hooks/useVisibilityReload';
import {
  MousePointer2,
  Ruler,
  Circle as CircleIcon,
  Square as SquareIcon,
  Triangle,
  User,
  Trash2,
  Grid3x3,
  ImagePlus,
  Eraser,
  Eye,
  EyeOff,
  Radio,
  Maximize2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  Heart,
  History,
  X,
  Layers,
  Film,
  Plus,
  Check,
  ArrowUp,
  ArrowDown,
  Pencil,
  Cloud,
  BrickWall,
  Lightbulb,
  DoorOpen,
  DoorClosed,
  Lock,
  LockOpen,
} from 'lucide-react';

type Tool = 'select' | 'ruler' | 'circle' | 'square' | 'cone' | 'token' | 'ping' | 'edit' | 'fog' | 'wall' | 'light';

// The map's controls are grouped into tabs; picking a tab shows that group's
// editable controls (its "context panel") and selects a sensible default tool.
type PanelTab = 'select' | 'shapes' | 'fog' | 'walls' | 'lights';
/** Which tab a given tool belongs under (drives the active-tab highlight). */
function tabForTool(t: Tool): PanelTab {
  if (t === 'circle' || t === 'square' || t === 'cone') return 'shapes';
  if (t === 'fog') return 'fog';
  if (t === 'wall') return 'walls';
  if (t === 'light') return 'lights';
  return 'select';
}
/** The default tool to activate when a tab is opened. */
function toolForTab(tab: PanelTab): Tool {
  switch (tab) {
    case 'shapes': return 'circle';
    case 'fog': return 'fog';
    case 'walls': return 'wall';
    case 'lights': return 'light';
    default: return 'select';
  }
}

type Ping = { id: string; x: number; y: number; color: string };
type Presence = { user_id: string; display_name: string; role: 'gm' | 'player' };

// Shape palette (semi-transparent)
const SHAPE_COLORS = ['#f59e0b80', '#10b98180', '#3b82f680', '#ef444480', '#a855f780'];

// Narrative range bands for the range ruler — cumulative radii in feet, mapped
// to logical units at 5 ft/cell. Tuned to common D&D reach breakpoints.
const RANGE_BANDS: { label: string; ft: number; color: string }[] = [
  { label: 'Very close', ft: 5,   color: '#4ade80' },
  { label: 'Close',      ft: 30,  color: '#38bdf8' },
  { label: 'Far',        ft: 60,  color: '#fbbf24' },
  { label: 'Very far',   ft: 120, color: '#f87171' },
];
const EMOJI_PRESETS = ['🧙', '🗡️', '🏹', '🛡️', '🐉', '👹', '🧌', '💀', '🐺', '🕷️', '👑', '🧚'];

// NPC.icon stores a Lucide icon key ("shield", "swords", …), not an emoji.
// The map token UI expects an actual emoji glyph, so translate when seeding
// a token from an NPC. Unknown keys fall back to the generic 🧙.
const NPC_ICON_TO_EMOJI: Record<string, string> = {
  user:     '🧙',
  crown:    '👑',
  skull:    '💀',
  shield:   '🛡️',
  swords:   '⚔️',
  book:     '📖',
  coins:    '💰',
  sparkles: '✨',
};

const uid = () => crypto.randomUUID();

type Member = { user_id: string; display_name: string; role: string; color?: string };

function appendDamageLog(
  prev: DamageLogEntry[] | undefined,
  delta: number,
  hp: number,
  by?: string,
): DamageLogEntry[] {
  const next: DamageLogEntry[] = [
    ...(prev ?? []),
    { ts: new Date().toISOString(), delta, hp, by },
  ];
  return next.length > MAX_DAMAGE_LOG ? next.slice(-MAX_DAMAGE_LOG) : next;
}

/** Token conditions chip strip + add-menu. Lives in the token list panel.
 *  Picks fold into MapToken.conditions and render as overlay chips on the
 *  token glyph in the SVG layer below. */
function TokenConditionsRow({
  conditions,
  onChange,
}: {
  conditions: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const remove = (slug: string) => onChange(conditions.filter((x) => x !== slug));
  const add = (slug: string) => {
    if (!conditions.includes(slug)) onChange([...conditions, slug]);
    setOpen(false);
  };
  const remaining = TOKEN_CONDITIONS.filter((c) => !conditions.includes(c.index));
  return (
    <div className="flex flex-wrap items-center gap-1 relative">
      {conditions.map((slug) => {
        const c = CONDITIONS.find((x) => x.index === slug);
        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded border border-rose-700 bg-rose-900/30 text-rose-200"
            title={c?.desc?.split('\n')[0]}
          >
            {c?.name ?? slug}
            <button
              onClick={() => remove(slug)}
              className="text-rose-300 hover:text-rose-100"
              title="Remove condition"
            >
              ×
            </button>
          </span>
        );
      })}
      {remaining.length > 0 && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded border border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Apply a condition"
          >
            + Cond
          </button>
          {open && (
            <div className="absolute z-30 top-full left-0 mt-1 bg-slate-950 border border-slate-700 rounded shadow-lg p-1 max-h-48 overflow-y-auto min-w-[140px]">
              {remaining.map((c) => (
                <button
                  key={c.index}
                  onClick={() => add(c.index)}
                  className="w-full text-left px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 rounded"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TokenHpRow({
  token,
  canEdit,
  actorId,
  onApply,
}: {
  token: MapToken;
  canEdit: boolean;
  actorId: string | undefined;
  onApply: (patch: Partial<MapToken>) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [delta, setDelta] = useState('');
  const hp = token.hp ?? 0;
  const maxHp = token.maxHp ?? 0;
  const pct = hpPercent(hp, maxHp);
  const barColor = hpBarClass(pct);

  const commitHp = (next: number) => {
    if (next === hp) return;
    onApply({
      hp: next,
      damageLog: appendDamageLog(token.damageLog, next - hp, next, actorId),
    });
  };

  const applyDelta = (sign: 1 | -1) => {
    const amount = Math.abs(parseInt(delta || '0', 10));
    if (!amount) return;
    const next = Math.max(0, hp + sign * amount);
    commitHp(next);
    setDelta('');
  };

  const log = token.damageLog ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
        <Heart size={10} className="text-rose-400 shrink-0" />
        {canEdit ? (
          <>
            <input
              type="number"
              value={hp}
              onChange={(e) => commitHp(parseInt(e.target.value || '0', 10))}
              className="w-12 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 font-mono text-[10px]"
            />
            <span className="text-slate-600">/</span>
            <input
              type="number"
              value={maxHp}
              onChange={(e) => onApply({ maxHp: Math.max(0, parseInt(e.target.value || '0', 10)) })}
              className="w-12 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 font-mono text-[10px]"
            />
          </>
        ) : (
          <span className="font-mono">
            {maxHp > 0 ? `${hp}/${maxHp}` : '—'}
          </span>
        )}
        {log.length > 0 && (
          <button
            onClick={() => setLogOpen((v) => !v)}
            className="ml-auto text-slate-500 hover:text-slate-200"
            title={`${log.length} HP change${log.length === 1 ? '' : 's'}`}
          >
            <History size={10} />
          </button>
        )}
      </div>
      {maxHp > 0 && (
        <div className="h-1 bg-slate-800 rounded overflow-hidden">
          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-1 pt-0.5">
          <button
            onClick={() => applyDelta(-1)}
            disabled={!delta}
            className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-900/60 text-rose-200 text-[10px] hover:bg-rose-900/60 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Apply as damage"
          >
            −
          </button>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyDelta(-1);
              if (e.key === '+' || (e.shiftKey && e.key === '=')) applyDelta(1);
            }}
            placeholder="dmg / heal"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 font-mono text-[10px] text-center"
          />
          <button
            onClick={() => applyDelta(1)}
            disabled={!delta}
            className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/60 text-emerald-200 text-[10px] hover:bg-emerald-900/60 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Apply as healing"
          >
            +
          </button>
        </div>
      )}
      {logOpen && log.length > 0 && (
        <ul className="text-[10px] text-slate-500 font-mono max-h-24 overflow-y-auto border-t border-slate-800 pt-1 space-y-0.5">
          {[...log].reverse().map((e, i) => {
            const t = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const sign = e.delta > 0 ? '+' : '';
            return (
              <li key={i} className="flex justify-between gap-2">
                <span className={e.delta < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {sign}
                  {e.delta}
                </span>
                <span>→ {e.hp}</span>
                <span className="text-slate-700">{t}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One row in the Scenes panel: shows the scene name, indicates which scene
 *  the GM is currently viewing (sky border) and which scene is "live" for
 *  players (emerald dot), and exposes rename / reorder / set-active /
 *  delete. Click the row to preview that scene in the GM's local view
 *  without changing what players see. */
type SceneRowProps = {
  scene: MapScene;
  index: number;
  lastIndex: number;
  isActive: boolean;
  isViewing: boolean;
  onView: () => void;
  onSetActive: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canDelete: boolean;
};

function SceneRow({
  scene,
  isActive,
  isViewing,
  onView,
  onSetActive,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
  canDelete,
}: SceneRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scene.name);
  // Keep the local draft in sync if the row's name changes from elsewhere
  // (realtime echo, another collaborator renaming). Only run when not
  // actively editing so we don't yank the user's typing out of the field.
  useEffect(() => {
    if (!editing) setDraft(scene.name);
  }, [scene.name, editing]);
  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== scene.name) onRename(trimmed);
    else setDraft(scene.name);
  };
  return (
    <div
      className={`rounded border px-1.5 py-1 text-xs ${
        isViewing ? 'bg-sky-950/40 border-sky-700' : 'bg-slate-900 border-slate-800'
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          onClick={onSetActive}
          title={isActive ? 'Players see this scene' : 'Make this the active scene (players will see it)'}
          className={isActive ? 'text-emerald-400' : 'text-slate-600 hover:text-emerald-400'}
        >
          {isActive ? <Check size={12} /> : <Radio size={11} />}
        </button>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(scene.name);
                setEditing(false);
              }
            }}
            className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 outline-none text-slate-200 min-w-0"
          />
        ) : (
          <button
            onClick={onView}
            className="flex-1 text-left truncate text-slate-200 hover:text-sky-200"
            title="Preview this scene in your view"
          >
            {scene.name}
          </button>
        )}
        <button
          onClick={() => (editing ? commit() : setEditing(true))}
          title="Rename"
          className="text-slate-600 hover:text-slate-300"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onMoveUp}
          disabled={!onMoveUp}
          title="Move up"
          className="text-slate-600 hover:text-slate-300 disabled:opacity-30"
        >
          <ArrowUp size={11} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={!onMoveDown}
          title="Move down"
          className="text-slate-600 hover:text-slate-300 disabled:opacity-30"
        >
          <ArrowDown size={11} />
        </button>
        <button
          onClick={onRemove}
          disabled={!canDelete}
          title={canDelete ? 'Delete scene' : 'At least one scene is required'}
          className="text-slate-600 hover:text-rose-400 disabled:opacity-30"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export default function MapBoard() {
  const campaignId = useSession((s) => s.campaignId);
  const userId = useSession((s) => s.userId);
  const role = useSession((s) => s.role);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const isGM = (role === 'gm' || role === 'cogm') && !viewAsPlayer;
  const displayName = useSession((s) => s.displayName);

  const state = useMap((s) => s.state);
  const scenes = useMap((s) => s.scenes);
  const tokens = useMap((s) => s.tokens);
  const mapLoaded = useMap((s) => s.loaded);
  const mapError = useMap((s) => s.error);
  const undo = useMap((s) => s.undo);
  const redo = useMap((s) => s.redo);
  const history = useMap((s) => s.history);
  const loadForCampaign = useMap((s) => s.loadForCampaign);
  const subscribe = useMap((s) => s.subscribe);
  const setSceneGridSize = useMap((s) => s.setSceneGridSize);
  const setSceneShowGrid = useMap((s) => s.setSceneShowGrid);
  const setSceneCanvas = useMap((s) => s.setSceneCanvas);
  const addScene = useMap((s) => s.addScene);
  const renameScene = useMap((s) => s.renameScene);
  const removeScene = useMap((s) => s.removeScene);
  const setActiveScene = useMap((s) => s.setActiveScene);
  const setGmPreviewScene = useMap((s) => s.setGmPreviewScene);
  const reorderScenesAction = useMap((s) => s.reorderScenes);
  const addLayer = useMap((s) => s.addLayer);
  const updateLayer = useMap((s) => s.updateLayer);
  const removeLayer = useMap((s) => s.removeLayer);
  const addShape = useMap((s) => s.addShape);
  const removeShape = useMap((s) => s.removeShape);
  const updateShape = useMap((s) => s.updateShape);
  const clearShapes = useMap((s) => s.clearShapes);
  const addToken = useMap((s) => s.addToken);
  const updateToken = useMap((s) => s.updateToken);
  const removeToken = useMap((s) => s.removeToken);
  const setFogEnabled = useMap((s) => s.setFogEnabled);
  const setSceneFogMode = useMap((s) => s.setFogMode);
  const paintFogLocal = useMap((s) => s.paintFogLocal);
  const commitFog = useMap((s) => s.commitFog);
  const clearFog = useMap((s) => s.clearFog);
  const addWall = useMap((s) => s.addWall);
  const updateWall = useMap((s) => s.updateWall);
  const removeWall = useMap((s) => s.removeWall);
  const clearWalls = useMap((s) => s.clearWalls);
  const addLight = useMap((s) => s.addLight);
  const updateLight = useMap((s) => s.updateLight);
  const removeLight = useMap((s) => s.removeLight);
  const clearLights = useMap((s) => s.clearLights);
  const setAmbientDark = useMap((s) => s.setAmbientDark);

  // The GM may stage a non-active scene by setting gm_preview_scene_id; their
  // local view follows that, while players always render the active scene.
  // If neither is set (fresh load mid-migration), fall back to the first
  // scene so the canvas isn't blank.
  const currentSceneId =
    (isGM ? state.gm_preview_scene_id : null) ?? state.active_scene_id ?? scenes[0]?.id ?? null;
  const currentScene = useMemo(
    () => scenes.find((s) => s.id === currentSceneId) ?? null,
    [scenes, currentSceneId],
  );
  const isPreviewing = isGM && state.gm_preview_scene_id && state.gm_preview_scene_id !== state.active_scene_id;
  const mapGridSize = currentScene?.grid_size ?? 50;
  const mapShowGrid = currentScene?.show_grid ?? true;
  const sceneShapes = currentScene?.shapes ?? [];
  const sceneLayers = currentScene?.layers ?? [];
  const canvasW = currentScene?.width ?? 2000;
  const canvasH = currentScene?.height ?? 1500;

  const svgRef = useRef<SVGSVGElement>(null);

  // ── Tool state ───────────────────────────────────────────────────────────
  const [tool, setTool] = useState<Tool>('select');
  // Fog brush settings (GM). Mode toggles paint-to-reveal vs paint-to-hide;
  // brush is the square side length in cells (1, 3, or 5).
  const [fogMode, setFogMode] = useState<'reveal' | 'hide'>('reveal');
  const [fogBrush, setFogBrush] = useState(3);
  const fogPaintingRef = useRef(false);
  // Radius applied to newly-placed lights.
  const [lightRadius, setLightRadius] = useState(DEFAULT_LIGHT_RADIUS);
  const [ruler, setRuler] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [drafting, setDrafting] = useState<{ x: number; y: number } | null>(null);
  // Live cursor position while drafting a shape — drives the dashed preview
  // so the GM can actually see what they're about to drop on the canvas.
  const [draftEnd, setDraftEnd] = useState<{ x: number; y: number } | null>(null);
  // Wall bend drag — the live-preview wall while dragging its midpoint handle
  // into a curve. Committed to the store (updateWall) on mouse-up.
  const [wallBend, setWallBend] = useState<MapWall | null>(null);
  // While pressing a wall vertex: which point, the grab screen point, and
  // whether the pointer has moved far enough to count as a drag (vs a click,
  // which instead starts extending the wall from that vertex).
  const wallEditRef = useRef<{ index: number; sx: number; sy: number; moved: boolean } | null>(null);
  // Extending a wall from one of its endpoints: a rubber-band segment follows
  // the cursor and each click appends a connected vertex until Esc/right-click.
  const [wallExtend, setWallExtend] = useState<{ wallId: string; end: 'start' | 'end'; cursor: { x: number; y: number } } | null>(null);
  // Shape drag state — { id, ox, oy } where ox/oy are the offsets from the
  // shape's anchor to the mouse-down point, so the shape doesn't snap to
  // the cursor on grab.
  const [shapeDrag, setShapeDrag] = useState<ShapeDrag | null>(null);
  const [shapeDragPos, setShapeDragPos] = useState<ShapeDragPos | null>(null);
  // Image-layer drag state. `mode` is either 'move' (translate x/y) or
  // 'resize' (grow w/h from the bottom-right corner). ox/oy is the offset
  // from the anchor point to the mouse-down so the layer doesn't snap to
  // the cursor on grab.
  const [layerDrag, setLayerDrag] = useState<LayerDrag | null>(null);
  const [layerDragPos, setLayerDragPos] = useState<LayerDragPos | null>(null);
  // Token resize state — the GM grabs the bottom-right of a token in Edit
  // mode to scale its diameter. We use the dominant axis (max of dx/dy) so
  // square-ish drags feel predictable; the token is a circle so width and
  // height are always equal.
  const [tokenResize, setTokenResize] = useState<TokenResize | null>(null);
  const [tokenResizePos, setTokenResizePos] = useState<TokenResizePos | null>(null);
  const [selectedShapeColor, setSelectedShapeColor] = useState(SHAPE_COLORS[0]);
  // Which controls tab is showing in the sidebar, and (within the Walls tab)
  // whether clicking a wall converts it to/from a doorway.
  const [panelTab, setPanelTab] = useState<PanelTab>('select');
  const [doorEditMode, setDoorEditMode] = useState(false);
  // Hovered doorway → styled tooltip (name + state), positioned at the cursor.
  const [doorHover, setDoorHover] = useState<DoorHover | null>(null);
  // Wall drawing/editing: snap vertices to the grid, or place them freehand.
  const [wallSnap, setWallSnap] = useState(true);
  // Currently-selected map element (for copy/paste/delete).
  const [selection, setSelection] = useState<{ kind: 'wall' | 'shape'; id: string } | null>(null);
  const clipboardRef = useRef<{ kind: 'wall' | 'shape'; data: MapWall | MapShape } | null>(null);
  // Dragging a light marker (GM). Committed to the store on mouse-up.
  const [lightDrag, setLightDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const lightDragRef = useRef<{ id: string } | null>(null);
  // Ruler mode: plain distance, or concentric range bands.
  const [rulerMode, setRulerMode] = useState<'distance' | 'range'>('distance');
  // True while a map image is uploading to Storage.
  const [imageUploading, setImageUploading] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenEmoji, setTokenEmoji] = useState('');
  // Optional creature template — when set, the next placed token seeds
  // hp/maxHp from this NPC's stat block. Cleared after manual edits.
  const [creatureHp, setCreatureHp] = useState<number | null>(null);
  const [creatureMaxHp, setCreatureMaxHp] = useState<number | null>(null);
  const [creatureSourceName, setCreatureSourceName] = useState<string | null>(null);
  const [draggingTokenId, setDraggingTokenId] = useState<string | null>(null);
  const [localDrag, setLocalDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [members, setMembers] = useState<Member[]>([]);

  // ── Pan / zoom ───────────────────────────────────────────────────────────
  // All token/shape coordinates are stored in logical canvas units.
  // The SVG renders a <g transform="translate(panX,panY) scale(zoom)"> wrapper
  // so everything scales consistently for all users.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  // Track whether we've performed the initial fit-to-screen (once per load).
  const didFitRef = useRef(false);

  // ── Touch support refs ────────────────────────────────────────────────────
  // Assigned every render so touch event handlers (attached once via
  // addEventListener) always read the latest values without stale closures.
  const zoomRef   = useRef(zoom);   zoomRef.current   = zoom;
  const panRef    = useRef(pan);    panRef.current    = pan;
  const localDragRef = useRef(localDrag); localDragRef.current = localDrag;
  const snapRef = useRef({ grid: mapShowGrid, size: mapGridSize });
  snapRef.current = { grid: mapShowGrid, size: mapGridSize };

  // Extra refs needed by touch token-placement and ping handlers
  const campaignIdRef  = useRef(campaignId);  campaignIdRef.current  = campaignId;
  const tokenNameRef   = useRef(tokenName);   tokenNameRef.current   = tokenName;
  const tokenEmojiRef  = useRef(tokenEmoji);  tokenEmojiRef.current  = tokenEmoji;
  const creatureHpRef    = useRef(creatureHp);    creatureHpRef.current    = creatureHp;
  const creatureMaxHpRef = useRef(creatureMaxHp); creatureMaxHpRef.current = creatureMaxHp;
  const sceneIdRef = useRef<string | null>(null); sceneIdRef.current = currentSceneId;

  type TouchMode = 'none' | 'pan' | 'pinch' | 'drag';
  const touchModeRef  = useRef<TouchMode>('none');
  const touchPinchRef = useRef({ dist: 1, zoom: 1, midX: 0, midY: 0, panX: 0, panY: 0 });
  const touchPanRef   = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const touchDragRef  = useRef({ tokenId: '', ox: 0, oy: 0 });

  // ── Presence / pings ─────────────────────────────────────────────────────
  const [pings, setPings] = useState<Ping[]>([]);
  const [viewers, setViewers] = useState<Presence[]>([]);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    const unsub = subscribe(campaignId);
    return unsub;
  }, [campaignId, loadForCampaign, subscribe]);

  // Initiative is loaded for sidebar ordering; the Initiative panel manages
  // it primarily but the map needs the rows to sort tokens by turn order.
  const loadInitiative = useInitiativeStore((s) => s.loadForCampaign);
  const subscribeInitiative = useInitiativeStore((s) => s.subscribe);
  useEffect(() => {
    if (!campaignId) return;
    loadInitiative(campaignId);
    return subscribeInitiative(campaignId);
  }, [campaignId, loadInitiative, subscribeInitiative]);

  // Player's claimed character (if any) — drives the "place your token"
  // affordance for non-GMs: name + HP/maxHp + the character's icon get
  // copied onto the token they drop on the map.
  const party = useParty((s) => s.party);
  const loadParty = useParty((s) => s.loadForCampaign);
  const subscribeParty = useParty((s) => s.subscribe);
  const updatePartyMember = useParty((s) => s.updatePartyMember);
  useEffect(() => {
    if (!campaignId) return;
    loadParty(campaignId);
    return subscribeParty(campaignId);
  }, [campaignId, loadParty, subscribeParty]);
  const myCharacter = useMemo(
    () => (userId ? party.find((p) => p.owner_user_id === userId) ?? null : null),
    [party, userId],
  );

  // NPCs and homebrew stat blocks both feed the "Add from creature" picker
  // so the GM can drop a token pre-seeded from existing source material
  // instead of typing everything by hand.
  const npcs = useNpcStore((s) => s.npcs);
  const loadNpcs = useNpcStore((s) => s.loadForCampaign);
  const subscribeNpcs = useNpcStore((s) => s.subscribe);
  useEffect(() => {
    if (!campaignId) return;
    loadNpcs(campaignId);
    return subscribeNpcs(campaignId);
  }, [campaignId, loadNpcs, subscribeNpcs]);
  const statBlocks = useStore((s) => s.statBlocks);

  type CreatureRow = {
    key: string;
    source: 'pc' | 'npc' | 'statblock';
    name: string;
    emoji: string;
    hp: number;
    maxHp: number;
  };
  // Combined, sorted creature list. Party PCs come first so the GM can drop
  // their tokens without re-typing names; NPCs and stat blocks follow. NPCs
  // without HP set yet still appear — the GM can edit on the token after
  // placing. Stat blocks use their `hp` as both current and max.
  const creatureRoster: CreatureRow[] = useMemo(() => {
    const rows: CreatureRow[] = [];
    for (const p of party) {
      rows.push({
        key: `pc:${p.id}`,
        source: 'pc',
        name: p.name,
        emoji: '🧝',
        hp: p.hp,
        maxHp: p.maxHp,
      });
    }
    for (const n of npcs) {
      const sb = n.statBlock ?? {};
      const maxHp = sb.hpMax ?? sb.hpCurrent ?? 0;
      const hp = sb.hpCurrent ?? maxHp;
      rows.push({
        key: `npc:${n.id}`,
        source: 'npc',
        name: n.name,
        emoji: NPC_ICON_TO_EMOJI[n.icon] ?? '🧙',
        hp,
        maxHp,
      });
    }
    for (const s of statBlocks) {
      // Scope to the active campaign if the stat block was filed under one.
      if (s.campaign && campaignId && s.campaign !== campaignId) continue;
      const hp = s.hp ?? 0;
      rows.push({
        key: `sb:${s.id}`,
        source: 'statblock',
        name: s.name,
        emoji: s.emoji || '📜',
        hp,
        maxHp: hp,
      });
    }
    // Stable order: PCs first (preserve party order), then NPCs and stat
    // blocks sorted alphabetically together.
    const partyRows = rows.filter((r) => r.source === 'pc');
    const rest = rows.filter((r) => r.source !== 'pc').sort((a, b) => a.name.localeCompare(b.name));
    return [...partyRows, ...rest];
  }, [party, npcs, statBlocks, campaignId]);

  useVisibilityReload(() => {
    if (campaignId) loadForCampaign(campaignId);
  });

  // ── Keyboard: space = pan mode ───────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setIsSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Transient map errors auto-dismiss so a one-off write hiccup doesn't leave a
  // scary banner stuck in the sidebar.
  useEffect(() => {
    if (!mapError) return;
    const t = setTimeout(() => useMap.setState({ error: null }), 6000);
    return () => clearTimeout(t);
  }, [mapError]);

  // One-shot heal: older scenes embedded their map image as a data-URL inside
  // the scene jsonb, so every edit rewrote megabytes and hit the DB statement
  // timeout. On load, the GM's client re-hosts any such layer to Storage and
  // swaps in the small public URL. Best-effort: a failure just leaves the
  // data-URL in place (it still renders) and retries next load.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!isGM || !campaignId || !mapLoaded || migratedRef.current) return;
    const targets: { sceneId: string; layer: { id: string; url: string; name: string; x: number; y: number; w: number; h: number; rotation: number; hidden: boolean } }[] = [];
    for (const s of useMap.getState().scenes) {
      for (const l of s.layers) if (typeof l.url === 'string' && l.url.startsWith('data:')) targets.push({ sceneId: s.id, layer: l });
    }
    if (targets.length === 0) return;
    migratedRef.current = true;
    void (async () => {
      for (const { sceneId, layer } of targets) {
        try {
          const blob = await (await fetch(layer.url)).blob();
          const ext = (blob.type.split('/')[1] ?? 'png').replace(/[^a-z0-9]/g, '') || 'png';
          const path = `${campaignId}/map/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from('note-images').upload(path, blob, { contentType: blob.type, upsert: false });
          if (error) continue;
          const url = supabase.storage.from('note-images').getPublicUrl(path).data.publicUrl;
          await updateLayer(sceneId, { ...layer, url });
        } catch { /* best effort — leave the data-URL layer as-is */ }
      }
    })();
  }, [isGM, campaignId, mapLoaded, updateLayer]);

  // ── Keyboard: undo/redo/copy/paste/delete (GM scene editing) ─────────────
  useEffect(() => {
    if (!isGM) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        if (wallExtend) { setWallExtend(null); return; }
        if (selection) { setSelection(null); return; }
      }
      if (!currentSceneId) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) void redo(currentSceneId);
        else void undo(currentSceneId);
        return;
      }
      if (mod && k === 'y') { e.preventDefault(); void redo(currentSceneId); return; }

      // Read live scene data from the store so this handler doesn't need to
      // close over (and re-bind on) every wall/grid change.
      const scene = useMap.getState().scenes.find((s) => s.id === currentSceneId);

      if (mod && k === 'c') {
        if (!selection) return;
        if (selection.kind === 'wall') {
          const w = scene?.walls.find((x) => x.id === selection.id);
          if (w) clipboardRef.current = { kind: 'wall', data: JSON.parse(JSON.stringify(w)) };
        }
        return;
      }
      if (mod && k === 'v') {
        const cb = clipboardRef.current;
        if (!cb) return;
        e.preventDefault();
        const off = scene?.grid_size || 50;
        if (cb.kind === 'wall') {
          const src = cb.data as MapWall;
          const shift = (p: { x: number; y: number }) => ({ x: p.x + off, y: p.y + off });
          const nw: MapWall = {
            ...src,
            id: uid(),
            x1: src.x1 + off, y1: src.y1 + off,
            x2: src.x2 + off, y2: src.y2 + off,
            cx: src.cx != null ? src.cx + off : undefined,
            cy: src.cy != null ? src.cy + off : undefined,
            points: src.points?.map(shift),
          };
          void addWall(currentSceneId, nw);
          setSelection({ kind: 'wall', id: nw.id });
          // Keep pasting to tile further copies.
          clipboardRef.current = { kind: 'wall', data: JSON.parse(JSON.stringify(nw)) };
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        if (selection.kind === 'wall') void removeWall(currentSceneId, selection.id);
        else void removeShape(currentSceneId, selection.id);
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isGM, currentSceneId, undo, redo, selection, wallExtend, addWall, removeWall, removeShape]);

  // Leaving wall-draw mode cancels any in-progress extension.
  useEffect(() => {
    if (tool !== 'wall' || doorEditMode) setWallExtend(null);
  }, [tool, doorEditMode]);

  // ── Fit content to screen ────────────────────────────────────────────────
  // Fits the bounding box of the canvas border PLUS every visible image
  // layer — image layers can extend past the canvas border now that the
  // canvas no longer auto-resizes to the image, so fitting just the canvas
  // leaves layers off-screen.
  const fitToScreen = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    let minX = 0;
    let minY = 0;
    let maxX = canvasW;
    let maxY = canvasH;
    for (const l of sceneLayers) {
      if (l.hidden && !isGM) continue;
      if (l.x < minX) minX = l.x;
      if (l.y < minY) minY = l.y;
      if (l.x + l.w > maxX) maxX = l.x + l.w;
      if (l.y + l.h > maxY) maxY = l.y + l.h;
    }
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const newZoom = Math.min(rect.width / contentW, rect.height / contentH) * 0.95;
    setPan({
      x: (rect.width - contentW * newZoom) / 2 - minX * newZoom,
      y: (rect.height - contentH * newZoom) / 2 - minY * newZoom,
    });
    setZoom(newZoom);
  }, [canvasW, canvasH, sceneLayers, isGM]);

  // Auto-fit when the canvas grows/shrinks (campaign load, first image upload).
  // Keyed on the canvas dimensions only — NOT on fitToScreen's identity, which
  // changes on every scene edit (adding a shape rebuilds sceneLayers). Without
  // this guard, drawing on the map re-ran the fit and snapped zoom/pan back.
  const fitRef = useRef(fitToScreen);
  fitRef.current = fitToScreen;
  const lastFitDims = useRef('');
  useEffect(() => {
    if (!canvasW || !canvasH) return;
    const key = `${canvasW}x${canvasH}`;
    if (lastFitDims.current === key) return;
    lastFitDims.current = key;
    const id = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(id);
  }, [canvasW, canvasH]);

  // ── Focus a token from a deep link (e.g. a ritual countdown's "Map" button
  //    navigates to /map?focusOwner=…&focusName=…). Centre the camera on the
  //    caster's token in the current scene and pulse it, then strip the params
  //    so a refresh doesn't re-trigger. Runs once per navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusOwner = searchParams.get('focusOwner');
  const focusName = searchParams.get('focusName');
  const [focusTokenId, setFocusTokenId] = useState<string | null>(null);
  const didFocusRef = useRef(false);
  useEffect(() => {
    if (didFocusRef.current) return;
    if (!mapLoaded) return;
    if (!focusOwner && !focusName) return;
    didFocusRef.current = true;

    const clearParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('focusOwner');
      next.delete('focusName');
      setSearchParams(next, { replace: true });
    };

    // Only tokens on the visible scene can be centred on.
    const pool = tokens.filter((t) =>
      t.scene_id ? t.scene_id === currentSceneId : currentSceneId === state.active_scene_id,
    );
    const match =
      (focusOwner ? pool.find((t) => t.owner_user_id === focusOwner) : undefined) ??
      (focusName ? pool.find((t) => t.name.trim().toLowerCase() === focusName.trim().toLowerCase()) : undefined) ??
      null;

    if (!match) { clearParams(); return; }
    setFocusTokenId(match.id);
    // Defer the centre one frame so the initial fit-to-screen has settled.
    requestAnimationFrame(() => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const z = Math.max(zoomRef.current, 1);
        setZoom(z);
        setPan({ x: rect.width / 2 - match.x * z, y: rect.height / 2 - match.y * z });
      }
      clearParams();
    });
    const timer = setTimeout(() => setFocusTokenId(null), 3600);
    return () => clearTimeout(timer);
  }, [mapLoaded, focusOwner, focusName, tokens, currentSceneId, state.active_scene_id, searchParams, setSearchParams]);

  // ── Coordinate helpers ───────────────────────────────────────────────────
  // Convert a pointer event's CSS-pixel position to logical canvas coordinates.
  const screenToLogical = (e: React.MouseEvent | MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
    };
  };

  const snap = (p: { x: number; y: number }) =>
    mapShowGrid && mapGridSize > 1
      ? {
          x: Math.round(p.x / mapGridSize) * mapGridSize,
          y: Math.round(p.y / mapGridSize) * mapGridSize,
        }
      : p;

  // ── Zoom via scroll wheel ─────────────────────────────────────────────────
  // factor > 1 = zoom in, factor < 1 = zoom out.
  // We keep the logical point under the cursor fixed during zoom by adjusting pan:
  //   panX_new = mouseX - (mouseX - panX_old) * factor
  // This works because factor == newZoom / oldZoom, and screenToLogical must equal
  // the same logical coords before and after.
  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => Math.max(0.05, Math.min(10, z * factor)));
      setPan((p) => ({
        x: mx - (mx - p.x) * factor,
        y: my - (my - p.y) * factor,
      }));
    },
    [],
  );

  // Attach wheel listener with { passive: false } so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Touch handlers (iPad: pinch-zoom, pan, token drag) ────────────────────
  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();

      if (e.touches.length >= 2) {
        // Two-finger gesture — start pinch+pan
        touchModeRef.current = 'pinch';
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        touchPinchRef.current = {
          dist: Math.max(1, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)),
          zoom: zoomRef.current,
          midX: (t0.clientX + t1.clientX) / 2 - rect.left,
          midY: (t0.clientY + t1.clientY) / 2 - rect.top,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
      } else {
        const t = e.touches[0];
        const lx = (t.clientX - rect.left - panRef.current.x) / zoomRef.current;
        const ly = (t.clientY - rect.top  - panRef.current.y) / zoomRef.current;

        // Ping tool: single tap broadcasts a ping
        if (tool === 'ping') {
          broadcastPingRef.current(lx, ly);
          return;
        }

        // Token tool: tap to place a new token. GMs place anything; players
        // place a single token seeded from their claimed character.
        if (tool === 'token') {
          const cId = campaignIdRef.current;
          if (!cId) return;
          const { grid, size } = snapRef.current;
          const sx = grid && size > 1 ? Math.round(lx / size) * size : lx;
          const sy = grid && size > 1 ? Math.round(ly / size) * size : ly;
          const sId = sceneIdRef.current;
          if (!sId) return;
          if (!isGM) {
            const mine = myCharacter;
            if (!mine) return;
            const already = useMap.getState().tokens.some((t) => t.owner_user_id === userId && t.scene_id === sId);
            if (already) return;
            void useMap.getState().addToken(cId, {
              scene_id: sId,
              name: mine.name,
              x: sx,
              y: sy,
              color: '#94a3b8',
              emoji: tokenEmojiRef.current || undefined,
              size: Math.max(30, size * 0.8),
              owner_user_id: userId,
              hidden_from_players: false,
              hp: mine.hp || undefined,
              maxHp: mine.maxHp || undefined,
            });
            return;
          }
          void useMap.getState().addToken(cId, {
            scene_id: sId,
            name: tokenNameRef.current || 'Token',
            x: sx,
            y: sy,
            color: '#94a3b8',
            emoji: tokenEmojiRef.current || undefined,
            size: Math.max(30, size * 0.8),
            owner_user_id: userId,
            hidden_from_players: false,
            hp: creatureHpRef.current ?? undefined,
            maxHp: creatureMaxHpRef.current ?? undefined,
          });
          return;
        }

        // Check for a draggable token under the touch point (select mode only)
        if (tool === 'select') {
          const toks = useMap.getState().tokens;
          const hit = [...toks].reverse().find((tok) => {
            const ok = isGM || (tok.owner_user_id === userId && !tok.hidden_from_players);
            // Slightly enlarged hit radius for finger-friendly targeting
            return ok && Math.hypot(lx - tok.x, ly - tok.y) <= tok.size / 2 + 10 / zoomRef.current;
          });
          if (hit) {
            touchModeRef.current = 'drag';
            touchDragRef.current = { tokenId: hit.id, ox: lx - hit.x, oy: ly - hit.y };
            setDraggingTokenId(hit.id);
            setLocalDrag({ id: hit.id, x: hit.x, y: hit.y });
            return;
          }
        }

        // Default: single-finger pan
        touchModeRef.current = 'pan';
        touchPanRef.current = {
          startX: t.clientX - rect.left,
          startY: t.clientY - rect.top,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
      }
    },
    [tool, isGM, userId],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();

      if (touchModeRef.current === 'pinch' && e.touches.length >= 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const { dist: sd, zoom: sz, midX, midY, panX, panY } = touchPinchRef.current;
        const d = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const newZoom = Math.max(0.05, Math.min(10, sz * (d / sd)));
        // Current midpoint between fingers (SVG-local CSS pixels)
        const cx = (t0.clientX + t1.clientX) / 2 - rect.left;
        const cy = (t0.clientY + t1.clientY) / 2 - rect.top;
        // Keep the logical point that was under the initial pinch centre fixed
        const lx = (midX - panX) / sz;
        const ly = (midY - panY) / sz;
        setZoom(newZoom);
        setPan({ x: cx - lx * newZoom, y: cy - ly * newZoom });

      } else if (touchModeRef.current === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        const { startX, startY, panX, panY } = touchPanRef.current;
        setPan({
          x: panX + (t.clientX - rect.left - startX),
          y: panY + (t.clientY - rect.top  - startY),
        });

      } else if (touchModeRef.current === 'drag' && e.touches.length === 1) {
        const t = e.touches[0];
        const lx = (t.clientX - rect.left - panRef.current.x) / zoomRef.current;
        const ly = (t.clientY - rect.top  - panRef.current.y) / zoomRef.current;
        const { tokenId, ox, oy } = touchDragRef.current;
        setLocalDrag({ id: tokenId, x: lx - ox, y: ly - oy });
      }
    },
    [],
  );

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      e.preventDefault();

      if (touchModeRef.current === 'drag') {
        const { tokenId } = touchDragRef.current;
        const drag = localDragRef.current;
        if (tokenId && drag) {
          // Snap to grid on commit (same as mouse drag)
          const { grid, size } = snapRef.current;
          const x = grid && size > 1 ? Math.round(drag.x / size) * size : drag.x;
          const y = grid && size > 1 ? Math.round(drag.y / size) * size : drag.y;
          void useMap.getState().updateToken(tokenId, { x, y });
        }
        setDraggingTokenId(null);
        setLocalDrag(null);
      }

      if (e.touches.length === 1) {
        // Lifting one finger during a pinch — continue as a single-finger pan
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const t = e.touches[0];
        touchModeRef.current = 'pan';
        touchPanRef.current = {
          startX: t.clientX - rect.left,
          startY: t.clientY - rect.top,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
      } else if (e.touches.length === 0) {
        touchModeRef.current = 'none';
      }
    },
    [],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('touchstart',  onTouchStart, { passive: false });
    svg.addEventListener('touchmove',   onTouchMove,  { passive: false });
    svg.addEventListener('touchend',    onTouchEnd,   { passive: false });
    svg.addEventListener('touchcancel', onTouchEnd,   { passive: false });
    return () => {
      svg.removeEventListener('touchstart',  onTouchStart);
      svg.removeEventListener('touchmove',   onTouchMove);
      svg.removeEventListener('touchend',    onTouchEnd);
      svg.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  // ── Presence channel ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId || !userId) return;
    const channel = supabase.channel(`map-presence:${campaignId}`, {
      config: { presence: { key: userId } },
    });
    presenceChannelRef.current = channel;

    channel.on('broadcast', { event: 'ping' }, (payload) => {
      const p = payload.payload as { id: string; x: number; y: number; color: string };
      setPings((curr) => [...curr, p]);
      window.setTimeout(() => setPings((curr) => curr.filter((x) => x.id !== p.id)), 2200);
    });

    channel.on('presence', { event: 'sync' }, () => {
      const s = channel.presenceState();
      const next: Presence[] = [];
      for (const userKey of Object.keys(s)) {
        const entries = s[userKey] as unknown as Array<{ user_id?: string; display_name?: string; role?: 'gm' | 'player' }>;
        const e = entries[0];
        if (!e?.user_id || !e?.display_name || !e?.role) continue;
        next.push({ user_id: e.user_id, display_name: e.display_name, role: e.role });
      }
      setViewers(next);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && role && displayName) {
        await channel.track({ user_id: userId, display_name: displayName, role });
      }
    });

    return () => {
      supabase.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, [campaignId, userId, role, displayName]);

  // ── Fetch campaign members ───────────────────────────────────────────────
  // Loaded for everyone (not just GMs) so player tokens can render in each
  // owner's chosen chat color, mirroring how their messages look.
  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      const { data } = await supabase
        .from('campaign_members')
        .select('user_id, display_name, role, color')
        .eq('campaign_id', campaignId);
      setMembers((data ?? []) as Member[]);
    })();
  }, [campaignId]);

  // ── Ping broadcast ────────────────────────────────────────────────────────
  const broadcastPing = (x: number, y: number) => {
    const channel = presenceChannelRef.current;
    if (!channel || !userId) return;
    const { color } = userCollabColor(userId);
    const ping: Ping = { id: crypto.randomUUID(), x, y, color };
    channel.send({ type: 'broadcast', event: 'ping', payload: ping });
    setPings((curr) => [...curr, ping]);
    window.setTimeout(() => setPings((curr) => curr.filter((x) => x.id !== ping.id)), 2200);
  };

  // Keep a stable ref so touch handlers can call broadcastPing without
  // needing it in their useCallback deps.
  const broadcastPingRef = useRef(broadcastPing);
  broadcastPingRef.current = broadcastPing;

  // ── Token drag logic ──────────────────────────────────────────────────────
  const canDragToken = (t: MapToken) =>
    isGM || (t.owner_user_id === userId && !t.hidden_from_players);

  const commitDrag = () => {
    if (draggingTokenId && localDrag) {
      updateToken(draggingTokenId, { x: localDrag.x, y: localDrag.y });
    }
    setDraggingTokenId(null);
    setLocalDrag(null);
  };

  useEffect(() => {
    const up = () => {
      isPanningRef.current = false;
      if (draggingTokenId) commitDrag();
      setDrafting(null);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingTokenId, localDrag]);

  // ── Mouse handlers ────────────────────────────────────────────────────────
  /** Paint the brush's square of cells at a logical point into local fog. */
  const paintFogAt = (p: { x: number; y: number }) => {
    if (!currentSceneId || !currentScene) return;
    const cell = currentScene.fog.cell || 50;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const r = Math.floor(fogBrush / 2);
    const maxCol = Math.ceil(canvasW / cell) - 1;
    const maxRow = Math.ceil(canvasH / cell) - 1;
    const cells: string[] = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const col = cx + dx;
        const row = cy + dy;
        if (col < 0 || row < 0 || col > maxCol || row > maxRow) continue;
        cells.push(`${col},${row}`);
      }
    }
    if (cells.length) paintFogLocal(currentSceneId, cells, fogMode === 'reveal');
  };

  // Nearest endpoint (first/last vertex) of any plain wall within `radius` of p.
  const nearestWallEndpoint = (
    p: { x: number; y: number },
    radius: number,
  ): { wallId: string; end: 'start' | 'end'; point: { x: number; y: number } } | null => {
    let best: { wallId: string; end: 'start' | 'end'; point: { x: number; y: number } } | null = null;
    let bestD = radius;
    for (const w of currentScene?.walls ?? []) {
      if (w.door) continue;
      const pts = wallPoints(w);
      const ends: [number, 'start' | 'end'][] = [[0, 'start'], [pts.length - 1, 'end']];
      for (const [idx, end] of ends) {
        const pt = pts[idx];
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < bestD) { bestD = d; best = { wallId: w.id, end, point: pt }; }
      }
    }
    return best;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (draggingTokenId) return;
    if (!campaignId) return;

    // Extending a wall: right-click (or Esc) finishes; left-click appends a
    // connected vertex at the cursor and keeps extending from the new end.
    if (wallExtend) {
      if (e.button === 2) { setWallExtend(null); return; }
      if (e.button === 0) {
        const p0 = screenToLogical(e);
        const g = mapGridSize || 50;
        const np = wallSnap ? { x: Math.round(p0.x / g) * g, y: Math.round(p0.y / g) * g } : { x: p0.x, y: p0.y };
        const wall = (currentScene?.walls ?? []).find((w) => w.id === wallExtend.wallId);
        if (wall && currentSceneId) {
          const pts = wallPoints(wall);
          const next = wallExtend.end === 'end' ? [...pts, np] : [np, ...pts];
          void updateWall(currentSceneId, withWallPoints(wall, next));
          setWallExtend({ ...wallExtend, cursor: np });
        }
        return;
      }
    }

    // Middle button or space+left → pan
    if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      return;
    }

    const p = screenToLogical(e);

    if (tool === 'ping') {
      broadcastPing(p.x, p.y);
      return;
    }

    // Ruler is available to everyone, not just the GM. Click-to-toggle: a
    // first click anchors the start, mousemove tracks the cursor, the next
    // click clears the ruler so it stops following you around.
    if (tool === 'ruler') {
      // Range mode drops (or re-drops) a fixed origin the bands radiate from;
      // distance mode toggles the measuring line on/off.
      if (rulerMode === 'range') setRuler({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      else if (ruler) setRuler(null);
      else setRuler({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      return;
    }

    // Token tool: GMs place freely; players can place a single token for
    // their claimed character (if any). Seeds name/HP from the character
    // sheet so the bar shows up immediately.
    if (tool === 'token') {
      if (!currentSceneId) return;
      const sp = snap(p);
      const tokenSize = Math.max(30, mapGridSize * 0.8);
      if (!isGM) {
        if (!myCharacter) return; // No claimed character to place.
        const alreadyHasToken = tokens.some(
          (t) => t.owner_user_id === userId && t.scene_id === currentSceneId,
        );
        if (alreadyHasToken) return; // One token per player per scene.
        void addToken(campaignId, {
          scene_id: currentSceneId,
          name: myCharacter.name,
          x: sp.x,
          y: sp.y,
          color: '#94a3b8',
          emoji: tokenEmoji || undefined,
          size: tokenSize,
          owner_user_id: userId,
          hidden_from_players: false,
          hp: myCharacter.hp || undefined,
          maxHp: myCharacter.maxHp || undefined,
        });
        return;
      }
      void addToken(campaignId, {
        scene_id: currentSceneId,
        name: tokenName || 'Token',
        x: sp.x,
        y: sp.y,
        color: '#94a3b8', // neutral default; overridden visually by owner color
        emoji: tokenEmoji || undefined,
        size: tokenSize,
        owner_user_id: userId,
        hidden_from_players: false,
        hp: creatureHp ?? undefined,
        maxHp: creatureMaxHp ?? undefined,
      });
      return;
    }

    if (!isGM) return;
    if (tool === 'fog') {
      fogPaintingRef.current = true;
      paintFogAt(p);
      return;
    }
    if (tool === 'wall') {
      const g = mapGridSize || 50;
      // Starting on (or near) an existing wall's endpoint continues THAT wall
      // rather than drawing a new one — so you don't have to hit the tiny
      // vertex handle exactly to connect.
      const near = nearestWallEndpoint(p, Math.max(16 / zoom, g * 0.4));
      if (near) {
        setWallExtend({ wallId: near.wallId, end: near.end, cursor: near.point });
        return;
      }
      setDrafting(wallSnap ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : { x: p.x, y: p.y });
      return;
    }
    if (tool === 'light') {
      if (currentSceneId) void addLight(currentSceneId, { id: uid(), x: p.x, y: p.y, radius: lightRadius });
      return;
    }
    if (tool === 'circle' || tool === 'square' || tool === 'cone') {
      setDrafting(p);
      return;
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
      return;
    }

    const p = screenToLogical(e);

    if (wallExtend) {
      // Rubber-band the pending extension segment toward the cursor.
      const g = mapGridSize || 50;
      const c = wallSnap ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : { x: p.x, y: p.y };
      setWallExtend({ ...wallExtend, cursor: c });
      return;
    }

    if (wallEditRef.current && wallBend) {
      // Below the drag threshold this press is still a (potential) click that
      // will start an extension on release — don't move the vertex yet.
      const ref = wallEditRef.current;
      if (!ref.moved) {
        if (Math.hypot(e.clientX - ref.sx, e.clientY - ref.sy) < 4) return;
        ref.moved = true;
      }
      // Drag a vertex to the (grid-snapped) cursor and keep the endpoints in
      // sync with the first/last point.
      const g = mapGridSize || 50;
      const idx = ref.index;
      const snapped = wallSnap ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : { x: p.x, y: p.y };
      const pts = wallPoints(wallBend).map((pt, i) => (i === idx ? snapped : pt));
      setWallBend(withWallPoints(wallBend, pts));
      return;
    }

    if (lightDragRef.current) {
      setLightDrag({ id: lightDragRef.current.id, x: p.x, y: p.y });
      return;
    }

    if (fogPaintingRef.current) {
      paintFogAt(p);
      return;
    }

    if (draggingTokenId) {
      const desired = { x: p.x - dragOffset.x, y: p.y - dragOffset.y };
      // Walls block tokens (slide-along), except a GM holding Alt walks through.
      const collide = wallSegs.length > 0 && !(isGM && e.altKey);
      let next: { x: number; y: number };
      if (collide) {
        // Resolve from the last committed drag position so fast drags across a
        // thin wall still get caught (incremental sweep, not one big jump).
        const from = localDrag && localDrag.id === draggingTokenId
          ? { x: localDrag.x, y: localDrag.y }
          : (() => {
              const t = tokens.find((x) => x.id === draggingTokenId);
              return t ? { x: t.x, y: t.y } : desired;
            })();
        next = resolveMovement(from, desired, wallSegs);
      } else {
        next = snap(desired);
      }
      setLocalDrag({ id: draggingTokenId, x: next.x, y: next.y });
      return;
    }
    if (ruler && tool === 'ruler' && rulerMode === 'distance') {
      setRuler({ ...ruler, x2: p.x, y2: p.y });
    }
    if (drafting) {
      if (tool === 'wall') {
        const g = mapGridSize || 50;
        setDraftEnd(wallSnap ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : { x: p.x, y: p.y });
      } else {
        setDraftEnd(p);
      }
    }
    if (shapeDrag) {
      setShapeDragPos({ id: shapeDrag.id, x: p.x - shapeDrag.ox, y: p.y - shapeDrag.oy });
    }
    if (tokenResize) {
      const tok = tokens.find((t) => t.id === tokenResize.id);
      if (!tok) return;
      // Drive the new diameter off the dominant axis from the token's
      // centre, minus the grab offset so the cursor stays anchored to the
      // exact pixel the user grabbed. Clamp to a sane minimum so a misclick
      // can't shrink the token to a single pixel and lose the handle.
      const dx = p.x - tok.x - tokenResize.ox;
      const dy = p.y - tok.y - tokenResize.oy;
      const newR = Math.max(10, Math.max(dx, dy));
      setTokenResizePos({ id: tokenResize.id, size: Math.round(newR * 2) });
      return;
    }
    if (layerDrag) {
      const layer = sceneLayers.find((l) => l.id === layerDrag.id);
      if (!layer) return;
      if (layerDrag.mode === 'move') {
        setLayerDragPos({
          id: layerDrag.id,
          x: p.x - layerDrag.ox,
          y: p.y - layerDrag.oy,
          w: layer.w,
          h: layer.h,
        });
      } else {
        // Resize from the bottom-right corner: top-left stays put, w/h grow
        // with the cursor (minus the grab offset). Clamp to a tiny minimum
        // so a misclick can't make the layer zero-sized and un-grabbable.
        const nw = Math.max(20, p.x - layerDrag.startX - layerDrag.ox);
        const nh = Math.max(20, p.y - layerDrag.startY - layerDrag.oy);
        setLayerDragPos({
          id: layerDrag.id,
          x: layerDrag.startX,
          y: layerDrag.startY,
          w: nw,
          h: nh,
        });
      }
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    if (wallEditRef.current) {
      const ref = wallEditRef.current;
      wallEditRef.current = null;
      const draft = wallBend;
      setWallBend(null);
      if (ref.moved) {
        // A real drag → commit the moved vertex.
        if (draft && currentSceneId) void updateWall(currentSceneId, draft);
      } else if (draft) {
        // A click (no drag) on the vertex → start extending from it.
        startExtend(draft, ref.index);
      }
      return;
    }
    if (lightDragRef.current) {
      const d = lightDrag;
      lightDragRef.current = null;
      if (d && currentSceneId) {
        const l = (currentScene?.lights ?? []).find((x) => x.id === d.id);
        if (l && (l.x !== d.x || l.y !== d.y)) void updateLight(currentSceneId, { ...l, x: d.x, y: d.y });
      }
      setLightDrag(null);
      return;
    }
    if (fogPaintingRef.current) {
      fogPaintingRef.current = false;
      if (currentSceneId) void commitFog(currentSceneId);
      return;
    }
    if (draggingTokenId) {
      commitDrag();
      return;
    }
    if (tokenResize && tokenResizePos) {
      void updateToken(tokenResize.id, { size: tokenResizePos.size });
      setTokenResize(null);
      setTokenResizePos(null);
      return;
    }
    if (layerDrag && layerDragPos && currentSceneId) {
      const original = sceneLayers.find((l) => l.id === layerDrag.id);
      if (original) {
        const moved = { ...original, x: layerDragPos.x, y: layerDragPos.y, w: layerDragPos.w, h: layerDragPos.h };
        void updateLayer(currentSceneId, moved);
      }
      setLayerDrag(null);
      setLayerDragPos(null);
      return;
    }
    if (shapeDrag && shapeDragPos && currentSceneId) {
      const original = sceneShapes.find((s) => s.id === shapeDrag.id);
      if (original) {
        // Translate the shape by the drag delta. Each kind anchors slightly
        // differently — circles/cones anchor at (x,y); squares at top-left.
        const dx = shapeDragPos.x - original.x;
        const dy = shapeDragPos.y - original.y;
        const moved: MapShape = { ...original, x: original.x + dx, y: original.y + dy };
        void updateShape(currentSceneId, moved);
      }
      setShapeDrag(null);
      setShapeDragPos(null);
      return;
    }
    if (tool === 'wall' && drafting && draftEnd && isGM && currentSceneId) {
      // Snapped endpoints; drop zero-length walls from a stray click.
      if (drafting.x !== draftEnd.x || drafting.y !== draftEnd.y) {
        void addWall(currentSceneId, {
          id: uid(),
          x1: drafting.x, y1: drafting.y,
          x2: draftEnd.x, y2: draftEnd.y,
        });
      }
      setDrafting(null);
      setDraftEnd(null);
      return;
    }
    if (drafting && isGM && currentSceneId) {
      const p = screenToLogical(e);
      const dx = p.x - drafting.x;
      const dy = p.y - drafting.y;
      let shape: MapShape | null = null;
      if (tool === 'circle') {
        const r = Math.hypot(dx, dy);
        if (r > 4) shape = { id: uid(), kind: 'circle', x: drafting.x, y: drafting.y, r, color: selectedShapeColor };
      } else if (tool === 'square') {
        if (Math.abs(dx) > 4 && Math.abs(dy) > 4) {
          shape = {
            id: uid(),
            kind: 'square',
            x: Math.min(drafting.x, p.x),
            y: Math.min(drafting.y, p.y),
            w: Math.abs(dx),
            h: Math.abs(dy),
            color: selectedShapeColor,
          };
        }
      } else if (tool === 'cone') {
        if (Math.hypot(dx, dy) > 4) {
          shape = { id: uid(), kind: 'cone', x: drafting.x, y: drafting.y, dx, dy, color: selectedShapeColor };
        }
      }
      if (shape) void addShape(currentSceneId, shape);
      setDrafting(null);
      setDraftEnd(null);
    }
  };

  // ── Image layer loading ───────────────────────────────────────────────────
  // Each upload becomes a positioned ImageLayer in the current scene. The
  // first layer in a fresh scene also resizes the canvas to match the image
  // (the classic "load a battlemap" behaviour); subsequent layers preserve
  // their natural size but drop in at the canvas centre so the GM can drag
  // them where they belong.
  const onLoadBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isGM || !currentSceneId || !campaignId) return;
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    const filename = f.name.replace(/\.[^.]+$/, '');
    const sceneId = currentSceneId;

    // Measure dimensions from a local object URL — no base64 needed.
    const objUrl = URL.createObjectURL(f);
    const img = new Image();
    img.onerror = () => URL.revokeObjectURL(objUrl);
    img.onload = () => {
      const w = img.naturalWidth || 1000;
      const h = img.naturalHeight || 1000;
      URL.revokeObjectURL(objUrl);

      // Upload to Storage and store only the public URL. Embedding the image
      // as a data-URL in the scene's jsonb made every wall/shape/light edit
      // rewrite megabytes, which hit the Postgres statement timeout ("canceling
      // statement due to statement timeout") and rolled back the edit.
      void (async () => {
        setImageUploading(true);
        try {
          const ext = (f.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          const path = `${campaignId}/map/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage
            .from('note-images')
            .upload(path, f, { contentType: f.type, upsert: false });
          if (error) { useMap.setState({ error: `Image upload failed: ${error.message}` }); return; }
          const url = supabase.storage.from('note-images').getPublicUrl(path).data.publicUrl;

          const isFirstLayer = (useMap.getState().scenes.find((s) => s.id === sceneId)?.layers.length ?? 0) === 0;
          if (isFirstLayer) {
            void setSceneCanvas(sceneId, w, h);
            void addLayer(sceneId, { url, name: filename || 'Background', x: 0, y: 0, w, h, rotation: 0, hidden: false });
          } else {
            void addLayer(sceneId, {
              url,
              name: filename || `Layer ${(useMap.getState().scenes.find((s) => s.id === sceneId)?.layers.length ?? 0) + 1}`,
              x: Math.round(canvasW / 2 - w / 2),
              y: Math.round(canvasH / 2 - h / 2),
              w, h, rotation: 0, hidden: false,
            });
          }
          requestAnimationFrame(fitToScreen);
        } finally {
          setImageUploading(false);
        }
      })();
    };
    img.src = objUrl;
  };

  // ── Computed values ───────────────────────────────────────────────────────
  const rulerDistance = ruler
    ? ((Math.hypot(ruler.x2 - ruler.x1, ruler.y2 - ruler.y1) / mapGridSize) * 5).toFixed(1)
    : '0';

  // Only render tokens that belong to whichever scene is currently visible
  // (the active scene for players, the previewed scene for the GM if set).
  // Tokens without a scene_id are legacy/in-flight rows from before scenes
  // existed and float in until they're cleaned up — show them only on the
  // active scene to avoid orphaning them.
  const visibleTokens = tokens
    .filter((t) => {
      if (t.scene_id) return t.scene_id === currentSceneId;
      return currentSceneId === state.active_scene_id;
    })
    .map((t) => {
      if (localDrag && localDrag.id === t.id) return { ...t, x: localDrag.x, y: localDrag.y };
      return t;
    });

  // Dynamic line of sight: one visibility polygon per party token (owned =
  // PC), unioned at render time into the fog mask. Computed from committed
  // token positions (not localDrag) so it recomputes on drag-end rather than
  // every mousemove — the O(endpoints×walls) cost isn't worth per-frame.
  // Deps are the specific fog fields (not the whole scene) so accumulating
  // explored cells below doesn't retrigger the LoS computation in a loop.
  const fogEnabled = currentScene?.fog.enabled ?? false;
  const sceneFogMode = currentScene?.fog.mode ?? 'manual';
  const walls = currentScene?.walls;
  // Plain sight-blockers vs doorways. Doors render for everyone (players see
  // and pass through them); plain walls stay GM-only.
  const plainWalls = useMemo(() => (walls ?? []).filter((w) => !w.door), [walls]);
  const doors = useMemo(() => (walls ?? []).filter((w) => !!w.door), [walls]);
  // Tessellated wall segments (curves sampled to lines) — one source for both
  // line of sight and token collision. An OPEN door is omitted so sight and
  // movement both flow through it; closed and locked doors still block. Outer
  // endpoints are welded (within ~0.5 cell) so a door meets its flanking walls
  // with no token-sized gap for sight/movement to leak through.
  const wallSegs = useMemo(
    () => weldedWallSegments((walls ?? []).filter((w) => !(w.door && w.door.open)), (mapGridSize || 50) * 0.5),
    [walls, mapGridSize],
  );
  // Press a vertex: pending until we know if it's a drag (move) or a click
  // (start extending the wall from that vertex — see onMouseUp).
  const onVertexDown = useCallback((wall: MapWall, index: number, e: React.MouseEvent) => {
    wallEditRef.current = { index, sx: e.clientX, sy: e.clientY, moved: false };
    setWallExtend(null);
    setWallBend(wall);
  }, []);
  // Click (not drag) on an endpoint vertex → start a connected extension from it.
  const startExtend = useCallback((wall: MapWall, index: number) => {
    const pts = wallPoints(wall);
    if (index !== 0 && index !== pts.length - 1) return; // only endpoints extend
    setWallExtend({ wallId: wall.id, end: index === 0 ? 'start' : 'end', cursor: pts[index] });
  }, []);
  // Drag a segment's midpoint handle: insert a new vertex there and drag it,
  // turning the wall into (or extending) a polyline. `segIndex` is the segment
  // between vertex segIndex and segIndex+1.
  const onSegmentInsert = useCallback((wall: MapWall, segIndex: number, e: React.MouseEvent) => {
    const pts = wallPoints(wall);
    const a = pts[segIndex];
    const b = pts[segIndex + 1];
    if (!a || !b) return;
    const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const next = [...pts.slice(0, segIndex + 1), at, ...pts.slice(segIndex + 1)];
    wallEditRef.current = { index: segIndex + 1, sx: e.clientX, sy: e.clientY, moved: true };
    setWallExtend(null);
    setWallBend(withWallPoints(wall, next));
  }, []);
  // Remove a vertex (alt/right-click); no-op if it would leave fewer than two.
  const onVertexRemove = useCallback((wall: MapWall, index: number) => {
    if (!currentSceneId) return;
    const pts = wallPoints(wall);
    if (pts.length <= 2) return;
    void updateWall(currentSceneId, withWallPoints(wall, pts.filter((_, i) => i !== index)));
  }, [currentSceneId, updateWall]);

  // ── Doorway helpers (GM only; map_scenes is GM-writable) ──────────────────
  const wallById = useCallback(
    (id: string) => (currentScene?.walls ?? []).find((w) => w.id === id) ?? null,
    [currentScene],
  );
  /** Turn a plain wall into a closed, unlocked doorway (or revert it). */
  const setWallIsDoor = useCallback((id: string, isDoor: boolean) => {
    const w = wallById(id);
    if (!w || !currentSceneId) return;
    if (isDoor && !w.door) void updateWall(currentSceneId, { ...w, door: { open: false, locked: false } });
    else if (!isDoor && w.door) { const { door: _drop, ...rest } = w; void updateWall(currentSceneId, rest); }
  }, [wallById, currentSceneId, updateWall]);
  const patchDoor = useCallback((id: string, patch: Partial<NonNullable<MapWall['door']>>) => {
    const w = wallById(id);
    if (!w || !w.door || !currentSceneId) return;
    void updateWall(currentSceneId, { ...w, door: { ...w.door, ...patch } });
  }, [wallById, currentSceneId, updateWall]);
  // Begin dragging a light marker (GM). Committed to the store on mouse-up.
  const onLightDown = useCallback((id: string) => {
    const l = (currentScene?.lights ?? []).find((x) => x.id === id);
    if (!l) return;
    lightDragRef.current = { id };
    setLightDrag({ id, x: l.x, y: l.y });
  }, [currentScene]);
  /** Canvas click on a door: toggle open/closed (locked doors don't budge). */
  const toggleDoorOpen = useCallback((id: string) => {
    const w = wallById(id);
    if (!w || !w.door || w.door.locked) return;
    patchDoor(id, { open: !w.door.open });
  }, [wallById, patchDoor]);
  const visionPolys = useMemo<Vec[][]>(() => {
    if (!fogEnabled || sceneFogMode !== 'dynamic') return [];
    const origins = tokens.filter((t) => {
      const onScene = t.scene_id ? t.scene_id === currentSceneId : currentSceneId === state.active_scene_id;
      return onScene && !!t.owner_user_id;
    });
    return origins.map((t) => computeVisibility({ x: t.x, y: t.y }, wallSegs, canvasW, canvasH));
  }, [fogEnabled, sceneFogMode, wallSegs, tokens, currentSceneId, state.active_scene_id, canvasW, canvasH]);

  // Explored memory: mark every fog cell whose centre falls inside the current
  // sight as "seen" so it stays dimly lit after the party moves on. Runs when
  // vision changes (token move / wall edit), reading the freshest explored set
  // from the store to avoid a stale closure; the store no-ops if nothing's new.
  const addExplored = useMap((s) => s.addExplored);
  useEffect(() => {
    if (!currentSceneId || !fogEnabled || sceneFogMode !== 'dynamic' || visionPolys.length === 0) return;
    const scene = useMap.getState().scenes.find((s) => s.id === currentSceneId);
    if (!scene) return;
    const seen = new Set(scene.fog.explored);
    const added = cellsInVision(visionPolys, scene.fog.cell || 50, canvasW, canvasH).filter(
      (k) => !seen.has(k),
    );
    if (added.length) void addExplored(currentSceneId, added);
  }, [visionPolys, fogEnabled, sceneFogMode, currentSceneId, canvasW, canvasH, addExplored]);

  // Light illumination areas (dark scenes only): each light's radius disc,
  // wall-bounded via its own visibility polygon. Only computed when it matters.
  const ambientDark = currentScene?.fog.ambientDark ?? false;
  const lights = currentScene?.lights;
  const lightAreas = useMemo<LightArea[]>(() => {
    if (!fogEnabled || sceneFogMode !== 'dynamic' || !ambientDark) return [];
    // Placed scene lights…
    const scene = (lights ?? []).map((l) => ({
      id: l.id,
      cx: l.x,
      cy: l.y,
      radius: l.radius,
      poly: computeVisibility({ x: l.x, y: l.y }, wallSegs, canvasW, canvasH),
    }));
    // …plus lights carried by tokens (torches / darkvision), which move with
    // them. Committed positions so this recomputes on drag-end, like sight.
    const carried = tokens
      .filter((t) => {
        const onScene = t.scene_id ? t.scene_id === currentSceneId : currentSceneId === state.active_scene_id;
        return onScene && (t.lightRadius ?? 0) > 0;
      })
      .map((t) => ({
        id: `tok-${t.id}`,
        cx: t.x,
        cy: t.y,
        radius: t.lightRadius as number,
        poly: computeVisibility({ x: t.x, y: t.y }, wallSegs, canvasW, canvasH),
      }));
    return [...scene, ...carried];
  }, [fogEnabled, sceneFogMode, ambientDark, wallSegs, lights, tokens, currentSceneId, state.active_scene_id, canvasW, canvasH]);

  // Sidebar order: match each token to an initiative combatant by name
  // (case-insensitive) and use that initiative as the sort key — highest
  // first, ties broken by turn_order so the in-encounter sequence is stable.
  // Tokens with no matching combatant fall to the end alphabetically.
  const combatants = useInitiativeStore((s) => s.combatants);
  const sidebarTokens = useMemo(() => {
    const byName = new Map<string, { initiative: number; turnOrder: number }>();
    for (const c of combatants) {
      byName.set(c.name.trim().toLowerCase(), { initiative: c.initiative, turnOrder: c.turnOrder });
    }
    return [...visibleTokens].sort((a, b) => {
      const ai = byName.get(a.name.trim().toLowerCase());
      const bi = byName.get(b.name.trim().toLowerCase());
      if (ai && bi) {
        if (bi.initiative !== ai.initiative) return bi.initiative - ai.initiative;
        return ai.turnOrder - bi.turnOrder;
      }
      if (ai) return -1;
      if (bi) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [visibleTokens, combatants]);

  // Get the display color for a token: when an owner is set, prefer their
  // chosen campaign color (matches their chat / cursor); fall back to the
  // deterministic collab hash if we haven't loaded members yet, then to the
  // token's stored color when there's no owner.
  const memberColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of members) if (r.color) m.set(r.user_id, r.color);
    return m;
  }, [members]);
  const tokenDisplayColor = (t: MapToken): string => {
    if (t.owner_user_id) {
      return memberColorById.get(t.owner_user_id) ?? userCollabColor(t.owner_user_id).color;
    }
    return t.color;
  };

  const toolButton = (t: Tool, Icon: React.ComponentType<{ size?: number }>, label: string, gmOnly = false) => {
    if (gmOnly && !isGM) return null;
    return (
      <button
        onClick={() => { setTool(t); setRuler(null); }}
        title={label}
        className={`p-2 rounded border ${
          tool === t
            ? 'bg-sky-900/40 border-sky-700 text-sky-200'
            : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`}
      >
        <Icon size={16} />
      </button>
    );
  };

  // Open a controls tab. Switching groups activates that group's default tool;
  // re-clicking the current group leaves the active sub-tool alone.
  const selectTab = (tab: PanelTab) => {
    setPanelTab(tab);
    if (tabForTool(tool) !== tab) { setTool(toolForTab(tab)); setRuler(null); }
  };

  // A tab button in the sidebar's grouped controls bar.
  const tabButton = (tab: PanelTab, Icon: React.ComponentType<{ size?: number }>, label: string, gmOnly = false) => {
    if (gmOnly && !isGM) return null;
    const active = panelTab === tab;
    return (
      <button
        onClick={() => selectTab(tab)}
        title={label}
        className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded text-[10px] border ${
          active
            ? 'bg-sky-900/40 border-sky-700 text-sky-200'
            : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`}
      >
        <Icon size={15} />
        {label}
      </button>
    );
  };

  const sceneHistory = currentSceneId ? history[currentSceneId] : undefined;
  const canUndo = !!sceneHistory && sceneHistory.undo.length > 0;
  const canRedo = !!sceneHistory && sceneHistory.redo.length > 0;

  // Cursor: space = grab (pan mode), drawing tools = crosshair, otherwise
  // default. Layers tool gets default cursor — the layer itself owns its
  // own cursor (move / nwse-resize) so the SVG underneath shouldn't insist
  // on crosshair.
  const svgCursor = isSpaceDown
    ? 'grab'
    : tool === 'ping' || (isGM && tool !== 'select' && tool !== 'edit')
    ? 'crosshair'
    : 'default';

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Map">
        {isGM && currentSceneId && (
          <>
            <label className={`px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1 ${imageUploading ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}>
              <ImagePlus size={14} /> {imageUploading ? 'Uploading…' : 'Add image'}
              <input type="file" accept="image/*" onChange={onLoadBg} disabled={imageUploading} className="hidden" />
            </label>
            <button
              onClick={() => void setSceneShowGrid(currentSceneId, !mapShowGrid)}
              className={`px-3 py-1.5 text-xs rounded flex items-center gap-1 ${
                mapShowGrid ? 'bg-sky-900/40 text-sky-200' : 'bg-slate-800 text-slate-300'
              }`}
            >
              <Grid3x3 size={14} /> Grid
            </button>
            <label className="text-xs text-slate-400 flex items-center gap-1">
              Cell
              <input
                type="number"
                min="1"
                value={mapGridSize}
                onChange={(e) => void setSceneGridSize(currentSceneId, Math.max(1, parseInt(e.target.value || '1', 10)))}
                className="w-14 bg-slate-900 border border-slate-800 rounded px-1 py-1 font-mono"
              />
              px
            </label>
            {isPreviewing && (
              <span className="px-2 py-1 text-[10px] uppercase tracking-wider rounded bg-amber-900/40 border border-amber-700 text-amber-200">
                Previewing (players see active)
              </span>
            )}
          </>
        )}
      </PageHeader>

      <div className="flex-1 min-h-0 flex">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-56 border-r border-slate-800 p-3 space-y-4 overflow-y-auto text-sm shrink-0">
          {/* ── Scenes ─────────────────────────────────────────────────── */}
          {isGM && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <Film size={11} /> Scenes
                </div>
                {campaignId && (
                  <button
                    onClick={() => void addScene(campaignId)}
                    title="Add scene"
                    className="text-slate-500 hover:text-emerald-300"
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {scenes.map((sc, i) => {
                  const isActive = state.active_scene_id === sc.id;
                  const isViewing = currentSceneId === sc.id;
                  return (
                    <SceneRow
                      key={sc.id}
                      scene={sc}
                      index={i}
                      lastIndex={scenes.length - 1}
                      isActive={isActive}
                      isViewing={isViewing}
                      onView={() => {
                        if (!campaignId) return;
                        // Clicking a scene previews it locally for the GM.
                        // Clicking the already-active scene clears any preview.
                        if (sc.id === state.active_scene_id) {
                          void setGmPreviewScene(campaignId, null);
                        } else {
                          void setGmPreviewScene(campaignId, sc.id);
                        }
                      }}
                      onSetActive={() => {
                        if (!campaignId) return;
                        void setActiveScene(campaignId, sc.id);
                        // Switching active scene cancels any stale preview.
                        if (state.gm_preview_scene_id) void setGmPreviewScene(campaignId, null);
                      }}
                      onRename={(name) => void renameScene(sc.id, name)}
                      onRemove={() => {
                        if (!campaignId) return;
                        if (scenes.length <= 1) return;
                        if (!confirm(`Delete scene "${sc.name}" and all its tokens?`)) return;
                        void removeScene(campaignId, sc.id);
                      }}
                      onMoveUp={
                        i === 0 || !campaignId
                          ? undefined
                          : () => {
                              const next = scenes.map((s) => s.id);
                              [next[i - 1], next[i]] = [next[i], next[i - 1]];
                              void reorderScenesAction(campaignId, next);
                            }
                      }
                      onMoveDown={
                        i === scenes.length - 1 || !campaignId
                          ? undefined
                          : () => {
                              const next = scenes.map((s) => s.id);
                              [next[i + 1], next[i]] = [next[i], next[i + 1]];
                              void reorderScenesAction(campaignId, next);
                            }
                      }
                      canDelete={scenes.length > 1}
                    />
                  );
                })}
                {scenes.length === 0 && (
                  <div className="text-[10px] text-slate-600 italic">
                    No scenes yet — click + to add one.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Layers (image stack for the current scene) ───────────── */}
          {isGM && currentScene && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                <Layers size={11} /> Layers ({sceneLayers.length})
              </div>
              <div className="space-y-1">
                {sceneLayers.map((layer) => (
                  <div
                    key={layer.id}
                    className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[11px]"
                  >
                    <button
                      onClick={() =>
                        void updateLayer(currentScene.id, { ...layer, hidden: !layer.hidden })
                      }
                      title={layer.hidden ? 'Show layer' : 'Hide layer'}
                      className={layer.hidden ? 'text-slate-600' : 'text-emerald-400'}
                    >
                      {layer.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <input
                      value={layer.name}
                      onChange={(e) => void updateLayer(currentScene.id, { ...layer, name: e.target.value })}
                      className="flex-1 bg-transparent outline-none min-w-0 text-slate-300"
                    />
                    <button
                      onClick={() => {
                        if (!confirm(`Remove layer "${layer.name}"?`)) return;
                        void removeLayer(currentScene.id, layer.id);
                      }}
                      className="text-slate-600 hover:text-rose-400"
                      title="Remove layer"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {sceneLayers.length === 0 && (
                  <div className="text-[10px] text-slate-600 italic">
                    No images yet — click <span className="text-slate-400">Add image</span> in the header.
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            {/* ── Grouped controls: a tab bar; each tab reveals its own panel ── */}
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Map controls</div>
            <div className="flex gap-1">
              {tabButton('select', MousePointer2, 'Play')}
              {tabButton('shapes', CircleIcon, 'Shapes', true)}
              {tabButton('fog', Cloud, 'Fog', true)}
              {tabButton('walls', BrickWall, 'Walls', true)}
              {tabButton('lights', Lightbulb, 'Lights', true)}
            </div>

            {/* Play tab: the interaction sub-tools everyone shares. */}
            {panelTab === 'select' && (
              <div className="mt-2 grid grid-cols-3 gap-1">
                {toolButton('select', MousePointer2, 'Select — drag tokens and shapes')}
                {toolButton('ping', Radio, 'Ping — click to flash a marker for everyone')}
                {toolButton('ruler', Ruler, 'Ruler (5 ft/cell)')}
                {toolButton('token', User, isGM ? 'Place token' : 'Place your character token')}
                {toolButton('edit', Layers, 'Edit images & tokens — drag to move, corner to resize', true)}
              </div>
            )}

            {/* Ruler sub-mode: plain distance vs. narrative range bands. */}
            {panelTab === 'select' && tool === 'ruler' && (
              <div className="mt-2">
                <div className="flex rounded overflow-hidden border border-slate-800">
                  {([['distance', 'Distance'], ['range', 'Range bands']] as const).map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => { setRulerMode(m); setRuler(null); }}
                      className={`flex-1 py-1 text-[11px] ${
                        rulerMode === m ? 'bg-slate-800 text-slate-100' : 'bg-slate-900 text-slate-400 hover:bg-slate-800/60'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-slate-600">
                  {rulerMode === 'range'
                    ? 'Click to drop range rings (very close / close / far / very far).'
                    : 'Click to start measuring; click again to clear.'}
                </div>
              </div>
            )}

            {/* Shapes tab: AoE sub-tools (colour picker lives in its own panel below). */}
            {panelTab === 'shapes' && isGM && (
              <div className="mt-2 grid grid-cols-3 gap-1">
                {toolButton('circle', CircleIcon, 'Circle AoE', true)}
                {toolButton('square', SquareIcon, 'Square AoE', true)}
                {toolButton('cone', Triangle, 'Cone AoE', true)}
              </div>
            )}

            {isGM && (
              <div className="flex gap-1 mt-2">
                <button
                  onClick={() => currentSceneId && void undo(currentSceneId)}
                  disabled={!canUndo}
                  title="Undo (Ctrl/Cmd+Z)"
                  className="flex-1 py-1.5 rounded border text-xs flex items-center justify-center gap-1 bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Undo2 size={13} /> Undo
                </button>
                <button
                  onClick={() => currentSceneId && void redo(currentSceneId)}
                  disabled={!canRedo}
                  title="Redo (Ctrl/Cmd+Shift+Z)"
                  className="flex-1 py-1.5 rounded border text-xs flex items-center justify-center gap-1 bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Redo2 size={13} /> Redo
                </button>
              </div>
            )}

            <div className="flex gap-1 mt-2">
              <button
                onClick={fitToScreen}
                title="Fit map to screen"
                className="flex-1 py-1.5 rounded border text-xs flex items-center justify-center gap-1 bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <Maximize2 size={13} /> Fit
              </button>
              <button
                onClick={() => setZoom((z) => Math.min(10, z * 1.25))}
                title="Zoom in"
                className="p-1.5 rounded border bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}
                title="Zoom out"
                className="p-1.5 rounded border bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
              >
                <ZoomOut size={14} />
              </button>
            </div>
            <div className="mt-1 text-[10px] text-slate-600 text-center">
              {Math.round(zoom * 100)}% · Hold Space+drag or scroll to zoom
            </div>
          </div>

          {!isGM && tool === 'token' && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-slate-500">Your token</div>
              {!myCharacter ? (
                <div className="text-[11px] text-slate-500 italic">
                  Claim a character on the Dashboard first to place your token.
                </div>
              ) : tokens.some((t) => t.owner_user_id === userId) ? (
                <div className="text-[11px] text-emerald-300">
                  {myCharacter.name} is already on the map. Switch to Select to move it.
                </div>
              ) : (
                <div className="text-[11px] text-slate-300">
                  Click the map to place <span className="text-sky-300 font-medium">{myCharacter.name}</span>
                  {' '}({myCharacter.hp}/{myCharacter.maxHp} HP).
                </div>
              )}
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Icon (optional)</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setTokenEmoji('')}
                    className={`w-7 h-7 rounded border text-xs ${
                      tokenEmoji === '' ? 'bg-slate-700 border-sky-600' : 'bg-slate-900 border-slate-800'
                    }`}
                  >—</button>
                  {EMOJI_PRESETS.map((em) => (
                    <button
                      key={em}
                      onClick={() => setTokenEmoji(em)}
                      className={`w-7 h-7 rounded border text-base leading-none ${
                        tokenEmoji === em ? 'bg-slate-700 border-sky-600' : 'bg-slate-900 border-slate-800'
                      }`}
                    >{em}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isGM && tool === 'token' && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-slate-500">Token</div>
              <input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Name"
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs"
              />
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Icon</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setTokenEmoji('')}
                    className={`w-7 h-7 rounded border text-xs ${
                      tokenEmoji === '' ? 'bg-slate-700 border-sky-600' : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    —
                  </button>
                  {EMOJI_PRESETS.map((em) => (
                    <button
                      key={em}
                      onClick={() => setTokenEmoji(em)}
                      className={`w-7 h-7 rounded border text-base leading-none ${
                        tokenEmoji === em ? 'bg-slate-700 border-sky-600' : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <input
                  value={tokenEmoji}
                  onChange={(e) => setTokenEmoji(e.target.value.slice(0, 2))}
                  placeholder="Custom emoji"
                  className="mt-1 w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs"
                />
              </div>
              <div className="text-[10px] text-slate-500 italic">
                Token color uses your profile color automatically.
              </div>

              {/* Creature picker: pull a stat-blocked NPC and seed the next
                  placed token from it. Clears as soon as the next token is
                  dropped via the touch path; the mouse path also reads the
                  current state value. */}
              <div className="border-t border-slate-800 pt-2 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Add from creature
                </div>
                {creatureSourceName && (
                  <div className="flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded px-2 py-1">
                    <span className="flex-1 truncate">
                      {creatureSourceName} · HP {creatureHp ?? '—'}/{creatureMaxHp ?? '—'}
                    </span>
                    <button
                      onClick={() => {
                        setCreatureSourceName(null);
                        setCreatureHp(null);
                        setCreatureMaxHp(null);
                      }}
                      className="text-slate-400 hover:text-rose-300"
                      title="Clear creature template"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}
                {creatureRoster.length === 0 ? (
                  <div className="text-[10px] text-slate-600 italic">
                    No NPCs or stat blocks yet — add one on the NPCs or Stat Blocks page.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {creatureRoster.map((row) => (
                      <button
                        key={row.key}
                        onClick={() => {
                          setTokenName(row.name);
                          setTokenEmoji(row.emoji);
                          setCreatureHp(row.hp || null);
                          setCreatureMaxHp(row.maxHp || null);
                          setCreatureSourceName(row.name);
                        }}
                        className="w-full text-left flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-slate-900 text-[11px] text-slate-300"
                      >
                        <span className="shrink-0 text-base leading-none">{row.emoji}</span>
                        <span className="flex-1 truncate">{row.name}</span>
                        <span
                          className="text-[9px] uppercase tracking-wider text-slate-600 shrink-0"
                          title={row.source === 'pc' ? 'From Party' : row.source === 'npc' ? 'From NPCs' : 'From Stat Blocks'}
                        >
                          {row.source === 'pc' ? 'pc' : row.source === 'npc' ? 'npc' : 'sb'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0 w-12 text-right">
                          {row.maxHp > 0 ? `${row.hp}/${row.maxHp}` : '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {isGM && panelTab === 'shapes' && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Shape color</div>
              <div className="flex flex-wrap gap-1">
                {SHAPE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedShapeColor(c)}
                    style={{ background: c }}
                    className={`w-5 h-5 rounded border-2 ${
                      selectedShapeColor === c ? 'border-white' : 'border-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {isGM && panelTab === 'fog' && currentScene && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-slate-500">Fog of war</div>
                <button
                  onClick={() => currentSceneId && void setFogEnabled(currentSceneId, !currentScene.fog.enabled)}
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    currentScene.fog.enabled
                      ? 'bg-sky-900/40 border-sky-700 text-sky-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {currentScene.fog.enabled ? 'On' : 'Off'}
                </button>
              </div>

              {!currentScene.fog.enabled ? (
                <div className="text-[11px] text-slate-500">
                  Turn fog on, then pick how it's driven. Players see black where it's hidden; you see a dim tint.
                </div>
              ) : (
                <>
                  {/* Manual paint vs dynamic line-of-sight */}
                  <div className="flex rounded overflow-hidden border border-slate-800">
                    {(['manual', 'dynamic'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => currentSceneId && void setSceneFogMode(currentSceneId, m)}
                        className={`flex-1 py-1 text-[11px] ${
                          currentScene.fog.mode === m ? 'bg-slate-800 text-slate-100' : 'bg-slate-900 text-slate-400 hover:bg-slate-800/60'
                        }`}
                      >
                        {m === 'manual' ? 'Paint by hand' : 'Line of sight'}
                      </button>
                    ))}
                  </div>

                  {currentScene.fog.mode === 'manual' ? (
                    <>
                      {/* Reveal vs hide */}
                      <div className="flex rounded overflow-hidden border border-slate-800">
                        {(['reveal', 'hide'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setFogMode(m)}
                            className={`flex-1 py-1 text-[11px] flex items-center justify-center gap-1 ${
                              fogMode === m ? 'bg-slate-800 text-slate-100' : 'bg-slate-900 text-slate-400 hover:bg-slate-800/60'
                            }`}
                          >
                            {m === 'reveal' ? <Eye size={12} /> : <EyeOff size={12} />}
                            {m === 'reveal' ? 'Reveal' : 'Hide'}
                          </button>
                        ))}
                      </div>

                      {/* Brush size */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">Brush</span>
                        <div className="flex gap-1">
                          {[1, 3, 5].map((b) => (
                            <button
                              key={b}
                              onClick={() => setFogBrush(b)}
                              className={`w-7 py-0.5 text-[11px] rounded border font-mono ${
                                fogBrush === b
                                  ? 'bg-sky-900/40 border-sky-700 text-sky-200'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                              }`}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => currentSceneId && void clearFog(currentSceneId)}
                        className="w-full py-1 text-[11px] rounded border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      >
                        Cover everything again
                      </button>
                      <div className="text-[10px] text-slate-600">
                        Drag on the map to {fogMode === 'reveal' ? 'reveal' : 're-hide'} squares.
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] text-slate-600 leading-relaxed">
                        Sight is cast from each party token against your walls ({currentScene.walls.length}). Draw walls with the Walls tool. Move a token to update what the party sees; seen areas stay dimly lit.
                      </div>
                      {currentScene.fog.explored.length > 0 && (
                        <button
                          onClick={() => currentSceneId && void clearFog(currentSceneId)}
                          className="w-full py-1 text-[11px] rounded border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        >
                          Reset exploration
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {isGM && panelTab === 'walls' && currentScene && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-slate-500">Walls & doors</div>
                <span className="text-[11px] text-slate-500 font-mono">
                  {plainWalls.length}w · {doors.length}d
                </span>
              </div>

              {/* Draw walls vs. assign doorways */}
              <div className="flex rounded overflow-hidden border border-slate-800">
                {([['draw', 'Draw walls'], ['doors', 'Edit doors']] as const).map(([m, label]) => {
                  const on = m === 'doors' ? doorEditMode : !doorEditMode;
                  return (
                    <button
                      key={m}
                      onClick={() => setDoorEditMode(m === 'doors')}
                      className={`flex-1 py-1 text-[11px] ${
                        on ? 'bg-slate-800 text-slate-100' : 'bg-slate-900 text-slate-400 hover:bg-slate-800/60'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Snap-to-grid vs freehand (drawing + vertex editing) */}
              {!doorEditMode && (
                <div className="flex rounded overflow-hidden border border-slate-800">
                  {([['snap', 'Snap to grid'], ['free', 'Freehand']] as const).map(([m, label]) => {
                    const on = m === 'free' ? !wallSnap : wallSnap;
                    return (
                      <button
                        key={m}
                        onClick={() => setWallSnap(m === 'snap')}
                        className={`flex-1 py-1 text-[11px] ${
                          on ? 'bg-slate-800 text-slate-100' : 'bg-slate-900 text-slate-400 hover:bg-slate-800/60'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="text-[11px] text-slate-500">
                {doorEditMode
                  ? 'Click a wall to turn it into a doorway; click a doorway to turn it back. Set each door’s name and lock below. Players see doors and can pass through open ones.'
                  : wallExtend
                    ? 'Extending: click to drop each connected point; right-click or Esc to finish.'
                    : `Drag to draw a wall (${wallSnap ? 'snaps to the grid' : 'freehand'}). Click an end vertex to continue the wall from it (drag a vertex to move). Drag a segment’s midpoint dot to add a bend; alt/right-click a vertex to remove it. Click a wall to select (Ctrl/Cmd+C/V copy-paste, Delete removes); double-click to delete.`}
              </div>

              {/* Per-door controls */}
              {doors.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-800 pt-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-600">Doors</div>
                  {doors.map((w, i) => {
                    const d = w.door!;
                    return (
                      <div key={w.id} className="bg-slate-900 border border-slate-800 rounded p-1.5 space-y-1">
                        <input
                          value={d.name ?? ''}
                          onChange={(e) => patchDoor(w.id, { name: e.target.value })}
                          placeholder={`Door ${i + 1} name`}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-sky-700"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => patchDoor(w.id, { open: !d.open })}
                            disabled={d.locked}
                            title={d.locked ? 'Unlock to open' : d.open ? 'Close door' : 'Open door'}
                            className={`flex-1 py-0.5 text-[10px] rounded border flex items-center justify-center gap-1 disabled:opacity-40 ${
                              d.open
                                ? 'bg-emerald-900/40 border-emerald-700 text-emerald-200'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            {d.open ? <DoorOpen size={11} /> : <DoorClosed size={11} />}
                            {d.open ? 'Open' : 'Closed'}
                          </button>
                          <button
                            onClick={() => patchDoor(w.id, { locked: !d.locked })}
                            title={d.locked ? 'Unlock' : 'Lock'}
                            className={`flex-1 py-0.5 text-[10px] rounded border flex items-center justify-center gap-1 ${
                              d.locked
                                ? 'bg-rose-900/40 border-rose-700 text-rose-200'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                            }`}
                          >
                            {d.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                            {d.locked ? 'Locked' : 'Unlocked'}
                          </button>
                          <button
                            onClick={() => setWallIsDoor(w.id, false)}
                            title="Remove doorway (back to a plain wall)"
                            className="px-1.5 py-0.5 text-[10px] rounded border border-slate-800 text-slate-500 hover:text-rose-300 hover:bg-slate-800"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {currentScene.walls.length > 0 && (
                <button
                  onClick={() => currentSceneId && void clearWalls(currentSceneId)}
                  className="w-full py-1 text-[11px] rounded border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  Clear all walls &amp; doors
                </button>
              )}
            </div>
          )}

          {isGM && panelTab === 'lights' && currentScene && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-slate-500">Lights</div>
                <span className="text-[11px] text-slate-500 font-mono">{currentScene.lights.length}</span>
              </div>

              {/* Scene darkness — lights only matter when the scene is dark */}
              <button
                onClick={() => currentSceneId && void setAmbientDark(currentSceneId, !currentScene.fog.ambientDark)}
                className={`w-full py-1 text-[11px] rounded border ${
                  currentScene.fog.ambientDark
                    ? 'bg-indigo-900/40 border-indigo-700 text-indigo-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {currentScene.fog.ambientDark ? 'Scene is dark' : 'Scene is lit (daylight)'}
              </button>

              {/* New-light radius */}
              <label className="flex items-center gap-2 text-[11px] text-slate-500">
                Radius
                <input
                  type="range"
                  min={40}
                  max={600}
                  step={10}
                  value={lightRadius}
                  onChange={(e) => setLightRadius(parseInt(e.target.value, 10))}
                  className="flex-1 accent-amber-500"
                />
                <span className="font-mono text-slate-400 w-9 text-right">{lightRadius}</span>
              </label>

              <div className="text-[10px] text-slate-600 leading-relaxed">
                {currentScene.fog.mode === 'dynamic'
                  ? currentScene.fog.ambientDark
                    ? 'Click to drop a light. In the dark the party sees only where their sight overlaps a light. Double-click a light to remove it.'
                    : 'Turn the scene dark (above) for lights to matter — in daylight, sight reveals everything.'
                  : 'Lights apply in Line-of-sight fog mode. Switch fog to Line of sight, then darken the scene.'}
              </div>

              {currentScene.lights.length > 0 && (
                <button
                  onClick={() => currentSceneId && void clearLights(currentSceneId)}
                  className="w-full py-1 text-[11px] rounded border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  Clear all lights
                </button>
              )}
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Tokens ({sidebarTokens.length})
            </div>
            <div className="space-y-1">
              {sidebarTokens.map((t) => {
                const dispColor = tokenDisplayColor(t);
                return (
                  <div
                    key={t.id}
                    className={`flex flex-col gap-1 text-xs bg-slate-900 border rounded px-2 py-1 ${
                      t.owner_user_id === userId && userId
                        ? 'border-emerald-700'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        style={{ background: dispColor }}
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0"
                      >
                        {t.emoji}
                      </div>
                      <input
                        value={t.name}
                        onChange={(e) => void updateToken(t.id, { name: e.target.value })}
                        readOnly={!isGM}
                        className="flex-1 bg-transparent outline-none min-w-0"
                      />
                      {isGM && (
                        <>
                          <button
                            onClick={() => void updateToken(t.id, { hidden_from_players: !t.hidden_from_players })}
                            title={t.hidden_from_players ? 'Hidden from players' : 'Visible to players'}
                            className={t.hidden_from_players ? 'text-slate-600' : 'text-emerald-500'}
                          >
                            {t.hidden_from_players ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                          <button
                            onClick={() => void removeToken(t.id)}
                            className="text-slate-600 hover:text-rose-400"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                    <TokenHpRow
                      token={t}
                      canEdit={isGM || (!!userId && t.owner_user_id === userId)}
                      actorId={userId ?? undefined}
                      onApply={(patch) => void updateToken(t.id, patch)}
                    />
                    {isGM && (
                      <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span className="uppercase tracking-wider">Size</span>
                        <input
                          type="number"
                          min={10}
                          step={1}
                          value={t.size}
                          onChange={(e) => {
                            const n = Math.max(10, parseInt(e.target.value || '0', 10) || 0);
                            if (n !== t.size) void updateToken(t.id, { size: n });
                          }}
                          className="w-14 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 font-mono text-[10px]"
                        />
                        <span className="text-slate-700">px</span>
                      </label>
                    )}
                    {isGM && (
                      <label
                        className="flex items-center gap-1.5 text-[10px] text-slate-500"
                        title="Light/vision radius — reveals a wall-bounded area around this token in a dark scene. 0 = none."
                      >
                        <span className="uppercase tracking-wider flex items-center gap-1">
                          <Lightbulb size={10} /> Light
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={t.lightRadius ?? 0}
                          onChange={(e) => {
                            const n = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                            if (n !== (t.lightRadius ?? 0)) void updateToken(t.id, { lightRadius: n });
                          }}
                          className="w-14 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 font-mono text-[10px]"
                        />
                        <span className="text-slate-700">px</span>
                      </label>
                    )}
                    {isGM && (
                      <select
                        value={t.owner_user_id ?? ''}
                        onChange={(e) => void updateToken(t.id, { owner_user_id: e.target.value || null })}
                        className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-400"
                      >
                        <option value="">Unassigned (GM only)</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.display_name} {m.role === 'gm' ? '(GM)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {(isGM || t.owner_user_id === userId) && (
                      <TokenConditionsRow
                        conditions={t.conditions ?? []}
                        onChange={(next) => {
                          void updateToken(t.id, { conditions: next });
                          // When the token is owned by a player who has a PC
                          // in this campaign, mirror conditions to the sheet
                          // so the player sees the same state on Vitals and
                          // the Party badge strip without manual re-entry.
                          const pc = t.owner_user_id
                            ? party.find((p) => p.owner_user_id === t.owner_user_id)
                            : null;
                          if (pc) void updatePartyMember(pc.id, { conditions: next });
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isGM && currentSceneId && sceneShapes.length > 0 && (
            <button
              onClick={() => void clearShapes(currentSceneId)}
              className="w-full px-2 py-1.5 text-xs bg-slate-800 hover:bg-rose-900 rounded flex items-center justify-center gap-1"
            >
              <Eraser size={12} /> Clear {sceneShapes.length} shape{sceneShapes.length === 1 ? '' : 's'}
            </button>
          )}

          {mapError && (
            <div className="flex items-start gap-1.5 text-[11px] text-rose-400 bg-rose-950/30 border border-rose-800/50 rounded p-2">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span className="flex-1 break-words">{mapError}</span>
              <button
                onClick={() => useMap.setState({ error: null })}
                title="Dismiss"
                className="shrink-0 text-rose-500 hover:text-rose-200"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </aside>

        {/* ── Canvas ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 relative bg-slate-950 overflow-hidden">
          {/* Ruler readout */}
          {ruler && tool === 'ruler' && rulerMode === 'distance' && (
            <div
              className="absolute top-3 left-3 z-10 px-3 py-1.5 bg-slate-950/80 border border-slate-700 rounded font-mono text-xs"
              style={{ color: 'var(--ac-200)' }}
            >
              {rulerDistance} ft
            </div>
          )}

          {/* Viewer avatar stack */}
          <div className="absolute top-3 right-3 z-10 flex -space-x-2">
            {viewers.map((v) => {
              const initials = (v.display_name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
              const isMe = v.user_id === userId;
              const { color } = userCollabColor(v.user_id);
              return (
                <div
                  key={v.user_id}
                  title={`${v.display_name}${v.role === 'gm' ? ' (GM)' : ''}${isMe ? ' — you' : ''}`}
                  className={`w-7 h-7 rounded-full border-2 border-slate-900 flex items-center justify-center text-[10px] font-semibold text-white ${isMe ? 'ring-2 ring-white' : ''}`}
                  style={{ backgroundColor: color }}
                >
                  {initials}
                </div>
              );
            })}
          </div>

          {/* Hint bar */}
          <div className="absolute bottom-3 left-3 z-10 text-[10px] text-slate-500 bg-slate-950/70 px-2 py-1 rounded">
            {tool === 'ping'
              ? 'Click anywhere to ping — everyone sees it flash.'
              : tool === 'edit' && isGM
              ? 'Drag image/token to move · Corner handle to resize · Switch to Select to drag tokens around the board'
              : isGM
              ? 'Double-click token/shape to remove · Dashed = hidden from players · Scroll to zoom · Space+drag to pan'
              : 'Drag your own token · Scroll to zoom · Space+drag to pan'}
          </div>

          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full select-none"
            style={{ cursor: svgCursor, touchAction: 'none' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onContextMenu={wallExtend ? (e) => e.preventDefault() : undefined}
          >
            {/* Everything inside this <g> is in logical canvas coordinates.
                All pan/zoom is handled by this single transform — tokens stored
                at (x, y) always appear at the same map location for every client,
                regardless of screen size or current zoom level. */}
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>

              {/* Canvas border / background */}
              <rect
                x={0} y={0}
                width={canvasW} height={canvasH}
                fill="#0f172a"
                stroke="#334155"
                strokeWidth={2 / zoom}
              />

              {/* Image layers — each one positioned independently inside the
                  scene. Hidden layers are skipped entirely for players, but
                  the GM sees them dimmed so they know what's queued up.
                  Layers render in array order, so earlier entries sit
                  underneath later ones. In select mode the GM can drag a
                  layer to reposition it and use the bottom-right handle to
                  resize. */}
              <ImageLayers
                layers={sceneLayers}
                isGM={isGM}
                editing={tool === 'edit'}
                zoom={zoom}
                layerDragPos={layerDragPos}
                screenToLogical={screenToLogical}
                onLayerDragStart={(drag, pos) => { setLayerDrag(drag); setLayerDragPos(pos); }}
              />

              {/* Grid overlay */}
              <GridLayer
                showGrid={mapShowGrid}
                gridSize={mapGridSize}
                canvasW={canvasW}
                canvasH={canvasH}
                zoom={zoom}
              />

              {/* Shapes + in-progress draft preview */}
              <ShapesLayer
                shapes={sceneShapes}
                draggable={isGM && tool === 'select'}
                zoom={zoom}
                shapeDragPos={shapeDragPos}
                screenToLogical={screenToLogical}
                onShapeDragStart={(drag, pos) => { setShapeDrag(drag); setShapeDragPos(pos); }}
                onRemoveShape={isGM && currentSceneId ? (id) => void removeShape(currentSceneId, id) : undefined}
                drawTool={tool === 'circle' || tool === 'square' || tool === 'cone' ? tool : null}
                drafting={drafting}
                draftEnd={draftEnd}
                draftColor={selectedShapeColor}
              />

              {/* Ruler — uses the viewer's dashboard accent so each player
                  sees their own colour for measurements. */}
              {ruler && tool === 'ruler' && rulerMode === 'distance' && (
                <g pointerEvents="none">
                  <line
                    x1={ruler.x1} y1={ruler.y1} x2={ruler.x2} y2={ruler.y2}
                    stroke="var(--ac-400)" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  />
                  <circle cx={ruler.x1} cy={ruler.y1} r={4 / zoom} fill="var(--ac-400)" />
                  <circle cx={ruler.x2} cy={ruler.y2} r={4 / zoom} fill="var(--ac-400)" />
                </g>
              )}

              {/* Range bands: concentric reach rings around a dropped origin. */}
              {ruler && tool === 'ruler' && rulerMode === 'range' && (
                <g pointerEvents="none">
                  {[...RANGE_BANDS].reverse().map((b) => {
                    const rr = (b.ft / 5) * mapGridSize;
                    return (
                      <g key={b.label}>
                        <circle
                          cx={ruler.x1} cy={ruler.y1} r={rr}
                          fill={b.color} fillOpacity={0.05}
                          stroke={b.color} strokeOpacity={0.7}
                          strokeWidth={1.5 / zoom}
                          strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                        />
                        <text
                          x={ruler.x1} y={ruler.y1 - rr - 3 / zoom}
                          textAnchor="middle"
                          fontSize={11 / zoom}
                          fill={b.color}
                          stroke="#020617" strokeWidth={3 / zoom} paintOrder="stroke"
                        >
                          {b.label} · {b.ft} ft
                        </text>
                      </g>
                    );
                  })}
                  <circle cx={ruler.x1} cy={ruler.y1} r={4 / zoom} fill="var(--ac-400)" />
                </g>
              )}

              {/* Tokens */}
              <TokensLayer
                tokens={visibleTokens}
                isGM={isGM}
                selectTool={tool === 'select'}
                editTool={tool === 'edit'}
                zoom={zoom}
                focusTokenId={focusTokenId}
                tokenResizePos={tokenResizePos}
                canDragToken={canDragToken}
                tokenColor={tokenDisplayColor}
                screenToLogical={screenToLogical}
                onTokenDragStart={(id, pos, offset) => {
                  setDraggingTokenId(id);
                  setLocalDrag({ id, x: pos.x, y: pos.y });
                  setDragOffset(offset);
                }}
                onTokenResizeStart={(resize, pos) => { setTokenResize(resize); setTokenResizePos(pos); }}
                onRemoveToken={isGM ? (id) => void removeToken(id) : undefined}
              />

              {/* Manual fog — above tokens so it covers them, below pings */}
              {currentScene && (
                <FogLayer
                  fog={currentScene.fog}
                  isGM={isGM}
                  canvasW={canvasW}
                  canvasH={canvasH}
                  visionPolys={visionPolys}
                  lightAreas={lightAreas}
                />
              )}

              {/* Light markers — GM only, above fog */}
              {isGM && currentScene && (
                <LightsLayer
                  lights={currentScene.lights}
                  zoom={zoom}
                  onRemoveLight={currentSceneId ? (id) => void removeLight(currentSceneId, id) : undefined}
                  onLightDown={onLightDown}
                  dragId={lightDrag?.id ?? null}
                  dragPos={lightDrag}
                />
              )}

              {/* Plain walls — GM only, above fog so they stay visible while editing */}
              {isGM && currentScene && (
                <WallsLayer
                  walls={wallBend
                    ? plainWalls.map((w) => (w.id === wallBend.id ? wallBend : w))
                    : plainWalls}
                  zoom={zoom}
                  showHandles={tool === 'wall' && !doorEditMode}
                  draftStart={tool === 'wall' ? drafting : null}
                  draftEnd={tool === 'wall' ? draftEnd : null}
                  onRemoveWall={currentSceneId ? (id) => void removeWall(currentSceneId, id) : undefined}
                  onVertexDown={onVertexDown}
                  onSegmentInsert={onSegmentInsert}
                  onVertexRemove={onVertexRemove}
                  onWallClick={
                    doorEditMode && panelTab === 'walls'
                      ? (id) => setWallIsDoor(id, true)
                      : (id) => setSelection({ kind: 'wall', id })
                  }
                  selectedId={selection?.kind === 'wall' ? selection.id : null}
                />
              )}

              {/* Plain walls — read-only grey lines for players (no dots/handles). */}
              {!isGM && currentScene && plainWalls.length > 0 && (
                <WallsLayer
                  walls={plainWalls}
                  zoom={zoom}
                  showHandles={false}
                  draftStart={null}
                  draftEnd={null}
                  stroke="#94a3b8"
                  showEndpoints={false}
                />
              )}

              {/* Rubber-band preview of a wall being extended from a vertex. */}
              {isGM && wallExtend && (() => {
                const wall = (currentScene?.walls ?? []).find((w) => w.id === wallExtend.wallId);
                if (!wall) return null;
                const pts = wallPoints(wall);
                const anchor = wallExtend.end === 'end' ? pts[pts.length - 1] : pts[0];
                return (
                  <g pointerEvents="none">
                    <line
                      x1={anchor.x} y1={anchor.y} x2={wallExtend.cursor.x} y2={wallExtend.cursor.y}
                      stroke="#fb7185" strokeWidth={3 / zoom} strokeLinecap="round"
                      strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                    />
                    <circle cx={wallExtend.cursor.x} cy={wallExtend.cursor.y} r={4 / zoom} fill="#fecdd3" />
                  </g>
                );
              })()}

              {/* Doorways — visible to everyone (players see state + pass through
                  open doors). GM clicking a door toggles open/closed, or removes
                  the doorway while in door-edit mode. */}
              {currentScene && doors.length > 0 && (
                <DoorsLayer
                  doors={wallBend ? doors.map((w) => (w.id === wallBend.id ? wallBend : w)) : doors}
                  zoom={zoom}
                  isGM={isGM}
                  onToggleOpen={
                    isGM
                      ? (doorEditMode && panelTab === 'walls' ? (id) => setWallIsDoor(id, false) : toggleDoorOpen)
                      : undefined
                  }
                  onHover={setDoorHover}
                  onHoverEnd={() => setDoorHover(null)}
                />
              )}

              {/* Ping pulses */}
              <PingsLayer pings={pings} zoom={zoom} />
            </g>
          </svg>
        </div>
      </div>

      {/* Doorway hover card — a small styled tooltip (not the native title box). */}
      {doorHover && createPortal(
        (() => {
          const W = 168;
          const left = Math.min(doorHover.x + 14, window.innerWidth - W - 8);
          const top = Math.max(8, doorHover.y - 12);
          const statusColor = doorHover.locked ? '#fca5a5' : doorHover.open ? '#86efac' : '#fcd34d';
          const StatusIcon = doorHover.locked ? Lock : doorHover.open ? DoorOpen : DoorClosed;
          return (
            <div
              style={{ position: 'fixed', top, left, width: W, zIndex: 9999, pointerEvents: 'none' }}
              className="rounded-lg border border-slate-700 bg-slate-900/95 shadow-xl px-3 py-2"
            >
              <div className="text-sm font-serif text-slate-100 truncate">{doorHover.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: statusColor }}>
                <StatusIcon size={12} />
                {doorHover.locked ? 'Locked' : doorHover.open ? 'Open' : 'Closed'}
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
