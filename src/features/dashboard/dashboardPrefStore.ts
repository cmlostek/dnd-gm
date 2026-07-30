import { create } from 'zustand';

/**
 * Per-user Dashboard preferences (localStorage). `defaultTab` is the tab the
 * Dashboard lands on when opened — most players want their character, not the
 * profile. 'manage' is GM-only and never a valid default, so it's excluded.
 */
export type DashboardDefaultTab = 'profile' | 'character' | 'chat' | 'dice';

export const DASHBOARD_TAB_LABELS: Record<DashboardDefaultTab, string> = {
  profile: 'Profile',
  character: 'Character',
  chat: 'Chat',
  dice: 'Dice',
};

const KEY = 'grimoire:dashboard-default-tab';

function readInitial(): DashboardDefaultTab {
  const v = localStorage.getItem(KEY);
  return v === 'profile' || v === 'character' || v === 'chat' || v === 'dice' ? v : 'profile';
}

interface DashboardPrefState {
  defaultTab: DashboardDefaultTab;
  setDefaultTab: (t: DashboardDefaultTab) => void;
}

export const useDashboardPref = create<DashboardPrefState>((set) => ({
  defaultTab: readInitial(),
  setDefaultTab: (t) => {
    localStorage.setItem(KEY, t);
    set({ defaultTab: t });
  },
}));
