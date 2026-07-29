import {
  Sword,
  Swords,
  Axe,
  Hammer,
  Target,
  Crosshair,
  Bomb,
  Shield,
  ShieldHalf,
  Shirt,
  Footprints,
  HandMetal,
  Glasses,
  Wand2,
  Sparkles,
  Zap,
  Flame,
  Snowflake,
  Scroll,
  ScrollText,
  BookOpen,
  Wine,
  FlaskConical,
  FlaskRound,
  Pill,
  Droplet,
  Bandage,
  Gem,
  Diamond,
  Crown,
  Coins,
  Key,
  KeyRound,
  Backpack,
  Package,
  Gift,
  Lock,
  Lamp,
  Bell,
  Compass,
  Map as MapIcon,
  Ruler,
  Wrench,
  Pickaxe,
  Shovel,
  Anchor,
  Tent,
  Utensils,
  Drumstick,
  Apple,
  Beef,
  Feather,
  Leaf,
  TreePine,
  Bone,
  Skull,
  Ghost,
  Eye,
  Cross,
  Star,
  Heart,
  Music,
  Guitar,
  type LucideIcon,
} from 'lucide-react';

/** A pickable item icon. `key` is the stable slug persisted on homebrew items
 *  and inventory rows; `Icon` is the lucide component; `group` drives the
 *  picker's section headers. */
export type ItemIconDef = {
  key: string;
  label: string;
  Icon: LucideIcon;
  group: string;
};

/** Curated set of icons players can assign to items. Keys are stable — never
 *  rename one once shipped or saved items lose their icon. Add new entries at
 *  the end of their group. */
export const ITEM_ICONS: ItemIconDef[] = [
  // Weapons
  { key: 'sword', label: 'Sword', Icon: Sword, group: 'Weapons' },
  { key: 'swords', label: 'Dual blades', Icon: Swords, group: 'Weapons' },
  { key: 'axe', label: 'Axe', Icon: Axe, group: 'Weapons' },
  { key: 'hammer', label: 'Hammer / mace', Icon: Hammer, group: 'Weapons' },
  { key: 'bow', label: 'Bow / ranged', Icon: Target, group: 'Weapons' },
  { key: 'crosshair', label: 'Firearm / aim', Icon: Crosshair, group: 'Weapons' },
  { key: 'bomb', label: 'Bomb / explosive', Icon: Bomb, group: 'Weapons' },

  // Armor & worn
  { key: 'shield', label: 'Shield', Icon: Shield, group: 'Armor & worn' },
  { key: 'shield-half', label: 'Buckler', Icon: ShieldHalf, group: 'Armor & worn' },
  { key: 'armor', label: 'Armor / clothing', Icon: Shirt, group: 'Armor & worn' },
  { key: 'boots', label: 'Boots', Icon: Footprints, group: 'Armor & worn' },
  { key: 'gloves', label: 'Gloves / gauntlets', Icon: HandMetal, group: 'Armor & worn' },
  { key: 'goggles', label: 'Goggles / lenses', Icon: Glasses, group: 'Armor & worn' },
  { key: 'crown', label: 'Crown / circlet', Icon: Crown, group: 'Armor & worn' },

  // Magic
  { key: 'wand', label: 'Wand / staff', Icon: Wand2, group: 'Magic' },
  { key: 'sparkles', label: 'Wondrous', Icon: Sparkles, group: 'Magic' },
  { key: 'zap', label: 'Lightning', Icon: Zap, group: 'Magic' },
  { key: 'flame', label: 'Fire', Icon: Flame, group: 'Magic' },
  { key: 'frost', label: 'Frost', Icon: Snowflake, group: 'Magic' },
  { key: 'scroll', label: 'Scroll', Icon: Scroll, group: 'Magic' },
  { key: 'scroll-text', label: 'Written scroll', Icon: ScrollText, group: 'Magic' },
  { key: 'book', label: 'Book / tome', Icon: BookOpen, group: 'Magic' },

  // Consumables
  { key: 'potion', label: 'Potion', Icon: Wine, group: 'Consumables' },
  { key: 'flask', label: 'Flask / vial', Icon: FlaskConical, group: 'Consumables' },
  { key: 'flask-round', label: 'Round flask', Icon: FlaskRound, group: 'Consumables' },
  { key: 'pill', label: 'Pill / pellet', Icon: Pill, group: 'Consumables' },
  { key: 'droplet', label: 'Oil / liquid', Icon: Droplet, group: 'Consumables' },
  { key: 'bandage', label: 'Bandage / kit', Icon: Bandage, group: 'Consumables' },

  // Valuables
  { key: 'gem', label: 'Gem', Icon: Gem, group: 'Valuables' },
  { key: 'diamond', label: 'Diamond', Icon: Diamond, group: 'Valuables' },
  { key: 'coins', label: 'Coins', Icon: Coins, group: 'Valuables' },
  { key: 'ring', label: 'Ring / trinket', Icon: Star, group: 'Valuables' },
  { key: 'gift', label: 'Treasure', Icon: Gift, group: 'Valuables' },

  // Gear
  { key: 'backpack', label: 'Pack / container', Icon: Backpack, group: 'Gear' },
  { key: 'package', label: 'Box / crate', Icon: Package, group: 'Gear' },
  { key: 'key', label: 'Key', Icon: Key, group: 'Gear' },
  { key: 'key-round', label: 'Round key', Icon: KeyRound, group: 'Gear' },
  { key: 'lock', label: 'Lock', Icon: Lock, group: 'Gear' },
  { key: 'lamp', label: 'Lamp / torch', Icon: Lamp, group: 'Gear' },
  { key: 'bell', label: 'Bell', Icon: Bell, group: 'Gear' },
  { key: 'compass', label: 'Compass', Icon: Compass, group: 'Gear' },
  { key: 'map', label: 'Map', Icon: MapIcon, group: 'Gear' },
  { key: 'ruler', label: 'Rod / rope', Icon: Ruler, group: 'Gear' },
  { key: 'wrench', label: 'Tools', Icon: Wrench, group: 'Gear' },
  { key: 'pickaxe', label: 'Pickaxe', Icon: Pickaxe, group: 'Gear' },
  { key: 'shovel', label: 'Shovel', Icon: Shovel, group: 'Gear' },
  { key: 'anchor', label: 'Anchor / chain', Icon: Anchor, group: 'Gear' },
  { key: 'tent', label: 'Tent / camp', Icon: Tent, group: 'Gear' },

  // Provisions & nature
  { key: 'utensils', label: 'Rations / meal', Icon: Utensils, group: 'Provisions & nature' },
  { key: 'drumstick', label: 'Meat', Icon: Drumstick, group: 'Provisions & nature' },
  { key: 'apple', label: 'Fruit', Icon: Apple, group: 'Provisions & nature' },
  { key: 'beef', label: 'Ingredient', Icon: Beef, group: 'Provisions & nature' },
  { key: 'feather', label: 'Feather / quill', Icon: Feather, group: 'Provisions & nature' },
  { key: 'leaf', label: 'Herb / plant', Icon: Leaf, group: 'Provisions & nature' },
  { key: 'tree', label: 'Wood', Icon: TreePine, group: 'Provisions & nature' },
  { key: 'bone', label: 'Bone', Icon: Bone, group: 'Provisions & nature' },

  // Symbols
  { key: 'skull', label: 'Skull / poison', Icon: Skull, group: 'Symbols' },
  { key: 'ghost', label: 'Spirit', Icon: Ghost, group: 'Symbols' },
  { key: 'eye', label: 'Eye / scrying', Icon: Eye, group: 'Symbols' },
  { key: 'cross', label: 'Holy symbol', Icon: Cross, group: 'Symbols' },
  { key: 'heart', label: 'Heart / life', Icon: Heart, group: 'Symbols' },
  { key: 'music', label: 'Instrument', Icon: Music, group: 'Symbols' },
  { key: 'guitar', label: 'Stringed', Icon: Guitar, group: 'Symbols' },
];

