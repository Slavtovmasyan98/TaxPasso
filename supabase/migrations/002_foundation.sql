-- 002_foundation.sql
-- Шаг 1: фундамент базы данных.
-- Только добавляет новое и не ломает текущий интерфейс.
-- Откат: supabase/rollback/002_foundation_down.sql
begin;

-- ============================================================
-- 1. Оплата
-- Статус оплаты меняет только сервер (Stripe webhook через Edge Function).
-- Клиенту права на запись этих колонок не выдаются.
-- ============================================================
create type public.payment_status as enum ('unpaid', 'paid', 'refunded');

alter table public.orders
  add column payment_status public.payment_status not null default 'unpaid',
  add column paid_at timestamptz,
  add column amount_cents integer check (amount_cents is null or amount_cents > 0),
  add column stripe_session_id text unique;

-- Отмечает заказ оплаченным. Вызывает только service_role (webhook).
-- Идемпотентно: повторный вызов с той же сессией ничего не меняет.
create function public.mark_order_paid(p_order uuid, p_session text, p_amount_cents integer)
returns void language plpgsql set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_status = 'paid' then
    if o.stripe_session_id = p_session then return; end if;
    raise exception 'Order already paid by another session';
  end if;
  update public.orders
     set payment_status = 'paid', paid_at = now(),
         stripe_session_id = p_session, amount_cents = p_amount_cents
   where id = p_order;
end $$;

