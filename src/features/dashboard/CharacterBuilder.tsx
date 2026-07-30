import { useMemo, useState } from 'react';
import { X as XIcon, ChevronRight, ChevronLeft, Dices, Sparkles, Shield, Heart } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CLASSES_2024,
  SPECIES_2024,
  BACKGROUNDS_2024,
  SPELLS_2024,
  EQUIPMENT_2024,
} from '../../data/srd';
import { SpellPopoverTrigger } from '../../components/SrdPopover';
import type { Class, Species, Background } from '../../data/types';
import {
  type CharacterDetails,
  type CharacterFeature,
  type Gold,
  type InventoryItem,
  type KnownSpell,
  type PartyMember,
  type SpellSlots,
  DEFAULT_GOLD,
  DEFAULT_DEATH_SAVES,
  DEFAULT_SPELL_SLOTS,
} from '../party/partyStore';

// ── Constants ─────────────────────────────────────────────────────────────

type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
const ABILITIES: { key: AbilityKey; label: string; full: string }[] = [
  { key: 'str', label: 'STR', full: 'Strength' },
  { key: 'dex', label: 'DEX', full: 'Dexterity' },
  { key: 'con', label: 'CON', full: 'Constitution' },
  { key: 'int', label: 'INT', full: 'Intelligence' },
  { key: 'wis', label: 'WIS', full: 'Wisdom' },
  { key: 'cha', label: 'CHA', full: 'Charisma' },
];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// 2024 PHB point-buy cost table (sum must equal 27).
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUDGET = 27;

// Starting spell counts per class — derived from the level-1 row's columns in
// the 2024 SRD. Hardcoded for clarity since each class names them differently.
/** Parse a class skill-choices line like "Choose 2: Animal Handling, Athletics, …, or Survival". */
function parseSkillChoices(s: string): { count: number; options: string[] } | null {
  if (!s) return null;
  const m = s.match(/Choose\s+(\d+)\s*:?\s*(.+?)$/i);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  // Normalise "X, Y, or Z" / "X and Y" into a comma-separated list.
  const rest = m[2].replace(/,?\s+or\s+/gi, ', ').replace(/\s+and\s+/gi, ', ');
  const options = rest.split(/,\s*/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);
  return { count, options };
}

const STARTING_SPELLS: Record<string, { cantrips: number; lv1: number; label: string }> = {
  bard:     { cantrips: 2, lv1: 4, label: 'spells known' },
  cleric:   { cantrips: 3, lv1: 4, label: 'spells prepared' },
  druid:    { cantrips: 2, lv1: 4, label: 'spells prepared' },
  paladin:  { cantrips: 0, lv1: 0, label: '' },
  ranger:   { cantrips: 0, lv1: 0, label: '' },
  sorcerer: { cantrips: 4, lv1: 2, label: 'spells known' },
  warlock:  { cantrips: 2, lv1: 2, label: 'spells known' },
  wizard:   { cantrips: 3, lv1: 6, label: 'spells in spellbook' },
};

const ABILITY_NAME_TO_KEY: Record<string, AbilityKey> = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};

const abilityMod = (score: number) => Math.floor((score - 10) / 2);

function classSpellAbility(classId: string | null): 'int' | 'wis' | 'cha' | null {
  switch (classId) {
    case 'bard':
    case 'paladin':
    case 'sorcerer':
    case 'warlock':
      return 'cha';
    case 'cleric':
    case 'druid':
    case 'ranger':
      return 'wis';
    case 'wizard':
      return 'int';
    default:
      return null;
  }
}

/** Per-class level-1 spell slot count (just the simple cases — full casters
 *  start with 2 lv1 slots, half-casters get none at level 1). */
function startingSlots(classId: string | null): SpellSlots {
  const slots = DEFAULT_SPELL_SLOTS.map((s) => ({ ...s }));
  if (!classId) return slots;
  if (['bard', 'cleric', 'druid', 'sorcerer', 'wizard'].includes(classId)) {
    slots[1] = { max: 2, current: 2 };
  } else if (classId === 'warlock') {
    // Pact magic: 1 slot at level 1.
    slots[1] = { max: 1, current: 1 };
  }
  return slots;
}

/** Best-effort split of "Choose A or B: (A) ... ; or (B) ..." into two strings. */
function splitEquipmentOptions(s: string): { a: string; b: string } | null {
  if (!s) return null;
  const m = s.match(/\(A\)\s*([\s\S]+?);\s*or\s*\(B\)\s*([\s\S]+)/i);
  if (!m) return null;
  return { a: m[1].trim().replace(/[.,;]+$/, ''), b: m[2].trim().replace(/[.,;]+$/, '') };
}

/** Index for matching parsed item names back to a SRD equipment slug.
 *  Built lazily on first call. */
let equipmentByLowerName: Map<string, string> | null = null;
function eqLookup(name: string): { sourceKind: 'srd-item' | 'custom'; sourceId?: string } {
  if (!equipmentByLowerName) {
    equipmentByLowerName = new Map();
    for (const e of EQUIPMENT_2024) {
      equipmentByLowerName.set(e.name.toLowerCase(), e.index);
      // De-pluralize for matches like "Handaxes" → "Handaxe"
      if (e.name.endsWith('s')) {
        equipmentByLowerName.set((e.name.slice(0, -1)).toLowerCase(), e.index);
      }
    }
  }
  const key = name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim();
  const singular = key.endsWith('s') ? key.slice(0, -1) : key;
  const hit = equipmentByLowerName.get(key) ?? equipmentByLowerName.get(singular);
  return hit ? { sourceKind: 'srd-item', sourceId: hit } : { sourceKind: 'custom' };
}

