-- Откат 020 → поведение после 019. Удаляет таблицу цен продуктов и проверку суммы.
drop function if exists public.set_product_price(public.product_type, integer);
drop function if exists public.mark_order_paid_manually(uuid, text, integer);
drop function if exists public.order_payment_due(uuid);
drop function if exists taxpasso_private.pay_order(uuid, text, integer, boolean);
drop function if exists taxpasso_private.order_total(uuid);
drop table if exists public.product_prices;
-- Восстановить прежние тела: mark_order_paid_manually(uuid,text), mark_order_paid(uuid,text,integer), record_refund —
-- из migrations/018 (mark_order_paid_manually из 017, mark_order_paid из 002, record_refund из 011).
-- orders.amount_cents (записанные суммы) остаётся.
