import { create } from 'zustand';
import { supabase } from '../../lib/supabase';

export type ChatMember = {
  userId: string;
  displayName: string;
  role: 'gm' | 'cogm' | 'player';
  color: string;
};

/** A dice result posted to chat. Mirrors the shape of a QuickDice Roll so the
 *  same result can be shown in the panel, the overlay, and the chat log. */
export type ChatRollData = {
  kind: 'roll';
  label: string;
  detail: string;
  total: number;
  die?: number;
  crit?: 'hit' | 'miss';
};

/** Structured payload for non-plain messages. Union so future message kinds
 *  (handouts, initiative callouts) can slot in beside rolls. */
export type ChatMessageData = ChatRollData;

export type ChatMessage = {
  id: string;
  campaignId: string;
  senderId: string;
  body: string;
  mentions: string[];
  whisperTo: string[] | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Null for ordinary text messages. */
  data: ChatMessageData | null;
};

type Row = Record<string, unknown>;

function rowToMessage(r: Row): ChatMessage {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    senderId: r.sender_id as string,
    body: r.body as string,
    mentions: (r.mentions as string[] | null) ?? [],
    whisperTo: (r.whisper_to as string[] | null) ?? null,
    editedAt: (r.edited_at as string | null) ?? null,
    deletedAt: (r.deleted_at as string | null) ?? null,
    createdAt: r.created_at as string,
    data: (r.data as ChatMessageData | null) ?? null,
  };
}

function rowToMember(r: Row): ChatMember {
  return {
    userId: r.user_id as string,
    displayName: r.display_name as string,
    role: r.role as 'gm' | 'cogm' | 'player',
    color: (r.color as string | null) ?? '#94a3b8',
  };
}

/** Per-campaign localStorage key for the "last time I looked at chat" timestamp. */
const LAST_SEEN_KEY = (campaignId: string) => `grimoire:chat:lastSeen:${campaignId}`;

interface ChatState {
  /** Sorted oldest → newest. */
  messages: ChatMessage[];
  /** Members of the current campaign, keyed by user_id. */
  members: Record<string, ChatMember>;
  loaded: boolean;
  /** Ids of optimistic messages we inserted locally before realtime echo. */
  pendingIds: Set<string>;
  /**
   * Epoch-ms timestamp of the user's last chat visibility moment. Messages
   * with `created_at > lastSeenAt` (and not authored by me) are "unread".
   * Hydrated from localStorage on load; defaults to now-on-first-visit so
   * we don't surface a year of old messages as fresh notifications.
   */
  lastSeenAt: number;

  loadForCampaign(id: string): Promise<void>;
  subscribe(id: string): () => void;
  clear(): void;

  send(campaignId: string, body: string, opts?: { whisperTo?: string[]; mentions?: string[]; data?: ChatMessageData }): Promise<void>;
  /** Post a dice result to the campaign log. `body` is the plain-text fallback
   *  shown anywhere the structured card isn't rendered (notifications, older
   *  clients). */
  sendRoll(campaignId: string, roll: ChatRollData, opts?: { whisperTo?: string[] }): Promise<void>;
  edit(id: string, body: string): Promise<void>;
  remove(id: string): Promise<void>;
  clearAll(campaignId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Mark all currently-loaded messages as read. Call when chat becomes visible. */
  markSeen(campaignId: string): void;
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  members: {},
  loaded: false,
  pendingIds: new Set(),
  lastSeenAt: 0,

  loadForCampaign: async (id) => {
    const [msgRes, memRes] = await Promise.all([
      supabase
        .from('chat_messages')
        .select('*')
        .eq('campaign_id', id)
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('campaign_members')
        .select('user_id, display_name, role, color')
        .eq('campaign_id', id),
    ]);

    const messages = (msgRes.data ?? []).map((r) => rowToMessage(r as Row));
    const members: Record<string, ChatMember> = {};
    for (const r of memRes.data ?? []) {
      const m = rowToMember(r as Row);
      members[m.userId] = m;
    }

    // Hydrate lastSeenAt from localStorage — falls back to "now" on first
    // visit so we don't surface old history as new notifications.
    let lastSeenAt = Date.now();
    try {
      const raw = localStorage.getItem(LAST_SEEN_KEY(id));
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) lastSeenAt = n;
      } else {
        localStorage.setItem(LAST_SEEN_KEY(id), String(lastSeenAt));
      }
    } catch {
      /* ignore quota / private-mode */
    }

