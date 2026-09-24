-- Откат 002_foundation.sql → состояние после 001_taxpasso.sql.
-- ВНИМАНИЕ: удаляет данные новых таблиц (владельцы, данные компании, согласия,
-- флаги проверки) и колонки оплаты. Перед запуском сделайте бэкап базы.
begin;

-- Функции и триггеры шага 1
drop trigger if exists flag_order_review on public.orders;
drop trigger if exists touch_order on public.orders;
drop trigger if exists check_document_member on public.documents;

drop function if exists public.abandoned_draft_documents(integer);
drop function if exists public.order_payment_ready(uuid, uuid);
drop function if exists public.flag_order_review();
drop function if exists public.order_setup_complete(uuid);
drop function if exists public.check_document_member();
drop function if exists public.record_consent(uuid, text, text, text);
drop function if exists public.mark_order_paid(uuid, text, integer);

-- Ручная проверка
drop table if exists public.order_reviews;
drop schema if exists taxpasso_private cascade;

-- Документы: колонки типа и владельца
alter table public.documents drop column if exists member_id;
alter table public.documents drop column if exists kind;
drop type if exists public.document_kind;

-- Владельцы и компания
drop table if exists public.order_company;
drop table if exists public.order_members;
drop function if exists public.flag_member_review();
drop function if exists public.can_edit_setup(uuid);
drop function if exists public.touch_updated_at();

-- Согласия
drop table if exists public.order_consents;

-- Функции 001 без проверки оплаты
create or replace function public.advance_order(p_order uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; chain public.order_status[]; pos int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not coalesce(public.can_manage_order(p_order), false) then
    raise exception 'Not permitted';
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
  if o.eligibility <> 'approved' then raise exception 'Eligibility approval required'; end if;
  pos = array_position(chain, o.itin_status);
  if pos is null or pos >= 4 then raise exception 'Invalid transition'; end if;
  update public.orders set itin_status = chain[pos + 1], updated_at = now() where id = p_order;
end $$;

-- Оплата
alter table public.orders
  drop column if exists stripe_session_id,
  drop column if exists amount_cents,
  drop column if exists paid_at,
  drop column if exists payment_status;
drop type if exists public.payment_status;

commit;
