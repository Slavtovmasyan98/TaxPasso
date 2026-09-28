-- Откат 016: PostgreSQL не умеет удалять значения enum.
-- 'itin_consult' и 'consult_interview' остаются в типах, но после отката 017 не используются.
select 1;
