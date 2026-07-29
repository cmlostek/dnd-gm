import { useRef, useState } from 'react';
import {
  Sun,
  Moon,
  Eye,
  EyeOff,
  ArrowLeftRight,
  LogOut,
  RotateCcw,
  GripVertical,
  LayoutDashboard,
  Swords,
  Users,
  NotebookPen,
  BookMarked,
  Map as MapIcon,
  Sparkles,
  Package,
  ScrollText,
  FlaskConical,
  Mic,
  BookOpen,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  Mail,
  KeyRound,
} from 'lucide-react';
import { downloadCampaignExport } from './exportCampaign';
import { importCampaignFromExport, parseExportFile, type ImportResult } from './importCampaign';
import {
  useRoleColors,
  ROLE_COLOR_SWATCHES,
  DEFAULT_GM_COLOR,
  DEFAULT_COGM_COLOR,
  DEFAULT_PLAYER_COLOR,
} from '../session/roleColorsStore';
import PageHeader from '../../components/PageHeader';
import { useSession } from '../session/sessionStore';
import { useCampaignSettings, COIN_KEYS, DEFAULT_COIN_RATES } from '../notes/campaignSettingsStore';
import { useTheme, THEMES } from '../session/themeStore';
import { useSidebar } from '../session/sidebarStore';
import { useDashboardPref, DASHBOARD_TAB_LABELS, type DashboardDefaultTab } from '../dashboard/dashboardPrefStore';
import { useDiceEffects } from '../dice/diceEffectsStore';
import { CampaignManagementPanel, LeaveCampaignRow } from '../dashboard/Dashboard';
import { useNavCustomization } from '../../hooks/useNavCustomization';
import { supabase } from '../../lib/supabase';

// Mirrors the nav array in App.tsx — kept here so the Customize-nav panel can
// list / reorder the same items the sidebar shows. Keep these in sync.
type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number }>; gmOnly?: boolean };
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/initiative', label: 'Initiative', icon: Swords },
  { to: '/party', label: 'Party', icon: Users },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/npcs', label: 'NPCs', icon: BookMarked },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/spells', label: 'Spells', icon: Sparkles },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/statblocks', label: 'Stat Blocks', icon: ScrollText, gmOnly: true },
  { to: '/homebrew', label: 'Homebrew', icon: FlaskConical, gmOnly: true },
  { to: '/record', label: 'Record', icon: Mic, gmOnly: true },
  { to: '/rules', label: 'Rules', icon: BookOpen },
];

