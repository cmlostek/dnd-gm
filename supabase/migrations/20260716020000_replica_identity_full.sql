-- =============================================
-- REPLICA IDENTITY FULL for realtime-deleted tables.
-- =============================================
-- Postgres logical replication defaults to sending only the primary key in the
-- `old` record of a DELETE. Supabase Realtime evaluates the subscription's
-- `campaign_id=eq.…` filter and the RLS policy against that record — with only
-- the PK present, campaign_id is missing, so DELETE events are withheld from
-- every client except the one that issued the write (which removes optimistically).
--
-- Result: a deleted map token / dismissed ritual / removed combatant stayed
-- visible to other players until they reloaded (e.g. by swapping map scenes).
--
-- REPLICA IDENTITY FULL ships the entire old row, so the filter + RLS can pass
-- and deletes propagate live. These tables are low-volume, so the extra WAL is
-- negligible.

alter table map_tokens          replica identity full;
alter table map_scenes          replica identity full;
alter table initiative_entries  replica identity full;
alter table ritual_countdowns   replica identity full;
alter table party_members       replica identity full;