    set({ messages, members, loaded: true, lastSeenAt });
  },

  subscribe: (id) => {
    const ch = supabase
      .channel(`chat:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `campaign_id=eq.${id}` },
        ({ eventType, new: r, old }) => {
          if (eventType === 'INSERT') {
            const msg = rowToMessage(r as Row);
            set((s) => {
              // Skip if optimistic insert already added this id locally.
              if (s.pendingIds.has(msg.id)) {
                const next = new Set(s.pendingIds);
                next.delete(msg.id);
                return {
                  pendingIds: next,
                  messages: s.messages.map((m) => (m.id === msg.id ? msg : m)),
                };
              }
              return { messages: [...s.messages, msg] };
            });
          } else if (eventType === 'UPDATE') {
            const msg = rowToMessage(r as Row);
            set((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? msg : m)) }));
          } else if (eventType === 'DELETE') {
            const oldId = (old as Row).id as string;
            set((s) => ({ messages: s.messages.filter((m) => m.id !== oldId) }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_members', filter: `campaign_id=eq.${id}` },
        ({ eventType, new: r, old }) => {
          if (eventType === 'DELETE') {
            const uid = (old as Row).user_id as string;
            set((s) => {
              const next = { ...s.members };
              delete next[uid];
              return { members: next };
            });
          } else {
            const m = rowToMember(r as Row);
            set((s) => ({ members: { ...s.members, [m.userId]: m } }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  },

  clear: () => set({ messages: [], members: {}, loaded: false, pendingIds: new Set(), lastSeenAt: 0 }),

  send: async (campaignId, body, opts) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic insert with client-generated id; reconciled by realtime echo.
    const tempId = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id: tempId,
      campaignId,
      senderId: user.id,
      body: trimmed,
      mentions: opts?.mentions ?? [],
      whisperTo: opts?.whisperTo ?? null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      data: opts?.data ?? null,
    };
    set((s) => {
      const next = new Set(s.pendingIds);
      next.add(tempId);
      return { messages: [...s.messages, optimistic], pendingIds: next };
    });

    const { error } = await supabase.from('chat_messages').insert({
      id: tempId,
      campaign_id: campaignId,
      sender_id: user.id,
      body: trimmed,
      mentions: opts?.mentions ?? [],
      whisper_to: opts?.whisperTo ?? null,
      data: opts?.data ?? null,
    });

    if (error) {
      // Roll back the optimistic row.
      set((s) => {
        const next = new Set(s.pendingIds);
        next.delete(tempId);
        return { messages: s.messages.filter((m) => m.id !== tempId), pendingIds: next };
      });
      console.error('[chat] send failed', error);
    }
  },

  sendRoll: async (campaignId, roll, opts) => {
    // Plain-text fallback keeps the log readable anywhere the card isn't drawn.
    const body = `🎲 ${roll.label}: ${roll.total} (${roll.detail})`;
    await get().send(campaignId, body, { whisperTo: opts?.whisperTo, data: roll });
  },

  edit: async (id, body) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, body: trimmed, editedAt: new Date().toISOString() } : m
      ),
    }));
    const { error } = await supabase
      .from('chat_messages')
      .update({ body: trimmed, edited_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.error('[chat] edit failed', error);
  },

  remove: async (id) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, deletedAt: new Date().toISOString() } : m
      ),
    }));
    const { error } = await supabase
      .from('chat_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.error('[chat] delete failed', error);
  },

  markSeen: (campaignId) => {
    const now = Date.now();
    // Skip the write if we're already up-to-date to keep effect dependencies
    // from re-triggering this hundreds of times per second.
    if (now - get().lastSeenAt < 1000) return;
    set({ lastSeenAt: now });
    try {
      localStorage.setItem(LAST_SEEN_KEY(campaignId), String(now));
    } catch {
      /* ignore */
    }
  },

  clearAll: async (campaignId) => {
    const prev = get().messages;
    set({ messages: [] });
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('campaign_id', campaignId);
    if (error) {
      set({ messages: prev });
      console.error('[chat] clearAll failed', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },
}));
