-- Relevé — réglages par utilisateur (phase 8).
--
-- Contrairement à `events` (append-only, le journal), `settings` CONFIGURE
-- l'outil : comptes et règles prop firm, watchlist, préférences. C'est
-- l'équivalent de data/settings.json de la version Streamlit — mutable, une
-- ligne par utilisateur, remplaçable en deux minutes (pas un actif irremplaçable).
--
-- On n'y suppose AUCUN compte (décision [U]) : la ligne n'existe que si
-- l'utilisateur a configuré son challenge.

create table if not exists public.settings (
  user_id    uuid primary key default auth.uid()
             references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,   -- { accounts: [...], active_uid }
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

-- Chacun ne lit/écrit QUE sa propre ligne. Ici l'écriture inclut UPDATE
-- (les réglages, eux, se modifient — le journal, non).
drop policy if exists "read own settings" on public.settings;
create policy "read own settings"
  on public.settings for select using (auth.uid() = user_id);

drop policy if exists "insert own settings" on public.settings;
create policy "insert own settings"
  on public.settings for insert with check (auth.uid() = user_id);

drop policy if exists "update own settings" on public.settings;
create policy "update own settings"
  on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
