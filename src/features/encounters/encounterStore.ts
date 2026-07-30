import { create } from 'zustand';
import { supabase } from '../../lib/supabase';

/** A creature line in a saved encounter. Name/CR/XP are denormalised so the
 *  encounter still reads correctly if the source stat block is later edited or
 *  deleted. */
export type EncounterCreature = {
  sourceKind: 'srd-monster' | 'statblock' | 'npc';
  sourceId: string;
  name: string;
  cr: string;
  xp: number;
  count: number;
};

export type Encounter = {
  id: string;
  name: string;
  creatures: EncounterCreature[];
  notes: string;
};

type Row = Record<string, unknown>;

function rowToEncounter(r: Row): Encounter {
  const d = (r.data ?? {}) as { creatures?: EncounterCreature[]; notes?: string };
  return {
    id: r.id as string,
    name: (r.name as string) ?? 'Untitled',
    creatures: d.creatures ?? [],
    notes: d.notes ?? '',
  };
}

interface EncounterState {
  encounters: Encounter[];
  campaignId: string | null;
  loaded: boolean;
  error: string | null;

  loadForCampaign(id: string): Promise<void>;
  subscribe(id: string): () => void;
  clear(): void;

  create(name?: string): Promise<string | null>;
  rename(id: string, name: string): Promise<void>;
  setCreatures(id: string, creatures: EncounterCreature[]): Promise<void>;
  setNotes(id: string, notes: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Persist the jsonb payload for one encounter. */
async function writeData(id: string, e: Encounter) {
  const { error } = await supabase
    .from('encounters')
    .update({ data: { creatures: e.creatures, notes: e.notes } })
    .eq('id', id);
  return error?.message ?? null;
}

export const useEncounters = create<EncounterState>((set, get) => ({
  encounters: [],
  campaignId: null,
  loaded: false,
  error: null,

  loadForCampaign: async (id) => {
    const { data, error } = await supabase
      .from('encounters')
      .select('*')
      .eq('campaign_id', id)
      .order('created_at', { ascending: true });
    if (error) {
      set({ error: error.message, loaded: true, campaignId: id });
      return;
    }
    set({
      encounters: (data ?? []).map(rowToEncounter),
      campaignId: id,
      loaded: true,
      error: null,
    });
  },

  subscribe: (id) => {
    const ch = supabase
      .channel(`encounters:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encounters', filter: `campaign_id=eq.${id}` },
        ({ eventType, new: r, old }) => {
          if (eventType === 'INSERT') {
            const next = rowToEncounter(r as Row);
            set((s) => (s.encounters.some((x) => x.id === next.id) ? s : { encounters: [...s.encounters, next] }));
          } else if (eventType === 'UPDATE') {
            const next = rowToEncounter(r as Row);
            set((s) => ({ encounters: s.encounters.map((x) => (x.id === next.id ? next : x)) }));
          } else if (eventType === 'DELETE') {
            set((s) => ({ encounters: s.encounters.filter((x) => x.id !== (old as Row).id) }));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },

  clear: () => set({ encounters: [], loaded: false, campaignId: null, error: null }),

  create: async (name) => {
    const { campaignId } = get();
    if (!campaignId) return null;
    const { data, error } = await supabase
      .from('encounters')
      .insert({ campaign_id: campaignId, name: name ?? 'New encounter', data: { creatures: [], notes: '' } })
      .select()
      .single();
    if (error || !data) {
      set({ error: error?.message ?? 'Could not create encounter' });
      return null;
    }
    const e = rowToEncounter(data as Row);
    set((s) => (s.encounters.some((x) => x.id === e.id) ? s : { encounters: [...s.encounters, e] }));
    return e.id;
  },

  rename: async (id, name) => {
    set((s) => ({ encounters: s.encounters.map((e) => (e.id === id ? { ...e, name } : e)) }));
    const { error } = await supabase.from('encounters').update({ name }).eq('id', id);
    if (error) set({ error: error.message });
  },

  setCreatures: async (id, creatures) => {
    const prev = get().encounters.find((e) => e.id === id);
    if (!prev) return;
    const next = { ...prev, creatures };
    set((s) => ({ encounters: s.encounters.map((e) => (e.id === id ? next : e)) }));
    const err = await writeData(id, next);
    if (err) set({ error: err });
  },

  setNotes: async (id, notes) => {
    const prev = get().encounters.find((e) => e.id === id);
    if (!prev) return;
    const next = { ...prev, notes };
    set((s) => ({ encounters: s.encounters.map((e) => (e.id === id ? next : e)) }));
    const err = await writeData(id, next);
    if (err) set({ error: err });
  },

  remove: async (id) => {
    const prev = get().encounters;
    set((s) => ({ encounters: s.encounters.filter((e) => e.id !== id) }));
    const { error } = await supabase.from('encounters').delete().eq('id', id);
    if (error) set({ encounters: prev, error: error.message });
  },
}));
