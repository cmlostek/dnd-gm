-- =============================================
-- Saved encounters (GM prep).
-- =============================================
-- A built encounter is a named list of creatures with counts, drawn from SRD
-- monsters, homebrew stat blocks, or campaign NPCs. Difficulty is derived at
-- read time from the party's current levels, so a saved encounter re-rates
-- itself as the party levels up rather than going stale.
--
-- data shape:
--   { "creatures": [
--       { "sourceKind": "srd-monster" | "statblock" | "npc",
--         "sourceId": "goblin", "name": "Goblin",
--         "cr": "1/4", "xp": 50, "count": 4 } ],
--     "notes": "ambush at the bridge" }
--
-- GM-only throughout: this is prep material, and listing it would spoil what's
-- coming for the players.

create table if not exists encounters (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  name         text not null default 'New encounter',
  data         jsonb not null default '{"creatures":[]}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists encounters_campaign_idx on encounters(campaign_id);

alter table encounters enable row level security;

drop policy if exists encounters_all on encounters;
create policy encounters_all on encounters
  for all to authenticated
  using (is_gm(campaign_id)) with check (is_gm(campaign_id));

drop trigger if exists encounters_touch on encounters;
create trigger encounters_touch before update on encounters
  for each row execute function touch_updated_at();

-- FULL so deletes propagate to other GM clients (see 20260716020000).
alter table encounters replica identity full;
alter publication supabase_realtime add table encounters;
