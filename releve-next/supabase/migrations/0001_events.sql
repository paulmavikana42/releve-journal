-- Relevé — schéma de la couche données (phase 6).
--
-- UNE table append-only `events`, miroir exact du journal JSONL (une ligne = un
-- événement). L'état courant se reconstruit en REJOUANT les événements (voir
-- packages/core/src/store.ts) — jamais de tables relationnelles par type d'objet,
-- jamais de mise à jour en place. C'est ce qui garantit que le journal reste
-- l'unique actif irremplaçable, lisible et rejouable, exactement comme le fichier.
--
-- Isolation : la frontière RLS est l'UTILISATEUR (auth.users). Un utilisateur
-- possède un journal, éventuellement plusieurs comptes prop firm — ce
-- cloisonnement-là (par uid interne de compte) vit DANS le payload et est
-- appliqué au rejeu par scopeToAccount(). Ici, on isole les personnes.

create table if not exists public.events (
  id         bigint generated always as identity primary key,  -- ordre de rejeu
  user_id    uuid not null default auth.uid()
             references auth.users (id) on delete cascade,
  v          integer not null,                                  -- version de schéma
  ts         timestamptz not null,                              -- horodatage logique de l'événement
  type       text not null,                                     -- ex. thesis_created, position_imported…
  payload    jsonb not null,                                    -- corps encodé ($dec / $dt)
  demo       boolean not null default false,                    -- fabriqué pour la démonstration
  inserted_at timestamptz not null default now()                -- horodatage serveur d'insertion
);

-- Rejeu et filtrage par utilisateur, dans l'ordre d'insertion.
create index if not exists events_user_id_idx on public.events (user_id, id);

alter table public.events enable row level security;

-- Lecture : chacun ne voit QUE ses propres événements.
drop policy if exists "read own events" on public.events;
create policy "read own events"
  on public.events for select
  using (auth.uid() = user_id);

-- Écriture : chacun n'insère que pour lui-même (user_id forcé à auth.uid()).
drop policy if exists "insert own events" on public.events;
create policy "insert own events"
  on public.events for insert
  with check (auth.uid() = user_id);

-- APPEND-ONLY : aucune policy UPDATE ni DELETE. Sous RLS, l'absence de policy
-- vaut refus — personne (hormis la service_role, qui contourne la RLS) ne peut
-- réécrire ni supprimer un événement. La promesse centrale du format tient,
-- côté serveur comme côté fichier.
