import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, X, Send, Pencil, Trash2, Check, Palette, HelpCircle, Eye } from 'lucide-react';
import { useChat, type ChatMember, type ChatMessage, type ChatRollData } from './chatStore';
import { useQuickDice, makeRoll } from '../dice/quickDiceStore';
import { useChatPanel } from './chatPanelStore';
import { useSession } from '../session/sessionStore';
import MentionTextarea from './MentionTextarea';
import { extractMentionIds, parseSegments, filterMembers } from './mentions';
import { useCatalog, type CatalogKind } from './catalog';
import { useChatCatalog } from './useChatCatalog';
import { KIND_FG, KIND_PILL_BG, KIND_ICON_CHAR } from './chips';
import ChipContextMenu from './ChipContextMenu';
import {
  WhisperBar,
  WhisperPicker,
  detectWhisperCommand,
  readLastWhisper,
  writeLastWhisper,
  useWhisperKeyboard,
} from './WhisperUI';
import { useNotes } from '../notes/notesStore';
import { useNpcStore } from '../npcs/npcStore';
import { useProfiles, avatarPublicUrl } from '../profiles/profilesStore';
import { playPingSound } from './notificationSound';

/** Floating-chat resize bounds + persistence. */
const MIN_POPOUT_W = 280;
const MIN_POPOUT_H = 240;
const DEFAULT_POPOUT_W = 384;  // matches the old `w-96`
const DEFAULT_POPOUT_H = 512;  // matches the old `h-[32rem]`
const POPOUT_SIZE_KEY = 'grimoire:chat:popout-size';
const POPOUT_POS_KEY = 'grimoire:chat:popout-pos';

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

function readPopoutSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(POPOUT_SIZE_KEY);
    if (!raw) return { w: DEFAULT_POPOUT_W, h: DEFAULT_POPOUT_H };
    const parsed = JSON.parse(raw) as { w?: number; h?: number };
    return {
      w: clamp(parsed.w ?? DEFAULT_POPOUT_W, MIN_POPOUT_W, 1600),
      h: clamp(parsed.h ?? DEFAULT_POPOUT_H, MIN_POPOUT_H, 1200),
    };
  } catch {
    return { w: DEFAULT_POPOUT_W, h: DEFAULT_POPOUT_H };
  }
}

