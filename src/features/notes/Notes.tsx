import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { useNotes, canViewNote, canEditNote, EMPTY_PERMS, type Folder, type Note } from './notesStore';
import { useSession } from '../session/sessionStore';
import { supabase } from '../../lib/supabase';
import { userCollabColor, type Collaborator } from './collabProvider';
import PageHeader from '../../components/PageHeader';
import { SharePopover } from './SharePopover';
import {
  ChevronRight,
  ChevronLeft,
  Network,
  Folder as FolderIcon,
  FolderPlus,
  FilePlus,
  Trash2,
  Eye,
  EyeOff,
  Pencil,
  PencilLine,
  Search,
  HelpCircle,
  ArrowUpAZ,
  Clock,
  Palette,
  Share2,
  Check,
  Loader2,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ChevronDown,
  GripVertical,
  X,
  Plus,
} from 'lucide-react';
import { useVisibilityReload } from '../../hooks/useVisibilityReload';
import { useCampaignSettings } from './campaignSettingsStore';

// ─── Folder colour palette ───────────────────────────────────────────────────
const FOLDER_COLORS = [
  { color: '#60a5fa', label: 'Blue' },
  { color: '#f87171', label: 'Red' },
  { color: '#fbbf24', label: 'Amber' },
  { color: '#34d399', label: 'Green' },
  { color: '#a78bfa', label: 'Purple' },
  { color: '#fb923c', label: 'Orange' },
  { color: '#f472b6', label: 'Pink' },
  { color: '#94a3b8', label: 'Slate' },
] as const;

// ─── Note icon palette (shared with the Mind Map — see noteIcons.tsx) ────────
import {
  NOTE_ICONS,
  NOTE_ICON_COLORS,
  parseNoteIcon,
  formatNoteIcon,
  NoteIconDisplay,
} from './noteIcons';

// ─── Note share status (sidebar icon only) ────────────────────────────────
type ShareStatus = 'private' | 'shared_view' | 'shared_edit';
function getShareStatus(
  note: { visible_to_players: boolean; player_editable: boolean | null },
  perms: { can_view: boolean; can_edit: boolean }[],
): ShareStatus {
  const anyEdit = perms.some((p) => p.can_edit) || (note.visible_to_players && note.player_editable === true);
  const anyView = perms.some((p) => p.can_view) || note.visible_to_players;
  if (anyEdit) return 'shared_edit';
  if (anyView) return 'shared_view';
  return 'private';
}

import { buildWikiIndex } from './wikiIndex';
import { remarkNoteDecorators, remarkFoldMarks, preprocessDecorators } from './decorators';
import { Secret } from './Secret';
import { PartyRefSpan } from './PartyTooltip';
import { useParty } from '../party/partyStore';
import { useNpcStore } from '../npcs/npcStore';
import { useChat } from '../chat/chatStore';

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return (children as React.ReactNode[]).map(extractText).join('');
  if (children !== null && typeof children === 'object' && 'props' in (children as object)) {
    const el = children as { props: { children?: React.ReactNode } };
    return extractText(el.props.children);
  }
  return '';
}

function toggleSecret(body: string, index: number): string {
  const fence = /```[\s\S]*?```/g;
  const segments: Array<{ code: boolean; text: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(body)) !== null) {
    if (m.index > last) segments.push({ code: false, text: body.slice(last, m.index) });
    segments.push({ code: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ code: false, text: body.slice(last) });
  let count = 0;
  return segments
    .map((seg) => {
      if (seg.code) return seg.text;
      return seg.text.replace(/\{\{([\s\S]*?)\}\}/g, (match, inner: string) => {
        if (count++ === index) {
          return inner.startsWith('!') ? `{{${inner.slice(1)}}}` : `{{!${inner}}}`;
        }
        return match;
      });
    })
    .join('');
}
import { QuickDiceButton } from '../dice/QuickDice';
import { useQuickDice } from '../dice/quickDiceStore';
import { LiveEditor, type LiveEditorHandle } from './LiveEditor';

// ─── Module-level types shared by Notes, FolderNode, and NoteRow ─────────
/** A user currently viewing a note (from Supabase Realtime Presence). */
type PresenceUser = { userId: string; userName: string; color: string };

type DragItem =
  | { kind: 'note'; id: string }
  | { kind: 'folder'; id: string };

/** Applies a user's saved manual drag order (Custom sort mode) to a list of
 *  notes already scoped to one folder/root group. Notes not yet present in
 *  the saved order (e.g. created after the last reorder) are appended at
 *  the end, keeping their existing relative order. */
function applyNoteOrder(list: Note[], folderKey: string, noteOrder: Record<string, string[]>): Note[] {
  const order = noteOrder[folderKey];
  if (!order || order.length === 0) return list;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ai = pos.get(a.id);
    const bi = pos.get(b.id);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return 0;
  });
}

