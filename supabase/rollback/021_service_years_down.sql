-- Откат 021 → поведение после 020. Убирает выбор срока, цены продлений и снимок строк платежа.
drop function if exists public.set_renewal_price(text, integer, integer);
drop function if exists public.set_order_service_years(uuid, integer);
drop function if exists taxpasso_private.snapshot_payment_lines(uuid);
drop function if exists taxpasso_private.order_due_parts(uuid);
drop function if exists taxpasso_private.order_state(public.product_type);
drop table if exists public.order_payment_lines;
drop table if exists public.renewal_prices;
delete from taxpasso_private.settings where key = 'max_prepaid_years';
-- Восстановить тела из migrations/020_payment_total.sql: pay_order, order_total, order_payment_due (с DROP: другой набор колонок),
-- mark_order_paid. Значения orders.service_years, выбранные клиентами, остаются.
