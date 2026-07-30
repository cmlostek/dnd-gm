import { create } from 'zustand';
import { supabase } from '../../lib/supabase';

const STORAGE_KEY = 'dnd-gm:campaignId';
const NAME_KEY = 'dnd-gm:displayName';

export type Role = 'gm' | 'cogm' | 'player';

/** True when the actor has GM permissions (primary GM or co-GM). */
export const hasGmPerms = (r: Role | null) => r === 'gm' || r === 'cogm';

/**
 * Hook for "effective GM" — true when the user actually has GM perms AND
 * isn't currently in view-as-player mode. Use this anywhere UI gating
 * should respect the GM's preview toggle (which is most places).
 */
export const useIsGM = () =>
  useSession((s) => hasGmPerms(s.role) && !s.viewAsPlayer);

export type CampaignSummary = {
  id: string;
  name: string;
  join_code: string;
  role: Role;
  display_name: string;
};

type SessionState = {
  userId: string | null;
  email: string | null;
  campaignId: string | null;
  campaignName: string | null;
  joinCode: string | null;
  role: Role | null;
  displayName: string | null;
  myColor: string | null;
  myBio: string | null;
  loading: boolean;
  error: string | null;
  myCampaigns: CampaignSummary[];

  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Emails a password-reset link to the given address. */
  resetPassword: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Sets a new password for the current (recovery) session. */
  updatePassword: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * True after the user returns via a password-reset email link. While set,
   * the UI shows a "set a new password" screen instead of the app.
   */
  recovery: boolean;
  clearRecovery: () => void;
  refreshMyCampaigns: () => Promise<void>;
  createCampaign: (
    name: string,
    displayName: string,
    opts?: { hpRollingMethod?: 'avg' | 'roll' | 'manual'; encumbrance?: boolean },
  ) => Promise<void>;
  joinCampaign: (code: string, displayName: string) => Promise<void>;
  switchToCampaign: (campaignId: string) => Promise<void>;
  leaveCurrent: () => void;
  updateMyColor: (color: string) => Promise<void>;
  updateMyBio: (bio: string) => Promise<void>;
  updateMyDisplayName: (name: string) => Promise<void>;
  /** Global avatar storage path (in the `avatars` bucket). */
  myAvatarPath: string | null;
  loadMyProfile: () => Promise<void>;
  uploadMyAvatar: (file: File) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeMyAvatar: () => Promise<void>;
  /** Drops the user's membership row from the active campaign (real leave). */
  leaveCampaign: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** GM-only: deletes the active campaign and cascades everything. */
  deleteCampaign: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * UI-only "view as player" toggle. When on, an isGM-derived helper
   * downgrades the GM's effective role for UI gating so they can preview
   * what players see. Server-side RLS is unchanged — this never affects
   * what the GM can read or write, only what the UI shows.
   */
  viewAsPlayer: boolean;
  setViewAsPlayer: (v: boolean) => void;
};

