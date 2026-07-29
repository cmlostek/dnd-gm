import { create } from 'zustand';

/**
 * Per-user dice presentation prefs (localStorage). Split into two toggles on
 * purpose: at a physical table people often want the on-screen roll but not
 * the sound coming out of the GM's laptop.
 */
const VISUAL_KEY = 'grimoire:dice:visual';
const SOUND_KEY = 'grimoire:dice:sound';

const read = (key: string) => {
  const v = localStorage.getItem(key);
  return v === null ? true : v === '1'; // default on
};

interface DiceEffectsState {
  visual: boolean;
  sound: boolean;
  setVisual: (v: boolean) => void;
  setSound: (v: boolean) => void;
}

export const useDiceEffects = create<DiceEffectsState>((set) => ({
  visual: read(VISUAL_KEY),
  sound: read(SOUND_KEY),
  setVisual: (v) => {
    localStorage.setItem(VISUAL_KEY, v ? '1' : '0');
    set({ visual: v });
  },
  setSound: (v) => {
    localStorage.setItem(SOUND_KEY, v ? '1' : '0');
    set({ sound: v });
  },
}));
