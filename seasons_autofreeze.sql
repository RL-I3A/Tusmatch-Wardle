-- ============================================================
-- TUSMATCH — Auto-figeage de la Saison 1 (pas besoin d'être présent à minuit)
-- À exécuter APRÈS avoir lancé seasons_setup.sql, une seule fois.
-- ============================================================

-- 1) Active l'extension de tâches planifiées de Supabase (pg_cron).
--    Si cette ligne échoue avec une erreur de permission, va dans
--    Database > Extensions dans le dashboard Supabase et active
--    "pg_cron" manuellement, puis relance juste la partie 2 ci-dessous.
create extension if not exists pg_cron with schema pg_catalog;

-- 2) Programme une vérification toutes les 15 minutes : dès que l'heure
--    de démarrage de la Saison 2 est passée ET que la Saison 1 n'a pas
--    encore été figée, elle fige automatiquement les totaux à ce moment-là.
--    Une fois figée, la tâche ne fait plus rien (elle continue de tourner
--    mais devient inoffensive) — pas besoin de la couper toi-même.
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
-- Pour vérifier que ça a bien tourné une fois le 23 août passé :
--   select * from season_frozen_scores where season_id = (select id from seasons where number = 1);
--
-- Pour désactiver la tâche plus tard (optionnel, elle ne fait plus rien
-- une fois la Saison 1 figée) :
--   select cron.unschedule('freeze-season-1');
-- ============================================================
