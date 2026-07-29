import { describe, it, expect } from 'vitest';
import { searchCatalog, splitCatalogId, kindLabel, type CatalogEntry } from './catalog';

const e = (id: string, name: string): CatalogEntry => ({
  id,
  kind: id.split(':')[0] as CatalogEntry['kind'],
  name,
});

const entries: CatalogEntry[] = [
  e('srd-spell:fireball', 'Fireball'),
  e('srd-spell:fire-bolt', 'Fire Bolt'),
  e('srd-item:ball-bearings', 'Ball Bearings'),
  e('npc:1', 'Balthazar the Fireproof'),
  e('note:1', 'Session 3 — the fire'),
];

describe('searchCatalog', () => {
  it('ranks prefix matches ahead of substring matches', () => {
    // This ordering is what makes @-mentions and the inventory picker feel
    // right: typing "fire" should offer Fireball before "Session 3 — the fire".
    const names = searchCatalog(entries, 'fire').map((x) => x.name);
    expect(names.slice(0, 2)).toEqual(['Fireball', 'Fire Bolt']);
    expect(names).toContain('Balthazar the Fireproof');
    expect(names.indexOf('Fireball')).toBeLessThan(names.indexOf('Balthazar the Fireproof'));
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(searchCatalog(entries, '  FIREBALL ').map((x) => x.name)).toEqual(['Fireball']);
  });

  it('returns the head of the list for an empty query', () => {
    // Drives the "just opened the picker" state.
    expect(searchCatalog(entries, '', 2)).toHaveLength(2);
    expect(searchCatalog(entries, '   ', 2)).toHaveLength(2);
  });

  it('never returns more than the limit', () => {
    expect(searchCatalog(entries, 'a', 2)).toHaveLength(2);
    expect(searchCatalog(entries, 'fire', 1)).toHaveLength(1);
  });

  it('returns nothing when there is no match', () => {
    expect(searchCatalog(entries, 'zzzznope')).toEqual([]);
  });
});

describe('splitCatalogId', () => {
  it('splits the <kind>:<identifier> shape', () => {
    expect(splitCatalogId('srd-spell:fireball')).toEqual({
      kind: 'srd-spell',
      identifier: 'fireball',
    });
  });

  it('does not mistake srd-item for the bare item kind', () => {
    // The alternation lists `item` before `srd-item`; only the ^ anchor keeps
    // this correct, so it's worth locking in.
    expect(splitCatalogId('srd-item:longsword')?.kind).toBe('srd-item');
    expect(splitCatalogId('item:homebrew-uuid')?.kind).toBe('item');
  });

  it('keeps colons inside the identifier', () => {
    expect(splitCatalogId('note:abc:def')?.identifier).toBe('abc:def');
  });

  it('rejects unknown kinds and malformed ids', () => {
    expect(splitCatalogId('monster:goblin')).toBeNull();
    expect(splitCatalogId('note')).toBeNull();
    expect(splitCatalogId('note:')).toBeNull(); // needs at least one char
  });
});

describe('kindLabel', () => {
  it('collapses srd and homebrew kinds to the same user-facing word', () => {
    expect(kindLabel('srd-spell')).toBe(kindLabel('spell'));
    expect(kindLabel('srd-item')).toBe(kindLabel('item'));
  });
});
