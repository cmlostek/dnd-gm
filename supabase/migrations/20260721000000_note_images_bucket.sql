-- =============================================
-- Note images: permanent Supabase-hosted image uploads for notes.
-- =============================================
-- Replaces the practice of pasting external image URLs into notes, which
-- broke silently when those URLs expired (e.g. Discord CDN links are
-- time-limited signed URLs). A prior version of this bucket was removed in
-- bf0ab43; this recreates it with a tighter, campaign-scoped insert policy.
--
-- Uploads go to `{campaign_id}/{uuid}.{ext}`, so the first path segment
-- identifies the campaign and the insert/delete policies require the user to
-- be a member of it. Read is PUBLIC: images are embedded via <img src> and
-- must load for players/spectators without auth — a restricted bucket would
-- force signed URLs, which themselves expire, defeating the purpose. Random
-- UUID paths keep objects unguessable (same tradeoff as the avatars bucket).

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
