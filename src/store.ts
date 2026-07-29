import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Combatant = {
  id: string;
  name: string;
  initiative: number;
  hp: number;
  maxHp: number;
  ac: number;
  isPC: boolean;
  notes?: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  updatedAt: number;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  expanded: boolean;
};

export type HomebrewItem = {
  id: string;
  campaign: string;
  name: string;
  category: string;
  rarity?: string;
  priceGp?: number;
  weight?: number;
  properties?: string;
  desc: string;
  /** Optional item-icon key (see data/itemIcons). Falls back to a category
   *  guess when unset. */
  icon?: string;
  updatedAt: number;
};

export type HomebrewSpell = {
  id: string;
  campaign: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  ritual: boolean;
  concentration: boolean;
  classes: string;
  desc: string;
  higherLevel?: string;
  updatedAt: number;
};

export type MapToken = {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  emoji?: string;
  size: number;
};

export type MapShape =
  | { id: string; kind: 'circle'; x: number; y: number; r: number; color: string }
  | { id: string; kind: 'square'; x: number; y: number; w: number; h: number; color: string }
  | { id: string; kind: 'cone'; x: number; y: number; dx: number; dy: number; color: string };

export type MapRuler = { x1: number; y1: number; x2: number; y2: number } | null;

type State = {
  combatants: Combatant[];
  round: number;
  turnIndex: number;
  addCombatant: (c: Omit<Combatant, 'id'>) => void;
  updateCombatant: (id: string, patch: Partial<Combatant>) => void;
  removeCombatant: (id: string) => void;
  nextTurn: () => void;
  resetInitiative: () => void;
  sortInitiative: () => void;

  notes: Note[];
  activeNoteId: string | null;
  folders: Folder[];
  createNote: (folderId?: string | null) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  setActiveNote: (id: string | null) => void;
  createFolder: (name: string, parentId?: string | null) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolder: (id: string) => void;
  moveNote: (id: string, folderId: string | null) => void;
  moveFolder: (id: string, parentId: string | null) => void;

  mapBgUrl: string | null;
  mapGridSize: number;
  mapShowGrid: boolean;
  tokens: MapToken[];
  shapes: MapShape[];
  setMapBg: (url: string | null) => void;
  setMapGridSize: (n: number) => void;
  setShowGrid: (b: boolean) => void;
  addToken: (t: Omit<MapToken, 'id'>) => void;
  updateToken: (id: string, patch: Partial<MapToken>) => void;
  removeToken: (id: string) => void;
  addShape: (s: MapShape) => void;
  removeShape: (id: string) => void;
  clearShapes: () => void;

  statBlocks: StatBlock[];
  activeStatBlockId: string | null;
  createStatBlock: (edition: '2014' | '2024') => string;
  updateStatBlock: (id: string, patch: Partial<StatBlock>) => void;
  deleteStatBlock: (id: string) => void;
  setActiveStatBlock: (id: string | null) => void;

  party: PartyMember[];
  addPartyMember: (m: Omit<PartyMember, 'id'>) => string;
  updatePartyMember: (id: string, patch: Partial<PartyMember>) => void;
  removePartyMember: (id: string) => void;

  homebrewItems: HomebrewItem[];
  homebrewSpells: HomebrewSpell[];
  addHomebrewItem: (i: Omit<HomebrewItem, 'id' | 'updatedAt'>) => string;
  updateHomebrewItem: (id: string, patch: Partial<HomebrewItem>) => void;
  removeHomebrewItem: (id: string) => void;
  addHomebrewSpell: (s: Omit<HomebrewSpell, 'id' | 'updatedAt'>) => string;
  updateHomebrewSpell: (id: string, patch: Partial<HomebrewSpell>) => void;
  removeHomebrewSpell: (id: string) => void;

  /** GM-authored description overrides for SRD items, keyed by SRD index slug.
   *  Lets a table replace or fill in an item's reference text (e.g. the ~130
   *  basic gear entries the SRD ships without prose). Empty string clears. */
  itemDescOverrides: Record<string, string>;
  setItemDescOverride: (index: string, desc: string) => void;
};

export type StatBlockAction = {
  id: string;
  name: string;
  desc: string;
};

export type PartyMember = {
  id: string;
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
};

