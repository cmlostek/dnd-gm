import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import type { HomebrewItem, HomebrewSpell, StatBlock } from '../../store';
import PageHeader from '../../components/PageHeader';
import { Plus, Trash2, Search, ExternalLink, X, Pencil, Save, Share2, Eye, EyeOff } from 'lucide-react';
import IconPicker from '../../components/IconPicker';
import { iconByKey, iconForCategory } from '../../data/itemIcons';
import { useSession } from '../session/sessionStore';
import { useSharedHomebrew } from './sharedHomebrewStore';
import type { SharedHomebrew } from './sharedHomebrewStore';

type Tab = 'monsters' | 'items' | 'spells';

export default function Homebrew() {
  const [tab, setTab] = useState<Tab>('monsters');
  const [campaign, setCampaign] = useState<string>('all');
  const [query, setQuery] = useState('');

  const statBlocks = useStore((s) => s.statBlocks);
  const homebrewItems = useStore((s) => s.homebrewItems);
  const homebrewSpells = useStore((s) => s.homebrewSpells);

  const campaignId = useSession((s) => s.campaignId);
  const loadShared = useSharedHomebrew((s) => s.loadForCampaign);
  const subscribeShared = useSharedHomebrew((s) => s.subscribe);
  const sharedItems = useSharedHomebrew((s) => s.items);
  const sharedSpells = useSharedHomebrew((s) => s.spells);

  useEffect(() => {
    if (!campaignId) return;
    loadShared(campaignId);
    const unsub = subscribeShared(campaignId);
    return unsub;
  }, [campaignId, loadShared, subscribeShared]);

  const campaigns = useMemo(() => {
    const set = new Set<string>();
    for (const sb of statBlocks) if (sb.campaign) set.add(sb.campaign);
    for (const i of homebrewItems) if (i.campaign) set.add(i.campaign);
    for (const s of homebrewSpells) if (s.campaign) set.add(s.campaign);
    return Array.from(set).sort();
  }, [statBlocks, homebrewItems, homebrewSpells]);

  const counts = {
    monsters: statBlocks.length,
    items: homebrewItems.length,
    spells: homebrewSpells.length,
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Homebrew">
        <div className="flex rounded-lg overflow-hidden border border-slate-800">
          {(['monsters', 'items', 'spells'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs capitalize ${
                tab === t
                  ? 'bg-sky-900/40 text-sky-200'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {t} ({counts[t]})
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab}`}
            className="w-full bg-slate-900 border border-slate-800 rounded pl-7 pr-2 py-1.5 text-sm"
          />
        </div>
        <select
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs"
        >
          <option value="all">All campaigns</option>
          <option value="__none__">Uncategorized</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'monsters' && (
          <MonstersPane statBlocks={statBlocks} campaign={campaign} query={query} />
        )}
        {tab === 'items' && (
          <ItemsPane
            items={homebrewItems}
            campaign={campaign}
            query={query}
            campaigns={campaigns}
            shared={sharedItems}
            campaignId={campaignId}
          />
        )}
        {tab === 'spells' && (
          <SpellsPane
            spells={homebrewSpells}
            campaign={campaign}
            query={query}
            campaigns={campaigns}
            shared={sharedSpells}
            campaignId={campaignId}
          />
        )}
      </div>
    </div>
  );
}

function MonstersPane({
  statBlocks,
  campaign,
  query,
}: {
  statBlocks: StatBlock[];
  campaign: string;
  query: string;
}) {
  const navigate = useNavigate();
  const updateStatBlock = useStore((s) => s.updateStatBlock);
  const deleteStatBlock = useStore((s) => s.deleteStatBlock);
  const setActiveStatBlock = useStore((s) => s.setActiveStatBlock);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);
  const [campaignValue, setCampaignValue] = useState('');

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return statBlocks.filter((sb) => {
      if (campaign !== 'all') {
        const c = sb.campaign ?? '';
        if (campaign === '__none__' ? c !== '' : c !== campaign) return false;
      }
      if (!q) return true;
      return sb.name.toLowerCase().includes(q) || sb.type.toLowerCase().includes(q);
    });
  }, [statBlocks, campaign, query]);

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      {filtered.length === 0 ? (
        <div className="text-sm text-slate-500 italic">
          No homebrew monsters. Create one from the Stat Blocks tab.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((sb) => (
            <div
              key={sb.id}
              className="border border-slate-800 rounded-lg p-3 bg-slate-900/40 hover:border-sky-800 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-serif text-lg text-sky-200 truncate">{sb.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {sb.size} {sb.type} · CR {sb.cr} · {sb.edition}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setActiveStatBlock(sb.id);
                      navigate('/statblocks');
                    }}
                    title="Edit"
                    className="p-1 text-slate-400 hover:text-sky-300"
                  >
                    <ExternalLink size={13} />
                  </button>
                  {confirmingId === sb.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          deleteStatBlock(sb.id);
                          setConfirmingId(null);
                        }}
                        className="px-1.5 py-0.5 text-[10px] bg-rose-700 hover:bg-rose-600 text-white rounded"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="px-1.5 py-0.5 text-[10px] bg-slate-700 hover:bg-slate-600 rounded"
                      >
                        X
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(sb.id)}
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="text-slate-500">Campaign:</span>
                {editingCampaign === sb.id ? (
                  <>
                    <input
                      autoFocus
                      value={campaignValue}
                      onChange={(e) => setCampaignValue(e.target.value)}
                      onBlur={() => {
                        updateStatBlock(sb.id, { campaign: campaignValue.trim() || undefined });
                        setEditingCampaign(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateStatBlock(sb.id, { campaign: campaignValue.trim() || undefined });
                          setEditingCampaign(null);
                        }
                        if (e.key === 'Escape') setEditingCampaign(null);
                      }}
                      placeholder="Campaign name"
                      className="flex-1 bg-slate-800 border border-sky-700 rounded px-1.5 py-0.5 text-[11px] outline-none"
                    />
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setEditingCampaign(sb.id);
                      setCampaignValue(sb.campaign ?? '');
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    {sb.campaign || <span className="italic text-slate-500">uncategorized</span>}
                    <Pencil size={9} className="text-slate-500" />
                  </button>
                )}
              </div>

              <div className="mt-2 grid grid-cols-6 gap-1 text-center">
                {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => (
                  <div key={k} className="text-[10px]">
                    <div className="text-slate-500 uppercase">{k}</div>
                    <div className="text-slate-200">{sb[k]}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemsPane({
  items,
  campaign,
  query,
  campaigns,
  shared,
  campaignId,
}: {
  items: HomebrewItem[];
  campaign: string;
  query: string;
  campaigns: string[];
  shared: SharedHomebrew[];
  campaignId: string | null;
}) {
  const addHomebrewItem = useStore((s) => s.addHomebrewItem);
  const updateHomebrewItem = useStore((s) => s.updateHomebrewItem);
  const removeHomebrewItem = useStore((s) => s.removeHomebrewItem);
  const shareItem = useSharedHomebrew((s) => s.shareItem);
  const unshareBySource = useSharedHomebrew((s) => s.unshareBySource);
  const setVisible = useSharedHomebrew((s) => s.setVisible);
  const [editing, setEditing] = useState<HomebrewItem | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const sharedBySource = useMemo(() => {
    const map = new Map<string, SharedHomebrew>();
    for (const s of shared) if (s.source_id) map.set(s.source_id, s);
    return map;
  }, [shared]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return items.filter((i) => {
      if (campaign !== 'all') {
        const c = i.campaign ?? '';
        if (campaign === '__none__' ? c !== '' : c !== campaign) return false;
      }
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
    });
  }, [items, campaign, query]);

  const openNew = () =>
    setEditing({
      id: '',
      campaign: '',
      name: '',
      category: 'Wondrous item',
      rarity: 'Common',
      priceGp: undefined,
      weight: undefined,
      properties: '',
      desc: '',
      updatedAt: 0,
    });

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-xs text-slate-500">{filtered.length} items</div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs bg-sky-700 hover:bg-sky-600 text-slate-50 font-semibold rounded flex items-center gap-1"
          >
            <Plus size={13} /> New Item
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="text-sm text-slate-500 italic">No homebrew items.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((i) => (
              <div
                key={i.id}
                className="border border-slate-800 rounded-lg p-3 bg-slate-900/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-lg text-sky-200 flex items-center gap-2">
                      {(() => {
                        const Icon = iconByKey(i.icon) ?? iconForCategory(i.category);
                        return <Icon size={16} className="shrink-0 text-slate-400" />;
                      })()}
                      <span className="truncate">{i.name || 'Unnamed'}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {i.category}
                      {i.rarity ? ` · ${i.rarity}` : ''}
                      {i.priceGp !== undefined ? ` · ${i.priceGp} gp` : ''}
                      {i.weight !== undefined ? ` · ${i.weight} lb` : ''}
                      {i.campaign ? ` · ${i.campaign}` : ''}
                    </div>
                    {i.desc && (
                      <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{i.desc}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <ShareControls
                      sharedRow={sharedBySource.get(i.id)}
                      onShare={() => {
                        if (!campaignId) return;
                        const { id: _id, updatedAt: _u, ...snapshot } = i;
                        shareItem(campaignId, i.id, i.name || 'Unnamed', snapshot as unknown as Record<string, unknown>);
                      }}
                      onUnshare={() => unshareBySource(i.id)}
                      onToggleVisible={(row) => setVisible(row.id, !row.visible_to_players)}
                    />
                    <button
                      onClick={() => setEditing(i)}
                      className="p-1 text-slate-400 hover:text-sky-300"
                    >
                      <Pencil size={13} />
                    </button>
                    {confirmingId === i.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            removeHomebrewItem(i.id);
                            unshareBySource(i.id);
                            setConfirmingId(null);
                          }}
                          className="px-1.5 py-0.5 text-[10px] bg-rose-700 hover:bg-rose-600 text-white rounded"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          className="px-1.5 py-0.5 text-[10px] bg-slate-700 rounded"
                        >
                          X
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingId(i.id)}
                        className="p-1 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <ItemEditor
          initial={editing}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            if (editing.id) {
              updateHomebrewItem(editing.id, data);
              if (campaignId && sharedBySource.has(editing.id)) {
                shareItem(campaignId, editing.id, data.name || 'Unnamed', data as unknown as Record<string, unknown>);
              }
            } else {
              addHomebrewItem(data);
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ItemEditor({
  initial,
  campaigns,
  onClose,
  onSave,
}: {
  initial: HomebrewItem;
  campaigns: string[];
  onClose: () => void;
  onSave: (data: Omit<HomebrewItem, 'id' | 'updatedAt'>) => void;
}) {
  const [form, setForm] = useState(initial);

  const set = <K extends keyof HomebrewItem>(k: K, v: HomebrewItem[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <aside className="w-96 border-l border-slate-800 bg-slate-900/60 overflow-y-auto flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
        <div className="font-serif text-lg text-sky-200">
          {initial.id ? 'Edit Item' : 'New Item'}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
          <X size={16} />
        </button>
      </div>
      <div className="p-4 space-y-3 flex-1">
        <Field label="Name">
          <div className="flex items-center gap-2">
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
            <IconPicker
              value={form.icon}
              onChange={(key) => set('icon', key)}
              fallback={iconForCategory(form.category)}
              title="Item icon (shown in lists & inventory)"
            />
          </div>
        </Field>
        <CampaignField
          value={form.campaign}
          campaigns={campaigns}
          onChange={(v) => set('campaign', v)}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            <input
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Rarity">
            <select
              value={form.rarity ?? 'Common'}
              onChange={(e) => set('rarity', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            >
              {['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Price (gp)">
            <input
              type="number"
              value={form.priceGp ?? ''}
              onChange={(e) =>
                set('priceGp', e.target.value === '' ? undefined : parseFloat(e.target.value))
              }
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Weight (lb)">
            <input
              type="number"
              value={form.weight ?? ''}
              onChange={(e) =>
                set('weight', e.target.value === '' ? undefined : parseFloat(e.target.value))
              }
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
        </div>
        <Field label="Properties">
          <input
            value={form.properties ?? ''}
            onChange={(e) => set('properties', e.target.value)}
            placeholder="Finesse, versatile (1d8), ..."
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={form.desc}
            onChange={(e) => set('desc', e.target.value)}
            rows={8}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono"
          />
        </Field>
      </div>
      <div className="px-4 py-3 border-t border-slate-800 sticky bottom-0 bg-slate-900">
        <button
          onClick={() => {
            const { id: _id, updatedAt: _u, ...rest } = form;
            onSave(rest);
          }}
          className="w-full px-3 py-2 bg-sky-700 hover:bg-sky-600 text-slate-50 font-semibold rounded flex items-center justify-center gap-2"
        >
          <Save size={14} /> Save
        </button>
      </div>
    </aside>
  );
}

function SpellsPane({
  spells,
  campaign,
  query,
  campaigns,
  shared,
  campaignId,
}: {
  spells: HomebrewSpell[];
  campaign: string;
  query: string;
  campaigns: string[];
  shared: SharedHomebrew[];
  campaignId: string | null;
}) {
  const addHomebrewSpell = useStore((s) => s.addHomebrewSpell);
  const updateHomebrewSpell = useStore((s) => s.updateHomebrewSpell);
  const removeHomebrewSpell = useStore((s) => s.removeHomebrewSpell);
  const shareSpell = useSharedHomebrew((s) => s.shareSpell);
  const unshareBySource = useSharedHomebrew((s) => s.unshareBySource);
  const setVisible = useSharedHomebrew((s) => s.setVisible);
  const [editing, setEditing] = useState<HomebrewSpell | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const sharedBySource = useMemo(() => {
    const map = new Map<string, SharedHomebrew>();
    for (const s of shared) if (s.source_id) map.set(s.source_id, s);
    return map;
  }, [shared]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return spells.filter((sp) => {
      if (campaign !== 'all') {
        const c = sp.campaign ?? '';
        if (campaign === '__none__' ? c !== '' : c !== campaign) return false;
      }
      if (!q) return true;
      return sp.name.toLowerCase().includes(q) || sp.desc.toLowerCase().includes(q);
    });
  }, [spells, campaign, query]);

  const openNew = () =>
    setEditing({
      id: '',
      campaign: '',
      name: '',
      level: 0,
      school: 'Evocation',
      castingTime: '1 action',
      range: '60 feet',
      components: 'V, S',
      duration: 'Instantaneous',
      ritual: false,
      concentration: false,
      classes: '',
      desc: '',
      higherLevel: '',
      updatedAt: 0,
    });

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-xs text-slate-500">{filtered.length} spells</div>
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs bg-sky-700 hover:bg-sky-600 text-slate-50 font-semibold rounded flex items-center gap-1"
          >
            <Plus size={13} /> New Spell
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="text-sm text-slate-500 italic">No homebrew spells.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((sp) => (
              <div
                key={sp.id}
                className="border border-slate-800 rounded-lg p-3 bg-slate-900/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-lg text-sky-200">{sp.name || 'Unnamed'}</div>
                    <div className="text-[11px] text-slate-500">
                      {sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`} · {sp.school}
                      {sp.ritual && ' · ritual'}
                      {sp.concentration && ' · concentration'}
                      {sp.campaign ? ` · ${sp.campaign}` : ''}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {sp.castingTime} · {sp.range} · {sp.components} · {sp.duration}
                    </div>
                    {sp.desc && (
                      <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{sp.desc}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <ShareControls
                      sharedRow={sharedBySource.get(sp.id)}
                      onShare={() => {
                        if (!campaignId) return;
                        const { id: _id, updatedAt: _u, ...snapshot } = sp;
                        shareSpell(campaignId, sp.id, sp.name || 'Unnamed', snapshot as unknown as Record<string, unknown>);
                      }}
                      onUnshare={() => unshareBySource(sp.id)}
                      onToggleVisible={(row) => setVisible(row.id, !row.visible_to_players)}
                    />
                    <button
                      onClick={() => setEditing(sp)}
                      className="p-1 text-slate-400 hover:text-sky-300"
                    >
                      <Pencil size={13} />
                    </button>
                    {confirmingId === sp.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            removeHomebrewSpell(sp.id);
                            unshareBySource(sp.id);
                            setConfirmingId(null);
                          }}
                          className="px-1.5 py-0.5 text-[10px] bg-rose-700 hover:bg-rose-600 text-white rounded"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          className="px-1.5 py-0.5 text-[10px] bg-slate-700 rounded"
                        >
                          X
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingId(sp.id)}
                        className="p-1 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <SpellEditor
          initial={editing}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            if (editing.id) {
              updateHomebrewSpell(editing.id, data);
              if (campaignId && sharedBySource.has(editing.id)) {
                shareSpell(campaignId, editing.id, data.name || 'Unnamed', data as unknown as Record<string, unknown>);
              }
            } else {
              addHomebrewSpell(data);
            }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SpellEditor({
  initial,
  campaigns,
  onClose,
  onSave,
}: {
  initial: HomebrewSpell;
  campaigns: string[];
  onClose: () => void;
  onSave: (data: Omit<HomebrewSpell, 'id' | 'updatedAt'>) => void;
}) {
  const [form, setForm] = useState(initial);

  const set = <K extends keyof HomebrewSpell>(k: K, v: HomebrewSpell[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <aside className="w-96 border-l border-slate-800 bg-slate-900/60 overflow-y-auto flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
        <div className="font-serif text-lg text-sky-200">
          {initial.id ? 'Edit Spell' : 'New Spell'}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
          <X size={16} />
        </button>
      </div>
      <div className="p-4 space-y-3 flex-1">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
          />
        </Field>
        <CampaignField
          value={form.campaign}
          campaigns={campaigns}
          onChange={(v) => set('campaign', v)}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Level">
            <select
              value={form.level}
              onChange={(e) => set('level', parseInt(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
                <option key={l} value={l}>
                  {l === 0 ? 'Cantrip' : l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="School">
            <select
              value={form.school}
              onChange={(e) => set('school', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            >
              {[
                'Abjuration',
                'Conjuration',
                'Divination',
                'Enchantment',
                'Evocation',
                'Illusion',
                'Necromancy',
                'Transmutation',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Casting Time">
            <input
              value={form.castingTime}
              onChange={(e) => set('castingTime', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Range">
            <input
              value={form.range}
              onChange={(e) => set('range', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Components">
            <input
              value={form.components}
              onChange={(e) => set('components', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Duration">
            <input
              value={form.duration}
              onChange={(e) => set('duration', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
            />
          </Field>
        </div>
        <div className="flex gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.ritual}
              onChange={(e) => set('ritual', e.target.checked)}
            />
            Ritual
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.concentration}
              onChange={(e) => set('concentration', e.target.checked)}
            />
            Concentration
          </label>
        </div>
        <Field label="Classes">
          <input
            value={form.classes}
            onChange={(e) => set('classes', e.target.value)}
            placeholder="Wizard, Sorcerer"
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={form.desc}
            onChange={(e) => set('desc', e.target.value)}
            rows={8}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono"
          />
        </Field>
        <Field label="At Higher Levels">
          <textarea
            value={form.higherLevel ?? ''}
            onChange={(e) => set('higherLevel', e.target.value)}
            rows={3}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono"
          />
        </Field>
      </div>
      <div className="px-4 py-3 border-t border-slate-800 sticky bottom-0 bg-slate-900">
        <button
          onClick={() => {
            const { id: _id, updatedAt: _u, ...rest } = form;
            onSave(rest);
          }}
          className="w-full px-3 py-2 bg-sky-700 hover:bg-sky-600 text-slate-50 font-semibold rounded flex items-center justify-center gap-2"
        >
          <Save size={14} /> Save
        </button>
      </div>
    </aside>
  );
}

function CampaignField({
  value,
  campaigns,
  onChange,
}: {
  value: string;
  campaigns: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label="Campaign">
      <input
        list="campaign-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Uncategorized"
        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm"
      />
      <datalist id="campaign-options">
        {campaigns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function ShareControls({
  sharedRow,
  onShare,
  onUnshare,
  onToggleVisible,
}: {
  sharedRow: SharedHomebrew | undefined;
  onShare: () => void;
  onUnshare: () => void;
  onToggleVisible: (row: SharedHomebrew) => void;
}) {
  if (!sharedRow) {
    return (
      <button
        onClick={onShare}
        title="Share with players"
        className="p-1 text-slate-400 hover:text-emerald-300"
      >
        <Share2 size={13} />
      </button>
    );
  }
  return (
    <div className="flex gap-1">
      <button
        onClick={() => onToggleVisible(sharedRow)}
        title={sharedRow.visible_to_players ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)'}
        className={`p-1 ${sharedRow.visible_to_players ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}
      >
        {sharedRow.visible_to_players ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <button
        onClick={onUnshare}
        title="Unshare"
        className="p-1 text-emerald-400 hover:text-rose-400"
      >
        <Share2 size={13} />
      </button>
    </div>
  );
}