/** Parse one half of the equipment string into individual items + coin.
 *  Splits on commas at depth zero so parenthetical clarifications stay intact.
 *  Recognises leading quantities ("4 Handaxes", "20 Arrows") and trailing
 *  "N GP/SP/CP/PP/EP" entries, which roll up into a Gold object instead of
 *  becoming inventory rows. */
function parseEquipmentList(s: string): { items: { name: string; qty: number }[]; gold: Gold } {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());

  const items: { name: string; qty: number }[] = [];
  const gold: Gold = { ...DEFAULT_GOLD };
  for (let part of parts) {
    part = part.replace(/^and\s+/i, '').trim();
    if (!part) continue;
    const coinM = part.match(/^(\d+)\s*(GP|SP|CP|PP|EP)\b/i);
    if (coinM) {
      const n = parseInt(coinM[1], 10);
      const unit = coinM[2].toLowerCase() as keyof Gold;
      gold[unit] = (gold[unit] ?? 0) + n;
      continue;
    }
    const qtyM = part.match(/^(\d+)\s+(.+)$/);
    if (qtyM) items.push({ qty: parseInt(qtyM[1], 10), name: qtyM[2].trim() });
    else items.push({ qty: 1, name: part });
  }
  return { items, gold };
}

// ── Component ─────────────────────────────────────────────────────────────

type Step = 'species' | 'class' | 'background' | 'abilities' | 'equipment' | 'spells' | 'details' | 'finish';

type State = {
  step: Step;
  speciesId: string | null;
  classId: string | null;
  backgroundId: string | null;
  abilityMethod: 'standard' | 'pointbuy' | 'roll';
  scores: Record<AbilityKey, number>;
  /** Background +2/+1 distribution. Maps ability key → bonus (0, 1, or 2). */
  bgBonuses: Record<AbilityKey, number>;
  /** Skill prof slugs the player picked from the class's skill-choice list. */
  classSkills: string[];
  equipmentChoice: 'A' | 'B';
  chosenCantrips: string[];
  chosenLv1: string[];
  name: string;
  player: string;
  details: CharacterDetails;
};

const INITIAL: State = {
  step: 'species',
  speciesId: null,
  classId: null,
  backgroundId: null,
  abilityMethod: 'standard',
  scores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
  bgBonuses: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  classSkills: [],
  equipmentChoice: 'A',
  chosenCantrips: [],
  chosenLv1: [],
  name: '',
  player: '',
  details: {},
};

