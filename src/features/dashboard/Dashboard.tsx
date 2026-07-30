import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Check, X, UserPlus, MessageCircle, Camera, Trash2, User as UserIcon, Dice6, Shield, UserMinus, LogOut, ScrollText, Users as UsersIcon, ChevronLeft, ChevronRight, Wand2, FileText, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '../session/sessionStore';
import { useRoleColors, roleColor } from '../session/roleColorsStore';
import { useParty } from '../party/partyStore';
import { CharCard } from '../party/Party';
import ChatPanel from '../chat/ChatPanel';
import { useChat, type ChatMember } from '../chat/chatStore';
import { useChatPanel } from '../chat/chatPanelStore';
import { useProfiles, avatarPublicUrl } from '../profiles/profilesStore';
import { useNotes, canViewNote, canEditNote, EMPTY_PERMS, type Note, type NotePermission } from '../notes/notesStore';
import { supabase } from '../../lib/supabase';
import DiceRoller from '../dice/DiceRoller';
import CharacterSheet from './CharacterSheet';
import { useDashboardPref } from './dashboardPrefStore';
import CharacterBuilder from './CharacterBuilder';
import MemberProfileModal from './MemberProfileModal';
import CampaignSpectatorView from './CampaignSpectatorView';
import NotePeekModal from './NotePeekModal';

type DashboardTab = 'profile' | 'character' | 'chat' | 'dice';

/**
 * Player dashboard — landing page after entering a campaign. Phase 1: display
 * name editor, bio, per-campaign color, and embedded chat. Phases 2 & 3 will
 * add the character sheet (party_members row) and avatars + favorites.
 */
