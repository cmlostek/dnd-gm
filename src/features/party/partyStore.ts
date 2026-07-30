import { create } from 'zustand';
import { supabase } from '../../lib/supabase';

export type Gold = { pp: number; gp: number; ep: number; sp: number; cp: number };
export type DeathSaves = { successes: number; failures: number };

/** Spell slots are tracked per level (1..9). Index 0 is unused so the array
 *  index matches the spell level naturally. Each slot has a max and current
 *  remaining count. */
export type SpellSlots = { max: number; current: number }[];
export const DEFAULT_SPELL_SLOTS: SpellSlots = Array.from({ length: 10 }, () => ({ max: 0, current: 0 }));

/** A known/prepared spell entry. SRD-backed lookup via sourceId (spell
 *  index slug); homebrew spells reference the homebrew row uuid. */
export type KnownSpell = {
  id: string;          // local uuid
  sourceKind: 'srd-spell' | 'spell' | 'custom';
  sourceId?: string;
  name: string;
  prepared: boolean;
};

/** A line item in a character's inventory. Links back to a SRD or homebrew
 *  catalog entry by id, but stores the display `name` inline so the row
 *  still renders if the source is later removed. */
export type InventoryItem = {
  /** Local-only uuid for React keys. */
  id: string;
  /** Catalog source kind. `custom` means a freeform user-typed entry. */
  sourceKind: 'srd-item' | 'srd-spell' | 'item' | 'spell' | 'custom';
  /** Catalog id — SRD index slug for SRD entries, uuid for homebrew. */
  sourceId?: string;
  name: string;
  qty: number;
  equipped: boolean;
  /** Optional id of another inventory item this one requires (e.g. a bow
   *  depends on arrows). The sheet warns when the dependency is missing or at
   *  0 quantity. */
  dependsOn?: string;
  /** Optional item-icon key (see data/itemIcons). Overrides the auto-derived
   *  kind icon and any homebrew-source icon when set. */
  icon?: string;
};

/** Action-economy bucket. Drives the Actions tab grouping. */
export type ActionCategory = 'action' | 'bonus' | 'reaction' | 'other';

/** A user-defined action that's not derived from inventory or spells.
 *  Examples: a racial 'Breath Weapon', a feat's 'War Caster' reaction,
 *  a feature's 'Channel Divinity'. Stored per character. */
export type CustomAction = {
  id: string;
  category: ActionCategory;
  name: string;
  desc?: string;
};

/** A class / race / feat / other feature the user tracks on the sheet.
 *  Phase 1 is freeform — phase 4 will let class data auto-populate these
 *  on level-up. */
export type CharacterFeature = {
  id: string;
  name: string;
  source: 'Class' | 'Race' | 'Feat' | 'Background' | 'Other';
  desc?: string;
  /** Optional limited-use counter (e.g. 'Arcane Recovery 1/Long Rest'). */
  uses?: { current: number; max: number; period: 'Short' | 'Long' | 'Day' | 'Encounter' };
};

/** Free-form flavour fields collected during character creation. None of
 *  these affect mechanics — they live on the sheet to give the character
 *  a face. */
export type CharacterDetails = {
  height?: string;
  weight?: string;
  age?: string;
  gender?: string;
  eyes?: string;
  hair?: string;
  skin?: string;
  alignment?: string;
  deity?: string;
};

export type PartyMember = {
  id: string;
  owner_user_id: string | null;
  name: string;
  player?: string;
  race: string;
  classSummary: string;
  level: number;
  ac: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  speed: string;
  initiativeBonus: number;
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  saves: string;
  skills: string;
  languages: string;
  ddbUrl?: string;
  notes?: string;
  source: 'manual' | 'ddb-json' | 'json';
  // Phase A character-sheet fields (all optional — older rows default sensibly).
  xp?: number;
  gold?: Gold;
  deathSaves?: DeathSaves;
  /** Skill keys (see SKILLS in CharacterSheet) the character is proficient in. */
  skillProfs?: string[];
  /** Ability keys ('str' | 'dex' | ...) the character is save-proficient in. */
  saveProfs?: string[];
  /** Carried items, weapons, magic items, and known spells. */
  inventory?: InventoryItem[];
  /** Ability used for spell attacks + save DC. Null = not a caster. */
  spellAbility?: 'int' | 'wis' | 'cha' | null;
  /** Spell slot pools per level (length 10; index 0 unused). */
  spellSlots?: SpellSlots;
  /** Known / prepared spells separate from physical inventory. */
  spells?: KnownSpell[];
  /** User-added actions/bonus/reactions/other not derived from inventory or spells. */
  customActions?: CustomAction[];
  /** Class / race / feat / other features the user tracks. */
  features?: CharacterFeature[];
  /** Structured class identifier (slug of CLASSES_2024 entry). Set by the
   *  character builder (phase 5) or the class picker in the level-up modal,
   *  used by phase 4 to look up level-progression data. */
  classId?: string;
  /** Hit die size (6/8/10/12). Derived from class but stored so the sheet
   *  works for imported characters too. Max hit dice = character level. */
  hitDieSize?: number;
  /** Number of hit dice the character can still spend before a long rest. */
  hitDiceCurrent?: number;
  /** Active condition slugs (matches CONDITIONS index from src/data/conditions.ts).
   *  Exhaustion is excluded from this list — it has its own counter below. */
  conditions?: string[];
  /** 2024 SRD exhaustion level (0..6). -2 to all D20 tests and -5ft speed per
   *  level; death at 6. Long rest reduces by 1. */
  exhaustion?: number;
  /** Chosen subclass slug from the matching Class's subclasses[] entries. */
  subclassId?: string;
  /** Free-form appearance/personality fields collected during creation. */
  details?: CharacterDetails;
  /** Number of hands available for wielding weapons/shields. Defaults to 2;
   *  raise it for many-armed creatures. Drives the inventory's over-equip guard. */
  hands?: number;
};

