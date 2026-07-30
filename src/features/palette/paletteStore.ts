import { create } from 'zustand';

/** Command palette visibility. Transient — never persisted. */
interface PaletteState {
  open: boolean;
  openPalette: () => void;
  close: () => void;
  toggle: () => void;
}

export const usePalette = create<PaletteState>((set, get) => ({
  open: false,
  openPalette: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
