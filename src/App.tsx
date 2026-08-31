import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { Swords, NotebookPen, Map as MapIcon, BookOpen, Sparkles, Package, ScrollText, Users, FlaskConical, Dices, Copy, Mic, Eye, Settings as SettingsIcon, BookMarked, Radio, LayoutDashboard, Menu, X as XIcon, ChevronsLeft, ChevronsRight, ArrowLeftRight } from 'lucide-react';
import { QuickDice } from './features/dice/QuickDice';
import DiceRollOverlay from './features/dice/DiceRollOverlay';
import CommandPalette from './features/palette/CommandPalette';
import Scratchpad from './features/scratchpad/Scratchpad';
import { useScratchpad } from './features/scratchpad/scratchpadStore';
import { useQuickDice } from './features/dice/quickDiceStore';
import ChatPanel from './features/chat/ChatPanel';
import Initiative from './features/initiative/Initiative';
import Notes from './features/notes/Notes';
import MindMap from './features/notes/MindMap';
import MapBoard from './features/map/MapBoard';
import Spells from './features/spells/Spells';
import Items from './features/items/Items';
import StatBlocks from './features/statblocks/StatBlocks';
import Encounters from './features/encounters/Encounters';
import Rules from './features/rules/Rules';
import Party from './features/party/Party';
import Homebrew from './features/homebrew/Homebrew';
import Transcription from './features/transcription/Transcription';
import NPCs from './features/npcs/NPCs';
import Dashboard from './features/dashboard/Dashboard';
import Settings from './features/settings/Settings';
import CampaignPicker from './features/session/CampaignPicker';
import { useSession } from './features/session/sessionStore';
import { useCampaignSettings } from './features/notes/campaignSettingsStore';
import { useSidebar } from './features/session/sidebarStore';
import { useNavCustomization } from './hooks/useNavCustomization';
import { useRecording } from './features/transcription/recordingStore';

type NavItem = {
  to: string;
  label: string;
  icon: typeof Swords;
  gmOnly?: boolean;
};

const nav: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/initiative', label: 'Initiative', icon: Swords },
  { to: '/party', label: 'Party', icon: Users },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/npcs',  label: 'NPCs',  icon: BookMarked },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/spells', label: 'Spells', icon: Sparkles },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/encounters', label: 'Encounters', icon: Swords, gmOnly: true },
  { to: '/statblocks', label: 'Stat Blocks', icon: ScrollText, gmOnly: true },
  { to: '/homebrew', label: 'Homebrew', icon: FlaskConical, gmOnly: true },
  { to: '/record', label: 'Record', icon: Mic, gmOnly: true },
  { to: '/rules', label: 'Rules', icon: BookOpen },
];

export default function App() {
  const bootstrap = useSession((s) => s.bootstrap);
  const loading = useSession((s) => s.loading);
  const userId = useSession((s) => s.userId);
  const campaignId = useSession((s) => s.campaignId);
  const recovery = useSession((s) => s.recovery);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-950 text-slate-500 text-sm">
        Loading…
      </div>
    );
  }

  // Returning from a password-reset email link — show the reset screen even if
  // the recovery session makes the user look signed in.
  if (recovery) return <CampaignPicker />;
  if (!userId) return <CampaignPicker />;
  if (!campaignId) return <CampaignPicker />;

  return <AppShell />;
}

