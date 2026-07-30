-- =============================================
-- Security hardening — close anon-reachable surfaces.
-- =============================================
-- Addresses four findings from the Supabase database linter. None of these
-- change app behaviour: every policy expression below already evaluated to
-- false for unauthenticated callers (auth.uid() is null), so this is
-- defence-in-depth that stops anon from even reaching the check.

-- ── 1. Policies granted to PUBLIC (which includes anon) ──────────────────────
-- These ten were created without a TO clause, so they defaulted to PUBLIC.
-- Everything they protect is campaign-member data; pin them to authenticated.
alter policy "GM write settings"                on campaign_settings    to authenticated;
alter policy "Members read settings"            on campaign_settings    to authenticated;
alter policy "GMs can insert initiative entries" on initiative_entries  to authenticated;
alter policy "GMs can update initiative entries" on initiative_entries  to authenticated;
alter policy "GMs can delete initiative entries" on initiative_entries  to authenticated;
alter policy "Members can view initiative"       on initiative_entries  to authenticated;
alter policy "GMs can insert NPCs"               on npcs                to authenticated;
alter policy "GMs can update NPCs"               on npcs                to authenticated;
alter policy "GMs can delete NPCs"               on npcs                to authenticated;
alter policy "Members can view visible NPCs"     on npcs                to authenticated;

-- ── 2. SECURITY DEFINER functions exposed on /rest/v1/rpc ───────────────────
-- Postgres grants EXECUTE to PUBLIC by default, which published every RLS
-- helper as an anon-callable RPC endpoint (a free membership oracle) and, worse,
-- exposed transfer_note_ownership — a function that MUTATES data.
--
-- authenticated must keep EXECUTE: RLS policy expressions are evaluated as the
-- querying role, so revoking it there would break every policy that calls
-- is_member()/is_gm(). transfer_note_ownership is called by the app via
-- supabase.rpc() as an authenticated user, so it keeps its grant too.
do $$
declare
  fn text;
  fns text[] := array[
    'public.is_gm(uuid)',
    'public.is_member(uuid)',
    'public.is_spectator(uuid)',
    'public.note_author(uuid)',
    'public.note_campaign(uuid)',
    'public.npc_campaign(uuid)',
    'public.shares_campaign_with(uuid)',
    'public.transfer_note_ownership(uuid, uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- ── 3. Public storage buckets allowed listing ───────────────────────────────
-- Both SELECT policies were PUBLIC + unscoped, so an unauthenticated client
-- could enumerate every file in each bucket. note-images is the sharper edge:
-- it let anyone list every campaign's uploaded handouts.
--
-- Objects stay reachable by URL (both buckets are public, and public-bucket
-- reads bypass RLS), and the app only ever calls getPublicUrl / remove — never
-- .list() — so nothing in the client depends on these policies.
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- Mirror the campaign scoping the matching delete policy already uses.
drop policy if exists note_images_select on storage.objects;
create policy note_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and is_member(((storage.foldername(name))[1])::uuid)
  );

-- ── 4. Mutable search_path on the shared trigger ────────────────────────────
-- Pin it so a schema earlier in the caller's search_path can't shadow now().
-- The body only touches NEW and now(); pg_catalog is always implicitly
-- searched, so an empty search_path resolves it fine.
alter function public.touch_updated_at() set search_path = '';
