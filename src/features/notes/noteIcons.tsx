/**
 * Shared note-icon palette + helpers.
 *
 * Extracted from Notes.tsx so the sidebar file tree, the editor header, and the
 * Mind Map all render the same icon and colour for a given note. `note.icon` is
 * stored as either `iconId` (legacy / default colour) or `iconId|#hex` once the
 * user picks a custom tint — see parseNoteIcon/formatNoteIcon.
 */
import {
  FileText,
  Home,
  Mountain,
  Flag,
  Ship,
  AlertTriangle,
  HelpCircle,
  Gem,
  Flame,
  Swords,
  Skull,
  BookOpen,
  Star,
  Crown,
  Compass,
  Lock,
  MapPin,
} from 'lucide-react';

export type NoteIconDef = {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: React.ComponentType<any>;
  color: string;
  label: string;
};

export const NOTE_ICONS: NoteIconDef[] = [
  { id: 'note',      Icon: FileText,      color: '#64748b', label: 'Note' },
  { id: 'town',      Icon: Home,          color: '#60a5fa', label: 'Town' },
  { id: 'dungeon',   Icon: Mountain,      color: '#c2863b', label: 'Dungeon' },
  { id: 'quest',     Icon: Flag,          color: '#f87171', label: 'Quest' },
  { id: 'travel',    Icon: Ship,          color: '#38bdf8', label: 'Travel' },
  { id: 'alert',     Icon: AlertTriangle, color: '#fbbf24', label: 'Alert' },
  { id: 'mystery',   Icon: HelpCircle,    color: '#a78bfa', label: 'Mystery' },
  { id: 'treasure',  Icon: Gem,           color: '#34d399', label: 'Treasure' },
  { id: 'danger',    Icon: Flame,         color: '#fb923c', label: 'Danger' },
  { id: 'combat',    Icon: Swords,        color: '#f472b6', label: 'Combat' },
  { id: 'death',     Icon: Skull,         color: '#94a3b8', label: 'Death' },
  { id: 'lore',      Icon: BookOpen,      color: '#c084fc', label: 'Lore' },
  { id: 'important', Icon: Star,          color: '#facc15', label: 'Important' },
  { id: 'npc',       Icon: Crown,         color: '#f59e0b', label: 'NPC' },
  { id: 'explore',   Icon: Compass,       color: '#2dd4bf', label: 'Explore' },
  { id: 'secret',    Icon: Lock,          color: '#818cf8', label: 'Secret' },
  { id: 'location',  Icon: MapPin,        color: '#fb7185', label: 'Location' },
];

export function getNoteIconDef(iconId: string | null | undefined): NoteIconDef {
  return NOTE_ICONS.find((i) => i.id === iconId) ?? NOTE_ICONS[0];
}

// Palette of selectable tints for note icons. Includes a "default" sentinel
// so the user can drop their override and fall back to the icon's natural
// colour from NOTE_ICONS.
export const NOTE_ICON_COLORS: { color: string | null; label: string }[] = [
  { color: null,       label: 'Default' },
  { color: '#60a5fa',  label: 'Blue' },
  { color: '#f87171',  label: 'Red' },
  { color: '#fbbf24',  label: 'Amber' },
  { color: '#34d399',  label: 'Green' },
  { color: '#a78bfa',  label: 'Purple' },
  { color: '#fb923c',  label: 'Orange' },
  { color: '#f472b6',  label: 'Pink' },
  { color: '#94a3b8',  label: 'Slate' },
  { color: '#facc15',  label: 'Yellow' },
  { color: '#2dd4bf',  label: 'Teal' },
  { color: '#fafafa',  label: 'White' },
];

/** note.icon is stored as either `iconId` (legacy / default colour) or
 *  `iconId|#hex` once the user has picked a custom tint. Both forms round-
 *  trip through this pair so existing data keeps working without a
 *  migration. */
export function parseNoteIcon(stored: string | null | undefined): {
  id: string | null;
  color: string | null;
} {
  if (!stored) return { id: null, color: null };
  const pipe = stored.indexOf('|');
  if (pipe < 0) return { id: stored, color: null };
  const id = stored.slice(0, pipe);
  const color = stored.slice(pipe + 1);
  return { id: id || null, color: color || null };
}

export function formatNoteIcon(id: string | null, color: string | null): string | null {
  // No custom colour → fall back to the legacy id-only form, including null
  // for the default 'note' icon so we don't churn rows that only ever had
  // their colour reset.
  if (!color) {
    if (!id || id === 'note') return null;
    return id;
  }
  return `${id ?? 'note'}|${color}`;
}

/** Resolve a stored `note.icon` string to the concrete Icon component and the
 *  effective colour (custom tint if set, otherwise the icon's natural colour). */
export function resolveNoteIcon(stored: string | null | undefined): {
  Icon: NoteIconDef['Icon'];
  color: string;
} {
  const { id, color } = parseNoteIcon(stored);
  const def = getNoteIconDef(id);
  return { Icon: def.Icon, color: color ?? def.color };
}

export function NoteIconDisplay({ iconId, size = 11 }: { iconId: string | null | undefined; size?: number }) {
  const { Icon, color } = resolveNoteIcon(iconId);
  return <Icon size={size} style={{ color }} className="shrink-0" />;
}
