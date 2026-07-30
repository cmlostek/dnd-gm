import { create } from 'zustand';
import { supabase } from '../../lib/supabase';

/** Append-only HP change log; kept on the token row so anyone with select
 *  rights can hover to see what's happened. Capped to the most recent
 *  MAX_DAMAGE_LOG entries to keep payloads small. */
export type DamageLogEntry = {
  /** ISO timestamp. */
  ts: string;
  /** Negative = damage taken, positive = healing. */
  delta: number;
  /** Resulting HP after applying the delta. */
  hp: number;
  /** Optional acting user id (defaults to the editor). */
  by?: string;
};

export const MAX_DAMAGE_LOG = 25;

export type MapToken = {
  id: string;
  scene_id: string | null;
  owner_user_id: string | null;
  name: string;
  x: number;
  y: number;
  color: string;
  emoji?: string;
  size: number;
  hidden_from_players: boolean;
  hp?: number;
  maxHp?: number;
  damageLog?: DamageLogEntry[];
  /** Active condition slugs (e.g. 'poisoned', 'prone'). Matches CONDITIONS
   *  index from src/data/conditions.ts. Drawn as overlay chips on the token. */
  conditions?: string[];
};

export type MapShape =
  | { id: string; kind: 'circle'; x: number; y: number; r: number; color: string }
  | { id: string; kind: 'square'; x: number; y: number; w: number; h: number; color: string }
  | { id: string; kind: 'cone'; x: number; y: number; dx: number; dy: number; color: string };

/** A positioned image inside a scene. Multiple layers compose the visible
 *  map — e.g. a base battlemat plus an overlay handout, plus a hidden
 *  GM-only secret-door reveal. `hidden` toggles render-only visibility;
 *  the GM can still see the layer in the panel either way. */
export type ImageLayer = {
  id: string;
  url: string;
  /** Friendly label shown in the layers panel. */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  hidden: boolean;
};

/**
 * Manual fog of war (Phase 1). GM-authored, shared with the whole table.
 *
 * Stored as a set of revealed grid cells rather than freeform polygons: it's
 * compact (the scene `data` jsonb has a realtime size cap — see the layer
 * truncation guard below), bounded by the cell grid, and trivial to paint and
 * erase. `cell` is pinned with the fog so changing the map's display grid later
 * doesn't shift already-revealed squares. `revealed` holds "col,row" keys;
 * everything not listed is fogged. Turning fog off reveals the whole map, so
 * there's no need to store a full reveal-all set.
 */
export type FogData = {
  enabled: boolean;
  /** Fog cell size in logical units. */
  cell: number;
  /** Revealed cells as "col,row" keys. */
  revealed: string[];
};

export const DEFAULT_FOG_CELL = 50;
export const defaultFog = (): FogData => ({ enabled: false, cell: DEFAULT_FOG_CELL, revealed: [] });

/**
 * A sight-blocking wall segment (Phase 2). GM-authored, never shown to players;
 * feeds the line-of-sight computation. Structurally a visibility `Seg` plus an
 * id. Stored in scene.data — tiny (four numbers), so no realtime-size concern.
 */
export type MapWall = { id: string; x1: number; y1: number; x2: number; y2: number };

type SceneData = {
  shapes?: MapShape[];
  layers?: ImageLayer[];
  fog?: FogData;
  walls?: MapWall[];
};

export type MapScene = {
  id: string;
  name: string;
  order_idx: number;
  grid_size: number;
  show_grid: boolean;
  width: number;
  height: number;
  shapes: MapShape[];
  layers: ImageLayer[];
  fog: FogData;
  walls: MapWall[];
};

export type MapState = {
  /** id of the scene every player currently sees. */
  active_scene_id: string | null;
  /** GM-only override — when set, the GM's local view renders this scene
   *  instead of the active one. Players still see the active scene. */
  gm_preview_scene_id: string | null;
};

type TokenData = {
  emoji?: string;
  hp?: number;
  maxHp?: number;
  damageLog?: DamageLogEntry[];
  conditions?: string[];
};

