-- ============================================================
-- TUSMATCH — Mise en place complète du classement par saisons
--
-- COMMENT L'EXÉCUTER :
-- 1. Dans Supabase, clique sur "SQL Editor" dans le menu de gauche
--    (juste en dessous de "Table Editor", là où tu es actuellement).
-- 2. Colle TOUT ce fichier dans l'éditeur.
-- 3. Clique sur "Run" (ou Ctrl/Cmd + Entrée).
-- 4. C'est tout. Un seul script, à exécuter une seule fois.
--    Tu n'as plus rien à faire le 23 août : tout est automatique.
-- ============================================================

-- 1) Table listant les saisons (une ligne = une saison, avec ses dates)
create table if not exists seasons (
    id bigint generated always as identity primary key,
    number int not null unique,
    label text not null,
    starts_at timestamptz,       -- NULL = "depuis toujours" (utilisé pour la Saison 1)
    ends_at timestamptz,         -- NULL = pas de date de fin fixée (saison encore ouverte)
    created_at timestamptz not null default now()
);

alter table seasons enable row level security;

drop policy if exists "seasons_read_all" on seasons;
create policy "seasons_read_all" on seasons
    for select
    using (true);

-- 2) Table des scores figés pour les saisons closes
--    (nécessaire pour la Saison 1 ; les saisons suivantes s'auto-calculent
--    depuis score_events si cette table ne contient rien pour elles)
create table if not exists season_frozen_scores (
    season_id bigint not null references seasons(id) on delete cascade,
    user_id uuid not null,
    daily_points numeric not null default 0,
    multiplayer_points numeric not null default 0,
    total_points numeric not null default 0,
    frozen_at timestamptz not null default now(),
    primary key (season_id, user_id)
);

alter table season_frozen_scores enable row level security;

drop policy if exists "season_frozen_scores_read_all" on season_frozen_scores;
create policy "season_frozen_scores_read_all" on season_frozen_scores
    for select
    using (true);

-- 3) Créer la Saison 1 (se termine au démarrage de la Saison 2)
insert into seasons (number, label, starts_at, ends_at)
values (1, 'Saison 1', null, '2026-08-23T00:00:00+02:00')
on conflict (number) do update set ends_at = excluded.ends_at;

-- 4) Créer la Saison 2 (23 août 00:00 -> 1er novembre 00:00, heure de Paris)
--    Pour changer les dates plus tard, il suffira de modifier cette ligne.
insert into seasons (number, label, starts_at, ends_at)
values (2, 'Saison 2', '2026-08-23T00:00:00+02:00', '2026-11-01T00:00:00+01:00')
on conflict (number) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at;

-- 5) Active les tâches planifiées de Supabase (pg_cron).
--    Si cette ligne précise renvoie une erreur de permission, va dans
--    Database > Extensions dans le menu de gauche, active "pg_cron"
--    manuellement, puis relance seulement l'étape 6 ci-dessous.
create extension if not exists pg_cron with schema pg_catalog;

-- 6) Programme la vérification automatique (toutes les 15 minutes) :
--    dès que le 23 août 00:00 est passé ET que la Saison 1 n'est pas
--    encore figée, elle fige automatiquement les totaux de chaque joueur.
--    Une fois figée, la tâche continue de tourner mais ne fait plus rien
--    (aucune action de ta part nécessaire, ni avant ni après).
select cron.schedule(
    'freeze-season-1',
    '*/15 * * * *',
    $$
    insert into season_frozen_scores (season_id, user_id, daily_points, multiplayer_points, total_points)
    select
        (select id from seasons where number = 1),
        user_id,
        coalesce(daily_total_points, 0),
        coalesce(multiplayer_total_score, 0),
        coalesce(daily_total_points, 0) + coalesce(multiplayer_total_score, 0)
    from user_stats
    where now() >= (select starts_at from seasons where number = 2)
      and not exists (
          select 1 from season_frozen_scores
          where season_id = (select id from seasons where number = 1)
      )
    $$
);

-- ============================================================
-- FIN. Rien d'autre à faire.
--
-- Pour vérifier après le 23 août que ça a bien tourné :
--   select * from season_frozen_scores where season_id = (select id from seasons where number = 1);
--
-- Pour la Saison 3 plus tard, une seule ligne à ajouter :
--   insert into seasons (number, label, starts_at, ends_at)
--   values (3, 'Saison 3', '<date de début>', '<date de fin>');
-- ============================================================
