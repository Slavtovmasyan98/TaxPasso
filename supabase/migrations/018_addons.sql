-- 018_addons.sql
-- Доп. услуги LLC: Business Address, Form 5472 + pro-forma 1120, DE Expedited Filing.
-- ITIN сюда НЕ входит: itin_standard / itin_return / bundle_* живут в своём workflow.
--
-- Принципы:
--  1. Запрос услуги ≠ выдача. request_addon создаёт запись pending_payment; active ставится только
--     сервером после оплаты (оплата заказа активирует запрошенное при оформлении; докупка — mark_addon_paid).
--  2. Цена всегда берётся из каталога на сервере; в order_addons хранится снимок цены на момент запроса.
--  3. Кому продаётся услуга — таблица addon_products (ITIN-продуктов там нет и быть не должно).
--  4. Годовые услуги: period_number (1 = первый год, 2 = продление…), без конфликта уникальности.
--  5. Услугу нельзя включить в продажу, пока цена не подтверждена (price_confirmed), — и на уровне
--     функции, и CHECK-ограничением в таблице.

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  name text not null check (length(name) between 2 and 200),
  description text check (description is null or length(description) <= 1000),
  billing_type text not null check (billing_type in ('one_time', 'yearly')),
  price_cents integer not null check (price_cents > 0),
  price_confirmed boolean not null default false,
  purchase_stage text not null default 'checkout_and_post_purchase'
    check (purchase_stage in ('checkout', 'post_purchase', 'checkout_and_post_purchase')),
  locked_after_milestone text check (locked_after_milestone is null or locked_after_milestone in ('state_filed', 'irs_sent')),
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint addons_active_requires_confirmed_price check (not active or price_confirmed)
);
comment on column public.addons.price_confirmed is 'false = цена предварительная (себестоимость не подтверждена); такую услугу нельзя включить в продажу';

create table public.addon_products (
  addon_id uuid not null references public.addons(id) on delete cascade,
  product public.product_type not null,
  primary key (addon_id, product)
);

-- Все три услуги создаются выключенными и с ПРЕДВАРИТЕЛЬНОЙ ценой.
insert into public.addons (code, name, billing_type, price_cents, purchase_stage, locked_after_milestone) values
  ('BUSINESS_ADDRESS', 'Почтовый адрес в США', 'yearly', 17900, 'checkout_and_post_purchase', null),
  ('FORM_5472_1120', 'Form 5472 + pro-forma 1120', 'yearly', 34900, 'checkout_and_post_purchase', null),
  ('DE_EXPEDITED', 'Ускоренная регистрация Delaware', 'one_time', 37500, 'checkout_and_post_purchase', 'state_filed');

insert into public.addon_products (addon_id, product)
select a.id, m.product::public.product_type
  from public.addons a
  join (values
    ('BUSINESS_ADDRESS', 'llc_wy'), ('BUSINESS_ADDRESS', 'llc_de'), ('BUSINESS_ADDRESS', 'bundle_wy'), ('BUSINESS_ADDRESS', 'bundle_de'),
    ('FORM_5472_1120', 'llc_wy'), ('FORM_5472_1120', 'llc_de'), ('FORM_5472_1120', 'bundle_wy'), ('FORM_5472_1120', 'bundle_de'),
    ('DE_EXPEDITED', 'llc_de'), ('DE_EXPEDITED', 'bundle_de')
  ) as m(code, product) on m.code = a.code;

create table public.order_addons (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  addon_id uuid not null references public.addons(id),
  period_number smallint not null default 1 check (period_number between 1 and 20),
  price_cents_at_purchase integer not null check (price_cents_at_purchase > 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'cancelled', 'expired')),
  requested_by uuid references public.profiles(id),
  requested_at timestamptz not null default clock_timestamp(),
  paid_at timestamptz,
  paid_marked_by uuid references public.profiles(id),
  payment_note text check (payment_note is null or length(payment_note) <= 1000),
  period_start date,
  period_end date,
  unique (order_id, addon_id, period_number)
);
create index on public.order_addons(order_id);

alter table public.addons enable row level security;
create policy addons_read on public.addons for select to authenticated
  using (active
         or taxpasso_private.current_role() = 'admin'
         or exists (select 1 from public.order_addons oa join public.orders o on o.id = oa.order_id
                     where oa.addon_id = addons.id and o.client_id = (select auth.uid())));
