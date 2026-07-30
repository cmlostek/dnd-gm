import { useEffect, useMemo, useState } from 'react';
import { X as XIcon, Dices, Sparkles, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CLASSES_2024, FEATS_2024, SPELLS_2024 } from '../../data/srd';
import type { Class, ClassLevelRow, ClassSubclass, Feat } from '../../data/types';
import { SpellPopoverTrigger, FeatBody } from '../../components/SrdPopover';
import {
  type CharacterFeature,
  type KnownSpell,
  type PartyMember,
  type SpellSlots,
} from '../party/partyStore';
import {
  type HpRollingMethod,
  useCampaignSettings,
} from '../notes/campaignSettingsStore';
import { useQuickDice } from '../dice/quickDiceStore';

type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
const ABILITIES: { key: AbilityKey; label: string; full: string }[] = [
  { key: 'str', label: 'STR', full: 'Strength' },
  { key: 'dex', label: 'DEX', full: 'Dexterity' },
  { key: 'con', label: 'CON', full: 'Constitution' },
  { key: 'int', label: 'INT', full: 'Intelligence' },
  { key: 'wis', label: 'WIS', full: 'Wisdom' },
  { key: 'cha', label: 'CHA', full: 'Charisma' },
];

/** ASI choice mode: increase abilities, or take a feat instead. */
type AsiMode = 'asi' | 'feat';
type AsiPlan = {
  mode: AsiMode;
  /** Ability bumps (+1 or +2 on entries). Keys sum to 2 with values in {1, 2}. */
  bumps: Partial<Record<AbilityKey, number>>;
  featIndex?: string;
  /** Which ability the picked feat's embedded ASI targets (if any). */
  featAsiAbility?: AbilityKey;
};

/** Parse a feat description for an embedded Ability Score Increase. Returns
 *  the +N amount and the eligible abilities (a 6-key list when "your choice").
 *  null when the feat doesn't grant an ASI. */
export function parseFeatAsi(desc: string): { amount: number; choices: AbilityKey[] } | null {
  // "Increase one ability score of your choice by N"
  const anyM = desc.match(/Increase one ability score of your choice by (\d+)/i);
  if (anyM) {
    return { amount: parseInt(anyM[1], 10), choices: ABILITIES.map((a) => a.key) };
  }
  // "Increase your X[, Y][, or Z] score by N" — also catches "Strength or Dexterity"
  const m = desc.match(/Increase your ([\w, ]+?)(?:\s+score)?\s+by\s+(\d+)/i);
  if (m) {
    // Comma splits leave "or Charisma" intact when the source uses ", or ".
    // Strip a leading "or " after the split so the lookup matches.
    const list = m[1]
      .split(/,\s*|\s+or\s+/i)
      .map((s) => s.trim().toLowerCase().replace(/^or\s+/, ''))
      .filter(Boolean);
    const choices: AbilityKey[] = [];
    for (const a of list) {
      const k = ABILITIES.find((x) => x.full.toLowerCase() === a)?.key;
      if (k) choices.push(k);
    }
    if (choices.length > 0) return { amount: parseInt(m[2], 10), choices };
  }
  return null;
}

/** Returns true if a General feat is available to this character given their
 *  current level and ability scores. We only enforce the easy-to-check
 *  prerequisites (character level, ability score min); class-level prereqs
 *  are too rare in the SRD to be worth a full parser. */
function featAvailable(feat: Feat, level: number, scores: Record<AbilityKey, number>): boolean {
  if (!feat.prerequisite) return true;
  const lvMatch = feat.prerequisite.match(/Level\s+(\d+)\+/i);
  if (lvMatch && level < parseInt(lvMatch[1], 10)) return false;
  // Ability score min — pattern like "Strength or Dexterity 13+"
  const abM = feat.prerequisite.match(/([A-Za-z]+(?:\s+or\s+[A-Za-z]+)?)\s+(\d+)\+?/);
  if (abM) {
    const req = parseInt(abM[2], 10);
    const abilities = abM[1].split(/\s+or\s+/i);
    const ok = abilities.some((a) => {
      const key = ABILITIES.find((x) => x.full.toLowerCase() === a.trim().toLowerCase())?.key;
      return key ? scores[key] >= req : false;
    });
    if (!ok) return false;
  }
  return true;
}

const abilityMod = (score: number) => Math.floor((score - 10) / 2);