export type StatBlock = {
  id: string;
  edition: '2014' | '2024';
  campaign?: string;
  /** Optional single-character emoji used when placing this creature as a
   *  map token. Falls back to 📜 if empty. */
  emoji?: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  acNote: string;
  hp: number;
  hitDice: string;
  speed: string;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  saves: string;
  skills: string;
  damageVulnerabilities: string;
  damageResistances: string;
  damageImmunities: string;
  conditionImmunities: string;
  senses: string;
  languages: string;
  cr: string;
  xp: number;
  pb: number;
  traits: StatBlockAction[];
  actions: StatBlockAction[];
  bonusActions: StatBlockAction[];
  reactions: StatBlockAction[];
  legendaryActions: StatBlockAction[];
  legendaryDesc: string;
};

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      combatants: [],
      round: 1,
      turnIndex: 0,
      addCombatant: (c) => set((s) => ({ combatants: [...s.combatants, { ...c, id: uid() }] })),
      updateCombatant: (id, patch) =>
        set((s) => ({
          combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      removeCombatant: (id) =>
        set((s) => ({ combatants: s.combatants.filter((c) => c.id !== id) })),
      nextTurn: () =>
        set((s) => {
          if (s.combatants.length === 0) return s;
          const ni = s.turnIndex + 1;
          if (ni >= s.combatants.length) return { turnIndex: 0, round: s.round + 1 };
          return { turnIndex: ni };
        }),
      resetInitiative: () => set({ round: 1, turnIndex: 0 }),
      sortInitiative: () =>
        set((s) => ({
          combatants: [...s.combatants].sort((a, b) => b.initiative - a.initiative),
          turnIndex: 0,
        })),

      notes: [],
      activeNoteId: null,
      folders: [],
      createNote: (folderId = null) => {
        const id = uid();
        const note: Note = { id, title: 'Untitled', body: '', folderId, updatedAt: Date.now() };
        set((s) => ({ notes: [note, ...s.notes], activeNoteId: id }));
        return id;
      },
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
        })),
      deleteNote: (id) =>
        set((s) => ({
          notes: s.notes.filter((n) => n.id !== id),
          activeNoteId: s.activeNoteId === id ? null : s.activeNoteId,
        })),
      setActiveNote: (id) => set({ activeNoteId: id }),
      createFolder: (name, parentId = null) => {
        const id = uid();
        const folder: Folder = { id, name: name || 'New Folder', parentId, expanded: true };
        set((s) => ({ folders: [...s.folders, folder] }));
        return id;
      },
      renameFolder: (id, name) =>
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),
      deleteFolder: (id) =>
        set((s) => {
          const collectIds = (fid: string): string[] => {
            const kids = s.folders.filter((f) => f.parentId === fid).map((f) => f.id);
            return [fid, ...kids.flatMap(collectIds)];
          };
          const ids = new Set(collectIds(id));
          return {
            folders: s.folders.filter((f) => !ids.has(f.id)),
            notes: s.notes.map((n) => (n.folderId && ids.has(n.folderId) ? { ...n, folderId: null } : n)),
          };
        }),
      toggleFolder: (id) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, expanded: !f.expanded } : f)),
        })),
      moveNote: (id, folderId) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, folderId } : n)) })),
      moveFolder: (id, parentId) =>
        set((s) => {
          if (id === parentId) return s;
          const isDescendant = (candidateId: string | null): boolean => {
            if (!candidateId) return false;
            if (candidateId === id) return true;
            const parent = s.folders.find((f) => f.id === candidateId);
            return parent ? isDescendant(parent.parentId) : false;
          };
          if (isDescendant(parentId)) return s;
          return { folders: s.folders.map((f) => (f.id === id ? { ...f, parentId } : f)) };
        }),

      mapBgUrl: null,
      mapGridSize: 50,
      mapShowGrid: true,
      tokens: [],
      shapes: [],
      setMapBg: (url) => set({ mapBgUrl: url }),
      setMapGridSize: (n) => set({ mapGridSize: Math.max(10, Math.min(200, n)) }),
      setShowGrid: (b) => set({ mapShowGrid: b }),
      addToken: (t) => set((s) => ({ tokens: [...s.tokens, { ...t, id: uid() }] })),
      updateToken: (id, patch) =>
        set((s) => ({ tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      removeToken: (id) => set((s) => ({ tokens: s.tokens.filter((t) => t.id !== id) })),
      addShape: (s) => set((state) => ({ shapes: [...state.shapes, s] })),
      removeShape: (id) => set((s) => ({ shapes: s.shapes.filter((sh) => sh.id !== id) })),
      clearShapes: () => set({ shapes: [] }),

      statBlocks: [],
      activeStatBlockId: null,
      createStatBlock: (edition) => {
        const id = uid();
        const sb: StatBlock = {
          id,
          edition,
          emoji: '',
          name: 'New Creature',
          size: 'Medium',
          type: 'humanoid',
          alignment: 'neutral',
          ac: 12,
          acNote: '',
          hp: 10,
          hitDice: '2d8',
          speed: '30 ft.',
          str: 10,
          dex: 10,
          con: 10,
          int: 10,
          wis: 10,
          cha: 10,
          saves: '',
          skills: '',
          damageVulnerabilities: '',
          damageResistances: '',
          damageImmunities: '',
          conditionImmunities: '',
          senses: 'passive Perception 10',
          languages: '—',
          cr: '1/4',
          xp: 50,
          pb: 2,
          traits: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          legendaryActions: [],
          legendaryDesc: '',
        };
        set((s) => ({ statBlocks: [...s.statBlocks, sb], activeStatBlockId: id }));
        return id;
      },
      updateStatBlock: (id, patch) =>
        set((s) => ({
          statBlocks: s.statBlocks.map((sb) => (sb.id === id ? { ...sb, ...patch } : sb)),
        })),
      deleteStatBlock: (id) =>
        set((s) => ({
          statBlocks: s.statBlocks.filter((sb) => sb.id !== id),
          activeStatBlockId: s.activeStatBlockId === id ? null : s.activeStatBlockId,
        })),
      setActiveStatBlock: (id) => set({ activeStatBlockId: id }),

      party: [],
      addPartyMember: (m) => {
        const id = uid();
        set((s) => ({ party: [...s.party, { ...m, id }] }));
        return id;
      },
      updatePartyMember: (id, patch) =>
        set((s) => ({ party: s.party.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePartyMember: (id) => set((s) => ({ party: s.party.filter((p) => p.id !== id) })),

      homebrewItems: [],
      homebrewSpells: [],
      addHomebrewItem: (i) => {
        const id = uid();
        set((s) => ({ homebrewItems: [...s.homebrewItems, { ...i, id, updatedAt: Date.now() }] }));
        return id;
      },
      updateHomebrewItem: (id, patch) =>
        set((s) => ({
          homebrewItems: s.homebrewItems.map((i) =>
            i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i
          ),
        })),
      removeHomebrewItem: (id) =>
        set((s) => ({ homebrewItems: s.homebrewItems.filter((i) => i.id !== id) })),
      addHomebrewSpell: (sp) => {
        const id = uid();
        set((s) => ({ homebrewSpells: [...s.homebrewSpells, { ...sp, id, updatedAt: Date.now() }] }));
        return id;
      },
      updateHomebrewSpell: (id, patch) =>
        set((s) => ({
          homebrewSpells: s.homebrewSpells.map((sp) =>
            sp.id === id ? { ...sp, ...patch, updatedAt: Date.now() } : sp
          ),
        })),
      removeHomebrewSpell: (id) =>
        set((s) => ({ homebrewSpells: s.homebrewSpells.filter((sp) => sp.id !== id) })),

      itemDescOverrides: {},
      setItemDescOverride: (index, desc) =>
        set((s) => {
          const next = { ...s.itemDescOverrides };
          if (desc.trim() === '') delete next[index];
          else next[index] = desc;
          return { itemDescOverrides: next };
        }),
    }),
    {
      name: 'gm-screen-v1',
      migrate: (state: any) => {
        if (state && Array.isArray(state.notes)) {
          state.notes = state.notes.map((n: any) => ({ folderId: null, ...n }));
        }
        if (state && !Array.isArray(state.folders)) state.folders = [];
        if (state && !Array.isArray(state.homebrewItems)) state.homebrewItems = [];
        if (state && !Array.isArray(state.homebrewSpells)) state.homebrewSpells = [];
        if (state && (typeof state.itemDescOverrides !== 'object' || state.itemDescOverrides === null))
          state.itemDescOverrides = {};
        return state;
      },
    }
  )
);
