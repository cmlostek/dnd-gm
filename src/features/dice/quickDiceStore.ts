import { create } from 'zustand';

export type Roll = {
  id: string;
  label: string;
  detail: string;
  total: number;
  crit?: 'hit' | 'miss';
  dropped?: number;
  /** Largest die size in the roll (20 for "1d20 + 5"). Drives the shape the
   *  roll overlay draws; undefined for modifier-only rolls. */
  die?: number;
};

const rollDie = (sides: number) => Math.floor(Math.random() * sides) + 1;

/** Evaluate a dice formula like "1d20 + 8" or "2d6 - 1" or "1d4 + 1d6 + 2". */
export function evalFormula(
  formula: string
): { total: number; detail: string } | null {
  // Match each signed term: optional leading +/-, then NdN or plain number
  const termRe = /([+-]?\s*(?:\d*d\d+|\d+))/gi;
  const terms = [...formula.matchAll(termRe)];
  if (terms.length === 0) return null;

  let total = 0;
  const parts: string[] = [];

  for (const [, term] of terms) {
    const t = term.replace(/\s/g, '');
    const sign = t.startsWith('-') ? -1 : 1;
    const body = t.replace(/^[+-]/, '');
    const dm = body.match(/^(\d*)d(\d+)$/i);

    if (dm) {
      const count = Math.min(100, Math.max(1, parseInt(dm[1] || '1', 10)));
      const sides = parseInt(dm[2], 10);
      if (sides < 1) return null;
      const rolls = Array.from({ length: count }, () => rollDie(sides));
      const sum = rolls.reduce((a, b) => a + b, 0);
      total += sign * sum;
      const inner = rolls.length === 1 ? String(rolls[0]) : rolls.join('+');
      const prefix = sign < 0 ? '−' : parts.length ? '+' : '';
      parts.push(`${prefix}[${inner}]`);
    } else {
      const n = parseInt(body, 10);
      if (isNaN(n)) return null;
      total += sign * n;
      if (n !== 0) {
        const prefix = sign < 0 ? '−' : parts.length ? '+' : '';
        parts.push(`${prefix}${Math.abs(n)}`);
      }
    }
  }

  return { total, detail: parts.join(' ') };
}

/**
 * Build a Roll from a formula without touching any store. Shared by the quick
 * dice panel and the chat `/roll` command so crit detection and die-size
 * derivation can't drift between them. Returns null for an unparseable formula.
 */
export function makeRoll(formula: string, label?: string): Roll | null {
  const trimmed = formula.trim();
  const result = evalFormula(trimmed);
  if (!result) return null;
  const { total, detail } = result;

  // Nat-20 / nat-1 on any d20 term.
  let crit: Roll['crit'];
  if (/d20/i.test(trimmed)) {
    const m = detail.match(/\[(\d+)\]/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v === 20) crit = 'hit';
      else if (v === 1) crit = 'miss';
    }
  }

  // Biggest die in the formula — "1d4 + 1d6" reads as a d6 roll for display.
  const dice = [...trimmed.matchAll(/d(\d+)/gi)].map((m) => parseInt(m[1], 10));

  return {
    id: crypto.randomUUID(),
    label: label ?? trimmed,
    detail,
    total,
    crit,
    die: dice.length ? Math.max(...dice) : undefined,
  };
}

type QuickDiceStore = {
  open: boolean;
  history: Roll[];
  toggle: () => void;
  openPanel: () => void;
  close: () => void;
  pushRoll: (r: Roll) => void;
  clearHistory: () => void;
  /** Roll a formula string, push result into the panel, and open it. */
  rollFormula: (formula: string, label?: string) => void;
};

export const useQuickDice = create<QuickDiceStore>((set, get) => ({
  open: false,
  history: [],

  toggle: () => set((s) => ({ open: !s.open })),
  openPanel: () => set({ open: true }),
  close: () => set({ open: false }),

  pushRoll: (r) => set((s) => ({ history: [r, ...s.history].slice(0, 20) })),

  clearHistory: () => set({ history: [] }),

  rollFormula: (formula, label) => {
    const roll = makeRoll(formula, label);
    if (!roll) return;
    get().pushRoll(roll);
    set({ open: true });
  },
}));
