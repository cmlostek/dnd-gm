import { create } from 'zustand';

/**
 * Browser notifications for chat pings.
 *
 * Deliberately *not* Web Push: that needs a service worker, VAPID keys, a
 * subscription table and a server-side sender, and only pays off if you want
 * alerts with the app fully closed. The Notification API covers the actual
 * case — the tab is open but backgrounded while you're doing something else
 * mid-session — with no infrastructure at all.
 */
const ENABLED_KEY = 'grimoire:notify:enabled';
const MENTIONS_KEY = 'grimoire:notify:mentions';
const WHISPERS_KEY = 'grimoire:notify:whispers';

const supported = typeof window !== 'undefined' && 'Notification' in window;

const read = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};

const write = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* private mode */
  }
};

export type NotifyKind = 'mention' | 'whisper';

interface NotificationState {
  supported: boolean;
  permission: NotificationPermission;
  /** Master switch. Off by default — nobody should get surprise popups. */
  enabled: boolean;
  onMention: boolean;
  onWhisper: boolean;

  setEnabled: (v: boolean) => void;
  setOnMention: (v: boolean) => void;
  setOnWhisper: (v: boolean) => void;
  /** Prompt for permission. Returns the resulting state. */
  request: () => Promise<NotificationPermission>;
  /**
   * Show a notification if the user has opted in, granted permission, wants
   * this kind, and isn't already looking at the page.
   */
  notify: (kind: NotifyKind, title: string, body: string) => void;
}

export const useNotifications = create<NotificationState>((set, get) => ({
  supported,
  permission: supported ? Notification.permission : 'denied',
  // Default off: opting in should be a deliberate act, and the permission
  // prompt is far less jarring when the user just asked for it.
  enabled: read(ENABLED_KEY, false),
  onMention: read(MENTIONS_KEY, true),
  onWhisper: read(WHISPERS_KEY, true),

  setEnabled: (v) => { write(ENABLED_KEY, v); set({ enabled: v }); },
  setOnMention: (v) => { write(MENTIONS_KEY, v); set({ onMention: v }); },
  setOnWhisper: (v) => { write(WHISPERS_KEY, v); set({ onWhisper: v }); },

  request: async () => {
    if (!get().supported) return 'denied';
    try {
      const p = await Notification.requestPermission();
      set({ permission: p });
      return p;
    } catch {
      return get().permission;
    }
  },

  notify: (kind, title, body) => {
    const s = get();
    if (!s.supported || !s.enabled || s.permission !== 'granted') return;
    if (kind === 'mention' && !s.onMention) return;
    if (kind === 'whisper' && !s.onWhisper) return;
    // Already looking at the page — the in-app badge and chime are enough.
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

    try {
      const n = new Notification(title, {
        body,
        // Collapse repeats so ten messages don't stack ten popups.
        tag: `grimoire-${kind}`,
        renotify: true,
      } as NotificationOptions);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* some browsers throw when constructing from a non-SW context */
    }
  },
}));
