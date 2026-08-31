import { create } from 'zustand';
import { supabase } from '../../lib/supabase';
import { useSession } from '../session/sessionStore';

export type Note = {
  id: string;
  campaign_id: string;
  title: string;
  body: string;
  ydoc_state: string | null;
  folder_id: string | null;
  visible_to_players: boolean;
  /** Legacy: kept in sync with note_permissions for older clients. */
  player_editable: boolean | null;
  owner_user_id: string | null;
  /** Immutable author — who first created the note. GM-authored notes have
   *  owner_user_id = null but created_by = the GM, so this is how a GM's
   *  "own" notes are identified (see ownsNote in Dashboard). */
  created_by: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
};

export type NotePermission = {
  note_id: string;
  user_id: string;
  can_view: boolean;
  can_edit: boolean;
};

/**
 * Stable reference for "no permission rows" — used by Zustand selectors so
 * they don't return a fresh `[]` every call. useSyncExternalStore would
 * detect the new reference as a state change and infinite-loop (React #185).
 */
export const EMPTY_PERMS: readonly NotePermission[] = Object.freeze([]);

export type Folder = {
  id: string;
  campaign_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  expanded?: boolean;
};

const EXPANDED_KEY = 'dnd-gm:expandedFolders';
const ACTIVE_NOTE_KEY = 'dnd-gm:activeNoteId';
const OPEN_NOTES_KEY = 'dnd-gm:openNoteIds';
const ICON_KEY = 'dnd-gm:noteIcons';

function readOpenNoteIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_NOTES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    // Seed from a pre-existing active note so upgrading users don't land with
    // an open editor but no tab for it.
    const active = localStorage.getItem(ACTIVE_NOTE_KEY);
    if (active && !ids.includes(active)) ids.push(active);
    return ids;
  } catch {
    return [];
  }
}

function writeOpenNoteIds(ids: string[]) {
  try {
    localStorage.setItem(OPEN_NOTES_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota / private-mode failures */
  }
}
const EDITABLE_KEY = 'dnd-gm:noteEditable';
const PERMS_KEY = 'dnd-gm:notePermissions';

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function persistExpanded(map: Record<string, boolean>) {
  localStorage.setItem(EXPANDED_KEY, JSON.stringify(map));
}

/** Icons are persisted locally so they work even before the DB migration runs. */
function readLocalIcons(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ICON_KEY) ?? '{}'); }
  catch { return {}; }
}
function writeLocalIcon(noteId: string, icon: string | null) {
  const map = readLocalIcons();
  if (icon) map[noteId] = icon;
  else delete map[noteId];
  localStorage.setItem(ICON_KEY, JSON.stringify(map));
}
function mergeIcon(note: Note): Note {
  if (note.icon) return note;           // DB value wins once migration is run
  const local = readLocalIcons()[note.id];
  return local ? { ...note, icon: local } : note;
}

/** player_editable persisted to localStorage until DB column exists. */
function readLocalEditables(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(EDITABLE_KEY) ?? '{}'); }
  catch { return {}; }
}
function writeLocalEditable(noteId: string, editable: boolean | null) {
  const map = readLocalEditables();
  if (editable != null) map[noteId] = editable;
  else delete map[noteId];
  localStorage.setItem(EDITABLE_KEY, JSON.stringify(map));
}
function mergeEditable(note: Note): Note {
  if (note.player_editable != null) return note; // DB value wins
  const local = readLocalEditables()[note.id];
  return local !== undefined ? { ...note, player_editable: local } : note;
}

function mergeAll(note: Note): Note {
  return mergeEditable(mergeIcon(note));
}

// ─── note_permissions localStorage fallback ────────────────────────────────
// Same pattern as icons/editables: persisted locally so the UI works even
// before the supabase migration is run.
type LocalPermsMap = Record<string, NotePermission[]>; // note_id -> rows
function readLocalPerms(): LocalPermsMap {
  try { return JSON.parse(localStorage.getItem(PERMS_KEY) ?? '{}'); }
  catch { return {}; }
}
function writeLocalPerms(noteId: string, rows: NotePermission[]) {
  const map = readLocalPerms();
  if (rows.length === 0) delete map[noteId];
  else map[noteId] = rows;
  localStorage.setItem(PERMS_KEY, JSON.stringify(map));
}

