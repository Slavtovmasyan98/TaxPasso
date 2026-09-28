-- Откат 018 → поведение после 017. Удаляет каталог доп. услуг и ВСЕ запросы/покупки (выгрузите order_addons заранее).
drop trigger if exists orders_activate_addons on public.orders;
drop function if exists taxpasso_private.activate_checkout_addons();
drop function if exists public.set_addon_price(text, integer);
drop function if exists public.set_addon_active(text, boolean);
drop function if exists public.mark_addon_paid(uuid, text, uuid);
drop function if exists public.cancel_addon_request(uuid);
drop function if exists public.request_addon(uuid, text, uuid);
drop function if exists public.available_addons(uuid);
drop table if exists public.order_addons;
drop table if exists public.addon_products;
drop table if exists public.addons;