type TokenRow = {
  id: string;
  campaign_id: string;
  scene_id: string | null;
  owner_user_id: string | null;
  label: string;
  color: string;
  x: number;
  y: number;
  hidden_from_players: boolean;
  size: number;
  data: TokenData | null;
};

type SceneRow = {
  id: string;
  campaign_id: string;
  name: string;
  order_idx: number;
  grid_size: number;
  show_grid: boolean;
  width: number;
  height: number;
  data: SceneData | null;
};

type StateRow = {
  campaign_id: string;
  active_scene_id: string | null;
  gm_preview_scene_id: string | null;
};

const DEFAULT_CANVAS_W = 2000;
const DEFAULT_CANVAS_H = 1500;

const DEFAULT_STATE: MapState = {
  active_scene_id: null,
  gm_preview_scene_id: null,
};

function rowToToken(r: TokenRow): MapToken {
  return {
    id: r.id,
    scene_id: r.scene_id,
    owner_user_id: r.owner_user_id,
    name: r.label,
    x: r.x,
    y: r.y,
    color: r.color,
    emoji: r.data?.emoji,
    size: r.size,
    hidden_from_players: r.hidden_from_players,
    hp: r.data?.hp,
    maxHp: r.data?.maxHp,
    damageLog: r.data?.damageLog,
    conditions: r.data?.conditions ?? [],
  };
}

function tokenDataPayload(t: Pick<MapToken, 'emoji' | 'hp' | 'maxHp' | 'damageLog' | 'conditions'>): TokenData {
  const d: TokenData = {};
  if (t.emoji) d.emoji = t.emoji;
  if (t.hp != null) d.hp = t.hp;
  if (t.maxHp != null) d.maxHp = t.maxHp;
  if (t.damageLog && t.damageLog.length > 0) d.damageLog = t.damageLog;
  if (t.conditions && t.conditions.length > 0) d.conditions = t.conditions;
  return d;
}

function rowToScene(r: SceneRow): MapScene {
  const d = r.data ?? {};
  return {
    id: r.id,
    name: r.name,
    order_idx: r.order_idx,
    grid_size: r.grid_size ?? 50,
    show_grid: r.show_grid ?? true,
    width: r.width ?? DEFAULT_CANVAS_W,
    height: r.height ?? DEFAULT_CANVAS_H,
    shapes: d.shapes ?? [],
    layers: d.layers ?? [],
    fog: d.fog ?? defaultFog(),
    walls: d.walls ?? [],
  };
}

function sceneDataPayload(s: Pick<MapScene, 'shapes' | 'layers' | 'fog' | 'walls'>): SceneData {
  return { shapes: s.shapes, layers: s.layers, fog: s.fog, walls: s.walls };
}

function rowToState(r: StateRow): MapState {
  return {
    active_scene_id: r.active_scene_id ?? null,
    gm_preview_scene_id: r.gm_preview_scene_id ?? null,
  };
}