const ICON_BY_KEY = new Map(ITEM_ICONS.map((d) => [d.key, d]));

/** Resolve a saved icon key to its lucide component, or null when the key is
 *  empty/unknown (so callers fall back to their default). */
export function iconByKey(key?: string | null): LucideIcon | null {
  if (!key) return null;
  return ICON_BY_KEY.get(key)?.Icon ?? null;
}

/** Best-guess icon for a free-text category string (homebrew items don't carry
 *  structured stats). Falls back to a generic package. */
export function iconForCategory(category?: string): LucideIcon {
  const c = (category ?? '').toLowerCase();
  if (/potion|elixir|oil|philter/.test(c)) return Wine;
  if (/scroll/.test(c)) return Scroll;
  if (/wand|staff|rod/.test(c)) return Wand2;
  if (/ring/.test(c)) return Star;
  if (/armor|shield/.test(c)) return Shield;
  if (/weapon|sword|blade/.test(c)) return Sword;
  if (/wondrous/.test(c)) return Sparkles;
  if (/ammunition|arrow|bolt/.test(c)) return Target;
  if (/food|ration|drink/.test(c)) return Utensils;
  if (/tool|kit|instrument/.test(c)) return Wrench;
  if (/gem|treasure|valuable/.test(c)) return Gem;
  return Package;
}

/** Icon keys grouped for the picker's section layout, preserving array order. */
export function iconGroups(): { group: string; icons: ItemIconDef[] }[] {
  const out: { group: string; icons: ItemIconDef[] }[] = [];
  for (const def of ITEM_ICONS) {
    let bucket = out.find((b) => b.group === def.group);
    if (!bucket) {
      bucket = { group: def.group, icons: [] };
      out.push(bucket);
    }
    bucket.icons.push(def);
  }
  return out;
}
