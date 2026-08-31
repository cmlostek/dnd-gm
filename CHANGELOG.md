# Changelog

All notable changes to Grimoire are documented in this file. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
[SemVer](https://semver.org/).

## [Unreleased]

Work on the `preview` branch since 1.1.0. The headline is a full
fog-of-war / line-of-sight / lighting system with GM-authored walls and
interactive doorways, a much deeper map-editing toolkit, and multi-note
tabs.

### Added

#### Fog of war, vision & lighting

- **Manual fog of war** — the GM paints reveal/hide over a grid; players
  see black where it's hidden, the GM a dim tint. "Cover everything
  again" re-fogs the scene.
- **Dynamic line-of-sight fog** — sight is cast from each player-owned
  token against the GM's walls via an endpoint ray-casting visibility
  polygon, clearing fog only within view. **Explored-stays-dim memory**
  keeps places the party has seen faintly lit after they move on.
- **Scene darkness + light sources** — mark a scene dark and place
  lights (or give a token a light/vision radius that travels with it);
  in the dark the party sees only where line of sight overlaps a
  wall-bounded light. Lights are **click-and-drag** to reposition.

#### Walls & doors

- **Wall authoring** — draw sight-blocking walls that also stop token
  movement (slide-along collision). Straight, curved, or multi-point
  **polyline** walls; draw **snap-to-grid or freehand**.
- **Wall editing** — drag any vertex, drag a segment's midpoint dot to
  add a bend, alt/right-click a vertex to remove it. **Extend** a wall
  by clicking its end vertex (or clicking near it); **Connect** mode
  joins any two vertices with a new segment.
- **Doorways** — turn a single wall segment into a door (splitting the
  wall so the rest stays solid). Doors show for everyone — **solid when
  closed, dashed when open**, with a lock badge and a hover card showing
  name + state. The GM opens/closes/locks; players see and pass through
  open ones. Door endpoints **weld** to their flanking walls so a closed
  door seals with no token-sized gap for movement or sight.
- **Players see walls** as read-only grey lines.

#### Map editing

- **Grouped controls** — the flat tool grid became a tab bar (Play ·
  Shapes · Fog · Walls · Lights); each tab reveals only its own panel.
- **Undo / redo** for scene edits — walls, doors, shapes, lights and
  layers — via Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (and Ctrl+Y) plus sidebar
  buttons. Per-scene history that shares element references so it never
  duplicates layer image data.
- **Copy / paste / delete** a selected wall (Ctrl/Cmd+C · Ctrl/Cmd+V ·
  Delete, Esc to deselect).
- **Range-band ruler** — a second ruler mode that draws very close /
  close / far / very far reach rings from a dropped origin.

#### Notes

- **Multi-note tabs** — keep several notes open at once above the editor;
  click to switch, drag to reorder, middle-click or × to close, + to add.
  Opening a note anywhere (sidebar, wiki link, dashboard peek) adds a tab;
  the open set persists locally.
- **Mind Map nodes** now render each note's own file icon and colour, and
  can be dragged to reposition.
- **Dashboard quick-edit** embeds the full live-preview note editor
  (decorators, secrets, dice, collaboration) instead of a plain textarea.

### Changed

- **Map images now host in Supabase Storage** (the `note-images` bucket)
  instead of being embedded as base64 data-URLs in the scene row. Scene
  writes stay tiny, so rapid wall/shape/light editing no longer trips the
  Postgres statement timeout. Existing scenes auto-migrate their embedded
  images on load.
- **Switch campaign** moved from the Settings → Account list back to the
  sidebar footer, directly above Settings.

### Fixed

- Map write failures now surface the real Postgres message and
  auto-dismiss, instead of showing an opaque `[object Object]` that stuck
  in the sidebar.

### Database migrations

- None. Walls, doors, lights and fog live in the existing
  `map_scenes.data` jsonb; map images reuse the existing `note-images`
  Storage bucket.

## [1.1.0] — 2026-06-27

A feature release covering everything that landed between 1.0.2 and the
current `preview` branch. The two biggest shapes of work are a full
character system (Builder + Sheet + Level-Up) and a map overhaul that
moves from "one background image" to "many scenes, each composed of
positioned image layers". Co-GM role, mobile shell, dashboard chat,
linked HP across every surface, and a long sweep of light-mode polish
round out the release.

### Added

#### Character system

- **Character Builder wizard** — multi-step flow over species, class,
  background, ability scores, equipment, spells and identity details.
  Class-skill picker, background features auto-applied, equipment
  bullet lists parsed into structured inventory items.
- **Character Builder is open to players** and auto-prompts on a
  player's first join so they aren't dropped at a blank sheet.
- **2024 SRD datasets** — classes, species, backgrounds, feats and
  equipment parsed from the 2024 Free Rules. Falls back to the 2014
  SRD to plug parser gaps and keep older content working.
- **Character Sheet redesign** — Actions / Features / Inventory /
  Spells panels with themed surfaces, a Hit Dice tracker, a Dead
  status when reduced, XP-since-last-level readout, green / yellow /
  red HP bars, ritual breakout, and a level-up entry point. Inventory
  cards expand inline to show the SRD description.
- **Themed SRD popover** — hover any spell name or feat to see the
  full SRD entry without navigating away.
- **Level-Up modal** — walks the player through HP gain (rolled or
  average per campaign setting), new class features, subclass picks
  at the right level, ASI / feat at every 4 levels with explanations,
  Epic Boon at level 19, spell-slot diff, and prompts for new spells
  whenever a caster column grows. Warlock-aware; doesn't trap Confirm
  when the player has no spells to choose from. Auto-prompts on
  manual XP / level edits.
- **XP / level edits cascade** — change a single level's pick and the
  rest of the sheet recomputes.
- **Conditions + Exhaustion tracker on the sheet** — exhaustion now
  subtracts from rolls per the SRD. Toggling a condition propagates to
  Party, Initiative and Map.
- **Race-derived speed.**
- **Saving throws + Coin purse paired** to fill the empty grid cell on
  the sheet.

#### Map

- **Multiple scenes per campaign.** New `map_scenes` table; each
  campaign holds an ordered list of scenes. Active scene is what
  players see; a separate GM-preview scene lets the GM stage the next
  scene without flipping the player view. An on-screen **Previewing**
  badge stays visible while the GM's view diverges from active.
- **Free-positioned image layers per scene.** Each scene composes any
  number of image layers with `{x, y, w, h, rotation, hidden, name}`.
  Layers can be reordered, renamed, hidden per-layer, and dropped in
  freely without disturbing siblings.
- **Per-scene tokens.** `scene_id` on `map_tokens`; switching scenes
  shows a fresh roster. Legacy tokens with no scene_id keep showing
  on the active scene until cleaned up.
- **Edit tool.** Select stays focused on tokens and shapes; the new
  **Edit** tool exposes drag-to-move and a bottom-right corner handle
  for both images and tokens. Selection ring + dashed border indicate
  what's editable.
- **Numeric token size input** in the GM sidebar row for precise
  sizing (Large = 100, Huge = 150, ...).
- **Fit-to-content.** Fit-to-screen now fits the union of the canvas
  border and every visible image layer, so a battlemap larger than
  the canvas no longer ends up off-screen.
- **Token damage / heal input.** A signed-number control on each token
  row that resolves multi-hit math in one entry, mirroring the same
  control on the Character Sheet HP block.
- **Pre-seed tokens from creatures.** PCs join the existing NPC / Stat
  Block roster, so the GM can drop a Party token by name with HP
  already filled.

#### HP and conditions linked everywhere

- **`hpLink` cross-surface sync.** A shared helper fans HP / max-HP
  changes from any one surface (Character Sheet, Party, Initiative,
  Map token) out to the others. A `fromSync` flag breaks the re-entry
  loop so rapid keypresses don't race the sync round.
- **DB fallback path.** When the target store isn't mounted (e.g. the
  player has the Map open and changes HP, but the Initiative panel
  hasn't been opened this session), `hpLink` patches the Supabase
  rows directly so the change still lands.
- **Unified HP bar colours** across Sheet, Party, Initiative and Map.
- **Map → Sheet condition sync** rounds out the linked-condition
  story (Initiative was already covered).
- **Conditions on Party CharCard + Map tokens.** Same status chips
  appear wherever the PC shows up.

#### Multiplayer

- **Co-GM role.** Full GM permissions except deleting the campaign.
  `campaign_members.role` widened to `'gm' | 'cogm' | 'player'`; the
  `is_gm()` helper now matches `('gm', 'cogm')`; the `campaigns_delete`
  policy is narrowed to the primary GM only.
- **Campaign chat as a Dashboard tab.** Messages, `@mentions`,
  `[[wiki-style chips]]` for notes / NPCs / items, slash-prefixed
  whispers visible only to the sender and recipients, GM-only labels,
  GM can delete chat messages, notification sound on incoming.
- **Per-member colour, bio, avatar.** Shared across chat, mentions,
  map tokens and the viewer-avatar stack.

#### Dashboard

- **Dashboard chat tab** + **draggable Quick Dice** that floats
  wherever it doesn't obscure the table.
- **Eager chat-member loading** so the GM view shows player claim
  labels immediately on first render.

#### Mobile

- **Hamburger-only top bar** below the medium breakpoint, with a
  drawer for navigation. Desktop rail unchanged.
- **Master-detail layout** for Notes / NPCs / Party — phone shows the
  list first, tap-through opens the detail pane.
- **Full-screen modals** for sheet editing on phones.
- **Sheet density** compresses cards automatically at narrow widths.

#### Notes

- **`@{Name}` mentions click through to the Character Sheet.**
- **Per-note icon colour picker.** Pick a colour and any of 16
  thematic glyphs in one popover; the icon previews in your chosen
  colour before you commit. Storage packs the colour into `note.icon`
  as `iconId|#hex`; old id-only rows still work without a migration.
- **Sub-folder colour picker rendered via React portal.** The
  popover was being silently clipped by an `overflow: hidden`
  ancestor (used for the folder expand / collapse animation), which
  read as "can't edit lower-tier folders". Portal-anchored to the
  trigger's bounding rect, so visibility is independent of depth.

#### Settings

- **Account section** — current email is shown; change email, change
  password, and password reset link all accessible inside the app.
- **Export campaign** — GM-only JSON snapshot from Settings covering
  every campaign-scoped row (notes, party, NPCs, homebrew, ...).
- **Sidebar auto-expand on hover** toggle for the collapsed rail.

#### Rules

- **Clickable See-also links** so cross-references jump straight to
  the referenced section.
- **Category filter chips** above the rules list.

#### Inventory + features

- **Themed boxes** + **collapsible feature descriptions** so a
  features list with twenty entries stays scannable.
- **Click to expand SRD descriptions** on inventory items.
- **Full inventory shipped in the campaign PDF export.**

### Changed

- **`is_gm()` widened to match `cogm`.** Every is_gm-gated policy
  across the database (notes, npcs, party, map, homebrew, shops, stat
  blocks, transcripts, campaign settings) automatically picks up Co-GM
  permissions through this helper. The `campaigns_delete` policy was
  explicitly narrowed to `role = 'gm'` so a Co-GM cannot drop the
  campaign.
- **Map background → first image layer.** The legacy
  `map_state.background_url` is preserved in-place; the new migration
  promotes its value to a single full-canvas image layer on the
  campaign's first scene so existing campaigns look identical after
  upgrade. New uploads always go through the image-layer path.
- **One token per player → one token per player per scene.** The
  "already placed" check now scopes to `scene_id`, so a player can
  place their PC's token on each scene independently.
- **Fit-to-screen behaviour.** Previously fit the canvas border only;
  now fits the union of canvas + visible image layers.
- **HP rolling method** is a campaign-wide setting that the Level-Up
  modal reads, instead of a per-prompt question.
- **Settings → Account** replaces the old "Settings" placeholder.

### Fixed

- **Realtime echoes wiping freshly-added map layers.** Image data-URLs
  inside `map_scenes.data` can push a row past Supabase Realtime's
  per-message size cap; the payload then arrives with `data` dropped
  to null even though the DB row is intact, so the echo of the GM's
  own write was clobbering the layer they'd just added. The
  subscription handler now detects truncation and preserves local
  shapes / layers, only adopting column-level fields.
- **Duplicate-content race when opening a note in two tabs.** The
  second tab was racing the editor into a duplicate-content state
  before the Yjs document hydrated. Resolved by ordering the
  hydration steps so the doc is awaited before the editor mounts.
- **HP sync feedback loop.** A `fromSync` flag on `updateToken` /
  party / initiative updates breaks the re-entry round so a single
  keypress on an HP input doesn't ping-pong through every store and
  race the user's next keystroke.
- **HP sync when the target store isn't mounted.** `hpLink` now
  falls back to a direct Supabase update of the matching rows, so
  cross-surface sync works even when only one panel is open.
- **`@{Name}` hover tooltip + Notes party load.** The hover handler
  was matching the wrapped `@{Name}` token against bare member
  names; strip the wrapper first. Notes also wasn't loading the
  party store on mount, so a hard reload to `/notes` left the
  LiveEditor with an empty party array.
- **SwitchRow thumb hanging off the right edge.**
- **Level-Up modal trap.** Confirm no longer requires picking a spell
  when the spell pool is empty (e.g. Warlock at a level with no new
  prepared spells). Warlock semantics are now handled distinctly from
  prepared casters.
- **Inventory click handler.**
- **Exhaustion math.** Exhaustion now actually subtracts from rolls
  per the SRD; the tracker was decorative before.

### Removed

- **Old single-background map model.** `map_state.background_url` is
  no longer written to; the column stays for the backfill but the
  application path is entirely through `map_scenes.data.layers`.

### Database migrations

Run these in the Supabase SQL editor in **filename order**. Each is
designed to be idempotent (`if not exists` guards on tables, columns
and policies), so re-running an already-applied migration is a no-op.

| File | What it does |
|---|---|
| `20260610000000_npc_stat_blocks.sql` | `npcs.stat_block` JSONB + `npcs.stat_block_visible` |
| `20260610000001_npc_permissions.sql` | Per-NPC visibility table + RLS |
| `20260615000000_chat_messages.sql` | `chat_messages` table + RLS + realtime |
| `20260615000001_campaign_member_color.sql` | `campaign_members.color` |
| `20260615000002_seed_test_chat_member.sql` | Seed data for the test campaign |
| `20260616000000_campaign_member_bio.sql` | `campaign_members.bio` |
| `20260616000001_user_profiles_avatars.sql` | `user_profiles` table for avatars |
| `20260616000002_chat_messages_gm_delete.sql` | GM can delete chat messages |
| `20260619000000_chat_messages_gm_whisper_visibility.sql` | Whispers visible to GM/Co-GM in addition to sender + recipients |
| `20260619000001_cogm_role.sql` | Widens `role` check to include `cogm`, updates `is_gm()`, narrows `campaigns_delete` to primary GM only |
| `20260627000000_map_scenes.sql` | `map_scenes` table; `map_state.active_scene_id` + `gm_preview_scene_id`; `map_tokens.scene_id`; backfill that creates "Scene 1" from each existing `map_state` row with the old background promoted to a full-canvas image layer |

The application code falls back gracefully on rows that pre-date each
migration; you can apply them at any time after pulling 1.1.0.

## [1.0.2] — 2026-05-27

A light-mode contrast pass. Dark mode shipped first and most surfaces
hard-coded shades tuned for a dark backdrop; flipping to light exposed a
long tail of unreadable elements. Every fix below is scoped to
`html.light` (or routed through a new mode-aware CSS variable) and
leaves dark mode untouched.

### Fixed

- **Disabled buttons (Sign in, Roll).** Tailwind's `disabled:` variants
  compile to their own selectors, so the existing `.bg-slate-800` light-
  mode override didn't catch `disabled:bg-slate-800` — the buttons
  rendered as dark slate with dark-grey text. Added matching
  `disabled:` overrides.
- **Sidebar nav active row.** The selected page used `bg-slate-800` +
  `var(--ac-200)`, which in light mode produced washed-out blue on a
  barely-tinted background. New `--nav-active-bg` / `--nav-active-fg`
  CSS variables flip to dark slate text on a pale-blue fill in light
  mode; dark mode keeps the original slate-800 + sky-200.
- **`bg-slate-700` "active" pills.** NPC status filter pills, the icon
  picker, the quick-dice toggle, and the auth tabs all use
  `bg-slate-700` for the selected state — left dark in the original
  light-mode pass, producing dark-on-dark with our darkened text.
  Remapped `.bg-slate-700` (and the hover variant) to `#cbd5e1`.
- **Active auth tab text.** "Sign in" / "Create account" labels used
  `--ac-200` for the active color, which was too pale on the pale-blue
  tab tint. New `--auth-tab-active-fg` variable darkens it to slate-800
  in light mode without touching the sidebar nav's use of `--ac-200`.
- **`PageHeader` strip.** The page header used `bg-slate-900/50`, an
  opacity variant Tailwind compiles to its own class that escaped the
  base `.bg-slate-900` override and rendered as a dull grey band. Made
  `bg-slate-900/50` and `bg-slate-900/40` transparent in light mode so
  the header blends into the panel.
- **Markdown tables in Rules.** `.markdown-body th` had a hard-coded
  dark-slate fill; combined with our darkened markdown body text, the
  Rules charts rendered as dark text on dark cells. Flipped the table
  chrome (th bg, td/th borders, hr, h1 underline, link color) to light
  values.
- **CodeMirror text selection.** Highlighting note text used a 50%-alpha
  navy that bled into the darkened editor text. Selection background
  flips to a pale sky (`#bae6fd`) in light mode.
- **Note decorator dark-text variants.** Every decorator class
  (`note-loc`, `note-dep`, `note-milestone`, `note-link`, `note-dice`,
  `note-artifact`, plus the secret-block chrome and `.csw-*` widget
  parts) was using a 300-level pastel tuned for dark backgrounds. Added
  `html.light` overrides that drop each one to the 700/800 shade of its
  hue, so the alpha-tinted background still reads as "the X color" but
  the text is legible on the white note canvas. Both rendered markdown
  (`.note-*`) and the live editor (`.cm-d-*` / `.cm-secret-widget`) are
  covered.
- **Initiative tracker cards.** The active-combatant row and "Now
  Acting" summary card used `color-mix(..., #0f172a)` to tint
  themselves with the accent, hardcoding the dark base. In light mode
  the blend still produced a near-black surface that swallowed the
  newly-darkened text. Routed through a new `--surface-elev` variable
  (slate-900 in dark, white in light) so both surfaces flip to a pale
  accent wash.
- **`@{Player}` mention color.** Pale green-300 mention text washed
  out on the light surface. Routed through `--deco-player-fg`
  (green-300 dark / green-800 light); both the CodeMirror token and
  the markdown render path consume it.
- **Note editor surface.** The CodeMirror editor baked its background,
  text, heading, and inline-code colors into the JS theme so the
  light-mode CSS layer couldn't reach them — the editor stayed dark on
  an otherwise light page. Routed those five values through CSS
  variables (`--editor-bg`, `--editor-fg`, `--editor-heading`,
  `--editor-code-bg`, `--editor-code-fg`) so the editor flips with the
  app without a re-mount.
- **Sky-tinted accent text.** Party cards and other surfaces used
  `text-sky-200` / `text-sky-300` for character names and stat values;
  the previous light-mode surface overrides only touched `text-slate-*`,
  so the pale sky was effectively unreadable on the slate-100 panel.
  Overrode `text-sky-{50,100,200,300}` to slate-900 in light mode, and
  `text-sky-400` (plus hovers) to a slightly bluer slate (`#1e3a8a`)
  so the accent character is preserved without losing legibility.

### Changed

- **Artifact decorator color.** Switched from green (`#86efac` / `#166534`)
  to pink (`#f9a8d4` dark / `#9d174d` light). Green was already used by
  `@{player}` mentions, so the two read as the same color class at a
  glance — pink keeps the "item" decorator visually distinct.
- **Roll button text.** The Dice page Roll button used `text-slate-950`
  on its sky-700 fill, rendering as near-black on dark blue in both
  modes. Switched to `text-white` for direct contrast.
- **Switch-campaign icon.** The sidebar footer "Switch campaign" button
  shared the `LogOut` icon with "Sign out", making them visually
  identical. Swapped in `ArrowLeftRight` and dropped the rose hover
  tint — the action is non-destructive (it returns to the campaign
  picker).

### Notes

No database migrations and no schema changes. All edits are CSS variable
plumbing or TSX className/icon swaps; deploy is a straight `vercel
--prod` after pulling main.

## [1.0.1] — 2026-05-21

### Added

- **Per-user note permissions.** Replaced the tri-state visibility cycle
  (GM only / View only / Editable) with a per-user view/edit matrix. The note
  author and GM always have full access; the GM (or author) can grant view
  and/or edit independently to each player. Quick presets (GM only, Party
  view, Party edit) stamp the matrix in one click. Edit implies view.
- **Explicit Save button for notes.** Title and body changes are now
  buffered locally and flushed to Supabase on Save click, which broadcasts
  to other viewers via realtime. Sidebar shows an unsaved-changes dot next
  to dirty notes.
- **Map ping tool.** Click anywhere on the map (available to GM and
  players) to drop a 2-second animated pulse visible to everyone viewing
  the map. Broadcasts via Supabase Realtime — ephemeral, not persisted.
- **Map viewer presence.** Avatar stack in the top-right of the map shows
  who else currently has the map open, with amber initials for GM and sky
  for players, and a white ring on your own avatar.
- **Collapsible sidebar.** A toggle in the sidebar header shrinks the
  aside from 224 px to 56 px, hiding labels and the join-code row, and
  collapsing every footer row to an icon-only button with the label as a
  tooltip. State persisted across reloads.
- **Dark / Light mode toggle.** Replaced the 5-accent and 6-background
  color pickers with a single Sun/Moon toggle. Dark uses the saturated
  Arcane blue (the original default); light uses a pale blue accent paired
  with slate-100 surfaces.
- **NPC stat blocks.** Each NPC now carries a 5e-style stat block
  (creature type, AC, HP, hit dice, speed, ability scores, skills, senses,
  languages, damage/condition immunities, CR, traits, actions). GM gets
  an inline editor; players see a formatted read-only card. Visibility is
  a separate flag from the existing "visible to players" gate — the GM
  can reveal an NPC while keeping their stats hidden.
- **Rules panel — character-creation chapters.** Bundled nine new SRD 5.1
  sections covering Step-by-Step Character Creation, Ability Score
  Generation, Races (Overview), Classes (Overview), Backgrounds,
  Alignment & Personality, Equipment & Starting Wealth, Levels and
  Advancement, and Multiclassing. Total sections: 33 → 42.

### Fixed

- **@PlayerName hover tooltip.** The CodeMirror decorator marks the whole
  `@{Name}` token, so the hover handler's lookup was comparing
  `"@{Name}"` against the bare member name and never matching. Strip the
  wrapper before lookup. Also fixed Notes.tsx not loading the party store
  on mount — landing on /notes from a hard reload meant the LiveEditor
  saw an empty party array.
- **Initiative tracker conditions not counting down.** End-of-round only
  persisted updates when the conditions list length changed (i.e., a
  condition expired). For still-active conditions (Poisoned 3 → 2 →
  1) the decrement was computed but never saved, freezing the counter
  visually until expiry. Now persists on any change.
- **Map tokens couldn't be placed at narrow viewport widths.** The map
  SVG used `w-full h-full` which collapsed to 0×0 once the sidebar
  consumed the available width, intercepting clicks. SVG now uses
  `position: absolute; inset: 0` against the existing relative parent.

### Changed

- The 5-color accent picker (grimoire / arcane / ember / thornwood /
  bloodmoon) and the 6-preset background-color picker are gone. Existing
  user theme selections fall back to dark mode silently — no migration
  needed.

### Bug fixes during the release

These didn't ship as user-visible bugs in 1.0 — they were regressions
introduced and resolved within the 1.0.1 release window — but they're
recorded here for posterity.

- RLS recursion between `notes_select` and `note_permissions_select` was
  returning 500 from PostgREST and breaking all note loading. Fixed by
  routing the `note_permissions` policy through a SECURITY DEFINER helper
  (`note_author(uuid)`) so it never reads from `notes` directly.
- React error #185 (max update depth exceeded) on every page that used
  the new Zustand selectors, caused by `s.permissions[id] ?? []`
  returning a fresh empty array each call. Fixed by routing through a
  module-level `EMPTY_PERMS` constant.
- The Share popover closed itself on the same `mousedown` that opened it.
  Outside-click listener now attaches on the next tick.

### Database migrations

Run these in the Supabase SQL editor in order:

1. `supabase/migrations/20260521_note_permissions.sql` — new
   `note_permissions` table with RLS + backfill from the legacy
   `visible_to_players` / `player_editable` columns.
2. `supabase/migrations/20260521_note_permissions_fix_recursion.sql` —
   hotfix for the RLS recursion described above.
3. `supabase/migrations/20260521_npc_stat_blocks.sql` — adds
   `stat_block` (JSONB) and `stat_block_visible` (boolean) to `npcs`.

The application falls back gracefully on rows that pre-date each
migration; you can run them at any time after pulling 1.0.1.

## [1.0.0] — Initial release

Multiplayer GM companion for D&D 5e: notes, party tracker, initiative,
map board, NPC tracker, spells, items, shop, statblocks, homebrew,
session transcription, and SRD rules. Supabase-backed, real-time across
all players in a campaign.

[1.1.0]: https://github.com/cmlostek/grimoire/releases/tag/v1.1.0
[1.0.2]: https://github.com/cmlostek/grimoire/releases/tag/v1.0.2
[1.0.1]: https://github.com/cmlostek/grimoire/releases/tag/v1.0.1
[1.0.0]: https://github.com/cmlostek/grimoire/releases/tag/v1.0.0
