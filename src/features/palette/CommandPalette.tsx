import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, Sun, Moon, Dices, Users, Swords, NotebookPen,
  Map as MapIcon, Sparkles, Package, ScrollText, BookOpen, BookMarked,
  FlaskConical, Mic, LayoutDashboard, Settings as SettingsIcon, Eye,
} from 'lucide-react';
import { usePalette } from './paletteStore';
import { useCatalog, searchCatalog, kindLabel, type CatalogEntry, type CatalogKind } from '../chat/catalog';
import { useChatCatalog } from '../chat/useChatCatalog';
import { useOpenCatalogRef } from '../chat/useOpenCatalogRef';
import { useSession } from '../session/sessionStore';
import { useCampaignSettings } from '../notes/campaignSettingsStore';
import { useTheme } from '../session/themeStore';
import { useQuickDice } from '../dice/quickDiceStore';
import { useParty } from '../party/partyStore';
import { KIND_FG } from '../chat/chips';

/**
 * Global command palette (⌘K / Ctrl-K).
 *
 * Two result sources:
 *  - Commands: navigation and a few actions, filtered by role/page visibility
 *    so a player never sees a GM-only destination.
 *  - Content: the same catalog chat's `#` references use (notes, NPCs,
 *    homebrew, SRD spells/items/rules) plus party members, opened through the
 *    shared routing helper so results land where chips would.
 */

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  run: () => void;
};

type Row =
  | { kind: 'command'; cmd: Command }
  | { kind: 'entry'; entry: CatalogEntry }
  | { kind: 'party'; id: string; name: string; sub: string };

const NAV: { to: string; label: string; icon: typeof Search; gmOnly?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/initiative', label: 'Initiative', icon: Swords },
  { to: '/party', label: 'Party', icon: Users },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/npcs', label: 'NPCs', icon: BookMarked },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/spells', label: 'Spells', icon: Sparkles },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/encounters', label: 'Encounters', icon: Swords, gmOnly: true },
  { to: '/statblocks', label: 'Stat Blocks', icon: ScrollText, gmOnly: true },
  { to: '/homebrew', label: 'Homebrew', icon: FlaskConical, gmOnly: true },
  { to: '/record', label: 'Record', icon: Mic, gmOnly: true },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const MAX_CONTENT = 12;