export default function Settings() {
  const role = useSession((s) => s.role);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const setViewAsPlayer = useSession((s) => s.setViewAsPlayer);
  const leaveCurrent = useSession((s) => s.leaveCurrent);
  const signOut = useSession((s) => s.signOut);
  const email = useSession((s) => s.email);
  const campaignId = useSession((s) => s.campaignId);
  const campaignName = useSession((s) => s.campaignName);
  const userId = useSession((s) => s.userId);
  const [exporting, setExporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPhase, setImportPhase] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const onPickImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    setImportPhase('Reading file');
    try {
      const data = await parseExportFile(f);
      const result = await importCampaignFromExport(data, (phase) => setImportPhase(phase));
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setImportPhase('');
    }
  };

  const switchToImported = () => {
    if (!importResult) return;
    // Hand the new campaign id off to the session bootstrap by writing it
    // to the same localStorage key the session store reads on init, then
    // reload so every per-feature store rehydrates against the new id.
    localStorage.setItem('dnd-gm:campaignId', importResult.campaignId);
    window.location.reload();
  };

  const { mode, toggle: toggleMode } = useTheme();
  const sidebarMode = useSidebar((s) => s.mode);
  const setSidebarMode = useSidebar((s) => s.setMode);
  const dashboardDefaultTab = useDashboardPref((s) => s.defaultTab);
  const setDashboardDefaultTab = useDashboardPref((s) => s.setDefaultTab);
  const diceVisual = useDiceEffects((s) => s.visual);
  const setDiceVisual = useDiceEffects((s) => s.setVisual);
  const diceSound = useDiceEffects((s) => s.sound);
  const setDiceSound = useDiceEffects((s) => s.setSound);

  const togglePage = useCampaignSettings((s) => s.togglePage);
  const toggleGmPage = useCampaignSettings((s) => s.toggleGmPage);
  const hideAll = useCampaignSettings((s) => s.hideAll);
  const showAll = useCampaignSettings((s) => s.showAll);
  const hiddenPages = useCampaignSettings((s) => s.settings.hiddenPages);
  const allowedGmPages = useCampaignSettings((s) => s.settings.allowedGmPages ?? []);
  const hpRollingMethod = useCampaignSettings((s) => s.settings.hpRollingMethod);
  const setHpRollingMethod = useCampaignSettings((s) => s.setHpRollingMethod);
  const coinRates = useCampaignSettings((s) => s.settings.coinRates ?? DEFAULT_COIN_RATES);
  const setCoinRate = useCampaignSettings((s) => s.setCoinRate);
  const resetCoinRates = useCampaignSettings((s) => s.resetCoinRates);
  const encumbrance = useCampaignSettings((s) => s.settings.encumbrance ?? false);
  const setEncumbrance = useCampaignSettings((s) => s.setEncumbrance);

  const trueIsGM = role === 'gm' || role === 'cogm';
  const isGM = trueIsGM && !viewAsPlayer;

  // Role-aware nav list for customization (matches what App.tsx renders).
  const customNav = useNavCustomization();
  const visibleByRole = NAV.filter((n) => {
    const slug = n.to.replace('/', '');
    if (isGM) return true;
    if (n.gmOnly) return allowedGmPages.includes(slug);
    return !hiddenPages.includes(slug);
  });
  const editableNav = customNav.apply(visibleByRole, { includeHidden: true });

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
        <Section title="Display">
          <Row
            icon={mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={toggleMode}
          />
          <ThemeColorRow />
          <SwitchRow
            label="Auto-collapse sidebar"
            hint={
              sidebarMode === 'auto'
                ? 'Sidebar sits as a narrow icon rail and expands on hover, collapsing when you move away.'
                : 'Sidebar stays where you put it; use the collapse button in its header to toggle.'
            }
            checked={sidebarMode === 'auto'}
            onChange={(v) => setSidebarMode(v ? 'auto' : 'manual')}
          />
          <SelectRow<DashboardDefaultTab>
            label="Default dashboard page"
            hint="Which tab the Dashboard opens on."
            value={dashboardDefaultTab}
            options={(Object.keys(DASHBOARD_TAB_LABELS) as DashboardDefaultTab[]).map((v) => ({
              value: v,
              label: DASHBOARD_TAB_LABELS[v],
            }))}
            onChange={setDashboardDefaultTab}
          />
          <SwitchRow
            label="Show dice rolls on screen"
            hint="Flashes the result in the centre of the screen whenever anything is rolled."
            checked={diceVisual}
            onChange={setDiceVisual}
          />
          <SwitchRow
            label="Dice roll sound"
            hint="A short clatter on each roll. Turn off if the table shares one speaker."
            checked={diceSound}
            onChange={setDiceSound}
          />
          <RoleColorRows />
        </Section>

        <Section title="Navigation">
          <p className="text-xs text-slate-500 mb-3">
            Reorder or hide pages in your sidebar. Personal — doesn't affect other players.
          </p>
          <CustomizeNavBody
            items={editableNav}
            hidden={customNav.hidden}
            onReorder={(next) => customNav.setOrder(next.map((i) => i.to))}
            onToggleHidden={(path) => customNav.toggleHidden(path)}
            onReset={customNav.reset}
          />
        </Section>

        {isGM && (
          <Section title="Player visibility">
            <p className="text-xs text-slate-500 mb-3">
              Show or hide pages from players in this campaign. GM-only pages can be shared with players.
            </p>
            <PlayerVisibilityBody
              nav={NAV}
              hiddenPages={hiddenPages}
              allowedGmPages={allowedGmPages}
              onTogglePage={togglePage}
              onToggleGmPage={toggleGmPage}
              onHideAll={() => hideAll(NAV.filter((n) => !n.gmOnly).map((n) => n.to.replace('/', '')))}
              onShowAll={showAll}
            />
          </Section>
        )}

        {isGM && (
          <Section title="House rules">
            <SwitchRow
              label="Track encumbrance"
              hint={
                encumbrance
                  ? 'Character sheets show carried weight against a STR-based capacity.'
                  : 'Carry weight is unlimited; the encumbrance panel shows ∞.'
              }
              checked={encumbrance}
              onChange={setEncumbrance}
            />
            <div className="px-4 py-3 border-b border-slate-800 last:border-b-0">
              <div className="text-sm text-slate-200">HP on level-up</div>
              <div className="text-[11px] text-slate-500 font-normal mb-2">
                How characters gain HP when leveling. Level-up modal defaults to this; players can still override per-level.
              </div>
              <div className="flex rounded overflow-hidden border border-slate-700 w-fit">
                {(['avg', 'roll', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setHpRollingMethod(m)}
                    className={`px-3 py-1 text-xs ${
                      hpRollingMethod === m
                        ? 'bg-sky-900/40 text-sky-200'
                        : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {m === 'avg' ? 'Take average' : m === 'roll' ? 'Roll the die' : 'Manual entry'}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 border-b border-slate-800 last:border-b-0">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-200">Currency conversion rates</div>
                <button
                  onClick={resetCoinRates}
                  className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                >
                  Reset to 5e
                </button>
              </div>
              <div className="text-[11px] text-slate-500 font-normal mb-2">
                Each coin's value in copper. Drives the converter on the character sheet. Change these for a house economy.
              </div>
              <div className="grid grid-cols-5 gap-2">
                {COIN_KEYS.map((coin) => (
                  <label key={coin} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">{coin}</span>
                    <input
                      type="number"
                      min={0}
                      value={coinRates[coin]}
                      onChange={(e) => setCoinRate(coin, parseInt(e.target.value || '0', 10) || 0)}
                      className="w-full text-center bg-slate-950 border border-slate-700 rounded px-1 py-1 text-xs font-mono text-slate-200"
                    />
                  </label>
                ))}
              </div>
            </div>
          </Section>
        )}

        {trueIsGM && (
          <Section title="GM tools">
            <Row
              icon={<Eye size={14} />}
              label={viewAsPlayer ? 'Exit player view' : 'View as player'}
              hint={
                viewAsPlayer
                  ? 'Currently previewing what players see.'
                  : 'Preview the campaign as a regular player.'
              }
              onClick={() => setViewAsPlayer(!viewAsPlayer)}
            />
            <Row
              icon={<Download size={14} />}
              label={exporting ? 'Building export…' : 'Export campaign'}
              hint="Download a JSON snapshot of party, notes, NPCs, homebrew, settings, maps, and initiative. Chat history and transcripts are excluded."
              onClick={async () => {
                if (!campaignId || exporting) return;
                setExporting(true);
                try {
                  await downloadCampaignExport(campaignId, campaignName);
                } finally {
                  setExporting(false);
                }
              }}
            />
          </Section>
        )}

        {isGM && campaignId && (
          <CampaignManagementPanel selfId={userId} campaignId={campaignId} />
        )}

        <Section title="Backup & restore">
          <Row
            icon={<Upload size={14} />}
            label={importing ? `Importing — ${importPhase || 'working'}…` : 'Import campaign'}
            hint="Load a Grimoire export JSON to create a new campaign with everything from the backup. Your current campaign is not modified."
            onClick={() => {
              if (importing) return;
              importInputRef.current?.click();
            }}
          />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onPickImportFile}
          />
          {importError && (
            <div className="px-4 py-3 border-t border-slate-800 flex items-start gap-2 text-[12px] text-rose-300">
              <AlertCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Import failed</div>
                <div className="text-rose-400/90 break-words">{importError}</div>
              </div>
              <button
                onClick={() => setImportError(null)}
                className="text-rose-400/70 hover:text-rose-200 shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
          {importResult && (
            <div className="px-4 py-3 border-t border-slate-800 text-[12px] text-slate-200">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    Created <span className="text-emerald-300">{importResult.campaignName}</span>
                  </div>
                  <div className="text-slate-400 mt-0.5">
                    Join code{' '}
                    <span className="font-mono text-sky-300">{importResult.joinCode}</span> ·
                    {' '}
                    {summariseCounts(importResult)}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={switchToImported}
                      className="text-[11px] px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white"
                    >
                      Switch to it now
                    </button>
                    <button
                      onClick={() => setImportResult(null)}
                      className="text-[11px] px-2 py-1 rounded text-slate-400 hover:text-slate-200"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Section>

        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Membership</h2>
          <LeaveCampaignRow />
        </section>

        <Section title="Account">
          <AccountEmailRow email={email} />
          <AccountPasswordRow email={email} />
          <Row icon={<ArrowLeftRight size={14} />} label="Switch campaign" onClick={leaveCurrent} />
          <Row icon={<LogOut size={14} />} label="Sign out" onClick={signOut} danger />
        </Section>
      </div>
    </div>
  );
}

/** Three rows that let the user retint the "Game Master" / "Co-GM" /
 *  "Player" labels they see across the Dashboard and roster. Local-only
 *  preference — these never leave the browser, so each user can pick a
 *  palette that helps them parse the roster at a glance without imposing
 *  it on anyone else. */
function ThemeColorRow() {
  const theme = useTheme((s) => s.theme);
  const mode = useTheme((s) => s.mode);
  const setTheme = useTheme((s) => s.setTheme);
  return (
    <div className="px-4 py-3 border-b border-slate-800 last:border-b-0 space-y-2">
      <div>
        <div className="text-sm text-slate-200">Colour theme</div>
        <div className="text-[11px] text-slate-500">
          Tints backgrounds and accents across the app. Dark mode only
          {mode === 'light' && ' — picking a colour switches you to dark mode'}.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {THEMES.map((t) => {
          const active = theme === t.id && mode === 'dark';
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                active ? 'border-white' : 'border-transparent'
              }`}
              style={{ backgroundColor: t.swatch }}
            />
          );
        })}
      </div>
    </div>
  );
}

