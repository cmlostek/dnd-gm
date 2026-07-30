import { useEffect, useRef, useState } from 'react';
import { Dices, X, Trash2, Send } from 'lucide-react';
import { useQuickDice, type Roll } from './quickDiceStore';
import { useChat } from '../chat/chatStore';
import { useSession } from '../session/sessionStore';

type Die = 4 | 6 | 8 | 10 | 12 | 20 | 100;
const DICE: Die[] = [4, 6, 8, 10, 12, 20, 100];

const rollDie = (sides: Die) => Math.floor(Math.random() * sides) + 1;

const POS_KEY = 'grimoire:quickdice:pos';
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

function readPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: number; y?: number };
    if (p?.x == null || p?.y == null) return null;
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}
function writePos(pos: { x: number; y: number } | null) {
  try {
    if (pos === null) localStorage.removeItem(POS_KEY);
    else localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch { /* ignore */ }
}

export function QuickDice() {
  const { open, close, history, pushRoll, clearHistory } = useQuickDice();
  const sendRoll = useChat((s) => s.sendRoll);
  const campaignId = useSession((s) => s.campaignId);
  const [mod, setMod] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => readPos());
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const beginDrag = (e: React.MouseEvent) => {
    // Ignore drags that start on a header button (clear / close).
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const startPos = posRef.current ?? (rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 });
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      setPos({
        x: clamp(startPos.x + (ev.clientX - startX), 8, window.innerWidth - 48),
        y: clamp(startPos.y + (ev.clientY - startY), 8, window.innerHeight - 48),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      writePos(posRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetPos = () => {
    setPos(null);
    writePos(null);
  };

  const quick = (d: Die) => {
    const v = rollDie(d);
    const withMod = v + mod;
    const crit = d === 20 ? (v === 20 ? 'hit' : v === 1 ? 'miss' : undefined) : undefined;
    pushRoll({
      id: crypto.randomUUID(),
      label: `d${d}${mod ? (mod > 0 ? ` + ${mod}` : ` − ${-mod}`) : ''}`,
      detail: `[${v}]${mod ? ` ${mod >= 0 ? '+' : '−'} ${Math.abs(mod)}` : ''}`,
      total: withMod,
      crit,
      die: d,
    });
  };

  const d20adv = (mode: 'adv' | 'dis') => {
    const a = rollDie(20);
    const b = rollDie(20);
    const pick = mode === 'adv' ? Math.max(a, b) : Math.min(a, b);
    const dropped = pick === a ? b : a;
    const crit = pick === 20 ? 'hit' : pick === 1 ? 'miss' : undefined;
    pushRoll({
      id: crypto.randomUUID(),
      label: `d20 ${mode === 'adv' ? 'adv' : 'dis'}${mod ? (mod > 0 ? ` + ${mod}` : ` − ${-mod}`) : ''}`,
      detail: `[${pick}, ~${dropped}]${mod ? ` ${mod >= 0 ? '+' : '−'} ${Math.abs(mod)}` : ''}`,
      total: pick + mod,
      crit,
      dropped,
      die: 20,
    });
  };

  const containerStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, width: 288 }
    : { right: 16, bottom: 16, width: 288 };

  return (
    <div
      ref={panelRef}
      className="fixed z-40 bg-slate-950 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
      style={containerStyle}
    >
      <div
        onMouseDown={beginDrag}
        onDoubleClick={resetPos}
        className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900"
        style={{ cursor: 'move' }}
        title="Drag to move · double-click to reset"
      >
        <div className="flex items-center gap-2 text-sm text-sky-200">
          <Dices size={14} /> Quick dice
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              title="Clear history"
              className="p-1 text-slate-500 hover:text-slate-200"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button onClick={close} className="p-1 text-slate-500 hover:text-slate-200">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="grid grid-cols-4 gap-1">
          {DICE.map((d) => (
            <button
              key={d}
              onClick={() => quick(d)}
              className="py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded font-mono text-xs"
            >
              d{d}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={() => d20adv('adv')}
            className="py-1.5 bg-emerald-900/40 hover:bg-emerald-800/60 border border-emerald-800 rounded text-xs text-emerald-200"
          >
            d20 Advantage
          </button>
          <button
            onClick={() => d20adv('dis')}
            className="py-1.5 bg-rose-900/40 hover:bg-rose-800/60 border border-rose-800 rounded text-xs text-rose-200"
          >
            d20 Disadvantage
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Mod</span>
          <button
            onClick={() => setMod((m) => m - 1)}
            className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
          >
            −
          </button>
          <input
            type="number"
            value={mod}
            onChange={(e) => setMod(parseInt(e.target.value || '0', 10))}
            className="w-14 bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-center text-xs font-mono"
          />
          <button
            onClick={() => setMod((m) => m + 1)}
            className="w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
          >
            +
          </button>
          {mod !== 0 && (
            <button
              onClick={() => setMod(0)}
              className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
            >
              reset
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-slate-800 max-h-56 overflow-y-auto">
        {history.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-slate-600 italic text-center">
            No rolls yet.
          </div>
        ) : (
          history.map((r: Roll) => (
            <div
              key={r.id}
              className="group px-3 py-1.5 border-b border-slate-900 flex items-baseline justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400 truncate">{r.label}</div>
                <div className="text-[10px] text-slate-600 font-mono truncate">
                  {r.detail}
                </div>
              </div>
              {campaignId && (
                <button
                  onClick={() =>
                    void sendRoll(campaignId, {
                      kind: 'roll',
                      label: r.label,
                      detail: r.detail,
                      total: r.total,
                      die: r.die,
                      crit: r.crit,
                    })
                  }
                  title="Share this roll in chat"
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-sky-300 shrink-0 transition-opacity"
                >
                  <Send size={11} />
                </button>
              )}
              <div
                className={`font-serif text-xl shrink-0 ${
                  r.crit === 'hit'
                    ? 'text-emerald-300'
                    : r.crit === 'miss'
                      ? 'text-rose-400'
                      : 'text-sky-200'
                }`}
              >
                {r.total}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function QuickDiceButton({ compact = false }: { compact?: boolean }) {
  const toggle = useQuickDice((s) => s.toggle);
  const open = useQuickDice((s) => s.open);
  if (compact) {
    return (
      <button
        onClick={toggle}
        title="Quick dice"
        className={`p-1.5 rounded ${
          open
            ? 'bg-sky-900/50 text-sky-200'
            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
        }`}
      >
        <Dices size={14} />
      </button>
    );
  }
  return (
    <button
      onClick={toggle}
      className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
        open
          ? 'bg-sky-900/50 text-sky-200'
          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
      }`}
    >
      <Dices size={12} /> Dice
    </button>
  );
}
