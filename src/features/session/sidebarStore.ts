import { create } from 'zustand';

/**
 * Per-user sidebar preferences (persisted to localStorage).
 *
 * Two modes:
 *   - 'manual' (default) — the sidebar stays where you put it and never
 *     auto-collapses; a collapse/expand button in the header toggles it. The
 *     pinned state lives in `collapsed`.
 *   - 'auto' — the sidebar sits as a 56px icon rail and grows to full width on
 *     hover / focus, collapsing again when the pointer leaves.
 */
export type SidebarMode = 'manual' | 'auto';

const MODE_KEY = 'grimoire:sidebar-mode';
const COLLAPSED_KEY = 'grimoire:sidebar-collapsed';
// Legacy key from when the only option was a hover-expand toggle. Read once so
// a user who had auto-expand on lands back in 'auto' mode after the upgrade.
const LEGACY_HOVER_KEY = 'grimoire:sidebar-hover-expand';

function readInitialMode(): SidebarMode {
  const v = localStorage.getItem(MODE_KEY);
  if (v === 'manual' || v === 'auto') return v;
  // Migrate: the old default was hover-expand ON (== auto). Only honour an
  // explicit legacy value; otherwise default to the new 'manual' (pinned open).
  if (localStorage.getItem(LEGACY_HOVER_KEY) === '1') return 'auto';
  return 'manual';
}

function readInitialCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_KEY) === '1';
}

interface SidebarState {
  mode: SidebarMode;
  /** Manual-mode pin state — true when the user has collapsed the rail. */
  collapsed: boolean;
  setMode: (m: SidebarMode) => void;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  mode: readInitialMode(),
  collapsed: readInitialCollapsed(),
  setMode: (mode) => {
    localStorage.setItem(MODE_KEY, mode);
    set({ mode });
  },
  setCollapsed: (v) => {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
    set({ collapsed: v });
  },
  toggleCollapsed: () => get().setCollapsed(!get().collapsed),
}));
