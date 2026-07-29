import { describe, it, expect } from 'vitest';
import {
  creatureXp,
  multiplier2014,
  rateEncounter,
  suggestEncounters,
  targetXpFor,
} from './encounterMath';

const party = (n: number, level: number) => Array.from({ length: n }, () => ({ level }));

describe('creatureXp', () => {
  it('prefers the creature’s own xp', () => {
    expect(creatureXp({ xp: 1234, cr: '1' })).toBe(1234);
  });

  it('falls back to the CR ladder when xp is missing or zero', () => {
    expect(creatureXp({ cr: '1/4' })).toBe(50);
    expect(creatureXp({ cr: '0.25' })).toBe(50);
    expect(creatureXp({ xp: 0, cr: '5' })).toBe(1800);
  });

  it('is 0 for an unknown CR rather than NaN', () => {
    expect(creatureXp({ cr: 'banana' })).toBe(0);
    expect(creatureXp({})).toBe(0);
  });
});

describe('multiplier2014', () => {
  it('steps up with monster count', () => {
    const p = 4;
    expect(multiplier2014(1, p)).toBe(1);
    expect(multiplier2014(2, p)).toBe(1.5);
    expect(multiplier2014(3, p)).toBe(2);
    expect(multiplier2014(6, p)).toBe(2);
    expect(multiplier2014(7, p)).toBe(2.5);
    expect(multiplier2014(11, p)).toBe(3);
    expect(multiplier2014(15, p)).toBe(4);
  });

  it('shifts one step harder for a party of fewer than three', () => {
    expect(multiplier2014(2, 2)).toBe(2);   // 1.5 → 2
    expect(multiplier2014(1, 2)).toBe(1.5); // 1 → 1.5
  });

  it('shifts one step easier for a party larger than five', () => {
    expect(multiplier2014(2, 6)).toBe(1);   // 1.5 → 1
    expect(multiplier2014(3, 6)).toBe(1.5); // 2 → 1.5
  });
});

describe('rateEncounter — 2014', () => {
  it('matches the DMG’s four-goblins-vs-four-level-1s example', () => {
    // 4 goblins × 50 XP = 200 raw; ×2 for a group of 3–6 = 400 adjusted.
    // Four level-1 characters have a deadly threshold of 4 × 100 = 400.
    const r = rateEncounter(party(4, 1), [{ xp: 50, count: 4 }], '2014');
    expect(r.rawXp).toBe(200);
    expect(r.multiplier).toBe(2);
    expect(r.adjustedXp).toBe(400);
    expect(r.difficulty).toBe('deadly');
  });

  it('rates a lone weak creature as trivial', () => {
    const r = rateEncounter(party(4, 5), [{ xp: 25, count: 1 }], '2014');
    expect(r.difficulty).toBe('trivial');
  });

  it('awards unadjusted XP even though difficulty uses the multiplier', () => {
    // The multiplier is a planning aid; the party still earns raw XP.
    const r = rateEncounter(party(4, 1), [{ xp: 50, count: 4 }], '2014');
    expect(r.xpAward).toBe(200);
    expect(r.xpPerCharacter).toBe(50);
  });

  it('exposes four ascending bands', () => {
    const r = rateEncounter(party(4, 1), [], '2014');
    expect(r.bands.map((b) => b.label)).toEqual(['Easy', 'Medium', 'Hard', 'Deadly']);
    expect(r.bands.map((b) => b.xp)).toEqual([100, 200, 300, 400]);
  });
});

describe('rateEncounter — 2024', () => {
  it('applies no multiplier', () => {
    const r = rateEncounter(party(4, 1), [{ xp: 50, count: 4 }], '2024');
    expect(r.multiplier).toBe(1);
    expect(r.adjustedXp).toBe(r.rawXp);
    expect(r.rawXp).toBe(200);
  });

  it('uses three bands', () => {
    const r = rateEncounter(party(4, 1), [], '2024');
    expect(r.bands.map((b) => b.label)).toEqual(['Low', 'Moderate', 'High']);
    expect(r.bands.map((b) => b.xp)).toEqual([200, 300, 400]);
  });

  it('can disagree sharply with 2014 on the same monsters', () => {
    // The same four goblins: 200 raw XP either way. 2014 doubles it for the
    // group and lands on deadly (400 vs a 400 threshold); 2024 compares the
    // raw total against a 200 low-band budget and calls it the mildest tier.
    // That gap is precisely why the edition setting matters.
    const creatures = [{ xp: 50, count: 4 }];
    expect(rateEncounter(party(4, 1), creatures, '2014').difficulty).toBe('deadly');
    expect(rateEncounter(party(4, 1), creatures, '2024').difficulty).toBe('low');
  });
});

