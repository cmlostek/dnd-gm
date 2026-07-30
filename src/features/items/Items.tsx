import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import EditionToggle from '../../components/EditionToggle';
import {
  EQUIPMENT,
  MAGIC_ITEMS,
  EQUIPMENT_CATEGORIES,
  MAGIC_ITEM_RARITIES,
  formatCost,
  equipmentFor,
  magicItemsFor,
  describeEquipment,
} from '../../data/srd';
import { Search, X, FlaskConical, Swords, Shield, Sparkles, Backpack, Pencil, Check } from 'lucide-react';
import { iconByKey, iconForCategory } from '../../data/itemIcons';
import { Link, useLocation } from 'react-router-dom';
import type { EquipmentItem, MagicItem } from '../../data/types';
import { useStore } from '../../store';
import type { HomebrewItem } from '../../store';
import { useIsGM } from '../session/sessionStore';
import { useSession } from '../session/sessionStore';
import { useSharedHomebrew } from '../homebrew/sharedHomebrewStore';
import { useCampaignSettings } from '../notes/campaignSettingsStore';

type Tab = 'gear' | 'magic' | 'custom';

export default function Items() {
  const [tab, setTab] = useState<Tab>('gear');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | 'all'>('all');
  const [rarity, setRarity] = useState<string | 'all'>('all');
  const [selected, setSelected] = useState<EquipmentItem | MagicItem | HomebrewItem | null>(null);
  const localHomebrewItems = useStore((s) => s.homebrewItems);
  const role = useSession((s) => s.role);
  const campaignId = useSession((s) => s.campaignId);
  const sharedItems = useSharedHomebrew((s) => s.items);
  const loadShared = useSharedHomebrew((s) => s.loadForCampaign);
  const subscribeShared = useSharedHomebrew((s) => s.subscribe);
  const edition = useCampaignSettings((s) => s.settings.srdEdition);
  const location = useLocation();

  const gearPool = useMemo(() => equipmentFor(edition), [edition]);
  const magicPool = useMemo(() => magicItemsFor(edition), [edition]);

  useEffect(() => {
    if (!campaignId) return;
    loadShared(campaignId);
    const unsub = subscribeShared(campaignId);
    return unsub;
  }, [campaignId, loadShared, subscribeShared]);

  const homebrewItems = useMemo<HomebrewItem[]>(() => {
    if (role === 'gm' || role === 'cogm') return localHomebrewItems;
    return sharedItems.map((r) => {
      const d = r.data as Record<string, unknown>;
      const now = Date.now();
      return {
        id: `shared-${r.id}`,
        campaign: (d.campaign as string) ?? '',
        name: r.name,
        category: (d.category as string) ?? 'Wondrous item',
        rarity: d.rarity as string | undefined,
        priceGp: d.priceGp as number | undefined,
        weight: d.weight as number | undefined,
        properties: d.properties as string | undefined,
        desc: (d.desc as string) ?? '',
        icon: d.icon as string | undefined,
        updatedAt: now,
      };
    });
  }, [role, localHomebrewItems, sharedItems]);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    if (hash.startsWith('custom-')) {
      const id = hash.slice('custom-'.length);
      const hit = homebrewItems.find((i) => i.id === id || i.id === `shared-${id}`);
      if (hit) {
        setTab('custom');
        setSelected(hit);
      }
      return;
    }
    // Prefer the current edition's entry; fall back to the union so chat
    // chips and wiki links work even when the current filter would hide
    // the target.
    const magic = magicPool.find((m) => m.index === hash) ?? MAGIC_ITEMS.find((m) => m.index === hash);
    if (magic) {
      setTab('magic');
      setSelected(magic);
      return;
    }
    const gear = gearPool.find((e) => e.index === hash) ?? EQUIPMENT.find((e) => e.index === hash);
    if (gear) {
      setTab('gear');
      setSelected(gear);
    }
  }, [location.hash, homebrewItems, magicPool, gearPool]);

  const filteredGear = useMemo(() => {
    const q = query.toLowerCase().trim();
    return gearPool.filter((e) => {
      if (category !== 'all' && e.equipment_category.name !== category) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q);
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [gearPool, query, category]);

  const filteredMagic = useMemo(() => {
    const q = query.toLowerCase().trim();
    return magicPool.filter((m) => {
      if (rarity !== 'all' && m.rarity.name !== rarity) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.desc.join(' ').toLowerCase().includes(q);
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [magicPool, query, rarity]);

  const filteredCustom = useMemo(() => {
    const q = query.toLowerCase().trim();
    return homebrewItems
      .filter((i) => {
        if (rarity !== 'all' && i.rarity !== rarity) return false;
        if (!q) return true;
        return i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query, rarity, homebrewItems]);

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Items">
        <div className="flex rounded-lg overflow-hidden border border-slate-800">
          <button
            onClick={() => {
              setTab('gear');
              setSelected(null);
            }}
            className={`px-3 py-1.5 text-xs ${tab === 'gear' ? 'bg-sky-900/40 text-sky-200' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
          >
            Gear ({gearPool.length})
          </button>
          <button
            onClick={() => {
              setTab('magic');
              setSelected(null);
            }}
            className={`px-3 py-1.5 text-xs ${tab === 'magic' ? 'bg-sky-900/40 text-sky-200' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
          >
            Magic ({magicPool.length})
          </button>
          <button
            onClick={() => {
              setTab('custom');
              setSelected(null);
            }}
            className={`px-3 py-1.5 text-xs ${tab === 'custom' ? 'bg-sky-900/40 text-sky-200' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
          >
            Custom ({homebrewItems.length})
          </button>
        </div>
        <EditionToggle />
      </PageHeader>

      <div className="flex-1 min-h-0 flex">
        <aside className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-80 border-r border-slate-800 flex-col`}>
          <div className="p-3 space-y-2 border-b border-slate-800">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === 'gear' ? 'Search gear' : 'Search magic items'}
                className="w-full bg-slate-900 border border-slate-800 rounded pl-7 pr-2 py-1.5 text-sm"
              />
            </div>
            {tab === 'gear' ? (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs"
              >
                <option value="all">All categories</option>
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs"
              >
                <option value="all">All rarities</option>
                {MAGIC_ITEM_RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            {tab === 'custom' && (role === 'gm' || role === 'cogm') && (
              <Link
                to="/homebrew"
                className="block text-center px-2 py-1 text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300"
              >
                <FlaskConical size={11} className="inline mr-1" />
                Manage homebrew
              </Link>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === 'gear' &&
              filteredGear.map((e) => (
                <button
                  key={e.index}
                  onClick={() => setSelected(e)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-900 ${
                    (selected as EquipmentItem | null)?.index === e.index ? 'bg-slate-800' : 'hover:bg-slate-900'
                  }`}
                >
                  <div className="flex justify-between gap-2 items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      {(() => {
                        const { Icon, color } = gearKind(e);
                        return <Icon size={14} style={{ color }} className="shrink-0" />;
                      })()}
                      <div className="text-sm font-medium truncate">{e.name}</div>
                    </div>
                    <div className="text-xs text-slate-500 shrink-0 font-mono">{formatCost(e.cost)}</div>
                  </div>
                  <div className="text-[11px] text-slate-500 pl-6">
                    {e.equipment_category.name}
                    {e.weapon_category ? ` · ${e.weapon_category}` : ''}
                    {e.armor_category ? ` · ${e.armor_category}` : ''}
                  </div>
                </button>
              ))}
            {tab === 'magic' &&
              filteredMagic.map((m) => (
                <button
                  key={m.index}
                  onClick={() => setSelected(m)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-900 ${
                    (selected as MagicItem | null)?.index === m.index ? 'bg-slate-800' : 'hover:bg-slate-900'
                  }`}
                >
                  <div className="flex justify-between gap-2 items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles size={14} className="shrink-0" style={{ color: '#c4b5fd' }} />
                      <div className="text-sm font-medium truncate">{m.name}</div>
                    </div>
                    <div className={`text-[10px] shrink-0 ${rarityColor(m.rarity.name)}`}>
                      {m.rarity.name}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 pl-6">{m.equipment_category.name}</div>
                </button>
              ))}
            {tab === 'custom' &&
              filteredCustom.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-900 ${
                    (selected as HomebrewItem | null)?.id === c.id ? 'bg-slate-800' : 'hover:bg-slate-900'
                  }`}
                >
                  <div className="flex justify-between gap-2 items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      {(() => {
                        const Icon = iconByKey(c.icon) ?? iconForCategory(c.category);
                        return <Icon size={14} className="shrink-0 text-slate-400" />;
                      })()}
                      <div className="text-sm font-medium truncate">{c.name || 'Unnamed'}</div>
                    </div>
                    {c.rarity && (
                      <div className={`text-[10px] shrink-0 ${rarityColor(c.rarity)}`}>{c.rarity}</div>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 pl-6">
                    {c.category}
                    {c.campaign ? ` · ${c.campaign}` : ''}
                  </div>
                </button>
              ))}
            {((tab === 'gear' && filteredGear.length === 0) ||
              (tab === 'magic' && filteredMagic.length === 0) ||
              (tab === 'custom' && filteredCustom.length === 0)) && (
              <div className="p-4 text-xs text-slate-600 italic">
                {tab === 'custom' ? (
                  (role === 'gm' || role === 'cogm') ? (
                    <>
                      No custom items.{' '}
                      <Link to="/homebrew" className="text-sky-400 hover:underline">
                        Create one →
                      </Link>
                    </>
                  ) : (
                    <>No custom items shared yet.</>
                  )
                ) : (
                  'No matches.'
                )}
              </div>
            )}
          </div>
        </aside>

        <section className={`${selected ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0 overflow-y-auto`}>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="md:hidden flex items-center gap-1 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 border-b border-slate-800"
            >
              ← Back to list
            </button>
          )}
          {!selected ? (
            <div className="h-full flex items-center justify-center text-slate-500">Select an item.</div>
          ) : isHomebrew(selected) ? (
            <CustomDetail item={selected} onClose={() => setSelected(null)} canEdit={role === 'gm' || role === 'cogm'} />
          ) : 'rarity' in selected ? (
            <MagicDetail item={selected} onClose={() => setSelected(null)} />
          ) : (
            <GearDetail item={selected} onClose={() => setSelected(null)} />
          )}
        </section>
      </div>
    </div>
  );
}

/** Icon + tint for a gear row, derived from its structured stats so weapons,
 *  armor, and plain gear read apart at a glance. */
function gearKind(e: EquipmentItem): { Icon: typeof Swords; color: string } {
  if (e.damage || e.weapon_category) return { Icon: Swords, color: '#f87171' };
  if (e.armor_class || e.armor_category) return { Icon: Shield, color: '#60a5fa' };
  return { Icon: Backpack, color: '#94a3b8' };
}

function rarityColor(r: string) {
  switch (r) {
    case 'Common':
      return 'text-slate-300';
    case 'Uncommon':
      return 'text-emerald-400';
    case 'Rare':
      return 'text-sky-400';
    case 'Very Rare':
      return 'text-violet-400';
    case 'Legendary':
      return 'text-yellow-400';
    case 'Artifact':
      return 'text-rose-400';
    default:
      return 'text-slate-400';
  }
}

function GearDetail({ item, onClose }: { item: EquipmentItem; onClose: () => void }) {
  return (
    <div className="max-w-2xl px-8 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-serif text-3xl text-sky-200">{item.name}</h2>
          <div className="text-sm italic text-slate-400">{item.equipment_category.name}</div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1">
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <Field label="Cost" value={formatCost(item.cost)} />
        {item.weight !== undefined && <Field label="Weight" value={`${item.weight} lb`} />}
        {item.weapon_category && <Field label="Weapon" value={`${item.weapon_category} ${item.weapon_range ?? ''}`} />}
        {item.damage && (
          <Field
            label="Damage"
            value={`${item.damage.damage_dice} ${item.damage.damage_type.name.toLowerCase()}`}
          />
        )}
        {item.two_handed_damage && (
          <Field
            label="Two-handed"
            value={`${item.two_handed_damage.damage_dice} ${item.two_handed_damage.damage_type.name.toLowerCase()}`}
          />
        )}
        {item.range && (item.range.normal || item.range.long) && (
          <Field label="Range" value={`${item.range.normal ?? '-'}${item.range.long ? `/${item.range.long}` : ''} ft`} />
        )}
        {item.armor_class && (
          <Field
            label="AC"
            value={`${item.armor_class.base}${item.armor_class.dex_bonus ? ' + Dex' : ''}${
              item.armor_class.max_bonus ? ` (max +${item.armor_class.max_bonus})` : ''
            }`}
          />
        )}
        {item.str_minimum !== undefined && item.str_minimum > 0 && (
          <Field label="Str Min" value={`${item.str_minimum}`} />
        )}
        {item.stealth_disadvantage && <Field label="Stealth" value="Disadvantage" />}
      </div>

      {item.properties && item.properties.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1">
          {item.properties.map((p) => (
            <span key={p.name} className="px-2 py-0.5 text-xs bg-slate-800 rounded">
              {p.name}
            </span>
          ))}
        </div>
      )}

      <EditableDesc index={item.index} paragraphs={describeEquipment(item)} />
    </div>
  );
}

function MagicDetail({ item, onClose }: { item: MagicItem; onClose: () => void }) {
  return (
    <div className="max-w-2xl px-8 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-serif text-3xl text-sky-200">{item.name}</h2>
          <div className={`text-sm italic ${rarityColor(item.rarity.name)}`}>
            {item.equipment_category.name} · {item.rarity.name}
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1">
          <X size={18} />
        </button>
      </div>
      <EditableDesc index={item.index} paragraphs={item.desc} />
    </div>
  );
}

/** Description block for an SRD item. Renders the GM's override when present,
 *  otherwise the supplied paragraphs (real SRD prose, or the stat-derived
 *  fallback for gear that ships without any). GMs get an inline editor to
 *  fill in or replace the text; clearing it reverts to the default. */
function EditableDesc({ index, paragraphs }: { index: string; paragraphs: string[] }) {
  const isGM = useIsGM();
  const override = useStore((s) => s.itemDescOverrides[index]);
  const setOverride = useStore((s) => s.setItemDescOverride);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const shown = override ?? paragraphs.join('\n\n');
  const isFallback = !override;

  if (editing) {
    return (
      <div className="mt-6">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          autoFocus
          className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 leading-relaxed"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => {
              setOverride(index, draft);
              setEditing(false);
            }}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-sky-700 hover:bg-sky-600 text-slate-50 rounded"
          >
            <Check size={12} /> Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
          >
            Cancel
          </button>
          {override && (
            <button
              onClick={() => {
                setOverride(index, '');
                setEditing(false);
              }}
              className="ml-auto px-3 py-1 text-xs text-rose-400 hover:text-rose-300"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 group">
      <div className="space-y-3 text-slate-200 leading-relaxed">
        {shown.split(/\n\n+/).map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">{p}</p>
        ))}
      </div>
      {isGM && (
        <button
          onClick={() => {
            setDraft(shown);
            setEditing(true);
          }}
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-300"
        >
          <Pencil size={11} />
          {isFallback ? 'Edit description' : 'Edit description (customized)'}
        </button>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-500 text-xs uppercase tracking-wider">{label}: </span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function isHomebrew(x: EquipmentItem | MagicItem | HomebrewItem): x is HomebrewItem {
  return (x as HomebrewItem).updatedAt !== undefined;
}

function CustomDetail({ item, onClose, canEdit }: { item: HomebrewItem; onClose: () => void; canEdit: boolean }) {
  return (
    <div className="max-w-2xl px-8 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-serif text-3xl text-sky-200 flex items-center gap-2.5">
            {(() => {
              const Icon = iconByKey(item.icon) ?? iconForCategory(item.category);
              return <Icon size={26} className="shrink-0 text-slate-400" />;
            })()}
            <span>{item.name || 'Unnamed'}</span>
          </h2>
          <div className={`text-sm italic ${item.rarity ? rarityColor(item.rarity) : 'text-slate-400'}`}>
            {item.category}
            {item.rarity ? ` · ${item.rarity}` : ''}
            {item.campaign ? ` · ${item.campaign}` : ''}
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1">
          <X size={18} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {item.priceGp !== undefined && <Field label="Price" value={`${item.priceGp} gp`} />}
        {item.weight !== undefined && <Field label="Weight" value={`${item.weight} lb`} />}
      </div>
      {item.properties && (
        <div className="mt-4 text-sm text-slate-300">
          <span className="text-slate-500 text-xs uppercase tracking-wider mr-2">Properties:</span>
          {item.properties}
        </div>
      )}
      {item.desc && (
        <div className="mt-6 text-slate-200 leading-relaxed whitespace-pre-wrap">{item.desc}</div>
      )}
      {canEdit && (
        <div className="mt-6 pt-4 border-t border-slate-800 text-xs">
          <Link to="/homebrew" className="text-sky-400 hover:underline">
            Edit in Homebrew →
          </Link>
        </div>
      )}
    </div>
  );
}
