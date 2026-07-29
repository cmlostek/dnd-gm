import { create } from 'zustand';

/**
 * Floating scratchpad — a dump-and-forget notepad for things you jot mid-session
 * and sort out later (an NPC name you improvised, damage you owe someone, a
 * thread to pick up next week).
 *
 * Deliberately local-only: it never touches Supabase and is never shared. The
 * point is zero friction — no title, no folder, no "who can see this". When
 * something in here turns out to matter, "Save as note" promotes it into a real
 * campaign note.
 *
 * Scoped per campaign so a GM running two games doesn't get one's scribbles in
 * the other. Falls back to a shared key when no campaign is active.
 */
const textKey = (campaignId: string | null) =>
  `grimoire:scratchpad:${campaignId ?? 'global'}`;
const POS_KEY = 'grimoire:scratchpad:pos';

function readText(campaignId: string | null): string {
  try {
    return localStorage.getItem(textKey(campaignId)) ?? '';
  } catch {
    return '';
  }
}

export function readScratchPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: number; y?: number };
    if (p?.x == null || p?.y == null) return null;
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

export function writeScratchPos(pos: { x: number; y: number } | null) {
  try {
    if (pos === null) localStorage.removeItem(POS_KEY);
    else localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* private mode */
  }
}

interface ScratchpadState {
  open: boolean;
  text: string;
  /** Campaign the loaded text belongs to, so switching campaigns swaps it. */
  campaignId: string | null;

  toggle: () => void;
  openPad: () => void;
  close: () => void;
  /** Point the pad at a campaign, loading that campaign's text. */
  useCampaign: (campaignId: string | null) => void;
  setText: (t: string) => void;
  clear: () => void;
}

export const useScratchpad = create<ScratchpadState>((set, get) => ({
  open: false,
  text: readText(null),
  campaignId: null,

  toggle: () => set({ open: !get().open }),
  openPad: () => set({ open: true }),
  close: () => set({ open: false }),

  useCampaign: (campaignId) => {
    if (get().campaignId === campaignId) return;
    set({ campaignId, text: readText(campaignId) });
  },

  setText: (t) => {
    set({ text: t });
    try {
      localStorage.setItem(textKey(get().campaignId), t);
    } catch {
      /* private mode — the pad still works for this session */
    }
  },

  clear: () => get().setText(''),
}));
