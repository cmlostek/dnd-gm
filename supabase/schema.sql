-- =============================================
-- D&D GM Screen — Campaign Collaboration Schema
-- =============================================
-- Run each numbered section SEPARATELY in the Supabase SQL Editor.
-- (Select the section, press Run. Then move to the next one.)
-- Safe to re-run each section.
-- =============================================
-- IMPORTANT: When adding a new migration, also update this file so that
-- new installs never need to run migrations manually.
-- =============================================


-- =============================================
-- SECTION 1 — Tables
-- =============================================

create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists campaign_members (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  user_id       uuid not null default auth.uid(),
  display_name  text not null,
  role          text not null check (role in ('gm','cogm','player')),
  color         text not null default '#94a3b8',
  bio           text not null default '',
  joined_at     timestamptz not null default now(),
  unique (campaign_id, user_id)
);
-- Older installs predating chat: add the color column if missing.
alter table campaign_members
  add column if not exists color text not null default '#94a3b8';
-- Older installs predating the player dashboard: add bio if missing.
alter table campaign_members
  add column if not exists bio text not null default '';
create index if not exists campaign_members_by_campaign on campaign_members(campaign_id);

create table if not exists notes (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  title              text not null default 'Untitled',
  body               text not null default '',
  ydoc_state         text,
  visible_to_players boolean not null default false,
  player_editable    boolean not null default false,
  owner_user_id      uuid,
  created_by         uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists notes_campaign_idx on notes(campaign_id);

create table if not exists party_members (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  owner_user_id uuid,
  name          text not null,
  class         text,
  race          text,
  level         int not null default 1,
  hp_current    int not null default 0,
  hp_max        int not null default 0,
  ac            int not null default 10,
  notes         text,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists party_members_campaign_idx on party_members(campaign_id);

create table if not exists map_state (
  campaign_id         uuid primary key references campaigns(id) on delete cascade,
  background_url      text,
  grid_size           int not null default 50,
  width               int not null default 1000,
  height              int not null default 1000,
  data                jsonb not null default '{}'::jsonb,
  active_scene_id     uuid,
  gm_preview_scene_id uuid,
  updated_at          timestamptz not null default now()
);

-- One campaign has many scenes; each scene owns its grid, shapes, and a
-- list of free-positioned image layers (data.layers). map_state points at
-- the active scene everyone sees; gm_preview_scene_id is an optional
-- GM-only override so the GM can stage a different scene in private.
create table if not exists map_scenes (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  name         text not null default 'Scene',
  order_idx    int not null default 0,
  grid_size    int not null default 50,
  show_grid    boolean not null default true,
  width        int not null default 2000,
  height       int not null default 1500,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists map_scenes_campaign_idx on map_scenes(campaign_id);

create table if not exists map_tokens (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references campaigns(id) on delete cascade,
  scene_id            uuid references map_scenes(id) on delete cascade,
  owner_user_id       uuid,
  label               text not null,
  color               text not null default '#f87171',
  x                   double precision not null default 0,
  y                   double precision not null default 0,
  hidden_from_players boolean not null default false,
  size                int not null default 1,
  data                jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);
create index if not exists map_tokens_campaign_idx on map_tokens(campaign_id);
create index if not exists map_tokens_scene_idx on map_tokens(scene_id);

-- Deferred FKs from map_state -> map_scenes so map_state can be created
-- first in the canonical schema. They're added once both tables exist.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_state_active_scene_fk') then
    alter table map_state add constraint map_state_active_scene_fk
      foreign key (active_scene_id) references map_scenes(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'map_state_preview_scene_fk') then
    alter table map_state add constraint map_state_preview_scene_fk
      foreign key (gm_preview_scene_id) references map_scenes(id) on delete set null;
  end if;
end $$;

create table if not exists homebrew (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  kind               text not null,
  name               text not null,
  visible_to_players boolean not null default false,
  data               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists homebrew_campaign_idx on homebrew(campaign_id);

create table if not exists shops (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  name               text not null default 'New Shop',
  description        text not null default '',
  visible_to_players boolean not null default false,
  items              jsonb not null default '[]',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists shops_campaign_idx on shops(campaign_id);

create table if not exists stat_blocks (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  name         text not null,
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists stat_blocks_campaign_idx on stat_blocks(campaign_id);

create table if not exists transcripts (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  note_id      uuid references notes(id) on delete set null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  body         text not null default ''
);
create index if not exists transcripts_campaign_idx on transcripts(campaign_id);

create table if not exists initiative_entries (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  name         text not null default '',
  initiative   int not null default 0,
  hp           int not null default 0,
  max_hp       int not null default 0,
  ac           int not null default 10,
  is_pc        boolean not null default false,
  conditions   jsonb not null default '[]',
  turn_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists initiative_entries_campaign_idx on initiative_entries(campaign_id);

create table if not exists npcs (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  name               text not null default 'New NPC',
  faction            text not null default '',
  faction_color      text not null default '#475569',
  location           text not null default '',
  status             text not null default 'unknown',
  notes              text not null default '',
  visible_to_players boolean not null default false,
  icon               text not null default 'user',
  linked_note_id     uuid references notes(id) on delete set null,
  stat_block         jsonb not null default '{}'::jsonb,
  stat_block_visible boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists npcs_campaign_idx on npcs(campaign_id);

create table if not exists note_permissions (
  note_id   uuid not null references notes(id) on delete cascade,
  user_id   uuid not null,
  can_view  boolean not null default false,
  can_edit  boolean not null default false,
  primary key (note_id, user_id)
);
create index if not exists note_permissions_user_idx on note_permissions(user_id);

-- Per-user drag-to-reorder in the notes sidebar. See
-- migrations/20260713010000_note_sort_order.sql for the full writeup.
create table if not exists note_sort_order (
  user_id uuid not null,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  folder_key text not null,        -- a folder's id, or 'root'
  order_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, campaign_id, folder_key)
);


-- =============================================
-- SECTION 2 — Helper functions
-- =============================================

create or replace function public.is_member(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1 from campaign_members
    where campaign_id = p_campaign and user_id = auth.uid()
  );
$func$;

create or replace function public.is_gm(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1 from campaign_members
    where campaign_id = p_campaign and user_id = auth.uid() and role in ('gm','cogm')
  );
$func$;

create or replace function public.note_campaign(p_note uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $func$
  select campaign_id from notes where id = p_note;
$func$;

-- SECURITY DEFINER so note_permissions policies never read `notes` directly,
-- which would cause infinite RLS recursion between notes and note_permissions.
create or replace function public.note_author(p_note uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $func$
  select owner_user_id from notes where id = p_note;
$func$;

-- Notes: transfer ownership between players. Deliberately a dedicated RPC
-- rather than a looser notes_update RLS policy — see
-- migrations/20260713000000_transfer_note_ownership.sql for the full
-- writeup on why the policy's `with check` can't safely allow this itself.
create or replace function public.transfer_note_ownership(p_note_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_campaign_id uuid;
  v_owner_user_id uuid;
begin
  select campaign_id, owner_user_id into v_campaign_id, v_owner_user_id
  from notes where id = p_note_id;

  if v_campaign_id is null then
    raise exception 'note not found';
  end if;

  if not (public.is_gm(v_campaign_id) or v_owner_user_id = auth.uid()) then
    raise exception 'not authorized to transfer this note';
  end if;

  if not exists (
    select 1 from campaign_members
    where campaign_id = v_campaign_id and user_id = p_new_owner
  ) then
    raise exception 'new owner is not a member of this campaign';
  end if;

  update notes set owner_user_id = p_new_owner, updated_at = now()
  where id = p_note_id;
end;
$func$;

grant execute on function public.transfer_note_ownership(uuid, uuid) to authenticated;

-- Campaign spectator access — read-only cross-campaign browsing. A user can
-- spectate a campaign they aren't a member of as long as they share at
-- least one campaign with someone who IS a member of it. See
-- migrations/20260712000000_campaign_spectator.sql for the full writeup.
create or replace function public.shares_campaign_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1 from campaign_members mine
    join campaign_members theirs on theirs.campaign_id = mine.campaign_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$func$;

create or replace function public.is_spectator(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1 from campaign_members target
    where target.campaign_id = p_campaign
      and public.shares_campaign_with(target.user_id)
  );
$func$;


-- =============================================
-- SECTION 3 — Enable RLS
-- =============================================

alter table campaigns          enable row level security;
alter table campaign_members   enable row level security;
alter table notes              enable row level security;
alter table party_members      enable row level security;
alter table map_state          enable row level security;
alter table map_scenes         enable row level security;
alter table map_tokens         enable row level security;
alter table homebrew           enable row level security;
alter table shops              enable row level security;
alter table stat_blocks        enable row level security;
alter table transcripts        enable row level security;
alter table initiative_entries enable row level security;
alter table npcs               enable row level security;
alter table note_permissions   enable row level security;
alter table note_sort_order    enable row level security;


-- =============================================
-- SECTION 4 — Policies: campaigns + campaign_members
-- =============================================

drop policy if exists campaigns_select on campaigns;
create policy campaigns_select on campaigns for select to authenticated using (true);

drop policy if exists campaigns_insert on campaigns;
create policy campaigns_insert on campaigns for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists campaigns_update on campaigns;
create policy campaigns_update on campaigns for update to authenticated using (is_gm(id)) with check (is_gm(id));

drop policy if exists campaigns_delete on campaigns;
-- Delete is restricted to the primary GM — co-GMs can run the campaign but
-- only the original GM can drop it.
create policy campaigns_delete on campaigns for delete to authenticated using (
  exists (
    select 1 from campaign_members
    where campaign_id = id and user_id = auth.uid() and role = 'gm'
  )
);

drop policy if exists members_select on campaign_members;
create policy members_select on campaign_members for select to authenticated
  using (is_member(campaign_id) or shares_campaign_with(user_id));

drop policy if exists members_insert on campaign_members;
create policy members_insert on campaign_members for insert to authenticated with check (user_id = auth.uid());

drop policy if exists members_update on campaign_members;
create policy members_update on campaign_members for update to authenticated using (user_id = auth.uid() or is_gm(campaign_id));

drop policy if exists members_delete on campaign_members;
create policy members_delete on campaign_members for delete to authenticated using (user_id = auth.uid() or is_gm(campaign_id));


-- =============================================
-- SECTION 5 — Policies: notes + note_permissions + party_members
-- =============================================

drop policy if exists notes_select on notes;
create policy notes_select on notes for select to authenticated
  using (
    is_gm(campaign_id)
    or (is_member(campaign_id) and owner_user_id = auth.uid())
    or (is_member(campaign_id) and visible_to_players)
    or (is_spectator(campaign_id) and visible_to_players)
    or exists (
      select 1 from note_permissions p
      where p.note_id = notes.id and p.user_id = auth.uid() and p.can_view
    )
  );

drop policy if exists notes_insert on notes;
create policy notes_insert on notes for insert to authenticated
  with check (is_gm(campaign_id) or (is_member(campaign_id) and owner_user_id = auth.uid()));

drop policy if exists notes_update on notes;
create policy notes_update on notes for update to authenticated
  using (
    is_gm(campaign_id)
    or (is_member(campaign_id) and owner_user_id = auth.uid())
    or (is_member(campaign_id) and visible_to_players and coalesce(player_editable, false))
    or exists (
      select 1 from note_permissions p
      where p.note_id = notes.id and p.user_id = auth.uid() and p.can_edit
    )
  )
  with check (
    is_gm(campaign_id)
    or (is_member(campaign_id) and owner_user_id = auth.uid())
    or (is_member(campaign_id) and visible_to_players and coalesce(player_editable, false))
    or exists (
      select 1 from note_permissions p
      where p.note_id = notes.id and p.user_id = auth.uid() and p.can_edit
    )
  );

drop policy if exists notes_delete on notes;
create policy notes_delete on notes for delete to authenticated
  using (is_gm(campaign_id) or (is_member(campaign_id) and owner_user_id = auth.uid()));

drop policy if exists note_permissions_select on note_permissions;
create policy note_permissions_select on note_permissions for select to authenticated
  using (
    user_id = auth.uid()
    or is_gm(note_campaign(note_id))
    or note_author(note_id) = auth.uid()
  );

drop policy if exists note_permissions_write on note_permissions;
create policy note_permissions_write on note_permissions for all to authenticated
  using (
    is_gm(note_campaign(note_id))
    or note_author(note_id) = auth.uid()
  )
  with check (
    is_gm(note_campaign(note_id))
    or note_author(note_id) = auth.uid()
  );

drop policy if exists note_sort_order_all on note_sort_order;
create policy note_sort_order_all on note_sort_order for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists party_select on party_members;
create policy party_select on party_members for select to authenticated
  using (is_member(campaign_id) or is_spectator(campaign_id));

drop policy if exists party_insert on party_members;
create policy party_insert on party_members for insert to authenticated with check (is_gm(campaign_id));

drop policy if exists party_update on party_members;
create policy party_update on party_members for update to authenticated
  using  (is_gm(campaign_id) or (is_member(campaign_id) and (owner_user_id is null or owner_user_id = auth.uid())))
  with check (is_gm(campaign_id) or (is_member(campaign_id) and (owner_user_id is null or owner_user_id = auth.uid())));

drop policy if exists party_delete on party_members;
create policy party_delete on party_members for delete to authenticated using (is_gm(campaign_id));


-- =============================================
-- SECTION 6 — Policies: map + homebrew + shops + stat_blocks + transcripts + initiative + npcs
-- =============================================

drop policy if exists map_state_select on map_state;
create policy map_state_select on map_state for select to authenticated using (is_member(campaign_id));

drop policy if exists map_state_all on map_state;
create policy map_state_all on map_state for all to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists map_scenes_select on map_scenes;
create policy map_scenes_select on map_scenes for select to authenticated using (is_member(campaign_id));

drop policy if exists map_scenes_all on map_scenes;
create policy map_scenes_all on map_scenes for all to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists map_tokens_select on map_tokens;
create policy map_tokens_select on map_tokens for select to authenticated using (is_gm(campaign_id) or (is_member(campaign_id) and not hidden_from_players));

drop policy if exists map_tokens_insert on map_tokens;
create policy map_tokens_insert on map_tokens for insert to authenticated with check (is_gm(campaign_id));

drop policy if exists map_tokens_update on map_tokens;
create policy map_tokens_update on map_tokens for update to authenticated using (is_gm(campaign_id) or (is_member(campaign_id) and owner_user_id = auth.uid() and not hidden_from_players)) with check (is_gm(campaign_id) or (is_member(campaign_id) and owner_user_id = auth.uid() and not hidden_from_players));

drop policy if exists map_tokens_delete on map_tokens;
create policy map_tokens_delete on map_tokens for delete to authenticated using (is_gm(campaign_id));

drop policy if exists homebrew_select on homebrew;
create policy homebrew_select on homebrew for select to authenticated using (is_gm(campaign_id) or (is_member(campaign_id) and visible_to_players));

drop policy if exists homebrew_write on homebrew;
create policy homebrew_write on homebrew for all to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists shops_gm on shops;
create policy shops_gm on shops for all to authenticated
  using (is_gm(campaign_id))
  with check (is_gm(campaign_id));

drop policy if exists shops_players on shops;
create policy shops_players on shops for select to authenticated
  using (is_member(campaign_id) and visible_to_players = true);

drop policy if exists statblocks_all on stat_blocks;
create policy statblocks_all on stat_blocks for all to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists transcripts_all on transcripts;
create policy transcripts_all on transcripts for all to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists initiative_select on initiative_entries;
create policy initiative_select on initiative_entries for select to authenticated using (is_member(campaign_id));

drop policy if exists initiative_insert on initiative_entries;
create policy initiative_insert on initiative_entries for insert to authenticated with check (is_gm(campaign_id));

drop policy if exists initiative_update on initiative_entries;
create policy initiative_update on initiative_entries for update to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists initiative_delete on initiative_entries;
create policy initiative_delete on initiative_entries for delete to authenticated using (is_gm(campaign_id));

drop policy if exists npcs_select on npcs;
create policy npcs_select on npcs for select to authenticated
  using (
    is_gm(campaign_id)
    or (is_member(campaign_id) and visible_to_players = true)
    or (is_spectator(campaign_id) and visible_to_players = true)
  );

drop policy if exists npcs_insert on npcs;
create policy npcs_insert on npcs for insert to authenticated with check (is_gm(campaign_id));

drop policy if exists npcs_update on npcs;
create policy npcs_update on npcs for update to authenticated using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop policy if exists npcs_delete on npcs;
create policy npcs_delete on npcs for delete to authenticated using (is_gm(campaign_id));


-- =============================================
-- SECTION 7 — updated_at trigger (OPTIONAL — skip if it errors)
-- =============================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at = now();
  return new;
end;
$func$;

drop trigger if exists campaigns_touch     on campaigns;
create trigger campaigns_touch     before update on campaigns     for each row execute function touch_updated_at();

drop trigger if exists notes_touch         on notes;
create trigger notes_touch         before update on notes         for each row execute function touch_updated_at();

drop trigger if exists party_members_touch on party_members;
create trigger party_members_touch before update on party_members for each row execute function touch_updated_at();

drop trigger if exists map_state_touch     on map_state;
create trigger map_state_touch     before update on map_state     for each row execute function touch_updated_at();

drop trigger if exists map_scenes_touch    on map_scenes;
create trigger map_scenes_touch    before update on map_scenes    for each row execute function touch_updated_at();

drop trigger if exists map_tokens_touch    on map_tokens;
create trigger map_tokens_touch    before update on map_tokens    for each row execute function touch_updated_at();

drop trigger if exists homebrew_touch      on homebrew;
create trigger homebrew_touch      before update on homebrew      for each row execute function touch_updated_at();

drop trigger if exists shops_touch         on shops;
create trigger shops_touch         before update on shops         for each row execute function touch_updated_at();

drop trigger if exists stat_blocks_touch   on stat_blocks;
create trigger stat_blocks_touch   before update on stat_blocks   for each row execute function touch_updated_at();


-- =============================================
-- SECTION 7b — note_folders (hierarchical folder tree per campaign)
-- Run this section once.
-- =============================================

create table if not exists note_folders (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  parent_id    uuid references note_folders(id) on delete cascade,
  name         text not null default 'New Folder',
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists note_folders_campaign_idx on note_folders(campaign_id);
create index if not exists note_folders_parent_idx on note_folders(parent_id);

alter table note_folders enable row level security;

drop policy if exists note_folders_select on note_folders;
create policy note_folders_select on note_folders for select to authenticated using (is_member(campaign_id));

drop policy if exists note_folders_write on note_folders;
drop policy if exists note_folders_insert on note_folders;
drop policy if exists note_folders_update on note_folders;
drop policy if exists note_folders_delete on note_folders;
create policy note_folders_insert on note_folders for insert to authenticated
  with check (is_member(campaign_id));
create policy note_folders_update on note_folders for update to authenticated
  using (is_gm(campaign_id)) with check (is_gm(campaign_id));
create policy note_folders_delete on note_folders for delete to authenticated
  using (is_gm(campaign_id));

drop trigger if exists note_folders_touch on note_folders;
create trigger note_folders_touch before update on note_folders for each row execute function touch_updated_at();

alter table notes add column if not exists folder_id uuid references note_folders(id) on delete set null;
create index if not exists notes_folder_idx on notes(folder_id);


-- =============================================
-- SECTION 8 — Realtime publication (OPTIONAL)
-- Ignore "relation is already member of publication" errors — that just means
-- that table is already subscribed.
-- =============================================

alter publication supabase_realtime add table campaigns;
alter publication supabase_realtime add table campaign_members;
alter publication supabase_realtime add table notes;
alter publication supabase_realtime add table party_members;
alter publication supabase_realtime add table map_state;
alter publication supabase_realtime add table map_scenes;
alter publication supabase_realtime add table map_tokens;
alter publication supabase_realtime add table homebrew;
alter publication supabase_realtime add table shops;
alter publication supabase_realtime add table stat_blocks;
alter publication supabase_realtime add table transcripts;
alter publication supabase_realtime add table note_folders;
alter publication supabase_realtime add table initiative_entries;
alter publication supabase_realtime add table npcs;
alter publication supabase_realtime add table note_permissions;


-- =============================================
-- SECTION 9 — Yjs collaborative editing state
-- =============================================
-- Stores the Yjs document vector-clock state per note so all clients can
-- start from a consistent CRDT baseline (no duplicate-content on cold join).

alter table notes add column if not exists ydoc_state text;


-- =============================================
-- SECTION 9c — User profiles + avatars storage bucket (global per user)
-- =============================================

create table if not exists user_profiles (
  user_id     uuid primary key,
  avatar_path text,
  updated_at  timestamptz not null default now()
);

alter table user_profiles enable row level security;

drop policy if exists user_profiles_select on user_profiles;
create policy user_profiles_select on user_profiles for select to authenticated using (true);

drop policy if exists user_profiles_insert on user_profiles;
create policy user_profiles_insert on user_profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_profiles_update on user_profiles;
create policy user_profiles_update on user_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_profiles_delete on user_profiles;
create policy user_profiles_delete on user_profiles for delete to authenticated
  using (user_id = auth.uid());

alter publication supabase_realtime add table user_profiles;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Note images: permanent hosting for images embedded in notes (replaces
-- pasting expiring external URLs). See
-- migrations/20260721000000_note_images_bucket.sql. Uploads are scoped to a
-- campaign the user belongs to (first path segment = campaign_id); read is
-- public because images are embedded via <img src> and viewed by
-- players/spectators (random-UUID paths keep them unguessable).
insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', true)
on conflict (id) do nothing;

drop policy if exists note_images_insert on storage.objects;
create policy note_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists note_images_delete on storage.objects;
create policy note_images_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'note-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists note_images_select on storage.objects;
create policy note_images_select on storage.objects for select to public
  using (bucket_id = 'note-images');


-- =============================================
-- SECTION 10 — Chat messages (party chat, whispers, mentions, edit/delete)
-- =============================================

create table if not exists chat_messages (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  sender_id    uuid not null default auth.uid(),
  body         text not null,
  mentions     uuid[] not null default '{}',
  whisper_to   uuid[],
  edited_at    timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists chat_messages_campaign_created_idx
  on chat_messages (campaign_id, created_at desc);

create index if not exists chat_messages_whisper_to_idx
  on chat_messages using gin (whisper_to);

alter table chat_messages enable row level security;

drop policy if exists chat_messages_select on chat_messages;
create policy chat_messages_select on chat_messages for select to authenticated
  using (
    is_member(campaign_id)
    and (
      whisper_to is null
      or sender_id = auth.uid()
      or auth.uid() = any(whisper_to)
      or is_gm(campaign_id)
    )
  );

drop policy if exists chat_messages_insert on chat_messages;
create policy chat_messages_insert on chat_messages for insert to authenticated
  with check (is_member(campaign_id) and sender_id = auth.uid());

drop policy if exists chat_messages_update on chat_messages;
create policy chat_messages_update on chat_messages for update to authenticated
  using (sender_id = auth.uid() or is_gm(campaign_id))
  with check (sender_id = auth.uid() or is_gm(campaign_id));

drop policy if exists chat_messages_delete on chat_messages;
create policy chat_messages_delete on chat_messages for delete to authenticated
  using (is_gm(campaign_id));

alter publication supabase_realtime add table chat_messages;
