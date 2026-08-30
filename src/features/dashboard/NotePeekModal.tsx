import { useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Check, ExternalLink } from 'lucide-react';
import { useNotes, type Note } from '../notes/notesStore';
import { LiveEditor, type LiveEditorHandle } from '../notes/LiveEditor';
import { buildWikiIndex } from '../notes/wikiIndex';
import { useParty } from '../party/partyStore';
import { useNpcStore } from '../npcs/npcStore';
import { useQuickDice } from '../dice/quickDiceStore';
import { useSession } from '../session/sessionStore';
import { useStore } from '../../store';
import { supabase } from '../../lib/supabase';

/**
 * "Peek" editor opened from the Dashboard's Recent Notes carousel. For editors
 * it now embeds the same live-preview LiveEditor used on the Notes page —
 * markdown decorators, {{secrets}}, dice, wiki links and Yjs collaboration all
 * work here just as they do in the full editor. Saving persists the real Yjs
 * state (via the editor handle) alongside the plain-text body, so the two
 * editors stay perfectly consistent — this is why, unlike the old plain-text
 * quick-edit, we no longer null out ydoc_state on save.
 */
export default function NotePeekModal({
  note,
  canEdit,
  onClose,
}: {
  note: Note;
  canEdit: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const updateNote = useNotes((s) => s.updateNote);
  const setActiveNote = useNotes((s) => s.setActiveNote);

  // ── Editor dependencies (gathered here so the Dashboard call site is unchanged) ──
  const notes = useNotes((s) => s.notes);
  const party = useParty((s) => s.party);
  const npcs = useNpcStore((s) => s.npcs);
  const rollFormula = useQuickDice((s) => s.rollFormula);
  const homebrewItems = useStore((s) => s.homebrewItems);
  const homebrewSpells = useStore((s) => s.homebrewSpells);
  const userId = useSession((s) => s.userId);
  const displayName = useSession((s) => s.displayName);
  const campaignId = useSession((s) => s.campaignId);

  const wikiIndex = useMemo(
    () => buildWikiIndex(homebrewItems, homebrewSpells, notes),
    [homebrewItems, homebrewSpells, notes],
  );

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!campaignId) return null;
      if (!file.type.startsWith('image/')) return null;
      if (file.size > 10 * 1024 * 1024) return null; // 10 MB cap
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${campaignId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('note-images')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) { console.error('[notes] image upload failed', error); return null; }
      return supabase.storage.from('note-images').getPublicUrl(path).data.publicUrl;
    },
    [campaignId],
  );

  const editorRef = useRef<LiveEditorHandle>(null);

  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = title !== note.title || body !== note.body;

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const ydoc_state = editorRef.current?.getYdocState() ?? null;
      await updateNote(note.id, { title, body, ydoc_state });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  const openFull = () => {
    setActiveNote(note.id);
    navigate('/notes');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex sm:items-start sm:justify-center sm:overflow-y-auto sm:py-8 sm:px-4">
      <div className="w-full max-w-4xl bg-slate-900 sm:border border-slate-800 sm:rounded-lg shadow-2xl flex flex-col h-full sm:h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="text-sm uppercase tracking-wider text-slate-500">
            {canEdit ? 'Quick edit' : 'Note'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={openFull}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300"
            >
              Open full {canEdit ? 'editor' : 'note'} <ExternalLink size={11} />
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {canEdit ? (
          <div className="flex-1 flex flex-col min-h-0 p-5 gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full bg-transparent text-xl font-serif text-slate-100 outline-none border-b border-transparent focus:border-slate-700 pb-1 shrink-0"
            />
            <div className="flex-1 min-h-0 rounded border border-slate-800 overflow-hidden bg-slate-950">
              <LiveEditor
                key={note.id}
                ref={editorRef}
                body={body}
                onChange={setBody}
                wikiIndex={wikiIndex}
                onNavigate={(path) => navigate(path)}
                rollFormula={rollFormula}
                party={party}
                npcs={npcs}
                notes={notes}
                noteId={note.id}
                ydocState={note.ydoc_state ?? null}
                userId={userId ?? ''}
                userName={displayName ?? userId ?? 'Traveller'}
                uploadImage={uploadImage}
              />
            </div>
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500">
                Full editor experience — decorators, secrets, dice and live collaboration all work here.
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {justSaved && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                    <Check size={12} /> Saved
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="px-3 py-1.5 text-xs rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-sky-100"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <div className="text-xl font-serif text-slate-100">{note.title || 'Untitled'}</div>
            <div className="markdown-body text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {note.body || '*Empty note.*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