function RoleColorRows() {
  const gm = useRoleColors((s) => s.gm);
  const cogm = useRoleColors((s) => s.cogm);
  const player = useRoleColors((s) => s.player);
  const setRoleColor = useRoleColors((s) => s.setRoleColor);
  const resetRoleColors = useRoleColors((s) => s.resetRoleColors);
  const allDefault =
    gm === DEFAULT_GM_COLOR && cogm === DEFAULT_COGM_COLOR && player === DEFAULT_PLAYER_COLOR;
  return (
    <div className="px-4 py-3 border-b border-slate-800 last:border-b-0 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-200">Role label colours</div>
          <div className="text-[11px] text-slate-500">
            Tints the "Game Master", "Co-GM" and "Player" labels in your view. Personal — other
            players see their own colours.
          </div>
        </div>
        {!allDefault && (
          <button
            onClick={resetRoleColors}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 shrink-0"
            title="Restore default colours"
          >
            <RotateCcw size={11} /> Reset
          </button>
        )}
      </div>
      <RoleColorRow label="Game Master" sample="Game Master" value={gm} onChange={(c) => setRoleColor('gm', c)} />
      <RoleColorRow label="Co-GM" sample="Co-GM" value={cogm} onChange={(c) => setRoleColor('cogm', c)} />
      <RoleColorRow label="Player" sample="Player" value={player} onChange={(c) => setRoleColor('player', c)} />
    </div>
  );
}

