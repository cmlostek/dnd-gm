import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X, type LucideIcon } from 'lucide-react';
import { iconByKey, iconGroups } from '../data/itemIcons';

/**
 * Compact icon picker. Renders the currently selected item icon (or a supplied
 * fallback) as a button that opens a grouped grid popover. Passing `value`
 * undefined/empty shows the fallback and lets the user pick one; selecting the
 * already-active icon or the "Auto" chip clears the override (emits undefined).
 */
export default function IconPicker({
  value,
  onChange,
  fallback: Fallback,
  fallbackColor = '#94a3b8',
  size = 16,
  title = 'Choose icon',
}: {
  value?: string;
  onChange: (key: string | undefined) => void;
  /** Icon shown when no key is set (e.g. the auto-derived kind icon). */
  fallback?: LucideIcon | null;
  fallbackColor?: string;
  size?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const Selected = iconByKey(value);
  const Current = Selected ?? Fallback ?? null;

  const pick = (key: string) => {
    onChange(key === value ? undefined : key);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        className={`flex items-center gap-0.5 rounded border px-1 py-1 transition-colors ${
          open ? 'border-sky-700 bg-slate-800' : 'border-slate-700 bg-slate-900 hover:bg-slate-800'
        }`}
      >
        {Current ? (
          <Current size={size} style={{ color: Selected ? '#e2e8f0' : fallbackColor }} />
        ) : (
          <span className="text-[10px] text-slate-500 px-0.5">icon</span>
        )}
        <ChevronDown size={10} className="text-slate-500" />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 max-h-72 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-2">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="w-full flex items-center gap-1.5 text-left px-2 py-1 mb-1 rounded text-[11px] text-slate-400 hover:bg-slate-800"
          >
            <X size={12} /> Auto {Fallback && '(default icon)'}
          </button>
          {iconGroups().map(({ group, icons }) => (
            <div key={group} className="mb-1.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-600 px-1 mb-1">{group}</div>
              <div className="grid grid-cols-7 gap-1">
                {icons.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pick(key)}
                    title={label}
                    className={`flex items-center justify-center aspect-square rounded border transition-colors ${
                      key === value
                        ? 'border-sky-600 bg-sky-900/40 text-sky-200'
                        : 'border-transparent bg-slate-950/50 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