-- Партнёр не может начать работу по неоплаченному заказу.
-- Тело функции совпадает с 001, добавлена только проверка оплаты.
create or replace function public.advance_order(p_order uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; chain public.order_status[]; pos int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not coalesce(public.can_manage_order(p_order), false) then
    raise exception 'Not permitted';
  end if;
  if o.payment_status <> 'paid' then
    raise exception 'Payment required';
  end if;
  if o.product in ('itin_standard', 'itin_return') then
    chain = array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
    if o.eligibility <> 'approved' then
      raise exception 'Partner eligibility approval required';
    end if;
  else
    chain = array['application','review','filed_state','registered','ein_requested','ein_received']::public.order_status[];
  end if;
  pos = array_position(chain, o.status);
  if pos is null or pos >= array_length(chain, 1) or p_status is distinct from chain[pos + 1] then
    raise exception 'Invalid transition';
  end if;
  update public.orders set status = p_status, updated_at = now() where id = p_order;
end $$;

create or replace function public.advance_bundle_itin(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
        chain public.order_status[] = array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
        pos int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not coalesce(public.can_manage_order(p_order), false)
     or o.product not in ('bundle_wy', 'bundle_de') then
    raise exception 'Not permitted';
  end if;
  if o.payment_status <> 'paid' then
    raise exception 'Payment required';
  end if;
  if o.eligibility <> 'approved' then
    raise exception 'Eligibility approval required';
  end if;
  pos = array_position(chain, o.itin_status);
  if pos is null or pos >= 4 then raise exception 'Invalid transition'; end if;
  update public.orders set itin_status = chain[pos + 1], updated_at = now() where id = p_order;
end $$;

-- updated_at теперь обновляется при любом изменении заказа (раньше — только в RPC).
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger touch_order before update on public.orders
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 2. Согласие с условиями
-- Хранится дата, версия Terms и Refund Policy. Только добавление, без изменения.
-- ============================================================
create table public.order_consents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  terms_version text not null check (length(terms_version) between 1 and 40),
  refund_version text not null check (length(refund_version) between 1 and 40),
  user_agent text check (user_agent is null or length(user_agent) <= 500),
  accepted_at timestamptz not null default now()
);
create index on public.order_consents(order_id);

alter table public.order_consents enable row level security;
create policy consents_read on public.order_consents for select to authenticated
  using (public.can_read_order(order_id));
revoke all on public.order_consents from anon, authenticated;
grant select on public.order_consents to authenticated;

-- Клиент записывает согласие только через эту функцию и только по своему заказу.
create function public.record_consent(p_order uuid, p_terms_version text,
                                      p_refund_version text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.orders o
                  where o.id = p_order and o.client_id = auth.uid()
                    and o.status in ('draft', 'application')) then
    raise exception 'Not permitted';
  end if;
  insert into public.order_consents(order_id, user_id, terms_version, refund_version, user_agent)
  values (p_order, auth.uid(), p_terms_version, p_refund_version, left(p_user_agent, 500));
end $$;

-- ============================================================
-- 3. Владельцы и данные компании (для регистрации в штате и SS-4)
-- Клиент редактирует, пока заказ в статусе draft или application.
-- Назначенный партнёр и админ могут редактировать всегда.
-- ============================================================
create table public.order_members (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  first_name text not null check (length(first_name) between 1 and 80),
  middle_name text check (middle_name is null or length(middle_name) <= 80),
  last_name text not null check (length(last_name) between 1 and 80),
  birth_date date check (birth_date is null or birth_date >= '1900-01-01'),
  citizenship char(2) check (citizenship is null or citizenship ~ '^[A-Z]{2}$'),
  address_line text check (address_line is null or length(address_line) <= 200),
  city text check (city is null or length(city) <= 100),
  region text check (region is null or length(region) <= 100),
  postal_code text check (postal_code is null or length(postal_code) <= 20),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  phone text check (phone is null or phone ~ '^\+[0-9]{7,15}$'),
  email text check (email is null or (length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ownership_pct numeric(5,2) not null check (ownership_pct > 0 and ownership_pct <= 100),
  is_responsible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.order_members(order_id);
-- Не больше одного «ответственного лица» для SS-4 на заказ.
create unique index order_members_one_responsible on public.order_members(order_id) where is_responsible;

create table public.order_company (
  order_id uuid primary key references public.orders(id) on delete cascade,
  activity_category text check (activity_category in (
    'construction','rental_leasing','real_estate','manufacturing','transport_warehousing',
    'finance_insurance','health_care','accommodation_food','wholesale','retail',
    'it_online','other')),
  activity_other text check (activity_other is null or length(activity_other) <= 100),
  activity_description text check (activity_description is null or length(activity_description) <= 500),
  start_date date,
  has_us_employees boolean not null default false,
  management text not null default 'member' check (management in ('member', 'manager')),
  address_mode text not null default 'registered_agent' check (address_mode in ('registered_agent', 'mail_address')),
  updated_at timestamptz not null default now()
);

create trigger touch_member before update on public.order_members
  for each row execute function public.touch_updated_at();
create trigger touch_company before update on public.order_company
  for each row execute function public.touch_updated_at();

create function public.can_edit_setup(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id = p_order
                    and ((o.client_id = (select auth.uid()) and o.status in ('draft', 'application'))
                         or public.can_manage_order(o.id)))
$$;

alter table public.order_members enable row level security;
alter table public.order_company enable row level security;

create policy members_read on public.order_members for select to authenticated
  using (public.can_read_order(order_id));
create policy members_write on public.order_members for all to authenticated
  using (public.can_edit_setup(order_id)) with check (public.can_edit_setup(order_id));
create policy company_read on public.order_company for select to authenticated
  using (public.can_read_order(order_id));
create policy company_write on public.order_company for all to authenticated
  using (public.can_edit_setup(order_id)) with check (public.can_edit_setup(order_id));

revoke all on public.order_members, public.order_company from anon, authenticated;
grant select, insert, update, delete on public.order_members, public.order_company to authenticated;

-- ============================================================
-- 4. Типы документов
-- ============================================================
create type public.document_kind as enum (
  'passport', 'selfie', 'tax_return', 'exception_evidence', 'llc_agreement',
  'articles', 'ein_letter', 'itin_letter', 'other');

alter table public.documents
  add column kind public.document_kind not null default 'other',
  add column member_id uuid references public.order_members(id) on delete set null;
create index on public.documents(member_id);

grant insert(kind, member_id) on public.documents to authenticated;

-- Документ владельца должен принадлежать тому же заказу.
create function public.check_document_member() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.member_id is not null and not exists (
       select 1 from public.order_members m
        where m.id = new.member_id and m.order_id = new.order_id) then
    raise exception 'Member does not belong to this order';
  end if;
  return new;
end $$;
create trigger check_document_member before insert or update on public.documents
  for each row execute function public.check_document_member();

-- Готова ли анкета после оплаты: владельцы, доли = 100%, одно ответственное лицо,
-- данные компании и паспорт у каждого владельца.
create function public.order_setup_complete(p_order uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_order(p_order) then raise exception 'Not permitted'; end if;
  return
        exists (select 1 from public.order_members where order_id = p_order)
    and (select sum(ownership_pct) from public.order_members where order_id = p_order) = 100
    and (select count(*) from public.order_members where order_id = p_order and is_responsible) = 1
    and exists (select 1 from public.order_company c
                 where c.order_id = p_order and c.activity_category is not null
                   and coalesce(trim(c.activity_description), '') <> ''
                   and (c.activity_category <> 'other' or coalesce(trim(c.activity_other), '') <> ''))
    and not exists (select 1 from public.order_members m
                     where m.order_id = p_order
                       and not exists (select 1 from public.documents d
                                        where d.member_id = m.id and d.kind = 'passport'));
end $$;

-- ============================================================
-- 5. Ручная проверка по странам
-- Список стран — в приватной схеме, недоступной через API.
-- Клиент не видит ни список, ни флаги. Партнёр и админ видят флаги своих заказов.
-- ============================================================
create schema if not exists taxpasso_private;
revoke all on schema taxpasso_private from public, anon, authenticated;

create table taxpasso_private.review_countries (
  code char(2) primary key check (code ~ '^[A-Z]{2}$'),
  name_en text not null
);
insert into taxpasso_private.review_countries(code, name_en) values
  ('RU', 'Russia'), ('BY', 'Belarus'), ('IR', 'Iran'),
  ('KP', 'North Korea'), ('CU', 'Cuba'), ('SY', 'Syria');

create table public.order_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (reason in ('country')),
  resolved boolean not null default false,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  unique (order_id, reason)
);
alter table public.order_reviews enable row level security;
create policy reviews_read on public.order_reviews for select to authenticated
  using (public.can_manage_order(order_id));
create policy reviews_resolve on public.order_reviews for update to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
revoke all on public.order_reviews from anon, authenticated;
grant select on public.order_reviews to authenticated;
grant update(resolved, resolved_by, resolved_at, note) on public.order_reviews to authenticated;

create function taxpasso_private.is_review_country(p_value text) returns boolean
language sql stable set search_path = '' as $$
  select p_value is not null and exists (
    select 1 from taxpasso_private.review_countries r
     where r.code = upper(trim(p_value)) or lower(r.name_en) = lower(trim(p_value)))
$$;

create function public.flag_member_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if taxpasso_private.is_review_country(new.citizenship)
     or taxpasso_private.is_review_country(new.country) then
    insert into public.order_reviews(order_id, reason) values (new.order_id, 'country')
    on conflict (order_id, reason) do nothing;
  end if;
  return new;
end $$;
create trigger flag_member_review after insert or update on public.order_members
  for each row execute function public.flag_member_review();

-- Текущий интерфейс хранит страну текстом в orders.applicant->>'country'.
create function public.flag_order_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if taxpasso_private.is_review_country(new.applicant->>'country') then
    insert into public.order_reviews(order_id, reason) values (new.id, 'country')
    on conflict (order_id, reason) do nothing;
  end if;
  return new;
end $$;
create trigger flag_order_review after insert or update of applicant on public.orders
  for each row execute function public.flag_order_review();

-- ============================================================
-- 6. Готовность к оплате (для будущей Edge Function создания Stripe Checkout)
-- Проверяет: заказ клиента, не оплачен, есть согласие, ITIN одобрен,
-- нет нерешённой ручной проверки.
-- ============================================================
create function public.order_payment_ready(p_order uuid, p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order and o.client_id = p_user
       and o.payment_status = 'unpaid'
       and o.status in ('draft', 'application')
       and exists (select 1 from public.order_consents c where c.order_id = o.id)
       and (o.product in ('llc_wy', 'llc_de') or o.eligibility = 'approved')
       and not exists (select 1 from public.order_reviews r
                        where r.order_id = o.id and not r.resolved))
$$;

-- ============================================================
-- 7. Хранение паспортов: список файлов брошенных черновиков
-- Возвращает пути файлов неоплаченных черновиков старше N дней.
-- Удаление выполняет Edge Function через Storage API (шаг позже), затем удаляет строки.
-- ============================================================
create function public.abandoned_draft_documents(p_days integer default 30)
returns table(document_id uuid, path text) language sql stable set search_path = '' as $$
  select d.id, d.path
    from public.documents d join public.orders o on o.id = d.order_id
   where o.status = 'draft' and o.payment_status = 'unpaid'
     and o.updated_at < now() - make_interval(days => greatest(p_days, 7))
$$;

-- ============================================================
-- Права на функции
-- ============================================================
revoke all on function
  public.mark_order_paid(uuid, text, integer),
  public.touch_updated_at(),
  public.record_consent(uuid, text, text, text),
  public.can_edit_setup(uuid),
  public.check_document_member(),
  public.order_setup_complete(uuid),
  public.flag_member_review(),
  public.flag_order_review(),
  public.order_payment_ready(uuid, uuid),
  public.abandoned_draft_documents(integer)
from public, anon, authenticated;

grant execute on function
  public.record_consent(uuid, text, text, text),
  public.can_edit_setup(uuid),
  public.order_setup_complete(uuid)
to authenticated;

grant execute on function
  public.mark_order_paid(uuid, text, integer),
  public.order_payment_ready(uuid, uuid),
  public.abandoned_draft_documents(integer)
to service_role;

commit;
