import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotebookPen, X, Trash2, FileUp, Check } from 'lucide-react';
import { useScratchpad, readScratchPos, writeScratchPos } from './scratchpadStore';
import { useSession } from '../session/sessionStore';
import { useNotes } from '../notes/notesStore';

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Floating quick-note pad. Draggable and position-persistent, matching the
 * quick dice panel so the two feel like the same class of tool.
 *
 * Text saves to localStorage on every keystroke — there's no save button and
 * no way to lose it by closing the pad. "Save as note" promotes the contents
 * into a real campaign note when a scribble turns out to be worth keeping.
 */
export default function Scratchpad() {
  const open = useScratchpad((s) => s.open);
  const close = useScratchpad((s) => s.close);
  const text = useScratchpad((s) => s.text);
  const setText = useScratchpad((s) => s.setText);
  const clearPad = useScratchpad((s) => s.clear);
  const useCampaign = useScratchpad((s) => s.useCampaign);

  const campaignId = useSession((s) => s.campaignId);
  const createNote = useNotes((s) => s.createNote);
  const updateNote = useNotes((s) => s.updateNote);
  const navigate = useNavigate();

  const panelRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => readScratchPos());
  const posRef = useRef(pos);
  posRef.current = pos;
  const [confirmClear, setConfirmClear] = useState(false);
  const [promoted, setPromoted] = useState(false);

  // Swap contents when the active campaign changes.
  useEffect(() => { useCampaign(campaignId); }, [campaignId, useCampaign]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => taRef.current?.focus());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Reset the two-step affordances whenever the pad is reopened.
  useEffect(() => {
    if (!open) { setConfirmClear(false); setPromoted(false); }
  }, [open]);

  if (!open) return null;

  const beginDrag = (e: React.MouseEvent) => {
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
      writeScratchPos(posRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** Promote the pad into a real note, then jump to it. */
  const saveAsNote = async () => {
    const body = text.trim();
    if (!body || !campaignId) return;
    const id = await createNote(campaignId, null);
    if (!id) return;
    // First line becomes the title; the rest stays as the body.
    const [first, ...rest] = body.split('\n');
    await updateNote(id, {
      title: first.slice(0, 80) || 'Quick note',
      body: rest.join('\n').trim() || body,
    });
    setPromoted(true);
    navigate('/notes');
  };

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, width: 320 }
    : { right: 16, bottom: 16, width: 320 };

  return (
    <div
      ref={panelRef}
      style={style}
      className="fixed z-40 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
    >
      <div
        onMouseDown={beginDrag}
        className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 cursor-move select-none"
      >
        <NotebookPen size={13} className="text-slate-400 shrink-0" />
        <span className="text-xs uppercase tracking-wider text-slate-400 flex-1">Scratchpad</span>
        <button
          onClick={() => {
            if (!confirmClear) { setConfirmClear(true); return; }
            clearPad();
            setConfirmClear(false);
          }}
          title={confirmClear ? 'Click again to clear' : 'Clear'}
          className={`p-1 rounded ${confirmClear ? 'text-rose-300 bg-rose-950/50' : 'text-slate-600 hover:text-rose-300'}`}
        >
          <Trash2 size={12} />
        </button>
        <button onClick={close} title="Close" className="p-1 text-slate-500 hover:text-slate-200">
          <X size={13} />
        </button>
      </div>

      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => { setText(e.target.value); setPromoted(false); }}
        placeholder="Jot anything — saved automatically, only visible to you."
        spellCheck={false}
        className="h-56 resize-y bg-transparent px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600 font-mono leading-relaxed"
      />

      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
        <span className="text-[10px] text-slate-600 flex-1">
          {text.trim() ? `${text.trim().split(/\s+/).length} words · local only` : 'Local only'}
        </span>
        <button
          onClick={saveAsNote}
          disabled={!text.trim() || !campaignId}
          title="Create a campaign note from this text"
          className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 flex items-center gap-1"
        >
          {promoted ? <><Check size={11} /> Saved</> : <><FileUp size={11} /> Save as note</>}
        </button>
      </div>
    </div>
  );
}