export default function Dashboard() {
  const userId = useSession((s) => s.userId);
  const campaignId = useSession((s) => s.campaignId);
  const displayName = useSession((s) => s.displayName);
  const myColor = useSession((s) => s.myColor);
  const role = useSession((s) => s.role);
  const myBio = useSession((s) => s.myBio);
  const updateMyDisplayName = useSession((s) => s.updateMyDisplayName);
  const updateMyColor = useSession((s) => s.updateMyColor);
  const updateMyBio = useSession((s) => s.updateMyBio);
  const myAvatarPath = useSession((s) => s.myAvatarPath);
  const loadMyProfile = useSession((s) => s.loadMyProfile);
  const uploadMyAvatar = useSession((s) => s.uploadMyAvatar);
  const removeMyAvatar = useSession((s) => s.removeMyAvatar);
  const refreshMyCampaigns = useSession((s) => s.refreshMyCampaigns);
  const profiles = useProfiles((s) => s.profiles);

  // Hydrate the global profile (avatar) for this user on mount.
  useEffect(() => {
    void loadMyProfile();
  }, [userId, loadMyProfile]);

  // Keep "your other campaigns" fresh — cheap idempotent fetch, and the
  // list can go stale if the user joined/created a campaign elsewhere.
  useEffect(() => {
    void refreshMyCampaigns();
  }, [userId, refreshMyCampaigns]);

  const party = useParty((s) => s.party);
  const partyLoaded = useParty((s) => s.loaded);
  const loadParty = useParty((s) => s.loadForCampaign);
  const subscribeParty = useParty((s) => s.subscribe);
  const updateMember = useParty((s) => s.updatePartyMember);
  const removeMember = useParty((s) => s.removePartyMember);
  const claimMember = useParty((s) => s.claim);
  const unclaimMember = useParty((s) => s.unclaim);
  const addMember = useParty((s) => s.addPartyMember);
  const loadChat = useChat((s) => s.loadForCampaign);
  const chatLoaded = useChat((s) => s.loaded);
  const [showBuilder, setShowBuilder] = useState(false);
  const [profileTarget, setProfileTarget] = useState<ChatMember | null>(null);
  const [spectatingCampaignId, setSpectatingCampaignId] = useState<string | null>(null);
  const setWhisperTarget = useChatPanel((s) => s.setWhisperTarget);

  const notes = useNotes((s) => s.notes);
  const notePermissions = useNotes((s) => s.permissions);
  const loadNotes = useNotes((s) => s.loadForCampaign);
  const subscribeNotes = useNotes((s) => s.subscribe);
  const [peekNote, setPeekNote] = useState<Note | null>(null);

  // Dashboard is often the first page visited, so the Party feature may not
  // have loaded yet. Loading here is cheap (idempotent server fetch).
  useEffect(() => {
    if (!campaignId) return;
    loadParty(campaignId);
    return subscribeParty(campaignId);
  }, [campaignId, loadParty, subscribeParty]);

  // Same reasoning as Party above — "Recent notes" needs the notes store
  // loaded even if the user never opens the Notes page this session.
  useEffect(() => {
    if (!campaignId) return;
    loadNotes(campaignId);
    return subscribeNotes(campaignId);
  }, [campaignId, loadNotes, subscribeNotes]);

  // Chat used to be an always-mounted side column, which kept useChat.members
  // populated for the GM "all characters" view. Now that chat is a tab, the
  // store doesn't load until someone opens it — load eagerly so owner labels
  // on the GM view stay populated.
  useEffect(() => {
    if (!campaignId || chatLoaded) return;
    void loadChat(campaignId);
  }, [campaignId, chatLoaded, loadChat]);

  // The player can own at most one character per campaign by design.
  const myCharacter = useMemo(
    () => (userId ? party.find((p) => p.owner_user_id === userId) ?? null : null),
    [party, userId]
  );

  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const isGM = (role === 'gm' || role === 'cogm') && !viewAsPlayer;
  // Land on the user's preferred default tab (Settings → Display). Read once at
  // mount so navigating between tabs afterwards isn't overridden.
  const [tab, setTab] = useState<DashboardTab>(() => useDashboardPref.getState().defaultTab);

  // On the very first dashboard load for a player who's joined a campaign and
  // has no claimed character yet, auto-open the builder so onboarding is
  // obvious. We only fire once per (user, campaign) — the localStorage flag
  // keeps subsequent visits quiet.
  useEffect(() => {
    if (!partyLoaded || !campaignId || !userId) return;
    if (isGM) return;
    if (myCharacter) return;
    const flagKey = `grimoire:welcomed:${campaignId}:${userId}`;
    if (localStorage.getItem(flagKey)) return;
    setShowBuilder(true);
    localStorage.setItem(flagKey, '1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyLoaded, campaignId, userId, isGM]);

  const handleBuilderCreate = async (m: Parameters<typeof addMember>[1]) => {
    if (!campaignId) return;
    const newId = await addMember(campaignId, m);
    // Player-created characters auto-claim; GMs leave them unclaimed in case
    // someone else is supposed to own the row.
    if (newId && !isGM) await claimMember(newId);
    setShowBuilder(false);
  };

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* ── Main column (profile header + tabs + tab content) ──────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 flex items-center gap-3 sm:gap-4">
          <AvatarUpload
            color={myColor ?? '#94a3b8'}
            initial={(displayName ?? '?').slice(0, 1).toUpperCase()}
            path={myAvatarPath}
            onUpload={uploadMyAvatar}
            onRemove={removeMyAvatar}
          />
          <div className="min-w-0 flex-1">
            <DisplayNameEditor value={displayName ?? ''} onSave={updateMyDisplayName} />
            <div className="text-xs text-slate-500 mt-1">
              <MyRoleLabel isGM={isGM} />
            </div>
          </div>
        </div>

        <TabBar tab={tab} setTab={setTab} isGM={isGM} />

        <div className="flex-1 overflow-y-auto">
          {tab === 'profile' && (
            <div className="px-6 py-6 space-y-6">
              <Section title="Chat color">
                <ColorPicker value={myColor ?? '#94a3b8'} onChange={updateMyColor} />
              </Section>

              <Section title="About">
                <BioEditor value={myBio ?? ''} onSave={updateMyBio} />
              </Section>

              <Section title="Character sheet">
                {!partyLoaded ? (
                  <div className="text-sm text-slate-500">Loading…</div>
                ) : myCharacter ? (
                  <CharCard
                    m={myCharacter}
                    userId={userId}
                    isGM={isGM}
                    editable={true}
                    memberNames={{}}
                    onUpdate={(patch) => updateMember(myCharacter.id, patch)}
                    onRemove={() => removeMember(myCharacter.id)}
                    onClaim={() => claimMember(myCharacter.id)}
                    onUnclaim={() => unclaimMember(myCharacter.id)}
                  />
                ) : (
                  <NoCharacterCTA
                    party={party}
                    role={role}
                    onClaim={claimMember}
                    onBuild={() => setShowBuilder(true)}
                  />
                )}
              </Section>

              <Section title="Recent notes">
                <RecentNotesPanel
                  notes={notes}
                  permissions={notePermissions}
                  userId={userId}
                  role={role}
                  isGM={isGM}
                  onOpen={setPeekNote}
                />
              </Section>

              <Section title="Other campaigns">
                <OtherCampaignsPanel />
              </Section>

              <Section title="Campaign members">
                <CampaignMembersPanel selfId={userId} onOpenProfile={setProfileTarget} />
              </Section>
            </div>
          )}

          {tab === 'character' && (
            !partyLoaded ? (
              <div className="px-6 py-6 text-sm text-slate-500">Loading…</div>
            ) : isGM ? (
              // GMs see every character in the campaign with a click-to-edit
              // affordance. Players see their own claimed row.
              <GmCharactersView
                party={party}
                selfId={userId}
                onUpdate={updateMember}
              />
            ) : myCharacter ? (
              <CharacterSheet
                m={myCharacter}
                onUpdate={(patch) => updateMember(myCharacter.id, patch)}
              />
            ) : (
              <div className="px-6 py-6">
                <NoCharacterCTA
                  party={party}
                  role={role}
                  onClaim={claimMember}
                  onBuild={() => setShowBuilder(true)}
                />
              </div>
            )
          )}

          {tab === 'dice' && (
            // DiceRoller already renders its own PageHeader, padding, etc.
            <DiceRoller />
          )}

          {tab === 'chat' && (
            <div className="h-full p-3">
              <ChatPanel variant="embedded" />
            </div>
          )}

        </div>
      </div>

      {showBuilder && (
        <CharacterBuilder
          onClose={() => setShowBuilder(false)}
          onCreate={handleBuilderCreate}
        />
      )}

      {peekNote && (
        <NotePeekModal
          note={peekNote}
          canEdit={isGM || canEditNote(peekNote, userId, role, notePermissions[peekNote.id] ?? EMPTY_PERMS)}
          onClose={() => setPeekNote(null)}
        />
      )}

      {profileTarget && campaignId && (
        <MemberProfileModal
          member={profileTarget}
          party={party}
          currentCampaignId={campaignId}
          avatarPath={profiles[profileTarget.userId]?.avatarPath ?? null}
          onClose={() => setProfileTarget(null)}
          onWhisper={(uid) => {
            setWhisperTarget(uid);
            setTab('chat');
            setProfileTarget(null);
          }}
          onSpectate={(cid) => {
            setProfileTarget(null);
            setSpectatingCampaignId(cid);
          }}
        />
      )}

      {spectatingCampaignId && (
        <CampaignSpectatorView
          campaignId={spectatingCampaignId}
          onClose={() => setSpectatingCampaignId(null)}
        />
      )}
    </div>
  );
}

function TabBar({
  tab,
  setTab,
  isGM,
}: {
  tab: DashboardTab;
  setTab: (t: DashboardTab) => void;
  isGM: boolean;
}) {
  const tabs: { id: DashboardTab; label: string; icon: typeof UserIcon; gmOnly?: boolean }[] = [
    { id: 'profile', label: 'Profile', icon: UserIcon },
    { id: 'character', label: 'Character', icon: ScrollText },
    { id: 'chat', label: 'Chat', icon: MessageCircle },
    { id: 'dice', label: 'Dice', icon: Dice6 },
  ];
  return (
    <div className="border-b border-slate-800 px-2 sm:px-4 flex gap-1 overflow-x-auto scrollbar-none">
      {tabs
        .filter((t) => !t.gmOnly || isGM)
        .map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs uppercase tracking-wider border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active
                  ? 'text-slate-100 border-sky-500'
                  : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          );
        })}
    </div>
  );
}