/** Parse the numeric value from a class-table cell ("4", "+2", "—", ""). */
function num(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Extract the per-level spell-slot vector (length 10, index 0 unused) from a
 *  class-table row's columns. Returns null when the row has no slot columns.
 *  Handles full-caster ("Spell Slots per Spell Level N") and Warlock-style
 *  ("Spell Slots" count + "Slot Level") shapes. */
function slotsFromRow(cols: Record<string, string>): number[] | null {
  let touched = false;
  const out = Array.from({ length: 10 }, () => 0);
  for (let i = 1; i <= 9; i += 1) {
    const v = num(cols[`Spell Slots per Spell Level ${i}`]);
    if (v !== null) {
      out[i] = v;
      touched = true;
    }
  }
  if (!touched) {
    // Warlock pact magic: all slots are at the listed slot level.
    const count = num(cols['Spell Slots']);
    const lv = num(cols['Slot Level']);
    if (count !== null && lv !== null && lv >= 1 && lv <= 9) {
      out[lv] = count;
      touched = true;
    }
  }
  return touched ? out : null;
}

/** Try to resolve the character's class. Order: explicit classId → first
 *  word of classSummary → null (caller shows a picker). */
function resolveClass(member: PartyMember): Class | null {
  if (member.classId) {
    return CLASSES_2024.find((c) => c.index === member.classId) ?? null;
  }
  const word = (member.classSummary ?? '').trim().split(/\s+/)[0]?.toLowerCase();
  if (!word) return null;
  return CLASSES_2024.find((c) => c.index === word || c.name.toLowerCase() === word) ?? null;
}

/** Subclass-choice level for a class — the level where the level table says
 *  "<Class> Subclass". Returns null if we can't find it. */
function subclassLevel(cls: Class): number | null {
  for (const row of cls.levelTable) {
    if (row.features.some((f) => /Subclass$/i.test(f))) return row.level;
  }
  return null;
}

export type LevelUpResult = {
  level: number;
  maxHp: number;
  hp: number;
  spellSlots?: SpellSlots;
  features: CharacterFeature[];
  classId?: string;
  subclassId?: string;
  /** Ability-score deltas to apply (e.g. { str: 1, con: 1 } or { wis: 2 }). */
  abilityBumps?: Partial<Record<AbilityKey, number>>;
  /** Newly-learned spells to append to the character's spell list. */
  spellsAdded?: KnownSpell[];
};

/** Highest spell-slot level available given a class level row. Returns 0 for
 *  non-casters. Handles two SRD column shapes:
 *    - Full casters: nine "Spell Slots per Spell Level N" columns; max level
 *      is the highest N with a non-zero count.
 *    - Warlock (Pact Magic): a single "Spell Slots" count column plus a
 *      separate "Slot Level" column that already names the max level.
 */
function maxSpellLevel(row: ClassLevelRow): number {
  for (let i = 9; i >= 1; i -= 1) {
    const v = parseInt(row.classColumns[`Spell Slots per Spell Level ${i}`] ?? '0', 10);
    if (v > 0) return i;
  }
  const pactSlotLevel = parseInt(row.classColumns['Slot Level'] ?? '0', 10);
  if (pactSlotLevel > 0) return pactSlotLevel;
  return 0;
}

/** Numeric value of a class-table column, defaulting to 0 when missing. */
function colNum(row: ClassLevelRow | null | undefined, col: string): number {
  if (!row) return 0;
  const v = row.classColumns[col];
  if (!v) return 0;
  const m = v.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export default function LevelUpModal({
  member,
  onConfirm,
  onClose,
}: {
  member: PartyMember;
  onConfirm: (patch: LevelUpResult) => void;
  onClose: () => void;
}) {
  const campaignHpMethod = useCampaignSettings((s) => s.settings.hpRollingMethod);
  const rollFormula = useQuickDice((s) => s.rollFormula);

  // Step 0: class resolution (skip if already resolved).
  const initialClass = useMemo(() => resolveClass(member), [member]);
  const [pickedClassId, setPickedClassId] = useState<string | null>(initialClass?.index ?? null);
  const cls = pickedClassId ? CLASSES_2024.find((c) => c.index === pickedClassId) ?? null : null;

  const newLevel = member.level + 1;
  // The level table is indexed by level → row.level (1..20). Find by value, not by array index,
  // in case the parser ever skipped a row.
  const newRow = useMemo(
    () => (cls ? cls.levelTable.find((r) => r.level === newLevel) ?? null : null),
    [cls, newLevel],
  );
  const prevRow = useMemo(
    () => (cls ? cls.levelTable.find((r) => r.level === member.level) ?? null : null),
    [cls, member.level],
  );

  // ── HP gain ────────────────────────────────────────────────────────────
  const [hpMethod, setHpMethod] = useState<HpRollingMethod>(campaignHpMethod);
  const conMod = abilityMod(member.con);
  const avgGain = cls ? Math.max(1, Math.floor(cls.hitDie / 2) + 1 + conMod) : 0;
  const [rolledHp, setRolledHp] = useState<number | null>(null);
  const [manualHp, setManualHp] = useState<number>(Math.max(1, conMod + 1));

  const rolledGain = rolledHp !== null ? Math.max(1, rolledHp + conMod) : null;
  const hpGain =
    hpMethod === 'avg'
      ? avgGain
      : hpMethod === 'roll'
        ? rolledGain
        : Math.max(0, manualHp);

  const newMaxHp = member.maxHp + (hpGain ?? 0);

  const rollHitDie = () => {
    if (!cls) return;
    const die = cls.hitDie;
    // Roll inline; also fire through QuickDice for the history panel.
    const v = Math.floor(Math.random() * die) + 1;
    setRolledHp(v);
    rollFormula(`1d${die}`, `${cls.name} L${newLevel} HP roll`);
  };

  // ── Spell slots ────────────────────────────────────────────────────────
  const newSlots = useMemo(() => (newRow ? slotsFromRow(newRow.classColumns) : null), [newRow]);
  const prevSlots = useMemo(
    () => (prevRow ? slotsFromRow(prevRow.classColumns) : null),
    [prevRow],
  );
  const slotDiffs = useMemo(() => {
    if (!newSlots) return [];
    const diffs: { level: number; from: number; to: number }[] = [];
    for (let i = 1; i <= 9; i += 1) {
      const from = prevSlots?.[i] ?? 0;
      const to = newSlots[i] ?? 0;
      if (from !== to) diffs.push({ level: i, from, to });
    }
    return diffs;
  }, [newSlots, prevSlots]);

  // ── Features ───────────────────────────────────────────────────────────
  const newFeatureNames = useMemo(() => {
    if (!newRow) return [];
    // Filter "<Class> Subclass" because we surface it through the subclass
    // picker instead. ASI / Epic Boon also get their own dedicated UI below.
    return newRow.features.filter(
      (f) => !/Subclass$/i.test(f) && !/Ability Score Improvement/i.test(f) && !/Epic Boon/i.test(f),
    );
  }, [newRow]);

  // ── ASI / Epic Boon picker ─────────────────────────────────────────────
  const hasAsi = !!newRow?.features.some((f) => /Ability Score Improvement/i.test(f));
  const hasEpicBoon = !!newRow?.features.some((f) => /Epic Boon/i.test(f));
  const [asiPlan, setAsiPlan] = useState<AsiPlan>({ mode: 'asi', bumps: {} });

  // Pre-screen General + Epic Boon feats for the picker.
  const currentScores: Record<AbilityKey, number> = {
    str: member.str, dex: member.dex, con: member.con,
    int: member.int, wis: member.wis, cha: member.cha,
  };
  const generalFeats = useMemo(
    () => FEATS_2024.filter((f) => f.category === 'General' && featAvailable(f, newLevel, currentScores)),
    [newLevel, currentScores],
  );
  const epicBoonFeats = useMemo(() => FEATS_2024.filter((f) => f.category === 'Epic Boon'), []);
  const featPool: Feat[] = hasEpicBoon ? epicBoonFeats : generalFeats;

  // ── Subclass picker ────────────────────────────────────────────────────
  const isSubclassLevel = cls && subclassLevel(cls) === newLevel && !member.subclassId;
  const [pickedSubclassId, setPickedSubclassId] = useState<string | null>(null);

  // ── Spell learning ─────────────────────────────────────────────────────
  // Detect cantrip / prepared-spell count changes between the previous and
  // new level table rows. Wizards additionally gain +2 spellbook spells
  // every level (not visible in the class table — handled out-of-band).
  const cantripDeltaRaw = Math.max(0, colNum(newRow, 'Cantrips') - colNum(prevRow, 'Cantrips'));
  const preparedDeltaRaw = Math.max(0, colNum(newRow, 'Prepared Spells') - colNum(prevRow, 'Prepared Spells'));
  const wizardSpellbookDeltaRaw = cls?.index === 'wizard' ? 2 : 0;
  const maxLv = newRow ? maxSpellLevel(newRow) : 0;

  // Spell pools — filtered by max castable level + de-duped against what the
  // character already knows so the picker doesn't offer duplicates.
  const knownIndexes = useMemo(
    () => new Set((member.spells ?? []).filter((sp) => sp.sourceKind === 'srd-spell' && sp.sourceId).map((sp) => sp.sourceId as string)),
    [member.spells],
  );
  const spellPool = useMemo(() => {
    if (!cls?.spellList) return { cantrips: [] as string[], leveled: [] as string[] };
    const cantripSrcs = cls.spellList.find((b) => b.level === 0)?.spells ?? [];
    const leveledSrcs: string[] = [];
    for (const bucket of cls.spellList) {
      if (bucket.level === 0) continue;
      if (bucket.level > maxLv) continue;
      for (const sid of bucket.spells) leveledSrcs.push(sid);
    }
    return {
      cantrips: cantripSrcs.filter((sid) => !knownIndexes.has(sid)),
      leveled: leveledSrcs.filter((sid) => !knownIndexes.has(sid)),
    };
  }, [cls, maxLv, knownIndexes]);

  // Cap each picker to whatever's actually pickable — if the pool is empty
  // (e.g. you already know every level-1 spell on the list), the picker shows
  // the empty-state message and validation auto-passes instead of trapping the
  // player on a button they can never press.
  const cantripDelta = Math.min(cantripDeltaRaw, spellPool.cantrips.length);
  const preparedDelta = Math.min(preparedDeltaRaw, spellPool.leveled.length);
  const wizardSpellbookDelta = Math.min(wizardSpellbookDeltaRaw, spellPool.leveled.length);
  const totalSpellPicks = cantripDelta + preparedDelta + wizardSpellbookDelta;

  const [pickedCantrips, setPickedCantrips] = useState<string[]>([]);
  const [pickedPrepared, setPickedPrepared] = useState<string[]>([]);
  const [pickedSpellbook, setPickedSpellbook] = useState<string[]>([]);
  const togglePick = (list: string[], setList: (v: string[]) => void, max: number, id: string) => {
    if (list.includes(id)) setList(list.filter((x) => x !== id));
    else if (list.length < max) setList([...list, id]);
  };

  // ── Reset rolled HP when method changes ────────────────────────────────
  useEffect(() => {
    if (hpMethod !== 'roll') setRolledHp(null);
  }, [hpMethod]);

  // ASI plan validity: ASI must distribute exactly 2 points (1+1 or +2), and
  // no resulting score may exceed 20. Feat mode requires a pick — plus, if
  // the chosen feat grants an embedded ASI, the user must also pick which
  // ability gets the bump.
  const asiValid = (() => {
    if (!hasAsi && !hasEpicBoon) return true;
    if (asiPlan.mode === 'feat') {
      if (!asiPlan.featIndex) return false;
      const feat = FEATS_2024.find((f) => f.index === asiPlan.featIndex);
      const asi = feat ? parseFeatAsi(feat.desc) : null;
      if (asi) {
        if (!asiPlan.featAsiAbility) return false;
        if (!asi.choices.includes(asiPlan.featAsiAbility)) return false;
        if (currentScores[asiPlan.featAsiAbility] + asi.amount > 20) return false;
      }
      return true;
    }
    // ASI mode
    const sum = Object.values(asiPlan.bumps).reduce<number>((a, b) => a + (b ?? 0), 0);
    if (sum !== 2) return false;
    for (const [k, v] of Object.entries(asiPlan.bumps) as [AbilityKey, number][]) {
      const key = k as AbilityKey;
      if (v !== 1 && v !== 2) return false;
      if (currentScores[key] + v > 20) return false;
    }
    return true;
  })();

  const spellsValid =
    pickedCantrips.length === cantripDelta &&
    pickedPrepared.length === preparedDelta &&
    pickedSpellbook.length === wizardSpellbookDelta;

  const canConfirm =
    !!cls &&
    hpGain !== null &&
    hpGain >= 0 &&
    (!isSubclassLevel || !!pickedSubclassId) &&
    asiValid &&
    spellsValid;

  const handleConfirm = () => {
    if (!canConfirm || !cls) return;
    // Build the patch.
    const features: CharacterFeature[] = newFeatureNames.map((name) => ({
      id: crypto.randomUUID(),
      name,
      source: 'Class',
      desc: cls.features[name] ?? undefined,
    }));
    if (isSubclassLevel && pickedSubclassId) {
      const sc = cls.subclasses.find((s) => s.index === pickedSubclassId);
      if (sc) {
        for (const f of sc.features.filter((sf) => sf.level === newLevel)) {
          features.push({
            id: crypto.randomUUID(),
            name: `${sc.name}: ${f.name}`,
            source: 'Class',
            desc: f.desc,
          });
        }
      }
    }
    const spellSlots: SpellSlots | undefined = newSlots
      ? newSlots.map((max, i) => ({
          max,
          // Restore to full when slot count increases; otherwise preserve the
          // current count (clamped). Players just leveled up so this matches
          // the typical "you also gained a Long Rest as part of leveling" tone.
          current: Math.min(max, (member.spellSlots?.[i]?.current ?? 0) + Math.max(0, max - (member.spellSlots?.[i]?.max ?? 0))),
        }))
      : undefined;
    // ASI / Epic Boon outcome.
    let abilityBumps: Partial<Record<AbilityKey, number>> | undefined;
    if (hasAsi || hasEpicBoon) {
      if (asiPlan.mode === 'asi') {
        abilityBumps = asiPlan.bumps;
        // Surface as a feature row so the player has a record of what they
        // picked at this level — useful when scrolling history.
        const label = Object.entries(asiPlan.bumps)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([k, v]) => `+${v} ${ABILITIES.find((a) => a.key === k)?.label}`)
          .join(', ');
        features.push({
          id: crypto.randomUUID(),
          name: hasEpicBoon ? `Epic Boon: Ability Improvement (${label})` : `Ability Score Improvement (${label})`,
          source: 'Class',
          desc: `Gained at ${cls.name} level ${newLevel}.`,
        });
      } else if (asiPlan.mode === 'feat' && asiPlan.featIndex) {
        const feat = FEATS_2024.find((f) => f.index === asiPlan.featIndex);
        if (feat) {
          features.push({
            id: crypto.randomUUID(),
            name: feat.name,
            source: 'Feat',
            desc: feat.desc,
          });
          // Apply the feat's embedded ASI if it grants one.
          const asi = parseFeatAsi(feat.desc);
          if (asi && asiPlan.featAsiAbility) {
            abilityBumps = {
              ...(abilityBumps ?? {}),
              [asiPlan.featAsiAbility]: (abilityBumps?.[asiPlan.featAsiAbility] ?? 0) + asi.amount,
            };
          }
        }
      }
    }

    // Compose the newly-learned spell list. Cantrips + prepared spells land
    // as prepared:true (immediately castable). Wizard spellbook adds land as
    // prepared:false (in the book, not on today's list).
    const spellsAdded: KnownSpell[] = [];
    const pushSpell = (sid: string, prepared: boolean) => {
      const srd = SPELLS_2024.find((sp) => sp.index === sid);
      if (!srd) return;
      spellsAdded.push({
        id: crypto.randomUUID(),
        sourceKind: 'srd-spell',
        sourceId: sid,
        name: srd.name,
        prepared,
      });
    };
    for (const sid of pickedCantrips) pushSpell(sid, true);
    for (const sid of pickedPrepared) pushSpell(sid, true);
    for (const sid of pickedSpellbook) pushSpell(sid, false);

    onConfirm({
      level: newLevel,
      maxHp: newMaxHp,
      hp: member.hp + (hpGain ?? 0),
      spellSlots,
      features,
      ...(initialClass ? {} : { classId: cls.index }),
      ...(isSubclassLevel && pickedSubclassId ? { subclassId: pickedSubclassId } : {}),
      ...(abilityBumps && Object.keys(abilityBumps).length > 0 ? { abilityBumps } : {}),
      ...(spellsAdded.length > 0 ? { spellsAdded } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex sm:items-start sm:justify-center sm:overflow-y-auto sm:py-12 sm:px-4">
      <div className="w-full max-w-2xl bg-slate-900 sm:border border-slate-800 sm:rounded-lg shadow-2xl flex flex-col h-full sm:h-auto sm:max-h-[calc(100vh-6rem)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-amber-200">
            <ChevronUp size={18} />
            <h2 className="font-serif text-xl">
              Level up to {newLevel}
              {cls && <span className="text-slate-400 text-sm font-sans ml-2">· {cls.name}</span>}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1">
            <XIcon size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-6 flex-1 overflow-y-auto">
          {/* Class picker if we couldn't resolve from classId/classSummary */}
          {!cls && (
            <Section title="Class">
              <p className="text-sm text-slate-400 mb-2">
                We couldn't tell which class you're playing from your sheet. Pick one to continue.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {CLASSES_2024.map((c) => (
                  <button
                    key={c.index}
                    onClick={() => setPickedClassId(c.index)}
                    className={`px-3 py-2 text-sm border rounded ${
                      pickedClassId === c.index
                        ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                        : 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-200'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {cls && (
            <>
              {/* HP gain */}
              <Section title="Hit points">
                <div className="flex gap-1 mb-3">
                  {(['avg', 'roll', 'manual'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setHpMethod(m)}
                      className={`flex-1 px-2 py-1 text-xs rounded ${
                        hpMethod === m
                          ? 'bg-sky-900/40 text-sky-200 border border-sky-700'
                          : 'bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {m === 'avg' ? 'Average' : m === 'roll' ? 'Roll' : 'Manual'}
                      {campaignHpMethod === m && <span className="ml-1 text-[9px] opacity-60">·default</span>}
                    </button>
                  ))}
                </div>

                {hpMethod === 'avg' && (
                  <div className="text-sm text-slate-300">
                    Take the average for a d{cls.hitDie}: <span className="font-mono">{Math.floor(cls.hitDie / 2) + 1}</span>{' '}
                    + Con mod (<span className="font-mono">{conMod >= 0 ? '+' : ''}{conMod}</span>) ={' '}
                    <span className="font-mono text-emerald-300">+{avgGain}</span> HP
                  </div>
                )}

                {hpMethod === 'roll' && (
                  <div className="flex items-center gap-3 text-sm flex-wrap">
                    <button
                      onClick={rollHitDie}
                      className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs flex items-center gap-1"
                    >
                      <Dices size={13} /> Roll 1d{cls.hitDie}
                    </button>
                    {/* Manual entry — for tables that roll physical dice and just
                        want to record the result. */}
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      or enter roll
                      <input
                        type="number"
                        min={1}
                        max={cls.hitDie}
                        value={rolledHp ?? ''}
                        onChange={(e) =>
                          setRolledHp(
                            e.target.value === ''
                              ? null
                              : Math.max(1, Math.min(cls.hitDie, parseInt(e.target.value, 10) || 1)),
                          )
                        }
                        placeholder={`1–${cls.hitDie}`}
                        className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-center text-slate-100 font-mono focus:outline-none focus:border-sky-700"
                      />
                    </label>
                    {rolledHp !== null && (
                      <div className="text-slate-300">
                        Rolled <span className="font-mono text-slate-100">{rolledHp}</span> + Con mod{' '}
                        <span className="font-mono">({conMod >= 0 ? '+' : ''}{conMod})</span> ={' '}
                        <span className="font-mono text-emerald-300">+{rolledGain}</span> HP
                      </div>
                    )}
                    {rolledHp === null && (
                      <div className="text-slate-500 text-xs italic">Click to roll your hit die.</div>
                    )}
                  </div>
                )}

                {hpMethod === 'manual' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400">HP to add:</span>
                    <input
                      type="number"
                      value={manualHp}
                      onChange={(e) => setManualHp(Math.max(0, parseInt(e.target.value || '0', 10)))}
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-center text-slate-100 font-mono focus:outline-none focus:border-sky-700"
                    />
                  </label>
                )}

                {hpGain !== null && (
                  <div className="mt-3 pt-3 border-t border-slate-800 text-sm flex items-baseline gap-2">
                    <span className="text-slate-500 text-xs uppercase tracking-wider">Max HP:</span>
                    <span className="font-mono text-slate-100">{member.maxHp}</span>
                    <span className="text-slate-600">→</span>
                    <span className="font-mono text-emerald-300">{newMaxHp}</span>
                  </div>
                )}
              </Section>

              {/* Features */}
              {newFeatureNames.length > 0 && (
                <Section title="New features">
                  <div className="space-y-3">
                    {newFeatureNames.map((name) => (
                      <div key={name} className="bg-slate-950 border border-slate-800 rounded p-3">
                        <div className="font-medium text-sky-200 mb-1">{name}</div>
                        {cls.features[name] && (
                          <div className="text-xs text-slate-300 leading-relaxed markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cls.features[name]}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Subclass picker */}
              {isSubclassLevel && (
                <Section title={`Choose your ${cls.name} subclass`}>
                  <div className="space-y-2">
                    {cls.subclasses.map((sc) => (
                      <SubclassChoice
                        key={sc.index}
                        sc={sc}
                        selected={pickedSubclassId === sc.index}
                        atLevel={newLevel}
                        onSelect={() => setPickedSubclassId(sc.index)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Spell slot diff */}
              {slotDiffs.length > 0 && (
                <Section title="Spell slots">
                  <div className="space-y-1.5">
                    {slotDiffs.map((d) => (
                      <div key={d.level} className="flex items-center gap-3 text-sm">
                        <Sparkles size={12} className="text-violet-300" />
                        <span className="font-mono text-slate-300 w-12">Lv {d.level}:</span>
                        <span className="font-mono text-slate-400">{d.from}</span>
                        <span className="text-slate-600">→</span>
                        <span className="font-mono text-emerald-300">{d.to}</span>
                        {d.to > d.from && (
                          <span className="text-[10px] text-emerald-400">+{d.to - d.from}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Spell learning: cantrips, prepared, plus Wizard spellbook */}
              {totalSpellPicks > 0 && (
                <Section title="Learn new spells">
                  <div className="text-xs text-slate-400 mb-3 leading-relaxed">
                    Your {cls.name} gains more castable magic at this level. Pick the new spells now — they go straight onto your sheet.
                  </div>
                  {cantripDelta > 0 && (
                    <SpellLearnBucket
                      title={`New cantrips (${pickedCantrips.length}/${cantripDelta})`}
                      pool={spellPool.cantrips}
                      chosen={pickedCantrips}
                      onToggle={(id) => togglePick(pickedCantrips, setPickedCantrips, cantripDelta, id)}
                    />
                  )}
                  {preparedDelta > 0 && (
                    <SpellLearnBucket
                      title={`New prepared spells (${pickedPrepared.length}/${preparedDelta}) · up to Lv ${maxLv}`}
                      pool={spellPool.leveled}
                      chosen={pickedPrepared}
                      onToggle={(id) => togglePick(pickedPrepared, setPickedPrepared, preparedDelta, id)}
                    />
                  )}
                  {wizardSpellbookDelta > 0 && (
                    <SpellLearnBucket
                      title={`Add to spellbook (${pickedSpellbook.length}/${wizardSpellbookDelta}) · up to Lv ${maxLv}`}
                      hint="Wizards add two spells to their spellbook each level. These are known but not auto-prepared — toggle them via the spellbook on your sheet."
                      pool={spellPool.leveled.filter((sid) => !pickedPrepared.includes(sid))}
                      chosen={pickedSpellbook}
                      onToggle={(id) => togglePick(pickedSpellbook, setPickedSpellbook, wizardSpellbookDelta, id)}
                    />
                  )}
                </Section>
              )}

              {/* ASI / Epic Boon picker */}
              {(hasAsi || hasEpicBoon) && (
                <Section title={hasEpicBoon ? 'Epic Boon' : 'Ability Score Improvement'}>
                  <AsiPicker
                    isEpicBoon={hasEpicBoon}
                    plan={asiPlan}
                    onPlan={setAsiPlan}
                    scores={currentScores}
                    feats={featPool}
                  />
                </Section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-800">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-300 hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-1.5 text-sm rounded bg-amber-700 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-medium"
            title={
              !cls
                ? 'Pick your class to continue'
                : isSubclassLevel && !pickedSubclassId
                  ? 'Pick your subclass to continue'
                  : 'Apply this level-up'
            }
          >
            Confirm level {newLevel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[11px] uppercase tracking-wider text-amber-200/70 mb-2">{title}</div>
      <div>{children}</div>
    </section>
  );
}

function AsiPicker({
  isEpicBoon,
  plan,
  onPlan,
  scores,
  feats,
}: {
  isEpicBoon: boolean;
  plan: AsiPlan;
  onPlan: (next: AsiPlan) => void;
  scores: Record<AbilityKey, number>;
  feats: Feat[];
}) {
  const bumpSum = Object.values(plan.bumps).reduce<number>((a, b) => a + (b ?? 0), 0);
  const set = (k: AbilityKey, v: number) => {
    const next = { ...plan.bumps };
    if (v <= 0) delete next[k];
    else next[k] = v;
    onPlan({ ...plan, bumps: next });
  };
  return (
    <div>
      <div className="text-xs text-slate-400 mb-3 leading-relaxed">
        {isEpicBoon ? (
          <>
            At level 19, your class grants an <strong>Epic Boon</strong> — either an Epic Boon feat from
            the SRD list, or use the slot to raise two ability scores (each by +1, or one by +2).
            Scores can't exceed 20 this way.
          </>
        ) : (
          <>
            <strong>Ability Score Improvement (ASI):</strong> raise two ability scores by +1, or one score
            by +2 (max 20). You may instead take a General feat — pick whichever fits your build. ASIs
            happen at levels 4, 8, 12, 16, and 19 for most classes; Fighters and Rogues get extra ones.
          </>
        )}
      </div>

      <div className="flex gap-1 mb-3">
        {(['asi', 'feat'] as const).map((m) => (
          <button
            key={m}
            onClick={() => onPlan({ ...plan, mode: m, bumps: m === 'asi' ? plan.bumps : {}, featIndex: m === 'feat' ? plan.featIndex : undefined })}
            className={`flex-1 px-2 py-1 text-xs rounded border ${
              plan.mode === m
                ? 'bg-sky-900/40 text-sky-200 border-sky-700'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
            }`}
          >
            {m === 'asi' ? 'Improve ability scores' : isEpicBoon ? 'Take an Epic Boon feat' : 'Take a feat instead'}
          </button>
        ))}
      </div>

      {plan.mode === 'asi' && (
        <div>
          <div className="text-xs text-slate-400 mb-2">
            Distribute 2 points (1 + 1, or +2). Currently spent:{' '}
            <span className={`font-mono ${bumpSum === 2 ? 'text-emerald-300' : 'text-slate-300'}`}>
              {bumpSum}/2
            </span>
          </div>
          <div className="space-y-1.5">
            {ABILITIES.map((a) => {
              const v = plan.bumps[a.key] ?? 0;
              const cur = scores[a.key];
              const newScore = cur + v;
              const capped = newScore >= 20 && v === 0;
              return (
                <div key={a.key} className="flex items-center gap-2 text-sm bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
                  <div className="w-20 text-slate-300">{a.full}</div>
                  <div className="font-mono text-slate-500 text-xs w-10 text-right">{cur}</div>
                  <span className="text-slate-600">→</span>
                  <div className={`font-mono text-xs w-10 ${v > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>{newScore}</div>
                  <div className="flex gap-1 ml-auto">
                    <button
                      onClick={() => set(a.key, 0)}
                      className={`w-7 h-7 rounded text-[11px] ${v === 0 ? 'bg-sky-700 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                      title="No change"
                    >0</button>
                    <button
                      onClick={() => set(a.key, 1)}
                      disabled={capped || (bumpSum === 2 && v === 0) || cur + 1 > 20}
                      className={`w-7 h-7 rounded text-[11px] ${v === 1 ? 'bg-sky-700 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed'}`}
                      title="+1"
                    >+1</button>
                    <button
                      onClick={() => set(a.key, 2)}
                      disabled={cur + 2 > 20 || (bumpSum >= 1 && v !== 2)}
                      className={`w-7 h-7 rounded text-[11px] ${v === 2 ? 'bg-sky-700 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed'}`}
                      title="+2 (single ability only)"
                    >+2</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {plan.mode === 'feat' && (
        <div>
          <div className="text-xs text-slate-400 mb-2">
            Pick a {isEpicBoon ? 'Epic Boon' : 'General'} feat. Greyed-out feats fail their level / ability prerequisite.
          </div>
          <select
            value={plan.featIndex ?? ''}
            onChange={(e) => onPlan({ ...plan, featIndex: e.target.value || undefined, featAsiAbility: undefined })}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-sky-700 mb-3"
          >
            <option value="">— pick a feat —</option>
            {feats.map((f) => (
              <option key={f.index} value={f.index}>
                {f.name}
                {f.prerequisite ? ` (${f.prerequisite})` : ''}
              </option>
            ))}
          </select>
          {plan.featIndex && (() => {
            const feat = FEATS_2024.find((f) => f.index === plan.featIndex);
            if (!feat) return null;
            const asi = parseFeatAsi(feat.desc);
            return (
              <div className="srd-popover">
                <FeatBody feat={feat} />
                {asi && (
                  <div className="srd-popover-divider" style={{ padding: '0 0.9em 0.8em' }}>
                    <div className="srd-popover-section-label" style={{ color: '#fcd34d' }}>
                      Feat ability bump (+{asi.amount})
                    </div>
                    <div className="text-[11px] text-slate-500 mb-2">
                      This feat raises one ability score. Pick which — applies automatically when you confirm.
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {asi.choices.map((k) => {
                        const cur = scores[k];
                        const newScore = cur + asi.amount;
                        const capped = newScore > 20;
                        const picked = plan.featAsiAbility === k;
                        return (
                          <button
                            key={k}
                            onClick={() => onPlan({ ...plan, featAsiAbility: k })}
                            disabled={capped}
                            className={`px-2 py-1 text-xs rounded border ${
                              picked
                                ? 'border-sky-500 bg-sky-900/40 text-sky-100'
                                : capped
                                  ? 'border-slate-800 bg-slate-950 text-slate-600 cursor-not-allowed'
                                  : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800'
                            }`}
                            title={capped ? 'Already at 20' : `${cur} → ${newScore}`}
                          >
                            {ABILITIES.find((a) => a.key === k)?.label} {cur} → {newScore}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function SpellLearnBucket({
  title,
  hint,
  pool,
  chosen,
  onToggle,
}: {
  title: string;
  hint?: string;
  pool: string[];
  chosen: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      {hint && <div className="text-[11px] text-slate-500 mb-2 leading-snug">{hint}</div>}
      {pool.length === 0 ? (
        <div className="text-xs text-slate-600 italic py-2">
          No new spells available from your class spell list — you may already know them all at this level.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 max-h-[220px] overflow-y-auto">
          {pool.map((id) => {
            const srd = SPELLS_2024.find((sp) => sp.index === id);
            if (!srd) return null;
            const picked = chosen.includes(id);
            return (
              <SpellPopoverTrigger key={id} spell={srd} className="block">
                <button
                  onClick={() => onToggle(id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs border ${
                    picked
                      ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                      : 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Sparkles size={10} className="text-violet-300 shrink-0" />
                    <span className="truncate">{srd.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {srd.level === 0 ? 'Cantrip' : `Lv ${srd.level}`} · {srd.school.name}
                    {srd.ritual ? ' · R' : ''}{srd.concentration ? ' · C' : ''}
                  </div>
                </button>
              </SpellPopoverTrigger>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubclassChoice({
  sc,
  selected,
  atLevel,
  onSelect,
}: {
  sc: ClassSubclass;
  selected: boolean;
  atLevel: number;
  onSelect: () => void;
}) {
  const features = sc.features.filter((f) => f.level === atLevel);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded border ${
        selected
          ? 'border-sky-500 bg-sky-900/30'
          : 'border-slate-800 bg-slate-950 hover:bg-slate-800/60'
      }`}
    >
      <div className={`font-medium ${selected ? 'text-sky-100' : 'text-slate-200'}`}>{sc.name}</div>
      {features.map((f) => (
        <div key={f.name} className="mt-2 text-xs text-slate-400">
          <span className="text-slate-300 font-medium">{f.name}.</span>{' '}
          <span>{f.desc.slice(0, 200)}{f.desc.length > 200 ? '…' : ''}</span>
        </div>
      ))}
    </button>
  );
}
