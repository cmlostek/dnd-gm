-- =============================================
-- REPLICA IDENTITY FULL — remaining realtime tables.
-- =============================================
-- Completes 20260716020000_replica_identity_full.sql, which covered only the
-- map/initiative/party/ritual tables. Every other table in the
-- supabase_realtime publication was still on the default replica identity,
-- which ships only the primary key in a DELETE's `old` record. Supabase
-- Realtime evaluates the subscription's `campaign_id=eq.…` filter and the RLS
-- policy against that record, so with campaign_id missing the DELETE event is
-- withheld from every client except the one that issued it (which removes
-- optimistically).
--
-- Symptom: deleting a note, NPC, chat message, folder, or homebrew entry stayed
-- visible to everyone else until they reloaded the page.
--
-- FULL ships the whole old row so the filter + RLS pass and deletes propagate
-- live. These are low-volume tables (notes are written on explicit save, not
-- per keystroke), so the extra WAL is negligible at campaign scale.

alter table campaign_members  replica identity full;
alter table campaigns         replica identity full;
alter table chat_messages     replica identity full;
alter table homebrew          replica identity full;
alter table initiative_state  replica identity full;
alter table map_state         replica identity full;
alter table note_folders      replica identity full;
alter table note_permissions  replica identity full;
alter table notes             replica identity full;
alter table npc_permissions   replica identity full;
alter table npcs              replica identity full;
alter table stat_blocks       replica identity full;
alter table transcripts       replica identity full;
alter table user_profiles     replica identity full;
