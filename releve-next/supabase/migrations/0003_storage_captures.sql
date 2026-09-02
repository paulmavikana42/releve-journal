-- Relevé — stockage des captures (phase 8).
--
-- Les images vivent dans un bucket privé `captures`, chemin
-- `<user_id>/<attachment_id>.<ext>`. Le journal (events) ne stocke que le
-- chemin (décision [P]) ; l'accès se fait par URL signée générée côté serveur.
-- RLS : chacun ne lit/écrit QUE son propre dossier (1er segment = son uid).

insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

drop policy if exists "captures read own" on storage.objects;
create policy "captures read own" on storage.objects for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "captures insert own" on storage.objects;
create policy "captures insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "captures update own" on storage.objects;
create policy "captures update own" on storage.objects for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "captures delete own" on storage.objects;
create policy "captures delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