function RoleColorRow({
  label,
  sample,
  value,
  onChange,
}: {
  label: string;
  sample: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-[11px] text-slate-400">{label}</div>
      <div
        className="text-[10px] uppercase tracking-wider w-24 shrink-0"
        style={{ color: value }}
        title={`Live preview — ${value}`}
      >
        {sample}
      </div>
      <div className="flex flex-wrap gap-1 flex-1">
        {ROLE_COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
              value === c ? 'border-white' : 'border-transparent'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-5 w-6 bg-transparent border border-slate-700 rounded cursor-pointer"
          title="Custom colour"
        />
      </div>
    </div>
  );
}

/** Compact "37 notes, 12 NPCs, 4 scenes" line for the import-result panel.
 *  Skips zero-count buckets so a small import doesn't list seven zeros. */
function summariseCounts(r: ImportResult): string {
  const c = r.counts;
  const parts: string[] = [];
  if (c.notes) parts.push(`${c.notes} note${c.notes === 1 ? '' : 's'}`);
  if (c.folders) parts.push(`${c.folders} folder${c.folders === 1 ? '' : 's'}`);
  if (c.party) parts.push(`${c.party} PC${c.party === 1 ? '' : 's'}`);
  if (c.npcs) parts.push(`${c.npcs} NPC${c.npcs === 1 ? '' : 's'}`);
  if (c.homebrew) parts.push(`${c.homebrew} homebrew`);
  if (c.scenes) parts.push(`${c.scenes} scene${c.scenes === 1 ? '' : 's'}`);
  if (c.tokens) parts.push(`${c.tokens} token${c.tokens === 1 ? '' : 's'}`);
  if (c.initiative) parts.push(`${c.initiative} initiative row${c.initiative === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'empty backup';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">{title}</h2>
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  // Track 40px wide, thumb 16px, 2px padding each side: off=left:2, on=left:22
  // (40 - 16 - 2 = 22). Using fixed offsets so the thumb stays fully inside
  // the pill in both states without relying on arbitrary translate values.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/40 border-b border-slate-800 last:border-b-0"
    >
      <span className="flex-1 text-left">
        {label}
        {hint && <span className="block text-[11px] text-slate-500 font-normal">{hint}</span>}
      </span>
      <span
        className={`relative inline-block h-5 w-10 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-sky-600' : 'bg-slate-700'
        }`}
        aria-hidden
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
          style={{ left: checked ? '22px' : '2px' }}
        />
      </span>
    </button>
  );
}

function SelectRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 border-b border-slate-800 last:border-b-0">
      <span className="flex-1 text-left">
        {label}
        {hint && <span className="block text-[11px] text-slate-500 font-normal">{hint}</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="shrink-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Row({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm border-b border-slate-800 last:border-b-0 ${
        danger ? 'text-rose-300 hover:bg-rose-950/30' : 'text-slate-200 hover:bg-slate-800/40'
      }`}
    >
      <span className={danger ? 'text-rose-400' : 'text-slate-400'}>{icon}</span>
      <span className="flex-1 text-left">
        {label}
        {hint && <span className="block text-[11px] text-slate-500 font-normal">{hint}</span>}
      </span>
    </button>
  );
}