type NotesState = {
  notes: Note[];
  folders: Folder[];
  /** Per-note draft buffer for title/body. Save flushes to Supabase. */
  drafts: Record<string, { title?: string; body?: string }>;
  /** Per-note permission matrix loaded from note_permissions. */
  permissions: Record<string, NotePermission[]>;
  /** Current user's custom drag order, keyed by folder id (or 'root'). */
  noteOrder: Record<string, string[]>;
  activeNoteId: string | null;
  /** Notes currently open as tabs, in tab order. The active tab is
   *  activeNoteId; opening a note appends it here, closing removes it. */
  openNoteIds: string[];
  loaded: boolean;
  error: string | null;

  loadForCampaign: (campaignId: string) => Promise<void>;
  subscribe: (campaignId: string) => () => void;
  clear: () => void;

  setActiveNote: (id: string | null) => void;
  /** Close an open tab. If it was the active tab, activates an adjacent one. */
  closeNote: (id: string) => void;
  /** Reorder open tabs: move `id` to sit immediately before `beforeId`
   *  (or to the end when beforeId is null). */
  moveOpenNote: (id: string, beforeId: string | null) => void;

  createNote: (campaignId: string, folderId: string | null, ownerId?: string | null) => Promise<string | null>;
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'folder_id' | 'visible_to_players' | 'icon' | 'player_editable' | 'ydoc_state'>>) => Promise<void>;
  /** Hands a note off to another campaign member. Only the note's current
   *  owner or a GM/co-GM may call this — enforced server-side by the
   *  transfer_note_ownership RPC, not just the UI gate. */
  transferNoteOwnership: (noteId: string, newOwnerId: string) => Promise<void>;
  /** Buffer title/body locally without hitting the DB. Call saveNote to flush. */
  updateDraft: (id: string, patch: { title?: string; body?: string }) => void;
  /** Flush draft buffer to Supabase; broadcasts via realtime. Accepts the
   *  current Yjs document state (base64) so it is persisted alongside body. */
  saveNote: (id: string, ydocState?: string | null) => Promise<void>;
  isDirty: (id: string) => boolean;
  deleteNote: (id: string) => Promise<void>;
  moveNote: (id: string, folderId: string | null) => Promise<void>;
  /** Persists the current user's manual drag order for one folder (or
   *  'root'). Purely personal view state — doesn't affect other users. */
  reorderNotes: (folderKey: string, orderedIds: string[]) => Promise<void>;

  /** Replace the full permission matrix for a note. */
  setNotePermissions: (noteId: string, rows: NotePermission[]) => Promise<void>;
  getNotePermissions: (noteId: string) => NotePermission[];

  createFolder: (campaignId: string, name: string, parentId: string | null) => Promise<string | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  toggleFolderExpanded: (id: string) => void;
  isFolderExpanded: (id: string) => boolean;
};

const expandedMap = loadExpanded();

