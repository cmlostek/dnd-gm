/**
 * Campaign-level settings: page visibility, folder visibility, folder colors.
 *
 * Primary storage: Supabase `campaign_settings` table (upsert).
 * Fallback: localStorage per campaign ID (works without any DB migration).
 *
 * SQL migration to run for full cross-device support:
 *
 *   CREATE TABLE IF NOT EXISTS campaign_settings (
 *     campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
 *     settings    JSONB NOT NULL DEFAULT '{}'
 *   );
 *   ALTER TABLE campaign_settings ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Members read settings"  ON campaign_settings FOR SELECT
 *     USING (EXISTS (
 *       SELECT 1 FROM campaign_members
 *       WHERE campaign_id = campaign_settings.campaign_id AND user_id = auth.uid()
 *     ));
 *   CREATE POLICY "GM write settings" ON campaign_settings FOR ALL
 *     USING (EXISTS (
 *       SELECT 1 FROM campaign_members
 *       WHERE campaign_id = campaign_settings.campaign_id
 *         AND user_id = auth.uid() AND role = 'gm'
 *     ));
 */
import { create } from 'zustand';
import { supabase } from '../../lib/supabase';

export type SrdEdition = '2014' | '2024' | 'both';

/** How characters in this campaign gain HP on level-up.
 *   - avg: take fixed average from the class hit die (5e PHB rounded up)
 *   - roll: roll the hit die at the table; result becomes new HP
 *   - manual: GM/player types in whatever the table agreed on
 */
export type HpRollingMethod = 'avg' | 'roll' | 'manual';

/** Coin denominations, ordered high → low value. */
export const COIN_KEYS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
export type CoinKey = (typeof COIN_KEYS)[number];
/** Each coin's value expressed in the common base unit (copper). Drives the
 *  character-sheet currency converter. The GM can override for house economies
 *  (e.g. dropping electrum, or a silver standard). */
export type CoinRates = Record<CoinKey, number>;

/** Standard 5e values in copper: 1 sp = 10cp, 1 ep = 50cp, 1 gp = 100cp,
 *  1 pp = 1000cp. */
export const DEFAULT_COIN_RATES: CoinRates = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

export type CampaignSettings = {
  /** Nav path slugs hidden from non-GM players (e.g. 'spells', 'rules'). */
  hiddenPages: string[];
  /** GM-only page slugs shared with players (e.g. 'initiative'). */
  allowedGmPages: string[];
  /** Folder IDs hidden from non-GM players. */
  hiddenFolderIds: string[];
  /** folderId → hex color string. */
  folderColors: Record<string, string>;
  /** Which SRD edition(s) to show on Spells/Items/Rules. GM-controlled. */
  srdEdition: SrdEdition;
  /** Default HP-on-level-up method for this campaign. The level-up modal
   *  starts here but lets the player override per-level. */
  hpRollingMethod: HpRollingMethod;
  /** Per-coin value (in copper) used by the currency converter. GM-set. */
  coinRates: CoinRates;
  /** When on, the character sheet tracks carried weight against a STR-based
   *  carrying capacity. Off = unlimited (no encumbrance). */
  encumbrance: boolean;
  /** Which edition's encounter-difficulty maths to use. 'auto' follows
   *  srdEdition (falling back to 2014 when that's set to 'both'); the explicit
   *  values let a table run, say, 2024 content on 2014 encounter budgets. */
  encounterEdition: 'auto' | '2014' | '2024';
};

export const DEFAULTS: CampaignSettings = {
  hiddenPages: [],
  allowedGmPages: [],
  hiddenFolderIds: [],
  folderColors: {},
  srdEdition: 'both',
  hpRollingMethod: 'avg',
  coinRates: { ...DEFAULT_COIN_RATES },
  encumbrance: false,
  encounterEdition: 'auto',
};

/** Resolve the effective encounter-maths edition from campaign settings. */
export function resolveEncounterEdition(s: Pick<CampaignSettings, 'encounterEdition' | 'srdEdition'>): '2014' | '2024' {
  const pref = s.encounterEdition ?? 'auto';
  if (pref === '2014' || pref === '2024') return pref;
  // 'both' has no single answer; 2014 is the conservative default because its
  // multiplier rates group fights as harder.
  return s.srdEdition === '2024' ? '2024' : '2014';
}

const lsKey = (cid: string) => `dnd-gm:campaignSettings:${cid}`;

