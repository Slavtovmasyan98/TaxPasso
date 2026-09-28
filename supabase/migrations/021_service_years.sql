-- 021_service_years.sql — срок обслуживания (1–3 года, предоплата) и государственный сбор штата как строки заказа.
-- Идемпотентна. Требует 019–020.
--
-- Правила:
--  • Клиент выбирает срок при оформлении (set_order_service_years); первый год входит в пакет.
--  • За каждый следующий год к оплате: продление обслуживания (доход Taxpasso) + государственный сбор штата (ТРАНЗИТ:
--    Taxpasso оплачивает его штату от имени клиента, в выручку он не входит).
--  • Сумма считается на сервере: пакет + продления + госсборы + ожидающие доп. услуги (order_payment_due / order_total).
--  • При оплате состав суммы фиксируется в order_payment_lines (снимок цен; тип state_fee отделяет транзит от выручки).
--  • Форма оплаты без суммы допустима только когда к оплате ровно цена пакета; иначе «Amount required».
--  • Цены продлений и госсборов — таблица renewal_prices (меняет админ: set_renewal_price).

insert into taxpasso_private.settings(key, value) values ('max_prepaid_years', '3') on conflict (key) do nothing;

create table if not exists public.renewal_prices (
  state text primary key check (state in ('WY', 'DE')),
  renewal_cents integer not null check (renewal_cents > 0),
  state_fee_cents integer not null check (state_fee_cents >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.renewal_prices(state, renewal_cents, state_fee_cents) values ('WY', 14900, 6000), ('DE', 19900, 40000)
on conflict (state) do nothing;
alter table public.renewal_prices enable row level security;
drop policy if exists renewal_prices_read on public.renewal_prices;
create policy renewal_prices_read on public.renewal_prices for select to authenticated
  using (taxpasso_private.current_role() in ('admin', 'client'));
revoke all on public.renewal_prices from anon, authenticated;
grant select on public.renewal_prices to authenticated;

create table if not exists public.order_payment_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('package', 'service_year', 'state_fee', 'addon')),
  period_number smallint,
  addon_id uuid references public.addons(id),
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists order_payment_lines_order_idx on public.order_payment_lines(order_id);
alter table public.order_payment_lines enable row level security;
drop policy if exists order_payment_lines_read on public.order_payment_lines;
create policy order_payment_lines_read on public.order_payment_lines for select to authenticated
  using (taxpasso_private.current_role() = 'admin'
         or exists (select 1 from public.orders o where o.id = order_id and o.client_id = (select auth.uid())));
revoke all on public.order_payment_lines from anon, authenticated;
grant select on public.order_payment_lines to authenticated;

create or replace function taxpasso_private.order_state(p_product public.product_type) returns text
language sql immutable set search_path = '' as $$
  select case when p_product in ('llc_wy', 'bundle_wy') then 'WY' when p_product in ('llc_de', 'bundle_de') then 'DE' end
$$;

create or replace function taxpasso_private.order_due_parts(p_order uuid)
returns table (base_cents integer, renewals_cents integer, state_fee_cents integer, addons_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; st text; b integer; rn integer; sf integer; extra integer;
begin
  select * into o from public.orders where id = p_order;
  if not found then return; end if;
  select pp.price_cents into b from public.product_prices pp where pp.product = o.product;
  if b is null then return; end if;
  st := taxpasso_private.order_state(o.product);
  extra := greatest(o.service_years - 1, 0);
  if st is not null and extra > 0 then
    select rp.renewal_cents * extra, rp.state_fee_cents * extra into rn, sf from public.renewal_prices rp where rp.state = st;
  end if;
  return query select b, coalesce(rn, 0), coalesce(sf, 0),
    coalesce((select sum(oa.price_cents_at_purchase)::integer from public.order_addons oa
               where oa.order_id = p_order and oa.status = 'pending_payment'), 0);
end $$;
revoke all on function taxpasso_private.order_due_parts(uuid) from public, anon, authenticated;

create or replace function taxpasso_private.order_total(p_order uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select p.base_cents + p.renewals_cents + p.state_fee_cents + p.addons_cents from taxpasso_private.order_due_parts(p_order) p
$$;
revoke all on function taxpasso_private.order_total(uuid) from public, anon, authenticated;

drop function if exists public.order_payment_due(uuid);
create function public.order_payment_due(p_order uuid)
returns table (base_cents integer, renewals_cents integer, state_fee_cents integer, addons_cents integer, total_cents integer, years integer)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; p record;
begin
  select * into o from public.orders where id = p_order;
  if not found or (o.client_id <> (select auth.uid()) and taxpasso_private.current_role() is distinct from 'admin') then
    raise exception 'Not permitted';
  end if;
  select * into p from taxpasso_private.order_due_parts(p_order);
  if p.base_cents is null then raise exception 'Price not configured'; end if;
  return query select p.base_cents, p.renewals_cents, p.state_fee_cents, p.addons_cents,
    p.base_cents + p.renewals_cents + p.state_fee_cents + p.addons_cents, o.service_years::integer;
end $$;
revoke all on function public.order_payment_due(uuid) from public, anon, authenticated;
grant execute on function public.order_payment_due(uuid) to authenticated;

create or replace function taxpasso_private.snapshot_payment_lines(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; st text; rp public.renewal_prices; k integer; b integer;
begin
  select * into o from public.orders where id = p_order;
  select price_cents into b from public.product_prices where product = o.product;
  delete from public.order_payment_lines where order_id = p_order;
  insert into public.order_payment_lines(order_id, kind, amount_cents) values (p_order, 'package', b);
  st := taxpasso_private.order_state(o.product);
  if st is not null and o.service_years > 1 then
    select * into rp from public.renewal_prices where state = st;
    for k in 2..o.service_years loop
      insert into public.order_payment_lines(order_id, kind, period_number, amount_cents) values (p_order, 'service_year', k, rp.renewal_cents);
      if rp.state_fee_cents > 0 then
        insert into public.order_payment_lines(order_id, kind, period_number, amount_cents) values (p_order, 'state_fee', k, rp.state_fee_cents);
      end if;
    end loop;
  end if;
  insert into public.order_payment_lines(order_id, kind, addon_id, amount_cents)
  select p_order, 'addon', oa.addon_id, oa.price_cents_at_purchase
    from public.order_addons oa where oa.order_id = p_order and oa.status = 'pending_payment';
end $$;
revoke all on function taxpasso_private.snapshot_payment_lines(uuid) from public, anon, authenticated;

create or replace function taxpasso_private.pay_order(p_order uuid, p_note text, p_amount integer, p_amount_given boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; due integer; base integer;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found or already paid'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('itin_standard', 'itin_return', 'itin_consult') and o.eligibility <> 'approved' then
    raise exception 'Eligibility approval required';
  end if;
  due := taxpasso_private.order_total(p_order);
  if due is null then raise exception 'Price not configured'; end if;
  select price_cents into base from public.product_prices where product = o.product;
  if p_amount_given then
    if p_amount is distinct from due then raise exception 'Amount mismatch' using detail = format('expected_cents=%s', due); end if;
  elsif due <> base then
    raise exception 'Amount required' using detail = format('expected_cents=%s', due);
  end if;
  perform taxpasso_private.snapshot_payment_lines(p_order);
  update public.orders
     set payment_status = 'paid', paid_at = clock_timestamp(), payment_marked_manually = true, payment_marked_by = (select auth.uid()),
         payment_note = left(nullif(trim(p_note), ''), 1000), amount_cents = due, updated_at = clock_timestamp()
   where id = p_order and payment_status <> 'paid';
  if not found then raise exception 'Order not found or already paid'; end if;
end $$;
revoke all on function taxpasso_private.pay_order(uuid, text, integer, boolean) from public, anon, authenticated;

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
  perform taxpasso_private.snapshot_payment_lines(p_order);
  update public.orders set payment_status = 'paid', paid_at = now(), stripe_session_id = p_session, amount_cents = p_amount_cents where id = p_order;
end $$;
revoke all on function public.mark_order_paid(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, integer) to service_role;

create or replace function public.set_order_service_years(p_order uuid, p_years integer) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; maxy integer := coalesce(nullif(taxpasso_private.setting('max_prepaid_years', '3'), '')::integer, 3);
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.client_id <> (select auth.uid()) then raise exception 'Not permitted'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.payment_status = 'paid' then raise exception 'Order already paid'; end if;
  if taxpasso_private.order_state(o.product) is null then raise exception 'Not available for this order'; end if;
  if p_years is null or p_years not between 1 and maxy then raise exception 'Invalid service term'; end if;
  update public.orders set service_years = p_years, updated_at = now() where id = p_order;
end $$;
revoke all on function public.set_order_service_years(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_order_service_years(uuid, integer) to authenticated;

create or replace function public.set_renewal_price(p_state text, p_renewal_cents integer, p_state_fee_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  if p_state not in ('WY', 'DE') then raise exception 'Invalid state'; end if;
  if p_renewal_cents is null or p_renewal_cents <= 0 or p_state_fee_cents is null or p_state_fee_cents < 0 then
    raise exception 'Price must be positive';
  end if;
  insert into public.renewal_prices(state, renewal_cents, state_fee_cents) values (p_state, p_renewal_cents, p_state_fee_cents)
  on conflict (state) do update set renewal_cents = excluded.renewal_cents, state_fee_cents = excluded.state_fee_cents, updated_at = clock_timestamp();
end $$;
revoke all on function public.set_renewal_price(text, integer, integer) from public, anon, authenticated;
grant execute on function public.set_renewal_price(text, integer, integer) to authenticated;