export const useNotes = create<NotesState>((set, get) => ({
  notes: [],
  folders: [],
  drafts: {},
  permissions: {},
  noteOrder: {},
  activeNoteId: localStorage.getItem(ACTIVE_NOTE_KEY),
  openNoteIds: readOpenNoteIds(),
  loaded: false,
  error: null,

  loadForCampaign: async (campaignId) => {
    set({ loaded: false, error: null });
    try {
      const userId = useSession.getState().userId;
      const [notesRes, foldersRes, orderRes] = await Promise.all([
        supabase
          .from('notes')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('note_folders')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('sort_order'),
        userId
          ? supabase
              .from('note_sort_order')
              .select('folder_key, order_ids')
              .eq('campaign_id', campaignId)
              .eq('user_id', userId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (notesRes.error) throw notesRes.error;
      if (foldersRes.error) throw foldersRes.error;
      const loadedNotes = ((notesRes.data ?? []) as Note[]).map(mergeAll);

      const noteOrder: Record<string, string[]> = {};
      if (!orderRes.error) {
        for (const row of (orderRes.data ?? []) as { folder_key: string; order_ids: string[] }[]) {
          noteOrder[row.folder_key] = row.order_ids;
        }
      }

      // Try to load note_permissions for these notes. Falls back to
      // localStorage if the table doesn't exist yet (pre-migration).
      let permsByNote: Record<string, NotePermission[]> = {};
      const noteIds = loadedNotes.map((n) => n.id);
      if (noteIds.length > 0) {
        const { data: permRows, error: permErr } = await supabase
          .from('note_permissions')
          .select('*')
          .in('note_id', noteIds);
        if (!permErr && permRows) {
          for (const row of permRows as NotePermission[]) {
            (permsByNote[row.note_id] ??= []).push(row);
          }
        } else {
          // Table missing — fall back to local cache.
          permsByNote = readLocalPerms();
        }
      }

      set({
        notes: loadedNotes,
        folders: (foldersRes.data ?? []) as Folder[],
        permissions: permsByNote,
        noteOrder,
        loaded: true,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true });
    }
  },

  subscribe: (campaignId) => {
    const channel = supabase
      .channel(`notes:${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const { notes } = get();
          if (payload.eventType === 'INSERT') {
            const n = mergeAll(payload.new as Note);
            if (!notes.find((x) => x.id === n.id)) set({ notes: [n, ...notes] });
          } else if (payload.eventType === 'UPDATE') {
            // mergeAll ensures local icon/player_editable survives if DB columns don't exist yet
            const n = mergeAll(payload.new as Note);
            set({ notes: notes.map((x) => (x.id === n.id ? n : x)) });
          } else if (payload.eventType === 'DELETE') {
            const n = payload.old as Partial<Note>;
            set({ notes: notes.filter((x) => x.id !== n.id) });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_folders', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const { folders } = get();
          if (payload.eventType === 'INSERT') {
            const f = payload.new as Folder;
            if (!folders.find((x) => x.id === f.id)) set({ folders: [...folders, f] });
          } else if (payload.eventType === 'UPDATE') {
            const f = payload.new as Folder;
            set({ folders: folders.map((x) => (x.id === f.id ? f : x)) });
          } else if (payload.eventType === 'DELETE') {
            const f = payload.old as Partial<Folder>;
            set({ folders: folders.filter((x) => x.id !== f.id) });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_permissions' },
        (payload) => {
          // No campaign filter is safe — only rows for notes in our campaign
          // pass RLS, so the subscription naturally scopes to us.
          const { permissions } = get();
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<NotePermission>;
            if (!old.note_id || !old.user_id) return;
            const rows = (permissions[old.note_id] ?? []).filter((r) => r.user_id !== old.user_id);
            set({ permissions: { ...permissions, [old.note_id]: rows } });
          } else {
            const row = payload.new as NotePermission;
            const existing = permissions[row.note_id] ?? [];
            const next = existing.filter((r) => r.user_id !== row.user_id).concat(row);
            set({ permissions: { ...permissions, [row.note_id]: next } });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  clear: () => set({ notes: [], folders: [], drafts: {}, permissions: {}, noteOrder: {}, activeNoteId: null, openNoteIds: [], loaded: false, error: null }),

  setActiveNote: (id) => {
    if (id) localStorage.setItem(ACTIVE_NOTE_KEY, id);
    else localStorage.removeItem(ACTIVE_NOTE_KEY);
    set((s) => {
      // Opening a note also makes it a tab (appended if not already open).
      const openNoteIds = id && !s.openNoteIds.includes(id) ? [...s.openNoteIds, id] : s.openNoteIds;
      if (openNoteIds !== s.openNoteIds) writeOpenNoteIds(openNoteIds);
      return { activeNoteId: id, openNoteIds };
    });
  },

  closeNote: (id) => {
    set((s) => {
      const idx = s.openNoteIds.indexOf(id);
      if (idx < 0) return s;
      const openNoteIds = s.openNoteIds.filter((x) => x !== id);
      writeOpenNoteIds(openNoteIds);
      // If we closed the active tab, activate the neighbour (prefer the tab to
      // the right, then the left); otherwise leave the active tab untouched.
      let activeNoteId = s.activeNoteId;
      if (s.activeNoteId === id) {
        activeNoteId = openNoteIds[idx] ?? openNoteIds[idx - 1] ?? null;
        if (activeNoteId) localStorage.setItem(ACTIVE_NOTE_KEY, activeNoteId);
        else localStorage.removeItem(ACTIVE_NOTE_KEY);
      }
      return { openNoteIds, activeNoteId };
    });
  },

  moveOpenNote: (id, beforeId) => {
    set((s) => {
      if (!s.openNoteIds.includes(id) || id === beforeId) return s;
      const without = s.openNoteIds.filter((x) => x !== id);
      const at = beforeId ? without.indexOf(beforeId) : -1;
      const openNoteIds = at < 0
        ? [...without, id]
        : [...without.slice(0, at), id, ...without.slice(at)];
      writeOpenNoteIds(openNoteIds);
      return { openNoteIds };
    });
  },

  createNote: async (campaignId, folderId, ownerId) => {
    const insert: Record<string, unknown> = {
      campaign_id: campaignId,
      folder_id: folderId,
      title: 'Untitled',
      body: '',
    };
    if (ownerId != null) insert.owner_user_id = ownerId;
    const { data, error } = await supabase
      .from('notes')
      .insert(insert)
      .select()
      .single();
    if (error || !data) {
      set({ error: error?.message ?? 'Failed to create note' });
      return null;
    }
    const note = data as Note;
    set((s) => {
      const openNoteIds = [...s.openNoteIds, note.id];
      writeOpenNoteIds(openNoteIds);
      return { notes: [note, ...s.notes], activeNoteId: note.id, openNoteIds };
    });
    localStorage.setItem(ACTIVE_NOTE_KEY, note.id);
    return note.id;
  },

  updateNote: async (id, patch) => {
    // Persist locally-only fields first so they survive DB errors / missing columns
    if ('icon' in patch) writeLocalIcon(id, patch.icon ?? null);
    if ('player_editable' in patch) writeLocalEditable(id, patch.player_editable ?? null);

    const prev = get().notes.find((n) => n.id === id);
    if (!prev) return;
    const optimistic = { ...prev, ...patch };
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? optimistic : n)) }));

    let { error } = await supabase.from('notes').update(patch).eq('id', id);

    // Graceful degradation: if the error mentions ydoc_state the column
    // probably hasn't been migrated yet on this database. Retry without it
    // so the rest of the patch (title/body/etc.) is always saved regardless
    // of migration status — same fallback saveNote already relies on.
    if (error && 'ydoc_state' in patch && /ydoc_state/.test(error.message)) {
      const { ydoc_state: _dropped, ...corePatch } = patch as Record<string, unknown>;
      if (Object.keys(corePatch).length > 0) {
        ({ error } = await supabase.from('notes').update(corePatch).eq('id', id));
      } else {
        error = null;
      }
    }

    if (error) {
      if ('icon' in patch || 'player_editable' in patch) {
        // Already saved to localStorage — don't revert visual state.
        // DB columns may not exist yet; local values used until migrations run.
        set({ error: error.message });
      } else {
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? prev : n)),
          error: error.message,
        }));
      }
    }
  },

  transferNoteOwnership: async (noteId, newOwnerId) => {
    const prev = get().notes.find((n) => n.id === noteId);
    if (!prev) return;
    set((s) => ({
      notes: s.notes.map((n) => (n.id === noteId ? { ...n, owner_user_id: newOwnerId } : n)),
    }));
    const { error } = await supabase.rpc('transfer_note_ownership', {
      p_note_id: noteId,
      p_new_owner: newOwnerId,
    });
    if (error) {
      set((s) => ({ notes: s.notes.map((n) => (n.id === noteId ? prev : n)) }));
      throw error;
    }
  },

  updateDraft: (id, patch) => {
    set((s) => {
      const cur = s.drafts[id] ?? {};
      const note = s.notes.find((n) => n.id === id);
      const next: { title?: string; body?: string } = { ...cur };
      if (patch.title !== undefined) {
        if (note && patch.title === note.title) delete next.title;
        else next.title = patch.title;
      }
      if (patch.body !== undefined) {
        if (note && patch.body === note.body) delete next.body;
        else next.body = patch.body;
      }
      const drafts = { ...s.drafts };
      if (next.title === undefined && next.body === undefined) {
        delete drafts[id];
      } else {
        drafts[id] = next;
      }
      return { drafts };
    });
  },

  saveNote: async (id, ydocState) => {
    const { drafts, notes } = get();
    const draft = drafts[id];
    const note = notes.find((n) => n.id === id);
    if (!note) return;

    const patch: { title?: string; body?: string; ydoc_state?: string | null } = {};
    if (draft) {
      if (draft.title !== undefined && draft.title !== note.title) patch.title = draft.title;
      if (draft.body !== undefined && draft.body !== note.body) patch.body = draft.body;
    }
    // Always persist ydoc_state when provided (even if body text is unchanged).
    if (ydocState !== undefined) patch.ydoc_state = ydocState ?? null;

    if (Object.keys(patch).length === 0) {
      if (draft) {
        set((s) => {
          const d = { ...s.drafts };
          delete d[id];
          return { drafts: d };
        });
      }
      return;
    }
    // Optimistic: commit draft into the note and clear it.
    set((s) => {
      const d = { ...s.drafts };
      delete d[id];
      return {
        notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        drafts: d,
      };
    });
    let { error } = await supabase.from('notes').update(patch).eq('id', id);

    // Graceful degradation: if the error mentions ydoc_state the column
    // probably hasn't been migrated yet. Retry without it so body/title
    // are always saved regardless of migration status.
    if (error && 'ydoc_state' in patch && /ydoc_state/.test(error.message)) {
      const { ydoc_state: _dropped, ...corePatch } = patch as Record<string, unknown>;
      if (Object.keys(corePatch).length > 0) {
        const retry = await supabase.from('notes').update(corePatch).eq('id', id);
        error = retry.error;
      } else {
        error = null; // nothing left to save — treat as success
      }
    }

    if (error) {
      // Roll back optimistic update and restore draft so the user can retry.
      set((s) => ({
        notes: s.notes.map((n) => (n.id === id ? note : n)),
        drafts: draft ? { ...s.drafts, [id]: draft } : s.drafts,
        error: error!.message,
      }));
      // Propagate so callers (e.g. scheduleAutosave) know the save failed
      // and don't display a false "Saved" indicator.
      throw new Error(error.message);
    }
  },

  isDirty: (id) => {
    const d = get().drafts[id];
    return !!d && (d.title !== undefined || d.body !== undefined);
  },

  getNotePermissions: (noteId) => get().permissions[noteId] ?? [],

  setNotePermissions: async (noteId, rows) => {
    // Normalise: drop rows where neither flag is set.
    const cleaned = rows.filter((r) => r.can_view || r.can_edit);
    const prev = get().permissions[noteId] ?? [];

    // Optimistic update.
    set((s) => ({ permissions: { ...s.permissions, [noteId]: cleaned } }));
    writeLocalPerms(noteId, cleaned);

    // Sync to DB: delete all existing rows for this note, then upsert new.
    // Wrapped so a missing table (pre-migration) falls back silently.
    const delRes = await supabase.from('note_permissions').delete().eq('note_id', noteId);
    if (delRes.error && !/relation .* does not exist/i.test(delRes.error.message)) {
      set({ permissions: { ...get().permissions, [noteId]: prev }, error: delRes.error.message });
      return;
    }
    if (cleaned.length > 0) {
      const insRes = await supabase.from('note_permissions').insert(cleaned);
      if (insRes.error && !/relation .* does not exist/i.test(insRes.error.message)) {
        set({ permissions: { ...get().permissions, [noteId]: prev }, error: insRes.error.message });
        return;
      }
    }

    // Keep the legacy boolean pair roughly in sync so older clients still see
    // the right thing. visible_to_players = any can_view; player_editable =
    // every can_view row also has can_edit. (Approximation; new clients ignore.)
    const anyView = cleaned.some((r) => r.can_view);
    const allEdit = cleaned.length > 0 && cleaned.every((r) => r.can_edit);
    await supabase
      .from('notes')
      .update({ visible_to_players: anyView, player_editable: allEdit })
      .eq('id', noteId);
  },

  deleteNote: async (id) => {
    const prev = get().notes;
    set((s) => {
      const drafts = { ...s.drafts };
      delete drafts[id];
      const permissions = { ...s.permissions };
      delete permissions[id];
      // Drop the closed note's tab and, if it was active, fall back to a
      // neighbouring tab (right, then left) so the editor stays populated.
      const idx = s.openNoteIds.indexOf(id);
      const openNoteIds = s.openNoteIds.filter((x) => x !== id);
      if (openNoteIds.length !== s.openNoteIds.length) writeOpenNoteIds(openNoteIds);
      const activeNoteId = s.activeNoteId === id
        ? (idx >= 0 ? (openNoteIds[idx] ?? openNoteIds[idx - 1] ?? null) : null)
        : s.activeNoteId;
      return {
        notes: s.notes.filter((n) => n.id !== id),
        activeNoteId,
        openNoteIds,
        drafts,
        permissions,
      };
    });
    const nextActive = get().activeNoteId;
    if (nextActive) localStorage.setItem(ACTIVE_NOTE_KEY, nextActive);
    else if (localStorage.getItem(ACTIVE_NOTE_KEY) === id) localStorage.removeItem(ACTIVE_NOTE_KEY);
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) set({ notes: prev, error: error.message });
  },

  moveNote: async (id, folderId) => {
    await get().updateNote(id, { folder_id: folderId });
  },

  reorderNotes: async (folderKey, orderedIds) => {
    const campaignId = get().notes.find((n) => (n.folder_id ?? 'root') === folderKey)?.campaign_id
      ?? get().notes[0]?.campaign_id;
    const userId = useSession.getState().userId;
    if (!campaignId || !userId) return;

    const prev = get().noteOrder[folderKey];
    set((s) => ({ noteOrder: { ...s.noteOrder, [folderKey]: orderedIds } }));

    const { error } = await supabase
      .from('note_sort_order')
      .upsert(
        { user_id: userId, campaign_id: campaignId, folder_key: folderKey, order_ids: orderedIds, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,campaign_id,folder_key' }
      );
    if (error) {
      set((s) => ({
        noteOrder: prev === undefined
          ? Object.fromEntries(Object.entries(s.noteOrder).filter(([k]) => k !== folderKey))
          : { ...s.noteOrder, [folderKey]: prev },
        error: error.message,
      }));
    }
  },

  createFolder: async (campaignId, name, parentId) => {
    const { data, error } = await supabase
      .from('note_folders')
      .insert({ campaign_id: campaignId, name: name || 'New Folder', parent_id: parentId })
      .select()
      .single();
    if (error || !data) {
      set({ error: error?.message ?? 'Failed to create folder' });
      return null;
    }
    const folder = data as Folder;
    set((s) => ({ folders: [...s.folders, folder] }));
    return folder.id;
  },

  renameFolder: async (id, name) => {
    const prev = get().folders.find((f) => f.id === id);
    if (!prev) return;
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }));
    const { error } = await supabase.from('note_folders').update({ name }).eq('id', id);
    if (error) {
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? prev : f)),
        error: error.message,
      }));
    }
  },

  deleteFolder: async (id) => {
    const prev = { folders: get().folders, notes: get().notes };
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      notes: s.notes.map((n) => (n.folder_id === id ? { ...n, folder_id: null } : n)),
    }));
    const { error } = await supabase.from('note_folders').delete().eq('id', id);
    if (error) set({ folders: prev.folders, notes: prev.notes, error: error.message });
  },

  moveFolder: async (id, parentId) => {
    if (id === parentId) return;
    const folders = get().folders;
    const isDescendant = (candidateId: string | null): boolean => {
      if (!candidateId) return false;
      if (candidateId === id) return true;
      const parent = folders.find((f) => f.id === candidateId);
      return parent ? isDescendant(parent.parent_id) : false;
    };
    if (isDescendant(parentId)) return;
    const prev = folders.find((f) => f.id === id);
    if (!prev) return;
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, parent_id: parentId } : f)),
    }));
    const { error } = await supabase
      .from('note_folders')
      .update({ parent_id: parentId })
      .eq('id', id);
    if (error) {
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? prev : f)),
        error: error.message,
      }));
    }
  },

  toggleFolderExpanded: (id) => {
    expandedMap[id] = !(expandedMap[id] ?? true);
    persistExpanded(expandedMap);
    // Force rerender by touching state (folders array identity change)
    set((s) => ({ folders: [...s.folders] }));
  },

  isFolderExpanded: (id) => expandedMap[id] ?? true,
}));

// ─── Permission selectors (pure helpers) ───────────────────────────────────
// The new per-user matrix is the source of truth. Legacy boolean fields are
// still honoured so notes created before the migration keep working.

export function canViewNote(
  note: Note,
  userId: string | null,
  role: 'gm' | 'cogm' | 'player' | null,
  perms: NotePermission[],
): boolean {
  if (!userId) return false;
  if (role === 'gm' || role === 'cogm') return true;
  if (note.owner_user_id === userId) return true;
  if (perms.some((p) => p.user_id === userId && p.can_view)) return true;
  // Legacy fallback for notes not migrated to the matrix yet.
  if (note.visible_to_players) return true;
  return false;
}

export function canEditNote(
  note: Note,
  userId: string | null,
  role: 'gm' | 'cogm' | 'player' | null,
  perms: NotePermission[],
): boolean {
  if (!userId) return false;
  if (role === 'gm' || role === 'cogm') return true;
  if (note.owner_user_id === userId) return true;
  if (perms.some((p) => p.user_id === userId && p.can_edit)) return true;
  // Legacy fallback.
  if (note.visible_to_players && note.player_editable === true) return true;
  return false;
}
