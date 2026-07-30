import { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Printer, BedDouble, Coffee, Heart, Dices, HeartPulse, Skull, Eye, EyeOff, EarOff, Ghost, Grab, Zap, ZapOff, Mountain, Biohazard, ArrowDown, Link as LinkIcon, Moon, Search, Brain, Plus, X as XIcon, Swords, Shield as ShieldIcon, Sparkles, Backpack, Trash2, ChevronUp, AlertTriangle, Pencil, type LucideIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LevelUpModal, { type LevelUpResult } from './LevelUpModal';
import { CONDITIONS } from '../../data/conditions';
import {
  DEFAULT_DEATH_SAVES,
  DEFAULT_GOLD,
  DEFAULT_SPELL_SLOTS,
  type Gold,
  type ActionCategory,
  type CharacterDetails,
  type CharacterFeature,
  type CustomAction,
  type InventoryItem,
  type KnownSpell,
  type PartyMember,
  type SpellSlots,
} from '../party/partyStore';
import { useQuickDice } from '../dice/quickDiceStore';
import { hpBarClass, hpPercent } from '../hpBar';
import { useCatalog, searchCatalog, type CatalogEntry } from '../chat/catalog';
import { EQUIPMENT, MAGIC_ITEMS, SPELLS, SPECIES_2024, equipmentFor, spellsFor } from '../../data/srd';
import type { SrdEdition, CoinRates } from '../notes/campaignSettingsStore';
import { useCampaignSettings, COIN_KEYS, DEFAULT_COIN_RATES } from '../notes/campaignSettingsStore';
import type { EquipmentItem, Spell } from '../../data/types';
import IconPicker from '../../components/IconPicker';
import { iconByKey } from '../../data/itemIcons';
import { useSharedHomebrew } from '../homebrew/sharedHomebrewStore';

// ── Skill / save definitions ──────────────────────────────────────────────

type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

const SKILLS: { key: string; label: string; ability: Ability }[] = [
  { key: 'acrobatics',       label: 'Acrobatics',       ability: 'dex' },
  { key: 'animal-handling',  label: 'Animal Handling',  ability: 'wis' },
  { key: 'arcana',           label: 'Arcana',           ability: 'int' },
  { key: 'athletics',        label: 'Athletics',        ability: 'str' },
  { key: 'deception',        label: 'Deception',        ability: 'cha' },
  { key: 'history',          label: 'History',          ability: 'int' },
  { key: 'insight',          label: 'Insight',          ability: 'wis' },
  { key: 'intimidation',     label: 'Intimidation',     ability: 'cha' },
  { key: 'investigation',    label: 'Investigation',    ability: 'int' },
  { key: 'medicine',         label: 'Medicine',         ability: 'wis' },
  { key: 'nature',           label: 'Nature',           ability: 'int' },
  { key: 'perception',       label: 'Perception',       ability: 'wis' },
  { key: 'performance',      label: 'Performance',      ability: 'cha' },
  { key: 'persuasion',       label: 'Persuasion',       ability: 'cha' },
  { key: 'religion',         label: 'Religion',         ability: 'int' },
  { key: 'sleight-of-hand',  label: 'Sleight of Hand',  ability: 'dex' },
  { key: 'stealth',          label: 'Stealth',          ability: 'dex' },
  { key: 'survival',         label: 'Survival',         ability: 'wis' },
];

const ABILITY_LABEL: Record<Ability, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const abilityMod = (score: number) => Math.floor((score - 10) / 2);
const profBonus = (level: number) =>
  2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Full editable character sheet for the player's claimed party_members row.
 * Phase A: identity, vitals, stats, passives, gold, XP, death saves,
 * short/long rest actions, notes. Phase B adds inventory + spells.
 */
export default function CharacterSheet({
  m,
  onUpdate,
}: {
  m: PartyMember;
  onUpdate: (patch: Partial<PartyMember>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PartyMember>(m);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  // Target level for cascading multi-level jumps. When the player types LVL
  // higher than current (or accumulates XP past multiple thresholds), the
  // modal re-opens after each confirm until the target is reached.
  const [levelUpTarget, setLevelUpTarget] = useState<number | null>(null);
  // First render exits the XP-threshold effect below so we don't auto-open
  // the modal just because the character was already at-threshold when the
  // sheet opened. Subsequent edits do trigger the prompt.
  const xpEffectMounted = useRef(false);
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const encumbranceEnabled = useCampaignSettings((s) => s.settings.encumbrance ?? false);

  // Sync from server when not locally edited (matches CharCard's pattern).
  useEffect(() => {
    if (!dirty) setDraft(m);
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open the level-up modal when the player edits their XP across the
  // current level's threshold. Mounting with already-eligible XP doesn't
  // trigger — only changes the player makes during this session do, so the
  // modal doesn't surprise-pop the moment the sheet opens.
  useEffect(() => {
    if (!xpEffectMounted.current) {
      xpEffectMounted.current = true;
      return;
    }
    const p = xpProgress(draft.xp ?? 0, draft.level);
    if (!p.atMax && p.eligible && !showLevelUp) {
      // Walk forward through XP bands so a huge XP entry cascades through
      // every level it covers rather than capping at one.
      let lv = draft.level;
      let rem = draft.xp ?? 0;
      while (lv < 20 && rem >= XP_PER_LEVEL[lv]) {
        rem -= XP_PER_LEVEL[lv];
        lv++;
      }
      setLevelUpTarget(lv);
      setShowLevelUp(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.xp, draft.level]);

  const apply = (p: Partial<PartyMember>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (p.dex !== undefined) next.initiativeBonus = abilityMod(next.dex);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { id: _id, owner_user_id: _o, ...rest } = draft;
      await onUpdate(rest);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const longRest = () => {
    // Restore HP to max, clear temp HP, reset death saves, refill spell slots.
    // Hit dice recover up to half max (rounded down, min 1) per 5e rules.
    // Exhaustion drops by 1 per the 2024 condition definition.
    const slots = (draft.spellSlots ?? []).map((s) => ({ ...s, current: s.max }));
    const maxDice = draft.level;
    const regained = Math.max(1, Math.floor(maxDice / 2));
    const newDice = Math.min(maxDice, (draft.hitDiceCurrent ?? maxDice) + regained);
    apply({
      hp: draft.maxHp,
      tempHp: 0,
      deathSaves: { ...DEFAULT_DEATH_SAVES },
      spellSlots: slots.length > 0 ? slots : undefined,
      hitDiceCurrent: newDice,
      exhaustion: Math.max(0, (draft.exhaustion ?? 0) - 1),
    });
  };

  // ── Equipped-derived stats ─────────────────────────────────────────────
  // Equipped armor contributes its base AC + (capped) DEX mod to the
  // effective AC shown in Vitals. Manual AC still wins if no armor is
  // equipped — players who don't want to bother with armor rows just type
  // their AC directly.
  const equippedItems = (draft.inventory ?? []).filter((i) => i.equipped);
  const equippedWeapons = equippedItems
    .map((i) => ({ item: i, srd: srdItemFor(i, edition) }))
    .filter((x) => x.srd?.damage);
  const equippedArmor = equippedItems
    .map((i) => srdItemFor(i, edition))
    .filter((s): s is EquipmentItem => !!s?.armor_class);

  const computedAc = (() => {
    if (equippedArmor.length === 0) return null;
    // Use the highest-base armor if multiple equipped (e.g., shield + chest).
    const main = equippedArmor.reduce((best, cur) =>
      (cur.armor_class!.base > (best?.armor_class!.base ?? 0) ? cur : best),
    equippedArmor[0]);
    let ac = main.armor_class!.base;
    if (main.armor_class!.dex_bonus) {
      const dex = abilityMod(draft.dex);
      const max = main.armor_class!.max_bonus;
      ac += max != null ? Math.min(dex, max) : dex;
    }
    // Shield bonus is +2 per equipped shield (SRD shields use armor_category 'Shield').
    const shieldCount = equippedArmor.filter((a) => a.armor_category === 'Shield').length;
    ac += shieldCount * 2;
    return ac;
  })();
  const effectiveAc = computedAc ?? draft.ac;

  const printSheet = () => {
    // Browser print dialog → user chooses "Save as PDF" or a printer.
    // The @media print stylesheet in index.css hides everything outside
    // .print-character-sheet so the PDF is just the sheet.
    window.print();
  };

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 print-character-sheet relative">
      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="fixed bottom-6 right-6 z-30 px-4 py-2 rounded-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold shadow-lg flex items-center gap-1.5 print:hidden"
          title="Save character (unsaved changes)"
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      <SheetHeader
        draft={draft}
        dirty={dirty}
        saving={saving}
        onApply={apply}
        onSave={save}
        onPrint={printSheet}
        onLevelUp={(targetLevel) => {
          setLevelUpTarget(targetLevel ?? null);
          setShowLevelUp(true);
        }}
      />

      {showLevelUp && (
        <LevelUpModal
          key={draft.level}
          member={draft}
          onClose={() => {
            setShowLevelUp(false);
            setLevelUpTarget(null);
          }}
          onConfirm={(result: LevelUpResult) => {
            // Merge the modal output into the sheet. Newly-unlocked class
            // features append to the existing list so previously-tracked items
            // (manual entries, racial traits) survive. Ability bumps apply on
            // top of current scores, capped at 20.
            const bumps = result.abilityBumps ?? {};
            const bumped: Partial<PartyMember> = {};
            for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
              const delta = bumps[k];
              if (delta) bumped[k] = Math.min(20, draft[k] + delta);
            }
            // Level-up grants one new hit die. If the character doesn't have
            // a stored die size yet, derive it from the class lookup table.
            const newMaxDice = result.level;
            const newCurrentDice = (draft.hitDiceCurrent ?? draft.level) + 1;
            const inferredDieSize = (() => {
              if (draft.hitDieSize) return undefined; // already set
              if (!result.classId && !draft.classId) return undefined;
              const cid = result.classId ?? draft.classId!;
              const HIT_DIE_BY_CLASS: Record<string, number> = {
                barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
                bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
                sorcerer: 6, wizard: 6,
              };
              return HIT_DIE_BY_CLASS[cid];
            })();
            apply({
              level: result.level,
              maxHp: result.maxHp,
              hp: result.hp,
              // Reset XP — sheet stores xp as "since last level".
              xp: 0,
              spellSlots: result.spellSlots ?? draft.spellSlots,
              features: [...(draft.features ?? []), ...result.features],
              ...(result.spellsAdded && result.spellsAdded.length > 0
                ? { spells: [...(draft.spells ?? []), ...result.spellsAdded] }
                : {}),
              ...(result.classId ? { classId: result.classId } : {}),
              ...(result.subclassId ? { subclassId: result.subclassId } : {}),
              hitDiceCurrent: Math.min(newMaxDice, newCurrentDice),
              ...(inferredDieSize ? { hitDieSize: inferredDieSize } : {}),
              ...bumped,
            });
            // If we were asked to cascade up to a higher target level, leave
            // the modal mounted — the key={draft.level} above will remount it
            // with fresh state once apply() lands. Otherwise close out.
            if (levelUpTarget !== null && result.level < levelUpTarget) {
              return;
            }
            setShowLevelUp(false);
            setLevelUpTarget(null);
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mt-4">
        <Card title="Vitals">
          <VitalsBlock
            draft={draft}
            onApply={apply}
            onLongRest={longRest}
            effectiveAc={effectiveAc}
            armorEquipped={equippedArmor.length > 0}
            equippedWeapons={equippedWeapons}
          />
        </Card>

        <Card title="Death saves" subtitle="Used when HP hits 0">
          <DeathSavesBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Ability scores">
          <AbilityScoresBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Passive senses">
          <PassivesBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Saving throws" subtitle={`PB ${fmt(profBonus(draft.level))}`}>
          <SavesBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Coin purse">
          <GoldBlock draft={draft} onApply={apply} />
        </Card>

        {encumbranceEnabled && (
          <Card title="Encumbrance" subtitle="Carried weight vs capacity · read-only">
            <EncumbranceBlock draft={draft} />
          </Card>
        )}

        <Card title="Skills" subtitle="Click pip to toggle proficiency · click modifier to roll" className="lg:col-span-2">
          <SkillsBlock draft={draft} onApply={apply} />
        </Card>

        <Card
          title="Inventory"
          subtitle="Click + to add from the catalog · weapons show attack/damage from your stats"
          className="lg:col-span-2"
        >
          <InventoryBlock draft={draft} onApply={apply} />
        </Card>

        <Card
          title="Spellbook"
          subtitle="Set casting ability to compute attack and save DC · click slot pips to spend"
          className="lg:col-span-2"
        >
          <SpellbookBlock draft={draft} onApply={apply} />
        </Card>

        <Card
          title="Conditions & exhaustion"
          subtitle="Active effects, tracked across the sheet and combat surfaces"
          className="lg:col-span-2"
        >
          <ConditionsBlock draft={draft} onApply={apply} />
        </Card>

        <Card
          title="Actions"
          subtitle="Weapons + spells, grouped by action economy · add custom entries per bucket"
          className="lg:col-span-2"
        >
          <ActionsBlock draft={draft} onApply={apply} />
        </Card>

        <Card
          title="Features & traits"
          subtitle="Class, race, feat, and other features · track limited uses inline"
          className="lg:col-span-2"
        >
          <FeaturesBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Description" subtitle="Appearance, alignment, deity — flavour only" className="lg:col-span-2">
          <DetailsBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Languages & notes" subtitle="Free-text" className="lg:col-span-2">
          <TextFieldsBlock draft={draft} onApply={apply} />
        </Card>

        <Card title="Notes" className="lg:col-span-2">
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => apply({ notes: e.target.value })}
            rows={5}
            placeholder="Backstory hooks, party secrets, things to remember…"
            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700 resize-y"
          />
        </Card>
      </div>
    </div>
  );
}

// ── XP / Level ────────────────────────────────────────────────────────────

/** Cumulative XP table for reference — index 1..20 maps to the total XP a
 *  character would need under standard SRD rules to *be* that level. We don't
 *  store XP as a cumulative value, but the deltas below are derived from it. */
const XP_THRESHOLDS_CUMULATIVE: number[] = [
  0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

/** XP needed to advance *from* level N to level N+1 (the band, not the
 *  cumulative threshold). We store xp on the sheet as "earned since last
 *  level" so each level starts at 0 — easier to scan than cumulative numbers
 *  in the hundred-thousands at high levels. */
const XP_PER_LEVEL: number[] = Array.from({ length: 21 }, (_, i) =>
  i < 1 || i >= 20 ? 0 : XP_THRESHOLDS_CUMULATIVE[i + 1] - XP_THRESHOLDS_CUMULATIVE[i],
);

/** How much XP separates the current level from the next, and how far the
 *  character has progressed into that band. XP is now "since last level"
 *  semantics — the value resets to 0 each time the player levels up. */
function xpProgress(xp: number, level: number) {
  const lv = Math.max(1, Math.min(20, level));
  if (lv >= 20) return { atMax: true as const };
  const needed = XP_PER_LEVEL[lv];
  const remaining = Math.max(0, needed - xp);
  const eligible = xp >= needed;
  return {
    atMax: false as const,
    nextLevel: lv + 1,
    needed,
    remaining,
    eligible,
    /** 0..1 progress fraction inside the current XP band. */
    pct: Math.max(0, Math.min(1, xp / Math.max(1, needed))),
  };
}

// ── Header ──────────────────────────────────────────────────────────────

function SheetHeader({
  draft,
  dirty,
  saving,
  onApply,
  onSave,
  onPrint,
  onLevelUp,
}: {
  draft: PartyMember;
  dirty: boolean;
  saving: boolean;
  onApply: (p: Partial<PartyMember>) => void;
  onSave: () => void;
  onPrint: () => void;
  onLevelUp: (targetLevel?: number) => void;
}) {
  return (
    <div className="border border-slate-800 rounded-lg p-4 bg-slate-900">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[16rem] space-y-1">
          <input
            value={draft.name}
            onChange={(e) => onApply({ name: e.target.value })}
            className="w-full bg-transparent font-serif text-2xl text-sky-200 outline-none"
            placeholder="Character name"
          />
          <div className="flex flex-wrap items-baseline gap-3">
            <input
              value={draft.classSummary}
              onChange={(e) => onApply({ classSummary: e.target.value })}
              className="bg-transparent text-sm text-slate-300 outline-none border-b border-transparent focus:border-slate-700"
              placeholder="Class & level e.g. Fighter 3"
            />
            <span className="text-slate-700">·</span>
            <input
              value={draft.race}
              onChange={(e) => onApply({ race: e.target.value })}
              className="bg-transparent text-sm text-slate-400 outline-none border-b border-transparent focus:border-slate-700"
              placeholder="Race"
            />
          </div>
        </div>

        <div className="flex items-stretch gap-2">
          <LabeledNumber
            label="LVL"
            value={draft.level}
            onChange={(v) => {
              // Bumping LVL directly funnels into the level-up modal so the
              // player still gets HP / features / slots / ASI prompts. Passing
              // the typed value as the target cascades through every level up
              // to it, re-opening the modal between each confirm. Decreasing a
              // level applies straight through (homebrew / typo correction).
              if (v > draft.level) {
                onLevelUp(Math.min(20, v));
              } else if (v < draft.level) {
                onApply({ level: v });
              }
            }}
            width="w-16"
          />
          <LabeledNumber
            label="XP"
            value={draft.xp ?? 0}
            onChange={(v) => onApply({ xp: v })}
            width="w-24"
          />
          <LevelUpControl
            xp={draft.xp ?? 0}
            level={draft.level}
            onLevelUp={onLevelUp}
          />
          <button
            onClick={onPrint}
            title="Open print dialog (Save as PDF)"
            className="px-3 rounded border border-slate-700 hover:bg-slate-800 text-slate-300 flex items-center gap-1 text-xs print:hidden"
          >
            <Printer size={13} /> PDF
          </button>
          {dirty && (
            <button
              onClick={onSave}
              disabled={saving}
              className="px-3 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 print:hidden"
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <ConditionBadges draft={draft} onApply={onApply} />
    </div>
  );
}

/** Unified dead check used by Vitals + DeathSavesBlock. */
export function isCharacterDead(m: PartyMember): boolean {
  if (m.maxHp > 0 && m.hp <= -m.maxHp) return true;
  if ((m.exhaustion ?? 0) >= 6) return true;
  if ((m.deathSaves?.failures ?? 0) >= 3) return true;
  return false;
}

/** 2024 SRD exhaustion penalty: −2 to every D20 test per level. Applied at
 *  display and roll time to skills, saves, attacks, and initiative. */
export function exhaustionD20Penalty(m: PartyMember): number {
  return (m.exhaustion ?? 0) * -2;
}

/** Base movement speed in feet, derived from species when possible.
 *  Falls back to parsing the free-text speed field, then to 30. */
function parseSpeedFeet(s: string): number {
  const m = (s ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 30;
}
function speciesBaseSpeed(race: string): number | null {
  if (!race) return null;
  const hit = SPECIES_2024.find((sp) => sp.name.toLowerCase() === race.trim().toLowerCase());
  return hit ? parseSpeedFeet(hit.speed) : null;
}

/** Effective speed for the round: base − 5 ft per exhaustion level, floored at 0. */
export function effectiveSpeed(m: PartyMember): { base: number; penalty: number; effective: number; sourceLabel: string } {
  const fromSpecies = speciesBaseSpeed(m.race);
  const base = fromSpecies ?? parseSpeedFeet(m.speed ?? '30');
  const penalty = (m.exhaustion ?? 0) * 5;
  const effective = Math.max(0, base - penalty);
  return {
    base,
    penalty,
    effective,
    sourceLabel: fromSpecies != null ? `${m.race} base` : 'manual',
  };
}

// ── Vitals ──────────────────────────────────────────────────────────────

function VitalsBlock({
  draft,
  onApply,
  onLongRest,
  effectiveAc,
  armorEquipped,
  equippedWeapons,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
  onLongRest: () => void;
  effectiveAc: number;
  armorEquipped: boolean;
  equippedWeapons: { item: InventoryItem; srd: EquipmentItem | null }[];
}) {
  const rollFormula = useQuickDice((s) => s.rollFormula);
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const inventory = draft.inventory ?? [];
  const handsAvailable = draft.hands ?? 2;
  const handsUsed = inventory.filter((i) => i.equipped).reduce((s, i) => s + handsForItem(i, edition), 0);
  const overHands = handsUsed > handsAvailable;
  const hpPct = hpPercent(draft.hp, draft.maxHp);
  // SRD instant-death rule + 3 failed death saves + exhaustion 6 all kill.
  // The DeathSavesBlock auto-flags failures>=3 too; Vitals just surfaces the
  // unified badge so any of the three paths reads at a glance.
  const isDead = isCharacterDead(draft);
  const hpBarColor = hpBarClass(hpPct);
  // Hit dice — max equals character level. Default current to max on first
  // render so older characters without a stored value behave sanely.
  const maxHitDice = draft.level;
  const currentHitDice = draft.hitDiceCurrent ?? maxHitDice;
  const hitDieSize = draft.hitDieSize ?? 8;
  const spendHitDie = () => {
    if (currentHitDice <= 0) return;
    rollFormula(`1d${hitDieSize} + ${abilityMod(draft.con)}`, 'Hit Die spend');
    onApply({ hitDiceCurrent: Math.max(0, currentHitDice - 1) });
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center text-sm text-slate-300 flex-wrap">
        <Heart size={14} className="text-rose-400" />
        <NumInput value={draft.hp} onChange={(v) => onApply({ hp: v })} className="w-16" />
        <span className="text-slate-500">/</span>
        <NumInput value={draft.maxHp} onChange={(v) => onApply({ maxHp: v })} className="w-16" />
        <span className="text-slate-500">HP</span>
        <span className="text-slate-500 ml-3">+</span>
        <NumInput value={draft.tempHp} onChange={(v) => onApply({ tempHp: v })} className="w-14" />
        <span className="text-slate-500">temp</span>
        {isDead && (
          <span
            className="ml-auto px-2 py-0.5 text-[10px] uppercase tracking-widest font-semibold rounded bg-rose-900/60 border border-rose-700 text-rose-100"
            title="Damage at 0 HP reached your HP maximum — your character has died (SRD instant-death rule)."
          >
            Dead
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full transition-[width,background-color] ${hpBarColor}`}
          style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }}
        />
      </div>

      {/* Hit dice — spend during short rests to heal. Long rest restores half. */}
      <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
        <Dices size={12} className="text-amber-400" />
        <span className="text-slate-500 uppercase tracking-wider text-[10px]">Hit Dice</span>
        <span className="font-mono text-slate-200">
          {currentHitDice}
          <span className="text-slate-600">/</span>
          {maxHitDice}
        </span>
        <select
          value={hitDieSize}
          onChange={(e) => onApply({ hitDieSize: parseInt(e.target.value, 10) })}
          className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-sky-700"
          title="Hit die size — usually set by your class on creation"
        >
          <option value={6}>d6</option>
          <option value={8}>d8</option>
          <option value={10}>d10</option>
          <option value={12}>d12</option>
        </select>
        <button
          onClick={spendHitDie}
          disabled={currentHitDice <= 0}
          className="ml-auto px-2 py-0.5 text-[11px] rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200"
          title={`Roll 1d${hitDieSize} + Con mod and reduce the pool by one`}
        >
          Spend
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {armorEquipped ? (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1" title="From equipped armor">
              AC <span style={{ color: 'var(--ac-400)' }}>·</span> armored
            </div>
            <div
              className="bg-slate-950 border rounded px-2 py-1 w-full text-sm font-semibold text-center"
              style={{ borderColor: 'var(--ac-700)', color: 'var(--ac-200)' }}
              title="Computed from equipped armor + DEX mod"
            >
              {effectiveAc}
            </div>
          </div>
        ) : (
          <LabeledNumber label="AC" value={draft.ac} onChange={(v) => onApply({ ac: v })} width="w-full" />
        )}
        {(() => {
          const initMod = abilityMod(draft.dex);
          return (
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1" title="From DEX modifier">
                INIT
              </div>
              <div
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm font-semibold text-slate-100 text-center font-mono"
                title="Computed from DEX mod"
              >
                {fmt(initMod)}
              </div>
            </div>
          );
        })()}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Speed</div>
          {(() => {
            const sp = effectiveSpeed(draft);
            return (
              <div
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 text-center"
                title={`${sp.base} ft ${sp.sourceLabel}${sp.penalty ? ` − ${sp.penalty} ft exhaustion` : ''}`}
              >
                <span className={sp.penalty ? 'text-amber-300 font-mono' : 'font-mono'}>{sp.effective} ft</span>
                {sp.penalty > 0 && (
                  <span className="block text-[10px] text-slate-500">
                    base {sp.base} · −{sp.penalty}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {equippedWeapons.length > 0 && (
        <div className="border-t border-slate-800 pt-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">In hand</div>
            <span className={`text-[10px] ${overHands ? 'text-rose-400 font-semibold' : 'text-slate-600'}`}>
              {handsUsed}/{handsAvailable} hands
            </span>
          </div>
          {overHands && (
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded px-2 py-1">
              <AlertTriangle size={12} className="shrink-0" />
              Too many things in hand ({handsUsed}/{handsAvailable}). Unequip one to fix.
            </div>
          )}
          <div className="space-y-1">
            {equippedWeapons.map(({ item, srd }) => {
              if (!srd?.damage) return null;
              const stats = weaponStats(draft, srd);
              const damageFormula = `${stats.damageDice}${stats.abilityMod !== 0 ? ` ${fmt(stats.abilityMod)}` : ''}`;
              const { dep, missing } = depStatus(item, inventory);
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 text-xs bg-slate-950 border rounded px-2 py-1 ${overHands ? 'flash-red' : missing ? 'hl-gold' : 'border-slate-800'}`}
                >
                  <Swords size={11} className="text-rose-400 shrink-0" />
                  <span className="text-slate-200 flex-1 truncate">{item.name}</span>
                  {missing && (
                    <span
                      className="flex items-center gap-0.5 text-[10px] text-amber-400 shrink-0"
                      title={dep ? `${dep.name} is out (quantity 0)` : 'Required item is no longer in the inventory'}
                    >
                      <AlertTriangle size={10} />
                      {dep ? 'out' : 'missing'}
                    </span>
                  )}
                  <button
                    onClick={() => rollFormula(`1d20 ${fmt(stats.attackBonus)}`, `${item.name} attack`)}
                    className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-300 font-mono"
                    title={`Roll d20 ${fmt(stats.attackBonus)}`}
                  >
                    {fmt(stats.attackBonus)}
                  </button>
                  <button
                    onClick={() => rollFormula(damageFormula, `${item.name} damage`)}
                    className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-300 font-mono"
                    title={`Roll ${damageFormula}`}
                  >
                    {damageFormula}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2 print:hidden">
        <ShortRestButton draft={draft} onApply={onApply} />
        <button
          onClick={onLongRest}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
          title="Long rest (full HP, clears temp HP and death saves)"
        >
          <BedDouble size={13} /> Long rest
        </button>
      </div>
    </div>
  );
}

// ── Death saves ─────────────────────────────────────────────────────────

function DeathSavesBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const ds = draft.deathSaves ?? DEFAULT_DEATH_SAVES;
  const togglePip = (kind: 'successes' | 'failures', i: number) => {
    // Click pip N: if it's already filled, drop count to N-1; otherwise fill up to N.
    const current = ds[kind];
    const next = current === i ? i - 1 : i;
    onApply({ deathSaves: { ...ds, [kind]: Math.max(0, Math.min(3, next)) } });
  };

  // Status reacts to the pip state: dead (3 fails) → stabilized (3 hits) →
  // dying (any rolls) → conscious (clean slate).
  const status = (() => {
    if (ds.failures >= 3)  return { label: 'Unconscious — dead', tone: 'danger',  Icon: Skull };
    if (ds.successes >= 3) return { label: 'Stabilized',          tone: 'success', Icon: HeartPulse };
    if (ds.failures > 0 || ds.successes > 0) return { label: 'Dying', tone: 'warning', Icon: HeartPulse };
    return { label: 'Conscious', tone: 'neutral', Icon: HeartPulse };
  })();

  const tones: Record<typeof status.tone, { color: string; bg: string; pulse?: string }> = {
    neutral: { color: '#64748b', bg: 'color-mix(in srgb, #64748b 12%, transparent)' },
    warning: { color: '#fb923c', bg: 'color-mix(in srgb, #fb923c 14%, transparent)', pulse: 'animate-pulse' },
    success: { color: '#34d399', bg: 'color-mix(in srgb, #34d399 14%, transparent)' },
    danger:  { color: '#f43f5e', bg: 'color-mix(in srgb, #f43f5e 16%, transparent)' },
  };
  const t = tones[status.tone];

  return (
    <div className="flex flex-col gap-4 h-full">
      <PipRow
        label="Successes"
        color="bg-emerald-500"
        filled={ds.successes}
        onClickPip={(i) => togglePip('successes', i)}
      />
      <PipRow
        label="Failures"
        color="bg-rose-500"
        filled={ds.failures}
        onClickPip={(i) => togglePip('failures', i)}
      />
          <div className="flex-1 min-h-[110px] flex flex-col items-center justify-center gap-2 mt-2 py-2 rounded" style={{ background: t.bg }}>
        <status.Icon
          size={56}
          strokeWidth={1.5}
          className={status.tone === 'warning' ? 'animate-pulse' : undefined}
          style={{ color: t.color }}
        />
        <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: t.color }}>
          {status.label}
        </div>
      </div>
    </div>
  );
}

function PipRow({
  label,
  color,
  filled,
  onClickPip,
}: {
  label: string;
  color: string;
  filled: number;
  onClickPip: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 w-20">{label}</div>
      <div className="flex gap-2">
        {[1, 2, 3].map((i) => (
          <button
            key={i}
            onClick={() => onClickPip(i)}
            className={`h-5 w-5 rounded-full border ${
              i <= filled ? `${color} border-transparent` : 'border-slate-700 hover:border-slate-500'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Ability scores ──────────────────────────────────────────────────────

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

function AbilityScoresBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ABILITIES.map((k) => {
        const score = draft[k];
        const mod = Math.floor((score - 10) / 2);
        const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
        return (
          <div key={k} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
            <NumInput
              value={score}
              onChange={(v) => onApply({ [k]: v } as Partial<PartyMember>)}
              className="w-full text-center text-lg font-semibold !border-transparent !bg-transparent !p-0"
            />
            <div className="text-[11px] text-slate-400">{modStr}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Passives ────────────────────────────────────────────────────────────

function PassivesBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const senses = [
    { label: 'Perception',    value: draft.passivePerception,    apply: (v: number) => onApply({ passivePerception: v }),    Icon: Eye,    color: '#7dd3fc' },
    { label: 'Investigation', value: draft.passiveInvestigation, apply: (v: number) => onApply({ passiveInvestigation: v }), Icon: Search, color: '#c4b5fd' },
    { label: 'Insight',       value: draft.passiveInsight,       apply: (v: number) => onApply({ passiveInsight: v }),       Icon: Brain,  color: '#fbbf24' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {senses.map(({ label, value, apply, Icon, color }) => (
        <SenseCell key={label} label={label} value={value} onChange={apply} Icon={Icon} color={color} />
      ))}
    </div>
  );
}

function SenseCell({
  label,
  value,
  onChange,
  Icon,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  Icon: typeof Eye;
  color: string;
}) {
  // Visual sense-strength bar: 0–25 mapped to 0–100% width. Most 5e
  // passives sit 8–22, so this gives a meaningful visual range.
  const pct = Math.max(0, Math.min(100, (value / 25) * 100));
  const descriptor = value >= 18 ? 'Keen' : value >= 14 ? 'Sharp' : value >= 10 ? 'Average' : 'Dull';
  return (
    <div className="flex flex-col items-center bg-slate-950 border border-slate-800 rounded p-2 gap-1.5">
      <Icon size={20} strokeWidth={1.5} style={{ color }} />
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <NumInput
        value={value}
        onChange={onChange}
        className="w-full text-center text-lg font-semibold !border-transparent !bg-transparent !p-0"
      />
      <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full transition-[width]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="text-[10px] text-slate-500">{descriptor}</div>
    </div>
  );
}

// ── Saves / skills / languages (free-text) ──────────────────────────────

function TextFieldsBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label="Languages">
        <input
          value={draft.languages}
          onChange={(e) => onApply({ languages: e.target.value })}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-700"
          placeholder="e.g. Common, Elvish, Thieves' Cant"
        />
      </Field>
      <Field label="Saves (free-text)">
        <input
          value={draft.saves}
          onChange={(e) => onApply({ saves: e.target.value })}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-700"
          placeholder="Anything extra not covered above"
        />
      </Field>
      <Field label="Skills (free-text)">
        <input
          value={draft.skills}
          onChange={(e) => onApply({ skills: e.target.value })}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-700"
          placeholder="Expertise, tool proficiencies, situational bonuses…"
        />
      </Field>
    </div>
  );
}

// ── Skills & Saves (structured + dice integration) ────────────────────────

/** A single row in the Skills or Saves panel: pip + label + ability tag + clickable mod. */
function ProfRow({
  label,
  abilityTag,
  mod,
  profOn,
  onTogglePip,
  onRoll,
}: {
  label: string;
  abilityTag: string;
  mod: number;
  profOn: boolean;
  onTogglePip: () => void;
  onRoll: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <button
        onClick={onTogglePip}
        title={profOn ? 'Proficient — click to remove' : 'Not proficient — click to add'}
        className={`h-3 w-3 rounded-full border-2 shrink-0 transition-colors ${
          profOn ? 'border-transparent' : 'border-slate-600 hover:border-slate-400'
        }`}
        style={profOn ? { background: 'var(--ac-400)' } : undefined}
      />
      <span className="text-sm text-slate-200 flex-1 truncate">
        {label}
        <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-1.5">
          {abilityTag}
        </span>
      </span>
      <button
        onClick={onRoll}
        title={`Roll 1d20 ${fmt(mod)}`}
        className="text-sm font-mono font-medium px-2 py-0.5 rounded hover:bg-slate-800 text-slate-100 flex items-center gap-1 print:hover:bg-transparent"
      >
        <Dices size={11} className="text-slate-500 print:hidden" />
        {fmt(mod)}
      </button>
    </div>
  );
}

function SkillsBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const profs = draft.skillProfs ?? [];
  const pb = profBonus(draft.level);
  const rollFormula = useQuickDice((s) => s.rollFormula);

  const toggle = (key: string) => {
    const set = new Set(profs);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onApply({ skillProfs: [...set] });
  };

  // 2024 exhaustion penalty: every D20 test is reduced by 2 per level.
  const exhPenalty = exhaustionD20Penalty(draft);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      {SKILLS.map(({ key, label, ability }) => {
        const prof = profs.includes(key);
        const mod = abilityMod(draft[ability]) + (prof ? pb : 0) + exhPenalty;
        return (
          <ProfRow
            key={key}
            label={label}
            abilityTag={ability}
            mod={mod}
            profOn={prof}
            onTogglePip={() => toggle(key)}
            onRoll={() => rollFormula(`1d20 ${fmt(mod)}`, label)}
          />
        );
      })}
    </div>
  );
}

function SavesBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const profs = draft.saveProfs ?? [];
  const pb = profBonus(draft.level);
  const rollFormula = useQuickDice((s) => s.rollFormula);

  const toggle = (a: Ability) => {
    const set = new Set(profs);
    if (set.has(a)) set.delete(a);
    else set.add(a);
    onApply({ saveProfs: [...set] });
  };

  const exhPenalty = exhaustionD20Penalty(draft);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
      {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]).map((a) => {
        const prof = profs.includes(a);
        const mod = abilityMod(draft[a]) + (prof ? pb : 0) + exhPenalty;
        return (
          <ProfRow
            key={a}
            label={ABILITY_LABEL[a]}
            abilityTag={a}
            mod={mod}
            profOn={prof}
            onTogglePip={() => toggle(a)}
            onRoll={() => rollFormula(`1d20 ${fmt(mod)}`, `${ABILITY_LABEL[a]} save`)}
          />
        );
      })}
    </div>
  );
}

// ── Short rest popover (spends a hit die) ─────────────────────────────────

function ShortRestButton({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lastHeal, setLastHeal] = useState<{ amount: number; die: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rollFormula = useQuickDice((s) => s.rollFormula);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    return () => window.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const spend = (sides: number) => {
    const rolled = Math.floor(Math.random() * sides) + 1;
    const conMod = abilityMod(draft.con);
    // Min 1 HP — a Con modifier of -1 with a roll of 1 still heals 1.
    const heal = Math.max(1, rolled + conMod);
    const newHp = Math.min(draft.maxHp, draft.hp + heal);
    onApply({
      hp: newHp,
      deathSaves: { ...DEFAULT_DEATH_SAVES },
    });
    setLastHeal({ amount: newHp - draft.hp, die: sides });
    setOpen(false);
    // Mirror the roll into QuickDice for a visible record.
    rollFormula(`1d${sides} ${fmt(conMod)}`, `Short rest (d${sides})`);
  };

  return (
    <div ref={wrapRef} className="relative flex-1">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Short rest — spend a hit die"
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
      >
        <Coffee size={13} /> Short rest
      </button>
      {lastHeal && !open && (
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-emerald-300 whitespace-nowrap pointer-events-none">
          +{lastHeal.amount} HP (d{lastHeal.die})
        </div>
      )}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 right-0 z-30 bg-slate-900 border border-slate-700 rounded-md shadow-xl p-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 text-center">
            Spend a hit die
          </div>
          <div className="grid grid-cols-5 gap-1">
            {[6, 8, 10, 12, 4].map((s) => (
              <button
                key={s}
                onClick={() => spend(s)}
                className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
              >
                d{s}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 text-center">
            + CON mod ({fmt(abilityMod(draft.con))})
          </div>
        </div>
      )}
    </div>
  );
}

// ── Gold ────────────────────────────────────────────────────────────────

const COIN_LABELS: { key: keyof import('../party/partyStore').Gold; label: string; color: string }[] = [
  { key: 'pp', label: 'PP', color: '#cbd5e1' },
  { key: 'gp', label: 'GP', color: '#fbbf24' },
  { key: 'ep', label: 'EP', color: '#a3e635' },
  { key: 'sp', label: 'SP', color: '#94a3b8' },
  { key: 'cp', label: 'CP', color: '#fb923c' },
];

/** Re-express a purse into the fewest coins that preserve its total value,
 *  using the campaign's (possibly house-ruled) per-coin copper values. Coins
 *  are filled high→low; any sub-unit remainder lands in the lowest-value coin
 *  (a no-op in the standard config where cp = 1cp). */
function consolidateGold(gold: Gold, rates: CoinRates): Gold {
  const totalCp = COIN_KEYS.reduce((sum, k) => sum + (gold[k] || 0) * (rates[k] || 0), 0);
  const out: Gold = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
  const ordered = COIN_KEYS.filter((k) => (rates[k] || 0) > 0).sort((a, b) => rates[b] - rates[a]);
  let remaining = totalCp;
  for (const k of ordered) {
    const n = Math.floor(remaining / rates[k]);
    out[k] = n;
    remaining -= n * rates[k];
  }
  if (remaining > 0 && ordered.length) out[ordered[ordered.length - 1]] += remaining;
  return out;
}

function GoldBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const gold = draft.gold ?? DEFAULT_GOLD;
  const rates = useCampaignSettings((s) => s.settings.coinRates ?? DEFAULT_COIN_RATES);
  const totalCp = COIN_KEYS.reduce((sum, k) => sum + (gold[k] || 0) * (rates[k] || 0), 0);
  const totalGp = (rates.gp ?? 0) > 0 ? totalCp / rates.gp : 0;
  const consolidated = consolidateGold(gold, rates);
  const canConsolidate = COIN_KEYS.some((k) => consolidated[k] !== gold[k]);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-2">
        {COIN_LABELS.map(({ key, label, color }) => (
          <div key={key} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>
              {label}
            </div>
            <NumInput
              value={gold[key]}
              onChange={(v) => onApply({ gold: { ...gold, [key]: v } })}
              className="w-full text-center !border-transparent !bg-transparent !p-0 text-sm"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          Total ≈ <span className="text-amber-300 font-mono">{totalGp.toFixed(2)}</span> gp
        </span>
        <button
          onClick={() => onApply({ gold: consolidated })}
          disabled={!canConsolidate}
          title="Convert coins into the fewest denominations at the campaign's rates"
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:hover:bg-slate-800"
        >
          Consolidate
        </button>
      </div>
    </div>
  );
}

// ── Encumbrance ─────────────────────────────────────────────────────────

/** Total carried weight from resolvable SRD item weights × quantity. Custom
 *  items and spells carry no weight data and count as 0. */
function carriedWeight(inventory: InventoryItem[], edition: SrdEdition): number {
  return inventory.reduce((sum, it) => {
    const w = srdItemFor(it, edition)?.weight ?? 0;
    return sum + w * (it.qty || 0);
  }, 0);
}

/** Read-only carry-weight panel. Only rendered when the campaign has
 *  encumbrance enabled (otherwise capacity is unlimited and there's nothing to
 *  track). Capacity is the 5e STR × 15 lb carrying capacity. */
function EncumbranceBlock({ draft }: { draft: PartyMember }) {
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const weight = carriedWeight(draft.inventory ?? [], edition);
  const capacity = (draft.str ?? 10) * 15;
  const over = weight > capacity;
  const pct = capacity > 0 ? Math.min(100, (weight / capacity) * 100) : 0;
  const fmtW = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-mono text-slate-100">
            {fmtW(weight)}<span className="text-sm text-slate-500"> lb</span>
          </div>
          <div className="text-[11px] text-slate-500">Carried</div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-mono ${over ? 'text-rose-400' : 'text-slate-300'}`}>/ {capacity} lb</div>
          <div className="text-[11px] text-slate-500">Capacity · STR × 15</div>
        </div>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${over ? 'bg-rose-600' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <div className="text-[11px] text-rose-400 flex items-center gap-1">
          <AlertTriangle size={11} /> Over capacity — encumbered.
        </div>
      )}
      <div className="text-[10px] text-slate-600">Computed from item weights; not editable.</div>
    </div>
  );
}

// ── Layout primitives ───────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  // h-full + flex-col so a card that lives next to a taller sibling in the
  // grid stretches its body to fill the row height — Death saves no longer
  // leaves whitespace next to Vitals.
  return (
    <section className={`bg-slate-900 border border-slate-800 rounded-lg p-4 h-full flex flex-col ${className}`}>
      <div className="flex items-baseline justify-between mb-3 shrink-0">
        <h2 className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{title}</h2>
        {subtitle && <span className="text-[10px] text-slate-600">{subtitle}</span>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

/**
 * Renders next to the XP field in the header. Three states:
 *   1. Below threshold → muted "X to N" hint
 *   2. At/above threshold → highlighted "Level up to N" button
 *   3. Level 20 → "Max level"
 * Click bumps `level` by 1. HP, slot, and feature changes stay manual — those
 * arrive in phase 4 once class data is parsed.
 */
function LevelUpControl({
  xp,
  level,
  onLevelUp,
}: {
  xp: number;
  level: number;
  onLevelUp: () => void;
}) {
  const p = xpProgress(xp, level);
  if (p.atMax) {
    return (
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Next</div>
        <div className="px-3 py-1 rounded border border-slate-800 bg-slate-950 text-xs text-slate-500 italic flex items-center h-[34px]">
          Max level
        </div>
      </div>
    );
  }
  if (p.eligible) {
    return (
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1">Ready!</div>
        <button
          onClick={onLevelUp}
          className="px-3 py-1 rounded border border-amber-600/60 bg-amber-900/30 hover:bg-amber-800/40 text-amber-200 text-xs font-medium flex items-center gap-1.5 h-[34px]"
          title={`You have enough XP to advance — click to bump level to ${p.nextLevel}.`}
        >
          <ChevronUp size={13} />
          Level up to {p.nextLevel}
        </button>
      </div>
    );
  }
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Next</div>
      <div
        className="px-3 py-1 rounded border border-slate-800 bg-slate-950 text-xs text-slate-400 flex items-center gap-2 h-[34px]"
        title={`${p.remaining.toLocaleString()} XP until level ${p.nextLevel} (need ${p.needed.toLocaleString()} this level)`}
      >
        <span className="font-mono">{p.remaining.toLocaleString()}</span>
        <span className="text-slate-600">→ {p.nextLevel}</span>
      </div>
    </div>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
  width = 'w-20',
  showSign = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  width?: string;
  showSign?: boolean;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className={`bg-slate-950 border border-slate-700 rounded px-2 py-1 ${width} flex items-center justify-center text-sm text-slate-100`}>
        {showSign && value >= 0 && <span className="text-slate-500 text-xs mr-0.5">+</span>}
        <NumInput value={value} onChange={onChange} className="w-full text-center !border-transparent !bg-transparent !p-0" />
      </div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  className = '',
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseInt(e.target.value || '0', 10))}
      className={`bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-700 ${className}`}
    />
  );
}

// ── Inventory ──────────────────────────────────────────────────────────────

/** Per-edition lookup tables keyed by SRD index. Built lazily and cached so
 *  weapon stats can be computed on render without scanning the SRD arrays each
 *  row. The union is laid down first; the current edition's entries overwrite
 *  so a saved item still resolves if the campaign switched editions, and the
 *  preferred edition wins whenever both exist. */
const equipmentIdxCache: Partial<Record<SrdEdition, Record<string, EquipmentItem>>> = {};
const spellsIdxCache: Partial<Record<SrdEdition, Record<string, Spell>>> = {};

function getEquipmentIdx(edition: SrdEdition): Record<string, EquipmentItem> {
  if (!equipmentIdxCache[edition]) {
    const idx: Record<string, EquipmentItem> = {};
    for (const e of EQUIPMENT) idx[e.index] = e;
    for (const e of equipmentFor(edition)) idx[e.index] = e;
    equipmentIdxCache[edition] = idx;
  }
  return equipmentIdxCache[edition]!;
}
function getSpellsIdx(edition: SrdEdition): Record<string, Spell> {
  if (!spellsIdxCache[edition]) {
    const idx: Record<string, Spell> = {};
    for (const s of SPELLS) idx[s.index] = s;
    for (const s of spellsFor(edition)) idx[s.index] = s;
    spellsIdxCache[edition] = idx;
  }
  return spellsIdxCache[edition]!;
}

/** Try to resolve an inventory item's underlying SRD record so we can derive
 *  attack/damage info. Returns null for non-SRD (homebrew) entries. */
function srdItemFor(item: InventoryItem, edition: SrdEdition): EquipmentItem | null {
  if (item.sourceKind === 'srd-item' && item.sourceId) {
    return getEquipmentIdx(edition)[item.sourceId] ?? null;
  }
  return null;
}

/** How many hands wielding this item occupies: a two-handed weapon takes 2, a
 *  shield or any other weapon takes 1, and everything else (armor, gear,
 *  spells, or items we can't resolve to an SRD weapon) takes 0. Drives the
 *  inventory over-equip guard. */
function handsForItem(item: InventoryItem, edition: SrdEdition): number {
  const srd = srdItemFor(item, edition);
  if (!srd) return 0;
  if (srd.armor_category === 'Shield') return 1;
  const isWeapon = !!srd.weapon_category || !!srd.damage;
  if (!isWeapon) return 0;
  const props = (srd.properties ?? []).map((p) => p.name.toLowerCase());
  return props.includes('two-handed') ? 2 : 1;
}

/** Resolve an item's declared dependency against the current inventory and flag
 *  when it's gone (removed) or out (quantity 0). */
function depStatus(item: InventoryItem, inventory: InventoryItem[]): { dep?: InventoryItem; missing: boolean } {
  const dep = item.dependsOn ? inventory.find((i) => i.id === item.dependsOn) : undefined;
  const missing = !!item.dependsOn && (!dep || dep.qty <= 0);
  return { dep, missing };
}
function srdSpellFor(item: InventoryItem, edition: SrdEdition): Spell | null {
  if (item.sourceKind === 'srd-spell' && item.sourceId) {
    return getSpellsIdx(edition)[item.sourceId] ?? null;
  }
  return null;
}

/** Weapon attack/damage computation, using the character's ability mods + PB.
 *  Assumes the character is proficient with the weapon — a Phase B
 *  per-weapon proficiency toggle could refine this. */
function weaponStats(member: PartyMember, weapon: EquipmentItem) {
  const props = (weapon.properties ?? []).map((p) => p.name.toLowerCase());
  const isFinesse = props.includes('finesse');
  const isRanged = weapon.weapon_range === 'Ranged';
  const strMod = abilityMod(member.str);
  const dexMod = abilityMod(member.dex);
  // Ranged → DEX; Finesse → better of STR/DEX; otherwise STR.
  const ability: 'str' | 'dex' = isRanged
    ? 'dex'
    : isFinesse
    ? (dexMod > strMod ? 'dex' : 'str')
    : 'str';
  const mod = ability === 'dex' ? dexMod : strMod;
  const pb = profBonus(member.level);
  return {
    ability,
    // Exhaustion subtracts from the attack roll (an attack is a D20 test).
    attackBonus: mod + pb + exhaustionD20Penalty(member),
    abilityMod: mod,
    damageDice: weapon.damage?.damage_dice ?? '',
    damageType: weapon.damage?.damage_type?.name ?? '',
    versatileDice: weapon.two_handed_damage?.damage_dice ?? '',
  };
}

function InventoryBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const inventory = draft.inventory ?? [];
  const rollFormula = useQuickDice((s) => s.rollFormula);
  const edition = useCampaignSettings((s) => s.settings.srdEdition);

  const handsAvailable = draft.hands ?? 2;
  const handsUsed = inventory
    .filter((i) => i.equipped)
    .reduce((s, i) => s + handsForItem(i, edition), 0);
  const overHands = handsUsed > handsAvailable;

  const add = (entry: { sourceKind: InventoryItem['sourceKind']; sourceId?: string; name: string }) => {
    const next: InventoryItem = {
      id: crypto.randomUUID(),
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      name: entry.name,
      qty: 1,
      equipped: false,
    };
    onApply({ inventory: [...inventory, next] });
  };

  const update = (id: string, patch: Partial<InventoryItem>) => {
    onApply({
      inventory: inventory.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  };

  const remove = (id: string) => {
    onApply({ inventory: inventory.filter((it) => it.id !== id) });
  };

  return (
    <div className="space-y-2">
      <InventoryPicker onAdd={add} />

      <div className={`flex items-center justify-between text-[11px] ${overHands ? 'text-rose-300' : 'text-slate-500'}`}>
        <label className="flex items-center gap-1.5" title="Weapons/shields you can wield at once">
          <span>Hands</span>
          <input
            type="number"
            min={0}
            value={handsAvailable}
            onChange={(e) => onApply({ hands: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
            className="w-11 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center font-mono text-slate-200"
          />
        </label>
        <span className={overHands ? 'text-rose-400 font-semibold' : ''}>
          {handsUsed}/{handsAvailable} in use
        </span>
      </div>
      {overHands && (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded px-2 py-1">
          <AlertTriangle size={12} className="shrink-0" />
          Too many weapons/shields equipped for {handsAvailable} hand{handsAvailable === 1 ? '' : 's'} ({handsUsed} in use). Unequip a highlighted item or raise the hand count.
        </div>
      )}

      {inventory.length === 0 ? (
        <div className="text-sm text-slate-500 italic py-2">
          No items yet. Use the search above to add weapons, gear, magic items, or known spells.
        </div>
      ) : (
        <div className="space-y-1.5">
          {inventory.map((item) => (
            // Every inventory row now ships with the printed sheet — the PDF
            // is the player's reference, so a complete loadout (including
            // unequipped reserves, packs, and consumables) needs to be on it.
            <div key={item.id}>
              <InventoryRow
                item={item}
                member={draft}
                flash={overHands && item.equipped && handsForItem(item, edition) > 0}
                onChange={(patch) => update(item.id, patch)}
                onRemove={() => remove(item.id)}
                onRollAttack={(label, bonus) => rollFormula(`1d20 ${fmt(bonus)}`, label)}
                onRollDamage={(label, formula) => rollFormula(formula, label)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryRow({
  item,
  member,
  flash,
  onChange,
  onRemove,
  onRollAttack,
  onRollDamage,
}: {
  item: InventoryItem;
  member: PartyMember;
  flash?: boolean;
  onChange: (patch: Partial<InventoryItem>) => void;
  onRemove: () => void;
  onRollAttack: (label: string, bonus: number) => void;
  onRollDamage: (label: string, formula: string) => void;
}) {
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const srdItem = srdItemFor(item, edition);
  const isWeapon = !!srdItem?.damage;
  const isArmor = srdItem?.armor_class != null;
  const srdSpell = srdSpellFor(item, edition);
  const isSpell = !!srdSpell || item.sourceKind === 'spell' || item.sourceKind === 'srd-spell';
  // Resolve a magic-item entry too — equipment-only lookups don't catch
  // wondrous items, rings, etc., so the click-to-expand description still works.
  const srdMagic = useMemo(() => {
    if (item.sourceKind !== 'srd-item' || !item.sourceId) return null;
    return MAGIC_ITEMS.find((m) => m.index === item.sourceId) ?? null;
  }, [item.sourceKind, item.sourceId]);
  // Any kind of SRD backing — desc paragraphs, weapon damage line, armor
  // class line, cost/weight stats — means the row has *something* worth
  // expanding to. Plain custom items without an SRD link stay collapsed.
  const hasDetails = !!srdItem || !!srdMagic || !!srdSpell;
  const [showDesc, setShowDesc] = useState(false);

  let KindIcon = Backpack;
  let kindColor = '#94a3b8';
  if (isWeapon) { KindIcon = Swords; kindColor = '#f87171'; }
  else if (isArmor) { KindIcon = ShieldIcon; kindColor = '#60a5fa'; }
  else if (isSpell) { KindIcon = Sparkles; kindColor = '#c4b5fd'; }
  else if (srdMagic) { KindIcon = Sparkles; kindColor = '#c4b5fd'; }

  // Icon resolution: an explicit per-row override wins; otherwise fall back to
  // the icon the homebrew item was authored with, then the kind-derived icon.
  const homebrewIconKey = useSharedHomebrew((s) => {
    if (item.sourceKind !== 'item' || !item.sourceId) return undefined;
    const row = s.items.find((r) => r.id === item.sourceId);
    return (row?.data as Record<string, unknown> | undefined)?.icon as string | undefined;
  });
  const HomebrewIcon = iconByKey(homebrewIconKey);
  const FallbackIcon = HomebrewIcon ?? KindIcon;
  const fallbackColor = HomebrewIcon ? '#94a3b8' : kindColor;

  // A short type label so non-weapon / non-spell rows still say what they are.
  const typeLabel = srdMagic
    ? `${srdMagic.equipment_category.name} · ${srdMagic.rarity.name}`
    : isArmor && srdItem
    ? `${srdItem.armor_category ?? 'Armor'}${srdItem.armor_category === 'Shield' ? '' : ' armor'}`
    : srdItem
    ? srdItem.equipment_category.name
    : item.sourceKind === 'item'
    ? 'Homebrew item'
    : '';

  const stats = isWeapon && srdItem ? weaponStats(member, srdItem) : null;
  const damageFormula = stats?.damageDice
    ? `${stats.damageDice}${stats.abilityMod !== 0 ? ` ${fmt(stats.abilityMod)}` : ''}`
    : '';

  // Item dependency (e.g. a bow needs arrows): resolve the linked item and flag
  // when it's gone from the inventory or down to 0.
  const otherItems = (member.inventory ?? []).filter((i) => i.id !== item.id);
  const { dep, missing: depMissing } = depStatus(item, member.inventory ?? []);

  return (
    <div className={`bg-slate-950 border rounded ${flash ? 'flash-red' : depMissing ? 'hl-gold' : 'border-slate-800'}`}>
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="print:hidden">
        <IconPicker
          value={item.icon}
          onChange={(key) => onChange({ icon: key })}
          fallback={FallbackIcon}
          fallbackColor={fallbackColor}
          size={14}
          title="Item icon"
        />
      </div>
      {(() => {
        // Print gets a plain resolved icon, no picker chrome.
        const PrintIcon = iconByKey(item.icon) ?? FallbackIcon;
        return <PrintIcon size={14} style={{ color: fallbackColor }} className="shrink-0 hidden print:block" />;
      })()}

      <div className="min-w-0 flex-1">
        <button
          onClick={() => hasDetails && setShowDesc((v) => !v)}
          disabled={!hasDetails}
          className={`block w-full text-left text-sm text-slate-100 truncate ${hasDetails ? 'hover:text-sky-200 cursor-pointer' : 'cursor-text'}`}
          title={hasDetails ? 'Click to view details' : undefined}
        >
          {item.name}
        </button>
        {stats && (
          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3">
            <button
              onClick={() => onRollAttack(`${item.name} attack`, stats.attackBonus)}
              className="hover:text-slate-200 flex items-center gap-1 print:hover:text-slate-500"
              title={`Roll d20 ${fmt(stats.attackBonus)}`}
            >
              <span className="text-slate-600">ATK</span>
              <span className="font-mono text-slate-300">{fmt(stats.attackBonus)}</span>
              <Dices size={10} className="text-slate-600 print:hidden" />
            </button>
            <button
              onClick={() => onRollDamage(`${item.name} damage`, damageFormula)}
              className="hover:text-slate-200 flex items-center gap-1 print:hover:text-slate-500"
              title={`Roll ${damageFormula}`}
            >
              <span className="text-slate-600">DMG</span>
              <span className="font-mono text-slate-300">{damageFormula}</span>
              <Dices size={10} className="text-slate-600 print:hidden" />
            </button>
            {stats.damageType && (
              <span className="text-slate-600">{stats.damageType.toLowerCase()}</span>
            )}
            {stats.versatileDice && (
              <span className="text-slate-600">(2h {stats.versatileDice})</span>
            )}
            <span className="text-slate-700">·</span>
            <span className="text-slate-600 uppercase tracking-wider">{stats.ability}</span>
          </div>
        )}
        {!stats && srdSpell && (
          <div className="text-[11px] text-slate-500">
            {srdSpell.level === 0 ? 'Cantrip' : `Lv ${srdSpell.level}`} · {srdSpell.school.name}
          </div>
        )}
        {!stats && !srdSpell && typeLabel && (
          <div className="text-[11px] text-slate-500">{typeLabel}</div>
        )}
        {/* Dependency picker — shown once a link is set or the row is expanded,
            so rows without dependencies stay uncluttered. */}
        {(showDesc || item.dependsOn) && otherItems.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] mt-0.5 text-slate-600 print:hidden">
            <LinkIcon size={9} className="shrink-0" />
            <select
              value={item.dependsOn ?? ''}
              onChange={(e) => onChange({ dependsOn: e.target.value || undefined })}
              className="bg-transparent text-slate-500 outline-none max-w-[10rem] truncate hover:text-slate-300"
              title="Require another item (e.g. ammunition)"
            >
              <option value="">no dependency</option>
              {otherItems.map((o) => (
                <option key={o.id} value={o.id}>needs {o.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {depMissing && (
          <span
            className="flex items-center gap-0.5 text-[10px] text-amber-400"
            title={dep ? `${dep.name} is out (quantity 0)` : 'Required item is no longer in the inventory'}
          >
            <AlertTriangle size={11} />
            {dep ? 'out' : 'missing'}
          </span>
        )}
        <input
          type="number"
          value={item.qty}
          onChange={(e) => onChange({ qty: Math.max(0, parseInt(e.target.value || '0', 10)) })}
          className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-center text-slate-100 focus:outline-none focus:border-sky-700"
          title="Quantity"
        />
        {(isWeapon || isArmor) && (
          <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={item.equipped}
              onChange={(e) => onChange({ equipped: e.target.checked })}
              className="accent-sky-500"
            />
            equip
          </label>
        )}
        <button
          onClick={onRemove}
          title="Remove"
          className="p-1 text-slate-600 hover:text-rose-300 print:hidden"
        >
          <XIcon size={12} />
        </button>
      </div>
    </div>

    {/* Expandable SRD details — always shows something for any SRD-backed
        row. Basic items (Longsword, Plate, Backpack) get a stats line even
        when there's no desc[]; magic items + spells render their full text. */}
    {showDesc && hasDetails && (
      // Inline srd-popover so the inventory description matches the spell +
      // feat boxes. Strip the popover's own border/shadow/rounded-corners
      // since it's nested inside the row's own bordered card.
      <div
        className="srd-popover"
        style={{ maxHeight: 'none', margin: 0, borderRadius: 0, borderWidth: 0, borderTopWidth: 1, borderTopColor: '#1e293b', boxShadow: 'none' }}
      >
        <div className="srd-popover-header">
          <div className="srd-popover-sub">
            {srdSpell && (
              <>
                {srdSpell.level === 0 ? 'Cantrip' : `Level ${srdSpell.level}`} {srdSpell.school.name.toLowerCase()}
                {srdSpell.ritual && ' · ritual'}
                {srdSpell.concentration && ' · concentration'}
              </>
            )}
            {srdMagic && !srdSpell && (
              <>{srdMagic.equipment_category.name} · {srdMagic.rarity.name}</>
            )}
            {srdItem && !srdMagic && !srdSpell && (
              <>
                {srdItem.equipment_category.name}
                {srdItem.weapon_category && ` · ${srdItem.weapon_category} ${srdItem.weapon_range ?? ''}`}
                {srdItem.armor_category && ` · ${srdItem.armor_category} armor`}
              </>
            )}
          </div>
        </div>
        {srdItem && !srdMagic && !srdSpell && (
          <div className="srd-popover-stats">
            {srdItem.cost && (
              <div><span className="srd-popover-stat-label">Cost</span>{srdItem.cost.quantity} {srdItem.cost.unit}</div>
            )}
            {srdItem.weight !== undefined && (
              <div><span className="srd-popover-stat-label">Weight</span>{srdItem.weight} lb</div>
            )}
            {srdItem.damage && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="srd-popover-stat-label">Damage</span>
                {srdItem.damage.damage_dice} {srdItem.damage.damage_type.name.toLowerCase()}
                {srdItem.two_handed_damage && ` · 2h ${srdItem.two_handed_damage.damage_dice}`}
              </div>
            )}
            {srdItem.armor_class && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="srd-popover-stat-label">AC</span>
                {srdItem.armor_class.base}
                {srdItem.armor_class.dex_bonus && ' + Dex'}
                {srdItem.armor_class.max_bonus && ` (max +${srdItem.armor_class.max_bonus})`}
              </div>
            )}
            {srdItem.range && (srdItem.range.normal || srdItem.range.long) && (
              <div><span className="srd-popover-stat-label">Range</span>{srdItem.range.normal}/{srdItem.range.long} ft</div>
            )}
            {srdItem.str_minimum && srdItem.str_minimum > 0 && (
              <div><span className="srd-popover-stat-label">Str min</span>{srdItem.str_minimum}</div>
            )}
            {srdItem.properties && srdItem.properties.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="srd-popover-stat-label">Properties</span>
                {srdItem.properties.map((p) => p.name).join(', ')}
              </div>
            )}
            {srdItem.stealth_disadvantage && (
              <div style={{ gridColumn: '1 / -1', color: '#fcd34d' }}>Stealth disadvantage</div>
            )}
          </div>
        )}
        <div className="srd-popover-body markdown-body" style={{ overflowY: 'visible' }}>
          {srdSpell?.desc && (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{srdSpell.desc.join('\n\n')}</ReactMarkdown>
          )}
          {srdMagic?.desc?.map((p, i) => (
            <ReactMarkdown key={`m${i}`} remarkPlugins={[remarkGfm]}>{p}</ReactMarkdown>
          ))}
          {!srdSpell && !srdMagic && srdItem?.desc?.map((p, i) => <p key={`i${i}`}>{p}</p>)}
          {!srdSpell && !srdMagic && (!srdItem?.desc || srdItem.desc.length === 0) && (
            <div className="text-[11px] text-slate-600 italic">No additional description in the SRD.</div>
          )}
        </div>
      </div>
    )}
    </div>
  );
}

function InventoryPicker({
  onAdd,
}: {
  onAdd: (entry: { sourceKind: InventoryItem['sourceKind']; sourceId?: string; name: string }) => void;
}) {
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Filter to only equippable / castable kinds — drop notes / npcs from the
  // inventory picker since you don't carry them in a backpack.
  // Spells now live in the Spellbook card, not the inventory list.
  const itemsOnly = useMemo(
    () => catalog.filter((e) => e.kind === 'item' || e.kind === 'srd-item'),
    [catalog]
  );
  const results = useMemo(() => searchCatalog(itemsOnly, query, 10), [itemsOnly, query]);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    return () => window.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const pick = (e: CatalogEntry) => {
    // CatalogEntry.id is `<kind>:<identifier>` — split it back out.
    const colon = e.id.indexOf(':');
    const identifier = colon >= 0 ? e.id.slice(colon + 1) : e.id;
    onAdd({
      sourceKind: e.kind as InventoryItem['sourceKind'],
      sourceId: identifier,
      name: e.name,
    });
    setQuery('');
    setOpen(false);
  };

  const addCustom = () => {
    const name = query.trim();
    if (!name) return;
    onAdd({ sourceKind: 'custom', name });
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative print:hidden">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search items, magic items, spells…"
            className="w-full bg-slate-950 border border-slate-700 rounded pl-7 pr-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700"
          />
        </div>
        <button
          onClick={addCustom}
          disabled={!query.trim()}
          title="Add as custom item"
          className="px-2 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 flex items-center gap-1"
        >
          <Plus size={12} /> Custom
        </button>
      </div>
      {open && (query.trim() || results.length > 0) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">
              No catalog match. Click "Custom" to add "{query.trim()}".
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2"
              >
                <KindIconFor kind={r.kind} />
                <span className="flex-1 truncate">{r.name}</span>
                {r.hint && <span className="text-[10px] text-slate-500 shrink-0">{r.hint}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function KindIconFor({ kind }: { kind: CatalogEntry['kind'] }) {
  if (kind === 'spell' || kind === 'srd-spell') return <Sparkles size={12} className="text-violet-300" />;
  return <Backpack size={12} className="text-slate-500" />;
}

// ── Spellbook ─────────────────────────────────────────────────────────────

const SPELL_ABILITIES: { key: 'int' | 'wis' | 'cha'; label: string }[] = [
  { key: 'int', label: 'INT' },
  { key: 'wis', label: 'WIS' },
  { key: 'cha', label: 'CHA' },
];

function SpellbookBlock({
  draft,
  onApply,
}: {
  draft: PartyMember;
  onApply: (p: Partial<PartyMember>) => void;
}) {
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const ability = draft.spellAbility ?? null;
  const pb = profBonus(draft.level);
  const abilMod = ability ? abilityMod(draft[ability]) : 0;
  const spellAttack = abilMod + pb;
  const spellDc = 8 + abilMod + pb;

  const slots: SpellSlots = draft.spellSlots ?? DEFAULT_SPELL_SLOTS.map((s) => ({ ...s }));
  const spells = draft.spells ?? [];

  const setAbility = (a: 'int' | 'wis' | 'cha' | null) => onApply({ spellAbility: a });
  const setSlotMax = (level: number, max: number) => {
    const next = slots.map((s) => ({ ...s }));
    next[level] = { max: Math.max(0, max), current: Math.min(next[level].current, Math.max(0, max)) };
    onApply({ spellSlots: next });
  };
  const toggleSlotPip = (level: number, idx: number) => {
    const next = slots.map((s) => ({ ...s }));
    const slot = next[level];
    // Pips fill left → right when full; clicking the rightmost-filled pip
    // expends it. Clicking past current fills back up (e.g., to undo).
    const isFilled = idx < slot.current;
    if (isFilled) slot.current = idx;       // expend down to (idx) remaining
    else slot.current = Math.min(slot.max, idx + 1); // fill up to idx+1
    next[level] = { ...slot };
    onApply({ spellSlots: next });
  };

  return (
    <div className="space-y-4">
      {/* Casting ability + computed mods */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">Casting ability</div>
        <div className="flex gap-1">
          {SPELL_ABILITIES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setAbility(ability === key ? null : key)}
              className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded border ${
                ability === key
                  ? 'border-transparent text-slate-950'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
              }`}
              style={ability === key ? { background: 'var(--ac-400)' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-slate-500">
            Spell atk <span className="text-slate-200 font-mono">{ability ? fmt(spellAttack) : '—'}</span>
          </span>
          <span className="text-slate-500">
            Save DC <span className="text-slate-200 font-mono">{ability ? spellDc : '—'}</span>
          </span>
        </div>
      </div>

      {/* Picker — adding a spell drops it under its level row below. */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Known &amp; prepared</div>
        <SpellPicker
          onAdd={(entry) => {
            const next: KnownSpell = {
              id: crypto.randomUUID(),
              sourceKind: entry.sourceKind,
              sourceId: entry.sourceId,
              name: entry.name,
              prepared: false,
            };
            onApply({ spells: [...spells, next] });
          }}
        />
      </div>

      {/* Slot pips per level — each row now owns the known spells at its
          level, rendered as a compact list right under the pips. Cantrips
          have no slot so they get their own block above the slot grid. */}
      {(() => {
        const byLevel = new Map<number, KnownSpell[]>();
        for (const sp of spells) {
          const lv = spellLevelFor(sp, edition);
          if (!byLevel.has(lv)) byLevel.set(lv, []);
          byLevel.get(lv)!.push(sp);
        }
        const cantrips = byLevel.get(0) ?? [];
        const onSpellChange = (id: string, patch: Partial<KnownSpell>) =>
          onApply({ spells: spells.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
        const onSpellRemove = (id: string) =>
          onApply({ spells: spells.filter((s) => s.id !== id) });
        const renderSpells = (group: KnownSpell[]) =>
          group.length > 0 && (
            <div className="mt-1 ml-[4.25rem] space-y-1">
              {group.map((sp) => (
                <SpellRow
                  key={sp.id}
                  spell={sp}
                  spellAttack={ability ? spellAttack : null}
                  spellDc={ability ? spellDc : null}
                  onChange={(patch) => onSpellChange(sp.id, patch)}
                  onRemove={() => onSpellRemove(sp.id)}
                />
              ))}
            </div>
          );
        return (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Spell slots</div>
            <div className="space-y-2">
              {/* Cantrips share the level-row layout (no pips, no max input)
                  so the "CANTRIPS" label aligns under the "LV N" column. */}
              <div>
                <div className="flex items-center gap-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 w-14 shrink-0 font-mono">
                    Cantrips
                  </div>
                  <div className="flex gap-1 flex-1 min-w-0">
                    <span className="text-[11px] text-slate-700 italic">—</span>
                  </div>
                </div>
                {renderSpells(cantrips)}
              </div>
              {Array.from({ length: 9 }, (_, i) => i + 1).map((level) => {
                const slot = slots[level];
                const lvSpells = byLevel.get(level) ?? [];
                return (
                  <div key={level}>
                    <SlotRow
                      level={level}
                      slot={slot}
                      onTogglePip={(idx) => toggleSlotPip(level, idx)}
                      onSetMax={(m) => setSlotMax(level, m)}
                    />
                    {renderSpells(lvSpells)}
                  </div>
                );
              })}
            </div>
            {(() => {
              // Ritual list — shows rituals across all levels in one place
              // so players can scan their no-slot options quickly. Each entry
              // is also still rendered above under its level.
              const rituals = spells.filter((sp) => {
                if (sp.sourceKind !== 'srd-spell' || !sp.sourceId) return false;
                return getSpellsIdx(edition)[sp.sourceId]?.ritual ?? false;
              });
              if (rituals.length === 0) return null;
              return (
                <div className="mt-5 pt-3 border-t border-slate-800">
                  <div className="text-[10px] uppercase tracking-wider text-amber-300/80 mb-2">
                    Ritual spells
                  </div>
                  <div className="text-[11px] text-slate-500 mb-2 leading-snug">
                    Can be cast without a slot in 10 extra minutes.
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rituals
                      .slice()
                      .sort((a, b) => spellLevelFor(a, edition) - spellLevelFor(b, edition) || a.name.localeCompare(b.name))
                      .map((sp) => {
                        const lv = spellLevelFor(sp, edition);
                        return (
                          <span
                            key={sp.id}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-slate-950 border border-slate-800 text-slate-200"
                          >
                            {sp.name}
                            <span className="text-[10px] text-slate-500">
                              ({lv === 0 ? 'Cantrip' : `Lv ${lv}`})
                            </span>
                          </span>
                        );
                      })}
                  </div>
                </div>
              );
            })()}
            {spells.length === 0 && (
              <div className="text-sm text-slate-500 italic py-2">No spells known yet.</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function spellLevelFor(spell: KnownSpell, edition: SrdEdition): number {
  if (spell.sourceKind === 'srd-spell' && spell.sourceId) {
    return getSpellsIdx(edition)[spell.sourceId]?.level ?? 0;
  }
  return 0;
}

function SlotRow({
  level,
  slot,
  onTogglePip,
  onSetMax,
}: {
  level: number;
  slot: { max: number; current: number };
  onTogglePip: (idx: number) => void;
  onSetMax: (m: number) => void;
}) {
  // Cap visible pips at 8 to keep the row readable; the SRD never exceeds 4
  // per level for a single class but multi-class can push higher.
  const PIP_CAP = 8;
  const pips = Math.min(Math.max(slot.max, 0), PIP_CAP);
  return (
    <div className="flex items-center gap-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 w-14 shrink-0 font-mono">
        Lv {level}
      </div>
      <div className="flex gap-1 flex-1 min-w-0">
        {pips === 0 ? (
          <span className="text-[11px] text-slate-700 italic">—</span>
        ) : (
          Array.from({ length: pips }, (_, i) => (
            <button
              key={i}
              onClick={() => onTogglePip(i)}
              title={i < slot.current ? 'Expend slot' : 'Restore slot'}
              className={`h-3.5 w-3.5 rounded-full border-2 ${
                i < slot.current ? 'border-transparent' : 'border-slate-600 hover:border-slate-400'
              }`}
              style={i < slot.current ? { background: 'var(--ac-400)' } : undefined}
            />
          ))
        )}
      </div>
      <label className="flex items-center gap-1 text-[10px] text-slate-500">
        max
        <input
          type="number"
          value={slot.max}
          onChange={(e) => onSetMax(parseInt(e.target.value || '0', 10))}
          className="w-12 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-center text-slate-100 focus:outline-none focus:border-sky-700"
        />
      </label>
    </div>
  );
}

function SpellRow({
  spell,
  spellAttack,
  spellDc,
  onChange,
  onRemove,
}: {
  spell: KnownSpell;
  spellAttack: number | null;
  spellDc: number | null;
  onChange: (patch: Partial<KnownSpell>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const srd = spell.sourceKind === 'srd-spell' && spell.sourceId
    ? getSpellsIdx(edition)[spell.sourceId]
    : null;

  const baseDamage = (() => {
    if (!srd?.damage) return null;
    // Cantrips scale by character level; leveled spells by slot level.
    const map = srd.damage.damage_at_slot_level ?? srd.damage.damage_at_character_level;
    if (!map) return null;
    // Pick the spell's own base level (or 1 for cantrips).
    const key = String(Math.max(1, srd.level));
    return map[key] ?? Object.values(map)[0] ?? null;
  })();

  const damageType = srd?.damage?.damage_type?.name ?? null;
  const saveAbility = srd?.dc?.dc_type?.name ?? null;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Sparkles size={13} className="text-violet-300 shrink-0" />
        <button
          onClick={() => srd && setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left text-sm text-slate-100 outline-none truncate hover:text-sky-200 disabled:cursor-text disabled:hover:text-slate-100"
          disabled={!srd}
          title={srd ? 'Click to view description' : undefined}
        >
          {spell.name}
          {srd?.ritual && (
            <span
              className="ml-1.5 inline-block px-1 py-0 text-[9px] uppercase tracking-wider rounded bg-amber-900/40 text-amber-300 align-middle"
              title="Ritual — can be cast without a slot in 10 extra minutes"
            >
              R
            </span>
          )}
          {srd?.concentration && (
            <span
              className="ml-1 inline-block px-1 py-0 text-[9px] uppercase tracking-wider rounded bg-sky-900/40 text-sky-300 align-middle"
              title="Concentration"
            >
              C
            </span>
          )}
        </button>
        {/* Inline at-a-glance chips: attack mod, damage, save DC */}
        {srd?.attack_type && spellAttack != null && (
          <span className="text-[10px] font-mono text-sky-300 shrink-0" title="Spell attack bonus">
            {fmt(spellAttack)}
          </span>
        )}
        {baseDamage && (
          <span className="text-[10px] font-mono text-rose-300 shrink-0" title={damageType ?? 'damage'}>
            {baseDamage}
          </span>
        )}
        {saveAbility && spellDc != null && (
          <span className="text-[10px] uppercase font-mono text-amber-300 shrink-0" title="Save DC">
            {saveAbility.slice(0, 3)} {spellDc}
          </span>
        )}
        {srd?.concentration && (
          <span className="text-[9px] uppercase tracking-wider text-amber-400 shrink-0" title="Concentration">C</span>
        )}
        {srd?.ritual && (
          <span className="text-[9px] uppercase tracking-wider text-violet-300 shrink-0" title="Ritual">R</span>
        )}
        <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={spell.prepared}
            onChange={(e) => onChange({ prepared: e.target.checked })}
            className="accent-sky-500"
          />
          prep
        </label>
        <button
          onClick={onRemove}
          title="Remove"
          className="p-1 text-slate-600 hover:text-rose-300 print:hidden"
        >
          <XIcon size={12} />
        </button>
      </div>
      {open && srd && (
        <div className="px-3 pb-3 pt-1 text-[12px] text-slate-300 space-y-1 border-t border-slate-800">
          <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{srd.school.name}</span>
            <span>Casting time: {srd.casting_time}</span>
            <span>Range: {srd.range}</span>
            <span>Components: {srd.components.join(', ')}</span>
            <span>Duration: {srd.duration}</span>
          </div>
          <div className="markdown-body text-[12px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{srd.desc.join('\n\n')}</ReactMarkdown>
          </div>
          {srd.higher_level && srd.higher_level.length > 0 && (
            <div className="mt-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">At higher levels</div>
              <div className="markdown-body text-[12px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{srd.higher_level.join('\n\n')}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpellPicker({
  onAdd,
}: {
  onAdd: (entry: { sourceKind: KnownSpell['sourceKind']; sourceId?: string; name: string }) => void;
}) {
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const spellsOnly = useMemo(
    () => catalog.filter((e) => e.kind === 'spell' || e.kind === 'srd-spell'),
    [catalog]
  );
  const results = useMemo(() => searchCatalog(spellsOnly, query, 10), [spellsOnly, query]);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    return () => window.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const pick = (e: CatalogEntry) => {
    const colon = e.id.indexOf(':');
    const identifier = colon >= 0 ? e.id.slice(colon + 1) : e.id;
    onAdd({ sourceKind: e.kind as KnownSpell['sourceKind'], sourceId: identifier, name: e.name });
    setQuery('');
    setOpen(false);
  };

  const addCustom = () => {
    const name = query.trim();
    if (!name) return;
    onAdd({ sourceKind: 'custom', name });
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative print:hidden">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search spells…"
            className="w-full bg-slate-950 border border-slate-700 rounded pl-7 pr-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700"
          />
        </div>
        <button
          onClick={addCustom}
          disabled={!query.trim()}
          className="px-2 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 flex items-center gap-1"
        >
          <Plus size={12} /> Custom
        </button>
      </div>
      {open && (query.trim() || results.length > 0) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">
              No spell match. Click "Custom" to add "{query.trim()}".
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 flex items-center gap-2"
              >
                <Sparkles size={12} className="text-violet-300" />
                <span className="flex-1 truncate">{r.name}</span>
                {r.hint && <span className="text-[10px] text-slate-500 shrink-0">{r.hint}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Description / details ─────────────────────────────────────────────────

const DETAIL_FIELDS: { key: keyof CharacterDetails; label: string; placeholder: string }[] = [
  { key: 'gender', label: 'Gender', placeholder: '—' },
  { key: 'age', label: 'Age', placeholder: '—' },
  { key: 'height', label: 'Height', placeholder: '—' },
  { key: 'weight', label: 'Weight', placeholder: '—' },
  { key: 'eyes', label: 'Eyes', placeholder: '—' },
  { key: 'hair', label: 'Hair', placeholder: '—' },
  { key: 'skin', label: 'Skin', placeholder: '—' },
  { key: 'alignment', label: 'Alignment', placeholder: '—' },
  { key: 'deity', label: 'Deity', placeholder: '—' },
];

function DetailsBlock({ draft, onApply }: { draft: PartyMember; onApply: (p: Partial<PartyMember>) => void }) {
  const details = draft.details ?? {};
  const update = (patch: Partial<CharacterDetails>) => {
    const next = { ...details, ...patch };
    // Drop empty-string values so the object stays clean.
    for (const k of Object.keys(next) as (keyof CharacterDetails)[]) {
      if (!next[k]) delete next[k];
    }
    onApply({ details: Object.keys(next).length > 0 ? next : undefined });
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
      {DETAIL_FIELDS.map((f) => (
        <label key={f.key} className="block">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{f.label}</div>
          <input
            value={details[f.key] ?? ''}
            onChange={(e) => update({ [f.key]: e.target.value })}
            placeholder={f.placeholder}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-sky-700"
          />
        </label>
      ))}
    </div>
  );
}

// ── Conditions & exhaustion ───────────────────────────────────────────────

/** SRD 5.1 conditions list minus Exhaustion (which has its own counter). */
const SHEET_CONDITIONS = CONDITIONS.filter((c) => c.index !== 'exhaustion');

/** Per-condition presentation: a distinct icon + colour so each effect reads at
 *  a glance both as a chip in the block below and as a pulsing badge in the
 *  sheet header. Class strings are written out in full (not built dynamically)
 *  so Tailwind's JIT compiler keeps them.
 *   - `chip`  : classes for the active chip in ConditionsBlock
 *   - `text`  : icon colour; also drives the header badge's glow via currentColor
 *   - `ring`  : header badge border colour */
type ConditionMeta = { icon: LucideIcon; label: string; chip: string; text: string; ring: string };
const CONDITION_META: Record<string, ConditionMeta> = {
  blinded:       { icon: EyeOff,    label: 'Blinded',       chip: 'border-zinc-500 bg-zinc-800/60 text-zinc-100',       text: 'text-zinc-300',    ring: 'border-zinc-600/60' },
  charmed:       { icon: Heart,     label: 'Charmed',       chip: 'border-pink-500 bg-pink-900/40 text-pink-100',       text: 'text-pink-300',    ring: 'border-pink-700/60' },
  deafened:      { icon: EarOff,    label: 'Deafened',      chip: 'border-indigo-500 bg-indigo-900/40 text-indigo-100', text: 'text-indigo-300',  ring: 'border-indigo-700/60' },
  frightened:    { icon: Ghost,     label: 'Frightened',    chip: 'border-purple-500 bg-purple-900/40 text-purple-100', text: 'text-purple-300',  ring: 'border-purple-700/60' },
  grappled:      { icon: Grab,      label: 'Grappled',      chip: 'border-orange-500 bg-orange-900/40 text-orange-100', text: 'text-orange-300',  ring: 'border-orange-700/60' },
  incapacitated: { icon: ZapOff,    label: 'Incapacitated', chip: 'border-red-500 bg-red-900/40 text-red-100',          text: 'text-red-300',     ring: 'border-red-700/60' },
  invisible:     { icon: Eye,       label: 'Invisible',     chip: 'border-cyan-500 bg-cyan-900/40 text-cyan-100',       text: 'text-cyan-300',    ring: 'border-cyan-700/60' },
  paralyzed:     { icon: Zap,       label: 'Paralyzed',     chip: 'border-yellow-500 bg-yellow-900/40 text-yellow-100', text: 'text-yellow-300',  ring: 'border-yellow-700/60' },
  petrified:     { icon: Mountain,  label: 'Petrified',     chip: 'border-stone-500 bg-stone-800/60 text-stone-100',    text: 'text-stone-300',   ring: 'border-stone-600/60' },
  poisoned:      { icon: Biohazard, label: 'Poisoned',      chip: 'border-green-500 bg-green-900/40 text-green-100',    text: 'text-green-300',   ring: 'border-green-700/60' },
  prone:         { icon: ArrowDown, label: 'Prone',         chip: 'border-lime-500 bg-lime-900/40 text-lime-100',       text: 'text-lime-300',    ring: 'border-lime-700/60' },
  restrained:    { icon: LinkIcon,  label: 'Restrained',    chip: 'border-amber-500 bg-amber-900/40 text-amber-100',    text: 'text-amber-300',   ring: 'border-amber-700/60' },
  stunned:       { icon: Sparkles,  label: 'Stunned',       chip: 'border-fuchsia-500 bg-fuchsia-900/40 text-fuchsia-100', text: 'text-fuchsia-300', ring: 'border-fuchsia-700/60' },
  unconscious:   { icon: Moon,      label: 'Unconscious',   chip: 'border-sky-500 bg-sky-900/40 text-sky-100',          text: 'text-sky-300',     ring: 'border-sky-700/60' },
};

/** Pulsing reminder badges shown in the sheet header for every active condition
 *  (plus an exhaustion pip if the level is above 0). Each badge is clickable to
 *  clear that condition straight from the header. */
function ConditionBadges({ draft, onApply }: { draft: PartyMember; onApply: (p: Partial<PartyMember>) => void }) {
  const conditions = draft.conditions ?? [];
  const active = conditions.filter((idx) => CONDITION_META[idx]);
  const exh = draft.exhaustion ?? 0;
  if (active.length === 0 && exh === 0) return null;

  const clear = (idx: string) => onApply({ conditions: conditions.filter((c) => c !== idx) });

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-800">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-0.5">Active</span>
      {active.map((idx) => {
        const meta = CONDITION_META[idx];
        const Icon = meta.icon;
        return (
          <button
            key={idx}
            onClick={() => clear(idx)}
            title={`${meta.label} — click to clear`}
            className={`condition-badge grid place-items-center h-7 w-7 rounded-full border bg-slate-950/70 ${meta.text} ${meta.ring}`}
          >
            <Icon size={14} />
          </button>
        );
      })}
      {exh > 0 && (
        <div
          title={`Exhaustion level ${exh}${exh >= 6 ? ' — dead' : ''}`}
          className={`condition-badge grid place-items-center h-7 px-2 rounded-full border bg-slate-950/70 ${exh >= 6 ? 'text-rose-300 border-rose-600/60' : 'text-amber-300 border-amber-700/60'}`}
        >
          <span className="flex items-center gap-0.5 text-[11px] font-bold">
            <AlertTriangle size={11} />{exh}
          </span>
        </div>
      )}
    </div>
  );
}

function ConditionsBlock({ draft, onApply }: { draft: PartyMember; onApply: (p: Partial<PartyMember>) => void }) {
  const active = new Set(draft.conditions ?? []);
  const exh = draft.exhaustion ?? 0;
  const dead = exh >= 6;

  const toggleCondition = (slug: string) => {
    const next = new Set(active);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onApply({ conditions: Array.from(next) });
  };

  const setExhaustion = (n: number) => {
    const clamped = Math.max(0, Math.min(6, n));
    // Exhaustion 6 in 2024 = instant death. Drop HP to 0 too so the rest of
    // the sheet (HP bar, Dead badge in Vitals) reads consistently.
    if (clamped >= 6) {
      onApply({ exhaustion: 6, hp: 0 });
    } else {
      onApply({ exhaustion: clamped });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
      {/* Conditions list */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Conditions</div>
        <div className="flex flex-wrap gap-1.5">
          {SHEET_CONDITIONS.map((c) => {
            const on = active.has(c.index);
            const meta = CONDITION_META[c.index];
            const Icon = meta?.icon;
            return (
              <button
                key={c.index}
                onClick={() => toggleCondition(c.index)}
                title={c.desc.split('\n')[0]}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors ${
                  on
                    ? meta?.chip ?? 'border-rose-600 bg-rose-900/40 text-rose-100'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {Icon && <Icon size={11} />}
                {c.name}
              </button>
            );
          })}
        </div>
        {active.size === 0 && (
          <div className="text-[11px] text-slate-600 italic mt-2">
            No active conditions. Click a chip to apply.
          </div>
        )}
      </div>

      {/* Exhaustion tracker (right column) */}
      <div className="border-t lg:border-t-0 lg:border-l border-slate-800 lg:pl-4 pt-3 lg:pt-0">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Exhaustion</div>
          <div className="text-[10px] text-slate-500 font-mono">{exh}/6</div>
        </div>
        <div className="flex gap-1 mb-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setExhaustion(exh === n ? n - 1 : n)}
              className={`flex-1 h-5 rounded-sm border transition-colors ${
                exh >= n
                  ? n === 6
                    ? 'bg-rose-700 border-rose-500'
                    : 'bg-amber-700 border-amber-500'
                  : 'bg-slate-900 border-slate-700 hover:bg-slate-800'
              }`}
              title={`Set exhaustion level ${n}`}
            />
          ))}
        </div>
        {exh > 0 && (
          <div className="text-[11px] leading-relaxed text-slate-400 space-y-1 bg-slate-950 border border-slate-800 rounded p-2">
            <div className="flex items-center gap-1 text-amber-300/90">
              <AlertTriangle size={11} />
              <span>−{exh * 2} on D20 tests · −{exh * 5} ft Speed</span>
            </div>
            {dead && (
              <div className="text-rose-300 font-semibold">
                Dead — exhaustion at 6.
              </div>
            )}
          </div>
        )}
        {exh === 0 && (
          <div className="text-[11px] text-slate-600 italic">
            Click a pip to apply exhaustion levels. Long rest reduces by 1.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────

/** Standard SRD combat actions that are always available regardless of class.
 *  Mirrors the 2024 SRD "Actions in Combat" list — we include both editions'
 *  vocabulary where they diverge so the row reads naturally either way. */
const STANDARD_ACTIONS: { name: string; category: ActionCategory; desc?: string }[] = [
  { name: 'Attack', category: 'action', desc: 'Make one attack roll with a weapon or Unarmed Strike.' },
  { name: 'Dash', category: 'action', desc: 'Extra movement equal to your Speed.' },
  { name: 'Disengage', category: 'action', desc: 'Your movement doesn\'t provoke Opportunity Attacks until the end of your turn.' },
  { name: 'Dodge', category: 'action', desc: 'Until your next turn, attack rolls against you have Disadvantage and you have Advantage on Dex saves.' },
  { name: 'Help', category: 'action', desc: 'Give an ally Advantage on their next ability check, or their next attack against a creature within 5 ft of you.' },
  { name: 'Hide', category: 'action', desc: 'Make a Stealth check vs the highest passive Perception of any creature that can see you.' },
  { name: 'Influence', category: 'action', desc: 'Convince a creature to do something via a Charisma check (or other ability the GM determines).' },
  { name: 'Ready', category: 'action', desc: 'Prepare a reaction trigger and the action to take when it occurs.' },
  { name: 'Search', category: 'action', desc: 'Look for something — Perception, Investigation, Insight, or Survival depending on what.' },
  { name: 'Study', category: 'action', desc: 'Recall lore about a creature, object, or phenomenon — Arcana, History, Nature, or Religion.' },
  { name: 'Utilize', category: 'action', desc: 'Activate a non-magical object (e.g. pull a lever).' },
  { name: 'Opportunity Attack', category: 'reaction', desc: 'When a hostile creature you can see leaves your reach, use your Reaction to make one melee attack.' },
  { name: 'Interact with an Object', category: 'other', desc: 'Once per turn, free: draw, drop, pick up, or manipulate one object.' },
  { name: 'Grapple', category: 'other', desc: 'Special Attack: target makes a Str/Dex save vs your Athletics DC. On a fail, the target has the Grappled condition.' },
  { name: 'Shove', category: 'other', desc: 'Special Attack: target makes a Str/Dex save vs your Athletics DC. On a fail, push 5 ft or knock Prone.' },
];

function bucketByCastingTime(time: string): ActionCategory {
  const t = (time || '').toLowerCase();
  if (t.startsWith('bonus action')) return 'bonus';
  if (t.startsWith('reaction')) return 'reaction';
  if (t.startsWith('action')) return 'action';
  return 'other';
}

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  action: 'Actions',
  bonus: 'Bonus actions',
  reaction: 'Reactions',
  other: 'Other',
};

function ActionsBlock({ draft, onApply }: { draft: PartyMember; onApply: (p: Partial<PartyMember>) => void }) {
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const rollFormula = useQuickDice((s) => s.rollFormula);
  const [adding, setAdding] = useState<ActionCategory | null>(null);

  const customActions = draft.customActions ?? [];
  const setCustomActions = (next: CustomAction[]) => onApply({ customActions: next });

  // Weapons → attack rows (Actions bucket). Use existing weaponStats() to
  // compute attack bonus + damage from the character's mods.
  const weaponRows = useMemo(() => {
    const inv = draft.inventory ?? [];
    const rows: { id: string; name: string; attackBonus: number; damage: string; ability: 'str' | 'dex'; equipped: boolean }[] = [];
    for (const item of inv) {
      const srd = srdItemFor(item, edition);
      if (!srd?.damage) continue;
      const stats = weaponStats(draft, srd);
      const dmg = stats.damageDice
        ? `${stats.damageDice}${stats.abilityMod !== 0 ? ` ${stats.abilityMod >= 0 ? '+' : ''}${stats.abilityMod}` : ''} ${srd.damage.damage_type.name}`
        : '';
      rows.push({
        id: item.id,
        name: item.name,
        attackBonus: stats.attackBonus,
        damage: dmg,
        ability: stats.ability,
        equipped: item.equipped,
      });
    }
    return rows;
  }, [draft, edition]);

  // Spell rows bucketed by casting_time. Skips entries we can't resolve to
  // a SRD spell (homebrew spells don't have a casting_time field on the
  // KnownSpell stub — they'd need to be looked up via the homebrew store).
  const spellsByBucket = useMemo(() => {
    const out: Record<ActionCategory, { id: string; name: string; level: number; ritual: boolean; concentration: boolean; castingTime: string }[]> = {
      action: [],
      bonus: [],
      reaction: [],
      other: [],
    };
    for (const sp of draft.spells ?? []) {
      if (sp.sourceKind !== 'srd-spell' || !sp.sourceId) continue;
      const srd = getSpellsIdx(edition)[sp.sourceId];
      if (!srd) continue;
      const bucket = bucketByCastingTime(srd.casting_time);
      out[bucket].push({
        id: sp.id,
        name: sp.name,
        level: srd.level,
        ritual: srd.ritual,
        concentration: srd.concentration,
        castingTime: srd.casting_time,
      });
    }
    return out;
  }, [draft.spells, edition]);

  // Two-Weapon Fighting only when wielding two equipped Light melee weapons.
  const twoWeaponEligible = useMemo(() => {
    const inv = draft.inventory ?? [];
    let lightEquipped = 0;
    for (const item of inv) {
      if (!item.equipped) continue;
      const srd = srdItemFor(item, edition);
      if (!srd?.damage || srd.weapon_range === 'Ranged') continue;
      const props = (srd.properties ?? []).map((p) => p.name.toLowerCase());
      if (props.includes('light')) lightEquipped++;
    }
    return lightEquipped >= 2;
  }, [draft.inventory, edition]);

  const rollAttack = (label: string, bonus: number) => {
    rollFormula(`1d20 + ${bonus}`, `${label} attack`);
  };
  const rollDamage = (label: string, formula: string) => {
    rollFormula(formula, `${label} damage`);
  };

  const buckets: ActionCategory[] = ['action', 'bonus', 'reaction', 'other'];

  const renderBucket = (cat: ActionCategory) => {
    const standard = STANDARD_ACTIONS.filter((a) => a.category === cat);
    const spells = spellsByBucket[cat];
    const customs = customActions.filter((a) => a.category === cat);
    const weapons = cat === 'action' ? weaponRows : [];
    const twoWeapon = cat === 'bonus' && twoWeaponEligible;

    const hasContent = weapons.length || spells.length || standard.length || customs.length || twoWeapon;
    if (!hasContent && cat !== 'action') return null;

    return (
      <div key={cat} className="mt-4 first:mt-0">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1">
          <div className="text-[11px] uppercase tracking-wider text-rose-300/80">{CATEGORY_LABEL[cat]}</div>
          <button
            onClick={() => setAdding(adding === cat ? null : cat)}
            className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 flex items-center gap-1"
            title={`Add a custom ${CATEGORY_LABEL[cat].toLowerCase().replace(/s$/, '')}`}
          >
            <Plus size={10} /> Custom
          </button>
        </div>

        {adding === cat && (
          <CustomActionAdder
            category={cat}
            onAdd={(entry) => {
              setCustomActions([...customActions, entry]);
              setAdding(null);
            }}
            onCancel={() => setAdding(null)}
          />
        )}

        {weapons.length > 0 && (
          <Subgroup title="Weapon attacks">
            {weapons.map((w) => (
              <ActionRow
                key={w.id}
                name={w.name}
                hint={`${w.equipped ? '' : '(unequipped) '}${w.ability.toUpperCase()}-based`}
              >
                <button
                  onClick={() => rollAttack(w.name, w.attackBonus)}
                  className="px-1.5 py-0.5 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono"
                  title="Roll attack"
                >
                  {w.attackBonus >= 0 ? '+' : ''}{w.attackBonus}
                </button>
                {w.damage && (
                  <button
                    onClick={() => rollDamage(w.name, (() => {
                      // Strip the trailing damage-type word from the display string
                      const parts = w.damage.split(' ');
                      return parts.slice(0, -1).join(' ');
                    })())}
                    className="px-1.5 py-0.5 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono"
                    title="Roll damage"
                  >
                    {w.damage}
                  </button>
                )}
              </ActionRow>
            ))}
          </Subgroup>
        )}

        {(standard.length > 0 || twoWeapon) && (
          <Subgroup title="Standard">
            {twoWeapon && (
              <ActionRow
                name="Two-Weapon Fighting"
                hint="Bonus Action — attack with your other Light melee weapon"
              />
            )}
            {standard.map((a) => (
              <ActionRow key={a.name} name={a.name} hint={a.desc} />
            ))}
          </Subgroup>
        )}

        {spells.length > 0 && (
          <Subgroup title="Spells">
            {spells
              .slice()
              .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
              .map((s) => (
                <ActionRow
                  key={s.id}
                  name={s.name}
                  hint={`${s.level === 0 ? 'Cantrip' : `Lv ${s.level}`}${s.concentration ? ' · C' : ''}${s.ritual ? ' · R' : ''} — ${s.castingTime}`}
                />
              ))}
          </Subgroup>
        )}

        {customs.length > 0 && (
          <Subgroup title="Custom">
            {customs.map((a) => (
              <ActionRow
                key={a.id}
                name={a.name}
                hint={a.desc}
                onRemove={() => setCustomActions(customActions.filter((x) => x.id !== a.id))}
              />
            ))}
          </Subgroup>
        )}
      </div>
    );
  };

  return <div>{buckets.map(renderBucket)}</div>;
}

function Subgroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ActionRow({
  name,
  hint,
  onRemove,
  children,
}: {
  name: string;
  hint?: string;
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 border-l-2 border-slate-800 pl-2 py-1 text-sm">
      <div className="flex-1 min-w-0">
        <div className="text-slate-100">{name}</div>
        {hint && <div className="text-[11px] text-slate-500 leading-snug">{hint}</div>}
      </div>
      {children && <div className="flex gap-1 shrink-0 mt-0.5">{children}</div>}
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-1 text-slate-600 hover:text-rose-400"
          title="Remove"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

function CustomActionAdder({
  category,
  onAdd,
  onCancel,
}: {
  category: ActionCategory;
  onAdd: (entry: CustomAction) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    onAdd({ id: crypto.randomUUID(), category, name: name.trim(), desc: desc.trim() || undefined });
    setName('');
    setDesc('');
  };
  return (
    <div className="mt-2 mb-1 p-2 bg-slate-950 border border-slate-800 rounded space-y-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={`New ${CATEGORY_LABEL[category].toLowerCase().replace(/s$/, '')}…`}
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700"
      />
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Optional description"
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-sky-700"
      />
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="px-2 py-0.5 text-[11px] rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Features & traits ─────────────────────────────────────────────────────

const FEATURE_SOURCES: CharacterFeature['source'][] = ['Class', 'Race', 'Feat', 'Background', 'Other'];
const USE_PERIODS: NonNullable<CharacterFeature['uses']>['period'][] = ['Short', 'Long', 'Day', 'Encounter'];

function FeaturesBlock({ draft, onApply }: { draft: PartyMember; onApply: (p: Partial<PartyMember>) => void }) {
  const features = draft.features ?? [];
  const [adding, setAdding] = useState(false);

  const update = (next: CharacterFeature[]) => onApply({ features: next });

  // Group by source so Class/Race/etc. read cleanly together.
  const grouped: Record<CharacterFeature['source'], CharacterFeature[]> = {
    Class: [], Race: [], Feat: [], Background: [], Other: [],
  };
  for (const f of features) grouped[f.source].push(f);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setAdding(true)}
          className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
        >
          <Plus size={12} /> Add feature
        </button>
      </div>

      {adding && (
        <FeatureAdder
          onAdd={(f) => {
            update([...features, f]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {features.length === 0 && !adding && (
        <div className="text-sm text-slate-500 italic py-3">
          No features yet. Add class features, racial traits, or feats so you can track their uses inline.
        </div>
      )}

      {FEATURE_SOURCES.map((src) => {
        if (grouped[src].length === 0) return null;
        return (
          <div key={src} className="mt-4 first:mt-0">
            <div className="text-[11px] uppercase tracking-wider text-rose-300/80 border-b border-slate-800 pb-1 mb-2">
              {src}
            </div>
            <div className="space-y-2">
              {grouped[src].map((f) => (
                <FeatureRow
                  key={f.id}
                  feature={f}
                  onChange={(patch) =>
                    update(features.map((x) => (x.id === f.id ? { ...x, ...patch } : x)))
                  }
                  onRemove={() => update(features.filter((x) => x.id !== f.id))}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureRow({
  feature,
  onChange,
  onRemove,
}: {
  feature: CharacterFeature;
  onChange: (patch: Partial<CharacterFeature>) => void;
  onRemove: () => void;
}) {
  // Collapsed by default — like the inventory rows + spell rows on the
  // sheet, click the name to expand the description.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const uses = feature.uses;

  return (
    <div className="srd-popover" style={{ maxHeight: 'none' }}>
      <div className="srd-popover-header flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left"
          title={open ? 'Collapse' : 'Expand description'}
        >
          <div className="srd-popover-name truncate hover:text-sky-200">{feature.name}</div>
          <div className="srd-popover-sub">{feature.source}</div>
        </button>
        {uses && (
          <UsesControl
            current={uses.current}
            max={uses.max}
            period={uses.period}
            onChange={(next) => onChange({ uses: next })}
          />
        )}
        {!uses && (
          <button
            onClick={() => onChange({ uses: { current: 1, max: 1, period: 'Long' } })}
            className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-800 shrink-0"
            title="Add a limited-use counter"
          >
            Track uses
          </button>
        )}
        <button
          onClick={() => { setOpen(true); setEditing((v) => !v); }}
          className="p-1 text-slate-500 hover:text-sky-300 shrink-0"
          title={editing ? 'Done editing' : 'Edit description'}
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onRemove}
          className="p-1 text-slate-600 hover:text-rose-400 shrink-0"
          title="Remove feature"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {open && (
        editing ? (
          <div className="srd-popover-body" style={{ overflowY: 'visible' }}>
            <textarea
              value={feature.desc ?? ''}
              onChange={(e) => onChange({ desc: e.target.value })}
              placeholder="Description (markdown supported)…"
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-700 resize-y"
            />
          </div>
        ) : feature.desc ? (
          <div className="srd-popover-body markdown-body" style={{ overflowY: 'visible' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feature.desc}</ReactMarkdown>
          </div>
        ) : (
          <div
            className="srd-popover-body italic text-slate-600 cursor-pointer"
            style={{ overflowY: 'visible' }}
            onClick={() => setEditing(true)}
          >
            No description yet — click the pencil to add one.
          </div>
        )
      )}
    </div>
  );
}

function UsesControl({
  current,
  max,
  period,
  onChange,
}: {
  current: number;
  max: number;
  period: NonNullable<CharacterFeature['uses']>['period'];
  onChange: (next: NonNullable<CharacterFeature['uses']>) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <button
        onClick={() => onChange({ current: Math.max(0, current - 1), max, period })}
        disabled={current <= 0}
        className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 leading-none"
        title="Use one"
      >
        −
      </button>
      <span className="font-mono text-slate-300 min-w-[2.5rem] text-center">
        {current}/{max}
      </span>
      <button
        onClick={() => onChange({ current: Math.min(max, current + 1), max, period })}
        disabled={current >= max}
        className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 leading-none"
        title="Restore one"
      >
        +
      </button>
      <select
        value={period}
        onChange={(e) => onChange({ current, max, period: e.target.value as typeof period })}
        className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-sky-700"
        title="Recovery period"
      >
        {USE_PERIODS.map((p) => (
          <option key={p} value={p}>
            /{p === 'Encounter' ? 'enc' : p === 'Day' ? 'day' : `${p} rest`}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={max}
        onChange={(e) => {
          const m = Math.max(0, parseInt(e.target.value || '0', 10));
          onChange({ current: Math.min(current, m), max: m, period });
        }}
        className="w-10 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300 text-center focus:outline-none focus:border-sky-700"
        title="Max uses"
      />
    </div>
  );
}

function FeatureAdder({
  onAdd,
  onCancel,
}: {
  onAdd: (f: CharacterFeature) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<CharacterFeature['source']>('Class');
  const [desc, setDesc] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      source,
      desc: desc.trim() || undefined,
    });
    setName('');
    setDesc('');
  };
  return (
    <div className="mb-3 p-3 bg-slate-950 border border-slate-800 rounded space-y-2">
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Feature name (e.g. Arcane Recovery)"
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as CharacterFeature['source'])}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-700"
        >
          {FEATURE_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-sky-700 resize-y"
      />
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="px-3 py-1 text-xs rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white"
        >
          Add feature
        </button>
      </div>
    </div>
  );
}
