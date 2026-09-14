-- 041_avatars_storage.sql
--
-- Public "avatars" storage bucket so users can upload a profile photo or
-- pick a generated cartoon/comic avatar from the Profile page.
--
-- Convention: object path = "{user_id}/{filename}" — RLS below restricts
-- writes to the owner's own folder while keeping reads public (avatars are
-- shown in the sidebar, org member lists, social feed, etc.)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
-- Anyone can view avatars (bucket is public, but explicit policy for clarity)
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');
-- Users can upload only into their own folder ("{user_id}/...")
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Users can update/replace their own avatar
create policy "Users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Users can delete their own avatar
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
