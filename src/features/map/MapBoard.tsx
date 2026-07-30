import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMap, MAX_DAMAGE_LOG, type DamageLogEntry, type MapShape, type MapToken, type MapScene } from './mapStore';
import GridLayer from './canvas/layers/GridLayer';
import PingsLayer from './canvas/layers/PingsLayer';
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
} from 'lucide-react';

type Tool = 'select' | 'ruler' | 'circle' | 'square' | 'cone' | 'token' | 'ping' | 'edit';

type Ping = { id: string; x: number; y: number; color: string };
type Presence = { user_id: string; display_name: string; role: 'gm' | 'player' };

// Shape palette (semi-transparent)
const SHAPE_COLORS = ['#f59e0b80', '#10b98180', '#3b82f680', '#ef444480', '#a855f780'];
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
  const [ruler, setRuler] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [drafting, setDrafting] = useState<{ x: number; y: number } | null>(null);
  // Live cursor position while drafting a shape — drives the dashed preview
  // so the GM can actually see what they're about to drop on the canvas.
  const [draftEnd, setDraftEnd] = useState<{ x: number; y: number } | null>(null);
  // Shape drag state — { id, ox, oy } where ox/oy are the offsets from the
  // shape's anchor to the mouse-down point, so the shape doesn't snap to
  // the cursor on grab.
  const [shapeDrag, setShapeDrag] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [shapeDragPos, setShapeDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  // Image-layer drag state. `mode` is either 'move' (translate x/y) or
  // 'resize' (grow w/h from the bottom-right corner). ox/oy is the offset
  // from the anchor point to the mouse-down so the layer doesn't snap to
  // the cursor on grab.
  const [layerDrag, setLayerDrag] = useState<
    | { id: string; mode: 'move'; ox: number; oy: number }
    | { id: string; mode: 'resize'; ox: number; oy: number; startW: number; startH: number; startX: number; startY: number }
    | null
  >(null);
  const [layerDragPos, setLayerDragPos] = useState<
    { id: string; x: number; y: number; w: number; h: number } | null
  >(null);
  // Token resize state — the GM grabs the bottom-right of a token in Edit
  // mode to scale its diameter. We use the dominant axis (max of dx/dy) so
  // square-ish drags feel predictable; the token is a circle so width and
  // height are always equal.
  const [tokenResize, setTokenResize] = useState<
    { id: string; ox: number; oy: number } | null
  >(null);
  const [tokenResizePos, setTokenResizePos] = useState<
    { id: string; size: number } | null
  >(null);
  const [selectedShapeColor, setSelectedShapeColor] = useState(SHAPE_COLORS[0]);
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
  const onMouseDown = (e: React.MouseEvent) => {
    if (draggingTokenId) return;
    if (!campaignId) return;

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
      if (ruler) setRuler(null);
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

    if (draggingTokenId) {
      const sp = snap({ x: p.x - dragOffset.x, y: p.y - dragOffset.y });
      setLocalDrag({ id: draggingTokenId, x: sp.x, y: sp.y });
      return;
    }
    if (ruler && tool === 'ruler') {
      setRuler({ ...ruler, x2: p.x, y2: p.y });
    }
    if (drafting) {
      setDraftEnd(p);
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
    if (!isGM || !currentSceneId) return;
    const f = e.target.files?.[0];
    if (!f) return;
    const filename = f.name.replace(/\.[^.]+$/, '');

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 1000;
        const h = img.naturalHeight || 1000;
        const isFirstLayer = (currentScene?.layers.length ?? 0) === 0;
        if (isFirstLayer) {
          // Resize the canvas to fit, drop the image at origin.
          void setSceneCanvas(currentSceneId, w, h);
          void addLayer(currentSceneId, {
            url: dataUrl,
            name: filename || 'Background',
            x: 0,
            y: 0,
            w,
            h,
            rotation: 0,
            hidden: false,
          });
        } else {
          // Centre the new layer on the existing canvas.
          void addLayer(currentSceneId, {
            url: dataUrl,
            name: filename || `Layer ${(currentScene?.layers.length ?? 0) + 1}`,
            x: Math.round(canvasW / 2 - w / 2),
            y: Math.round(canvasH / 2 - h / 2),
            w,
            h,
            rotation: 0,
            hidden: false,
          });
        }
        requestAnimationFrame(fitToScreen);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
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
            <label className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded cursor-pointer flex items-center gap-1">
              <ImagePlus size={14} /> Add image
              <input type="file" accept="image/*" onChange={onLoadBg} className="hidden" />
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
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Tools</div>
            <div className="grid grid-cols-3 gap-1">
              {toolButton('select', MousePointer2, 'Select — drag tokens and shapes')}
              {toolButton('ping', Radio, 'Ping — click to flash a marker for everyone')}
              {toolButton('ruler', Ruler, 'Ruler (5 ft/cell)')}
              {toolButton('token', User, isGM ? 'Place token' : 'Place your character token')}
              {toolButton('edit', Layers, 'Edit images & tokens — drag to move, corner to resize', true)}
              {toolButton('circle', CircleIcon, 'Circle AoE', true)}
              {toolButton('square', SquareIcon, 'Square AoE', true)}
              {toolButton('cone', Triangle, 'Cone AoE', true)}
            </div>
            <div className="flex gap-1 mt-1">
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

          {isGM && (tool === 'circle' || tool === 'square' || tool === 'cone') && (
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
              <span>{mapError}</span>
            </div>
          )}
        </aside>

        {/* ── Canvas ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 relative bg-slate-950 overflow-hidden">
          {/* Ruler readout */}
          {ruler && tool === 'ruler' && (
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
              {sceneLayers.map((layer) => {
                if (layer.hidden && !isGM) return null;
                // Layer drag/resize is gated on the dedicated Layers tool so
                // the default Select tool can keep grabbing tokens and shapes
                // without the GM accidentally moving the battlemat under them.
                const draggable = isGM && tool === 'edit';
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
                              setLayerDrag({
                                id: layer.id,
                                mode: 'move',
                                ox: p.x - layer.x,
                                oy: p.y - layer.y,
                              });
                              setLayerDragPos({ id: layer.id, x: layer.x, y: layer.y, w: layer.w, h: layer.h });
                            }
                          : undefined
                      }
                    />
                    {/* Bottom-right resize handle — only shown to the GM in
                        select mode so it doesn't clutter the player view. */}
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
                            setLayerDrag({
                              id: layer.id,
                              mode: 'resize',
                              ox: p.x - (layer.x + layer.w),
                              oy: p.y - (layer.y + layer.h),
                              startW: layer.w,
                              startH: layer.h,
                              startX: layer.x,
                              startY: layer.y,
                            });
                            setLayerDragPos({ id: layer.id, x: layer.x, y: layer.y, w: layer.w, h: layer.h });
                          }}
                        />
                        {/* Thin selection border so it's obvious which layer
                            the corner handle belongs to when several overlap. */}
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

              {/* Grid overlay */}
              <GridLayer
                showGrid={mapShowGrid}
                gridSize={mapGridSize}
                canvasW={canvasW}
                canvasH={canvasH}
                zoom={zoom}
              />

              {/* Shapes */}
              {sceneShapes.map((s) => {
                const onDbl = isGM && currentSceneId ? () => void removeShape(currentSceneId, s.id) : undefined;
                const draggable = isGM && tool === 'select';
                const live = shapeDragPos && shapeDragPos.id === s.id;
                const lx = live ? shapeDragPos.x : s.x;
                const ly = live ? shapeDragPos.y : s.y;
                const onMouseDown = draggable
                  ? (e: React.MouseEvent) => {
                      e.stopPropagation();
                      const p = screenToLogical(e);
                      setShapeDrag({ id: s.id, ox: p.x - s.x, oy: p.y - s.y });
                      setShapeDragPos({ id: s.id, x: s.x, y: s.y });
                    }
                  : undefined;
                const cursor = draggable ? (live ? 'grabbing' : 'grab') : 'default';
                if (s.kind === 'circle') {
                  return (
                    <circle
                      key={s.id} cx={lx} cy={ly} r={s.r}
                      fill={s.color} stroke={s.color.slice(0, 7)} strokeWidth={2 / zoom}
                      onDoubleClick={onDbl}
                      onMouseDown={onMouseDown}
                      style={{ cursor }}
                    />
                  );
                }
                if (s.kind === 'square') {
                  return (
                    <rect
                      key={s.id} x={lx} y={ly} width={s.w} height={s.h}
                      fill={s.color} stroke={s.color.slice(0, 7)} strokeWidth={2 / zoom}
                      onDoubleClick={onDbl}
                      onMouseDown={onMouseDown}
                      style={{ cursor }}
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
                      onDoubleClick={onDbl}
                      onMouseDown={onMouseDown}
                      style={{ cursor }}
                    />
                  );
                }
                return null;
              })}

              {/* Draft shape outline — dashed preview of the shape the GM
                  is currently dragging out. Cleared on mouseup. */}
              {drafting && draftEnd && (tool === 'circle' || tool === 'square' || tool === 'cone') && (() => {
                const dx = draftEnd.x - drafting.x;
                const dy = draftEnd.y - drafting.y;
                const dash = `${6 / zoom} ${4 / zoom}`;
                const sw = 2 / zoom;
                if (tool === 'circle') {
                  const r = Math.hypot(dx, dy);
                  return (
                    <g pointerEvents="none">
                      <circle
                        cx={drafting.x} cy={drafting.y} r={r}
                        fill={selectedShapeColor}
                        fillOpacity={0.25}
                        stroke={selectedShapeColor}
                        strokeWidth={sw}
                        strokeDasharray={dash}
                      />
                    </g>
                  );
                }
                if (tool === 'square') {
                  return (
                    <g pointerEvents="none">
                      <rect
                        x={Math.min(drafting.x, draftEnd.x)}
                        y={Math.min(drafting.y, draftEnd.y)}
                        width={Math.abs(dx)}
                        height={Math.abs(dy)}
                        fill={selectedShapeColor}
                        fillOpacity={0.25}
                        stroke={selectedShapeColor}
                        strokeWidth={sw}
                        strokeDasharray={dash}
                      />
                    </g>
                  );
                }
                // Cone: draw a triangle from origin to the cursor with a
                // 60° spread (~D&D SRD cone).
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
                      fill={selectedShapeColor}
                      fillOpacity={0.25}
                      stroke={selectedShapeColor}
                      strokeWidth={sw}
                      strokeDasharray={dash}
                    />
                  </g>
                );
              })()}

              {/* Ruler — uses the viewer's dashboard accent so each player
                  sees their own colour for measurements. */}
              {ruler && tool === 'ruler' && (
                <g pointerEvents="none">
                  <line
                    x1={ruler.x1} y1={ruler.y1} x2={ruler.x2} y2={ruler.y2}
                    stroke="var(--ac-400)" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  />
                  <circle cx={ruler.x1} cy={ruler.y1} r={4 / zoom} fill="var(--ac-400)" />
                  <circle cx={ruler.x2} cy={ruler.y2} r={4 / zoom} fill="var(--ac-400)" />
                </g>
              )}

              {/* Tokens */}
              {visibleTokens.map((t) => {
                const draggable = canDragToken(t) && tool === 'select';
                const resizable = isGM && tool === 'edit';
                const dispColor = tokenDisplayColor(t);
                // Live-resize preview: if this token is currently being
                // resized, render at the in-flight size so the GM sees the
                // change as they drag.
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
                      setDraggingTokenId(t.id);
                      setLocalDrag({ id: t.id, x: t.x, y: t.y });
                      setDragOffset({ x: p.x - t.x, y: p.y - t.y });
                    }}
                    onDoubleClick={isGM ? () => void removeToken(t.id) : undefined}
                  >
                    {/* Deep-link focus pulse — a ritual's "Map" button centres
                        here and flags this token; the ring pulses for a few
                        seconds so players spot the caster. */}
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
                    <circle
                      cx={t.x} cy={t.y} r={r}
                      fill={dispColor + '55'}
                      stroke={dispColor}
                      strokeWidth={1.5 / zoom}
                    />
                    {/* Emoji icon — dominantBaseline="central" + dy offset centres
                        the glyph both horizontally and vertically inside the circle */}
                    {t.emoji && (
                      <text
                        x={t.x} y={t.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={r * 1.1}
                        pointerEvents="none"
                      >
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
                    {/* HP bar — sits just below the name label so the token
                        glyph stays unobstructed and the bar reads with the
                        identity it belongs to. */}
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
                    {/* Condition icons — arranged in an arc above the token.
                        Each chip carries the condition name as a <title> so a
                        hover surfaces the rule. */}
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
                                <text
                                  x={cx} y={arcY}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize={chipR * 1.2}
                                  fill="#fef2f2"
                                  fontWeight="600"
                                >
                                  {initial}
                                </text>
                                <title>{c?.name ?? slug}</title>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })()}
                    {/* Tooltip exposing current HP + conditions on hover (works even for non-editors) */}
                    {((t.maxHp ?? 0) > 0 || (t.conditions ?? []).length > 0) && (
                      <title>
                        {`${t.name}`}
                        {(t.maxHp ?? 0) > 0 ? ` — HP ${t.hp ?? 0}/${t.maxHp ?? 0}` : ''}
                        {(t.conditions ?? []).length > 0
                          ? ` — ${(t.conditions ?? []).map((s) => CONDITIONS.find((c) => c.index === s)?.name ?? s).join(', ')}`
                          : ''}
                      </title>
                    )}
                    {/* Edit-mode selection ring + bottom-right resize handle.
                        Sized in screen pixels so the handle stays grabbable
                        at any zoom. Both elements only render for GMs in the
                        Edit tool — Select keeps tokens drag-only. */}
                    {resizable && (
                      <>
                        <circle
                          cx={t.x}
                          cy={t.y}
                          r={r + 4 / zoom}
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
                            setTokenResize({
                              id: t.id,
                              ox: p.x - t.x - r,
                              oy: p.y - t.y - r,
                            });
                            setTokenResizePos({ id: t.id, size: t.size });
                          }}
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {/* Ping pulses */}
              <PingsLayer pings={pings} zoom={zoom} />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
