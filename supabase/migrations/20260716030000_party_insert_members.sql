-- =============================================
-- Let players create characters.
-- =============================================
-- The party_insert policy only allowed is_gm, so a player's "Build character"
-- insert was rejected by RLS — the builder closed with nothing added. Allow any
-- campaign member to insert, but only an unowned or self-owned row (the builder
-- inserts unowned, then claims it). GMs keep full latitude.

drop policy if exists party_insert on party_members;
create policy party_insert on party_members
  for insert to authenticated
  with check (
    is_gm(campaign_id)
    or (is_member(campaign_id) and (owner_user_id is null or owner_user_id = auth.uid()))
  );