function lsLoad(cid: string): CampaignSettings {
  try {
    const raw = localStorage.getItem(lsKey(cid));
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function lsSave(cid: string, s: CampaignSettings) {
  localStorage.setItem(lsKey(cid), JSON.stringify(s));
}

async function sbUpsert(cid: string, s: CampaignSettings) {
  try {
    await supabase
      .from('campaign_settings')
      .upsert({ campaign_id: cid, settings: s }, { onConflict: 'campaign_id' });
  } catch {
    /* table may not exist yet — localStorage is the fallback */
  }
}

type SettingsState = {
  settings: CampaignSettings;
  campaignId: string | null;

  load: (cid: string) => Promise<void>;
  subscribe: (cid: string) => () => void;

  togglePage: (page: string) => void;
  toggleGmPage: (page: string) => void;
  hideAll: (pages: string[]) => void;
  showAll: () => void;
  toggleFolder: (folderId: string) => void;
  setFolderColor: (folderId: string, color: string | null) => void;
  setSrdEdition: (edition: SrdEdition) => void;
  setHpRollingMethod: (method: HpRollingMethod) => void;
  setCoinRate: (coin: CoinKey, value: number) => void;
  resetCoinRates: () => void;
  setEncumbrance: (on: boolean) => void;
  setEncounterEdition: (e: 'auto' | '2014' | '2024') => void;
};

export const useCampaignSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,
  campaignId: null,

  load: async (cid) => {
    set({ campaignId: cid });
    // Instant local read so UI is never empty
    set({ settings: lsLoad(cid) });

    try {
      const { data, error } = await supabase
        .from('campaign_settings')
        .select('settings')
        .eq('campaign_id', cid)
        .maybeSingle();
      if (error) return; // table doesn't exist yet
      if (data?.settings) {
        const merged = { ...DEFAULTS, ...(data.settings as Partial<CampaignSettings>) };
        lsSave(cid, merged);
        set({ settings: merged });
      }
    } catch {
      /* fail silently */
    }
  },

  subscribe: (cid) => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`campaign_settings:${cid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'campaign_settings',
            filter: `campaign_id=eq.${cid}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const s = (payload.new as { settings: CampaignSettings }).settings;
              const merged = { ...DEFAULTS, ...s };
              lsSave(cid, merged);
              set({ settings: merged });
            }
          }
        )
        .subscribe();
    } catch {
      /* realtime may not be enabled */
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  },

  togglePage: (page) => {
    const { settings, campaignId } = get();
    const hiddenPages = settings.hiddenPages.includes(page)
      ? settings.hiddenPages.filter((p) => p !== page)
      : [...settings.hiddenPages, page];
    const next = { ...settings, hiddenPages };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  toggleGmPage: (page) => {
    const { settings, campaignId } = get();
    const allowedGmPages = (settings.allowedGmPages ?? []).includes(page)
      ? (settings.allowedGmPages ?? []).filter((p) => p !== page)
      : [...(settings.allowedGmPages ?? []), page];
    const next = { ...settings, allowedGmPages };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  hideAll: (pages) => {
    const { settings, campaignId } = get();
    const next = { ...settings, hiddenPages: pages };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  showAll: () => {
    const { settings, campaignId } = get();
    const next = { ...settings, hiddenPages: [] };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  toggleFolder: (folderId) => {
    const { settings, campaignId } = get();
    const hiddenFolderIds = settings.hiddenFolderIds.includes(folderId)
      ? settings.hiddenFolderIds.filter((id) => id !== folderId)
      : [...settings.hiddenFolderIds, folderId];
    const next = { ...settings, hiddenFolderIds };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  setFolderColor: (folderId, color) => {
    const { settings, campaignId } = get();
    const folderColors = { ...settings.folderColors };
    if (color) folderColors[folderId] = color;
    else delete folderColors[folderId];
    const next = { ...settings, folderColors };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  setSrdEdition: (edition) => {
    const { settings, campaignId } = get();
    const next = { ...settings, srdEdition: edition };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  setHpRollingMethod: (method) => {
    const { settings, campaignId } = get();
    const next = { ...settings, hpRollingMethod: method };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  setCoinRate: (coin, value) => {
    const { settings, campaignId } = get();
    const rates = { ...(settings.coinRates ?? DEFAULT_COIN_RATES), [coin]: Math.max(0, Math.round(value) || 0) };
    const next = { ...settings, coinRates: rates };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  resetCoinRates: () => {
    const { settings, campaignId } = get();
    const next = { ...settings, coinRates: { ...DEFAULT_COIN_RATES } };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  setEncumbrance: (on) => {
    const { settings, campaignId } = get();
    const next = { ...settings, encumbrance: on };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },

  setEncounterEdition: (e) => {
    const { settings, campaignId } = get();
    const next = { ...settings, encounterEdition: e };
    set({ settings: next });
    if (campaignId) {
      lsSave(campaignId, next);
      sbUpsert(campaignId, next);
    }
  },
}));