export default function CommandPalette() {
  const open = usePalette((s) => s.open);
  const close = usePalette((s) => s.close);
  const toggle = usePalette((s) => s.toggle);

  const navigate = useNavigate();
  const openRef = useOpenCatalogRef();
  const campaignId = useSession((s) => s.campaignId);
  const role = useSession((s) => s.role);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const setViewAsPlayer = useSession((s) => s.setViewAsPlayer);
  const isGM = (role === 'gm' || role === 'cogm') && !viewAsPlayer;
  const trueIsGM = role === 'gm' || role === 'cogm';

  const hiddenPages = useCampaignSettings((s) => s.settings.hiddenPages ?? []);
  const allowedGmPages = useCampaignSettings((s) => s.settings.allowedGmPages ?? []);
  const { mode, toggle: toggleMode } = useTheme();
  const rollFormula = useQuickDice((s) => s.rollFormula);
  const openDice = useQuickDice((s) => s.openPanel);
  const party = useParty((s) => s.party);
  const loadParty = useParty((s) => s.loadForCampaign);

  const catalog = useCatalog();
  useChatCatalog(campaignId);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl-K from anywhere, Esc to dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, close]);

  // Fresh query each time it opens; party is pulled in so members are
  // searchable even if the Party page was never visited this session.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    if (campaignId && party.length === 0) void loadParty(campaignId);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, campaignId, party.length, loadParty]);

  const commands = useMemo<Command[]>(() => {
    const visible = NAV.filter((n) => {
      if (n.to === '/settings') return true;
      const slug = n.to.replace('/', '');
      if (isGM) return true;
      if (n.gmOnly) return allowedGmPages.includes(slug);
      return !hiddenPages.includes(slug);
    });

    const out: Command[] = visible.map((n) => ({
      id: `nav:${n.to}`,
      label: `Go to ${n.label}`,
      icon: n.icon,
      run: () => navigate(n.to),
    }));

    out.push(
      {
        id: 'roll:d20',
        label: 'Roll d20',
        hint: 'quick roll',
        icon: Dices,
        run: () => rollFormula('1d20', 'd20'),
      },
      {
        id: 'dice:open',
        label: 'Open quick dice',
        icon: Dices,
        run: () => openDice(),
      },
      {
        id: 'theme:toggle',
        label: mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        icon: mode === 'dark' ? Sun : Moon,
        run: () => toggleMode(),
      },
    );

    if (trueIsGM) {
      out.push({
        id: 'gm:viewas',
        label: viewAsPlayer ? 'Exit player view' : 'View as player',
        icon: Eye,
        run: () => setViewAsPlayer(!viewAsPlayer),
      });
    }
    return out;
  }, [
    isGM, trueIsGM, viewAsPlayer, hiddenPages, allowedGmPages, mode,
    navigate, rollFormula, openDice, toggleMode, setViewAsPlayer,
  ]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const cmdRows: Row[] = commands
      .filter((c) => !q || c.label.toLowerCase().includes(q))
      .map((cmd) => ({ kind: 'command', cmd }));

    if (!q) return cmdRows;

    const partyRows: Row[] = party
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({
        kind: 'party',
        id: p.id,
        name: p.name,
        sub: [p.classSummary, p.race].filter(Boolean).join(' · ') || 'Character',
      }));

    const entryRows: Row[] = searchCatalog(catalog, q, MAX_CONTENT).map((entry) => ({
      kind: 'entry',
      entry,
    }));

    return [...cmdRows, ...partyRows, ...entryRows];
  }, [query, commands, party, catalog]);

  // Keep the cursor inside the list as results change.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const run = (row: Row) => {
    close();
    if (row.kind === 'command') row.cmd.run();
    else if (row.kind === 'party') navigate(`/party#member-${row.id}`);
    else {
      const colon = row.entry.id.indexOf(':');
      const identifier = colon >= 0 ? row.entry.id.slice(colon + 1) : row.entry.id;
      openRef(row.entry.kind as CatalogKind, identifier);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (rows.length ? (c + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (rows.length ? (c - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[cursor];
      if (row) run(row);
    }
  };

  // Scroll the active row into view during keyboard navigation.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4 bg-black/50"
      onMouseDown={close}
    >
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-slate-800">
          <Search size={15} className="text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search notes, NPCs, spells, items, rules — or type a command"
            className="flex-1 bg-transparent py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600"
          />
          <kbd className="text-[10px] text-slate-600 border border-slate-700 rounded px-1.5 py-0.5 shrink-0">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-600 italic">
              Nothing matches “{query}”.
            </div>
          )}

          {rows.map((row, i) => {
            const active = i === cursor;
            const key =
              row.kind === 'command' ? row.cmd.id
              : row.kind === 'party' ? `party:${row.id}`
              : `entry:${row.entry.id}`;

            const Icon = row.kind === 'command' ? row.cmd.icon : row.kind === 'party' ? Users : null;
            const label = row.kind === 'command' ? row.cmd.label : row.kind === 'party' ? row.name : row.entry.name;
            const sub =
              row.kind === 'command' ? row.cmd.hint
              : row.kind === 'party' ? row.sub
              : row.entry.hint;
            const badge =
              row.kind === 'command' ? null
              : row.kind === 'party' ? 'Character'
              : kindLabel(row.entry.kind);
            const badgeColor =
              row.kind === 'entry' ? KIND_FG[row.entry.kind] : '#94a3b8';

            return (
              <button
                key={key}
                data-active={active}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(row)}
                className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm ${
                  active ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                {Icon ? (
                  <Icon size={14} className="text-slate-500 shrink-0" />
                ) : (
                  <span className="w-[14px] shrink-0" />
                )}
                <span className="flex-1 min-w-0 truncate">{label}</span>
                {sub && <span className="text-[11px] text-slate-600 truncate max-w-[40%]">{sub}</span>}
                {badge && (
                  <span
                    className="text-[10px] uppercase tracking-wider shrink-0"
                    style={{ color: badgeColor }}
                  >
                    {badge}
                  </span>
                )}
                {active && <CornerDownLeft size={12} className="text-slate-600 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