/**
 * GM-only Campaign Management panel — lists every member with a Remove
 * button. Removal cascades party_members rows the player owned via the
 * existing campaign_members ON DELETE CASCADE chain (set via the schema).
 * RLS allows is_gm() to delete.
 */
export function CampaignManagementPanel({
  selfId,
  campaignId,
}: {
  selfId: string | null;
  campaignId: string;
}) {
  const membersMap = useChat((s) => s.members);
  const profiles = useProfiles((s) => s.profiles);
  const loadProfiles = useProfiles((s) => s.loadFor);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const members = useMemo(() => {
    return Object.values(membersMap).sort((a, b) => {
      // Self first (read-only), then GMs, then players by name.
      if (a.userId === selfId) return -1;
      if (b.userId === selfId) return 1;
      // GM > co-GM > player.
      const roleRank = (r: 'gm' | 'cogm' | 'player') => (r === 'gm' ? 0 : r === 'cogm' ? 1 : 2);
      if (a.role !== b.role) return roleRank(a.role) - roleRank(b.role);
      return a.displayName.localeCompare(b.displayName);
    });
  }, [membersMap, selfId]);

  useEffect(() => {
    if (members.length === 0) return;
    void loadProfiles(members.map((m) => m.userId));
  }, [members, loadProfiles]);

  const remove = async (m: ChatMember) => {
    if (m.userId === selfId) return;
    setBusyId(m.userId);
    setError(null);
    const { error: err } = await supabase
      .from('campaign_members')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('user_id', m.userId);
    setBusyId(null);
    setConfirmingId(null);
    if (err) {
      setError(`Couldn't remove ${m.displayName}: ${err.message}`);
      return;
    }
    // The realtime sub on chat_messages / members updates the list.
  };

  // Toggle a player ↔ co-GM. The primary GM (role='gm') is the campaign
  // owner and can't be downgraded here — that would orphan the campaign.
  const toggleCogm = async (m: ChatMember) => {
    if (m.userId === selfId || m.role === 'gm') return;
    const nextRole = m.role === 'cogm' ? 'player' : 'cogm';
    setBusyId(m.userId);
    setError(null);
    const { error: err } = await supabase
      .from('campaign_members')
      .update({ role: nextRole })
      .eq('campaign_id', campaignId)
      .eq('user_id', m.userId);
    setBusyId(null);
    if (err) {
      setError(`Couldn't update ${m.displayName}: ${err.message}`);
    }
  };

  return (
    <Section title="Campaign management">
      <div className="text-[12px] text-slate-500 mb-3">
        Remove members from the campaign. They lose access immediately and any
        characters they owned become unclaimed. Your own row can't be removed
        here — use Switch campaign in the sidebar to leave.
      </div>
      {error && (
        <div className="text-[12px] text-rose-300 mb-3 px-3 py-2 bg-rose-950/40 border border-rose-900 rounded">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        {members.map((m) => {
          const isSelf = m.userId === selfId;
          const url = avatarPublicUrl(profiles[m.userId]?.avatarPath ?? null);
          const confirming = confirmingId === m.userId;
          return (
            <div
              key={m.userId}
              className="flex items-center gap-3 px-3 py-2 rounded bg-slate-900 border border-slate-800"
            >
              <MemberAvatar color={m.color} name={m.displayName} url={url} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={{ color: m.color }}>
                  {m.displayName}
                </div>
                <RosterRoleLabel role={m.role} suffix={isSelf ? ' · you' : ''} />
              </div>
              {!isSelf && m.role !== 'gm' && (
                <button
                  onClick={() => toggleCogm(m)}
                  disabled={busyId === m.userId}
                  title={m.role === 'cogm' ? 'Demote to player' : 'Promote to co-GM'}
                  className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded flex items-center gap-1"
                >
                  <Shield size={11} />
                  {m.role === 'cogm' ? 'Demote' : 'Promote'}
                </button>
              )}
              {!isSelf && (
                confirming ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => remove(m)}
                      disabled={busyId === m.userId}
                      className="px-2 py-1 text-[11px] bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white rounded"
                    >
                      {busyId === m.userId ? 'Removing…' : 'Remove'}
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingId(m.userId)}
                    title={`Remove ${m.displayName}`}
                    className="p-1.5 text-slate-500 hover:text-rose-300 hover:bg-slate-800 rounded flex items-center gap-1 text-[11px]"
                  >
                    <UserMinus size={13} /> Remove
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-6 pt-6 border-t border-slate-800 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-rose-400 mb-2">Danger zone</div>
        <ClearChatRow campaignId={campaignId} />
        <DeleteCampaignRow />
      </div>
    </Section>
  );
}

/**
 * Shared shell for a Danger-zone row — title, blurb, two-step confirm
 * pattern. Keeps Clear chat / Leave / Delete visually identical.
 */
function DangerRow({
  title,
  blurb,
  ctaLabel,
  ctaIcon,
  confirmLabel,
  onConfirm,
}: {
  title: string;
  blurb: string;
  ctaLabel: string;
  ctaIcon: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fire = async () => {
    setBusy(true);
    setError(null);
    const res = await onConfirm();
    setBusy(false);
    setConfirming(false);
    if (!res.ok) setError(res.error);
  };
  return (
    <div className="bg-rose-950/20 border border-rose-900/50 rounded p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-slate-200">{title}</div>
          <div className="text-[11px] text-slate-500">{blurb}</div>
        </div>
        {confirming ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={fire}
              disabled={busy}
              className="px-2 py-1 text-[11px] bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white rounded"
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40 border border-rose-900/50 rounded flex items-center gap-1 shrink-0"
          >
            {ctaIcon} {ctaLabel}
          </button>
        )}
      </div>
      {error && <div className="text-[11px] text-rose-300 mt-2">{error}</div>}
    </div>
  );
}

function ClearChatRow({ campaignId }: { campaignId: string }) {
  const clearAll = useChat((s) => s.clearAll);
  return (
    <DangerRow
      title="Clear chat history"
      blurb="Permanently deletes every chat message in this campaign for every player. This cannot be undone."
      ctaLabel="Clear chat"
      ctaIcon={<Trash2 size={11} />}
      confirmLabel="Confirm clear"
      onConfirm={() => clearAll(campaignId)}
    />
  );
}

export function LeaveCampaignRow() {
  const leaveCampaign = useSession((s) => s.leaveCampaign);
  const campaignName = useSession((s) => s.campaignName);
  return (
    <DangerRow
      title="Leave campaign"
      blurb={`You'll lose access to ${campaignName ?? 'this campaign'} until a GM invites you back with the join code. Any characters you owned become unclaimed.`}
      ctaLabel="Leave"
      ctaIcon={<LogOut size={11} />}
      confirmLabel="Confirm leave"
      onConfirm={leaveCampaign}
    />
  );
}

function DeleteCampaignRow() {
  const deleteCampaign = useSession((s) => s.deleteCampaign);
  const campaignName = useSession((s) => s.campaignName);
  return (
    <DangerRow
      title="Delete campaign"
      blurb={`Permanently deletes ${campaignName ?? 'this campaign'} and everything inside it — notes, NPCs, party, map, chat, all of it. Every player loses access immediately. This cannot be undone.`}
      ctaLabel="Delete"
      ctaIcon={<Trash2 size={11} />}
      confirmLabel="Confirm delete"
      onConfirm={deleteCampaign}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{title}</div>
      {children}
    </section>
  );
}

function AvatarUpload({
  color,
  initial,
  path,
  onUpload,
  onRemove,
}: {
  color: string;
  initial: string;
  path: string | null;
  onUpload: (file: File) => Promise<{ ok: true } | { ok: false; error: string }>;
  onRemove: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = avatarPublicUrl(path);
  const has = url != null;

  const pick = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same filename
    if (!file) return;
    setBusy(true);
    setErr(null);
    const res = await onUpload(file);
    setBusy(false);
    if (!res.ok) setErr(res.error);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={onFile}
      />
      <button
        onClick={pick}
        disabled={busy}
        title={has ? 'Change avatar' : 'Upload avatar'}
        className="relative h-16 w-16 rounded-full border-2 overflow-hidden shrink-0 group disabled:opacity-60"
        style={{
          borderColor: color,
          backgroundColor: has ? '#020617' : `color-mix(in srgb, ${color} 22%, transparent)`,
          color,
        }}
      >
        {has ? (
          <img src={url!} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex items-center justify-center h-full w-full text-xl font-serif">{initial}</span>
        )}
        <span className="absolute inset-0 bg-slate-950/70 text-slate-100 text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Camera size={12} /> {has ? 'Change' : 'Upload'}
        </span>
      </button>
      {has && (
        <button
          onClick={() => { void onRemove(); }}
          title="Remove avatar"
          disabled={busy}
          className="p-1.5 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <Trash2 size={13} />
        </button>
      )}
      {err && <span className="text-[11px] text-rose-300">{err}</span>}
    </div>
  );
}

function DisplayNameEditor({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      cancel();
      return;
    }
    await onSave(next);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group flex items-center gap-2 text-2xl font-serif text-slate-100 hover:text-slate-200"
        title="Edit name"
      >
        <span className="truncate">{value || 'Unnamed'}</span>
        <Pencil size={14} className="text-slate-600 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xl font-serif text-slate-100 focus:outline-none focus:border-sky-700 min-w-0 flex-1"
        maxLength={48}
      />
      <button onClick={commit} className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200" title="Save (Enter)">
        <Check size={14} />
      </button>
      <button onClick={cancel} className="p-1 rounded text-slate-500 hover:text-slate-300" title="Cancel (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}

function BioEditor({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(value);
    setDirty(false);
  }, [value]);

  const onChange = (next: string) => {
    setDraft(next);
    setDirty(next !== value);
  };
  const save = async () => {
    if (!dirty) return;
    await onSave(draft);
    setDirty(false);
  };
  const cancel = () => {
    setDraft(value);
    setDirty(false);
  };

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Who is this character? Backstory hooks, quirks, anything the rest of the party should know."
        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-700 resize-y"
        maxLength={2000}
      />
      {dirty && (
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={save}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
          >
            <Check size={11} /> Save
          </button>
          <button onClick={cancel} className="text-slate-500 hover:text-slate-300">
            Discard
          </button>
          <span className="ml-auto text-slate-600">{draft.length}/2000</span>
        </div>
      )}
    </div>
  );
}

const COLOR_PRESETS = [
  '#94a3b8', '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#e879f9',
];

/**
 * GM-only view inside the Character tab. Two states:
 *   1. List — every party_members row with claimer info, click to drill in.
 *   2. Detail — full CharacterSheet for the selected character.
 */
function GmCharactersView({
  party,
  selfId,
  onUpdate,
}: {
  party: import('../party/partyStore').PartyMember[];
  selfId: string | null;
  onUpdate: (id: string, patch: Partial<import('../party/partyStore').PartyMember>) => Promise<void>;
}) {
  const membersMap = useChat((s) => s.members);
  const profiles = useProfiles((s) => s.profiles);
  const loadProfiles = useProfiles((s) => s.loadFor);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Make sure avatar paths for every potential owner are loaded.
  useEffect(() => {
    const ownerIds = party
      .map((p) => p.owner_user_id)
      .filter((u): u is string => !!u);
    if (ownerIds.length > 0) void loadProfiles(ownerIds);
  }, [party, loadProfiles]);

  const selected = selectedId ? party.find((p) => p.id === selectedId) ?? null : null;

  if (selected) {
    const ownerMember = selected.owner_user_id ? membersMap[selected.owner_user_id] : null;
    return (
      <div>
        <div className="px-6 pt-6 pb-2 flex items-center gap-2 text-xs text-slate-400 print:hidden">
          <button
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800"
          >
            <ChevronLeft size={13} /> All characters
          </button>
          {ownerMember && (
            <span className="ml-2">
              Owner: <span style={{ color: ownerMember.color }}>{ownerMember.displayName}</span>
            </span>
          )}
          {!selected.owner_user_id && (
            <span className="ml-2 text-slate-500 italic">unclaimed</span>
          )}
        </div>
        <CharacterSheet
          m={selected}
          onUpdate={(patch) => onUpdate(selected.id, patch)}
        />
      </div>
    );
  }

  if (party.length === 0) {
    return (
      <div className="px-6 py-6">
        <div className="bg-slate-900 border border-slate-800 rounded p-4 text-sm text-slate-400">
          No characters in this campaign yet. Add one from the{' '}
          <Link to="/party" className="text-sky-300 hover:text-sky-200">Party page</Link>.
        </div>
      </div>
    );
  }

  // Sort: claimed before unclaimed, alphabetical within.
  const sorted = [...party].sort((a, b) => {
    const aClaimed = a.owner_user_id != null;
    const bClaimed = b.owner_user_id != null;
    if (aClaimed !== bClaimed) return aClaimed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="px-6 py-6 space-y-3">
      <div className="text-[11px] text-slate-500">
        Click any character to view and edit their full sheet — GMs see everything.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sorted.map((p) => {
          const owner = p.owner_user_id ? membersMap[p.owner_user_id] : null;
          const url = owner ? avatarPublicUrl(profiles[owner.userId]?.avatarPath ?? null) : null;
          const color = owner?.color ?? '#475569';
          const isSelf = p.owner_user_id === selfId;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="flex items-center gap-3 px-3 py-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-left"
            >
              <MemberAvatar color={color} name={owner?.displayName ?? p.name} url={url} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-100 truncate">{p.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {p.classSummary || '—'}
                  {p.race && ` · ${p.race}`}
                  {' · LVL '}{p.level}
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">
                {owner ? (isSelf ? 'you' : owner.displayName) : 'unclaimed'}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type NoteTab = 'all' | 'owned' | 'editor' | 'view';

/**
 * Whether `userId` counts as the owner of a note. A note is yours if you're
 * its explicit owner, OR if it has no explicit owner and you created it —
 * the latter covers GM-authored notes, which are stored with
 * owner_user_id = null but created_by = the GM.
 */
function ownsNote(note: Note, userId: string | null): boolean {
  if (!userId) return false;
  return note.owner_user_id === userId || (note.owner_user_id === null && note.created_by === userId);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Horizontally-scrolling "recent notes" carousel — filterable by the
 * viewer's relationship to each note (owner / editor / view-only), sorted
 * by most-recently-updated. Clicking a card opens NotePeekModal for a
 * quick edit without leaving the Dashboard.
 */
function RecentNotesPanel({
  notes,
  permissions,
  userId,
  role,
  isGM,
  onOpen,
}: {
  notes: Note[];
  permissions: Record<string, NotePermission[]>;
  userId: string | null;
  role: 'gm' | 'cogm' | 'player' | null;
  isGM: boolean;
  onOpen: (note: Note) => void;
}) {
  const [noteTab, setNoteTab] = useState<NoteTab>('all');

  const visible = useMemo(
    () => (isGM ? notes : notes.filter((n) => canViewNote(n, userId, role, permissions[n.id] ?? EMPTY_PERMS))),
    [isGM, notes, userId, role, permissions]
  );

  const filtered = useMemo(() => {
    if (noteTab === 'all') return visible;
    return visible.filter((n) => {
      const owned = ownsNote(n, userId);
      const edit = isGM || canEditNote(n, userId, role, permissions[n.id] ?? EMPTY_PERMS);
      if (noteTab === 'owned') return owned;
      if (noteTab === 'editor') return !owned && edit;
      return !owned && !edit; // view — already know it's visible
    });
  }, [visible, noteTab, userId, role, permissions, isGM]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [filtered]
  );

  const tabs: { id: NoteTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'owned', label: 'Owned' },
    { id: 'editor', label: 'Editor' },
    { id: 'view', label: 'View' },
  ];

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setNoteTab(t.id)}
            className={`px-2 py-1 text-[11px] rounded transition-colors ${
              noteTab === t.id
                ? 'bg-sky-900/50 text-sky-100'
                : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-slate-500 italic">No notes here yet.</div>
      ) : (
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {sorted.map((n) => {
            const owned = ownsNote(n, userId);
            const edit = isGM || owned || canEditNote(n, userId, role, permissions[n.id] ?? EMPTY_PERMS);
            const label = owned ? 'Owner' : edit ? 'Editor' : 'View';
            return (
              <button
                key={n.id}
                onClick={() => onOpen(n)}
                className="shrink-0 w-48 text-left px-3 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-slate-200">
                  <FileText size={12} className="shrink-0 text-slate-500" />
                  <span className="text-sm font-serif truncate">{n.title || 'Untitled'}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><Clock size={9} /> {relativeTime(n.updated_at)}</span>
                  <span className={`uppercase tracking-wider ${owned ? 'text-emerald-400' : edit ? 'text-sky-400' : 'text-slate-500'}`}>
                    {label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Quick-switch cards for every other campaign this profile belongs to.
 * Clicking a card calls switchToCampaign directly (skips the "leave then
 * pick" round trip through Settings → Switch campaign → CampaignPicker).
 */
function OtherCampaignsPanel() {
  const myCampaigns = useSession((s) => s.myCampaigns);
  const campaignId = useSession((s) => s.campaignId);
  const switchToCampaign = useSession((s) => s.switchToCampaign);
  const gm = useRoleColors((s) => s.gm);
  const cogm = useRoleColors((s) => s.cogm);
  const player = useRoleColors((s) => s.player);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const others = useMemo(
    () => myCampaigns.filter((c) => c.id !== campaignId),
    [myCampaigns, campaignId],
  );

  if (others.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic">
        You're only in this campaign right now.
      </div>
    );
  }

  const switchTo = async (id: string) => {
    if (switchingId) return;
    setSwitchingId(id);
    await switchToCampaign(id);
    setSwitchingId(null);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {others.map((c) => (
        <button
          key={c.id}
          onClick={() => switchTo(c.id)}
          disabled={switchingId === c.id}
          className="group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 disabled:opacity-60 text-left transition-colors"
        >
          <div className="min-w-0">
            <div className="text-sm font-serif text-slate-100 truncate">{c.name}</div>
            <div className="text-[11px] flex items-center gap-1">
              <span style={{ color: roleColor(c.role, { gm, cogm, player }) }}>
                {c.role === 'gm' ? 'Game Master' : c.role === 'cogm' ? 'Co-GM' : 'Player'}
              </span>
              <span className="opacity-50 text-slate-500">·</span>
              <span className="text-slate-500 truncate">{c.display_name}</span>
            </div>
          </div>
          {switchingId === c.id ? (
            <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">Switching…</span>
          ) : (
            <ChevronRight size={16} className="text-slate-600 group-hover:text-sky-300 shrink-0" />
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Lists every other campaign member with their color and role. Click a row
 * to open their profile popover (avatar, bio, claimed character, other
 * campaigns) — see `MemberProfileModal`. Avatars are currently a colored
 * initial; real image upload comes later.
 */
function CampaignMembersPanel({
  selfId,
  onOpenProfile,
}: {
  selfId: string | null;
  onOpenProfile: (m: ChatMember) => void;
}) {
  const membersMap = useChat((s) => s.members);
  const profiles = useProfiles((s) => s.profiles);
  const loadProfiles = useProfiles((s) => s.loadFor);

  const others = useMemo<ChatMember[]>(() => {
    const list = Object.values(membersMap).filter((m) => m.userId !== selfId);
    return list.sort((a, b) => {
      // GMs first, then by display name.
      // GM > co-GM > player.
      const roleRank = (r: 'gm' | 'cogm' | 'player') => (r === 'gm' ? 0 : r === 'cogm' ? 1 : 2);
      if (a.role !== b.role) return roleRank(a.role) - roleRank(b.role);
      return a.displayName.localeCompare(b.displayName);
    });
  }, [membersMap, selfId]);

  useEffect(() => {
    if (others.length === 0) return;
    void loadProfiles(others.map((m) => m.userId));
  }, [others, loadProfiles]);

  if (others.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic">
        You're the only one here so far. Share the campaign join code to invite players.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {others.map((m) => (
        <button
          key={m.userId}
          onClick={() => onOpenProfile(m)}
          title={`View ${m.displayName}'s profile`}
          className="w-full flex items-center gap-3 px-3 py-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors group"
        >
          <MemberAvatar color={m.color} name={m.displayName} url={avatarPublicUrl(profiles[m.userId]?.avatarPath ?? null)} />
          <div className="min-w-0 flex-1 text-left">
            <div className="text-sm font-medium truncate" style={{ color: m.color }}>
              {m.displayName}
            </div>
            <RosterRoleLabel role={m.role} />
          </div>
          <ChevronRight size={14} className="text-slate-600 group-hover:text-sky-300 shrink-0" />
        </button>
      ))}
    </div>
  );
}

function MemberAvatar({ color, name, url }: { color: string; name: string; url: string | null }) {
  const initial = (name || '?').slice(0, 1).toUpperCase();
  return (
    <div
      className="h-9 w-9 rounded-full border overflow-hidden flex items-center justify-center text-sm font-serif shrink-0"
      style={{
        borderColor: color,
        backgroundColor: url ? '#020617' : `color-mix(in srgb, ${color} 22%, transparent)`,
        color,
      }}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initial}
    </div>
  );
}

/**
 * Shown on the dashboard when the player doesn't own a character yet.
 * Lists unclaimed party_members so they can pick one in a single click;
 * otherwise points them at the Party page to add one (GM-only insert today).
 */
function NoCharacterCTA({
  party,
  role,
  onClaim,
  onBuild,
}: {
  party: import('../party/partyStore').PartyMember[];
  role: 'gm' | 'cogm' | 'player' | null;
  onClaim: (id: string) => Promise<void>;
  onBuild: () => void;
}) {
  const unclaimed = party.filter((p) => p.owner_user_id === null);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="text-sm text-slate-300">
        You don't have a character in this campaign yet.
      </div>
      <button
        onClick={onBuild}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded bg-sky-700 hover:bg-sky-600 text-slate-950 text-sm font-semibold"
      >
        <Wand2 size={14} /> Build a character
      </button>
      {unclaimed.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">…or claim an existing one</div>
          <div className="space-y-1">
            {unclaimed.map((p) => (
              <button
                key={p.id}
                onClick={() => onClaim(p.id)}
                className="w-full flex items-center justify-between px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm text-slate-200 group"
              >
                <span className="flex items-center gap-2">
                  <UserPlus size={13} className="text-slate-500 group-hover:text-emerald-400" />
                  <span className="font-serif">{p.name}</span>
                  <span className="text-[11px] text-slate-500">
                    {p.classSummary} {p.race && `· ${p.race}`}
                  </span>
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 group-hover:text-emerald-400">
                  Claim
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Link
        to="/party"
        className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
      >
        {(role === 'gm' || role === 'cogm') ? 'Add or manage characters on the Party page' : 'See all characters on the Party page'} →
      </Link>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => Promise<void> }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className="h-7 w-7 rounded-full border border-slate-700 hover:scale-110 transition-transform"
            style={{
              backgroundColor: c,
              boxShadow: c === value ? '0 0 0 2px var(--ac-400)' : undefined,
            }}
            title={c}
          />
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-400 ml-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 bg-transparent border border-slate-700 rounded cursor-pointer"
        />
        Custom
      </label>
    </div>
  );
}

/** The "Game Master" / "Player" tag under the user's own display name at
 *  the top of the dashboard. Pulls the colour from the role-colour store
 *  so the user's chosen tint applies on every render — Co-GMs still see
 *  the "Game Master" copy here (matches the existing isGM collapse) but
 *  it's tinted with the GM colour. */
function MyRoleLabel({ isGM }: { isGM: boolean }) {
  const gm = useRoleColors((s) => s.gm);
  const player = useRoleColors((s) => s.player);
  return (
    <span style={{ color: isGM ? gm : player }}>
      {isGM ? 'Game Master' : 'Player'}
    </span>
  );
}

/** Compact uppercase role chip used in the member roster and whisper
 *  picker. The role-specific tint replaces the previous flat slate-500
 *  treatment so GM / Co-GM / Player are immediately distinguishable at
 *  a glance.
 *
 *  Each colour is subscribed as its own primitive selector — returning
 *  an object literal from a single selector would hand React a fresh
 *  reference every render and trip the max-update-depth loop (#185). */
function RosterRoleLabel({ role, suffix = '' }: { role: 'gm' | 'cogm' | 'player'; suffix?: string }) {
  const gm = useRoleColors((s) => s.gm);
  const cogm = useRoleColors((s) => s.cogm);
  const player = useRoleColors((s) => s.player);
  return (
    <div
      className="text-[10px] uppercase tracking-wider"
      style={{ color: roleColor(role, { gm, cogm, player }) }}
    >
      {role === 'gm' ? 'Game Master' : role === 'cogm' ? 'Co-GM' : 'Player'}
      {suffix}
    </div>
  );
}
