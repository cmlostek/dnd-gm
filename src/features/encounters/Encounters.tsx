import { useEffect, useMemo, useState } from 'react';
import {
  Swords, Plus, Trash2, Search, Sparkles, Users, Lock, ChevronRight, Send, Wand2,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { useSession } from '../session/sessionStore';
import { useCampaignSettings, resolveEncounterEdition } from '../notes/campaignSettingsStore';
import { useParty } from '../party/partyStore';
import { useStore } from '../../store';
import { useInitiativeStore } from '../initiative/initiativeStore';
import { MONSTERS } from '../../data/srd';
import { useEncounters, type EncounterCreature } from './encounterStore';
import {
  rateEncounter, suggestEncounters, targetXpFor, creatureXp,
  type Suggestable,
} from './encounterMath';

const abilityMod = (score: number) => Math.floor((score - 10) / 2);
const d20 = () => 1 + Math.floor(Math.random() * 20);

/** Colour per difficulty band, shared by both editions' vocabularies. */
const BAND_COLOR: Record<string, string> = {
  trivial: '#64748b',
  easy: '#34d399', low: '#34d399',
  medium: '#fbbf24', moderate: '#fbbf24',
  hard: '#fb923c', high: '#fb923c',
  deadly: '#f43f5e',
};

const fmtCr = (cr: number | string) =>
  cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr);