revoke all on public.addons from anon, authenticated;
grant select on public.addons to authenticated;
create trigger addons_touch_updated_at before update on public.addons
  for each row execute function public.touch_updated_at();

alter table public.addon_products enable row level security;
create policy addon_products_read on public.addon_products for select to authenticated
  using (taxpasso_private.current_role() = 'admin');
revoke all on public.addon_products from anon, authenticated;
grant select on public.addon_products to authenticated;

alter table public.order_addons enable row level security;
create policy order_addons_read on public.order_addons for select to authenticated
  using (taxpasso_private.current_role() = 'admin'
         or exists (select 1 from public.orders o where o.id = order_id and o.client_id = (select auth.uid())));
revoke all on public.order_addons from anon, authenticated;
grant select on public.order_addons to authenticated;
create trigger audit_order_addons after insert or update or delete on public.order_addons
  for each row execute function taxpasso_private.audit_row();

-- Что можно предложить клиенту прямо сейчас (сервер решает: продукт, этап, блокировки).
create function public.available_addons(p_order uuid)
returns table (code text, name text, description text, billing_type text, price_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or (o.client_id <> (select auth.uid()) and taxpasso_private.current_role() is distinct from 'admin') then
    raise exception 'Not permitted';
  end if;
  if o.cancelled_at is not null then return; end if;
  return query
    select a.code, a.name, a.description, a.billing_type, a.price_cents
      from public.addons a
      join public.addon_products ap on ap.addon_id = a.id and ap.product = o.product
     where a.active
       and (a.purchase_stage = 'checkout_and_post_purchase'
            or (a.purchase_stage = 'checkout' and o.payment_status <> 'paid')
            or (a.purchase_stage = 'post_purchase' and o.payment_status = 'paid'))
       and (a.locked_after_milestone is null
            or not exists (select 1 from public.order_milestones m where m.order_id = p_order and m.milestone = a.locked_after_milestone))
       and not exists (select 1 from public.order_addons oa
                        where oa.order_id = p_order and oa.addon_id = a.id and oa.period_number = 1
                          and oa.status in ('pending_payment', 'active'))
     order by a.code;
end $$;

-- Клиент запрашивает услугу. Это НЕ выдача: статус pending_payment, цена — из каталога.
create function public.request_addon(p_order uuid, p_addon_code text, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders; a public.addons; ex public.order_addons;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.client_id <> (select auth.uid()) then raise exception 'Not permitted'; end if;
  if o.cancelled_at is not null then raise exception 'Order cancelled'; end if;
  select * into a from public.addons where code = upper(p_addon_code);
  if not found or not a.active then raise exception 'Addon not available'; end if;
  if not exists (select 1 from public.addon_products ap where ap.addon_id = a.id and ap.product = o.product) then
    raise exception 'Addon not available for this order';
  end if;
  if a.purchase_stage = 'checkout' and o.payment_status = 'paid' then raise exception 'Addon only available during checkout'; end if;
  if a.purchase_stage = 'post_purchase' and o.payment_status <> 'paid' then raise exception 'Addon only available after checkout'; end if;
  if a.locked_after_milestone is not null
     and exists (select 1 from public.order_milestones m where m.order_id = p_order and m.milestone = a.locked_after_milestone) then
    raise exception 'Addon locked: milestone already reached';
  end if;
  if not taxpasso_private.claim_op(p_op, 'request_addon', p_order) then return 'already_done'; end if;
  select * into ex from public.order_addons where order_id = p_order and addon_id = a.id and period_number = 1;
  if found then
    if ex.status <> 'cancelled' then return 'already_requested'; end if;
    update public.order_addons
       set status = 'pending_payment', price_cents_at_purchase = a.price_cents,
           requested_at = clock_timestamp(), requested_by = (select auth.uid())
     where id = ex.id;
    return 'ok';
  end if;
  insert into public.order_addons(order_id, addon_id, price_cents_at_purchase, requested_by)
  values (p_order, a.id, a.price_cents, (select auth.uid()));
  return 'ok';
end $$;

-- Отмена неоплаченного запроса (клиент или админ). Оплаченную услугу так отменить нельзя.
create function public.cancel_addon_request(p_order_addon uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare oa public.order_addons; o public.orders;
begin
  select * into oa from public.order_addons where id = p_order_addon for update;
  if not found then raise exception 'Not permitted'; end if;
  select * into o from public.orders where id = oa.order_id;
  if o.client_id <> (select auth.uid()) and taxpasso_private.current_role() is distinct from 'admin' then
    raise exception 'Not permitted';
  end if;
  if oa.status <> 'pending_payment' then raise exception 'Only unpaid requests can be cancelled'; end if;
  update public.order_addons set status = 'cancelled' where id = p_order_addon;
end $$;

-- Админ подтверждает оплату услуги (докупка после оплаты заказа; позже — вебхук Stripe).
create function public.mark_addon_paid(p_order_addon uuid, p_note text, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare oa public.order_addons; o public.orders; a public.addons;
begin
  perform taxpasso_private.require_admin();
  select * into oa from public.order_addons where id = p_order_addon for update;
  if not found then raise exception 'Addon request not found'; end if;
  select * into o from public.orders where id = oa.order_id;
  if o.cancelled_at is not null then raise exception 'Order cancelled'; end if;
  if not taxpasso_private.claim_op(p_op, 'mark_addon_paid', oa.order_id) then return 'already_done'; end if;
  if oa.status = 'active' then return 'already_done'; end if;
  if oa.status <> 'pending_payment' then raise exception 'Addon request not payable'; end if;
  select * into a from public.addons where id = oa.addon_id;
  update public.order_addons
     set status = 'active', paid_at = clock_timestamp(), paid_marked_by = (select auth.uid()),
         payment_note = left(nullif(trim(coalesce(p_note, '')), ''), 1000),
         period_start = current_date,
         period_end = case when a.billing_type = 'yearly' then (current_date + interval '1 year')::date end
   where id = oa.id;
  return 'ok';
end $$;

-- Оплата заказа (вручную или через Stripe) активирует услуги, запрошенные при оформлении:
-- клиент платит одной суммой «пакет + выбранные услуги».
create function taxpasso_private.activate_checkout_addons() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.order_addons oa
     set status = 'active', paid_at = clock_timestamp(), paid_marked_by = new.payment_marked_by,
         period_start = current_date,
         period_end = case when (select ad.billing_type from public.addons ad where ad.id = oa.addon_id) = 'yearly'
                           then (current_date + interval '1 year')::date end
   where oa.order_id = new.id and oa.status = 'pending_payment';
  return null;
end $$;
revoke all on function taxpasso_private.activate_checkout_addons() from public, anon, authenticated;
create trigger orders_activate_addons after update of payment_status on public.orders
  for each row when (old.payment_status is distinct from 'paid' and new.payment_status = 'paid')
  execute function taxpasso_private.activate_checkout_addons();

-- Управление каталогом (только админ). Включить можно только услугу с подтверждённой ценой;
-- set_addon_price — осознанное решение админа, оно же подтверждает цену.
create function public.set_addon_active(p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.addons;
begin
  perform taxpasso_private.require_admin();
  select * into a from public.addons where code = upper(p_code);
  if not found then raise exception 'Addon not found'; end if;
  if p_active and not a.price_confirmed then raise exception 'Price not confirmed'; end if;
  update public.addons set active = p_active, updated_at = clock_timestamp() where id = a.id;
end $$;

create function public.set_addon_price(p_code text, p_price_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  if p_price_cents is null or p_price_cents <= 0 then raise exception 'Price must be positive'; end if;
  update public.addons set price_cents = p_price_cents, price_confirmed = true, updated_at = clock_timestamp()
   where code = upper(p_code);
  if not found then raise exception 'Addon not found'; end if;
end $$;

revoke all on function
  public.available_addons(uuid), public.request_addon(uuid, text, uuid), public.cancel_addon_request(uuid),
  public.mark_addon_paid(uuid, text, uuid), public.set_addon_active(text, boolean), public.set_addon_price(text, integer)
from public, anon, authenticated;
grant execute on function
  public.available_addons(uuid), public.request_addon(uuid, text, uuid), public.cancel_addon_request(uuid),
  public.mark_addon_paid(uuid, text, uuid), public.set_addon_active(text, boolean), public.set_addon_price(text, integer)
to authenticated;
