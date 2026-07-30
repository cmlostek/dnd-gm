import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Shuffle, RotateCcw, Plus, Trash2, Heart, Shield, Swords, Activity, X, Lock, Users, Sparkles, Hourglass, MapPin, User } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { QuickDiceButton } from '../dice/QuickDice';
import { useSession } from '../session/sessionStore';
import { useInitiativeStore, CONDITIONS, type Condition } from './initiativeStore';
import { useRitualStore, type RitualMode } from './ritualStore';
import type { PartyMember } from '../party/partyStore';
import { SPELLS, spellsFor } from '../../data/srd';
import { useSharedHomebrew } from '../homebrew/sharedHomebrewStore';
import { hpPercent } from '../hpBar';
import { useCampaignSettings } from '../notes/campaignSettingsStore';
import { useParty } from '../party/partyStore';
import { useNpcStore } from '../npcs/npcStore';
import { useStore } from '../../store';

const abilityMod = (score: number) => Math.floor((score - 10) / 2);
const d20 = () => 1 + Math.floor(Math.random() * 20);

export default function Initiative() {
  const campaignId = useSession((s) => s.campaignId);
  const userId = useSession((s) => s.userId);
  const role = useSession((s) => s.role);
  const viewAsPlayer = useSession((s) => s.viewAsPlayer);
  const isGM = (role === 'gm' || role === 'cogm') && !viewAsPlayer;
  // Initiative is a regular (non-GM-only) page, so player visibility follows
  // the same hiddenPages toggle the sidebar and Settings use — visible unless
  // the GM has explicitly hidden it. (It previously gated on allowedGmPages,
  // which only ever holds gmOnly slugs, so players were always blocked.)
  const hiddenPages = useCampaignSettings((s) => s.settings.hiddenPages ?? []);
  const playerCanView = isGM || !hiddenPages.includes('initiative');

  const {
    combatants, round, turnIndex, loaded,
    loadForCampaign, subscribe, clear,
    add, update, remove, next, reset, sort,
    addCondition, removeCondition,
  } = useInitiativeStore();

  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    const unsub = subscribe(campaignId);
    return () => { unsub(); clear(); };
  }, [campaignId]);

  const [name, setName]   = useState('');
  const [init, setInit]   = useState('');
  const [hp, setHp]       = useState('');
  const [ac, setAc]       = useState('');
  const [isPC, setIsPC]   = useState(false);

  // Condition picker state
  const [pickerFor, setPickerFor]     = useState<string | null>(null);
  const [pickerRounds, setPickerRounds] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerFor(null);
        setPickerRounds('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const active = combatants[turnIndex] ?? null;

  const submit = () => {
    if (!name.trim() || !campaignId) return;
    const hpNum = parseInt(hp || '0', 10) || 0;
    add({ name: name.trim(), initiative: parseInt(init || '0', 10) || 0, hp: hpNum, maxHp: hpNum, ac: parseInt(ac || '10', 10) || 10, isPC });
    setName(''); setInit(''); setHp(''); setAc('');
  };

  // ── Add-from-roster picker ─────────────────────────────────────────────
  // Pulls players, NPCs, and homebrew StatBlocks so the GM doesn't have to
  // re-type a creature that already exists somewhere in the campaign. Each
  // pick auto-rolls 1d20 + DEX (or the PC's initiativeBonus) and stamps it
  // into the tracker.
  const party = useParty((s) => s.party);
  const loadParty = useParty((s) => s.loadForCampaign);
  const subscribeParty = useParty((s) => s.subscribe);
  const npcs = useNpcStore((s) => s.npcs);
  const loadNpcs = useNpcStore((s) => s.loadForCampaign);
  const subscribeNpcs = useNpcStore((s) => s.subscribe);
  const statBlocks = useStore((s) => s.statBlocks);

  useEffect(() => {
    if (!campaignId) return;
    loadParty(campaignId);
    const unsub1 = subscribeParty(campaignId);
    loadNpcs(campaignId);
    const unsub2 = subscribeNpcs(campaignId);
    return () => { unsub1(); unsub2(); };
  }, [campaignId, loadParty, subscribeParty, loadNpcs, subscribeNpcs]);

  type RosterRow = {
    key: string;
    label: string;
    sub: string;
    onPick: () => void;
  };
  const roster: RosterRow[] = useMemo(() => {
    const rows: RosterRow[] = [];
    for (const p of party) {
      rows.push({
        key: `pc:${p.id}`,
        label: p.name,
        sub: `PC · init ${p.initiativeBonus >= 0 ? '+' : ''}${p.initiativeBonus}`,
        onPick: () =>
          add({
            name: p.name,
            initiative: d20() + (p.initiativeBonus ?? 0),
            hp: p.hp ?? 0,
            maxHp: p.maxHp ?? 0,
            ac: p.ac ?? 10,
            isPC: true,
          }),
      });
    }
    for (const n of npcs) {
      const dex = n.statBlock?.dex ?? 10;
      rows.push({
        key: `npc:${n.id}`,
        label: n.name,
        sub: `NPC · DEX ${dex}`,
        onPick: () =>
          add({
            name: n.name,
            initiative: d20() + abilityMod(dex),
            hp: n.statBlock?.hpCurrent ?? n.statBlock?.hpMax ?? 0,
            maxHp: n.statBlock?.hpMax ?? n.statBlock?.hpCurrent ?? 0,
            ac: n.statBlock?.ac ?? 10,
            isPC: false,
          }),
      });
    }
    for (const s of statBlocks) {
      if (s.campaign && campaignId && s.campaign !== campaignId) continue;
      rows.push({
        key: `sb:${s.id}`,
        label: s.name,
        sub: `Creature · DEX ${s.dex}`,
        onPick: () =>
          add({
            name: s.name,
            initiative: d20() + abilityMod(s.dex),
            hp: s.hp,
            maxHp: s.hp,
            ac: s.ac,
            isPC: false,
          }),
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [party, npcs, statBlocks, campaignId, add]);

  // Auto-sort every 30s — keeps the order in sync if someone edits an
  // initiative score and forgets to hit Re-roll. GM only: players are
  // read-only, and a player's sort() would fail RLS while locally reordering
  // their view out of step with everyone else.
  useEffect(() => {
    if (!isGM || combatants.length === 0) return;
    const id = setInterval(() => sort(), 30_000);
    return () => clearInterval(id);
  }, [isGM, combatants.length, sort]);

  // Sort once when the page opens so the tracker always presents in initiative
  // order. GM only (sort writes order + is RLS-gated); runs a single time per
  // mount, after the combatants have loaded.
  const didAutoSort = useRef(false);
  useEffect(() => {
    if (!isGM || !loaded || combatants.length === 0 || didAutoSort.current) return;
    didAutoSort.current = true;
    sort();
  }, [isGM, loaded, combatants.length, sort]);

  const [rosterOpen, setRosterOpen] = useState(false);

  const adjustHp = (id: string, delta: number) => {
    const c = combatants.find((x) => x.id === id);
    if (!c) return;
    update(id, { hp: Math.max(0, Math.min(c.maxHp, c.hp + delta)) });
  };

  const handleAddCondition = async (combatantId: string, condName: string) => {
    const rounds = pickerRounds.trim() ? (parseInt(pickerRounds, 10) || null) : null;
    await addCondition(combatantId, { name: condName, rounds });
    setPickerFor(null);
    setPickerRounds('');
  };

  if (!playerCanView) {
    return (
      <div className="h-full flex flex-col">
        <PageHeader title="Initiative" />
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-slate-600">
          <Lock size={32} />
          <p className="text-sm">The GM hasn't shared the initiative tracker yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Initiative">
        <QuickDiceButton compact />
        <div className="text-sm text-slate-400 font-mono mr-4">Round {round}</div>
        {isGM && (
          <>
            <button onClick={sort} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1">
              <Shuffle size={14} /> Sort
            </button>
            <button onClick={() => reset()} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1">
              <RotateCcw size={14} /> Reset
            </button>
          </>
        )}
        <button
          onClick={next}
          disabled={combatants.length === 0 || !isGM}
          className="ac-btn px-4 py-1.5 text-xs font-semibold rounded flex items-center gap-1 disabled:bg-slate-800 disabled:text-slate-600"
        >
          Next <ChevronRight size={14} />
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 overflow-y-auto">
        <div className="lg:col-span-2 space-y-2">
          {!loaded && <div className="text-sm text-slate-600 italic">Loading…</div>}
          {loaded && combatants.length === 0 && (
            <div className="text-sm text-slate-600 italic">No combatants yet.{isGM ? ' Add one on the right.' : ''}</div>
          )}

          {combatants.map((c, i) => {
            const isActive = i === turnIndex;
            const dead     = c.hp <= 0 && c.maxHp > 0;
            const hpPct    = hpPercent(c.hp, c.maxHp);

            // Players get a full read-only view — initiative, name, conditions,
            // and AC — but never any health (no bar, no numbers, no Down tag,
            // which would leak HP) and no editing controls.
            if (!isGM) {
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border p-3 transition-all ${
                    isActive
                      ? 'border-[color:var(--ac-700)] shadow-lg'
                      : 'bg-slate-900 border-slate-800'
                  }`}
                  style={isActive ? { background: 'color-mix(in srgb, var(--ac-900) 30%, var(--surface-elev))' } : undefined}
                >
                  <div className="flex items-start gap-3">
                    {/* Initiative badge */}
                    <div className={`w-12 h-12 rounded shrink-0 flex flex-col items-center justify-center font-mono ${
                      c.isPC ? 'bg-emerald-900/60 text-emerald-200' : 'bg-rose-900/60 text-rose-200'
                    }`}>
                      <div className="text-[9px] uppercase tracking-wider opacity-70">Init</div>
                      <div className="text-lg leading-none">{c.initiative}</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Name row */}
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-lg text-slate-100 truncate">{c.name}</span>
                        {c.isPC && <span className="text-[10px] uppercase tracking-wider text-emerald-400/80">PC</span>}
                        {isActive && (
                          <span className="ml-auto text-[10px] uppercase tracking-wider" style={{ color: 'var(--ac-400)' }}>
                            Acting
                          </span>
                        )}
                      </div>

                      {/* Conditions row */}
                      {c.conditions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {c.conditions.map((cond) => {
                            const color = CONDITIONS.find((x) => x.name === cond.name)?.color ?? '#64748b';
                            return (
                              <span
                                key={cond.name}
                                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: color + '22', color, border: `1px solid ${color}55` }}
                                title={cond.rounds !== null ? `${cond.rounds} round(s) remaining` : 'Indefinite'}
                              >
                                {cond.name}
                                {cond.rounds !== null && <span className="opacity-70"> ({cond.rounds})</span>}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* AC row — no health for players */}
                      <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                        <Shield size={12} /> AC <span className="font-mono">{c.ac}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={c.id}
                className={`rounded-lg border p-3 transition-all relative ${
                  isActive
                    ? 'border-[color:var(--ac-700)] shadow-lg'
                    : dead
                      ? 'bg-slate-900/40 border-slate-800 opacity-60'
                      : 'bg-slate-900 border-slate-800'
                }`}
                style={isActive ? { background: 'color-mix(in srgb, var(--ac-900) 30%, var(--surface-elev))' } : undefined}
              >
                <div className="flex items-start gap-3">
                  {/* Initiative badge */}
                  <div className={`w-12 h-12 rounded shrink-0 flex flex-col items-center justify-center font-mono ${
                    c.isPC ? 'bg-emerald-900/60 text-emerald-200' : 'bg-rose-900/60 text-rose-200'
                  }`}>
                    <div className="text-[9px] uppercase tracking-wider opacity-70">Init</div>
                    {isGM ? (
                      <input
                        type="number"
                        value={c.initiative}
                        onChange={(e) => update(c.id, { initiative: parseInt(e.target.value || '0', 10) || 0 })}
                        className="w-10 bg-transparent text-lg leading-none text-center outline-none focus:bg-black/25 rounded"
                        title="Initiative — edit directly"
                      />
                    ) : (
                      <div className="text-lg leading-none">{c.initiative}</div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Name row */}
                    <div className="flex items-center gap-2">
                      {isGM ? (
                        <input
                          value={c.name}
                          onChange={(e) => update(c.id, { name: e.target.value })}
                          className="bg-transparent font-serif text-lg text-slate-100 outline-none focus:bg-slate-800/50 rounded px-1 -mx-1 min-w-0"
                        />
                      ) : (
                        <span className="font-serif text-lg text-slate-100">{c.name}</span>
                      )}
                      {c.isPC && <span className="text-[10px] uppercase tracking-wider text-emerald-400/80">PC</span>}
                      {dead   && <span className="text-[10px] uppercase tracking-wider text-rose-400/80">Down</span>}
                    </div>

                    {/* Conditions row */}
                    {c.conditions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {c.conditions.map((cond) => {
                          const color = CONDITIONS.find((x) => x.name === cond.name)?.color ?? '#64748b';
                          return (
                            <button
                              key={cond.name}
                              onClick={() => isGM && removeCondition(c.id, cond.name)}
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1"
                              style={{ background: color + '22', color, border: `1px solid ${color}55` }}
                              title={
                                cond.rounds !== null
                                  ? `${cond.rounds} round(s) remaining${isGM ? ' — click to remove' : ''}`
                                  : `Indefinite${isGM ? ' — click to remove' : ''}`
                              }
                            >
                              {cond.name}
                              {cond.rounds !== null && <span className="opacity-70">({cond.rounds})</span>}
                              {isGM && <X size={8} className="opacity-50" />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* AC + roll initiative row */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <label className="flex items-center gap-1">
                        <Shield size={12} /> AC
                        {isGM ? (
                          <input
                            type="number"
                            value={c.ac}
                            onChange={(e) => update(c.id, { ac: parseInt(e.target.value || '0', 10) || 0 })}
                            className="w-12 bg-slate-800 rounded px-1 font-mono"
                          />
                        ) : (
                          <span className="font-mono">{c.ac}</span>
                        )}
                      </label>
                      {isGM && (
                        <button
                          onClick={() => update(c.id, { initiative: Math.floor(Math.random() * 20) + 1 })}
                          className="flex items-center gap-1 hover:text-slate-200"
                          style={{ color: 'var(--ac-400)' }}
                        >
                          <Swords size={12} /> Roll init
                        </button>
                      )}
                    </div>

                    {/* HP row */}
                    <div className="mt-2 flex items-center gap-2">
                      <Heart size={12} className="text-rose-400 shrink-0" />
                      <div className="flex items-center gap-1 font-mono text-sm">
                        {isGM ? (
                          <>
                            <input
                              type="number"
                              value={c.hp}
                              onChange={(e) => update(c.id, { hp: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
                              className="w-14 bg-slate-800 rounded px-1 text-right"
                            />
                            <span className="text-slate-500">/</span>
                            <input
                              type="number"
                              value={c.maxHp}
                              onChange={(e) => update(c.id, { maxHp: parseInt(e.target.value || '0', 10) || 0 })}
                              className="w-14 bg-slate-800 rounded px-1"
                            />
                          </>
                        ) : (
                          <span>{c.hp}<span className="text-slate-500">/{c.maxHp}</span></span>
                        )}
                      </div>
                      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${hpPct > 50 ? 'bg-emerald-600' : hpPct > 25 ? 'bg-amber-500' : 'bg-rose-600'}`}
                          style={{ width: `${hpPct}%` }}
                        />
                      </div>
                      {isGM && (
                        <div className="flex gap-1 shrink-0">
                          {[-5, -1, +1, +5].map((d) => (
                            <button
                              key={d}
                              onClick={() => adjustHp(c.id, d)}
                              className={`w-7 h-6 text-xs rounded ${d < 0 ? 'bg-slate-800 hover:bg-rose-900' : 'bg-slate-800 hover:bg-emerald-900'}`}
                            >
                              {d > 0 ? `+${d}` : d}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  {isGM && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => remove(c.id)}
                        className="text-slate-600 hover:text-rose-400 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => { setPickerFor(pickerFor === c.id ? null : c.id); setPickerRounds(''); }}
                        className="text-slate-600 hover:text-slate-300 p-1"
                        title="Add condition"
                      >
                        <Activity size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Condition picker dropdown */}
                {isGM && pickerFor === c.id && (
                  <div
                    ref={pickerRef}
                    className="absolute right-10 top-0 z-20 bg-slate-900 border border-slate-700 rounded-lg p-3 w-72 shadow-2xl"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Add condition</div>
                    <div className="grid grid-cols-3 gap-1 mb-3">
                      {CONDITIONS.map((cond) => {
                        const already = c.conditions.some((x) => x.name === cond.name);
                        return (
                          <button
                            key={cond.name}
                            disabled={already}
                            onClick={() => handleAddCondition(c.id, cond.name)}
                            className="text-[10px] px-1 py-1.5 rounded text-center transition-opacity disabled:opacity-30"
                            style={{ background: cond.color + '22', color: cond.color, border: `1px solid ${cond.color}44` }}
                          >
                            {cond.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">Rounds (blank = ∞):</span>
                      <input
                        type="number"
                        value={pickerRounds}
                        onChange={(e) => setPickerRounds(e.target.value)}
                        placeholder="∞"
                        min={1}
                        className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Active combatant panel */}
          {active && (
            <div
              className="border rounded-lg p-4 space-y-2"
              style={{
                background: 'color-mix(in srgb, var(--ac-900) 20%, var(--surface-elev))',
                borderColor: 'var(--ac-700)',
              }}
            >
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--ac-400)', opacity: 0.7 }}>
                Now acting
              </div>
              <div className="font-serif text-2xl" style={{ color: 'var(--ac-200)' }}>{active.name}</div>
              <div className="text-xs text-slate-400">
                Initiative {active.initiative} · AC {active.ac}
                {isGM && <> · HP {active.hp}/{active.maxHp}</>}
              </div>
              {active.conditions.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {active.conditions.map((cond) => {
                    const color = CONDITIONS.find((x) => x.name === cond.name)?.color ?? '#64748b';
                    return (
                      <span
                        key={cond.name}
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: color + '22', color, border: `1px solid ${color}55` }}
                      >
                        {cond.name}{cond.rounds !== null && ` (${cond.rounds})`}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Ritual countdowns — visible to players and GM. Links back to the
              map (caster's token) and the character sheet. */}
          <RitualsPanel isGM={isGM} userId={userId} party={party} />

          {/* Add-from-roster picker — sourced from party, NPCs, stat blocks */}
          {isGM && roster.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
              <button
                onClick={() => setRosterOpen((v) => !v)}
                className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200"
              >
                <span className="flex items-center gap-1.5">
                  <Users size={12} /> Add from roster <span className="text-slate-700">({roster.length})</span>
                </span>
                <ChevronRight size={12} className={`transition-transform ${rosterOpen ? 'rotate-90' : ''}`} />
              </button>
              {rosterOpen && (
                <div className="max-h-56 overflow-y-auto -mx-1 space-y-0.5">
                  {roster.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => r.onPick()}
                      className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 text-xs"
                    >
                      <span className="flex-1 truncate text-slate-200">{r.label}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{r.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add combatant form — GM only */}
          {isGM && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-slate-500">Add combatant</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Name"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
              />
              <div className="grid grid-cols-3 gap-2">
                <input value={init} onChange={(e) => setInit(e.target.value)} placeholder="Init" type="number"
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono" />
                <input value={hp} onChange={(e) => setHp(e.target.value)} placeholder="HP" type="number"
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono" />
                <input value={ac} onChange={(e) => setAc(e.target.value)} placeholder="AC" type="number"
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input type="checkbox" checked={isPC} onChange={(e) => setIsPC(e.target.checked)} />
                Player character
              </label>
              <button
                onClick={submit}
                className="ac-btn w-full px-3 py-2 font-semibold rounded flex items-center justify-center gap-1 text-sm"
              >
                <Plus size={14} /> Add
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ritual countdowns ────────────────────────────────────────────────────────
// A caster starts a ritual that becomes castable after N combat rounds or a
// wall-clock duration. The whole table sees it here; the countdown links back
// to the map (focuses the caster's token) and to the character sheet. Players
// can start rituals on characters they own; the GM can start one for anyone.

function ritualStatus(
  r: { mode: RitualMode; roundsRemaining: number | null; expiresAt: string | null },
  now: number,
): { ready: boolean; label: string } {
  if (r.mode === 'rounds') {
    const n = r.roundsRemaining ?? 0;
    return n <= 0
      ? { ready: true, label: 'Ready to cast' }
      : { ready: false, label: `${n} round${n === 1 ? '' : 's'} left` };
  }
  const ms = r.expiresAt ? new Date(r.expiresAt).getTime() - now : 0;
  if (ms <= 0) return { ready: true, label: 'Ready to cast' };
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return { ready: false, label: `${m}:${String(s).padStart(2, '0')} left` };
}

function RitualsPanel({
  isGM,
  userId,
  party,
}: {
  isGM: boolean;
  userId: string | null;
  party: PartyMember[];
}) {
  const navigate = useNavigate();
  const campaignId = useSession((s) => s.campaignId);
  const { rituals, loaded, loadForCampaign, subscribe, clear, add, remove } = useRitualStore();

  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    const unsub = subscribe(campaignId);
    return () => { unsub(); clear(); };
  }, [campaignId, loadForCampaign, subscribe, clear]);

  // Shared homebrew spells carry their own ritual flag; load them so homebrew
  // rituals also surface in the spell picker below.
  const sharedSpells = useSharedHomebrew((s) => s.spells);
  const loadShared = useSharedHomebrew((s) => s.loadForCampaign);
  const subscribeShared = useSharedHomebrew((s) => s.subscribe);
  useEffect(() => {
    if (!campaignId) return;
    loadShared(campaignId);
    return subscribeShared(campaignId);
  }, [campaignId, loadShared, subscribeShared]);

  // 1s ticker so minutes-mode countdowns update live. Rounds-mode rituals move
  // only when the GM hits Next, so they don't need the ticker.
  const hasMinutes = rituals.some((r) => r.mode === 'minutes');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasMinutes) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasMinutes]);

  // Characters this actor may start a ritual for: players are limited to the
  // characters they own; the GM can pick anyone.
  const castable = useMemo(
    () => (isGM ? party : party.filter((m) => m.owner_user_id === userId && userId !== null)),
    [party, isGM, userId],
  );

  const canManage = (r: { ownerUserId: string | null }) =>
    isGM || (!!r.ownerUserId && r.ownerUserId === userId);

  const goToMap = (r: { ownerUserId: string | null; casterName: string }) => {
    const params = new URLSearchParams();
    if (r.ownerUserId) params.set('focusOwner', r.ownerUserId);
    if (r.casterName) params.set('focusName', r.casterName);
    navigate(`/map?${params.toString()}`);
  };
  const goToSheet = (r: { partyMemberId: string | null }) =>
    navigate(r.partyMemberId ? `/party#member-${r.partyMemberId}` : '/party');

  // ── Start-ritual form state ───────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [spell, setSpell] = useState('');
  const [mode, setMode] = useState<RitualMode>('rounds');
  const [amount, setAmount] = useState('10');

  const selected = castable.find((m) => m.id === memberId) ?? null;

  // Only ritual-flagged spells belong in a ritual countdown. Resolve each of
  // the character's known spells against its source and keep the ones tagged as
  // rituals: SRD spells against the edition-aware catalog, homebrew spells
  // against the shared-homebrew store. Freeform 'custom' entries carry no
  // resolvable flag, so they're left out.
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const ritualByIndex = useMemo(() => {
    const idx = new Map<string, boolean>();
    for (const s of SPELLS) idx.set(s.index, s.ritual);
    for (const s of spellsFor(edition)) idx.set(s.index, s.ritual);
    return idx;
  }, [edition]);
  const homebrewRitualById = useMemo(() => {
    const idx = new Map<string, boolean>();
    for (const s of sharedSpells) idx.set(s.id, Boolean(s.data?.ritual));
    return idx;
  }, [sharedSpells]);
  const spellOptions = useMemo(
    () =>
      (selected?.spells ?? [])
        .filter((s) => {
          if (!s.sourceId) return false;
          if (s.sourceKind === 'srd-spell') return ritualByIndex.get(s.sourceId) === true;
          if (s.sourceKind === 'spell') return homebrewRitualById.get(s.sourceId) === true;
          return false;
        })
        .map((s) => s.name),
    [selected, ritualByIndex, homebrewRitualById],
  );

  const start = async () => {
    if (!selected || !spell.trim()) return;
    const n = Math.max(1, parseInt(amount || '1', 10) || 1);
    await add({
      ownerUserId: selected.owner_user_id,
      partyMemberId: selected.id,
      casterName: selected.name,
      spellName: spell.trim(),
      mode,
      rounds: mode === 'rounds' ? n : undefined,
      minutes: mode === 'minutes' ? n : undefined,
    });
    setSpell('');
    setAmount('10');
    setOpen(false);
  };

  // Nothing to show and nothing to start — keep the sidebar tidy.
  if (loaded && rituals.length === 0 && castable.length === 0) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400">
        <Sparkles size={12} /> Rituals
        {rituals.length > 0 && <span className="text-slate-700">({rituals.length})</span>}
      </div>

      {loaded && rituals.length === 0 && (
        <div className="text-[11px] text-slate-600 italic">No rituals in progress.</div>
      )}

      <div className="space-y-2">
        {rituals.map((r) => {
          const { ready, label } = ritualStatus(r, now);
          return (
            <div
              key={r.id}
              className="rounded-lg border p-2.5"
              style={
                ready
                  ? {
                      background: 'color-mix(in srgb, var(--ac-900) 30%, var(--surface-elev))',
                      borderColor: 'var(--ac-700)',
                    }
                  : { background: 'rgb(15 23 42)', borderColor: 'rgb(30 41 59)' }
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-serif text-sm text-slate-100 truncate">{r.spellName || 'Ritual'}</div>
                  <div className="text-[11px] text-slate-500 truncate">{r.casterName}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1 whitespace-nowrap"
                    style={
                      ready
                        ? { background: 'var(--ac-900)', color: 'var(--ac-200)', border: '1px solid var(--ac-700)' }
                        : { background: 'rgb(30 41 59)', color: 'rgb(148 163 184)' }
                    }
                  >
                    {r.mode === 'rounds' ? <Swords size={9} /> : <Hourglass size={9} />}
                    {label}
                  </span>
                  {canManage(r) && (
                    <button
                      onClick={() => remove(r.id)}
                      className="text-slate-600 hover:text-rose-400 p-0.5"
                      title="Dismiss ritual"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  onClick={() => goToMap(r)}
                  className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <MapPin size={10} /> Map
                </button>
                <button
                  onClick={() => goToSheet(r)}
                  className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <User size={10} /> Sheet
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Start a ritual — for characters the actor may control. */}
      {castable.length > 0 && (
        <div className="pt-1">
          {!open ? (
            <button
              onClick={() => { setOpen(true); if (!memberId && castable[0]) setMemberId(castable[0].id); }}
              className="w-full flex items-center justify-center gap-1 text-[11px] py-1.5 rounded border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
            >
              <Plus size={12} /> Start ritual
            </button>
          ) : (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <select
                value={memberId}
                onChange={(e) => { setMemberId(e.target.value); setSpell(''); }}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs"
              >
                <option value="" disabled>Choose caster…</option>
                {castable.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input
                value={spell}
                onChange={(e) => setSpell(e.target.value)}
                list="ritual-spell-options"
                placeholder="Spell name"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs"
              />
              <datalist id="ritual-spell-options">
                {spellOptions.map((s) => <option key={s} value={s} />)}
              </datalist>
              <div className="flex items-center gap-2">
                <div className="flex rounded overflow-hidden border border-slate-700 text-[11px]">
                  <button
                    onClick={() => setMode('rounds')}
                    className={`px-2 py-1 ${mode === 'rounds' ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-slate-400'}`}
                  >
                    Rounds
                  </button>
                  <button
                    onClick={() => setMode('minutes')}
                    className={`px-2 py-1 ${mode === 'minutes' ? 'bg-slate-700 text-slate-100' : 'bg-slate-800 text-slate-400'}`}
                  >
                    Minutes
                  </button>
                </div>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={start}
                  disabled={!memberId || !spell.trim()}
                  className="ac-btn flex-1 px-2 py-1.5 text-xs font-semibold rounded disabled:opacity-40"
                >
                  Start
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="px-2 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