export default function Encounters() {
  const campaignId = useSession((s) => s.campaignId);
  const role = useSession((s) => s.role);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const isGM = (role === 'gm' || role === 'cogm') && !viewAsPlayer;

  const settings = useCampaignSettings((s) => s.settings);
  const edition = resolveEncounterEdition(settings);

  const { encounters, loaded, loadForCampaign, subscribe, clear, create, rename, setCreatures, remove } =
    useEncounters();
  const party = useParty((s) => s.party);
  const loadParty = useParty((s) => s.loadForCampaign);
  const statBlocks = useStore((s) => s.statBlocks);
  const addCombatant = useInitiativeStore((s) => s.add);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [band, setBand] = useState<string>('');

  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    void loadParty(campaignId);
    const unsub = subscribe(campaignId);
    return () => { unsub(); clear(); };
  }, [campaignId, loadForCampaign, loadParty, subscribe, clear]);

  const active = encounters.find((e) => e.id === activeId) ?? encounters[0] ?? null;
  useEffect(() => {
    if (!activeId && encounters.length) setActiveId(encounters[0].id);
  }, [encounters, activeId]);

  // ── Creature pool: SRD monsters + campaign-scoped homebrew stat blocks ────
  const pool = useMemo<(Suggestable & { sourceKind: EncounterCreature['sourceKind'] })[]>(() => {
    const srd = MONSTERS.map((m) => ({
      id: m.index,
      sourceKind: 'srd-monster' as const,
      name: m.name,
      cr: fmtCr(m.challenge_rating),
      xp: m.xp ?? 0,
    }));
    const homebrew = statBlocks
      .filter((s) => !s.campaign || !campaignId || s.campaign === campaignId)
      .map((s) => ({
        id: s.id,
        sourceKind: 'statblock' as const,
        name: s.name,
        cr: s.cr || '—',
        xp: creatureXp({ xp: s.xp, cr: s.cr }),
      }));
    return [...homebrew, ...srd];
  }, [statBlocks, campaignId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pool.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [pool, query]);

  const rating = useMemo(
    () => rateEncounter(party, active?.creatures ?? [], edition),
    [party, active, edition],
  );

  const suggestions = useMemo(() => {
    if (!band) return [];
    const target = targetXpFor(party, edition, band);
    return suggestEncounters(pool, party, edition, target, 10);
  }, [band, party, pool, edition]);

  // ── Mutations on the active encounter ────────────────────────────────────
  const addCreature = (c: Suggestable & { sourceKind: EncounterCreature['sourceKind'] }, count = 1) => {
    if (!active) return;
    const existing = active.creatures.find((x) => x.sourceId === c.id && x.sourceKind === c.sourceKind);
    const next = existing
      ? active.creatures.map((x) =>
          x === existing ? { ...x, count: x.count + count } : x)
      : [...active.creatures, {
          sourceKind: c.sourceKind, sourceId: c.id, name: c.name,
          cr: c.cr, xp: c.xp, count,
        }];
    void setCreatures(active.id, next);
  };

  const setCount = (idx: number, count: number) => {
    if (!active) return;
    const next = count <= 0
      ? active.creatures.filter((_, i) => i !== idx)
      : active.creatures.map((c, i) => (i === idx ? { ...c, count } : c));
    void setCreatures(active.id, next);
  };

  /** Push every creature into the initiative tracker, rolling initiative per
   *  creature so duplicates don't share a turn. */
  const sendToInitiative = () => {
    if (!active) return;
    for (const c of active.creatures) {
      const sb = statBlocks.find((s) => s.id === c.sourceId);
      const monster = MONSTERS.find((m) => m.index === c.sourceId);
      const dex = sb?.dex ?? monster?.dexterity ?? 10;
      const hp = sb?.hp ?? monster?.hit_points ?? 0;
      const ac = sb?.ac ?? (typeof monster?.armor_class === 'number'
        ? monster.armor_class
        : monster?.armor_class?.[0]?.value ?? 10);
      for (let i = 0; i < c.count; i++) {
        addCombatant({
          name: c.count > 1 ? `${c.name} ${i + 1}` : c.name,
          initiative: d20() + abilityMod(dex),
          hp, maxHp: hp, ac,
          isPC: false,
        });
      }
    }
  };

  if (!isGM) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader title="Encounters" />
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-slate-600">
          <Lock size={32} />
          <p className="text-sm">Encounter prep is GM-only.</p>
        </div>
      </div>
    );
  }

  const bandColor = BAND_COLOR[rating.difficulty] ?? '#64748b';

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Encounters">
        <span className="text-[11px] text-slate-500 mr-2">
          {edition} rules · party of {party.length}
        </span>
        <button
          onClick={() => void create().then((id) => id && setActiveId(id))}
          className="ac-btn px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1"
        >
          <Plus size={14} /> New
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 overflow-y-auto">
        {/* ── Left: encounter list + roster ─────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
              Saved encounters
            </div>
            {!loaded && <div className="px-3 py-3 text-xs text-slate-600 italic">Loading…</div>}
            {loaded && encounters.length === 0 && (
              <div className="px-3 py-3 text-xs text-slate-600 italic">
                None yet — hit New to start one.
              </div>
            )}
            {encounters.map((e) => {
              const r = rateEncounter(party, e.creatures, edition);
              return (
                <button
                  key={e.id}
                  onClick={() => setActiveId(e.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-slate-900 last:border-b-0 ${
                    e.id === active?.id ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{e.name}</span>
                  <span
                    className="text-[10px] uppercase tracking-wider shrink-0"
                    style={{ color: BAND_COLOR[r.difficulty] ?? '#64748b' }}
                  >
                    {r.difficulty}
                  </span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Wand2 size={11} /> Suggest for
              </div>
              <div className="flex flex-wrap gap-1">
                {rating.bands.map((b) => (
                  <button
                    key={b.label}
                    onClick={() => setBand(band === b.label ? '' : b.label)}
                    className={`px-2 py-1 text-[11px] rounded border ${
                      band === b.label
                        ? 'border-slate-500 text-slate-100 bg-slate-800'
                        : 'border-slate-800 text-slate-400 hover:bg-slate-800/60'
                    }`}
                  >
                    {b.label}
                    <span className="ml-1 font-mono text-slate-600">{b.xp}</span>
                  </button>
                ))}
              </div>
              {band && suggestions.length === 0 && (
                <div className="text-[11px] text-slate-600 italic">
                  Nothing in the roster lands near that budget.
                </div>
              )}
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={`${s.creature.id}:${s.count}`}
                    onClick={() => addCreature(
                      s.creature as Suggestable & { sourceKind: EncounterCreature['sourceKind'] },
                      s.count,
                    )}
                    className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 text-xs"
                  >
                    <span className="font-mono text-slate-500 shrink-0">{s.count}×</span>
                    <span className="flex-1 truncate text-slate-200">{s.creature.name}</span>
                    <span className="text-[10px] font-mono text-slate-600 shrink-0">
                      {s.adjustedXp} xp
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Middle: the encounter itself ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {!active ? (
            <div className="text-sm text-slate-600 italic">
              Create an encounter to start adding creatures.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  value={active.name}
                  onChange={(e) => void rename(active.id, e.target.value)}
                  className="flex-1 bg-transparent font-serif text-2xl text-slate-100 outline-none focus:bg-slate-800/40 rounded px-1 -mx-1"
                />
                <button
                  onClick={sendToInitiative}
                  disabled={active.creatures.length === 0}
                  title="Add every creature to the initiative tracker"
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1 disabled:opacity-40"
                >
                  <Send size={13} /> To initiative
                </button>
                <button
                  onClick={() => { void remove(active.id); setActiveId(null); }}
                  className="p-1.5 text-slate-600 hover:text-rose-400"
                  title="Delete encounter"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Difficulty readout */}
              <div
                className="rounded-lg border p-4"
                style={{ borderColor: bandColor + '66', background: bandColor + '11' }}
              >
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <div>
                    <div
                      className="font-serif text-2xl capitalize"
                      style={{ color: bandColor }}
                    >
                      {rating.difficulty}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {rating.rawXp} xp
                      {rating.multiplier !== 1 && (
                        <> · ×{rating.multiplier} for {active.creatures.reduce((n, c) => n + c.count, 0)} creatures
                          {' '}= <span className="font-mono">{rating.adjustedXp}</span> adjusted</>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <div>Party earns <span className="font-mono text-slate-300">{rating.xpAward}</span> xp</div>
                    <div><span className="font-mono text-slate-400">{rating.xpPerCharacter}</span> each</div>
                  </div>
                </div>

                {/* Band ladder */}
                <div className="mt-3 flex gap-1">
                  {rating.bands.map((b) => {
                    const reached = rating.adjustedXp >= b.xp;
                    return (
                      <div key={b.label} className="flex-1">
                        <div
                          className="h-1.5 rounded-full"
                          style={{ background: reached ? BAND_COLOR[b.label.toLowerCase()] ?? '#475569' : '#1e293b' }}
                        />
                        <div className="text-[9px] uppercase tracking-wider text-slate-600 mt-1">
                          {b.label} <span className="font-mono">{b.xp}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {party.length === 0 && (
                  <div className="mt-2 text-[11px] text-amber-400">
                    No party members loaded — difficulty can't be rated.
                  </div>
                )}
              </div>

              {/* Creature lines */}
              <div className="space-y-1.5">
                {active.creatures.length === 0 && (
                  <div className="text-sm text-slate-600 italic">
                    No creatures yet. Search below, or use a suggestion.
                  </div>
                )}
                {active.creatures.map((c, i) => (
                  <div
                    key={`${c.sourceKind}:${c.sourceId}`}
                    className="bg-slate-900 border border-slate-800 rounded flex items-center gap-2 px-3 py-2"
                  >
                    <Swords size={13} className="text-rose-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{c.name}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">CR {c.cr}</span>
                    <span className="text-[10px] font-mono text-slate-600 shrink-0 w-16 text-right">
                      {c.xp * c.count} xp
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setCount(i, c.count - 1)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">−</button>
                      <span className="w-6 text-center font-mono text-sm">{c.count}</span>
                      <button onClick={() => setCount(i, c.count + 1)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">+</button>
                    </div>
                    <button onClick={() => setCount(i, 0)}
                      className="text-slate-600 hover:text-rose-400 shrink-0"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>

              {/* Creature search */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Search size={13} className="text-slate-500 shrink-0" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search monsters and homebrew stat blocks…"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                  />
                </div>
                {results.length > 0 && (
                  <div className="max-h-64 overflow-y-auto -mx-1 space-y-0.5">
                    {results.map((c) => (
                      <button
                        key={`${c.sourceKind}:${c.id}`}
                        onClick={() => addCreature(c)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 text-xs"
                      >
                        {c.sourceKind === 'statblock'
                          ? <Sparkles size={11} className="text-violet-300 shrink-0" />
                          : <Users size={11} className="text-slate-600 shrink-0" />}
                        <span className="flex-1 truncate text-slate-200">{c.name}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">CR {c.cr}</span>
                        <span className="text-[10px] font-mono text-slate-600 shrink-0 w-12 text-right">{c.xp}</span>
                        <ChevronRight size={11} className="text-slate-700 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
