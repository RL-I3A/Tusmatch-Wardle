-- ============================================================
-- TUSMATCH — Mise en place du classement par saisons
-- À exécuter dans Supabase (SQL Editor), dans l'ordre, une seule fois.
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

-- Lecture publique (comme le reste du classement)
drop policy if exists "seasons_read_all" on seasons;
create policy "seasons_read_all" on seasons
    for select
    using (true);

-- 2) Table des scores figés pour les saisons closes
--    (nécessaire pour la Saison 1, car score_events ne couvre peut-être pas
--    tout son historique ; les saisons suivantes s'auto-calculent depuis
--    score_events si cette table ne contient rien pour elles)
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

-- ============================================================
-- 3) Créer la Saison 1 (se termine au démarrage de la Saison 2)
-- ============================================================
insert into seasons (number, label, starts_at, ends_at)
values (1, 'Saison 1', null, '2026-08-23T00:00:00+02:00')
on conflict (number) do update set ends_at = excluded.ends_at;

-- ============================================================
-- 4) Créer la Saison 2
--    (23 août 00:00 -> 1er novembre 00:00, heure de Paris)
--    Pour changer les dates plus tard, il suffit de modifier cette ligne.
-- ============================================================
insert into seasons (number, label, starts_at, ends_at)
values (2, 'Saison 2', '2026-08-23T00:00:00+02:00', '2026-11-01T00:00:00+01:00')
on conflict (number) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at;

-- ============================================================
-- 5) Figer les scores actuels comme total final de la Saison 1.
--    -> À exécuter idéalement juste avant/au moment du 23 août 00:00,
--       pour inclure un maximum de points. Si tu le lances aujourd'hui,
--       les points gagnés entre maintenant et le 23 août ne seront pas
--       comptés dans la Saison 1 (mais tu peux relancer CE bloc autant
--       de fois que tu veux avant le 23 août, il écrase à chaque fois
--       avec les totaux les plus récents grâce à l'ON CONFLICT).
-- ============================================================
insert into season_frozen_scores (season_id, user_id, daily_points, multiplayer_points, total_points)
select
    (select id from seasons where number = 1),
    user_id,
    coalesce(daily_total_points, 0),
    coalesce(multiplayer_total_score, 0),
    coalesce(daily_total_points, 0) + coalesce(multiplayer_total_score, 0)
from user_stats
on conflict (season_id, user_id) do update set
    daily_points = excluded.daily_points,
    multiplayer_points = excluded.multiplayer_points,
    total_points = excluded.total_points,
    frozen_at = now();

-- ============================================================
-- Plus tard, quand la Saison 2 se termine et que tu crées la Saison 3 :
-- il suffira de relancer un bloc équivalent à l'étape 5 (avec season_id
-- de la Saison 2), puis d'insérer la nouvelle ligne dans `seasons`.
-- Aucune autre modification de base de données ne sera nécessaire.
-- ============================================================
