<img width="480" height="168" alt="Arc 2026-04-23 22 11 36" src="https://github.com/user-attachments/assets/985fd684-b3d0-44e8-a186-8c46166327f8" />

# ⚔️ Grimoire — Version 1.1.1
- Built with [Claude](https://www.anthropic.com/) Sonnet 4.6 and Opus 4.7.
- Release notes: [CHANGELOG.md](./CHANGELOG.md)

A real-time, multiplayer Game Master companion for running **Dungeons & Dragons 5e** campaigns in the browser. One fast screen that handles every table-side concern — notes, party tracking, combat, maps, character sheets, level-ups, spells, items, shops, NPCs, chat, dice — with live sync across every player in the campaign.

---

## Table of Contents

- [What's new in 1.1.1](#whats-new-in-111)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Supabase Setup](#supabase-setup)
  - [Local Development](#local-development)
  - [Deploying to Vercel](#deploying-to-vercel)
- [Note Syntax Reference](#note-syntax-reference)
- [Multiplayer & Permissions](#multiplayer--permissions)
- [Project Structure](#project-structure)

---

## What's new in 1.1.1

A map-focused release. The headlines:

- **Fog of war, line of sight & lighting** — paint fog by hand or cast dynamic line-of-sight from each player token; mark a scene dark and place lights (or give a token a light/vision radius) so the party sees only what a wall-bounded light reveals. Explored areas stay dimly lit.
- **Walls & doors** — draw sight-blocking walls (straight, curved or multi-point polylines, snap-to-grid or freehand) that also stop movement. Turn a single segment into a **door** that opens, closes and locks; players see doors and pass through open ones.
- **Deeper map editing** — grouped control tabs, undo/redo, copy/paste, drag-to-edit wall vertices, **Connect** mode to join any two vertices, draggable lights, and a **range-band** ruler (very close / close / far / very far).
- **Faster maps** — battlemap images now upload to Storage instead of bloating the scene row, so heavy wall/light editing no longer trips database timeouts (existing scenes auto-migrate).
- **Multi-note tabs** — keep several notes open at once above the editor, plus a **Mind Map** whose nodes carry each note's file icon and colour, and a full live-preview editor in the Dashboard's quick-edit.

Full notes in [CHANGELOG.md](./CHANGELOG.md).

---

## Features

### 📓 Notes
A live Obsidian-style markdown editor with custom inline syntax. Syntax markers hide when the cursor leaves a line, leaving only the rendered text on screen.

- **Hierarchical folders** with per-folder colour and player-visibility controls. Sub-folder colour pickers render through a React portal so they're never clipped by collapse animations.
- **Per-note icons with colour** — pick a tint and any of 16 thematic glyphs (town, dungeon, ship, skull, crown, ...). The icon previews in your chosen colour before you click it.
- **Per-user permissions** — pick view and/or edit access independently for each player, or use one-click presets (GM only · Party view · Party edit). The note's author and the campaign GM always have full access.
- **Explicit Save button** — title and body edits buffer locally and broadcast to other viewers on save. Sidebar shows a dot next to dirty notes.
- **Custom decorator syntax** — locations, milestones, plot dependencies, artifacts, secrets, GM-only comments (see [Note Syntax Reference](#note-syntax-reference)).
- **Wiki links** `[[Note Name]]` with autocomplete and broken-link indicators.
- **`@{Player Name}` mentions** click through to that player's Character Sheet.
- **Secrets** `{{hidden text}}` rendered as interactive lock/reveal cards; players only see revealed ones.
- **Inline dice rolls** `$1d20 + 5$` — click to roll into the dice panel.
- **Multi-note tabs** — keep several notes open at once above the editor; click to switch, drag to reorder, middle-click or × to close. Opening a note anywhere (sidebar, wiki link, dashboard peek) adds a tab, and the open set is remembered between sessions.
- **Mind Map** — a force-directed graph of your notes linked by `[[wiki]]` references and clustered by `#tag`. Each node shows the note's own file icon and colour and can be dragged to reposition.
- **Dashboard quick-edit** — the Recent Notes peek on the Dashboard opens the full live-preview editor (decorators, secrets, dice, live collaboration), not a plain textarea.
- **Multi-tab safe** — opening the same note in two browser tabs no longer races the editor into a duplicate-content state.

### 🧙 Character system
A full 2024 SRD-aware character pipeline, from creation to level-up to in-game tracking.

#### Character Builder
- **Multi-step wizard** — species, class, background, ability scores, equipment, spells, details.
- **2024 SRD data** — classes, species, backgrounds, feats and equipment parsed from the 2024 Free Rules.
- **Class skill picker** + auto-applied background features.
- **Equipment auto-parse** — bullet lists in starting equipment become structured inventory items.
- **Spell preparation** — visible to non-casters as well, so players can browse what spellcasters get.
- **Open to players** — players join a campaign, get auto-prompted to build a character on their first visit.

#### Character Sheet
- **Actions, Features, Inventory, Spells panels** with themed surfaces.
- **HP block** — current, max, temp, with green/yellow/red bars, an editable damage/heal input, a Hit Dice tracker and a Dead status when reduced.
- **Conditions + Exhaustion** — toggle a condition on the sheet and it propagates to Party, Initiative and the Map token. Exhaustion now actually subtracts from rolls per the SRD.
- **Inventory** — themed cards; click to expand the SRD description in place. Full inventory ships in the PDF export.
- **Themed SRD popover** — hover any spell name to see the full SRD entry without leaving the page.
- **Race-derived speed**, **ability score breakouts**, **saving throws + coin purse** paired to fill the empty grid cell.

#### Level-Up Modal
- Walks the player through **HP gain (rolled or average per campaign setting)**, new class features, subclass picks at the right level, ASI/feat at every 4 levels (and the Epic Boon at 19), spell-slot delta, and prompts for new spells whenever a caster column grows.
- **Auto-prompts** on manual XP / level edits, and on the first time a player joins.
- **Cascades through every level** — change a level-1 ability score and the rest of the sheet recomputes.
- Warlock-aware (spell pool semantics), and won't trap the Confirm button when the player has no spells to choose from.

### 🎲 Dice
- Standard dice: d4, d6, d8, d10, d12, d20, d100.
- **Advantage / Disadvantage** — rolls 2d20 and shows the dropped die.
- Modifier input with +/− buttons and custom roll labels.
- Natural 20 / Natural 1 detection with colour coding.
- **Draggable Quick Dice panel** — float it wherever it doesn't obscure the table; accessible from every screen.

### ⚔️ Initiative Tracker
- Add combatants with name, initiative, HP and AC.
- Auto-sort by initiative roll; advance turns with a round counter.
- Adjust HP inline during combat.
- PC flag to distinguish players from monsters.
- **Linked HP & conditions** — editing HP or toggling a condition here syncs the matching PC on Party, Sheet and Map without any extra clicks.
- **Timed conditions** — attach Poisoned, Stunned, Restrained etc. with a duration; the counter decrements each round and the condition is removed automatically when it expires.

### 👤 NPCs
- Add NPCs your players can collect notes about.
- Track alive / dead / captured / unknown / missing, faction and location.
- Sort or filter by status; search by name or faction.
- **Stat blocks** — every NPC carries a 5e-style stat block (AC, HP, hit dice, speed, ability scores, skills, senses, languages, damage / condition immunities, CR, traits, actions). GM edits inline; players see a formatted read-only card.
- **Two-stage visibility** — reveal an NPC's identity without exposing their stats, or vice versa.

### 🗺️ Map Board
A scene-based tactical surface. Every campaign holds a list of scenes; each scene owns its own grid, image layers, shapes, walls, lights and tokens. The GM-side controls are grouped into tabs — **Play · Shapes · Fog · Walls · Lights** — each revealing only its own panel.

- **Multiple scenes per campaign** — switch the active scene to flip the player view; GMs can stage a non-active scene privately first (the **Previewing** badge stays on screen so it's clear which view is yours).
- **Image layers** — each scene composes any number of positioned image layers. Toggle layer visibility, rename, reorder, drop in a new image without disturbing the others. Images upload to Storage, so editing stays fast no matter how large the battlemap.
- **Fog of war** — paint reveal/hide by hand, or switch to **line-of-sight** fog that's cast from each player token against the walls. Explored areas stay dimly lit after the party moves on.
- **Lighting & darkness** — mark a scene dark and place lights (or give a token a light/vision radius that moves with it); in the dark the party sees only where sight overlaps a wall-bounded light. Drag lights to reposition.
- **Walls** — draw sight-blocking walls that also stop token movement. Straight, curved or multi-point **polyline** walls, snap-to-grid or freehand. Drag vertices, add bends, **extend** a wall from its end, or use **Connect** mode to join any two vertices. Players see walls as grey lines.
- **Doorways** — turn a single wall segment into a door: **solid when closed, dashed when open**, lockable by the GM, with a hover card showing its name and state. Players see doors and walk through open ones; closed doors seal flush against their walls.
- **Undo / redo, copy / paste** — Ctrl/Cmd+Z (and Shift for redo) across all scene edits; select a wall and Ctrl/Cmd+C / V to duplicate, Delete to remove.
- **Edit tool** — Select moves tokens and shapes (the default). Switch to **Edit** (GM-only) to drag images and tokens around or grab the corner handle to resize them. Tokens also have a numeric size input in the sidebar for precise sizing.
- **Tokens** with emoji, owner-tinted ring, name label, and a damage / heal input that runs the math for you.
- **Linked HP & conditions** — every token's HP and conditions sync with the matching PC on Sheet, Party and Initiative.
- **Pre-seed from creatures** — drop in tokens from your Party, NPCs or Stat Blocks with HP/AC already filled.
- **Area-of-effect shapes** — circles, squares, cones with adjustable size and colour.
- **Ruler** for measuring distances, plus a **range-band** mode (very close / close / far / very far) for ability and action reach.
- **Ping tool** — click anywhere to drop a 2-second pulse visible to everyone viewing the map.
- **Viewer presence** — avatar stack shows who else has the map open right now.
- **Fit-to-content** — fits the bounding box of the canvas + every visible image layer, so large layers don't end up off-screen.

### 👥 Party
- Add characters manually or **import from D&D Beyond JSON**.
- Track HP (current / max / temp), AC, initiative bonus and passive perception.
- Full ability scores, saving throws, skills, languages and features.
- Players can claim and edit their own character; GMs can edit all.
- **Hover cards** on `@{Player Name}` references in notes — see full stats inline.
- **Linked across surfaces** — HP and conditions stay in sync with Sheet, Initiative and Map tokens.
- **PCs feed the Map creature roster** so you can drop their tokens by name.

### 💬 Dashboard + Chat
- **Dashboard** is the campaign's landing page — party status at a glance, NPC roster, recent notes, and a chat tab.
- **Campaign chat** with `@mentions`, `[[wiki-style chips]]` for notes/NPCs/items and slash-prefixed whispers. GM-only labels show on every message that came from a GM or Co-GM.
- **Whispers** are visible only to the sender and recipients; the GM sees an indicator that a whisper exists in the channel.
- **Notification sound** for incoming messages.

### 📚 Rules Reference
- Full **SRD 5.1 + 2024 SRD** browser with search.
- **Conditions** reference (poisoned, charmed, stunned ...).
- **Character-creation chapters** — Step-by-Step Character Creation, Ability Score Generation, Races (Overview), Classes (Overview), Backgrounds, Alignment & Personality, Equipment & Starting Wealth, Levels and Advancement, and Multiclassing.
- **Clickable See-also links** and **category filter chips** for fast navigation.
- Read-only reference; always available as a sidebar.

### 🧪 Stat Blocks
- A standalone library of reusable creature stat blocks beyond the NPC roster.
- Pre-seed a Map token from any stat block (HP, name, emoji).

### 🧙 Homebrew
- Create custom **monsters, items and spells**.
- Full stat block editor with traits, actions, bonus / legendary actions.
- Mark homebrew as campaign-visible to share with players.
- Clone any entry as a template.

### 🛒 Shops
- Build named merchant inventories from any SRD or homebrew item.
- Set per-item stock and price.
- **Random stock generator** — fills a shop with 8–16 random items at randomised quantities.
- Search within the active shop.

### 🔮 Spells & Items Browsers
- 300+ SRD spells filterable by level, school, ritual and concentration.
- Full equipment and magic item tables, sortable by rarity.
- Homebrew inline alongside SRD content.
- **Themed SRD popover** on hover.

### 🎙️ Transcription
- **Speech-to-text** session journal using the browser Web Speech API.
- Real-time interim and final transcript display.
- Link recordings directly to campaign notes.
- Transcript history with timestamps and search.

### ⚙️ Settings
- **Account** — change email or password from inside the app; reset link for password recovery.
- **Export campaign** — GM-only JSON snapshot of every campaign-scoped row (notes, party, NPCs, homebrew, ...).
- **Sidebar auto-expand on hover** toggle.
- **HP rolling method** (rolled or average) — campaign-wide, drives the Level-Up modal.

### 📱 Mobile
- **Hamburger-only top bar** below the medium breakpoint with a drawer for navigation; the desktop rail stays untouched on wider screens.
- **Master-detail layout** on lists (Notes, NPCs, Party) — phone shows list first, tap-through opens detail.
- **Full-screen modals** for sheet editing.
- **Sheet density** automatically compresses to fit narrow viewports.

### 🎨 UI
- **Collapsible sidebar** — toggle to icons-only at any time, or set it to auto-expand on hover; state persists across reloads.
- **Dark / Light mode** — single Sun/Moon toggle.
- **Light-mode polish** — every surface tuned for legible text on a pale backdrop: disabled buttons, sidebar selection, auth tabs, Rules tables, the CodeMirror selection, every note decorator, the Initiative cards, party stat values, the feats list.
- **Themed feature/inventory cards** with collapsible descriptions.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Framework** | React 19 | Concurrent rendering, server-components future-proofing |
| **Build** | Vite 8 + TypeScript 6 | Sub-second HMR, strict type checking |
| **Styling** | Tailwind CSS 3 | Utility-first, zero dead CSS in production |
| **State** | Zustand 5 | Minimal boilerplate, per-feature stores with `loadForCampaign` pattern |
| **Backend** | Supabase | Postgres + Row-Level Security + real-time `postgres_changes` subscriptions |
| **Auth** | Supabase Auth | Email/password, persistent sessions |
| **Editor** | CodeMirror 6 | Extensible token-based live markdown rendering (Obsidian-style) |
| **Markdown** | react-markdown + remark-gfm | GFM tables, task lists, strikethrough |
| **Routing** | React Router 7 | SPA routing with Vercel rewrite fallback |
| **Icons** | Lucide React | Consistent 2px-stroke SVG icon set |
| **Deployment** | Vercel | Zero-config, automatic HTTPS, SPA rewrite |

### Architecture notes

- **Feature-store pattern.** Each feature (`notes`, `party`, `map`, `chat`, ...) has a co-located Zustand store with a `loadForCampaign(campaignId)` action. The active campaign ID is stored in a root session store; switching campaigns triggers all feature stores to reload.
- **Row-Level Security.** Every Supabase table enforces RLS so members can only read / write data belonging to their campaign and matching their role (`gm` · `cogm` · `player`).
- **Realtime.** Each store subscribes to `postgres_changes` for its table, filtered by `campaign_id`. A `useVisibilityReload` hook re-triggers `loadForCampaign` on tab focus to recover from stale WebSocket connections. The map additionally uses a dedicated `map-presence:` channel with Supabase `broadcast` for ephemeral pings and Supabase `presence` for the viewer-avatar stack — neither hits the database.
- **Realtime payload guards.** Large image data URLs (map scene layers) can exceed Supabase Realtime's per-message size cap, arriving with their `data` jsonb dropped to null. The map store detects truncation and preserves the local state rather than wiping the layer the user just added.
- **Live editor.** The Notes editor is built on CodeMirror 6 `ViewPlugin` + `WidgetType`. Markdown syntax markers are hidden via `Decoration.replace()` when the cursor is off that line, and custom decorator tokens (`@{…}`, `{{…}}`, `[[…]]`, ...) are similarly hidden off-cursor, revealing only the rendered content.
- **Cross-surface HP linking.** A shared `hpLink` helper fans an HP / max-HP change from any one surface (Sheet, Party, Initiative, Map) out to the others, including a Supabase fallback path so changes apply even when the target store isn't mounted. A `fromSync` flag breaks the re-entry loop so rapid keypresses on an HP input don't race the sync round.

---

## Getting Started

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **npm** (ships with Node) or your preferred package manager
- A **Supabase project** (free tier is fine) — [supabase.com](https://supabase.com/)

### Supabase Setup

#### 1. Create a project

Sign in to [app.supabase.com](https://app.supabase.com), create a new project, and note your **Project URL** and **anon public key** from *Settings → API*.

#### 2. Run the schema

Open the **SQL Editor** in your Supabase dashboard. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run each numbered section in order. The schema creates the full table set, RLS policies, helper functions (`is_member`, `is_gm`, `note_author`, `touch_updated_at`) and the realtime publication entries.

Major tables include `campaigns`, `campaign_members`, `notes`, `note_folders`, `note_permissions`, `party_members`, `initiative_entries`, `map_state`, `map_scenes`, `map_tokens`, `npcs`, `homebrew`, `shops`, `stat_blocks`, `chat_messages`, `transcripts` and `user_profiles`.

#### 3. Run the migrations

Apply each file in [`supabase/migrations/`](supabase/migrations/) in **filename order** — they're prefixed with `YYYYMMDDHHMMSS` so a lexicographic sort matches the intended order. The application code is defensive: every store falls back gracefully when a column or table is missing, so you can apply migrations at any time after pulling the matching code release.

A high-level summary of what the current set adds, in order:

| Range | Adds |
|---|---|
| `20260610*_npc_*` | NPC stat blocks + per-NPC permission rows |
| `20260615*_chat_*` + `*_campaign_member_color*` | Chat messages, per-member colour |
| `20260616*` | Member bio, user-profile avatars, GM chat deletion |
| `20260619*` | GM-only whisper visibility, **Co-GM** role |
| `20260627*_map_scenes` | `map_scenes` table + `scene_id` on `map_tokens` + active/preview scene pointers on `map_state`, with a backfill that creates "Scene 1" from each existing `map_state` row |

The CLI alternative is `supabase db push` from the project root; both paths land at the same place.

#### 4. Enable email auth

In the Supabase dashboard go to *Authentication → Providers* and confirm **Email** is enabled. For local development, disable email confirmation under *Authentication → Settings* so sign-ups go through immediately.

### Local Development

```bash
# 1. Clone the repo
git clone https://github.com/cmlostek/grimoire.git
cd grimoire

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
```

Edit `.env.local` and fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

```bash
# 4. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Create an account, then create a campaign. Share the 6-character **join code** with your players so they can sign up and join.

**Other commands:**

```bash
npm run build    # Type-check + production bundle → dist/
npm run preview  # Serve the production bundle locally
```

### Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project at [vercel.com/new](https://vercel.com/new).
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**. The [`vercel.json`](vercel.json) rewrite (`/* → /index.html`) is already configured for SPA routing.

Subsequent pushes to `main` deploy automatically; the [Preview](https://www.grimoire-preview.vercel.app/) environment tracks the `preview` branch.

---

## Note Syntax Reference

The note editor supports custom inline syntax on top of standard markdown. Syntax markers are **hidden when your cursor is on a different line** — move the cursor onto a line to see and edit the raw syntax.

### Markdown (standard)

```markdown
# Heading 1
## Heading 2
### Heading 3

**bold**   *italic*   `inline code`

- Bullet list
1. Ordered list

> Blockquote

| Col A | Col B |
|-------|-------|
| cell  | cell  |
```

### Custom Decorators

| Syntax | Renders as | Use for |
|--------|-----------|---------|
| `&{The Hall of Noon}` | Orange badge | Locations — click to open the matching note |
| `@{Aria Swiftwind}` | Green badge | Player refs — hover for stats, click to open the Character Sheet |
| `?{The heir must be found}` | Red badge | Plot dependencies / conditions |
| `!{The Siege Begins}` | Blue badge | Milestone events |
| `${The Sunblade}` | Pink badge | Artifacts & key items |
| `%%Only I can see this%%` | Gray italic | GM-only inline comments |
| `[[Goblin King]]` | Blue underline | Wiki link to another note |
| `$1d20 + 5$` | Dice chip | Click-to-roll inline formula |

### Secrets

```
{{This text is hidden from players until revealed}}
{{!This text is already revealed to players}}
```

Secrets render as interactive cards. As GM you can click **Reveal / Hide** to toggle player visibility; players only ever see revealed secrets. Secrets can contain markdown formatting (headings, bold, lists).

### Wiki Links

Type `[[` to open autocomplete. Broken links render in gray. Clicking a valid link navigates directly to that note.

---

## Multiplayer & Permissions

### Campaigns and roles

Every user belongs to one or more campaigns. Within each campaign they hold one of:

| Role | Can do |
|---|---|
| **GM** | Everything. Creates the campaign, can delete it, and holds every permission below. |
| **Co-GM** | Everything the GM can, *except* deleting the campaign. Use this when handing temporary control to another player. |
| **Player** | Edits notes they've been granted access to (independent view and edit flags per user), claims and edits their own party character, pings the map, views NPCs (and stat blocks) the GM has revealed, sees the active scene on the Map. |

### Joining a campaign

1. GM creates a campaign → receives a 6-character join code (e.g. `X4K9MR`).
2. Players sign up / sign in, click **Join campaign**, enter the code.
3. Players pick a display name for that campaign and (on first visit) are walked through the Character Builder.

### Note permissions

Permissions are managed per user via the **Share** button in the note header.

- The note's **author** and the campaign **GM / Co-GM** always have full view + edit.
- For every other player you can independently toggle **view** and **edit**. Edit implies view.
- Three quick presets stamp the matrix in one click: **GM only**, **Party view**, **Party edit**.

The sidebar shows a glanceable status icon next to each note:

| Icon | Status |
|------|--------|
| *(none)* | GM only — no player has access |
| 🔵 Blue eye | At least one player can view |
| 🟢 Green eye | At least one player can edit |

The **Save** button must be clicked for body edits to broadcast to other viewers; the sidebar shows an amber dot on notes with unsaved changes.

### Real-time sync

All data syncs in real time via Supabase `postgres_changes` subscriptions. Changes made by the GM (moving a map token, updating a party member's HP, revealing a secret, switching the active scene) appear instantly on every connected player screen — no refresh needed.

---

## Project Structure

```
src/
├── features/
│   ├── chat/          # Campaign chat, mentions, chips, whispers
│   ├── dashboard/     # Landing page + Character Sheet + Character Builder + Level-Up modal
│   ├── dice/          # Dice roller + draggable Quick Dice
│   ├── homebrew/      # Custom monsters, items, spells
│   ├── initiative/    # Combat tracker (synced with HP / conditions)
│   ├── items/         # SRD + homebrew item browser
│   ├── map/           # Scenes, image layers, tokens, shapes, ping, presence
│   │   ├── MapBoard.tsx        # Canvas + sidebar + Edit tool
│   │   └── mapStore.ts         # Scenes / layers / tokens stores + realtime
│   ├── notes/         # Live editor, folders, wiki, decorators, share popover
│   │   ├── LiveEditor.tsx
│   │   ├── SharePopover.tsx
│   │   ├── decorators.ts
│   │   ├── notesStore.ts
│   │   └── wikiIndex.ts
│   ├── npcs/          # NPC tracker + stat blocks + permissions
│   ├── party/         # Roster, claim flow, HP / condition sync
│   ├── profiles/      # Per-user profile (display name, avatar)
│   ├── rules/         # SRD 5.1 + 2024 rules browser
│   ├── session/       # Auth, campaigns, join flow, role gating
│   ├── settings/      # Account, export campaign, app preferences
│   ├── spells/        # SRD + homebrew spell browser + popover
│   ├── statblocks/    # Reusable creature stat block library
│   ├── transcription/ # Web Speech API session journal
│   ├── hpBar.ts       # Shared HP-bar colour math
│   └── hpLink.ts      # Cross-surface HP / condition sync helper
├── hooks/
│   └── useVisibilityReload.ts  # Re-fetch on tab focus
├── lib/
│   └── supabase.ts             # Supabase client singleton
├── data/                       # SRD 5.1 + 2024 JSON (spells, items, monsters, rules)
└── index.css                   # Global styles + markdown + decorator classes
supabase/
├── schema.sql                  # Full canonical schema with RLS + realtime
└── migrations/                 # Incremental schema changes
```
