-- 020_payment_total.sql — F-09 (сумма оплаты) и вторая половина F-01 (потолок возврата).
-- Идемпотентна. Требует 019 (колонка order_addons.paid_with_order).
--
-- «Оплачено» теперь значит: получена ПОЛНАЯ сумма = цена продукта + запрошенные при оформлении доп. услуги.
--  • цены продуктов — в таблице product_prices (источник правды на сервере; меняет админ: set_product_price);
--  • order_payment_due(order) — сколько должно быть получено (клиент и админ видят одно и то же);
--  • mark_order_paid_manually(order, note, amount) — сумма ОБЯЗАТЕЛЬНО совпадает с должной, иначе «Amount mismatch»;
--  • старая форма mark_order_paid_manually(order, note) осталась ради текущего интерфейса: работает, пока у заказа
--    нет неоплаченных доп. услуг; иначе «Amount required» (нужна форма с суммой);
--  • путь Stripe (mark_order_paid) сверяет сумму с должной и не платит отменённый заказ;
--  • сумма сохраняется в orders.amount_cents; record_refund не даёт вернуть больше оплаченного.

create table if not exists public.product_prices (
  product public.product_type primary key,
  price_cents integer not null check (price_cents > 0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.product_prices(product, price_cents) values
  ('llc_wy', 34900), ('llc_de', 44900), ('itin_standard', 25900), ('itin_return', 40000),
  ('bundle_wy', 54900), ('bundle_de', 64900)
on conflict (product) do nothing;

alter table public.product_prices enable row level security;
drop policy if exists product_prices_read on public.product_prices;
create policy product_prices_read on public.product_prices for select to authenticated
  using (taxpasso_private.current_role() in ('admin', 'client'));
revoke all on public.product_prices from anon, authenticated;
grant select on public.product_prices to authenticated;

create or replace function taxpasso_private.order_total(p_order uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select pp.price_cents + coalesce((select sum(oa.price_cents_at_purchase)::integer from public.order_addons oa
                                     where oa.order_id = o.id and oa.status = 'pending_payment'), 0)
    from public.orders o join public.product_prices pp on pp.product = o.product
   where o.id = p_order
$$;
revoke all on function taxpasso_private.order_total(uuid) from public, anon, authenticated;

create or replace function public.order_payment_due(p_order uuid)
returns table (base_cents integer, addons_cents integer, total_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; b integer; a integer;
begin
  select * into o from public.orders where id = p_order;
  if not found or (o.client_id <> (select auth.uid()) and taxpasso_private.current_role() is distinct from 'admin') then
    raise exception 'Not permitted';
  end if;
  select pp.price_cents into b from public.product_prices pp where pp.product = o.product;
  if b is null then raise exception 'Price not configured'; end if;
  select coalesce(sum(oa.price_cents_at_purchase), 0)::integer into a
    from public.order_addons oa where oa.order_id = p_order and oa.status = 'pending_payment';
  return query select b, a, b + a;
end $$;
revoke all on function public.order_payment_due(uuid) from public, anon, authenticated;
grant execute on function public.order_payment_due(uuid) to authenticated;

create or replace function taxpasso_private.pay_order(p_order uuid, p_note text, p_amount integer, p_amount_given boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; due integer; pend integer;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found or already paid'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('itin_standard', 'itin_return', 'itin_consult') and o.eligibility <> 'approved' then
    raise exception 'Eligibility approval required';
  end if;
  select coalesce(sum(price_cents_at_purchase), 0)::integer into pend
    from public.order_addons where order_id = p_order and status = 'pending_payment';
  select price_cents into due from public.product_prices where product = o.product;
  if due is null then raise exception 'Price not configured'; end if;
  due := due + pend;
  if p_amount_given then
    if p_amount is distinct from due then raise exception 'Amount mismatch' using detail = format('expected_cents=%s', due); end if;
  elsif pend > 0 then
    raise exception 'Amount required' using detail = format('expected_cents=%s', due);
  end if;
  update public.orders
     set payment_status = 'paid', paid_at = clock_timestamp(),
         payment_marked_manually = true, payment_marked_by = (select auth.uid()),
         payment_note = left(nullif(trim(p_note), ''), 1000), amount_cents = due, updated_at = clock_timestamp()
   where id = p_order and payment_status <> 'paid';
  if not found then raise exception 'Order not found or already paid'; end if;
end $$;
revoke all on function taxpasso_private.pay_order(uuid, text, integer, boolean) from public, anon, authenticated;

create or replace function public.mark_order_paid_manually(p_order uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin perform taxpasso_private.pay_order(p_order, p_note, null, false); end $$;

create or replace function public.mark_order_paid_manually(p_order uuid, p_note text, p_amount_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
begin perform taxpasso_private.pay_order(p_order, p_note, p_amount_cents, true); end $$;

revoke all on function public.mark_order_paid_manually(uuid, text), public.mark_order_paid_manually(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.mark_order_paid_manually(uuid, text), public.mark_order_paid_manually(uuid, text, integer) to authenticated;

-- Путь Stripe (служебный): та же сверка суммы, отменённый заказ не оплачивается
create or replace function public.mark_order_paid(p_order uuid, p_session text, p_amount_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; due integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_status = 'paid' then
    if o.stripe_session_id = p_session then return; end if;
    raise exception 'Order already paid by another session';
  end if;
  if o.cancelled_at is not null then raise exception 'Order cancelled'; end if;
  due := taxpasso_private.order_total(p_order);
  if p_amount_cents is distinct from due then raise exception 'Amount mismatch' using detail = format('expected_cents=%s', due); end if;
  update public.orders
     set payment_status = 'paid', paid_at = now(), stripe_session_id = p_session, amount_cents = p_amount_cents
   where id = p_order;
end $$;
revoke all on function public.mark_order_paid(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, integer) to service_role;  -- путь Stripe (вебхук с service-ключом)

create or replace function public.set_product_price(p_product public.product_type, p_price_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  if p_price_cents is null or p_price_cents <= 0 then raise exception 'Price must be positive'; end if;
  insert into public.product_prices(product, price_cents) values (p_product, p_price_cents)
  on conflict (product) do update set price_cents = excluded.price_cents, updated_at = clock_timestamp();
end $$;
revoke all on function public.set_product_price(public.product_type, integer) from public, anon, authenticated;
grant execute on function public.set_product_price(public.product_type, integer) to authenticated;

-- Уже оплаченные заказы: записать сумму по цене продукта (у оплаченных до этой миграции суммы не было)
update public.orders o set amount_cents = pp.price_cents
  from public.product_prices pp
 where pp.product = o.product and o.payment_status = 'paid' and o.amount_cents is null;

-- F-01: возврат — только по оплаченному заказу, scope соответствует продукту, без дублей, не больше оплаченного
create or replace function public.record_refund(p_order uuid, p_amount_cents integer, p_scope text, p_reason text, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders; paid_total integer; refunded integer;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be positive'; end if;
  if p_scope not in ('order', 'llc', 'itin', 'other') then raise exception 'Invalid scope'; end if;
  if p_scope = 'itin' and o.product not in ('itin_standard', 'itin_return', 'itin_consult', 'bundle_wy', 'bundle_de') then
    raise exception 'Scope does not match order';
  end if;
  if p_scope = 'llc' and o.product not in ('llc_wy', 'llc_de', 'bundle_wy', 'bundle_de') then
    raise exception 'Scope does not match order';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
  if not taxpasso_private.claim_op(p_op, 'record_refund', p_order) then return 'already_done'; end if;
  if o.payment_status <> 'paid' then raise exception 'Order not paid'; end if;
  if exists (select 1 from public.order_refunds r where r.order_id = p_order and r.amount_cents = p_amount_cents
                and r.scope = p_scope and r.created_at > clock_timestamp() - interval '10 minutes') then
    raise exception 'Duplicate refund';
  end if;
  paid_total := coalesce(o.amount_cents, 0)
              + coalesce((select sum(oa.price_cents_at_purchase)::integer from public.order_addons oa
                           where oa.order_id = p_order and oa.paid_at is not null and not oa.paid_with_order), 0);
  refunded := coalesce((select sum(r.amount_cents)::integer from public.order_refunds r where r.order_id = p_order), 0);
  if refunded + p_amount_cents > paid_total then
    raise exception 'Refund exceeds amount paid' using detail = format('paid_cents=%s refunded_cents=%s', paid_total, refunded);
  end if;
  perform set_config('taxpasso.reason', left(trim(p_reason), 1000), true);
  insert into public.order_refunds(order_id, amount_cents, scope, reason, created_by)
  values (p_order, p_amount_cents, p_scope, left(trim(p_reason), 1000), (select auth.uid()));
  return 'ok';
end $$;