type MapStore = {
  state: MapState;
  scenes: MapScene[];
  tokens: MapToken[];
  loaded: boolean;
  error: string | null;

  loadForCampaign: (campaignId: string) => Promise<void>;
  subscribe: (campaignId: string) => () => void;
  clear: () => void;

  // ── Scene CRUD ──────────────────────────────────────────────────────────
  addScene: (campaignId: string, name?: string) => Promise<string | null>;
  renameScene: (sceneId: string, name: string) => Promise<void>;
  removeScene: (campaignId: string, sceneId: string) => Promise<void>;
  reorderScenes: (campaignId: string, orderedIds: string[]) => Promise<void>;
  setActiveScene: (campaignId: string, sceneId: string | null) => Promise<void>;
  setGmPreviewScene: (campaignId: string, sceneId: string | null) => Promise<void>;
  setSceneCanvas: (sceneId: string, w: number, h: number) => Promise<void>;
  setSceneGridSize: (sceneId: string, size: number) => Promise<void>;
  setSceneShowGrid: (sceneId: string, show: boolean) => Promise<void>;

  // ── Image layers (within a scene) ───────────────────────────────────────
  addLayer: (sceneId: string, layer: Omit<ImageLayer, 'id'>) => Promise<string | null>;
  updateLayer: (sceneId: string, layer: ImageLayer) => Promise<void>;
  removeLayer: (sceneId: string, layerId: string) => Promise<void>;

  // ── Shapes (per-scene) ──────────────────────────────────────────────────
  addShape: (sceneId: string, shape: MapShape) => Promise<void>;
  updateShape: (sceneId: string, shape: MapShape) => Promise<void>;
  removeShape: (sceneId: string, shapeId: string) => Promise<void>;
  clearShapes: (sceneId: string) => Promise<void>;

  // ── Walls (per-scene, sight-blocking) ────────────────────────────────────
  addWall: (sceneId: string, wall: MapWall) => Promise<void>;
  removeWall: (sceneId: string, wallId: string) => Promise<void>;
  clearWalls: (sceneId: string) => Promise<void>;

  // ── Fog of war (per-scene) ───────────────────────────────────────────────
  setFogEnabled: (sceneId: string, enabled: boolean) => Promise<void>;
  /** Add/remove revealed cells in local state only — used during a paint drag
   *  so painting stays instant. Call commitFog on drag-end to persist. */
  paintFogLocal: (sceneId: string, cells: string[], reveal: boolean) => void;
  /** Persist the scene's current fog to the DB (fans out via realtime). */
  commitFog: (sceneId: string) => Promise<void>;
  /** Fog everything again (clear all revealed cells). */
  clearFog: (sceneId: string) => Promise<void>;

  // ── Tokens ──────────────────────────────────────────────────────────────
  addToken: (campaignId: string, t: Omit<MapToken, 'id'>) => Promise<string | null>;
  updateToken: (id: string, patch: Partial<MapToken>, fromSync?: boolean) => Promise<void>;
  removeToken: (id: string) => Promise<void>;
};