// ── Customize nav (drag to reorder, click to hide) ────────────────────────

function CustomizeNavBody({
  items,
  hidden,
  onReorder,
  onToggleHidden,
  onReset,
}: {
  items: { to: string; label: string; icon: React.ComponentType<{ size?: number }> }[];
  hidden: string[];
  onReorder: (next: { to: string; label: string; icon: React.ComponentType<{ size?: number }> }[]) => void;
  onToggleHidden: (path: string) => void;
  onReset: () => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const onDragStart = (i: number) => (e: React.DragEvent) => {
    setDragFrom(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };
  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(i);
  };
  const onDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragFrom === null || dragFrom === i) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const next = items.slice();
    const [moved] = next.splice(dragFrom, 1);
    next.splice(i, 0, moved);
    onReorder(next);
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div>
      <div className="px-4 py-2 border-b border-slate-800 flex justify-end">
        <button
          onClick={onReset}
          title="Restore default order and unhide all"
          className="px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded flex items-center gap-1"
        >
          <RotateCcw size={11} /> Reset
        </button>
      </div>
      <div>
        {items.map((item, i) => {
          const isHidden = hidden.includes(item.to);
          return (
            <div
              key={item.to}
              draggable
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDragLeave={() => setDragOver(null)}
              onDrop={onDrop(i)}
              className={`flex items-center gap-3 px-4 py-2 border-b border-slate-800 last:border-b-0 text-sm cursor-grab active:cursor-grabbing transition-colors ${
                dragOver === i && dragFrom !== i
                  ? 'bg-sky-900/30'
                  : isHidden
                    ? 'text-slate-600'
                    : 'text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <GripVertical size={14} className="text-slate-600 shrink-0" />
              <item.icon size={13} />
              <span className="flex-1 truncate">{item.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHidden(item.to);
                }}
                title={isHidden ? 'Show in sidebar' : 'Hide from sidebar'}
                className="p-1 text-slate-500 hover:text-slate-200"
              >
                {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Player visibility (GM-only page gating) ───────────────────────────────

function PlayerVisibilityBody({
  nav,
  hiddenPages,
  allowedGmPages,
  onTogglePage,
  onToggleGmPage,
  onHideAll,
  onShowAll,
}: {
  nav: NavItem[];
  hiddenPages: string[];
  allowedGmPages: string[];
  onTogglePage: (slug: string) => void;
  onToggleGmPage: (slug: string) => void;
  onHideAll: () => void;
  onShowAll: () => void;
}) {
  const regular = nav.filter((n) => !n.gmOnly);
  const gmOnly = nav.filter((n) => n.gmOnly);
  return (
    <div>
      <div className="px-4 py-2 border-b border-slate-800 flex justify-end gap-1">
        <button
          onClick={onHideAll}
          className="px-2 py-0.5 text-[11px] bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
        >
          Hide all
        </button>
        <button
          onClick={onShowAll}
          className="px-2 py-0.5 text-[11px] bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
        >
          Show all
        </button>
      </div>
      <div>
        {regular.map((item) => {
          const slug = item.to.replace('/', '');
          const hidden = hiddenPages.includes(slug);
          return (
            <button
              key={item.to}
              onClick={() => onTogglePage(slug)}
              className={`w-full flex items-center gap-3 px-4 py-2 border-b border-slate-800 last:border-b-0 text-sm ${
                hidden ? 'text-slate-500 hover:bg-slate-800/40' : 'text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <item.icon size={13} />
              <span className="flex-1 text-left">{item.label}</span>
              {hidden ? (
                <EyeOff size={13} className="text-amber-500" />
              ) : (
                <Eye size={13} className="text-emerald-500" />
              )}
            </button>
          );
        })}
        {gmOnly.length > 0 && (
          <>
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-slate-600 bg-slate-900/40 border-y border-slate-800">
              GM-only pages
            </div>
            {gmOnly.map((item) => {
              const slug = item.to.replace('/', '');
              const shared = allowedGmPages.includes(slug);
              return (
                <button
                  key={item.to}
                  onClick={() => onToggleGmPage(slug)}
                  className={`w-full flex items-center gap-3 px-4 py-2 border-b border-slate-800 last:border-b-0 text-sm ${
                    shared ? 'text-slate-200 hover:bg-slate-800/40' : 'text-slate-500 hover:bg-slate-800/40'
                  }`}
                >
                  <item.icon size={13} />
                  <span className="flex-1 text-left">
                    {item.label}
                    <span className="block text-[11px] text-slate-500 font-normal">
                      {shared ? 'Shared with players' : 'GM only'}
                    </span>
                  </span>
                  {shared ? (
                    <Eye size={13} className="text-sky-400" />
                  ) : (
                    <EyeOff size={13} className="text-slate-600" />
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ── Account email / password rows ─────────────────────────────────────────

type Feedback = { kind: 'ok' | 'err'; message: string } | null;

function AccountEmailRow({ email }: { email: string | null }) {
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const submit = async () => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === email) {
      setFeedback({ kind: 'err', message: 'Enter a different email address.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const { error } = await supabase.auth.updateUser({ email: trimmed });
    setBusy(false);
    if (error) {
      setFeedback({ kind: 'err', message: error.message });
    } else {
      setFeedback({
        kind: 'ok',
        message: `Confirmation sent to ${trimmed}. The change applies once you click the link.`,
      });
      setEditing(false);
      setNext('');
    }
  };

  return (
    <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-200">
      <div className="flex items-center gap-3">
        <Mail size={14} className="text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Email</div>
          <div className="truncate">{email ?? '—'}</div>
        </div>
        {!editing && (
          <button
            onClick={() => {
              setEditing(true);
              setNext(email ?? '');
              setFeedback(null);
            }}
            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Change
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="new@example.com"
            className="flex-1 min-w-[200px] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
          />
          <button
            onClick={submit}
            disabled={busy}
            className="text-xs px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white"
          >
            {busy ? 'Sending…' : 'Send confirmation'}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setNext('');
              setFeedback(null);
            }}
            className="text-xs px-3 py-1 rounded text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      )}
      {feedback && (
        <div
          className={`mt-2 text-[11px] ${
            feedback.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}

function AccountPasswordRow({ email }: { email: string | null }) {
  const [editing, setEditing] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [resetSending, setResetSending] = useState(false);

  const submit = async () => {
    if (pw.length < 6) {
      setFeedback({ kind: 'err', message: 'Password must be at least 6 characters.' });
      return;
    }
    if (pw !== pw2) {
      setFeedback({ kind: 'err', message: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setFeedback({ kind: 'err', message: error.message });
    } else {
      setFeedback({ kind: 'ok', message: 'Password updated.' });
      setEditing(false);
      setPw('');
      setPw2('');
    }
  };

  const sendReset = async () => {
    if (!email) return;
    setResetSending(true);
    setFeedback(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setResetSending(false);
    setFeedback(
      error
        ? { kind: 'err', message: error.message }
        : { kind: 'ok', message: `Reset link sent to ${email}.` },
    );
  };

  return (
    <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-200">
      <div className="flex items-center gap-3">
        <KeyRound size={14} className="text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Password</div>
          <div className="text-slate-400">Set a new password or have a reset link sent.</div>
        </div>
        {!editing && (
          <button
            onClick={() => {
              setEditing(true);
              setFeedback(null);
            }}
            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Change
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
            autoComplete="new-password"
          />
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Repeat"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
            autoComplete="new-password"
          />
          <button
            onClick={submit}
            disabled={busy}
            className="text-xs px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setPw('');
              setPw2('');
              setFeedback(null);
            }}
            className="text-xs px-3 py-1 rounded text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="mt-2">
        <button
          onClick={sendReset}
          disabled={!email || resetSending}
          className="text-[11px] text-sky-300 hover:text-sky-200 disabled:opacity-50"
        >
          {resetSending ? 'Sending…' : 'Forgot password? Send a reset link to my email'}
        </button>
      </div>
      {feedback && (
        <div
          className={`mt-2 text-[11px] ${
            feedback.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
