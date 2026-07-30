/**
 * Encounter difficulty maths for both rules editions.
 *
 * Everything here is pure so it can be tested without a store or a DOM.
 *
 * ⚠️ The threshold/budget tables below are DMG content (not SRD), transcribed
 * by hand. Monster XP is *not* transcribed — it's read from the creature data,
 * which carries an `xp` field for every SRD monster and homebrew stat block.
 * XP_BY_CR exists only as a fallback for a homebrew entry saved without one.
 */

export type Edition = '2014' | '2024';

/** 2014 difficulty bands. */
export type Difficulty2014 = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';
/** 2024 difficulty bands. */
export type Difficulty2024 = 'trivial' | 'low' | 'moderate' | 'high';
export type Difficulty = Difficulty2014 | Difficulty2024;

/** Standard XP-by-CR ladder. Fallback only — prefer a creature's own xp. */
export const XP_BY_CR: Record<string, number> = {
  '0': 10, '1/8': 25, '0.125': 25, '1/4': 50, '0.25': 50, '1/2': 100, '0.5': 100,
  '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900,
  '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000,
  '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000,
  '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000,
  '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000,
};

/** 2014 DMG: per-character XP thresholds by level [easy, medium, hard, deadly]. */
const THRESHOLDS_2014: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100],          2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],        4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],      6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],     8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400],   10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600],  12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};

/** 2024 DMG: per-character XP budget by level [low, moderate, high]. */
const BUDGET_2024: Record<number, [number, number, number]> = {
  1: [50, 75, 100],             2: [100, 150, 200],
  3: [150, 225, 400],           4: [250, 375, 500],
  5: [500, 750, 1100],          6: [600, 1000, 1400],
  7: [750, 1300, 1700],         8: [1000, 1700, 2100],
  9: [1300, 2000, 2600],       10: [1600, 2300, 3100],
  11: [1900, 2900, 4100],      12: [2200, 3700, 4700],
  13: [2600, 4200, 5400],      14: [2900, 4900, 6200],
  15: [3300, 5400, 7800],      16: [3800, 6100, 9800],
  17: [4500, 7200, 11700],     18: [5000, 8700, 14200],
  19: [5500, 10700, 17200],    20: [6400, 13200, 22000],
};

const clampLevel = (n: number) => Math.max(1, Math.min(20, Math.round(n || 1)));

/** Resolve a creature's XP, falling back to the CR ladder when unset. */
export function creatureXp(c: { xp?: number; cr?: string | number }): number {
  if (typeof c.xp === 'number' && c.xp > 0) return c.xp;
  if (c.cr === undefined || c.cr === null) return 0;
  return XP_BY_CR[String(c.cr).trim()] ?? 0;
}

/**
 * 2014 encounter multiplier by monster count. The DMG also shifts one step up
 * for a party of fewer than three and one step down for more than five, which
 * is why this takes party size rather than just the count.
 */
export function multiplier2014(monsterCount: number, partySize: number): number {
  if (monsterCount <= 0) return 1;
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  let idx =
    monsterCount === 1 ? 1
    : monsterCount === 2 ? 2
    : monsterCount <= 6 ? 3
    : monsterCount <= 10 ? 4
    : monsterCount <= 14 ? 5
    : 6;
  if (partySize > 0 && partySize < 3) idx += 1;   // small party: harder
  if (partySize > 5) idx -= 1;                    // large party: easier
  return steps[Math.max(0, Math.min(steps.length - 1, idx))];
}

export type PartyMemberLevel = { level: number };

export type EncounterRating = {
  edition: Edition;
  /** Sum of creature XP before any multiplier. */
  rawXp: number;
  /** 2014 only — rawXp × count multiplier. Equals rawXp under 2024 rules. */
  adjustedXp: number;
  multiplier: number;
  difficulty: Difficulty;
  /** Band thresholds in ascending order, labelled for display. */
  bands: { label: string; xp: number }[];
  /** XP the party would earn (always the unadjusted total). */
  xpAward: number;
  /** Per-character XP if split evenly. */
  xpPerCharacter: number;
};

/**
 * Rate an encounter against a party.
 *
 * 2014 applies a count-based multiplier to the encounter's XP and compares it
 * to four thresholds. 2024 drops the multiplier entirely and compares the raw
 * total to a three-band budget — deliberately simpler, and the reason the two
 * editions can disagree sharply on the same set of monsters.
 */
