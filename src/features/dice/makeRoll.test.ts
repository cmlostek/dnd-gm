import { describe, it, expect } from 'vitest';
import { makeRoll, evalFormula } from './quickDiceStore';
import { parseRollCommand } from '../chat/ChatPanel';

describe('evalFormula', () => {
  it('sums dice and modifiers', () => {
    const r = evalFormula('2d6 + 3');
    expect(r).not.toBeNull();
    // 2d6+3 spans 5..15 regardless of the rolls.
    expect(r!.total).toBeGreaterThanOrEqual(5);
    expect(r!.total).toBeLessThanOrEqual(15);
  });

  it('handles subtraction', () => {
    const r = evalFormula('1d4 - 1');
    expect(r!.total).toBeGreaterThanOrEqual(0);
    expect(r!.total).toBeLessThanOrEqual(3);
  });

  it('rejects nonsense', () => {
    expect(evalFormula('')).toBeNull();
    expect(evalFormula('banana')).toBeNull();
  });
});

describe('makeRoll', () => {
  it('reports the largest die so the overlay picks the right shape', () => {
    expect(makeRoll('1d4 + 1d6')?.die).toBe(6);
    expect(makeRoll('1d20 + 5')?.die).toBe(20);
  });

  it('has no die for a modifier-only formula', () => {
    expect(makeRoll('7')?.die).toBeUndefined();
  });

  it('falls back to the formula as the label', () => {
    expect(makeRoll('1d20')?.label).toBe('1d20');
    expect(makeRoll('1d20', 'Stealth')?.label).toBe('Stealth');
  });

  it('flags crits only on d20 formulas', () => {
    // Roll many times: a d20 must eventually produce both crit states, and a
    // d6 must never produce any.
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const r = makeRoll('1d20');
      if (r?.crit) seen.add(r.crit);
      expect(makeRoll('1d6')?.crit).toBeUndefined();
    }
    expect(seen.has('hit')).toBe(true);
    expect(seen.has('miss')).toBe(true);
  });

  it('returns null for an unparseable formula', () => {
    expect(makeRoll('not a roll')).toBeNull();
  });
});

describe('parseRollCommand', () => {
  it('accepts /roll and the /r shorthand', () => {
    expect(parseRollCommand('/roll 1d20+5')).toEqual({ formula: '1d20+5', label: undefined });
    expect(parseRollCommand('/r 1d20')).toEqual({ formula: '1d20', label: undefined });
    expect(parseRollCommand('/ROLL 1d20')?.formula).toBe('1d20');
  });

  it('treats trailing words as a label', () => {
    expect(parseRollCommand('/r 2d6 + 3 sneak attack')).toEqual({
      formula: '2d6 + 3',
      label: 'sneak attack',
    });
  });

  it('ignores ordinary messages', () => {
    expect(parseRollCommand('rolling for initiative')).toBeNull();
    expect(parseRollCommand('/roll')).toBeNull();       // no formula
    expect(parseRollCommand('/whisper bob hi')).toBeNull();
  });

  it('round-trips into a usable roll', () => {
    const cmd = parseRollCommand('/roll 3d6 fireball damage')!;
    const roll = makeRoll(cmd.formula, cmd.label)!;
    expect(roll.label).toBe('fireball damage');
    expect(roll.die).toBe(6);
    expect(roll.total).toBeGreaterThanOrEqual(3);
    expect(roll.total).toBeLessThanOrEqual(18);
  });
});