// Mutate a scene's data jsonb safely — fetches current data, applies the
// mutation, writes the merged result so realtime echoes back the correct
// shape and we don't clobber a sibling field.
async function mutateSceneData(sceneId: string, mutate: (s: MapScene) => Partial<MapScene>) {
  const { data, error } = await supabase
    .from('map_scenes')
    .select('*')
    .eq('id', sceneId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Scene not found');
  const scene = rowToScene(data as SceneRow);
  const patch = mutate(scene);
  const next: MapScene = { ...scene, ...patch };
  const { error: upErr } = await supabase
    .from('map_scenes')
    .update({
      name: next.name,
      order_idx: next.order_idx,
      grid_size: next.grid_size,
      show_grid: next.show_grid,
      width: next.width,
      height: next.height,
      data: sceneDataPayload(next),
    })
    .eq('id', sceneId);
  if (upErr) throw upErr;
}

export const useMap = create<MapStore>((set, get) => ({
  state: DEFAULT_STATE,
  scenes: [],
  tokens: [],
  loaded: false,
  error: null,

  loadForCampaign: async (campaignId) => {
    set({ loaded: false, error: null });
    try {
      const [stateRes, scenesRes, tokensRes] = await Promise.all([
        supabase.from('map_state').select('campaign_id, active_scene_id, gm_preview_scene_id').eq('campaign_id', campaignId).maybeSingle(),
        supabase.from('map_scenes').select('*').eq('campaign_id', campaignId).order('order_idx', { ascending: true }),
        supabase.from('map_tokens').select('*').eq('campaign_id', campaignId),
      ]);
      if (stateRes.error) throw stateRes.error;
      if (scenesRes.error) throw scenesRes.error;
      if (tokensRes.error) throw tokensRes.error;
      const st = stateRes.data ? rowToState(stateRes.data as StateRow) : DEFAULT_STATE;
      const scenes = ((scenesRes.data ?? []) as SceneRow[]).map(rowToScene);
      const tokens = ((tokensRes.data ?? []) as TokenRow[]).map(rowToToken);

      // Self-heal: if state has no active scene but we have at least one
      // scene, pick the first as active so the GM doesn't see a blank board
      // on a fresh campaign that pre-dates the migration's backfill.
      let activeId = st.active_scene_id;
      if (!activeId && scenes.length > 0) {
        activeId = scenes[0].id;
        // Best-effort write — failure here is non-fatal, just means the
        // next load will re-heal.
        void supabase
          .from('map_state')
          .upsert({ campaign_id: campaignId, active_scene_id: activeId }, { onConflict: 'campaign_id' });
      }

      set({
        state: { ...st, active_scene_id: activeId },
        scenes,
        tokens,
        loaded: true,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true });
    }
  },

  subscribe: (campaignId) => {
    const channel = supabase
      .channel(`map:${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_state', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            set({ state: DEFAULT_STATE });
          } else {
            set({ state: rowToState(payload.new as StateRow) });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_scenes', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const { scenes } = get();
          if (payload.eventType === 'INSERT') {
            const s = rowToScene(payload.new as SceneRow);
            if (!scenes.find((x) => x.id === s.id)) {
              set({ scenes: [...scenes, s].sort((a, b) => a.order_idx - b.order_idx) });
            }
          } else if (payload.eventType === 'UPDATE') {
            const newRow = payload.new as SceneRow;
            // Image data-URLs stored inside data.layers can push the row
            // beyond Supabase Realtime's per-message size cap. When that
            // happens the payload arrives with `data` dropped to null even
            // though the row in the DB is intact. Detect that case and keep
            // our local shapes/layers — otherwise the very layer we just
            // wrote would be erased by the echo of our own update.
            const existing = scenes.find((x) => x.id === newRow.id);
            const truncated = existing && newRow.data == null;
            const incoming = rowToScene(newRow);
            const merged: MapScene = truncated
              ? { ...incoming, shapes: existing!.shapes, layers: existing!.layers, fog: existing!.fog, walls: existing!.walls }
              : incoming;
            set({
              scenes: scenes
                .map((x) => (x.id === merged.id ? merged : x))
                .sort((a, b) => a.order_idx - b.order_idx),
            });
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<SceneRow>;
            set({ scenes: scenes.filter((x) => x.id !== old.id) });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_tokens', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const { tokens } = get();
          if (payload.eventType === 'INSERT') {
            const t = rowToToken(payload.new as TokenRow);
            if (!tokens.find((x) => x.id === t.id)) set({ tokens: [...tokens, t] });
          } else if (payload.eventType === 'UPDATE') {
            const t = rowToToken(payload.new as TokenRow);
            set({ tokens: tokens.map((x) => (x.id === t.id ? t : x)) });
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<TokenRow>;
            set({ tokens: tokens.filter((x) => x.id !== old.id) });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  clear: () => set({ state: DEFAULT_STATE, scenes: [], tokens: [], loaded: false, error: null }),

  // ── Scenes ──────────────────────────────────────────────────────────────
  addScene: async (campaignId, name) => {
    const order_idx = get().scenes.length;
    const { data, error } = await supabase
      .from('map_scenes')
      .insert({
        campaign_id: campaignId,
        name: name ?? `Scene ${order_idx + 1}`,
        order_idx,
        grid_size: 50,
        show_grid: true,
        width: DEFAULT_CANVAS_W,
        height: DEFAULT_CANVAS_H,
        data: { shapes: [], layers: [] },
      })
      .select()
      .single();
    if (error || !data) {
      set({ error: error?.message ?? 'Failed to add scene' });
      return null;
    }
    const scene = rowToScene(data as SceneRow);
    set((s) =>
      s.scenes.some((x) => x.id === scene.id) ? s : { scenes: [...s.scenes, scene] },
    );
    // First scene becomes active automatically so the board isn't blank.
    if (get().scenes.length === 1 || !get().state.active_scene_id) {
      await get().setActiveScene(campaignId, scene.id);
    }
    return scene.id;
  },

  renameScene: async (sceneId, name) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, name } : s)) });
    const { error } = await supabase.from('map_scenes').update({ name }).eq('id', sceneId);
    if (error) set({ scenes: prev, error: error.message });
  },

  removeScene: async (campaignId, sceneId) => {
    const prev = get().scenes;
    const prevState = get().state;
    set({ scenes: prev.filter((s) => s.id !== sceneId) });
    const { error } = await supabase.from('map_scenes').delete().eq('id', sceneId);
    if (error) {
      set({ scenes: prev, error: error.message });
      return;
    }
    // If we just deleted the active scene, fall back to whichever scene is
    // left (or null) so the board doesn't keep rendering a stale id.
    if (prevState.active_scene_id === sceneId) {
      const next = get().scenes[0]?.id ?? null;
      await get().setActiveScene(campaignId, next);
    }
    if (prevState.gm_preview_scene_id === sceneId) {
      await get().setGmPreviewScene(campaignId, null);
    }
  },

  reorderScenes: async (campaignId, orderedIds) => {
    const prev = get().scenes;
    const byId = new Map(prev.map((s) => [s.id, s]));
    const next = orderedIds
      .map((id, i) => {
        const s = byId.get(id);
        return s ? { ...s, order_idx: i } : null;
      })
      .filter((s): s is MapScene => !!s);
    set({ scenes: next });
    // Batched update — one row per scene with its new order_idx.
    const errors: string[] = [];
    for (const s of next) {
      const { error } = await supabase
        .from('map_scenes')
        .update({ order_idx: s.order_idx })
        .eq('id', s.id)
        .eq('campaign_id', campaignId);
      if (error) errors.push(error.message);
    }
    if (errors.length) set({ scenes: prev, error: errors[0] });
  },

  setActiveScene: async (campaignId, sceneId) => {
    const prev = get().state;
    set({ state: { ...prev, active_scene_id: sceneId } });
    const { error } = await supabase
      .from('map_state')
      .upsert({ campaign_id: campaignId, active_scene_id: sceneId }, { onConflict: 'campaign_id' });
    if (error) set({ state: prev, error: error.message });
  },

  setGmPreviewScene: async (campaignId, sceneId) => {
    const prev = get().state;
    set({ state: { ...prev, gm_preview_scene_id: sceneId } });
    const { error } = await supabase
      .from('map_state')
      .upsert({ campaign_id: campaignId, gm_preview_scene_id: sceneId }, { onConflict: 'campaign_id' });
    if (error) set({ state: prev, error: error.message });
  },

  setSceneCanvas: async (sceneId, w, h) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, width: w, height: h } : s)) });
    const { error } = await supabase
      .from('map_scenes')
      .update({ width: w, height: h })
      .eq('id', sceneId);
    if (error) set({ scenes: prev, error: error.message });
  },

  setSceneGridSize: async (sceneId, size) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, grid_size: size } : s)) });
    const { error } = await supabase
      .from('map_scenes')
      .update({ grid_size: size })
      .eq('id', sceneId);
    if (error) set({ scenes: prev, error: error.message });
  },

  setSceneShowGrid: async (sceneId, show) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, show_grid: show } : s)) });
    const { error } = await supabase
      .from('map_scenes')
      .update({ show_grid: show })
      .eq('id', sceneId);
    if (error) set({ scenes: prev, error: error.message });
  },

  // ── Image layers ────────────────────────────────────────────────────────
  addLayer: async (sceneId, layer) => {
    const id = crypto.randomUUID();
    const full: ImageLayer = { id, ...layer };
    const prev = get().scenes;
    set({
      scenes: prev.map((s) => (s.id === sceneId ? { ...s, layers: [...s.layers, full] } : s)),
    });
    try {
      await mutateSceneData(sceneId, (s) => ({ layers: [...s.layers, full] }));
      return id;
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  updateLayer: async (sceneId, layer) => {
    const prev = get().scenes;
    set({
      scenes: prev.map((s) =>
        s.id === sceneId
          ? { ...s, layers: s.layers.map((l) => (l.id === layer.id ? layer : l)) }
          : s,
      ),
    });
    try {
      await mutateSceneData(sceneId, (s) => ({
        layers: s.layers.map((l) => (l.id === layer.id ? layer : l)),
      }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  removeLayer: async (sceneId, layerId) => {
    const prev = get().scenes;
    set({
      scenes: prev.map((s) =>
        s.id === sceneId ? { ...s, layers: s.layers.filter((l) => l.id !== layerId) } : s,
      ),
    });
    try {
      await mutateSceneData(sceneId, (s) => ({
        layers: s.layers.filter((l) => l.id !== layerId),
      }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  // ── Shapes ──────────────────────────────────────────────────────────────
  addShape: async (sceneId, shape) => {
    const prev = get().scenes;
    set({
      scenes: prev.map((s) =>
        s.id === sceneId ? { ...s, shapes: [...s.shapes, shape] } : s,
      ),
    });
    try {
      await mutateSceneData(sceneId, (s) => ({ shapes: [...s.shapes, shape] }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  updateShape: async (sceneId, shape) => {
    const prev = get().scenes;
    set({
      scenes: prev.map((s) =>
        s.id === sceneId
          ? { ...s, shapes: s.shapes.map((x) => (x.id === shape.id ? shape : x)) }
          : s,
      ),
    });
    try {
      await mutateSceneData(sceneId, (s) => ({
        shapes: s.shapes.map((x) => (x.id === shape.id ? shape : x)),
      }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  removeShape: async (sceneId, shapeId) => {
    const prev = get().scenes;
    set({
      scenes: prev.map((s) =>
        s.id === sceneId ? { ...s, shapes: s.shapes.filter((x) => x.id !== shapeId) } : s,
      ),
    });
    try {
      await mutateSceneData(sceneId, (s) => ({
        shapes: s.shapes.filter((x) => x.id !== shapeId),
      }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  clearShapes: async (sceneId) => {
    const prev = get().scenes;
    set({
      scenes: prev.map((s) => (s.id === sceneId ? { ...s, shapes: [] } : s)),
    });
    try {
      await mutateSceneData(sceneId, () => ({ shapes: [] }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  // ── Walls ───────────────────────────────────────────────────────────────
  addWall: async (sceneId, wall) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, walls: [...s.walls, wall] } : s)) });
    try {
      await mutateSceneData(sceneId, (s) => ({ walls: [...s.walls, wall] }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  removeWall: async (sceneId, wallId) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, walls: s.walls.filter((w) => w.id !== wallId) } : s)) });
    try {
      await mutateSceneData(sceneId, (s) => ({ walls: s.walls.filter((w) => w.id !== wallId) }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  clearWalls: async (sceneId) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, walls: [] } : s)) });
    try {
      await mutateSceneData(sceneId, () => ({ walls: [] }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  // ── Fog of war ────────────────────────────────────────────────────────────
  setFogEnabled: async (sceneId, enabled) => {
    const prev = get().scenes;
    // On first enable (nothing revealed yet) snap the fog grid to the scene's
    // display grid so painted squares line up with what the GM sees. Once
    // cells exist, keep the pinned size so they don't shift.
    const apply = (s: MapScene): FogData => ({
      ...s.fog,
      enabled,
      cell: enabled && s.fog.revealed.length === 0 ? s.grid_size || DEFAULT_FOG_CELL : s.fog.cell,
    });
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, fog: apply(s) } : s)) });
    try {
      await mutateSceneData(sceneId, (s) => ({ fog: apply(s) }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  paintFogLocal: (sceneId, cells, reveal) => {
    set({
      scenes: get().scenes.map((s) => {
        if (s.id !== sceneId) return s;
        const next = new Set(s.fog.revealed);
        if (reveal) for (const c of cells) next.add(c);
        else for (const c of cells) next.delete(c);
        return { ...s, fog: { ...s.fog, revealed: [...next] } };
      }),
    });
  },

  commitFog: async (sceneId) => {
    const scene = get().scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const fog = scene.fog; // persist the locally-painted set
    try {
      await mutateSceneData(sceneId, () => ({ fog }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  clearFog: async (sceneId) => {
    const prev = get().scenes;
    set({ scenes: prev.map((s) => (s.id === sceneId ? { ...s, fog: { ...s.fog, revealed: [] } } : s)) });
    try {
      await mutateSceneData(sceneId, (s) => ({ fog: { ...s.fog, revealed: [] } }));
    } catch (e) {
      set({ scenes: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  // ── Tokens ──────────────────────────────────────────────────────────────
  addToken: async (campaignId, t) => {
    const { data, error } = await supabase
      .from('map_tokens')
      .insert({
        campaign_id: campaignId,
        scene_id: t.scene_id,
        owner_user_id: t.owner_user_id,
        label: t.name,
        color: t.color,
        x: t.x,
        y: t.y,
        hidden_from_players: t.hidden_from_players,
        size: t.size,
        data: tokenDataPayload(t),
      })
      .select()
      .single();
    if (error || !data) {
      set({ error: error?.message ?? 'Failed to add token' });
      return null;
    }
    const token = rowToToken(data as TokenRow);
    set((s) =>
      s.tokens.some((x) => x.id === token.id) ? s : { tokens: [...s.tokens, token] },
    );
    return token.id;
  },

  updateToken: async (id, patch, fromSync = false) => {
    const prev = get().tokens.find((x) => x.id === id);
    if (!prev) return;
    const changed = (Object.keys(patch) as (keyof MapToken)[]).some(
      (k) => prev[k] !== patch[k],
    );
    if (!changed) return;
    const next = { ...prev, ...patch };
    set((s) => ({ tokens: s.tokens.map((x) => (x.id === id ? next : x)) }));

    const row: Record<string, unknown> = {};
    if ('name' in patch) row.label = next.name;
    if ('color' in patch) row.color = next.color;
    if ('x' in patch) row.x = next.x;
    if ('y' in patch) row.y = next.y;
    if ('size' in patch) row.size = next.size;
    if ('owner_user_id' in patch) row.owner_user_id = next.owner_user_id;
    if ('scene_id' in patch) row.scene_id = next.scene_id;
    if ('hidden_from_players' in patch) row.hidden_from_players = next.hidden_from_players;
    if ('emoji' in patch || 'hp' in patch || 'maxHp' in patch || 'damageLog' in patch || 'conditions' in patch) {
      row.data = tokenDataPayload(next);
    }

    const { error } = await supabase.from('map_tokens').update(row).eq('id', id);
    if (error) {
      set((s) => ({
        tokens: s.tokens.map((x) => (x.id === id ? prev : x)),
        error: error.message,
      }));
      return;
    }

    // Fan PC HP changes out to party + initiative. We treat any token with an
    // owner_user_id as a PC for the sync; NPC creature tokens have a null
    // owner so they keep their independent HP. fromSync breaks re-entry so
    // sync-induced updates don't fire another sync round and race the user's
    // rapid keypresses on the HP input.
    if (!fromSync && (patch.hp !== undefined || patch.maxHp !== undefined) && prev.owner_user_id) {
      import('../hpLink').then((m) =>
        m.syncPcHpAfterChange({
          source: 'map',
          name: prev.name,
          ownerUserId: prev.owner_user_id,
          hp: patch.hp,
          maxHp: patch.maxHp,
        }),
      );
    }
  },

  removeToken: async (id) => {
    const prev = get().tokens;
    set((s) => ({ tokens: s.tokens.filter((x) => x.id !== id) }));
    const { error } = await supabase.from('map_tokens').delete().eq('id', id);
    if (error) set({ tokens: prev, error: error.message });
  },
}));