export function rateEncounter(
  party: PartyMemberLevel[],
  creatures: { xp?: number; cr?: string | number; count?: number }[],
  edition: Edition,
): EncounterRating {
  const rawXp = creatures.reduce(
    (sum, c) => sum + creatureXp(c) * Math.max(1, c.count ?? 1),
    0,
  );
  const monsterCount = creatures.reduce((n, c) => n + Math.max(1, c.count ?? 1), 0);
  const partySize = party.length;

  if (edition === '2024') {
    const totals = party.reduce(
      (acc, p) => {
        const [low, mod, high] = BUDGET_2024[clampLevel(p.level)];
        return [acc[0] + low, acc[1] + mod, acc[2] + high] as [number, number, number];
      },
      [0, 0, 0] as [number, number, number],
    );
    const [low, mod, high] = totals;
    const difficulty: Difficulty2024 =
      rawXp >= high ? 'high' : rawXp >= mod ? 'moderate' : rawXp >= low ? 'low' : 'trivial';
    return {
      edition,
      rawXp,
      adjustedXp: rawXp,
      multiplier: 1,
      difficulty,
      bands: [
        { label: 'Low', xp: low },
        { label: 'Moderate', xp: mod },
        { label: 'High', xp: high },
      ],
      xpAward: rawXp,
      xpPerCharacter: partySize ? Math.floor(rawXp / partySize) : rawXp,
    };
  }

  const totals = party.reduce(
    (acc, p) => {
      const [e, m, h, d] = THRESHOLDS_2014[clampLevel(p.level)];
      return [acc[0] + e, acc[1] + m, acc[2] + h, acc[3] + d] as [number, number, number, number];
    },
    [0, 0, 0, 0] as [number, number, number, number],
  );
  const [easy, medium, hard, deadly] = totals;
  const multiplier = multiplier2014(monsterCount, partySize);
  const adjustedXp = Math.round(rawXp * multiplier);
  const difficulty: Difficulty2014 =
    adjustedXp >= deadly ? 'deadly'
    : adjustedXp >= hard ? 'hard'
    : adjustedXp >= medium ? 'medium'
    : adjustedXp >= easy ? 'easy'
    : 'trivial';

  return {
    edition,
    rawXp,
    adjustedXp,
    multiplier,
    difficulty,
    bands: [
      { label: 'Easy', xp: easy },
      { label: 'Medium', xp: medium },
      { label: 'Hard', xp: hard },
      { label: 'Deadly', xp: deadly },
    ],
    xpAward: rawXp,
    xpPerCharacter: partySize ? Math.floor(rawXp / partySize) : rawXp,
  };
}

/** Target XP for a difficulty band, used to drive suggestions. */
export function targetXpFor(
  party: PartyMemberLevel[],
  edition: Edition,
  band: string,
): number {
  const rating = rateEncounter(party, [], edition);
  const hit = rating.bands.find((b) => b.label.toLowerCase() === band.toLowerCase());
  return hit?.xp ?? rating.bands[0]?.xp ?? 0;
}

export type Suggestable = { id: string; name: string; xp: number; cr: string };

/** Above this, a fight stops being an encounter and starts being a chore to
 *  run at the table, however neatly the XP lines up. */
const MAX_SUGGESTED_COUNT = 8;
/**
 * Suggestions are bucketed by encounter *shape* — one big monster, a pair, a
 * small group, a swarm — and filled round-robin. Ranking purely on how close
 * the XP lands returns five variations of the same shape (four CR½ beasts,
 * differing only in name), which gives a GM nothing to actually choose between.
 */
const SHAPE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: 'solo', min: 1, max: 1 },
  { label: 'pair', min: 2, max: 3 },
  { label: 'group', min: 4, max: 6 },
  { label: 'swarm', min: 7, max: 8 },
];

export type Suggestion = {
  creature: Suggestable;
  count: number;
  adjustedXp: number;
  delta: number;
};

/**
 * Suggest creature groups that land near a target XP budget.
 *
 * Works backwards from the budget: for each candidate, find the count whose
 * *adjusted* XP sits closest to target. Using adjusted XP matters under 2014 —
 * six weak creatures are a far harder fight than their raw XP suggests, and
 * suggesting on raw totals would routinely overshoot.
 *
 * Ranking is deliberately not "closest XP wins". Any weak creature can hit a
 * budget exactly by piling on bodies, so a pure-delta sort returns a dozen
 * identical 12×-mook rows in alphabetical order. Instead we score relative
 * error plus a penalty per extra creature, and limit how many suggestions may
 * share a CR, which yields a spread like "1× ogre / 3× goblin" that's actually
 * choosable.
 */
export function suggestEncounters(
  pool: Suggestable[],
  party: PartyMemberLevel[],
  edition: Edition,
  targetXp: number,
  limit = 8,
): Suggestion[] {
  if (targetXp <= 0 || pool.length === 0) return [];
  const partySize = party.length;

  const best = pool.flatMap((creature) => {
    if (creature.xp <= 0) return [];
    let pick: Suggestion | null = null;
    for (let count = 1; count <= MAX_SUGGESTED_COUNT; count++) {
      const mult = edition === '2014' ? multiplier2014(count, partySize) : 1;
      const adjustedXp = Math.round(creature.xp * count * mult);
      const delta = Math.abs(adjustedXp - targetXp);
      if (!pick || delta < pick.delta) pick = { creature, count, adjustedXp, delta };
      if (adjustedXp > targetXp * 2) break; // past useful range
    }
    return pick ? [pick] : [];
  });

  // Relative error, plus ~3% of the budget per extra creature. A single
  // well-matched creature beats eight that land marginally closer.
  const score = (s: Suggestion) => s.delta / targetXp + (s.count - 1) * 0.03;

  const viable = best
    .filter((s) => s.delta <= targetXp * 0.5)
    .sort((a, b) => score(a) - score(b) || a.count - b.count);

  // Fill buckets round-robin so the list reads solo / pair / group / swarm
  // rather than four flavours of the same fight.
  const buckets = SHAPE_BUCKETS.map((b) =>
    viable.filter((s) => s.count >= b.min && s.count <= b.max),
  );
  const out: Suggestion[] = [];
  for (let round = 0; out.length < limit; round++) {
    let addedThisRound = false;
    for (const bucket of buckets) {
      const pick = bucket[round];
      if (!pick) continue;
      out.push(pick);
      addedThisRound = true;
      if (out.length >= limit) break;
    }
    if (!addedThisRound) break; // every bucket exhausted
  }
  return out;
}