export default function CharacterBuilder({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (m: Omit<PartyMember, 'id' | 'owner_user_id'>) => void;
}) {
  const [s, setS] = useState<State>(INITIAL);
  const update = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  const cls = s.classId ? CLASSES_2024.find((c) => c.index === s.classId) ?? null : null;
  const species = s.speciesId ? SPECIES_2024.find((x) => x.index === s.speciesId) ?? null : null;
  const bg = s.backgroundId ? BACKGROUNDS_2024.find((x) => x.index === s.backgroundId) ?? null : null;

  const finalScores = useMemo(() => {
    const out = { ...s.scores };
    for (const k of Object.keys(s.bgBonuses) as AbilityKey[]) out[k] += s.bgBonuses[k];
    return out;
  }, [s.scores, s.bgBonuses]);

  const spellAbility = classSpellAbility(s.classId);
  const spellPool = useMemo(() => {
    if (!cls?.spellList) return { cantrips: [] as string[], lv1: [] as string[] };
    return {
      cantrips: cls.spellList.find((b) => b.level === 0)?.spells ?? [],
      lv1: cls.spellList.find((b) => b.level === 1)?.spells ?? [],
    };
  }, [cls]);

  const startingSpellRules = s.classId ? STARTING_SPELLS[s.classId] ?? { cantrips: 0, lv1: 0, label: '' } : { cantrips: 0, lv1: 0, label: '' };
  const needsSpells = startingSpellRules.cantrips > 0 || startingSpellRules.lv1 > 0;
  // Always include the spells step so non-casters get a clear "your class
  // doesn't get spells" message instead of the step silently disappearing.

  const classSkillRule = useMemo(() => (cls ? parseSkillChoices(cls.skillChoices) : null), [cls]);

  // Reset class-skill picks whenever the class changes so the validation
  // doesn't carry stale slugs from a different class's list.
  // (Hooks rules — keep this in a useEffect-style callback inside update.)

  // ── Validation ──────────────────────────────────────────────────────────
  const stepValid = (step: Step): boolean => {
    switch (step) {
      case 'species': return !!s.speciesId;
      case 'class': {
        if (!s.classId) return false;
        if (classSkillRule && s.classSkills.length !== classSkillRule.count) return false;
        return true;
      }
      case 'background': {
        if (!s.backgroundId || !bg) return false;
        // Bonuses must sum to 3 (+2 +1 or +1 +1 +1).
        const sum = Object.values(s.bgBonuses).reduce((a, b) => a + b, 0);
        return sum === 3;
      }
      case 'abilities': {
        if (s.abilityMethod === 'pointbuy') {
          for (const k of ABILITIES) {
            const v = s.scores[k.key];
            if (v < 8 || v > 15) return false;
          }
          const cost = ABILITIES.reduce((a, k) => a + (POINT_COST[s.scores[k.key]] ?? 0), 0);
          return cost === POINT_BUDGET;
        }
        if (s.abilityMethod === 'standard') {
          // Each value in STANDARD_ARRAY assigned exactly once.
          const assigned = ABILITIES.map((a) => s.scores[a.key]).sort((a, b) => b - a);
          return JSON.stringify(assigned) === JSON.stringify([...STANDARD_ARRAY].sort((a, b) => b - a));
        }
        // roll: just require all values >= 3
        return ABILITIES.every((a) => s.scores[a.key] >= 3);
      }
      case 'equipment': return s.equipmentChoice === 'A' || s.equipmentChoice === 'B';
      case 'spells': {
        if (!needsSpells) return true;
        return s.chosenCantrips.length === startingSpellRules.cantrips &&
               s.chosenLv1.length === startingSpellRules.lv1;
      }
      case 'details': return true; // all fields optional
      case 'finish': return s.name.trim().length > 0;
    }
  };

  const STEPS: Step[] = [
    'species', 'class', 'background', 'abilities', 'equipment', 'spells', 'details', 'finish',
  ];

  const stepIndex = STEPS.indexOf(s.step);
  const goNext = () => {
    if (!stepValid(s.step)) return;
    const next = STEPS[stepIndex + 1];
    if (next) update({ step: next });
  };
  const goPrev = () => {
    const prev = STEPS[stepIndex - 1];
    if (prev) update({ step: prev });
  };

  // ── Finalize ────────────────────────────────────────────────────────────
  const handleCreate = () => {
    if (!cls || !species || !bg) return;
    const hp = cls.hitDie + abilityMod(finalScores.con);

    // Build features from level-1 class features + species traits + background feat.
    const features: CharacterFeature[] = [];
    const lv1Row = cls.levelTable.find((r) => r.level === 1);
    for (const fname of lv1Row?.features ?? []) {
      if (/Ability Score Improvement/i.test(fname) || /Subclass$/i.test(fname)) continue;
      features.push({
        id: crypto.randomUUID(),
        name: fname,
        source: 'Class',
        desc: cls.features[fname],
      });
    }
    for (const t of species.traits) {
      features.push({
        id: crypto.randomUUID(),
        name: t.name,
        source: 'Race',
        desc: t.desc,
      });
    }
    if (bg.feat) {
      features.push({
        id: crypto.randomUUID(),
        name: bg.feat,
        source: 'Background',
        desc: `Granted by ${bg.name} background.`,
      });
    }

    // Inventory + gold: parse the chosen equipment string into individual
    // rows so weapons land as SRD entries (with weapon stats) and trailing
    // "N GP" entries roll into the gold purse.
    const inventory: InventoryItem[] = [];
    const startingGold: Gold = { ...DEFAULT_GOLD };
    const addParsed = (text: string) => {
      if (!text) return;
      const { items, gold } = parseEquipmentList(text);
      for (const it of items) {
        const lookup = eqLookup(it.name);
        inventory.push({
          id: crypto.randomUUID(),
          sourceKind: lookup.sourceKind,
          sourceId: lookup.sourceId,
          name: it.name,
          qty: it.qty,
          equipped: false,
        });
      }
      for (const k of ['pp', 'gp', 'ep', 'sp', 'cp'] as (keyof Gold)[]) {
        startingGold[k] = (startingGold[k] ?? 0) + (gold[k] ?? 0);
      }
    };
    const opts = splitEquipmentOptions(cls.startingEquipment);
    if (opts) addParsed(s.equipmentChoice === 'A' ? opts.a : opts.b);
    else if (cls.startingEquipment) {
      // No A/B split — drop the whole thing in as a custom note we can't parse.
      inventory.push({
        id: crypto.randomUUID(),
        sourceKind: 'custom',
        name: `Starting equipment: ${cls.startingEquipment}`,
        qty: 1,
        equipped: false,
      });
    }
    if (bg.equipment) {
      // Background equipment uses the same "(A) ... ; or (B) ..." pattern, so try the same split.
      const bgOpts = splitEquipmentOptions(bg.equipment);
      // Default to option A for the background; backgrounds are uniform enough
      // that this matches what most players pick.
      addParsed(bgOpts?.a ?? bg.equipment);
    }

    // Known spells (only if caster).
    const spells: KnownSpell[] = [];
    for (const sid of [...s.chosenCantrips, ...s.chosenLv1]) {
      const srd = SPELLS_2024.find((sp) => sp.index === sid);
      if (!srd) continue;
      spells.push({
        id: crypto.randomUUID(),
        sourceKind: 'srd-spell',
        sourceId: sid,
        name: srd.name,
        prepared: true,
      });
    }

    // Skill proficiencies: union of background skills + class skill picks.
    const skillProfs = Array.from(
      new Set(
        [
          ...bg.skillProfs.map((sk) => sk.toLowerCase().replace(/\s+/g, '-')),
          ...s.classSkills,
        ].filter(Boolean),
      ),
    );

    // Save proficiencies: parse class saveProfs ("Strength and Constitution").
    const saveProfs: string[] = [];
    const saveText = (cls.saveProfs ?? '').toLowerCase();
    for (const a of ABILITIES) {
      if (saveText.includes(a.full.toLowerCase())) saveProfs.push(a.key);
    }

    const member: Omit<PartyMember, 'id' | 'owner_user_id'> = {
      name: s.name.trim(),
      player: s.player.trim() || undefined,
      race: species.name,
      classSummary: `${cls.name} 1`,
      classId: cls.index,
      level: 1,
      ac: 10 + abilityMod(finalScores.dex),
      hp,
      maxHp: hp,
      tempHp: 0,
      speed: species.speed,
      initiativeBonus: abilityMod(finalScores.dex),
      passivePerception: 10 + abilityMod(finalScores.wis),
      passiveInvestigation: 10 + abilityMod(finalScores.int),
      passiveInsight: 10 + abilityMod(finalScores.wis),
      str: finalScores.str,
      dex: finalScores.dex,
      con: finalScores.con,
      int: finalScores.int,
      wis: finalScores.wis,
      cha: finalScores.cha,
      saves: '',
      skills: '',
      languages: 'Common',
      source: 'manual',
      xp: 0,
      gold: startingGold,
      deathSaves: { ...DEFAULT_DEATH_SAVES },
      skillProfs,
      saveProfs,
      inventory,
      spellAbility: spellAbility,
      spellSlots: startingSlots(s.classId),
      spells,
      customActions: [],
      features,
      hitDieSize: cls.hitDie,
      hitDiceCurrent: 1,
      details: Object.keys(s.details).length > 0 ? s.details : undefined,
    };

    onCreate(member);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex sm:items-start sm:justify-center sm:overflow-y-auto sm:py-8 sm:px-4">
      <div className="w-full max-w-3xl bg-slate-900 sm:border border-slate-800 sm:rounded-lg shadow-2xl flex flex-col h-full sm:h-auto sm:max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h2 className="font-serif text-xl text-sky-200">Build a character</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1">
            <XIcon size={18} />
          </button>
        </div>

        {/* Step pips */}
        <div className="flex items-center gap-1.5 px-5 py-3 border-b border-slate-800 overflow-x-auto">
          {STEPS.map((st, i) => (
            <button
              key={st}
              onClick={() => update({ step: st })}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] ${
                st === s.step
                  ? 'bg-sky-900/50 text-sky-100'
                  : stepIndex > i
                    ? 'text-slate-300 hover:bg-slate-800'
                    : 'text-slate-500'
              }`}
            >
              <span className="font-mono">{i + 1}</span>
              <span className="capitalize">{st}</span>
            </button>
          ))}
        </div>

        {/* Step body — scrolls inside the flex column on mobile where the
            modal occupies the full viewport. */}
        <div className="p-4 sm:p-5 min-h-[400px] flex-1 overflow-y-auto">
          {s.step === 'species' && (
            <SpeciesStep value={s.speciesId} onChange={(id) => update({ speciesId: id })} />
          )}
          {s.step === 'class' && (
            <ClassStep
              value={s.classId}
              onChange={(id) => update({ classId: id, classSkills: [] })}
              classSkills={s.classSkills}
              onSkillsChange={(next) => update({ classSkills: next })}
            />
          )}
          {s.step === 'background' && (
            <BackgroundStep
              value={s.backgroundId}
              bonuses={s.bgBonuses}
              onPick={(id, bg) => {
                // Reset bonuses on background change, pre-fill with all eligible keys set to 0.
                const reset: Record<AbilityKey, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
                update({ backgroundId: id, bgBonuses: reset });
                void bg;
              }}
              onBonus={(k, v) => update({ bgBonuses: { ...s.bgBonuses, [k]: v } })}
            />
          )}
          {s.step === 'abilities' && (
            <AbilitiesStep
              method={s.abilityMethod}
              scores={s.scores}
              bgBonuses={s.bgBonuses}
              onMethod={(m) => update({ abilityMethod: m, scores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } })}
              onScore={(k, v) => update({ scores: { ...s.scores, [k]: v } })}
            />
          )}
          {s.step === 'equipment' && cls && (
            <EquipmentStep cls={cls} choice={s.equipmentChoice} onChoice={(c) => update({ equipmentChoice: c })} bg={bg} />
          )}
          {s.step === 'spells' && cls && (
            <SpellsStep
              cls={cls}
              rules={startingSpellRules}
              needsSpells={needsSpells}
              cantripPool={spellPool.cantrips}
              lv1Pool={spellPool.lv1}
              chosenCantrips={s.chosenCantrips}
              chosenLv1={s.chosenLv1}
              onCantrip={(ids) => update({ chosenCantrips: ids })}
              onLv1={(ids) => update({ chosenLv1: ids })}
            />
          )}
          {s.step === 'details' && (
            <DetailsStep
              details={s.details}
              onChange={(patch) => update({ details: { ...s.details, ...patch } })}
            />
          )}
          {s.step === 'finish' && (
            <FinishStep
              name={s.name}
              player={s.player}
              cls={cls}
              species={species}
              bg={bg}
              scores={finalScores}
              onName={(v) => update({ name: v })}
              onPlayer={(v) => update({ player: v })}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800">
          <button
            onClick={goPrev}
            disabled={stepIndex === 0}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <ChevronLeft size={14} /> Back
          </button>
          {s.step === 'finish' ? (
            <button
              onClick={handleCreate}
              disabled={!stepValid('finish')}
              className="px-4 py-1.5 text-sm rounded bg-sky-700 hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-medium"
            >
              Create character
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!stepValid(s.step)}
              className="px-4 py-1.5 text-sm rounded bg-sky-700 hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-medium flex items-center gap-1"
            >
              Next <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step components ───────────────────────────────────────────────────────

function SpeciesStep({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const picked = value ? SPECIES_2024.find((x) => x.index === value) ?? null : null;
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <div className="space-y-1 overflow-y-auto max-h-[400px]">
        {SPECIES_2024.map((sp) => (
          <button
            key={sp.index}
            onClick={() => onChange(sp.index)}
            className={`w-full text-left px-3 py-2 rounded text-sm border ${
              value === sp.index
                ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                : 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-200'
            }`}
          >
            {sp.name}
          </button>
        ))}
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded p-4 overflow-y-auto max-h-[400px]">
        {picked ? (
          <>
            <h3 className="font-serif text-lg text-sky-200 mb-1">{picked.name}</h3>
            <div className="text-xs text-slate-500 mb-3 flex gap-3">
              <span>{picked.creatureType}</span>
              <span>•</span>
              <span>{picked.size}</span>
              <span>•</span>
              <span>Speed {picked.speed}</span>
            </div>
            <div className="space-y-2 text-sm">
              {picked.traits.map((t) => (
                <div key={t.name}>
                  <div className="text-slate-200 font-medium text-xs uppercase tracking-wider mb-0.5">{t.name}</div>
                  <div className="text-slate-300 text-xs leading-relaxed">{t.desc}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-slate-500 italic text-sm">Pick a species to see its traits.</div>
        )}
      </div>
    </div>
  );
}

function ClassStep({
  value,
  onChange,
  classSkills,
  onSkillsChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
  classSkills: string[];
  onSkillsChange: (next: string[]) => void;
}) {
  const picked = value ? CLASSES_2024.find((c) => c.index === value) ?? null : null;
  const lv1Features = picked?.levelTable.find((r) => r.level === 1)?.features ?? [];
  const skillRule = picked ? parseSkillChoices(picked.skillChoices) : null;

  const toggleSkill = (slug: string) => {
    if (!skillRule) return;
    if (classSkills.includes(slug)) {
      onSkillsChange(classSkills.filter((x) => x !== slug));
    } else if (classSkills.length < skillRule.count) {
      onSkillsChange([...classSkills, slug]);
    }
  };

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <div className="space-y-1 overflow-y-auto max-h-[440px]">
        {CLASSES_2024.map((c) => (
          <button
            key={c.index}
            onClick={() => onChange(c.index)}
            className={`w-full text-left px-3 py-2 rounded text-sm border ${
              value === c.index
                ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                : 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-200'
            }`}
          >
            <div>{c.name}</div>
            <div className="text-[10px] text-slate-500">d{c.hitDie} HP · {c.primaryAbility}</div>
          </button>
        ))}
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded p-4 overflow-y-auto max-h-[440px]">
        {picked ? (
          <>
            <h3 className="font-serif text-lg text-sky-200 mb-2">{picked.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <Stat label="Hit die" value={`d${picked.hitDie}`} />
              <Stat label="Primary" value={picked.primaryAbility} />
              <Stat label="Saves" value={picked.saveProfs} />
              <Stat label="Skills" value={picked.skillChoices} />
            </div>

            {skillRule && (
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                  Pick skills ({classSkills.length}/{skillRule.count})
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {skillRule.options.map((opt) => {
                    const slug = opt.toLowerCase().replace(/\s+/g, '-');
                    const checked = classSkills.includes(slug);
                    const disabled = !checked && classSkills.length >= skillRule.count;
                    return (
                      <button
                        key={slug}
                        onClick={() => toggleSkill(slug)}
                        disabled={disabled}
                        className={`text-left px-2 py-1 text-xs rounded border ${
                          checked
                            ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                            : disabled
                              ? 'border-slate-800 bg-slate-950 text-slate-600 cursor-not-allowed'
                              : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span className={`inline-block w-3 h-3 rounded-sm border mr-1.5 align-middle ${checked ? 'border-sky-400 bg-sky-500' : 'border-slate-600'}`} />
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Level 1 features</div>
            <div className="space-y-2 text-xs">
              {lv1Features.map((f) => (
                <div key={f}>
                  <div className="text-slate-200 font-medium">{f}</div>
                  {picked.features[f] && (
                    <div className="text-slate-400 text-[11px] leading-relaxed markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {picked.features[f].slice(0, 400) + (picked.features[f].length > 400 ? '…' : '')}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-slate-500 italic text-sm">Pick a class to see its features.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}

function BackgroundStep({
  value,
  bonuses,
  onPick,
  onBonus,
}: {
  value: string | null;
  bonuses: Record<AbilityKey, number>;
  onPick: (id: string, bg: Background) => void;
  onBonus: (k: AbilityKey, v: number) => void;
}) {
  const picked = value ? BACKGROUNDS_2024.find((b) => b.index === value) ?? null : null;
  // Map background ability strings to ability keys
  const allowedKeys: AbilityKey[] = picked
    ? picked.abilityScores
        .map((a) => ABILITY_NAME_TO_KEY[a.toLowerCase()])
        .filter(Boolean) as AbilityKey[]
    : [];
  const bonusSum = Object.values(bonuses).reduce((a, b) => a + b, 0);
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <div className="space-y-1">
        {BACKGROUNDS_2024.map((b) => (
          <button
            key={b.index}
            onClick={() => onPick(b.index, b)}
            className={`w-full text-left px-3 py-2 rounded text-sm border ${
              value === b.index
                ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                : 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-200'
            }`}
          >
            <div>{b.name}</div>
            <div className="text-[10px] text-slate-500">{b.abilityScores.join(', ')}</div>
          </button>
        ))}
      </div>
      <div className="bg-slate-950 border border-slate-800 rounded p-4 overflow-y-auto max-h-[400px]">
        {picked ? (
          <>
            <h3 className="font-serif text-lg text-sky-200 mb-2">{picked.name}</h3>
            <div className="grid grid-cols-1 gap-1.5 text-xs mb-4">
              <Stat label="Skill proficiencies" value={picked.skillProfs.join(', ')} />
              <Stat label="Tool proficiency" value={picked.toolProf} />
              <Stat label="Starting feat" value={picked.feat} />
            </div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
              Ability boosts ({bonusSum}/3 distributed — pick +2/+1 across two, or +1/+1/+1 across three)
            </div>
            <div className="space-y-1.5">
              {allowedKeys.map((k) => {
                const v = bonuses[k];
                return (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <div className="w-32 text-slate-300">
                      {ABILITIES.find((a) => a.key === k)?.full}
                    </div>
                    <div className="flex gap-1">
                      {[0, 1, 2].map((n) => (
                        <button
                          key={n}
                          onClick={() => {
                            // Constrain: total must end up at 3 with at-most one +2.
                            if (n === 0) onBonus(k, 0);
                            else if (n === 2 && Object.values(bonuses).some((b) => b === 2 && bonuses[k] !== 2)) return;
                            else onBonus(k, n);
                          }}
                          className={`w-7 h-7 rounded text-xs font-mono ${
                            v === n
                              ? 'bg-sky-700 text-white'
                              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          {n === 0 ? '0' : `+${n}`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {bonusSum !== 3 && (
              <div className="mt-3 text-xs text-amber-300">
                Distribute exactly 3 points: either +2 and +1 across two abilities, or +1 to each of three.
              </div>
            )}
          </>
        ) : (
          <div className="text-slate-500 italic text-sm">Pick a background to see its boosts and skills.</div>
        )}
      </div>
    </div>
  );
}

function AbilitiesStep({
  method,
  scores,
  bgBonuses,
  onMethod,
  onScore,
}: {
  method: 'standard' | 'pointbuy' | 'roll';
  scores: Record<AbilityKey, number>;
  bgBonuses: Record<AbilityKey, number>;
  onMethod: (m: 'standard' | 'pointbuy' | 'roll') => void;
  onScore: (k: AbilityKey, v: number) => void;
}) {
  const [rolled, setRolled] = useState<number[] | null>(null);
  const pointsSpent = ABILITIES.reduce((a, k) => a + (POINT_COST[scores[k.key]] ?? 0), 0);
  const usedStandard = ABILITIES.map((a) => scores[a.key]);
  const rollSet = () => {
    const arr = Array.from({ length: 6 }, () => {
      const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
      rolls.sort((a, b) => b - a);
      return rolls[0] + rolls[1] + rolls[2];
    });
    arr.sort((a, b) => b - a);
    setRolled(arr);
  };
  return (
    <div>
      <div className="flex gap-1 mb-4">
        {(['standard', 'pointbuy', 'roll'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { onMethod(m); setRolled(null); }}
            className={`px-3 py-1 text-xs rounded ${
              method === m
                ? 'bg-sky-900/40 text-sky-200 border border-sky-700'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            {m === 'standard' ? 'Standard array (15/14/13/12/10/8)' : m === 'pointbuy' ? 'Point buy (27)' : 'Roll 4d6 drop lowest'}
          </button>
        ))}
      </div>

      {method === 'pointbuy' && (
        <div className="text-sm text-slate-400 mb-3">
          Points spent: <span className={`font-mono ${pointsSpent === POINT_BUDGET ? 'text-emerald-300' : pointsSpent > POINT_BUDGET ? 'text-rose-400' : 'text-slate-300'}`}>{pointsSpent}</span> / {POINT_BUDGET}
        </div>
      )}
      {method === 'standard' && (
        <div className="text-sm text-slate-400 mb-3">
          Assign each value to a different ability. Remaining:{' '}
          <span className="font-mono text-slate-300">
            {STANDARD_ARRAY.filter((v) => {
              // Count how many times v appears in usedStandard; "remaining" = (count in array) - (count used at value v)
              const inArr = STANDARD_ARRAY.filter((x) => x === v).length;
              const inScores = usedStandard.filter((x) => x === v).length;
              return inScores < inArr;
            }).join(' ') || 'none'}
          </span>
        </div>
      )}
      {method === 'roll' && (
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-3">
            <button
              onClick={rollSet}
              className="px-3 py-1 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white flex items-center gap-1"
            >
              <Dices size={12} /> Roll a set
            </button>
            <span className="text-xs text-slate-500">or enter your own rolls</span>
          </div>
          {/* Editable set — auto-roll fills these, or type physical-dice results
              here. The assignment dropdowns below draw from this set. */}
          <div className="flex flex-wrap gap-2">
            {(rolled ?? [8, 8, 8, 8, 8, 8]).map((v, i) => (
              <input
                key={i}
                type="number"
                min={3}
                max={18}
                value={v}
                onChange={(e) => {
                  const n = Math.max(3, Math.min(18, parseInt(e.target.value || '3', 10) || 3));
                  setRolled((prev) => {
                    const next = [...(prev ?? [8, 8, 8, 8, 8, 8])];
                    next[i] = n;
                    return next;
                  });
                }}
                className="w-14 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-center text-sm font-mono"
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {ABILITIES.map((a) => {
          const base = scores[a.key];
          const bonus = bgBonuses[a.key];
          const final = base + bonus;
          return (
            <div key={a.key} className="bg-slate-950 border border-slate-800 rounded p-3">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-medium text-slate-200">{a.full}</div>
                <div className="text-[10px] text-slate-500">{abilityMod(final) >= 0 ? '+' : ''}{abilityMod(final)} mod</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                {method === 'pointbuy' && (
                  <input
                    type="number"
                    min={8}
                    max={15}
                    value={base}
                    onChange={(e) => onScore(a.key, Math.max(8, Math.min(15, parseInt(e.target.value || '8', 10))))}
                    className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-center text-sm font-mono"
                  />
                )}
                {method === 'standard' && (
                  <select
                    value={base}
                    onChange={(e) => onScore(a.key, parseInt(e.target.value, 10))}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                  >
                    {[8, ...STANDARD_ARRAY].filter((v, i, arr) => arr.indexOf(v) === i).sort((x, y) => x - y).map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                )}
                {method === 'roll' && (
                  <select
                    value={base}
                    onChange={(e) => onScore(a.key, parseInt(e.target.value, 10))}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                  >
                    {(rolled ?? [8, 8, 8, 8, 8, 8]).map((v, i) => (
                      <option key={i} value={v}>{v}</option>
                    ))}
                  </select>
                )}
                {bonus > 0 && (
                  <span className="text-xs text-emerald-300 font-mono">+{bonus}</span>
                )}
                <span className="text-xs text-slate-500 font-mono ml-auto">= {final}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EquipmentStep({ cls, choice, onChoice, bg }: { cls: Class; choice: 'A' | 'B'; onChoice: (c: 'A' | 'B') => void; bg: Background | null }) {
  const opts = splitEquipmentOptions(cls.startingEquipment);
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">
        Pick one starting package from your class. Detailed inventory management lives on the
        sheet — for now this lands as a single text entry you can break apart later.
      </div>
      {opts ? (
        <div className="grid grid-cols-2 gap-3">
          {([['A', opts.a], ['B', opts.b]] as const).map(([key, txt]) => (
            <button
              key={key}
              onClick={() => onChoice(key)}
              className={`text-left p-3 rounded border ${
                choice === key
                  ? 'border-sky-500 bg-sky-900/30'
                  : 'border-slate-800 bg-slate-950 hover:bg-slate-800/60'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Option {key}</div>
              <div className="text-sm text-slate-200 leading-relaxed">{txt}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-400 bg-slate-950 border border-slate-800 rounded p-3">
          {cls.startingEquipment || 'No starting equipment data on this class.'}
        </div>
      )}
      {bg?.equipment && (
        <div className="bg-slate-950 border border-slate-800 rounded p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Plus from your {bg.name} background</div>
          <div className="text-sm text-slate-300 leading-relaxed markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bg.equipment}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function SpellsStep({
  cls,
  rules,
  needsSpells,
  cantripPool,
  lv1Pool,
  chosenCantrips,
  chosenLv1,
  onCantrip,
  onLv1,
}: {
  cls: Class;
  rules: { cantrips: number; lv1: number; label: string };
  needsSpells: boolean;
  cantripPool: string[];
  lv1Pool: string[];
  chosenCantrips: string[];
  chosenLv1: string[];
  onCantrip: (ids: string[]) => void;
  onLv1: (ids: string[]) => void;
}) {
  const toggle = (set: string[], onSet: (next: string[]) => void, max: number, id: string) => {
    if (set.includes(id)) onSet(set.filter((x) => x !== id));
    else if (set.length < max) onSet([...set, id]);
  };

  if (!needsSpells) {
    // Friendly placeholder so non-caster players don't wonder why the spells
    // step is empty. Most martial classes (Fighter, Monk, Rogue) never cast;
    // Paladin and Ranger gain spellcasting at level 2, not level 1.
    const lateCaster = cls.index === 'paladin' || cls.index === 'ranger';
    return (
      <div className="text-center py-12 text-slate-400 max-w-md mx-auto space-y-2">
        <Sparkles size={32} className="text-slate-700 mx-auto" />
        <div className="text-sm">
          {cls.name}s don't pick spells at level 1.
        </div>
        <div className="text-xs text-slate-500 leading-relaxed">
          {lateCaster
            ? `${cls.name}s gain Spellcasting at level 2. You'll pick your starting spells then via the level-up flow.`
            : `${cls.name} is a non-magical class — your power comes from training, not spells. You'll still see custom spells / scrolls / wands in your inventory if you find or buy them.`}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-sm text-slate-400">
        At level 1, your {cls.name} picks {rules.cantrips} cantrip{rules.cantrips !== 1 ? 's' : ''} and {rules.lv1} {rules.label}.
      </div>
      {rules.cantrips > 0 && (
        <SpellBucket
          title={`Cantrips (${chosenCantrips.length}/${rules.cantrips})`}
          pool={cantripPool}
          chosen={chosenCantrips}
          onToggle={(id) => toggle(chosenCantrips, onCantrip, rules.cantrips, id)}
        />
      )}
      {rules.lv1 > 0 && (
        <SpellBucket
          title={`Level 1 (${chosenLv1.length}/${rules.lv1})`}
          pool={lv1Pool}
          chosen={chosenLv1}
          onToggle={(id) => toggle(chosenLv1, onLv1, rules.lv1, id)}
        />
      )}
    </div>
  );
}

const DETAIL_FIELDS: { key: keyof CharacterDetails; label: string; placeholder: string }[] = [
  { key: 'gender', label: 'Gender', placeholder: 'Female, male, non-binary, …' },
  { key: 'age', label: 'Age', placeholder: '24' },
  { key: 'height', label: 'Height', placeholder: '5 4"' },
  { key: 'weight', label: 'Weight', placeholder: '140 lb' },
  { key: 'eyes', label: 'Eyes', placeholder: 'Hazel' },
  { key: 'hair', label: 'Hair', placeholder: 'Auburn, braided' },
  { key: 'skin', label: 'Skin', placeholder: 'Pale, freckled' },
  { key: 'alignment', label: 'Alignment', placeholder: 'Chaotic Good' },
  { key: 'deity', label: 'Deity', placeholder: 'Eilistraee' },
];

function DetailsStep({
  details,
  onChange,
}: {
  details: CharacterDetails;
  onChange: (patch: Partial<CharacterDetails>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-400">
        Optional flavour — give your character a face. None of this affects mechanics; you can leave any field blank.
      </div>
      <div className="grid grid-cols-3 gap-3">
        {DETAIL_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <div className="text-xs text-slate-500 mb-1">{f.label}</div>
            <input
              value={details[f.key] ?? ''}
              onChange={(e) => onChange({ [f.key]: e.target.value || undefined })}
              placeholder={f.placeholder}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SpellBucket({ title, pool, chosen, onToggle }: { title: string; pool: string[]; chosen: string[]; onToggle: (id: string) => void }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-1.5 max-h-[300px] overflow-y-auto">
        {pool.map((id) => {
          const srd = SPELLS_2024.find((sp) => sp.index === id);
          if (!srd) return null;
          const isPicked = chosen.includes(id);
          return (
            <SpellPopoverTrigger key={id} spell={srd} className="block">
              <button
                onClick={() => onToggle(id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs border ${
                  isPicked
                    ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                    : 'border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-1">
                  <Sparkles size={10} className="text-violet-300" />
                  <span className="truncate">{srd.name}</span>
                </div>
                <div className="text-[10px] text-slate-500">{srd.school.name}{srd.ritual ? ' · R' : ''}{srd.concentration ? ' · C' : ''}</div>
              </button>
            </SpellPopoverTrigger>
          );
        })}
      </div>
    </div>
  );
}

function FinishStep({
  name,
  player,
  cls,
  species,
  bg,
  scores,
  onName,
  onPlayer,
}: {
  name: string;
  player: string;
  cls: Class | null;
  species: Species | null;
  bg: Background | null;
  scores: Record<AbilityKey, number>;
  onName: (v: string) => void;
  onPlayer: (v: string) => void;
}) {
  const hp = cls ? cls.hitDie + abilityMod(scores.con) : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs text-slate-400 mb-1">Character name</div>
          <input
            autoFocus
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Eldyn Stormcrest"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <div className="text-xs text-slate-400 mb-1">Player name (optional)</div>
          <input
            value={player}
            onChange={(e) => onPlayer(e.target.value)}
            placeholder="Alex"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded p-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Preview</div>
        <div className="font-serif text-xl text-sky-200">{name || 'Unnamed'}</div>
        <div className="text-sm text-slate-400">
          {species?.name ?? '—'} {cls?.name ?? '—'} 1 · {bg?.name ?? '—'}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Stat label="HP" value={`${hp}`} />
          <Stat label="AC (no armor)" value={`${10 + abilityMod(scores.dex)}`} />
          <Stat label="Speed" value={species?.speed ?? '30 ft'} />
          {ABILITIES.map((a) => (
            <Stat key={a.key} label={a.label} value={`${scores[a.key]} (${abilityMod(scores[a.key]) >= 0 ? '+' : ''}${abilityMod(scores[a.key])})`} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><Heart size={11} /> {hp} HP from d{cls?.hitDie ?? 0} + Con</span>
          <span className="flex items-center gap-1"><Shield size={11} /> Add armor in inventory after creation</span>
        </div>
      </div>
    </div>
  );
}
