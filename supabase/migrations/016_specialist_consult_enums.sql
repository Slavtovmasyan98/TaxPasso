-- 016_specialist_consult_enums.sql
-- Новые значения enum для консультации специалиста (опросник: "Не знаю" / "Нет основания").
-- Отдельная миграция: PostgreSQL не разрешает использовать новое значение enum в той же транзакции.
alter type public.product_type add value if not exists 'itin_consult';
alter type public.order_status add value if not exists 'consult_interview';
