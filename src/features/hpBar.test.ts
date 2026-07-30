import { describe, it, expect } from 'vitest';
import { hpBarClass, hpBarColor, hpPercent } from './hpBar';

// These thresholds are duplicated visually across five surfaces (character
// sheet, party, initiative, map tokens, party tooltip). The whole point of
// hpBar.ts is that they can't drift, so the boundaries are what's worth
// pinning down — not the happy path.

describe('hpPercent', () => {
  it('converts current/max to a percentage', () => {
    expect(hpPercent(50, 100)).toBe(50);
    expect(hpPercent(1, 3)).toBeCloseTo(33.333, 3);
  });

  it('returns 0 when maxHp is missing or nonsensical', () => {
    // Guards the "combatant added with no max HP" case, which is common for
    // quick NPC adds in the initiative tracker.
    expect(hpPercent(10, 0)).toBe(0);
    expect(hpPercent(10, -5)).toBe(0);
  });

  it('clamps to 0..100 rather than overflowing the bar', () => {
    expect(hpPercent(-20, 100)).toBe(0);   // damage past 0
    expect(hpPercent(150, 100)).toBe(100); // over-healed / temp HP
  });
});

describe('hpBarClass thresholds', () => {
  it('is emerald only above 50, not at it', () => {
    expect(hpBarClass(50.1)).toBe('bg-emerald-600');
    expect(hpBarClass(50)).toBe('bg-amber-500');
  });

  it('is amber only above 25, not at it', () => {
    expect(hpBarClass(25.1)).toBe('bg-amber-500');
    expect(hpBarClass(25)).toBe('bg-rose-600');
  });

  it('is rose at the bottom of the range', () => {
    expect(hpBarClass(0)).toBe('bg-rose-600');
  });
});

describe('hpBarColor', () => {
  it('uses the same thresholds as hpBarClass', () => {
    // The hex variant exists for SVG/inline styles (map tokens). If the two
    // ever disagree, a token and its sheet would show different colours for
    // the same HP — so assert them in lock-step.
    for (const pct of [0, 25, 25.1, 50, 50.1, 100]) {
      const tier = (c: string) =>
        c.includes('emerald') || c === '#059669' ? 'high'
        : c.includes('amber') || c === '#f59e0b' ? 'mid'
        : 'low';
      expect(tier(hpBarColor(pct))).toBe(tier(hpBarClass(pct)));
    }
  });
});