function AppShell() {
  const toggleQuickDice = useQuickDice((s) => s.toggle);
  const quickDiceOpen = useQuickDice((s) => s.open);
  const toggleScratchpad = useScratchpad((s) => s.toggle);
  const scratchpadOpen = useScratchpad((s) => s.open);
  const role = useSession((s) => s.role);
  const leaveCurrent = useSession((s) => s.leaveCurrent);
  const campaignId = useSession((s) => s.campaignId);
  const campaignName = useSession((s) => s.campaignName);
  const joinCode = useSession((s) => s.joinCode);
  const displayName = useSession((s) => s.displayName);
  // Sidebar behaviour has two modes (toggle in /settings → Display):
  //   - 'manual' (default) — pinned open/closed via the header collapse button;
  //     the pin state lives in the store's `collapsed`.
  //   - 'auto' — a narrow rail that expands on hover; `expanded` tracks that
  //     transient hover state.
  const sidebarMode = useSidebar((s) => s.mode);
  const pinnedCollapsed = useSidebar((s) => s.collapsed);
  const toggleCollapsed = useSidebar((s) => s.toggleCollapsed);
  const autoMode = sidebarMode === 'auto';
  const [expanded, setExpanded] = useState(false);
  // Mobile-only: hamburger-driven drawer state. Below md, the sidebar isn't
  // visible at all by default — clicking the hamburger slides it in over the
  // page. Auto-closes on nav link click.
  const [mobileOpen, setMobileOpen] = useState(false);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const setViewAsPlayer = useSession((s) => s.setViewAsPlayer);
  const trueIsGM = role === 'gm' || role === 'cogm';
  // Effective GM for UI gating. View-as-player downgrades the GM's UI to a
  // player's view; server-side RLS is unaffected, so they can still
  // technically edit anything they could before — this is purely so they can
  // preview what the players see.
  const isGM = trueIsGM && !viewAsPlayer;
  // Mobile drawer always renders the expanded layout (full nav labels,
  // campaign name in the header). On desktop, auto mode follows the hover
  // state; manual mode follows the pinned collapse state.
  const collapsed = mobileOpen ? false : autoMode ? !expanded : pinnedCollapsed;

  // ── Page title ────────────────────────────────────────────────────────────
  const location = useLocation();
  useEffect(() => {
    const page = nav.find((n) => location.pathname.startsWith(n.to));
    const pageName = page?.label ?? (location.pathname.startsWith('/settings') ? 'Settings' : 'Grimoire');
    document.title = campaignName ? `${pageName} · ${campaignName}` : `${pageName} · Grimoire`;
  }, [location.pathname, campaignName]);

  const loadSettings = useCampaignSettings((s) => s.load);
  const subscribeSettings = useCampaignSettings((s) => s.subscribe);
  const hiddenPages = useCampaignSettings((s) => s.settings.hiddenPages);
  const allowedGmPages = useCampaignSettings((s) => s.settings.allowedGmPages ?? []);

  const isRecording = useRecording((s) => s.isRecording);
  const startRecording = useRecording((s) => s.start);
  const stopRecording = useRecording((s) => s.stop);
  const recordingSupported = useRecording((s) => s.supported);

  useEffect(() => {
    if (!campaignId) return;
    loadSettings(campaignId);
    const unsub = subscribeSettings(campaignId);
    return unsub;
  }, [campaignId, loadSettings, subscribeSettings]);

  // Players see non-gmOnly pages the GM hasn't hidden, plus gmOnly pages the GM has shared
  const visibleByRole = nav.filter((n) => {
    const slug = n.to.replace('/', '');
    if (isGM) return true;
    if (n.gmOnly) return allowedGmPages.includes(slug);
    return !hiddenPages.includes(slug);
  });

  // Per-user customization layered on top of the role filter — reorders and
  // hides items based on local preferences. Customization itself moved to the
  // Settings page.
  const customNav = useNavCustomization();
  const visibleNav = customNav.apply(visibleByRole);

  const copyJoinCode = () => {
    if (joinCode) navigator.clipboard.writeText(joinCode);
  };

  return (
    <div className="h-full flex flex-col text-slate-100 bg-slate-950">
      {trueIsGM && viewAsPlayer && (
        <button
          onClick={() => setViewAsPlayer(false)}
          className="shrink-0 w-full px-4 py-1.5 text-xs flex items-center justify-center gap-2 border-b print:hidden"
          style={{
            backgroundColor: 'color-mix(in srgb, #fbbf24 18%, transparent)',
            borderColor: 'color-mix(in srgb, #fbbf24 40%, transparent)',
            color: '#fcd34d',
          }}
        >
          <Eye size={12} />
          <span className="font-medium">Viewing as player</span>
          <span className="opacity-70">— click to return to GM view</span>
        </button>
      )}
      {/* Mobile top bar — visible <md only. Just the hamburger; campaign name
          and dice live in the drawer so the bar stays out of the way. */}
      <div className="md:hidden shrink-0 flex items-center px-2 py-1.5 border-b border-slate-800 bg-slate-900">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded text-slate-300 hover:bg-slate-800 active:bg-slate-700"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
      </div>

      <div className="flex-1 flex min-h-0 relative">
      {/* Backdrop — only on <md when drawer is open */}
      {mobileOpen && (
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          aria-label="Close menu"
        />
      )}
      <aside
        onMouseEnter={autoMode ? () => setExpanded(true) : undefined}
        onMouseLeave={autoMode ? () => setExpanded(false) : undefined}
        onFocus={autoMode ? () => setExpanded(true) : undefined}
        onBlur={
          autoMode
            ? (e) => {
                // Collapse only when focus leaves the sidebar entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setExpanded(false);
              }
            : undefined
        }
        className={`
          ${collapsed ? 'md:w-14' : 'md:w-56'}
          md:relative md:translate-x-0 md:flex md:shrink-0
          fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          bg-slate-950 border-r border-slate-800 flex flex-col md:transition-[width]
        `}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        {collapsed ? (
          <div className="px-2 py-3 border-b border-slate-800 flex flex-col items-center gap-2">
            {/* Manual mode: expand the rail. (Auto mode expands on hover, so it
                doesn't need the button.) */}
            {!autoMode && (
              <button
                onClick={toggleCollapsed}
                title="Expand sidebar"
                className="hidden md:flex p-1.5 rounded border bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
              >
                <ChevronsRight size={14} />
              </button>
            )}
            <button
              onClick={toggleQuickDice}
              title="Quick dice roller"
              className={`p-1.5 rounded border ${
                quickDiceOpen
                  ? 'bg-slate-900'
                  : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
              }`}
              style={quickDiceOpen ? { color: 'var(--ac-200)', borderColor: 'var(--ac-700)' } : undefined}
            >
              <Dices size={14} />
            </button>
            <button
              onClick={toggleScratchpad}
              title="Scratchpad"
              className={`p-1.5 rounded border ${
                scratchpadOpen
                  ? 'bg-slate-900'
                  : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
              }`}
              style={scratchpadOpen ? { color: 'var(--ac-200)', borderColor: 'var(--ac-700)' } : undefined}
            >
              <NotebookPen size={14} />
            </button>
            {isGM && recordingSupported && (
              <button
                onClick={isRecording ? stopRecording : startRecording}
                title={isRecording ? 'Stop recording' : 'Start recording'}
                className={`p-1.5 rounded border ${
                  isRecording
                    ? 'bg-rose-900/60 border-rose-700 text-rose-300'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
                }`}
              >
                {isRecording ? <Radio size={14} className="animate-pulse" /> : <Mic size={14} />}
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-serif text-lg tracking-wide flex items-center gap-2" title={campaignName ?? ''}>
                <Swords size={18} className="shrink-0" style={{ color: 'var(--ac-400)' }} />
                <span className="truncate">{campaignName ?? 'Grimoire'}</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
                <span className={isGM ? 'text-emerald-400' : 'text-sky-400'}>
                  {isGM ? 'GM' : 'Player'}
                </span>
                <span className="opacity-50">·</span>
                <span className="truncate">{displayName}</span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {/* Mobile: close-drawer button (replaces the hamburger when the
                  drawer is open). Hidden on md+ since the rail has no concept
                  of "close" — the desktop user toggles via hover/auto-expand. */}
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="md:hidden p-1.5 rounded text-slate-400 hover:bg-slate-800"
              >
                <XIcon size={16} />
              </button>
              {/* Manual mode: collapse the sidebar to the icon rail. */}
              {!autoMode && (
                <button
                  onClick={toggleCollapsed}
                  title="Collapse sidebar"
                  className="hidden md:flex p-1.5 rounded text-slate-400 hover:bg-slate-800"
                >
                  <ChevronsLeft size={16} />
                </button>
              )}
              {isGM && recordingSupported && (
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  title={isRecording ? 'Stop recording' : 'Start recording'}
                  className={`p-1.5 rounded border ${
                    isRecording
                      ? 'bg-rose-900/60 border-rose-700 text-rose-300'
                      : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  {isRecording ? <Radio size={14} className="animate-pulse" /> : <Mic size={14} />}
                </button>
              )}
              <button
                onClick={toggleQuickDice}
                title="Quick dice roller"
                className={`p-1.5 rounded border ${
                  quickDiceOpen
                    ? 'bg-slate-900'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
                }`}
                style={quickDiceOpen ? { color: 'var(--ac-200)', borderColor: 'var(--ac-700)' } : undefined}
              >
                <Dices size={14} />
              </button>
              <button
                onClick={toggleScratchpad}
                title="Scratchpad"
                className={`p-1.5 rounded border ${
                  scratchpadOpen
                    ? 'bg-slate-900'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'
                }`}
                style={scratchpadOpen ? { color: 'var(--ac-200)', borderColor: 'var(--ac-700)' } : undefined}
              >
                <NotebookPen size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── Join code (GM only, hidden when collapsed) ───────────────────── */}
        {!collapsed && isGM && joinCode && (
          <button
            onClick={copyJoinCode}
            title="Copy join code"
            className="px-4 py-2 text-[11px] flex items-center justify-between border-b border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200"
          >
            <span className="uppercase tracking-wider">Join code</span>
            <span className="font-mono tracking-widest text-slate-200 flex items-center gap-1">
              {joinCode}
              <Copy size={10} />
            </span>
          </button>
        )}

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-4'} py-2 text-sm transition-colors border-l-2 ${
                  isActive
                    ? ''
                    : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100 border-transparent'
                }`
              }
              style={({ isActive }) => isActive ? { color: 'var(--nav-active-fg)', background: 'var(--nav-active-bg)', borderLeftColor: 'var(--ac-400)' } : undefined}
            >
              <Icon size={16} />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* ── Footer ─ Switch campaign + Settings. ─────────────────────────── */}
        <div className="border-t border-slate-800">
          <button
            onClick={() => { setMobileOpen(false); void leaveCurrent(); }}
            title={collapsed ? 'Switch campaign' : undefined}
            className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-4'} py-2.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-slate-200 transition-colors`}
          >
            <ArrowLeftRight size={16} />
            {!collapsed && 'Switch campaign'}
          </button>
          <NavLink
            to="/settings"
            title={collapsed ? 'Settings' : undefined}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-4'} py-2.5 text-sm transition-colors ${
                isActive
                  ? 'text-slate-100 bg-slate-900'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`
            }
          >
            <SettingsIcon size={16} />
            {!collapsed && 'Settings'}
          </NavLink>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          {/* /dice is now a tab inside /dashboard — keep the URL working as a redirect. */}
          <Route path="/dice" element={<Navigate to="/dashboard" replace />} />
          <Route path="/initiative" element={<Initiative />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/notes/mind-map" element={<MindMap />} />
          {/* Legacy / direct link */}
          <Route path="/mind-map" element={<MindMap />} />
          <Route path="/npcs" element={<NPCs />} />
          <Route path="/map" element={<MapBoard />} />
          <Route path="/party" element={<Party />} />
          <Route path="/spells" element={<Spells />} />
          <Route path="/items" element={<Items />} />
          {/* /shop removed — redirect any old bookmarks to Items. */}
          <Route path="/shop" element={<Navigate to="/items" replace />} />
          {isGM && <Route path="/encounters" element={<Encounters />} />}
          {isGM && <Route path="/statblocks" element={<StatBlocks />} />}
          {isGM && <Route path="/homebrew" element={<Homebrew />} />}
          {isGM && <Route path="/record" element={<Transcription />} />}
          <Route path="/rules" element={<Rules />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      </div>
      <QuickDice />
      {/* Centre-screen roll flourish. Self-driving: it watches the roll
          history, so it covers every roll site in the app. */}
      <DiceRollOverlay />
      {/* ⌘K / Ctrl-K from anywhere. Registers its own global key listener. */}
      <CommandPalette />
      <Scratchpad />
      {/* Dashboard embeds its own chat surface, so hide the floating one there. */}
      {location.pathname !== '/dashboard' && <ChatPanel />}
    </div>
  );
}