function writePopoutSize(size: { w: number; h: number }) {
  try {
    localStorage.setItem(POPOUT_SIZE_KEY, JSON.stringify(size));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** Stored top/left in viewport pixels. `null` keeps the panel anchored
 *  bottom-right (the default). Set when the user drags the panel by its
 *  header to a custom location. */
function readPopoutPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POPOUT_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (parsed?.x == null || parsed?.y == null) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function writePopoutPos(pos: { x: number; y: number } | null) {
  try {
    if (pos === null) localStorage.removeItem(POPOUT_POS_KEY);
    else localStorage.setItem(POPOUT_POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

/**
 * Chat. Two render modes:
 *  - `variant="floating"` (default): bottom-right floating button → panel.
 *    Used on every page that doesn't have its own chat surface.
 *  - `variant="embedded"`: fills its parent, no close X, ignores open/close
 *    state. Used by the player dashboard.
 */
export default function ChatPanel({ variant = 'floating' }: { variant?: 'floating' | 'embedded' } = {}) {
  const embedded = variant === 'embedded';
  const open = useChatPanel((s) => s.open);
  const openPanel = useChatPanel((s) => s.openPanel);
  const close = useChatPanel((s) => s.close);
  const campaignId = useSession((s) => s.campaignId);
  const userId = useSession((s) => s.userId);

  const messages = useChat((s) => s.messages);
  const members = useChat((s) => s.members);
  const loaded = useChat((s) => s.loaded);
  const loadForCampaign = useChat((s) => s.loadForCampaign);
  const subscribe = useChat((s) => s.subscribe);
  const clear = useChat((s) => s.clear);
  const send = useChat((s) => s.send);
  const sendRoll = useChat((s) => s.sendRoll);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const catalog = useCatalog();
  useChatCatalog(campaignId);

  // Pull avatars for every member so message rows can render their picture.
  const profiles = useProfiles((s) => s.profiles);
  const loadProfiles = useProfiles((s) => s.loadFor);
  useEffect(() => {
    const ids = Object.keys(members);
    if (ids.length > 0) void loadProfiles(ids);
  }, [members, loadProfiles]);

  // Unread + "ping" counts derived from messages with created_at > lastSeenAt.
  // A "ping" is a message directed at you — either an @-mention OR a whisper
  // where you're in `whisper_to`. Both get the red badge + chime.
  const lastSeenAt = useChat((s) => s.lastSeenAt);
  const markSeen = useChat((s) => s.markSeen);
  const { hasNew, pingCount } = useMemo(() => {
    if (!userId) return { hasNew: false, pingCount: 0 };
    let any = false;
    let pings = 0;
    for (const m of messages) {
      if (m.senderId === userId) continue;
      const ts = new Date(m.createdAt).getTime();
      if (ts <= lastSeenAt) continue;
      // Soft-deleted rows shouldn't notify — they're effectively gone.
      if (m.deletedAt) continue;
      any = true;
      const mentioned = m.mentions.includes(userId);
      const whisperedTo = m.whisperTo?.includes(userId) ?? false;
      if (mentioned || whisperedTo) pings++;
    }
    return { hasNew: any, pingCount: pings };
  }, [messages, lastSeenAt, userId]);

  // Play a short chime whenever the ping count goes up — i.e. a new
  // mention or whisper arrived. Skips the very first effect run so we
  // don't beep just because pre-existing unread messages were loaded.
  const prevPingCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevPingCountRef.current !== null && pingCount > prevPingCountRef.current) {
      playPingSound();
    }
    prevPingCountRef.current = pingCount;
  }, [pingCount]);

  // Mark messages as read whenever chat is visible (embedded view, or
  // floating panel open). Re-fires on new message arrivals so the count
  // stays at zero while the user is actively reading.
  useEffect(() => {
    if (!campaignId) return;
    const visible = embedded || open;
    if (visible) markSeen(campaignId);
  }, [embedded, open, messages.length, campaignId, markSeen]);

  // Load + subscribe once per campaign; clear on unmount.
  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    const unsub = subscribe(campaignId);
    return () => {
      unsub();
      clear();
    };
  }, [campaignId, loadForCampaign, subscribe, clear]);

  // Embedded mode is always "open" — only the floating variant has a panel state.
  const isOpen = embedded || open;

  // Auto-scroll to bottom when new messages arrive or the panel becomes visible.
  useEffect(() => {
    if (!isOpen) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isOpen, messages.length]);

  // Esc closes the floating panel (no-op when embedded).
  useEffect(() => {
    if (!open || embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, embedded, close]);

  // Floating panel: hydrate user-resized dimensions from localStorage so the
  // size sticks across reloads. Embedded mode fills its container and ignores
  // these values.
  const [size, setSize] = useState<{ w: number; h: number }>(() => readPopoutSize());
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const beginResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startW = size.w;
    const startH = size.h;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = posRef.current;
    const onMove = (ev: MouseEvent) => {
      // Handle sits at the panel's top-left. Dragging up-left grows it.
      const dw = startX - ev.clientX;
      const dh = startY - ev.clientY;
      const nextW = clamp(startW + dw, MIN_POPOUT_W, window.innerWidth - 32);
      const nextH = clamp(startH + dh, MIN_POPOUT_H, window.innerHeight - 32);
      setSize({ w: nextW, h: nextH });
      // When the panel is positioned by top/left, the top-left corner stays
      // fixed by default — so growing the height extends downward and the
      // handle feels inverted. Shift pos by the actual size delta so the
      // top-left tracks the cursor.
      if (startPos) {
        setPos({
          x: clamp(startPos.x - (nextW - startW), 8, window.innerWidth - MIN_POPOUT_W),
          y: clamp(startPos.y - (nextH - startH), 8, window.innerHeight - MIN_POPOUT_H),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      writePopoutSize(sizeRef.current);
      if (startPos) writePopoutPos(posRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Custom panel position (drag-by-header). `null` keeps the bottom-right
  // anchor — that's the default for new users and after explicit reset.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => readPopoutPos());
  const posRef = useRef(pos);
  posRef.current = pos;

  const beginDrag = (e: React.MouseEvent) => {
    // Ignore drags that started on an interactive child (buttons, inputs).
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, select')) return;
    e.preventDefault();
    // Anchor the panel by its current top/left for the duration of the drag.
    // If we were still bottom-right-anchored, compute the equivalent top/left
    // from the panel rect so the drag starts from the visible position.
    const panel = (e.currentTarget as HTMLElement).closest('[data-chat-panel]') as HTMLElement | null;
    const rect = panel?.getBoundingClientRect();
    const startPos = posRef.current ?? (rect ? { x: rect.left, y: rect.top } : { x: 16, y: 16 });
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const next = {
        x: clamp(startPos.x + (ev.clientX - startX), 8, window.innerWidth - sizeRef.current.w - 8),
        y: clamp(startPos.y + (ev.clientY - startY), 8, window.innerHeight - 48),
      };
      setPos(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      writePopoutPos(posRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetPanelPos = () => {
    setPos(null);
    writePopoutPos(null);
  };

  if (!campaignId || !userId) return null;

  if (!embedded && !open) {
    return (
      <button
        onClick={openPanel}
        title={
          pingCount > 0
            ? `Party chat — ${pingCount} for you`
            : hasNew
            ? 'Party chat — new messages'
            : 'Party chat'
        }
        className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-200 shadow-lg flex items-center justify-center"
        style={{ color: 'var(--ac-200)' }}
      >
        <MessageCircle size={20} />
        {pingCount > 0 ? (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center border-2 border-slate-950"
            aria-label={`${pingCount} unread mention${pingCount === 1 ? '' : 's'} or whisper${pingCount === 1 ? '' : 's'}`}
          >
            {pingCount > 9 ? '9+' : pingCount}
          </span>
        ) : hasNew ? (
          <span
            className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-white border border-slate-950"
            aria-label="New messages"
          />
        ) : null}
      </button>
    );
  }

  const containerClass = embedded
    ? 'h-full w-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex flex-col'
    : 'fixed z-40 bg-slate-950 border border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col';

  const containerStyle: React.CSSProperties | undefined = embedded
    ? undefined
    : pos
      ? { width: size.w, height: size.h, left: pos.x, top: pos.y }
      : { width: size.w, height: size.h, bottom: 16, right: 16 };

  return (
    <div data-chat-panel className={containerClass} style={containerStyle}>
      {!embedded && (
        <button
          onMouseDown={beginResize}
          title="Drag to resize"
          aria-label="Resize chat panel"
          className="absolute top-1 left-1 z-10 w-4 h-4 text-slate-600 hover:text-slate-300 flex items-center justify-center"
          style={{ cursor: 'nwse-resize' }}
        >
          <svg viewBox="0 0 10 10" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M0.5 4.5 L4.5 0.5 M0.5 8.5 L8.5 0.5" />
          </svg>
        </button>
      )}
      <div
        onMouseDown={embedded ? undefined : beginDrag}
        onDoubleClick={embedded ? undefined : resetPanelPos}
        className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900"
        style={embedded ? undefined : { cursor: 'move' }}
        title={embedded ? undefined : 'Drag to move · double-click to reset position'}
      >
        <div className="flex items-center gap-2 text-sm text-slate-200">
          <MessageCircle size={14} style={{ color: 'var(--ac-400)' }} />
          <span className="font-medium">Party Chat</span>
        </div>
        <div className="flex items-center gap-1">
          <SyntaxHelp />
          {!embedded && <MyColorSwatch />}
          {!embedded && (
            <button
              onClick={close}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!loaded && (
          <div className="text-xs text-slate-500 text-center py-6">Loading messages…</div>
        )}
        {loaded && messages.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-6">
            No messages yet. Say hello!
          </div>
        )}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            mine={m.senderId === userId}
            mentionsMe={m.mentions.includes(userId)}
            senderName={members[m.senderId]?.displayName ?? 'Unknown'}
            senderColor={members[m.senderId]?.color ?? '#94a3b8'}
            senderAvatarUrl={avatarPublicUrl(profiles[m.senderId]?.avatarPath ?? null)}
            members={members}
            selfId={userId}
          />
        ))}
      </div>

      <Composer
        campaignId={campaignId}
        members={Object.values(members)}
        selfId={userId}
        catalog={catalog}
        onSend={(body, opts) => {
          // `/roll 1d20+5` posts a result card instead of the literal text, and
          // also drops it into the local dice history so the on-screen flourish
          // fires for the person who rolled.
          const cmd = parseRollCommand(body);
          if (cmd) {
            const roll = makeRoll(cmd.formula, cmd.label);
            if (roll) {
              useQuickDice.getState().pushRoll(roll);
              return sendRoll(
                campaignId,
                {
                  kind: 'roll',
                  label: roll.label,
                  detail: roll.detail,
                  total: roll.total,
                  die: roll.die,
                  crit: roll.crit,
                },
                { whisperTo: opts?.whisperTo },
              );
            }
            // Unparseable formula falls through and posts as plain text, so the
            // typo is visible rather than silently swallowed.
          }
          return send(campaignId, body, {
            mentions: extractMentionIds(body),
            whisperTo: opts?.whisperTo,
          });
        }}
      />
    </div>
  );
}

/**
 * Parse a `/roll` (or `/r`) command into a formula and optional label.
 *
 *   /roll 1d20+5              → { formula: '1d20+5' }
 *   /r 2d6 + 3 sneak attack   → { formula: '2d6 + 3', label: 'sneak attack' }
 *
 * The formula is matched greedily as leading dice/modifier terms; whatever
 * follows is treated as a label, so players can annotate a roll naturally
 * without learning a separator.
 */
export function parseRollCommand(input: string): { formula: string; label?: string } | null {
  const m = input.trim().match(/^\/(?:roll|r)\s+(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  const split = rest.match(/^((?:\s*[+-]?\s*(?:\d*d\d+|\d+))+)\s*(.*)$/i);
  if (!split) return null;
  const formula = split[1].trim();
  const label = split[2].trim();
  if (!formula) return null;
  return { formula, label: label || undefined };
}

/** A dice result rendered inside the chat log. */
function RollCard({ roll }: { roll: ChatRollData }) {
  const accent =
    roll.crit === 'hit' ? '#fbbf24' : roll.crit === 'miss' ? '#f43f5e' : 'var(--ac-400)';
  return (
    <div
      className="mt-0.5 inline-flex items-center gap-2.5 rounded border px-2.5 py-1.5"
      style={{ borderColor: `${'var(--ac-700)'}`, background: 'rgb(2 6 23 / 0.5)' }}
    >
      <span
        className="font-mono text-lg leading-none tabular-nums"
        style={{ color: accent }}
      >
        {roll.total}
      </span>
      <span className="flex flex-col leading-tight min-w-0">
        <span className="text-[11px] text-slate-300 truncate">{roll.label}</span>
        <span className="text-[10px] font-mono text-slate-500 truncate">{roll.detail}</span>
      </span>
      {roll.crit && (
        <span
          className="text-[9px] uppercase tracking-[0.15em] shrink-0"
          style={{ color: accent }}
        >
          {roll.crit === 'hit' ? 'Crit' : 'Fumble'}
        </span>
      )}
    </div>
  );
}

function MessageRow({
  msg,
  mine,
  mentionsMe,
  senderName,
  senderColor,
  senderAvatarUrl,
  members,
  selfId,
}: {
  msg: ChatMessage;
  mine: boolean;
  mentionsMe: boolean;
  senderName: string;
  senderColor: string;
  senderAvatarUrl: string | null;
  members: Record<string, ChatMember>;
  selfId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body);
  const editMsg = useChat((s) => s.edit);
  const removeMsg = useChat((s) => s.remove);

  const isWhisper = msg.whisperTo != null;
  const isDeleted = msg.deletedAt != null;

  const time = useMemo(() => {
    const d = new Date(msg.createdAt);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [msg.createdAt]);

  const startEdit = () => {
    setDraft(msg.body);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(msg.body);
  };
  const saveEdit = async () => {
    const next = draft.trim();
    if (!next || next === msg.body) {
      cancelEdit();
      return;
    }
    await editMsg(msg.id, next);
    setEditing(false);
  };

  if (isDeleted) {
    return (
      <div className="text-[11px] italic text-slate-600 pl-10">
        <span style={{ color: senderColor }}>{senderName}</span> deleted a message
      </div>
    );
  }

  return (
    <div
      className={`group text-sm leading-snug flex gap-2 ${
        mentionsMe ? 'border-l-2 pl-2 -ml-2' : ''
      }`}
      style={mentionsMe ? { borderColor: 'var(--ac-400)', background: 'color-mix(in srgb, var(--ac-900) 12%, transparent)' } : undefined}
    >
      <ChatAvatar url={senderAvatarUrl} color={senderColor} name={senderName} />
      <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="font-medium text-[12px]" style={{ color: senderColor }}>
          {senderName}
        </span>
        <span className="text-[10px] text-slate-600">{time}</span>
        {msg.editedAt && (
          <span className="text-[10px] text-slate-600" title={`Edited ${new Date(msg.editedAt).toLocaleString()}`}>
            (edited)
          </span>
        )}
        {isWhisper && msg.whisperTo && (
          <span className="text-[10px] text-slate-500 italic flex items-baseline gap-0.5">
            <span>whisper →</span>
            {msg.whisperTo.map((uid, i) => {
              const m = members[uid];
              const name = m?.displayName ?? 'unknown';
              const color = m?.color ?? '#94a3b8';
              return (
                <span key={uid} className="not-italic">
                  {i > 0 && <span className="text-slate-600">,</span>}
                  <span style={{ color }}>@{name}</span>
                </span>
              );
            })}
          </span>
        )}
        {mine && !editing && (
          <span className="ml-auto opacity-0 group-hover:opacity-100 flex gap-1">
            <button
              onClick={startEdit}
              className="text-slate-500 hover:text-slate-200 p-0.5"
              title="Edit"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => removeMsg(msg.id)}
              className="text-slate-500 hover:text-rose-300 p-0.5"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <EditRow
          draft={draft}
          setDraft={setDraft}
          members={Object.values(members)}
          selfId={selfId}
          onSave={saveEdit}
          onCancel={cancelEdit}
        />
      ) : msg.data?.kind === 'roll' && !isDeleted ? (
        <RollCard roll={msg.data} />
      ) : (
        <MessageBody body={msg.body} members={members} whisper={isWhisper} selfId={selfId} />
      )}
      </div>
    </div>
  );
}

/** Small (28px) avatar shown next to each message — image or colored initial. */
function ChatAvatar({
  url,
  color,
  name,
}: {
  url: string | null;
  color: string;
  name: string;
}) {
  const initial = (name || '?').slice(0, 1).toUpperCase();
  return (
    <div
      className="h-7 w-7 rounded-full border overflow-hidden flex items-center justify-center text-[11px] font-serif shrink-0 mt-0.5"
      style={{
        borderColor: color,
        backgroundColor: url ? '#020617' : `color-mix(in srgb, ${color} 22%, transparent)`,
        color,
      }}
      title={name}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initial}
    </div>
  );
}

function EditRow({
  draft,
  setDraft,
  members,
  selfId,
  onSave,
  onCancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  members: ChatMember[];
  selfId: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const catalog = useCatalog();
  return (
    <div className="flex items-end gap-1">
      <div className="flex-1">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          members={members}
          selfId={selfId}
          catalog={catalog}
          onSubmit={onSave}
          onEscape={onCancel}
          autoFocus
        />
      </div>
      <button
        onClick={onSave}
        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
        title="Save (Enter)"
      >
        <Check size={12} />
      </button>
      <button
        onClick={onCancel}
        className="p-1 rounded text-slate-500 hover:text-slate-300"
        title="Cancel (Esc)"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Inline-only markdown renderer — supports bold/italic/code/strike/links
 *  and unwraps the top-level `<p>` so the segment stays inline next to
 *  mention chips and catalog chips. Block-level markdown (headings, lists,
 *  code fences) is intentionally not surfaced — chat messages are short. */
function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={['strong', 'em', 'code', 'del', 'a']}
      unwrapDisallowed
      components={{
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-300 hover:underline"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="bg-slate-800 text-amber-200 rounded px-1 font-mono text-[12px]">
            {children}
          </code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function MessageBody({
  body,
  members,
  whisper,
  selfId,
}: {
  body: string;
  members: Record<string, ChatMember>;
  whisper: boolean;
  selfId: string;
}) {
  const segs = useMemo(() => parseSegments(body), [body]);
  const navigate = useNavigate();
  const setActiveNote = useNotes((s) => s.setActiveNote);
  const setActiveNpc = useNpcStore((s) => s.setActive);

  const onOpenRef = (refKind: CatalogKind, identifier: string) => {
    switch (refKind) {
      case 'note':
        setActiveNote(identifier);
        navigate('/notes');
        break;
      case 'npc':
        setActiveNpc(identifier);
        navigate('/npcs');
        break;
      case 'item':
        navigate(`/items#custom-${identifier}`);
        break;
      case 'srd-item':
        navigate(`/items#${identifier}`);
        break;
      case 'spell':
        navigate(`/spells#custom-${identifier}`);
        break;
      case 'srd-spell':
        navigate(`/spells#${identifier}`);
        break;
      case 'rule':
        navigate(`/rules#${identifier}`);
        break;
    }
  };

  return (
    <div
      className={whisper ? 'italic text-slate-400' : 'text-slate-200'}
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {segs.map((s, i) => {
        if (s.kind === 'text') return <InlineMarkdown key={i} text={s.text} />;
        if (s.kind === 'mention') {
          const m = members[s.userId];
          const color = m?.color ?? '#94a3b8';
          const name = m?.displayName ?? s.name;
          const isSelf = s.userId === selfId;
          return (
            <ChipContextMenu key={i} id={s.userId}>
              <span
                className="inline-block rounded px-1 py-px text-[12px] font-medium align-baseline"
                style={{
                  color,
                  backgroundColor: `color-mix(in srgb, ${color} ${isSelf ? '28%' : '18%'}, transparent)`,
                }}
              >
                @{name}
              </span>
            </ChipContextMenu>
          );
        }
        // catalog reference chip
        const tokenId = `${s.refKind}:${s.identifier}`;
        return (
          <ChipContextMenu key={i} id={tokenId} onClick={() => onOpenRef(s.refKind, s.identifier)}>
            <span
              className="inline-flex items-center gap-1 rounded px-1 py-px text-[12px] font-medium align-baseline hover:brightness-125"
              style={{
                color: KIND_FG[s.refKind],
                backgroundColor: KIND_PILL_BG[s.refKind],
              }}
            >
              <span className="text-[10px]">{KIND_ICON_CHAR[s.refKind]}</span>
              {s.name}
            </span>
          </ChipContextMenu>
        );
      })}
    </div>
  );
}

function Composer({
  campaignId,
  onSend,
  members,
  selfId,
  catalog,
}: {
  campaignId: string;
  onSend: (body: string, opts?: { whisperTo?: string[] }) => void | Promise<void>;
  members: ChatMember[];
  selfId: string;
  catalog: import('./catalog').CatalogEntry[];
}) {
  const [value, setValue] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [lastWhisperId, setLastWhisperId] = useState<string | null>(null);

  // Whisper target now lives in the panel store so other surfaces (e.g. the
  // dashboard Campaign Members panel) can imperatively start a whisper.
  const whisperTargetId = useChatPanel((s) => s.whisperTargetId);
  const setWhisperTargetId = useChatPanel((s) => s.setWhisperTarget);
  const whisperTo = useMemo(
    () => (whisperTargetId ? members.find((m) => m.userId === whisperTargetId) ?? null : null),
    [whisperTargetId, members]
  );

  // Hydrate last-whisper memory when switching campaigns.
  useEffect(() => {
    setLastWhisperId(readLastWhisper(campaignId));
  }, [campaignId]);

  // Only detect the slash command before a recipient is locked in. Once we
  // have a recipient, the `/w` prefix would just be ordinary message text.
  const whisperCmd = whisperTo ? null : detectWhisperCommand(value);
  const pickerActive = whisperCmd != null;

  const candidates = useMemo(() => {
    if (!whisperCmd) return [];
    const available = members.filter((m) => m.userId !== selfId);
    const matched = filterMembers(available, whisperCmd.query);
    // When the query is empty and we have a remembered recipient who's still
    // a member, hoist them to the top so Enter re-whispers (like MC's `/r`).
    if (!whisperCmd.query && lastWhisperId) {
      const last = matched.find((m) => m.userId === lastWhisperId);
      if (last) {
        const rest = matched.filter((m) => m.userId !== lastWhisperId);
        return [last, ...rest].slice(0, 8);
      }
    }
    return matched.slice(0, 8);
  }, [members, selfId, whisperCmd, lastWhisperId]);

  useEffect(() => {
    setHighlight(0);
  }, [candidates.length, whisperCmd?.query]);

  const pickWhisper = (m: ChatMember) => {
    setWhisperTargetId(m.userId);
    setLastWhisperId(m.userId);
    writeLastWhisper(campaignId, m.userId);
    setValue('');
  };
  const cancelWhisperCommand = () => {
    setValue('');
  };

  useWhisperKeyboard({
    active: pickerActive,
    candidates,
    highlight,
    setHighlight,
    pick: pickWhisper,
    cancel: cancelWhisperCommand,
  });

  // Esc clears an active whisper recipient (when the picker isn't open).
  useEffect(() => {
    if (!whisperTo || pickerActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !value) {
        e.preventDefault();
        setWhisperTargetId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [whisperTo, pickerActive, value, setWhisperTargetId]);

  const submit = async () => {
    if (pickerActive) return; // Enter is consumed by the picker
    const v = value.trim();
    if (!v) return;
    const target = whisperTo;
    setValue('');
    await onSend(v, target ? { whisperTo: [target.userId] } : undefined);
  };

  const placeholder = whisperTo
    ? `Message @${whisperTo.displayName}`
    : 'Message @party';

  return (
    <div className="border-t border-slate-800 bg-slate-900">
      {whisperTo && (
        <WhisperBar member={whisperTo} onCancel={() => setWhisperTargetId(null)} />
      )}
      <div className="px-2 pt-1 text-[10px] text-slate-600 italic flex items-center gap-1">
        <Eye size={10} /> The GM can see every message, including whispers.
      </div>
      <div className="relative px-2 py-2 flex items-end gap-2">
        {pickerActive && (
          <WhisperPicker
            candidates={candidates}
            active={highlight}
            lastRecipientId={lastWhisperId}
            onPick={pickWhisper}
            onHover={setHighlight}
          />
        )}
        <div className="flex-1">
          <MentionTextarea
            value={value}
            onChange={setValue}
            members={members}
            selfId={selfId}
            catalog={catalog}
            onSubmit={submit}
            placeholder={placeholder}
          />
        </div>
        <button
          onClick={submit}
          disabled={!value.trim() || pickerActive}
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200"
          title="Send (Enter)"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

const COLOR_PRESETS = [
  '#94a3b8', '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#e879f9',
];

/**
 * Player-color swatch in the chat header. Click to open a small popover with
 * presets and a native hex picker. Stays inside the chat panel so it never
 * gets clipped by sidebar overflow. Will move to a Profile page in a future
 * pass; this is the v1.1 home.
 */
function MyColorSwatch() {
  const myColor = useSession((s) => s.myColor);
  const updateMyColor = useSession((s) => s.updateMyColor);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!myColor) return null;

  const pick = (c: string) => {
    void updateMyColor(c);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Your chat color"
        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center gap-1"
      >
        <Palette size={13} />
        <span
          className="h-3 w-3 rounded-full border border-slate-700 shrink-0"
          style={{ backgroundColor: myColor }}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 bg-slate-900 border border-slate-700 rounded-md shadow-xl p-2 w-48">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Your chat color</div>
          <div className="grid grid-cols-5 gap-1.5 mb-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => pick(c)}
                className="h-6 w-6 rounded-full border border-slate-700 hover:scale-110 transition-transform"
                style={{
                  backgroundColor: c,
                  boxShadow: c === myColor ? '0 0 0 2px var(--ac-400)' : undefined,
                }}
                title={c}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <input
              type="color"
              value={myColor}
              onChange={(e) => updateMyColor(e.target.value)}
              className="h-5 w-8 bg-transparent border border-slate-700 rounded cursor-pointer"
            />
            Custom hex
          </label>
        </div>
      )}
    </div>
  );
}

/** Small "?" button in the chat header. Click reveals a syntax cheatsheet. */
function SyntaxHelp() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Chat syntax"
        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 bg-slate-900 border border-slate-700 rounded-md shadow-xl p-3 w-60 text-[12px]">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            Chat syntax
          </div>
          <ul className="space-y-1.5 text-slate-300">
            <li>
              <span className="font-mono text-slate-100">@</span>
              <span className="text-slate-500"> — mention a player</span>
            </li>
            <li>
              <span className="font-mono text-slate-100">#</span>
              <span className="text-slate-500"> — link a note, NPC, item, spell</span>
            </li>
            <li>
              <span className="font-mono text-slate-100">!</span>
              <span className="text-slate-500"> — link a 5e rule (Conditions, etc.)</span>
            </li>
            <li>
              <span className="font-mono text-slate-100">/w</span>
              <span className="text-slate-500"> — whisper to a player</span>
            </li>
            <li>
              <span className="font-mono text-slate-100">/w</span>
              <span className="text-slate-500"> alone — repeat last whisper</span>
            </li>
            <li>
              <span className="font-mono text-slate-100">Right-click</span>
              <span className="text-slate-500"> a chip — copy ID</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
