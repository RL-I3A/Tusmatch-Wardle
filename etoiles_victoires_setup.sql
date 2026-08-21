-- ============================================================
-- TUSMATCH — Compteurs de victoires (jour / semaine / saison)
-- Pour les étoiles bronze / argent / or dans le profil.
--
-- À exécuter dans le SQL Editor, une seule fois, après avoir déjà
-- lancé seasons_setup_complet.sql.
--
-- Règle en cas d'égalité : si plusieurs joueurs sont premiers ex-aequo
-- un jour / une semaine / une saison donnée, ils sont TOUS crédités
-- d'une victoire (personne n'est pénalisé par une égalité).
--
-- Important : ces compteurs démarrent à 0 à partir d'aujourd'hui.
-- Les victoires passées (avant ce script) ne sont pas recalculées
-- rétroactivement. Dis-le-moi si tu veux que je fasse aussi un
-- rattrapage sur l'historique.
-- ============================================================

-- 1) Nouvelles colonnes sur user_stats
alter table user_stats
    add column if not exists day_wins_count int not null default 0,
    add column if not exists week_wins_count int not null default 0,
    add column if not exists season_wins_count int not null default 0;

-- 2) Table anti-double-crédit : garde une trace de chaque période déjà
--    récompensée, pour que les jobs planifiés soient sans risque même
--    s'ils se déclenchent plusieurs fois.
create table if not exists leaderboard_win_credits (
    id bigint generated always as identity primary key,
    kind text not null,           -- 'day' | 'week'
    period_key text not null,     -- ex: '2026-08-20' (jour) ou '2026-IW34' (semaine ISO)
    created_at timestamptz not null default now(),
    unique (kind, period_key)
);

alter table leaderboard_win_credits enable row level security;
drop policy if exists "leaderboard_win_credits_read_all" on leaderboard_win_credits;
create policy "leaderboard_win_credits_read_all" on leaderboard_win_credits
    for select
    using (true);

-- 3) Retire l'ancien job qui ne gérait que la Saison 1 : il est remplacé
--    plus bas par un job générique qui gère toutes les saisons.
select cron.unschedule('freeze-season-1')
where exists (select 1 from cron.job where jobname = 'freeze-season-1');

-- ============================================================
-- 4) Job quotidien : crédite le(s) gagnant(s) du jour précédent
--    (heure de Paris). Tourne une fois par jour à 01h05 UTC,
--    largement après minuit à Paris été comme hiver.
-- ============================================================
select cron.schedule(
    'credit-daily-winner',
    '5 1 * * *',
    $$
    with bounds as (
        select
            (date_trunc('day', now() at time zone 'Europe/Paris') - interval '1 day') at time zone 'Europe/Paris' as day_start,
            date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris' as day_end
    ),
    period as (
        select to_char((day_start at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as period_key
        from bounds
    ),
    inserted as (
        insert into leaderboard_win_credits (kind, period_key)
        select 'day', period_key from period
        on conflict do nothing
        returning 1
    ),
    day_totals as (
        select se.user_id, sum(se.points) as pts
        from score_events se, bounds
        where se.created_at >= bounds.day_start and se.created_at < bounds.day_end
        group by se.user_id
    ),
    top as (
        select max(pts) as top_pts from day_totals
    )
    update user_stats
    set day_wins_count = day_wins_count + 1
    where exists (select 1 from inserted)
      and user_id in (select user_id from day_totals, top where day_totals.pts = top.top_pts)
    $$
);

-- ============================================================
-- 5) Job hebdomadaire : crédite le(s) gagnant(s) de la semaine
--    précédente (lundi -> dimanche, heure de Paris). Tourne chaque
--    lundi à 01h05 UTC.
-- ============================================================
select cron.schedule(
    'credit-weekly-winner',
    '5 1 * * 1',
    $$
    with bounds as (
        select
            (date_trunc('week', now() at time zone 'Europe/Paris') - interval '1 week') at time zone 'Europe/Paris' as week_start,
            date_trunc('week', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris' as week_end
    ),
    period as (
        select to_char((week_start at time zone 'Europe/Paris')::date, 'IYYY-"W"IW') as period_key
        from bounds
    ),
    inserted as (
        insert into leaderboard_win_credits (kind, period_key)
        select 'week', period_key from period
        on conflict do nothing
        returning 1
    ),
    week_totals as (
        select se.user_id, sum(se.points) as pts
        from score_events se, bounds
        where se.created_at >= bounds.week_start and se.created_at < bounds.week_end
        group by se.user_id
    ),
    top as (
        select max(pts) as top_pts from week_totals
    )
    update user_stats
    set week_wins_count = week_wins_count + 1
    where exists (select 1 from inserted)
      and user_id in (select user_id from week_totals, top where week_totals.pts = top.top_pts)
    $$
);

-- ============================================================
-- 6) Job "saisons" (remplace l'ancien freeze-season-1) : toutes les
--    15 minutes, fige toute saison terminée qui ne l'est pas encore
--    (Saison 1 = copie des totaux actuels ; saisons suivantes =
--    calculées depuis score_events sur leur période) ET crédite le(s)
--    gagnant(s) de cette saison. Générique : rien à faire à la main
--    pour la Saison 3 et les suivantes.
-- ============================================================
select cron.schedule(
    'freeze-and-credit-seasons',
    '*/15 * * * *',
    $$
    do $do$
    declare
        s record;
        top_score numeric;
    begin
        for s in
            select * from seasons
            where ends_at is not null and ends_at <= now()
              and not exists (select 1 from season_frozen_scores where season_id = seasons.id)
        loop
            if s.number = 1 then
                insert into season_frozen_scores (season_id, user_id, daily_points, multiplayer_points, total_points)
                select
                    s.id,
                    user_id,
                    coalesce(daily_total_points, 0),
                    coalesce(multiplayer_total_score, 0),
                    coalesce(daily_total_points, 0) + coalesce(multiplayer_total_score, 0)
                from user_stats;
            else
                insert into season_frozen_scores (season_id, user_id, daily_points, multiplayer_points, total_points)
                select s.id, user_id, 0, 0, sum(points)
                from score_events
                where created_at >= s.starts_at and created_at < s.ends_at
                group by user_id;
            end if;

            select max(total_points) into top_score from season_frozen_scores where season_id = s.id;

            if top_score is not null then
                update user_stats
                set season_wins_count = season_wins_count + 1
                where user_id in (
                    select user_id from season_frozen_scores
                    where season_id = s.id and total_points = top_score
                );
            end if;
        end loop;
    end
    $do$;
    $$
);

-- ============================================================
-- FIN. Rien d'autre à faire. Les étoiles se rempliront automatiquement.
--
-- Pour vérifier qu'un job a bien tourné :
--   select * from cron.job_run_details order by start_time desc limit 20;
-- ============================================================