export default function Notes() {
  const campaignId = useSession((s) => s.campaignId);
  const userId = useSession((s) => s.userId);
  const displayName = useSession((s) => s.displayName);
  const role = useSession((s) => s.role);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const isGM = (role === 'gm' || role === 'cogm') && !viewAsPlayer;

  // ── Store state (must come before refs that depend on activeNoteId) ───────
  const notes = useNotes((s) => s.notes);
  const folders = useNotes((s) => s.folders);
  const drafts = useNotes((s) => s.drafts);
  const permissions = useNotes((s) => s.permissions);
  const noteOrder = useNotes((s) => s.noteOrder);
  const reorderNotes = useNotes((s) => s.reorderNotes);
  const activeNoteId = useNotes((s) => s.activeNoteId);
  const openNoteIds = useNotes((s) => s.openNoteIds);
  const closeNote = useNotes((s) => s.closeNote);
  const moveOpenNote = useNotes((s) => s.moveOpenNote);
  const loadForCampaign = useNotes((s) => s.loadForCampaign);
  const subscribe = useNotes((s) => s.subscribe);
  const setActiveNote = useNotes((s) => s.setActiveNote);
  const createNote = useNotes((s) => s.createNote);
  const updateNote = useNotes((s) => s.updateNote);
  const updateDraft = useNotes((s) => s.updateDraft);
  const saveNote = useNotes((s) => s.saveNote);
  const deleteNote = useNotes((s) => s.deleteNote);

  const canEdit = (n: Note) => canEditNote(n, userId, role, permissions[n.id] ?? []);
  const canView = (n: Note) => canViewNote(n, userId, role, permissions[n.id] ?? []);
  const createFolder = useNotes((s) => s.createFolder);
  const renameFolder = useNotes((s) => s.renameFolder);
  const deleteFolder = useNotes((s) => s.deleteFolder);
  const moveNote = useNotes((s) => s.moveNote);
  const moveFolder = useNotes((s) => s.moveFolder);
  const toggleFolderExpanded = useNotes((s) => s.toggleFolderExpanded);
  const isFolderExpanded = useNotes((s) => s.isFolderExpanded);

  const homebrewItems = useStore((s) => s.homebrewItems);
  const homebrewSpells = useStore((s) => s.homebrewSpells);
  const party = useParty((s) => s.party);
  const loadParty = useParty((s) => s.loadForCampaign);
  const subscribeParty = useParty((s) => s.subscribe);
  const npcs = useNpcStore((s) => s.npcs);
  const rollFormula = useQuickDice((s) => s.rollFormula);

  const loadSettings = useCampaignSettings((s) => s.load);
  const subscribeSettings = useCampaignSettings((s) => s.subscribe);
  const campaignSettings = useCampaignSettings((s) => s.settings);

  // ── Ref to the active LiveEditor (exposes getYdocState) ──────────────────
  const editorRef = useRef<LiveEditorHandle>(null);
  /** Heading to scroll to after the next editor remount — used by
   *  `[[Note#Heading]]` cross-doc jumps where the editor for the target
   *  note hasn't mounted yet at click time. */
  const pendingHeadingRef = useRef<string | null>(null);

  // ── Image upload (toolbar button + editor paste) ─────────────────────────
  // Uploads to the note-images bucket and returns a permanent public URL, so
  // embedded images never expire (unlike pasted external/CDN links). Path is
  // `{campaignId}/{uuid}.{ext}` — the campaign prefix is enforced by RLS.
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const uploadImageFile = useCallback(async (file: File): Promise<string | null> => {
    if (!campaignId) return null;
    if (!file.type.startsWith('image/')) return null;
    if (file.size > 10 * 1024 * 1024) return null; // 10 MB cap
    setImageUploading(true);
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${campaignId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('note-images')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) { console.error('[notes] image upload failed', error); return null; }
      return supabase.storage.from('note-images').getPublicUrl(path).data.publicUrl;
    } finally {
      setImageUploading(false);
    }
  }, [campaignId]);

  // ── Sidebar collapse / resize (persisted) ────────────────────────────────
  const SIDEBAR_W_KEY = 'dnd-gm:notesSidebarWidth';
  const SIDEBAR_COLLAPSED_KEY = 'dnd-gm:notesSidebarCollapsed';
  const SIDEBAR_W_MIN = 160;
  const SIDEBAR_W_MAX = 480;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = parseInt(localStorage.getItem(SIDEBAR_W_KEY) ?? '224', 10);
    return Number.isFinite(raw) ? Math.max(SIDEBAR_W_MIN, Math.min(SIDEBAR_W_MAX, raw)) : 224;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  );
  const beginSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(SIDEBAR_W_MIN, Math.min(SIDEBAR_W_MAX, startW + (ev.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidthRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  // ── Autosave ──────────────────────────────────────────────────────────────
  type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref: callbacks read this instead of closing over stale activeNoteId.
  const activeNoteIdRef = useRef(activeNoteId);
  activeNoteIdRef.current = activeNoteId;
  // Tracks the previously-active note so we can save it on switch.
  const prevNoteIdRef = useRef<string | null>(null);

  // ── Live collaborators (same note, from Yjs awareness) ───────────────────
  const [activeCollaborators, setActiveCollaborators] = useState<Collaborator[]>([]);

  // ── Campaign-wide presence (sidebar: who has which note open) ─────────────
  const [notePresence, setNotePresence] = useState<Record<string, PresenceUser[]>>({});
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Tracks a channel whose teardown is delayed (see presence effect below) so
  // a React 19 StrictMode phantom remount can cancel it and reuse the live
  // channel instead of racing Supabase's topic registry.
  const pendingPresenceTeardownRef = useRef<{
    channel: ReturnType<typeof supabase.channel>;
    topic: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // ── Load data for campaign ────────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    const unsub = subscribe(campaignId);
    loadSettings(campaignId);
    const unsubSettings = subscribeSettings(campaignId);
    loadParty(campaignId);
    const unsubParty = subscribeParty(campaignId);
    return () => { unsub(); unsubSettings(); unsubParty(); };
  }, [campaignId, loadForCampaign, subscribe, loadSettings, subscribeSettings, loadParty, subscribeParty]);

  // Re-fetch when the tab becomes visible again (stale realtime guard)
  useVisibilityReload(() => {
    if (campaignId) loadForCampaign(campaignId);
  });

  // ── Debounced autosave (2.5 s after last change) ─────────────────────────
  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null;
      const noteId = activeNoteIdRef.current;
      if (!noteId) return;
      setSaveStatus('saving');
      try {
        await useNotes.getState().saveNote(noteId, editorRef.current?.getYdocState());
        setSaveStatus('saved');
        // "Saved" stays visible until the next autosave cycle begins.
      } catch {
        setSaveStatus('failed');
      }
    }, 2500);
  }, []); // stable — uses refs, not closed-over state

  // ── Campaign presence channel ─────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId || !userId) return;
    const { color } = userCollabColor(userId);
    const topic = `notes-presence:${campaignId}`;

    // React 19 StrictMode double-invokes this effect on mount (setup →
    // cleanup → setup again) within the same synchronous tick. Supabase's
    // RealtimeClient.channel(topic) returns the SAME channel object while a
    // topic is still registered, and a channel mid-teardown can neither be
    // re-listened-on (throws if still 'joined'/'joining') nor re-subscribed
    // (silently no-ops until it reaches 'closed', which only happens after a
    // server round-trip). So if a teardown from a phantom first mount is
    // still pending below, cancel it and reuse the live channel instead of
    // racing it.
    const pending = pendingPresenceTeardownRef.current;
    if (pending && pending.topic === topic) {
      clearTimeout(pending.timer);
      pendingPresenceTeardownRef.current = null;
      presenceChannelRef.current = pending.channel;
      return () => {
        const reused = pending.channel;
        void reused.untrack();
        presenceChannelRef.current = null;
        setNotePresence({});
        pendingPresenceTeardownRef.current = {
          channel: reused,
          topic,
          // Delay teardown so the untrack message has time to flush over the
          // WebSocket before the connection is closed (see below).
          timer: setTimeout(() => {
            pendingPresenceTeardownRef.current = null;
            supabase.removeChannel(reused);
          }, 400),
        };
      };
    }

    const ch = supabase.channel(topic);
    presenceChannelRef.current = ch;

    // Rebuild the presence map from the full Supabase Presence state.
    // Called on both 'sync' (initial + any change) and 'leave' (insurance —
    // 'sync' should fire too, but 'leave' fires first and ensures instant
    // removal even before the next full sync arrives).
    const syncPresence = () => {
      const state = ch.presenceState<{
        noteId: string | null;
        userId: string;
        userName: string;
        color: string;
      }>();
      const next: Record<string, PresenceUser[]> = {};
      // Deduplicate: a user with multiple browser tabs should only appear once
      // per note. Key: `${noteId}:${userId}`.
      const seen = new Set<string>();
      for (const key in state) {
        for (const meta of state[key]) {
          // Exclude self and entries with no note open.
          if (meta.userId === userId || !meta.noteId) continue;
          const dedupeKey = `${meta.noteId}:${meta.userId}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          (next[meta.noteId] ??= []).push({
            userId: meta.userId,
            userName: meta.userName,
            color: meta.color,
          });
        }
      }
      setNotePresence(next);
    };

    ch.on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({
            noteId: activeNoteIdRef.current,
            userId,
            userName: displayName ?? userId,
            color,
          });
        }
      });

    return () => {
      // Fire untrack first so the departure propagates to peers.
      void ch.untrack();
      presenceChannelRef.current = null;
      setNotePresence({});
      // Delay channel teardown so the untrack message has time to flush over
      // the WebSocket before the connection is closed. Without the delay,
      // peers keep seeing the stale dot for up to 30 seconds. The delay is
      // cancelable (see top of this effect) so a StrictMode phantom remount
      // can reuse this channel instead of colliding with it mid-teardown.
      pendingPresenceTeardownRef.current = {
        channel: ch,
        topic,
        timer: setTimeout(() => {
          pendingPresenceTeardownRef.current = null;
          supabase.removeChannel(ch);
        }, 400),
      };
    };
  }, [campaignId, userId, displayName]);

  // ── Re-broadcast which note is open whenever the selection changes ────────
  useEffect(() => {
    const ch = presenceChannelRef.current;
    if (!ch || !userId) return;
    const { color } = userCollabColor(userId);
    void ch.track({
      noteId: activeNoteId,
      userId,
      userName: displayName ?? userId,
      color,
    });
  }, [activeNoteId, userId, displayName]);

  // ── Save the previous note when switching away from it ───────────────────
  useEffect(() => {
    const prev = prevNoteIdRef.current;
    prevNoteIdRef.current = activeNoteId;
    if (!prev || prev === activeNoteId) return;

    // Clear any pending debounce — we're saving immediately.
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    // Save title/body draft of previous note. ydoc_state was already persisted
    // by the most-recent autosave cycle; we don't pass it here because
    // editorRef now points to the new note's editor.
    void useNotes.getState().saveNote(prev).catch(() => {});

    // Reset the status indicator — "Saved" from the previous note shouldn't
    // bleed over to the freshly-opened one.
    setSaveStatus('idle');

    // Honor a pending [[Note#Heading]] jump after the new editor has mounted.
    const heading = pendingHeadingRef.current;
    if (heading) {
      pendingHeadingRef.current = null;
      const tryScroll = (attempt: number) => {
        if (editorRef.current?.scrollToHeading(heading)) return;
        if (attempt < 10) setTimeout(() => tryScroll(attempt + 1), 60);
      };
      setTimeout(() => tryScroll(0), 80);
    }
  }, [activeNoteId]);

  // ── Save on unmount (navigate away, campaign change, etc.) ───────────────
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      const noteId = activeNoteIdRef.current;
      if (noteId) void useNotes.getState().saveNote(noteId).catch(() => {});
    };
  }, []);

  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverId, setDragOverId] = useState<string | 'root' | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showSharePopover, setShowSharePopover] = useState(false);
  // Read-only view: which fold-marked headings/list items are collapsed.
  // View-only state, not persisted — resets whenever the active note changes.
  const [collapsedFolds, setCollapsedFolds] = useState<Set<string>>(new Set());
  const toggleFold = useCallback((id: string) => {
    setCollapsedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const [sortMode, setSortModeState] = useState<'updated' | 'alpha' | 'custom'>(() => {
    const stored = localStorage.getItem('dnd-gm:noteSortMode');
    return stored === 'alpha' || stored === 'custom' ? stored : 'updated';
  });
  const setSortMode = (mode: 'updated' | 'alpha' | 'custom') => {
    localStorage.setItem('dnd-gm:noteSortMode', mode);
    setSortModeState(mode);
  };

  // Drag-to-reorder (Custom sort mode) — separate from the folder-move drag
  // system below (dragData/dragOverId/onDrop), which stays GM-only. Anyone
  // who can see a note can reorder it within its current folder/root group.
  const [reorderDragId, setReorderDragId] = useState<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const clearReorderDrag = () => {
    setReorderDragId(null);
    setReorderOverId(null);
  };
  const handleReorderDrop = (folderKey: string, groupNotes: Note[], targetId: string) => {
    const fromId = reorderDragId;
    setReorderDragId(null);
    setReorderOverId(null);
    if (!fromId || fromId === targetId) return;
    const ids = groupNotes.map((n) => n.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = ids.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    reorderNotes(folderKey, next);
    if (sortMode !== 'custom') setSortMode('custom');
  };

  const visibleNotes = useMemo(
    () => (isGM ? notes : notes.filter((n) => canViewNote(n, userId, role, permissions[n.id] ?? []))),
    [isGM, notes, userId, role, permissions]
  );

  const sortedVisibleNotes = useMemo(
    () =>
      sortMode === 'alpha'
        ? [...visibleNotes].sort((a, b) =>
            (a.title || 'Untitled').localeCompare(b.title || 'Untitled')
          )
        : visibleNotes,
    [visibleNotes, sortMode]
  );
  const sortedFolders = useMemo(
    () =>
      sortMode === 'alpha'
        ? [...folders].sort((a, b) => a.name.localeCompare(b.name))
        : folders,
    [folders, sortMode]
  );

  const active = visibleNotes.find((n) => n.id === activeNoteId) ?? null;

  // Open tabs, resolved to the notes the viewer can actually see (a tab whose
  // note was deleted or hidden simply drops out). Kept in the store's tab order.
  const openNotes = useMemo(() => {
    const byId = new Map(visibleNotes.map((n) => [n.id, n]));
    return openNoteIds.map((id) => byId.get(id)).filter((n): n is Note => !!n);
  }, [openNoteIds, visibleNotes]);

  // Which tab the pointer is dragging over (for reordering).
  const [tabDragId, setTabDragId] = useState<string | null>(null);

  useEffect(() => {
    setCollapsedFolds(new Set());
  }, [active?.id]);

  const wikiIndex = useMemo(
    () => buildWikiIndex(homebrewItems, homebrewSpells, notes),
    [homebrewItems, homebrewSpells, notes]
  );
  // Paint `@{Name}` decorations with the player's chosen colour (or the NPC
  // faction colour) so mentions read like a roster, not just a generic chip.
  // Player colours live on campaign_members.color (loaded via the chat
  // store) — we join through party.owner_user_id to find them.
  const chatMembers = useChat((s) => s.members);
  const mentionColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of party) {
      if (!p.name) continue;
      const ownerColor = p.owner_user_id ? chatMembers[p.owner_user_id]?.color : undefined;
      out[p.name.trim().toLowerCase()] = ownerColor ?? '#94a3b8';
    }
    for (const n of npcs) {
      if (n.name) out[n.name.trim().toLowerCase()] = n.factionColor || '#fbbf24';
    }
    return out;
  }, [party, npcs, chatMembers]);
  const plugins = useMemo(
    () => [remarkGfm, remarkNoteDecorators(wikiIndex, mentionColors), remarkFoldMarks()],
    [wikiIndex, mentionColors]
  );

  const q = query.toLowerCase().trim();
  const matchingNoteIds = useMemo(() => {
    if (!q) return null;
    return new Set(
      visibleNotes
        .filter(
          (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
        )
        .map((n) => n.id)
    );
  }, [q, visibleNotes]);

  const onCreateNote = async (folderId: string | null) => {
    if (!campaignId) return;
    const ownerId = isGM ? null : userId;
    await createNote(campaignId, folderId, ownerId);
  };

  const onDrop = (target: string | null) => {
    if (!isGM) return;
    const raw = dragData;
    if (!raw) return;
    if (raw.kind === 'note') moveNote(raw.id, target);
    else moveFolder(raw.id, target);
    setDragOverId(null);
    setDragData(null);
  };

  const [dragData, setDragData] = useState<DragItem | null>(null);

  const { hiddenFolderIds } = campaignSettings;
  const rootFolders = sortedFolders.filter(
    (f) => f.parent_id === null && (isGM || !hiddenFolderIds.includes(f.id))
  );
  const rootNotesBase = sortedVisibleNotes.filter((n) => n.folder_id === null);
  const rootNotes = sortMode === 'custom' ? applyNoteOrder(rootNotesBase, 'root', noteOrder) : rootNotesBase;

  const onWikiClick = (href: string) => {
    const [path, hash] = href.split('#');
    // Cross-doc note links: switch the active note in-place and scroll to a
    // heading if one was supplied as `note-<id>?h=<slug>`.
    if (path === '/notes' && hash?.startsWith('note-')) {
      const [target, headingSearch] = hash.slice('note-'.length).split('?h=');
      setActiveNote(target);
      if (headingSearch) {
        // Defer until the new note's editor mounts.
        pendingHeadingRef.current = decodeURIComponent(headingSearch);
      }
      return;
    }
    navigate(path + (hash ? `#${hash}` : ''));
  };

  // Read-only view: h1-h6 renderer that prepends a collapse arrow when the
  // heading carries a `data-fold-id` (assigned by remarkFoldMarks).
  const renderFoldableHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    function FoldableHeading({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
      const p = props as Record<string, unknown>;
      const foldId = p['data-fold-id'] as string | undefined;
      if (!foldId) return <Tag {...props}>{children}</Tag>;
      const collapsed = collapsedFolds.has(foldId);
      return (
        <Tag {...props}>
          <FoldArrowBtn collapsed={collapsed} onToggle={() => toggleFold(foldId)} />
          {children}
        </Tag>
      );
    };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Notebook">
        <div className="relative flex items-center gap-2">
          <QuickDiceButton compact />
          <button
            onClick={() => navigate('/notes/mind-map')}
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1"
            title="Visualise links between notes"
          >
            <Network size={12} /> Mind Map
          </button>
          <button
            onClick={() => setShowLegend((s) => !s)}
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1"
            title="Decorator cheatsheet"
          >
            <HelpCircle size={12} /> Syntax
          </button>
          {showLegend && (
            <div className="absolute right-0 top-full mt-2 z-20 w-80 bg-slate-900 border border-slate-700 rounded shadow-lg p-3 text-xs space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Note decorators
              </div>
              <LegendRow syntax="&{Waterdeep}" label="location (click → note)">
                <span className="note-deco note-loc">Waterdeep</span>
              </LegendRow>
              <LegendRow syntax="@{Aria}" label="player ref (hover → stats)">
                <span className="note-deco note-player">Aria</span>
              </LegendRow>
              <LegendRow syntax="?{retrieve key}" label="dependency">
                <span className="note-deco note-dep">retrieve key</span>
              </LegendRow>
              <LegendRow syntax="!{reach level 5}" label="milestone">
                <span className="note-deco note-milestone">reach level 5</span>
              </LegendRow>
              <LegendRow syntax="${crown of stars}" label="artifact">
                <span className="note-deco note-artifact">crown of stars</span>
              </LegendRow>
              <LegendRow syntax="%%GM aside%%" label="comment">
                <span className="note-comment">GM aside</span>
              </LegendRow>
              <LegendRow syntax="[[Longsword]]" label="wiki link">
                <span className="note-link">Longsword</span>
              </LegendRow>
              <LegendRow syntax="{{spoiler}}" label="secret">
                <span className="note-secret">spoiler</span>
              </LegendRow>
              <LegendRow syntax="$1d20 + 8$" label="dice roll">
                <button className="note-dice" style={{ pointerEvents: 'none' }}>🎲 1d20 + 8</button>
              </LegendRow>
            </div>
          )}
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 flex">
        {sidebarCollapsed ? (
          <button
            onClick={toggleSidebar}
            title="Show notes sidebar"
            className="w-7 shrink-0 border-r border-slate-800 bg-slate-950 hover:bg-slate-900 flex items-start justify-center pt-2 text-slate-500 hover:text-slate-200"
          >
            <ChevronRight size={14} />
          </button>
        ) : (
        <aside
          className="border-r border-slate-800 flex flex-col bg-slate-950 relative shrink-0"
          style={{ width: sidebarWidth }}
        >
          <div className="px-2 py-1.5 border-b border-slate-800 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
              Explorer
            </div>
            <div className="flex gap-0.5">
              <button
                onClick={toggleSidebar}
                title="Hide sidebar"
                className="p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                onClick={() => {
                  const next = sortMode === 'updated' ? 'alpha' : sortMode === 'alpha' ? 'custom' : 'updated';
                  setSortMode(next);
                }}
                title={
                  sortMode === 'updated' ? 'Recent first — click for A–Z'
                  : sortMode === 'alpha' ? 'A–Z order — click for your custom order'
                  : 'Custom order (drag notes to reorder) — click for recent first'
                }
                className="p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded"
              >
                {sortMode === 'updated' ? <Clock size={12} /> : sortMode === 'alpha' ? <ArrowUpAZ size={12} /> : <GripVertical size={12} />}
              </button>
              <button
                onClick={() => onCreateNote(null)}
                title="New note"
                className="p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded"
              >
                <FilePlus size={12} />
              </button>
              <button
                onClick={async () => {
                  if (!campaignId) return;
                  const id = await createFolder(campaignId, 'New Folder', null);
                  if (id) {
                    if (isGM) {
                      setRenamingFolderId(id);
                      setRenameValue('New Folder');
                    }
                  }
                }}
                title="New folder"
                className="p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded"
              >
                <FolderPlus size={12} />
              </button>
            </div>
          </div>

          <div className="px-2 py-1.5 border-b border-slate-800">
            <div className="relative">
              <Search
                size={11}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-slate-900 border border-slate-800 rounded pl-5 pr-1.5 py-1 text-[11px] font-mono focus:outline-none focus:border-sky-700"
              />
            </div>
          </div>

          <div
            className={`flex-1 overflow-y-auto py-1 font-mono text-[12px] ${
              dragOverId === 'root' ? 'bg-sky-950/20' : ''
            }`}
            onDragOver={(e) => {
              if (!isGM) return;
              e.preventDefault();
              setDragOverId('root');
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDragOverId(null);
            }}
            onDrop={(e) => {
              if (!isGM) return;
              e.preventDefault();
              onDrop(null);
            }}
          >
            {isGM && folders.length === 0 && visibleNotes.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-slate-600 italic font-sans">
                {isGM
                  ? 'No notes yet. Create one with the file icon above.'
                  : 'No notes shared with players yet.'}
              </div>
            )}
            {rootFolders.map((f) => (
              <FolderNode
                key={f.id}
                folder={f}
                depth={0}
                folders={sortedFolders}
                notes={sortedVisibleNotes}
                activeNoteId={activeNoteId}
                matching={matchingNoteIds}
                renamingFolderId={renamingFolderId}
                renameValue={renameValue}
                confirmingId={confirmingId}
                dragOverId={dragOverId}
                isGM={isGM}
                hiddenFolderIds={hiddenFolderIds}
                notePresence={notePresence}
                isExpanded={isFolderExpanded}
                onToggle={toggleFolderExpanded}
                onSelectNote={(id) => {
                  setActiveNote(id);
                }}
                onCreateNote={onCreateNote}
                onCreateFolder={async (parentId) => {
                  if (!campaignId) return;
                  const id = await createFolder(campaignId, 'New Folder', parentId);
                  if (id) {
                    setRenamingFolderId(id);
                    setRenameValue('New Folder');
                  }
                }}
                onStartRename={(id, name) => {
                  setRenamingFolderId(id);
                  setRenameValue(name);
                }}
                onFinishRename={(id) => {
                  if (renameValue.trim()) renameFolder(id, renameValue.trim());
                  setRenamingFolderId(null);
                }}
                onCancelRename={() => setRenamingFolderId(null)}
                onRenameChange={setRenameValue}
                onStartDeleteNote={setConfirmingId}
                onDeleteNote={(id) => {
                  deleteNote(id);
                  setConfirmingId(null);
                }}
                onCancelDelete={() => setConfirmingId(null)}
                onStartDeleteFolder={setConfirmingId}
                onDeleteFolder={(id) => {
                  deleteFolder(id);
                  setConfirmingId(null);
                }}
                onDragStart={setDragData}
                onDragEnd={() => setDragData(null)}
                onDragOverItem={setDragOverId}
                onDrop={onDrop}
                noteOrder={noteOrder}
                sortMode={sortMode}
                reorderDragId={reorderDragId}
                reorderOverId={reorderOverId}
                onReorderDragStart={setReorderDragId}
                onReorderDragEnd={clearReorderDrag}
                onReorderOver={setReorderOverId}
                onReorderDrop={handleReorderDrop}
              />
            ))}
            {rootNotes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                depth={0}
                active={n.id === activeNoteId}
                dimmed={matchingNoteIds !== null && !matchingNoteIds.has(n.id)}
                confirming={confirmingId === n.id}
                isGM={isGM}
                presentUsers={notePresence[n.id] ?? []}
                onSelect={() => {
                  setActiveNote(n.id);
                }}
                onStartDelete={() => setConfirmingId(n.id)}
                onDelete={() => {
                  deleteNote(n.id);
                  setConfirmingId(null);
                }}
                onCancelDelete={() => setConfirmingId(null)}
                onDragStart={() => setDragData({ kind: 'note', id: n.id })}
                onDragEnd={() => setDragData(null)}
                reorderDragging={reorderDragId === n.id}
                reorderActive={reorderDragId !== null}
                reorderOver={reorderOverId === n.id}
                onReorderDragStart={() => setReorderDragId(n.id)}
                onReorderDragEnd={clearReorderDrag}
                onReorderOver={setReorderOverId}
                onReorderDrop={() => handleReorderDrop('root', rootNotes, n.id)}
              />
            ))}
          </div>
          {/* Resize handle — 4px vertical strip on the right edge */}
          <div
            onMouseDown={beginSidebarResize}
            title="Drag to resize"
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-sky-700/50 z-10"
          />
        </aside>
        )}

        <section className="flex-1 min-w-0 flex flex-col">
          {/* ── Open-note tabs ─────────────────────────────────────────────
              Multiple notes stay open at once; click a tab to switch, drag to
              reorder, × to close. Opening any note (sidebar, wiki link, or the
              dashboard peek) appends a tab automatically. */}
          {openNotes.length > 0 && (
            <div className="flex items-stretch border-b border-slate-800 bg-slate-950 overflow-x-auto">
              {openNotes.map((n) => {
                const isActive = n.id === activeNoteId;
                return (
                  <div
                    key={n.id}
                    draggable
                    onDragStart={(e) => { setTabDragId(n.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { if (tabDragId && tabDragId !== n.id) e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (tabDragId && tabDragId !== n.id) moveOpenNote(tabDragId, n.id);
                      setTabDragId(null);
                    }}
                    onDragEnd={() => setTabDragId(null)}
                    onClick={() => setActiveNote(n.id)}
                    onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeNote(n.id); } }}
                    title={n.title || 'Untitled'}
                    className={`group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 max-w-[180px] border-r border-slate-800 cursor-pointer shrink-0 ${
                      isActive
                        ? 'bg-slate-900 text-slate-100 border-b-2 border-b-sky-600'
                        : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                    }`}
                  >
                    <NoteIconDisplay iconId={n.icon} size={12} />
                    <span className="truncate text-xs">{n.title || 'Untitled'}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeNote(n.id); }}
                      title="Close tab"
                      className={`p-0.5 rounded hover:bg-slate-700 shrink-0 ${
                        isActive ? 'text-slate-400 hover:text-slate-100' : 'text-slate-600 group-hover:text-slate-300'
                      }`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => onCreateNote(null)}
                title="New note"
                className="px-2 text-slate-500 hover:text-sky-300 hover:bg-slate-900/60 shrink-0"
              >
                <Plus size={14} />
              </button>
            </div>
          )}
          {!active && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select or create a note.
            </div>
          )}
          {active && (
            <>
              <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3">
                {/* Icon picker button */}
                {canEdit(active) ? (
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setShowIconPicker((p) => !p)}
                      title="Change note icon"
                      className="p-1.5 rounded hover:bg-slate-800 transition-colors"
                    >
                      <NoteIconDisplay iconId={active.icon} size={18} />
                    </button>
                    {showIconPicker && (() => {
                      // Decouple the parse from the loops below so the picked
                      // colour stays sticky as the user clicks an icon next.
                      const parsed = parseNoteIcon(active.icon);
                      const selectedColor = parsed.color;
                      const previewColor = (defaultColor: string) => selectedColor ?? defaultColor;
                      return (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setShowIconPicker(false)}
                          />
                          <div className="absolute top-full left-0 mt-1 z-30 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 w-60">
                            {/* Colour row — pick a tint that applies to whatever
                                icon the user selects next. Picking again with
                                the same colour toggles back to the icon's
                                default. */}
                            <div className="flex flex-wrap gap-1 pb-2 mb-2 border-b border-slate-800">
                              {NOTE_ICON_COLORS.map(({ color, label }) => {
                                const isSelected = (selectedColor ?? null) === color;
                                return (
                                  <button
                                    key={label}
                                    title={label}
                                    onClick={() => {
                                      updateNote(active.id, {
                                        icon: formatNoteIcon(parsed.id, color),
                                      });
                                    }}
                                    className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center ${
                                      isSelected ? 'border-white' : 'border-transparent'
                                    }`}
                                    style={{ backgroundColor: color ?? 'transparent' }}
                                  >
                                    {color === null && (
                                      <span className="text-[10px] text-slate-400 leading-none">×</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Icon grid — each glyph previews in the currently
                                selected colour (or its default if none picked
                                yet) so the user sees the final look before
                                committing. */}
                            <div className="grid grid-cols-6 gap-1">
                              {NOTE_ICONS.map(({ id, Icon, color: defaultColor, label }) => (
                                <button
                                  key={id}
                                  title={label}
                                  onClick={() => {
                                    updateNote(active.id, {
                                      icon: formatNoteIcon(id, selectedColor),
                                    });
                                    setShowIconPicker(false);
                                  }}
                                  className={`flex flex-col items-center gap-0.5 rounded p-1.5 transition-colors hover:bg-slate-800 ${
                                    (parsed.id ?? 'note') === id
                                      ? 'bg-slate-700 ring-1 ring-sky-500'
                                      : ''
                                  }`}
                                >
                                  <Icon size={14} style={{ color: previewColor(defaultColor) }} />
                                  <span className="text-[8px] text-slate-500 leading-none truncate w-full text-center">
                                    {label}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="shrink-0 p-1.5">
                    <NoteIconDisplay iconId={active.icon} size={18} />
                  </div>
                )}
                <input
                  value={drafts[active.id]?.title ?? active.title}
                  onChange={(e) => {
                    updateDraft(active.id, { title: e.target.value });
                    scheduleAutosave();
                  }}
                  readOnly={!canEdit(active)}
                  className="flex-1 bg-transparent font-serif text-xl outline-none"
                  placeholder="Title"
                />

                {/* Autosave status indicator */}
                {canEdit(active) && saveStatus !== 'idle' && (
                  <span className="flex items-center gap-1 text-xs select-none shrink-0">
                    {saveStatus === 'saving' ? (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Loader2 size={13} className="animate-spin" />
                        Saving…
                      </span>
                    ) : saveStatus === 'saved' ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Check size={13} />
                        Saved
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-400" title="Save failed — check your connection">
                        ✕ Save failed
                      </span>
                    )}
                  </span>
                )}

                {/* Active collaborator avatars */}
                {activeCollaborators.length > 0 && (
                  <div className="flex items-center -space-x-1.5 shrink-0" title="Currently editing">
                    {activeCollaborators.slice(0, 5).map((c) => (
                      <div
                        key={c.clientId}
                        title={c.name}
                        className="w-6 h-6 rounded-full border-2 border-slate-900 flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: c.color, color: '#fff' }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {activeCollaborators.length > 5 && (
                      <div
                        className="w-6 h-6 rounded-full border-2 border-slate-900 bg-slate-700 flex items-center justify-center text-[9px] text-slate-300"
                        title={`${activeCollaborators.length - 5} more`}
                      >
                        +{activeCollaborators.length - 5}
                      </div>
                    )}
                  </div>
                )}

                {/* Share popover */}
                {(isGM || active.owner_user_id === userId) && (
                  <div className="relative">
                    <button
                      onClick={() => setShowSharePopover((p) => !p)}
                      title="Share note with players"
                      className="px-2 py-1 text-xs rounded flex items-center gap-1 bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                    >
                      <Share2 size={13} />
                      Share
                    </button>
                    {showSharePopover && (
                      <SharePopover note={active} onClose={() => setShowSharePopover(false)} />
                    )}
                  </div>
                )}
                {canEdit(active) && (confirmingId === active.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400 mr-1">Delete this note?</span>
                    <button
                      onClick={() => {
                        deleteNote(active.id);
                        setConfirmingId(null);
                      }}
                      className="px-2 py-1 text-xs bg-rose-700 hover:bg-rose-600 text-white rounded"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingId(active.id)}
                    className="px-2 py-1 text-xs bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-rose-200 rounded flex items-center gap-1"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                ))}
              </div>
              {/* Formatting toolbar — only visible while editing */}
              {canEdit(active) && (
                <div className="flex items-center gap-0.5 px-3 py-1 border-b border-slate-800 bg-slate-950">
                  <ToolbarBtn title="Bold (Ctrl+B)" onClick={() => editorRef.current?.format({ kind: 'wrap', before: '**', after: '**' })}>
                    <Bold size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Italic (Ctrl+I)" onClick={() => editorRef.current?.format({ kind: 'wrap', before: '*', after: '*' })}>
                    <Italic size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Strikethrough" onClick={() => editorRef.current?.format({ kind: 'wrap', before: '~~', after: '~~' })}>
                    <Strikethrough size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Highlight" onClick={() => editorRef.current?.format({ kind: 'wrap', before: '==', after: '==' })}>
                    <Highlighter size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Inline code" onClick={() => editorRef.current?.format({ kind: 'wrap', before: '`', after: '`' })}>
                    <Code size={13} />
                  </ToolbarBtn>
                  <div className="w-px h-4 bg-slate-700 mx-0.5" />
                  <ToolbarBtn title="Heading 1" onClick={() => editorRef.current?.format({ kind: 'line-prefix', prefix: '# ' })}>
                    <Heading1 size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Heading 2" onClick={() => editorRef.current?.format({ kind: 'line-prefix', prefix: '## ' })}>
                    <Heading2 size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Heading 3" onClick={() => editorRef.current?.format({ kind: 'line-prefix', prefix: '### ' })}>
                    <Heading3 size={13} />
                  </ToolbarBtn>
                  <div className="w-px h-4 bg-slate-700 mx-0.5" />
                  <ToolbarBtn title="Bulleted list" onClick={() => editorRef.current?.format({ kind: 'toggle-bullet' })}>
                    <List size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Align left" onClick={() => editorRef.current?.format({ kind: 'align', align: 'left' })}>
                    <AlignLeft size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Align center" onClick={() => editorRef.current?.format({ kind: 'align', align: 'center' })}>
                    <AlignCenter size={13} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Align right" onClick={() => editorRef.current?.format({ kind: 'align', align: 'right' })}>
                    <AlignRight size={13} />
                  </ToolbarBtn>
                  <div className="w-px h-4 bg-slate-700 mx-0.5" />
                  <ToolbarBtn
                    title={imageUploading ? 'Uploading image…' : 'Upload image'}
                    onClick={() => { if (!imageUploading) imgInputRef.current?.click(); }}
                  >
                    {imageUploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                  </ToolbarBtn>
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      const url = await uploadImageFile(file);
                      if (url) editorRef.current?.format({ kind: 'insert', text: `![](${url})` });
                    }}
                  />
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden">
                {canEdit(active) ? (
                  /* Live editor — highlights decorators inline as you type */
                  <LiveEditor
                    key={active.id}
                    ref={editorRef}
                    body={drafts[active.id]?.body ?? active.body}
                    onChange={(v) => {
                      updateDraft(active.id, { body: v });
                      scheduleAutosave();
                    }}
                    wikiIndex={wikiIndex}
                    onNavigate={onWikiClick}
                    rollFormula={rollFormula}
                    party={party}
                    npcs={npcs}
                    notes={notes}
                    noteId={active.id}
                    ydocState={active.ydoc_state ?? null}
                    userId={userId ?? ''}
                    userName={displayName ?? userId ?? 'Traveller'}
                    uploadImage={uploadImageFile}
                    onCollaboratorsChange={setActiveCollaborators}
                  />
                ) : (
                  /* Read-only rendered view for players / non-owners */
                  <div
                    className="h-full overflow-y-auto px-8 py-6 markdown-body"
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      const link = target.closest<HTMLAnchorElement>('a[data-wiki="true"]');
                      if (link) {
                        e.preventDefault();
                        onWikiClick(link.getAttribute('href') || '');
                      }
                    }}
                  >
                    <ReactMarkdown
                      remarkPlugins={plugins}
                      components={{
                        span: ({ node, children, ...props }) => {
                          const p = props as Record<string, unknown>;
                          const className = (p.className as string) ?? '';
                          if (className.includes('note-secret')) {
                            const revealed = p['data-secret-revealed'] === 'true';
                            const idx = parseInt((p['data-secret-index'] as string) ?? '0', 10);
                            const content = (p['data-secret-content'] as string) ?? '';
                            return (
                              <Secret
                                isGM={isGM}
                                revealed={revealed}
                                onToggle={() => {
                                  if (active) updateNote(active.id, { body: toggleSecret(active.body, idx) });
                                }}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {content}
                                </ReactMarkdown>
                              </Secret>
                            );
                          }
                          if (className.includes('note-align')) {
                            const content = (p['data-align-content'] as string) ?? '';
                            return (
                              <span {...props}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {content}
                                </ReactMarkdown>
                              </span>
                            );
                          }
                          if (className.includes('note-loc')) {
                            const route = p['data-wiki-route'] as string | undefined;
                            if (route) {
                              return (
                                <span className={className} onClick={() => onWikiClick(route)} style={{ cursor: 'pointer' }}>
                                  {children}
                                </span>
                              );
                            }
                          }
                          if (className.includes('note-player')) {
                            const text = extractText(children);
                            const member = party.find(
                              (m) => m.name.trim().toLowerCase() === text.trim().toLowerCase()
                            );
                            if (member) {
                              return (
                                <PartyRefSpan member={member} className={className}>
                                  {children}
                                </PartyRefSpan>
                              );
                            }
                          }
                          if (className.includes('note-dice')) {
                            const formula = (p['data-dice-formula'] as string) ?? extractText(children);
                            return (
                              <button
                                className="note-dice"
                                title={`Roll ${formula}`}
                                onClick={() => rollFormula(formula)}
                              >
                                🎲 {formula}
                              </button>
                            );
                          }
                          return <span {...props}>{children}</span>;
                        },
                        h1: renderFoldableHeading('h1'),
                        h2: renderFoldableHeading('h2'),
                        h3: renderFoldableHeading('h3'),
                        h4: renderFoldableHeading('h4'),
                        h5: renderFoldableHeading('h5'),
                        h6: renderFoldableHeading('h6'),
                        li: ({ node, children, ...props }) => {
                          const p = props as Record<string, unknown>;
                          const foldId = p['data-fold-id'] as string | undefined;
                          if (!foldId) return <li {...props}>{children}</li>;
                          const collapsed = collapsedFolds.has(foldId);
                          return (
                            <li {...props} className={collapsed ? 'note-li-collapsed' : undefined}>
                              <FoldArrowBtn collapsed={collapsed} onToggle={() => toggleFold(foldId)} />
                              {children}
                            </li>
                          );
                        },
                        div: ({ node, children, ...props }) => {
                          const p = props as Record<string, unknown>;
                          const className = (p.className as string) ?? '';
                          if (className.includes('note-fold-section')) {
                            const foldFor = p['data-fold-for'] as string | undefined;
                            if (foldFor && collapsedFolds.has(foldFor)) return null;
                          }
                          return <div {...props}>{children}</div>;
                        },
                      }}
                    >
                      {active.body ? addHardBreaks(preprocessDecorators(active.body)) : '*Empty note.*'}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function addHardBreaks(md: string): string {
  const lines = md.split('\n');
  let inCode = false;
  return lines
    .map((line, i) => {
      if (line.trimStart().startsWith('```')) inCode = !inCode;
      const next = lines[i + 1] ?? '';
      if (!inCode && line.trim() !== '' && next.trim() !== '') {
        return line.trimEnd() + '  ';
      }
      return line;
    })
    .join('\n');
}

// ─── Formatting toolbar button ────────────────────────────────────────────────
function ToolbarBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      // onMouseDown + preventDefault keeps CodeMirror focused so the selection
      // is still live when the format command fires.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="p-1.5 rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
    >
      {children}
    </button>
  );
}

// ─── Read-only view: collapse arrow for fold-marked headings/list items ──────
function FoldArrowBtn({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`note-fold-arrow${collapsed ? ' note-fold-arrow-collapsed' : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
    >
      <ChevronDown size={14} />
    </button>
  );
}

function LegendRow({
  syntax,
  label,
  children,
}: {
  syntax: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="text-[10px] text-slate-400 bg-slate-950 px-1 py-0.5 rounded font-mono w-28 shrink-0">
        {syntax}
      </code>
      <span className="text-slate-500 text-[10px] w-16 shrink-0">{label}</span>
      <span className="text-[11px]">{children}</span>
    </div>
  );
}


/** The folder color picker has to render through a portal because each
 *  FolderNode sits inside a parent that uses `overflow: hidden` for the
 *  expand/collapse grid animation. An absolute-positioned popover would be
 *  clipped by that ancestor and become invisible — which is exactly the
 *  "can't edit sub-folder colour" bug. Portal + fixed positioning relative
 *  to the trigger's bounding rect sidesteps it entirely. */
function FolderColorPickerButton({
  folderId,
  folderColor,
  isOpen,
  onToggle,
  onClose,
  onPick,
}: {
  folderId: string;
  folderColor: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (color: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  // Snap the popover to the button's screen position whenever it opens.
  // Re-running on isOpen change is enough because scrolling/resizing while
  // the popover is up is rare and we close on outside-click anyway.
  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setCoords({ left: rect.left, top: rect.bottom + 4 });
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title="Folder colour"
        className="p-0.5 text-slate-500 hover:text-sky-300"
      >
        <Palette size={11} />
      </button>
      {isOpen && coords && createPortal(
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          />
          <div
            data-folder-color-picker={folderId}
            className="fixed z-[61] bg-slate-900 border border-slate-700 rounded shadow-lg p-1.5 flex gap-1"
            style={{ left: coords.left, top: coords.top }}
            onClick={(e) => e.stopPropagation()}
          >
            {FOLDER_COLORS.map(({ color, label }) => (
              <button
                key={color}
                title={label}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(color);
                }}
                className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${
                  folderColor === color ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

type FolderNodeProps = {
  folder: Folder;
  depth: number;
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  matching: Set<string> | null;
  renamingFolderId: string | null;
  renameValue: string;
  confirmingId: string | null;
  dragOverId: string | 'root' | null;
  isGM: boolean;
  hiddenFolderIds: string[];
  /** Campaign-wide presence map: noteId → list of users currently viewing it. */
  notePresence: Record<string, PresenceUser[]>;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string) => void;
  onSelectNote: (id: string) => void;
  onCreateNote: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onStartRename: (id: string, name: string) => void;
  onFinishRename: (id: string) => void;
  onCancelRename: () => void;
  onRenameChange: (v: string) => void;
  onStartDeleteNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onCancelDelete: () => void;
  onStartDeleteFolder: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onDragStart: (d: DragItem) => void;
  onDragEnd: () => void;
  onDragOverItem: (id: string | null) => void;
  onDrop: (target: string | null) => void;
  /** Custom sort order (Part C) — separate from the folder-move drag above. */
  noteOrder: Record<string, string[]>;
  sortMode: 'updated' | 'alpha' | 'custom';
  reorderDragId: string | null;
  reorderOverId: string | null;
  onReorderDragStart: (id: string) => void;
  onReorderDragEnd: () => void;
  onReorderOver: (id: string | null) => void;
  onReorderDrop: (folderKey: string, groupNotes: Note[], targetId: string) => void;
};

function FolderNode(props: FolderNodeProps) {
  const { folder, depth, folders, notes, matching, isGM, isExpanded, hiddenFolderIds } = props;
  const [showColorPicker, setShowColorPicker] = useState(false);

  const toggleFolder = useCampaignSettings((s) => s.toggleFolder);
  const setFolderColor = useCampaignSettings((s) => s.setFolderColor);
  const folderColors = useCampaignSettings((s) => s.settings.folderColors);
  const folderColor = folderColors[folder.id] ?? '#60a5fa';
  const isHiddenFromPlayers = hiddenFolderIds.includes(folder.id);

  const children = folders.filter(
    (f) => f.parent_id === folder.id && (isGM || !hiddenFolderIds.includes(f.id))
  );
  const folderNotesBase = notes.filter((n) => n.folder_id === folder.id);
  const folderNotes = props.sortMode === 'custom' ? applyNoteOrder(folderNotesBase, folder.id, props.noteOrder) : folderNotesBase;
  const renaming = props.renamingFolderId === folder.id;
  const confirming = props.confirmingId === folder.id;
  const isDragOver = props.dragOverId === folder.id;
  const expanded = isExpanded(folder.id);

  return (
    <div>
      <div
        draggable={isGM && !renaming}
        onDragStart={(e) => {
          if (!isGM) return;
          e.stopPropagation();
          props.onDragStart({ kind: 'folder', id: folder.id });
        }}
        onDragEnd={props.onDragEnd}
        onDragOver={(e) => {
          if (!isGM) return;
          e.preventDefault();
          e.stopPropagation();
          props.onDragOverItem(folder.id);
        }}
        onDragLeave={(e) => {
          // Same child-crossing guard as NoteRow — the folder row has a chevron,
          // icon, label, and action buttons inside it.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          props.onDragOverItem(null);
        }}
        onDrop={(e) => {
          if (!isGM) return;
          e.preventDefault();
          e.stopPropagation();
          props.onDrop(folder.id);
        }}
        className={`group flex items-center gap-1 px-1 py-0.5 cursor-pointer transition-colors duration-100 hover:bg-slate-900 ${
          isDragOver ? 'bg-sky-950/40 ring-1 ring-sky-700' : ''
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => props.onToggle(folder.id)}
      >
        <ChevronRight
          size={12}
          className="text-slate-500 shrink-0 transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
        <FolderIcon
          size={12}
          className="shrink-0"
          style={{ color: isHiddenFromPlayers && isGM ? '#475569' : folderColor }}
        />
        {renaming ? (
          <input
            autoFocus
            value={props.renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => props.onRenameChange(e.target.value)}
            onBlur={() => props.onFinishRename(folder.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onFinishRename(folder.id);
              if (e.key === 'Escape') props.onCancelRename();
            }}
            className="flex-1 min-w-0 bg-slate-800 border border-sky-700 px-1 text-[12px] outline-none"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              if (!isGM) return;
              e.stopPropagation();
              props.onStartRename(folder.id, folder.name);
            }}
            className={`flex-1 min-w-0 truncate ${isHiddenFromPlayers && isGM ? 'text-slate-500 italic' : 'text-slate-200'}`}
          >
            {folder.name}
          </span>
        )}
        {!renaming && !confirming && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0 relative">
            <button
              onClick={(e) => { e.stopPropagation(); props.onCreateNote(folder.id); }}
              title="New note"
              className="p-0.5 text-slate-500 hover:text-sky-300"
            >
              <FilePlus size={11} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); props.onCreateFolder(folder.id); }}
              title="New subfolder"
              className="p-0.5 text-slate-500 hover:text-sky-300"
            >
              <FolderPlus size={11} />
            </button>
            {isGM && (
              <button
                onClick={(e) => { e.stopPropagation(); props.onStartRename(folder.id, folder.name); }}
                title="Rename folder"
                className="p-0.5 text-slate-500 hover:text-sky-300"
              >
                <Pencil size={11} />
              </button>
            )}
            {isGM && (
              <FolderColorPickerButton
                folderId={folder.id}
                folderColor={folderColor}
                isOpen={showColorPicker}
                onToggle={() => setShowColorPicker((v) => !v)}
                onClose={() => setShowColorPicker(false)}
                onPick={(color) => {
                  setFolderColor(folder.id, color);
                  setShowColorPicker(false);
                }}
              />
            )}
            {isGM && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}
                title={isHiddenFromPlayers ? 'Hidden from players — click to show' : 'Visible to players — click to hide'}
                className={`p-0.5 ${isHiddenFromPlayers ? 'text-amber-500 hover:text-amber-300 opacity-100' : 'text-slate-500 hover:text-amber-400'}`}
              >
                {isHiddenFromPlayers ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            )}
            {isGM && (
              <button
                onClick={(e) => { e.stopPropagation(); props.onStartDeleteFolder(folder.id); }}
                title="Delete folder"
                className="p-0.5 text-slate-500 hover:text-rose-400"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )}
        {isGM && confirming && (
          <div
            className="flex gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => props.onDeleteFolder(folder.id)}
              className="px-1 text-[10px] bg-rose-700 hover:bg-rose-600 text-white rounded"
            >
              Delete
            </button>
            <button
              onClick={() => props.onCancelDelete()}
              className="px-1 text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Animated expand/collapse via CSS grid trick */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          {children.map((c) => (
            <FolderNode {...props} key={c.id} folder={c} depth={depth + 1} />
          ))}
          {folderNotes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              depth={depth + 1}
              active={n.id === props.activeNoteId}
              dimmed={matching !== null && !matching.has(n.id)}
              confirming={props.confirmingId === n.id}
              isGM={isGM}
              presentUsers={props.notePresence[n.id] ?? []}
              onSelect={() => props.onSelectNote(n.id)}
              onStartDelete={() => props.onStartDeleteNote(n.id)}
              onDelete={() => props.onDeleteNote(n.id)}
              onCancelDelete={() => props.onCancelDelete()}
              onDragStart={() => props.onDragStart({ kind: 'note', id: n.id })}
              onDragEnd={props.onDragEnd}
              reorderDragging={props.reorderDragId === n.id}
              reorderActive={props.reorderDragId !== null}
              reorderOver={props.reorderOverId === n.id}
              onReorderDragStart={() => props.onReorderDragStart(n.id)}
              onReorderDragEnd={props.onReorderDragEnd}
              onReorderOver={props.onReorderOver}
              onReorderDrop={() => props.onReorderDrop(folder.id, folderNotes, n.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type NoteRowProps = {
  note: Note;
  depth: number;
  active: boolean;
  dimmed: boolean;
  confirming: boolean;
  isGM: boolean;
  /** Users from the campaign presence channel currently viewing this note. */
  presentUsers: PresenceUser[];
  onSelect: () => void;
  onStartDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onDragStart: () => void;
  /** Clears the in-flight drag payload when the gesture ends without a valid
   *  drop (Esc, drop on dead space). Without this the stale payload gets
   *  applied to the *next* drop, moving the wrong note. */
  onDragEnd: () => void;
  /** Custom sort order (Part C) — separate drag gesture from onDragStart
   *  above, initiated only from the grip handle so it can't collide with
   *  the GM-only drag-into-folder gesture on the row body. */
  reorderDragging: boolean;
  /** True while a reorder gesture is in flight anywhere in the tree. The row
   *  only claims dragover/drop when this is set — otherwise a drag-into-folder
   *  gesture would be swallowed by the reorder handler. */
  reorderActive: boolean;
  reorderOver: boolean;
  onReorderDragStart: () => void;
  /** Clears both the reorder source and hover target. Must fire on dragend or a
   *  cancelled reorder (Esc / dead-space drop) leaves reorderActive stuck on,
   *  which would then swallow every later drag-into-folder gesture. */
  onReorderDragEnd: () => void;
  /** Pass the note's id to highlight this row as a drop target, or null to clear. */
  onReorderOver: (id: string | null) => void;
  onReorderDrop: () => void;
};

function NoteRow({
  note,
  depth,
  active,
  dimmed,
  confirming,
  isGM,
  presentUsers,
  onSelect,
  onStartDelete,
  onDelete,
  onCancelDelete,
  onDragStart,
  onDragEnd,
  reorderDragging,
  reorderActive,
  reorderOver,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderOver,
  onReorderDrop,
}: NoteRowProps) {
  const perms = useNotes((s) => s.permissions[note.id] ?? EMPTY_PERMS);
  return (
    <div
      draggable={isGM}
      onDragStart={(e) => {
        if (!isGM) return;
        e.stopPropagation();
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        // Only light up as a reorder target when a reorder is actually in
        // flight; during a drag-into-folder gesture the row must stay
        // transparent so the drop can reach the folder/root zone behind it.
        if (reorderActive) onReorderOver(note.id);
      }}
      onDragLeave={(e) => {
        // dragleave also fires when the pointer crosses into a child element
        // (grip, icon, title, presence dots), which otherwise clears the drop
        // target mid-drag and makes the whole interaction flicker.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onReorderOver(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        // Claim the drop only for reorders. Letting a folder-move drop bubble
        // means it reaches the enclosing folder (or the root zone) instead of
        // being silently discarded here.
        if (!reorderActive) return;
        e.stopPropagation();
        onReorderDrop();
      }}
      onClick={onSelect}
      className={`group flex items-center gap-1 px-1 py-0.5 cursor-pointer transition-colors duration-100 ${
        active ? 'bg-sky-900/40 text-sky-100' : 'hover:bg-slate-900 text-slate-300'
      } ${dimmed ? 'opacity-30' : ''} ${reorderDragging ? 'opacity-40' : ''} ${
        reorderOver ? 'ring-1 ring-sky-600' : ''
      }`}
      style={{ paddingLeft: 16 + depth * 12 }}
    >
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          onReorderDragStart();
        }}
        onDragEnd={onReorderDragEnd}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical size={11} />
      </span>
      <NoteIconDisplay iconId={note.icon} size={11} />
      <span className="flex-1 min-w-0 truncate">
        {note.title || 'Untitled'}
      </span>
      {/* Presence dots: who else has this note open right now */}
      {presentUsers.length > 0 && (
        <span className="flex items-center gap-px shrink-0">
          {presentUsers.slice(0, 3).map((u) => (
            <span
              key={u.userId}
              title={`${u.userName} is viewing`}
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: u.color }}
            />
          ))}
          {presentUsers.length > 3 && (
            <span
              className="text-[8px] text-slate-500 leading-none ml-0.5"
              title={`${presentUsers.length} people viewing`}
            >
              +{presentUsers.length - 3}
            </span>
          )}
        </span>
      )}
      {isGM && !active && (() => {
        const status = getShareStatus(note, perms);
        if (status === 'shared_edit') return <Eye size={10} className="text-emerald-400 shrink-0" />;
        if (status === 'shared_view') return <Eye size={10} className="text-sky-400 shrink-0" />;
        return null;
      })()}
      {isGM && (confirming ? (
        <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onDelete}
            className="px-1 text-[10px] bg-rose-700 hover:bg-rose-600 text-white rounded"
          >
            Del
          </button>
          <button
            onClick={onCancelDelete}
            className="px-1 text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
          >
            X
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartDelete();
          }}
          className="p-0.5 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        >
          <Trash2 size={11} />
        </button>
      ))}
    </div>
  );
}