export const DEFAULT_GOLD: Gold = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
export const DEFAULT_DEATH_SAVES: DeathSaves = { successes: 0, failures: 0 };

export type Row = {
  id: string;
  campaign_id: string;
  owner_user_id: string | null;
  name: string;
  class: string | null;
  race: string | null;
  level: number;
  hp_current: number;
  hp_max: number;
  ac: number;
  notes: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function rowToMember(r: Row): PartyMember {
  const d = (r.data ?? {}) as Partial<PartyMember>;
  return {
    id: r.id,
    owner_user_id: r.owner_user_id,
    name: r.name,
    race: r.race ?? d.race ?? '',
    classSummary: r.class ?? d.classSummary ?? '',
    level: r.level,
    ac: r.ac,
    hp: r.hp_current,
    maxHp: r.hp_max,
    tempHp: d.tempHp ?? 0,
    speed: d.speed ?? '30 ft.',
    initiativeBonus: d.initiativeBonus ?? 0,
    passivePerception: d.passivePerception ?? 10,
    passiveInvestigation: d.passiveInvestigation ?? 10,
    passiveInsight: d.passiveInsight ?? 10,
    str: d.str ?? 10,
    dex: d.dex ?? 10,
    con: d.con ?? 10,
    int: d.int ?? 10,
    wis: d.wis ?? 10,
    cha: d.cha ?? 10,
    saves: d.saves ?? '',
    skills: d.skills ?? '',
    languages: d.languages ?? 'Common',
    player: d.player,
    ddbUrl: d.ddbUrl,
    notes: r.notes ?? d.notes ?? undefined,
    source: d.source ?? 'manual',
    xp: d.xp ?? 0,
    gold: d.gold ?? { ...DEFAULT_GOLD },
    deathSaves: d.deathSaves ?? { ...DEFAULT_DEATH_SAVES },
    skillProfs: d.skillProfs ?? [],
    saveProfs: d.saveProfs ?? [],
    inventory: d.inventory ?? [],
    spellAbility: d.spellAbility ?? null,
    spellSlots: d.spellSlots ?? DEFAULT_SPELL_SLOTS.map((s) => ({ ...s })),
    spells: d.spells ?? [],
    customActions: d.customActions ?? [],
    features: d.features ?? [],
    classId: d.classId,
    subclassId: d.subclassId,
    details: d.details,
    hitDieSize: d.hitDieSize,
    hitDiceCurrent: d.hitDiceCurrent,
    conditions: d.conditions ?? [],
    exhaustion: d.exhaustion ?? 0,
    hands: d.hands ?? 2,
  };
}

function memberToInsert(campaignId: string, m: Omit<PartyMember, 'id' | 'owner_user_id'>) {
  const { name, race, classSummary, level, hp, maxHp, ac, notes, ...rest } = m;
  return {
    campaign_id: campaignId,
    name,
    class: classSummary,
    race,
    level,
    hp_current: hp,
    hp_max: maxHp,
    ac,
    notes: notes ?? null,
    data: { ...rest, race, classSummary },
  };
}

function patchToUpdate(
  current: PartyMember,
  patch: Partial<PartyMember>
): Partial<Row> {
  const merged = { ...current, ...patch };
  const out: Partial<Row> = {};
  if ('name' in patch) out.name = merged.name;
  if ('classSummary' in patch) out.class = merged.classSummary;
  if ('race' in patch) out.race = merged.race;
  if ('level' in patch) out.level = merged.level;
  if ('hp' in patch) out.hp_current = merged.hp;
  if ('maxHp' in patch) out.hp_max = merged.maxHp;
  if ('ac' in patch) out.ac = merged.ac;
  if ('notes' in patch) out.notes = merged.notes ?? null;
  if ('owner_user_id' in patch) out.owner_user_id = merged.owner_user_id;

  const dataKeys: (keyof PartyMember)[] = [
    'tempHp', 'speed', 'initiativeBonus',
    'passivePerception', 'passiveInvestigation', 'passiveInsight',
    'str', 'dex', 'con', 'int', 'wis', 'cha',
    'saves', 'skills', 'languages', 'player', 'ddbUrl', 'source',
    'race', 'classSummary',
    'xp', 'gold', 'deathSaves', 'skillProfs', 'saveProfs', 'inventory',
    'spellAbility', 'spellSlots', 'spells', 'customActions', 'features',
    'classId', 'subclassId', 'details', 'hitDieSize', 'hitDiceCurrent',
    'conditions', 'exhaustion', 'hands',
  ];
  const needsDataUpdate = dataKeys.some((k) => k in patch);
  if (needsDataUpdate) {
    const { id: _id, owner_user_id: _o, ...rest } = merged;
    out.data = rest as unknown as Record<string, unknown>;
  }
  return out;
}

type PartyState = {
  party: PartyMember[];
  loaded: boolean;
  error: string | null;

  loadForCampaign: (campaignId: string) => Promise<void>;
  subscribe: (campaignId: string) => () => void;
  clear: () => void;

  addPartyMember: (campaignId: string, m: Omit<PartyMember, 'id' | 'owner_user_id'>) => Promise<string | null>;
  updatePartyMember: (id: string, patch: Partial<PartyMember>, fromSync?: boolean) => Promise<void>;
  removePartyMember: (id: string) => Promise<void>;
  claim: (id: string) => Promise<void>;
  unclaim: (id: string) => Promise<void>;
};

export const useParty = create<PartyState>((set, get) => ({
  party: [],
  loaded: false,
  error: null,

  loadForCampaign: async (campaignId) => {
    set({ loaded: false, error: null });
    const { data, error } = await supabase
      .from('party_members')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (error) {
      set({ error: error.message, loaded: true });
      return;
    }
    set({
      party: ((data ?? []) as Row[]).map(rowToMember),
      loaded: true,
    });
  },

  subscribe: (campaignId) => {
    const channel = supabase
      .channel(`party:${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'party_members', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const { party } = get();
          if (payload.eventType === 'INSERT') {
            const m = rowToMember(payload.new as Row);
            if (!party.find((x) => x.id === m.id)) {
              set({ party: [...party, m] });
            }
          } else if (payload.eventType === 'UPDATE') {
            const m = rowToMember(payload.new as Row);
            set({ party: party.map((x) => (x.id === m.id ? m : x)) });
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<Row>;
            set({ party: party.filter((x) => x.id !== old.id) });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  clear: () => set({ party: [], loaded: false, error: null }),

  addPartyMember: async (campaignId, m) => {
    const { data, error } = await supabase
      .from('party_members')
      .insert(memberToInsert(campaignId, m))
      .select()
      .single();
    if (error || !data) {
      set({ error: error?.message ?? 'Failed to add character' });
      return null;
    }
    const member = rowToMember(data as Row);
    set((s) => ({ party: [...s.party, member] }));
    return member.id;
  },

  updatePartyMember: async (id, patch, fromSync = false) => {
    const prev = get().party.find((p) => p.id === id);
    if (!prev) return;
    // Short-circuit no-op patches so the cross-surface HP sync chain
    // terminates after one round of writes instead of bouncing back through
    // the realtime echo.
    const changed = (Object.keys(patch) as (keyof PartyMember)[]).some(
      (k) => prev[k] !== patch[k],
    );
    if (!changed) return;
    const optimistic = { ...prev, ...patch };
    set((s) => ({ party: s.party.map((p) => (p.id === id ? optimistic : p)) }));
    const update = patchToUpdate(prev, patch);
    const { data, error } = await supabase
      .from('party_members')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      set((s) => ({
        party: s.party.map((p) => (p.id === id ? prev : p)),
        error: error.message,
      }));
    } else if (data) {
      const saved = rowToMember(data as Row);
      set((s) => ({ party: s.party.map((p) => (p.id === id ? saved : p)) }));
    }
    // Fan out HP changes to initiative + map so the sheet/party/init/map
    // all stay in lock-step. fromSync gates the re-entry: a sync-induced
    // update doesn't trigger another sync, otherwise rapid edits (e.g.
    // holding the down-arrow on the map HP input) race stale sync chains.
    if (!fromSync && (patch.hp !== undefined || patch.maxHp !== undefined)) {
      import('../hpLink').then((m) =>
        m.syncPcHpAfterChange({
          source: 'party',
          name: prev.name,
          ownerUserId: prev.owner_user_id,
          hp: patch.hp,
          maxHp: patch.maxHp,
        }),
      );
    }
  },

  removePartyMember: async (id) => {
    const prev = get().party;
    set((s) => ({ party: s.party.filter((p) => p.id !== id) }));
    const { error } = await supabase.from('party_members').delete().eq('id', id);
    if (error) set({ party: prev, error: error.message });
  },

  claim: async (id) => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    await get().updatePartyMember(id, { owner_user_id: uid });
  },

  unclaim: async (id) => {
    await get().updatePartyMember(id, { owner_user_id: null });
  },
}));