const VIEW_AS_PLAYER_KEY = 'grimoire:viewAsPlayer';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomJoinCode(n = 6) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export const useSession = create<SessionState>((set, get) => ({
  userId: null,
  email: null,
  campaignId: null,
  campaignName: null,
  joinCode: null,
  role: null,
  displayName: null,
  myColor: null,
  myBio: null,
  myAvatarPath: null,
  viewAsPlayer: (() => {
    try { return localStorage.getItem(VIEW_AS_PLAYER_KEY) === '1'; }
    catch { return false; }
  })(),
  loading: true,
  error: null,
  myCampaigns: [],
  recovery: false,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        set({ loading: false });
        return;
      }
      const uid = session.user.id;
      const email = session.user.email ?? null;
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        set({ userId: uid, email, loading: false });
        get().refreshMyCampaigns();
        return;
      }
      const { data: mem, error } = await supabase
        .from('campaign_members')
        .select('role, display_name, color, bio, campaigns!inner(id, name, join_code)')
        .eq('campaign_id', stored)
        .eq('user_id', uid)
        .maybeSingle();
      if (error) throw error;
      if (!mem) {
        localStorage.removeItem(STORAGE_KEY);
        set({ userId: uid, email, loading: false });
        get().refreshMyCampaigns();
        return;
      }
      const campaign = mem.campaigns as unknown as { id: string; name: string; join_code: string };
      set({
        userId: uid,
        email,
        campaignId: campaign.id,
        campaignName: campaign.name,
        joinCode: campaign.join_code,
        role: mem.role as Role,
        displayName: mem.display_name,
        myColor: (mem.color as string | null) ?? '#94a3b8',
        myBio: (mem.bio as string | null) ?? '',
        loading: false,
      });
      get().refreshMyCampaigns();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      set({ error: msg, loading: false });
    }
  },

  signIn: async (email, password) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      set({ loading: false, error: error?.message ?? 'Sign in failed' });
      return;
    }
    set({ userId: data.user.id, email: data.user.email ?? null, loading: false });
    get().refreshMyCampaigns();
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) {
      set({ loading: false, error: error?.message ?? 'Sign up failed' });
      return;
    }
    // If email confirmation is required, data.session is null — prompt to confirm
    if (!data.session) {
      set({ loading: false, error: 'Check your email and click the confirmation link, then sign in.' });
      return;
    }
    set({ userId: data.user.id, email: data.user.email ?? null, loading: false });
    get().refreshMyCampaigns();
  },

  resetPassword: async (email) => {
    const trimmed = email.trim();
    if (!trimmed) return { ok: false, error: 'Enter your email first.' };
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: window.location.origin,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  updatePassword: async (password) => {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error || !data.user) {
      return { ok: false, error: error?.message ?? 'Could not update password' };
    }
    set({ recovery: false });
    return { ok: true };
  },

  clearRecovery: () => set({ recovery: false }),

  signOut: async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_KEY);
    set({
      userId: null,
      email: null,
      campaignId: null,
      campaignName: null,
      joinCode: null,
      role: null,
      displayName: null,
      myColor: null,
      myBio: null,
      error: null,
      myCampaigns: [],
    });
  },

  refreshMyCampaigns: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      set({ myCampaigns: [] });
      return;
    }
    const { data, error } = await supabase
      .from('campaign_members')
      .select('role, display_name, campaigns!inner(id, name, join_code, updated_at)')
      .eq('user_id', uid)
      .order('updated_at', { referencedTable: 'campaigns', ascending: false });
    if (error) {
      set({ error: error.message });
      return;
    }
    const rows = (data ?? []).map((row) => {
      const c = row.campaigns as unknown as { id: string; name: string; join_code: string };
      return {
        id: c.id,
        name: c.name,
        join_code: c.join_code,
        role: row.role as Role,
        display_name: row.display_name as string,
      };
    });
    set({ myCampaigns: rows });
  },

  switchToCampaign: async (campaignId) => {
    const uid = get().userId;
    if (!uid) return;
    const { data: mem, error } = await supabase
      .from('campaign_members')
      .select('role, display_name, color, bio, campaigns!inner(id, name, join_code)')
      .eq('campaign_id', campaignId)
      .eq('user_id', uid)
      .maybeSingle();
    if (error) {
      set({ error: error.message });
      return;
    }
    if (!mem) {
      set({ error: 'You are not a member of that campaign.' });
      return;
    }
    const campaign = mem.campaigns as unknown as { id: string; name: string; join_code: string };
    localStorage.setItem(STORAGE_KEY, campaign.id);
    localStorage.setItem(NAME_KEY, mem.display_name as string);
    set({
      campaignId: campaign.id,
      campaignName: campaign.name,
      joinCode: campaign.join_code,
      role: mem.role as Role,
      displayName: mem.display_name as string,
      myColor: (mem.color as string | null) ?? '#94a3b8',
      error: null,
    });
  },

  createCampaign: async (name, displayName, opts) => {
    set({ loading: true, error: null });
    try {
      const uid = get().userId;
      if (!uid) throw new Error('Not signed in');
      const code = randomJoinCode();
      const { data: campaign, error: cErr } = await supabase
        .from('campaigns')
        .insert({ name, join_code: code })
        .select()
        .single();
      if (cErr) throw cErr;
      const { error: mErr } = await supabase.from('campaign_members').insert({
        campaign_id: campaign.id,
        user_id: uid,
        display_name: displayName,
        role: 'gm',
      });
      if (mErr) throw mErr;
      localStorage.setItem(STORAGE_KEY, campaign.id);
      localStorage.setItem(NAME_KEY, displayName);
      // Seed the campaign's settings row with the GM's creation choices.
      // Falls back to DEFAULTS if the user didn't pick anything.
      const seed: Record<string, unknown> = {};
      if (opts?.hpRollingMethod) seed.hpRollingMethod = opts.hpRollingMethod;
      if (opts?.encumbrance !== undefined) seed.encumbrance = opts.encumbrance;
      if (Object.keys(seed).length > 0) {
        try {
          await supabase
            .from('campaign_settings')
            .upsert(
              {
                campaign_id: campaign.id,
                settings: seed,
              },
              { onConflict: 'campaign_id' },
            );
          // Mirror to localStorage so the setting is available before the
          // realtime subscription catches up.
          try {
            localStorage.setItem(
              `dnd-gm:campaignSettings:${campaign.id}`,
              JSON.stringify(seed),
            );
          } catch {
            /* private mode */
          }
        } catch {
          /* table may not exist yet */
        }
      }
      set({
        campaignId: campaign.id,
        campaignName: campaign.name,
        joinCode: campaign.join_code,
        role: 'gm',
        displayName,
        myColor: '#94a3b8',
        myBio: '',
        loading: false,
      });
      get().refreshMyCampaigns();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      set({ error: msg, loading: false });
    }
  },

  joinCampaign: async (code, displayName) => {
    set({ loading: true, error: null });
    try {
      const uid = get().userId;
      if (!uid) throw new Error('Not signed in');
      const upper = code.trim().toUpperCase();
      const { data: campaign, error: cErr } = await supabase
        .from('campaigns')
        .select('id, name, join_code')
        .eq('join_code', upper)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!campaign) throw new Error(`No campaign with code "${upper}"`);
      const { data: existing } = await supabase
        .from('campaign_members')
        .select('role, color, bio')
        .eq('campaign_id', campaign.id)
        .eq('user_id', uid)
        .maybeSingle();
      let role: Role = 'player';
      let color = '#94a3b8';
      let bio = '';
      if (existing) {
        role = existing.role as Role;
        color = (existing.color as string | null) ?? '#94a3b8';
        bio = (existing.bio as string | null) ?? '';
      } else {
        const { error: mErr } = await supabase.from('campaign_members').insert({
          campaign_id: campaign.id,
          user_id: uid,
          display_name: displayName,
          role: 'player',
        });
        if (mErr) throw mErr;
      }
      localStorage.setItem(STORAGE_KEY, campaign.id);
      localStorage.setItem(NAME_KEY, displayName);
      set({
        campaignId: campaign.id,
        campaignName: campaign.name,
        joinCode: campaign.join_code,
        role,
        displayName,
        myColor: color,
        myBio: bio,
        loading: false,
      });
      get().refreshMyCampaigns();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      set({ error: msg, loading: false });
    }
  },

  leaveCurrent: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({
      campaignId: null,
      campaignName: null,
      joinCode: null,
      role: null,
      displayName: null,
      myColor: null,
      myBio: null,
      error: null,
    });
  },

  updateMyColor: async (color) => {
    const uid = get().userId;
    const cid = get().campaignId;
    if (!uid || !cid) return;
    const prev = get().myColor;
    set({ myColor: color });
    const { error } = await supabase
      .from('campaign_members')
      .update({ color })
      .eq('campaign_id', cid)
      .eq('user_id', uid);
    if (error) {
      set({ myColor: prev });
      console.error('[session] updateMyColor failed', error);
    }
  },

  updateMyBio: async (bio) => {
    const uid = get().userId;
    const cid = get().campaignId;
    if (!uid || !cid) return;
    const prev = get().myBio;
    set({ myBio: bio });
    const { error } = await supabase
      .from('campaign_members')
      .update({ bio })
      .eq('campaign_id', cid)
      .eq('user_id', uid);
    if (error) {
      set({ myBio: prev });
      console.error('[session] updateMyBio failed', error);
    }
  },

  loadMyProfile: async () => {
    const uid = get().userId;
    if (!uid) return;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('avatar_path')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) {
      console.error('[session] loadMyProfile failed', error);
      return;
    }
    set({ myAvatarPath: (data?.avatar_path as string | null) ?? null });
  },

  uploadMyAvatar: async (file) => {
    const uid = get().userId;
    if (!uid) return { ok: false, error: 'Not signed in' };
    if (!file.type.startsWith('image/')) return { ok: false, error: 'Pick an image file.' };
    if (file.size > 2 * 1024 * 1024) return { ok: false, error: 'Image must be under 2 MB.' };

    // Use a fresh path per upload so the public URL changes — sidesteps CDN
    // caching of the old image.
    const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;

    const prevPath = get().myAvatarPath;

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error('[session] avatar upload failed', upErr);
      return { ok: false, error: upErr.message };
    }

    const { error: dbErr } = await supabase
      .from('user_profiles')
      .upsert({ user_id: uid, avatar_path: path, updated_at: new Date().toISOString() });
    if (dbErr) {
      console.error('[session] avatar row write failed', dbErr);
      // Roll back the storage upload to avoid orphans.
      await supabase.storage.from('avatars').remove([path]);
      return { ok: false, error: dbErr.message };
    }

    set({ myAvatarPath: path });

    // Best-effort cleanup of the previous file.
    if (prevPath && prevPath !== path) {
      void supabase.storage.from('avatars').remove([prevPath]);
    }

    return { ok: true };
  },

  leaveCampaign: async () => {
    const uid = get().userId;
    const cid = get().campaignId;
    if (!uid || !cid) return { ok: false, error: 'No active campaign.' };
    const { error } = await supabase
      .from('campaign_members')
      .delete()
      .eq('campaign_id', cid)
      .eq('user_id', uid);
    if (error) {
      console.error('[session] leaveCampaign failed', error);
      return { ok: false, error: error.message };
    }
    // Clear local campaign state; App.tsx will show the CampaignPicker.
    localStorage.removeItem(STORAGE_KEY);
    set({
      campaignId: null,
      campaignName: null,
      joinCode: null,
      role: null,
      displayName: null,
      myColor: null,
      myBio: null,
      error: null,
    });
    void get().refreshMyCampaigns();
    return { ok: true };
  },

  deleteCampaign: async () => {
    const cid = get().campaignId;
    if (!cid) return { ok: false, error: 'No active campaign.' };
    const { error } = await supabase.from('campaigns').delete().eq('id', cid);
    if (error) {
      console.error('[session] deleteCampaign failed', error);
      return { ok: false, error: error.message };
    }
    // ON DELETE CASCADE on every dependent table wipes the rest.
    localStorage.removeItem(STORAGE_KEY);
    set({
      campaignId: null,
      campaignName: null,
      joinCode: null,
      role: null,
      displayName: null,
      myColor: null,
      myBio: null,
      error: null,
    });
    void get().refreshMyCampaigns();
    return { ok: true };
  },

  setViewAsPlayer: (v) => {
    set({ viewAsPlayer: v });
    try {
      if (v) localStorage.setItem(VIEW_AS_PLAYER_KEY, '1');
      else localStorage.removeItem(VIEW_AS_PLAYER_KEY);
    } catch {
      /* ignore */
    }
  },

  removeMyAvatar: async () => {
    const uid = get().userId;
    if (!uid) return;
    const prev = get().myAvatarPath;
    if (!prev) return;
    set({ myAvatarPath: null });
    const { error } = await supabase
      .from('user_profiles')
      .upsert({ user_id: uid, avatar_path: null, updated_at: new Date().toISOString() });
    if (error) {
      set({ myAvatarPath: prev });
      console.error('[session] removeMyAvatar failed', error);
      return;
    }
    void supabase.storage.from('avatars').remove([prev]);
  },

  updateMyDisplayName: async (name) => {
    const uid = get().userId;
    const cid = get().campaignId;
    if (!uid || !cid) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const prev = get().displayName;
    set({ displayName: trimmed });
    localStorage.setItem(NAME_KEY, trimmed);
    const { error } = await supabase
      .from('campaign_members')
      .update({ display_name: trimmed })
      .eq('campaign_id', cid)
      .eq('user_id', uid);
    if (error) {
      set({ displayName: prev });
      console.error('[session] updateMyDisplayName failed', error);
    }
  },
}));

// When the user clicks the reset link in their email, Supabase establishes a
// temporary recovery session and fires this event — flip into recovery mode so
// the UI shows a "set a new password" screen instead of the app.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    useSession.setState({ recovery: true, loading: false });
  }
});

export function rememberedDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

/** Persist the default display name used to pre-fill create/join forms. */
export function setRememberedDisplayName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
  else localStorage.removeItem(NAME_KEY);
}