describe('rateEncounter — edge cases', () => {
  it('handles an empty party without dividing by zero', () => {
    const r = rateEncounter([], [{ xp: 200, count: 1 }], '2014');
    expect(Number.isFinite(r.xpPerCharacter)).toBe(true);
    expect(r.xpPerCharacter).toBe(200);
  });

  it('clamps out-of-range levels instead of throwing', () => {
    expect(() => rateEncounter(party(4, 0), [], '2014')).not.toThrow();
    expect(() => rateEncounter(party(4, 99), [], '2024')).not.toThrow();
  });

  it('treats a missing count as one', () => {
    expect(rateEncounter(party(4, 5), [{ xp: 100 }], '2024').rawXp).toBe(100);
  });
});

describe('suggestEncounters', () => {
  const pool = [
    { id: 'g', name: 'Goblin', xp: 50, cr: '1/4' },
    { id: 'o', name: 'Ogre', xp: 450, cr: '2' },
    { id: 'd', name: 'Ancient Dragon', xp: 62000, cr: '24' },
  ];

  it('suggests counts that land near the target', () => {
    const target = targetXpFor(party(4, 3), '2024', 'Moderate');
    const out = suggestEncounters(pool, party(4, 3), '2024', target);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      // Every suggestion should be within the filter window of the target.
      expect(s.delta).toBeLessThanOrEqual(target * 0.5);
      expect(s.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('drops creatures that cannot get close at any count', () => {
    const out = suggestEncounters(pool, party(4, 1), '2024', 300);
    expect(out.some((s) => s.creature.id === 'd')).toBe(false);
  });

  it('accounts for the 2014 multiplier so groups do not overshoot', () => {
    const target = 400;
    const out2014 = suggestEncounters(pool, party(4, 1), '2014', target);
    const goblin = out2014.find((s) => s.creature.id === 'g');
    expect(goblin).toBeDefined();
    // 4 goblins × 50 × 2 = 400 — exactly the target, not 8 goblins on raw maths.
    expect(goblin!.adjustedXp).toBe(400);
    expect(goblin!.count).toBe(4);
  });

  it('returns nothing for a zero budget or empty pool', () => {
    expect(suggestEncounters(pool, party(4, 1), '2014', 0)).toEqual([]);
    expect(suggestEncounters([], party(4, 1), '2014', 500)).toEqual([]);
  });

  it('never suggests an unrunnable pile of creatures', () => {
    // A pure closest-XP ranking happily proposes "12× Camel" because any weak
    // creature can hit a budget exactly given enough bodies.
    const mooks = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`, name: `Mook ${i}`, xp: 25, cr: '1/8',
    }));
    const out = suggestEncounters(mooks, party(4, 3), '2024', 900);
    for (const s of out) expect(s.count).toBeLessThanOrEqual(8);
  });

  it('spans encounter shapes rather than repeating one', () => {
    // Solo / pair / group / swarm — a GM needs options that differ in kind,
    // not five variations of "four medium beasts".
    const varied = [
      { id: 'a', name: 'Big', xp: 700, cr: '3' },
      { id: 'b', name: 'Mid', xp: 300, cr: '2' },
      { id: 'c', name: 'Small', xp: 100, cr: '1/2' },
      { id: 'd', name: 'Tiny', xp: 50, cr: '1/4' },
    ];
    const out = suggestEncounters(varied, party(4, 3), '2024', 900, 4);
    const counts = out.map((s) => s.count);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('prefers a close single creature over a marginally closer crowd', () => {
    const choice = [
      { id: 'solo', name: 'Solo', xp: 880, cr: '4' },   // 1× → 880, Δ20
      { id: 'many', name: 'Many', xp: 150, cr: '1/2' }, // 6× → 900, Δ0
    ];
    const out = suggestEncounters(choice, party(4, 3), '2024', 900, 2);
    // The crowd lands exactly, but six creatures costs more than 20 XP of
    // accuracy is worth.
    expect(out[0].creature.id).toBe('solo');
  });
});
