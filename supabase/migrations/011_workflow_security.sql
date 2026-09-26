-- 011_workflow_security.sql
-- Правила (согласованы 26.09.2026):
--  1. Отмена — только админом, с причиной, пока нет факта подачи (штат / IRS) ни у клиента, ни у партнёра.
--     Отмена деньги не возвращает: возвраты фиксируются отдельно в order_refunds.
--  2. Пакет LLC+ITIN: отказ по ITIN останавливает только поток ITIN; LLC продолжается; заказ закрывается после LLC.
--  3. Смена партнёра: неподтверждённый прогресс сбрасывается; факт подачи (order_milestones) сохраняется;
--     старый партнёр сразу теряет доступ; уже выданные ссылки на файлы живут до истечения (60 с).
-- Плюс: таблица переходов, идемпотентность (p_to + p_op), неизменяемый журнал, версии документов,
-- служебные функции прав убраны из публичного API, двухфакторная защита админа (включается настройкой).

-- ═══ 1. Настройки и двухфакторная защита админа ═══════════════════════════════
create table taxpasso_private.settings (key text primary key, value text not null);
insert into taxpasso_private.settings(key, value) values ('require_admin_mfa', 'false');
revoke all on taxpasso_private.settings from public, anon, authenticated;

create function taxpasso_private.admin_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from taxpasso_private.settings where key = 'require_admin_mfa'), 'false') <> 'true'
      or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
$$;

-- ═══ 2. Новые колонки и таблицы ══════════════════════════════════════════════
alter table public.orders
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 1000);

alter table public.documents
  add column replaces_document_id uuid references public.documents(id),
  add column superseded_at timestamptz;
grant insert(replaces_document_id) on public.documents to authenticated;

-- Факт подачи: сохраняется при смене партнёра и блокирует отмену.
create table public.order_milestones (
  order_id uuid not null references public.orders(id) on delete cascade,
  milestone text not null check (milestone in ('state_filed', 'irs_sent')),
  partner_id uuid references public.partners(id),
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  details text check (details is null or length(details) <= 500),
  primary key (order_id, milestone)
);

-- Возвраты: только запись, сумму фиксирует админ.
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  scope text not null check (scope in ('order', 'llc', 'itin', 'other')),
  reason text not null check (length(reason) between 3 and 1000),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index on public.order_refunds(order_id);

-- Неизменяемый журнал действий.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  actor uuid,
  actor_role text,
  order_id uuid,
  entity text not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text
);
create index on public.audit_log(order_id, at);

-- Ключи операций для идемпотентности.
create table taxpasso_private.operations (
  op_id uuid primary key,
  action text not null,
  order_id uuid,
  actor uuid,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on taxpasso_private.operations from public, anon, authenticated;

-- Таблица переходов (формальная спецификация этапов).
create table taxpasso_private.transitions (
  flow text not null check (flow in ('llc', 'itin')),
  from_status public.order_status not null,
  to_status public.order_status not null,
  primary key (flow, from_status)
);
insert into taxpasso_private.transitions(flow, from_status, to_status) values
  ('llc', 'application', 'review'),
  ('llc', 'review', 'filed_state'),
  ('llc', 'filed_state', 'registered'),
  ('llc', 'registered', 'ein_requested'),
  ('llc', 'ein_requested', 'ein_received'),
  ('itin', 'documents', 'caa_interview'),
  ('itin', 'caa_interview', 'sent_irs'),
  ('itin', 'sent_irs', 'itin_received');
revoke all on taxpasso_private.transitions from public, anon, authenticated;

-- ═══ 3. Служебные функции прав — в закрытую схему ════════════════════════════
create function taxpasso_private.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case when p.role = 'admin' and not taxpasso_private.admin_mfa_ok() then null else p.role end
  from public.profiles p where p.id = (select auth.uid())
$$;

create function taxpasso_private.can_read_order(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id = p_order
                    and (o.client_id = (select auth.uid())
                         or taxpasso_private.current_role() = 'admin'
                         or (taxpasso_private.current_role() = 'partner'
                             and exists (select 1 from public.partners p
                                          where p.id = o.partner_id and p.profile_id = (select auth.uid())))))
$$;

create function taxpasso_private.can_manage_order(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(taxpasso_private.current_role() = 'admin', false)
      or (coalesce(taxpasso_private.current_role() = 'partner', false)
          and exists (select 1 from public.orders o join public.partners p on p.id = o.partner_id
                       where o.id = p_order and p.profile_id = (select auth.uid())))
$$;

create function taxpasso_private.can_access_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id::text = split_part(p_path, '/', 1) and taxpasso_private.can_read_order(o.id))
$$;

create function taxpasso_private.can_manage_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id::text = split_part(p_path, '/', 1) and taxpasso_private.can_manage_order(o.id))
$$;

create function taxpasso_private.is_published_for_client(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.partner_documents pd join public.orders o on o.id = pd.order_id
                  where pd.path = p_path and pd.visibility = 'published' and o.client_id = (select auth.uid()))
$$;

create function taxpasso_private.can_edit_setup(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id = p_order and o.cancelled_at is null
                    and ((o.client_id = (select auth.uid()) and o.status in ('draft', 'application'))
                         or taxpasso_private.can_manage_order(o.id)))
$$;

revoke all on function
  taxpasso_private.admin_mfa_ok(),
  taxpasso_private.current_role(), taxpasso_private.can_read_order(uuid), taxpasso_private.can_manage_order(uuid),
  taxpasso_private.can_access_object(text), taxpasso_private.can_manage_object(text),
  taxpasso_private.is_published_for_client(text), taxpasso_private.can_edit_setup(uuid)
from public, anon, authenticated;
-- Эти функции вызываются правилами доступа от имени пользователя. Схема taxpasso_private не открыта в API.
grant execute on function
  taxpasso_private.current_role(), taxpasso_private.can_read_order(uuid), taxpasso_private.can_manage_order(uuid),
  taxpasso_private.can_access_object(text), taxpasso_private.can_manage_object(text),
  taxpasso_private.is_published_for_client(text), taxpasso_private.can_edit_setup(uuid)
to authenticated;

-- Публичные версии остаются для серверных функций, но делегируют закрытым (с учётом MFA).
create or replace function public.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$ select taxpasso_private.current_role() $$;
create or replace function public.can_read_order(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select taxpasso_private.can_read_order(p_order) $$;
create or replace function public.can_manage_order(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select taxpasso_private.can_manage_order(p_order) $$;
create or replace function public.can_access_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$ select taxpasso_private.can_access_object(p_path) $$;
create or replace function public.can_manage_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$ select taxpasso_private.can_manage_object(p_path) $$;
create or replace function public.is_published_for_client(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$ select taxpasso_private.is_published_for_client(p_path) $$;
create or replace function public.can_edit_setup(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select taxpasso_private.can_edit_setup(p_order) $$;

-- Переписываем правила доступа на закрытые функции.
do $$
declare
  p record; q text; w text; roles text; stmt text;
  pat constant text := '(public\.)?"?(current_role|can_read_order|can_manage_order|can_access_object|can_manage_object|is_published_for_client|can_edit_setup)"?\(';
begin
  for p in select * from pg_policies
            where schemaname in ('public', 'storage')
              and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    q := regexp_replace(p.qual, pat, 'taxpasso_private.\2(', 'g');
    w := regexp_replace(p.with_check, pat, 'taxpasso_private.\2(', 'g');
    select string_agg(quote_ident(r::text), ', ') into roles from unnest(p.roles) r;
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    stmt := format('create policy %I on %I.%I as %s for %s to %s',
                   p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, roles);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
    execute stmt;
  end loop;

  if exists (select 1 from pg_policies
              where schemaname in ('public', 'storage')
                and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
                    ~ '(public\.|[ (,=!])"?(current_role|can_read_order|can_manage_order|can_access_object|can_manage_object|is_published_for_client|can_edit_setup)"?\(') then
    raise exception '011: остались правила доступа с публичными служебными функциями';
  end if;
end $$;

revoke all on function
  public.current_role(), public.can_read_order(uuid), public.can_manage_order(uuid),
  public.can_access_object(text), public.can_manage_object(text),
  public.is_published_for_client(text), public.can_edit_setup(uuid)
from public, anon, authenticated;

drop function if exists public.set_user_role(uuid, public.app_role);

-- ═══ 4. Доступ к новым таблицам ══════════════════════════════════════════════
alter table public.order_milestones enable row level security;
create policy milestones_read on public.order_milestones for select to authenticated
  using (taxpasso_private.can_manage_order(order_id));
revoke all on public.order_milestones from anon, authenticated;
grant select on public.order_milestones to authenticated;

alter table public.order_refunds enable row level security;
create policy refunds_read on public.order_refunds for select to authenticated
  using (taxpasso_private.current_role() = 'admin'
         or exists (select 1 from public.orders o where o.id = order_id and o.client_id = (select auth.uid())));
revoke all on public.order_refunds from anon, authenticated;
grant select on public.order_refunds to authenticated;

alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated
  using (taxpasso_private.current_role() = 'admin');
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- ═══ 5. Вспомогательные серверные функции ════════════════════════════════════
create function taxpasso_private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
     and not taxpasso_private.admin_mfa_ok() then
    raise exception 'MFA required';
  end if;
  if taxpasso_private.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
end $$;

create function taxpasso_private.claim_op(p_op uuid, p_action text, p_order uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_op is null then raise exception 'Operation id required'; end if;
  insert into taxpasso_private.operations(op_id, action, order_id, actor)
  values (p_op, p_action, p_order, (select auth.uid()))
  on conflict (op_id) do nothing;
  return found;
end $$;

revoke all on function taxpasso_private.require_admin(), taxpasso_private.claim_op(uuid, text, uuid)
  from public, anon, authenticated;

-- ═══ 6. Переходы по таблице ══════════════════════════════════════════════════
create or replace function public.next_status_checked(p_order uuid, p_stream text, p_from public.order_status, p_for_admin boolean)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_flow text; nxt public.order_status;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.cancelled_at is not null then raise exception 'Order cancelled'; end if;
  if o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.payment_status <> 'paid' then raise exception 'Payment required'; end if;
  if p_stream = 'itin' then
    if o.product not in ('bundle_wy', 'bundle_de') then raise exception 'Invalid transition'; end if;
    if o.eligibility <> 'approved' then raise exception 'Eligibility approval required'; end if;
    v_flow := 'itin';
  elsif o.product in ('itin_standard', 'itin_return') then
    if o.eligibility <> 'approved' then raise exception 'Partner eligibility approval required'; end if;
    v_flow := 'itin';
  else
    v_flow := 'llc';
  end if;
  select t.to_status into nxt from taxpasso_private.transitions t
   where t.flow = v_flow and t.from_status = p_from;
  if nxt is null then raise exception 'Invalid transition'; end if;
  if nxt = 'ein_received' then
    if p_for_admin then
      if not exists (select 1 from public.companies c where c.order_id = p_order and c.ein is not null and c.approved) then
        raise exception 'Company EIN required';
      end if;
      if (select count(distinct pd.doc_type) from public.partner_documents pd
           where pd.order_id = p_order and pd.visibility = 'published'
             and pd.doc_type in ('articles', 'ein_letter', 'operating_agreement')) < 3 then
        raise exception 'Final documents required';
      end if;
    else
      if not exists (select 1 from public.companies c where c.order_id = p_order and c.ein is not null) then
        raise exception 'Partner EIN required';
      end if;
      if (select count(distinct pd.doc_type) from public.partner_documents pd
           where pd.order_id = p_order and pd.visibility in ('admin_review', 'published')
             and pd.doc_type in ('articles', 'ein_letter', 'operating_agreement')) < 3 then
        raise exception 'Partner documents required';
      end if;
    end if;
  end if;
  return nxt;
end $$;

-- Закрытие: отменённые не закрываются этим путём; пакет закрывается и при отказе по ITIN.
create or replace function public.close_if_complete(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; c public.companies; done boolean;
begin
  select * into o from public.orders where id = p_order;
  if o.cancelled_at is not null or o.closed_at is not null then return; end if;
  done := case
    when o.product in ('itin_standard', 'itin_return') then o.status = 'itin_received'
    when o.product in ('bundle_wy', 'bundle_de') then
      o.status = 'ein_received' and (o.itin_status = 'itin_received' or o.eligibility = 'rejected')
    else o.status = 'ein_received' end;
  if not done then return; end if;
  select * into c from public.companies where order_id = p_order;
  update public.orders
     set closed_at = clock_timestamp(),
         service_until = case when o.product in ('itin_standard', 'itin_return') then null
                              else (coalesce(c.registered_on, current_date) + make_interval(years => o.service_years))::date end
   where id = p_order;
end $$;

-- Факт подачи.
create function taxpasso_private.record_milestone(p_order uuid, p_status public.order_status, p_partner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status in ('filed_state', 'sent_irs') then
    insert into public.order_milestones(order_id, milestone, partner_id, recorded_by)
    values (p_order, case when p_status = 'filed_state' then 'state_filed' else 'irs_sent' end, p_partner, (select auth.uid()))
    on conflict (order_id, milestone) do nothing;
  end if;
end $$;
revoke all on function taxpasso_private.record_milestone(uuid, public.order_status, uuid) from public, anon, authenticated;

-- ═══ 7. Два ключа с идемпотентностью ═════════════════════════════════════════
drop function if exists public.propose_status(uuid, text);
drop function if exists public.confirm_status(uuid, text);

-- Партнёр: «перевести в p_to». Повтор с тем же p_op или уже достигнутый этап — «already_done».
create function public.propose_status(p_order uuid, p_stream text, p_to public.order_status, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orders; cur public.order_status; nxt public.order_status;
begin
  if not coalesce(taxpasso_private.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  if p_stream not in ('main', 'itin') then raise exception 'Invalid stream'; end if;
  select * into o from public.orders where id = p_order for update;
  if not taxpasso_private.claim_op(p_op, 'propose_status', p_order) then return 'already_done'; end if;
  select proposed_status into cur from public.status_proposals where order_id = p_order and stream = p_stream;
  cur := coalesce(cur, case when p_stream = 'itin' then o.itin_status else o.status end);
  if cur = p_to then return 'already_done'; end if;
  nxt := public.next_status_checked(p_order, p_stream, cur, false);
  if nxt is distinct from p_to then raise exception 'Status changed'; end if;
  insert into public.status_proposals(order_id, stream, proposed_status, proposed_by)
  values (p_order, p_stream, nxt, (select auth.uid()))
  on conflict (order_id, stream) do update
    set proposed_status = excluded.proposed_status, proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
  perform taxpasso_private.record_milestone(p_order, nxt, o.partner_id);
  return 'ok';
end $$;

-- Админ: «подтвердить клиенту p_to». Если партнёр назначен — только когда он дошёл дальше клиента.
create function public.confirm_status(p_order uuid, p_stream text, p_to public.order_status, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orders; pr public.status_proposals; cur public.order_status; nxt public.order_status;
begin
  perform taxpasso_private.require_admin();
  if p_stream not in ('main', 'itin') then raise exception 'Invalid stream'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if not taxpasso_private.claim_op(p_op, 'confirm_status', p_order) then return 'already_done'; end if;
  cur := case when p_stream = 'itin' then o.itin_status else o.status end;
  if cur = p_to then return 'already_done'; end if;
  select * into pr from public.status_proposals where order_id = p_order and stream = p_stream;
  if o.partner_id is not null and (pr.order_id is null or pr.proposed_status = cur) then
    raise exception 'Waiting for partner';
  end if;
  nxt := public.next_status_checked(p_order, p_stream, cur, true);
  if nxt is distinct from p_to then raise exception 'Status changed'; end if;
  if p_stream = 'itin' then
    update public.orders set itin_status = nxt, updated_at = now() where id = p_order;
  else
    update public.orders set status = nxt, updated_at = now() where id = p_order;
  end if;
  if pr.order_id is not null and pr.proposed_status = nxt then
    delete from public.status_proposals where order_id = p_order and stream = p_stream;
  end if;
  perform taxpasso_private.record_milestone(p_order, nxt, o.partner_id);
  perform public.close_if_complete(p_order);
  return 'ok';
end $$;

create or replace function public.reject_status_proposal(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  delete from public.status_proposals where order_id = p_order and stream = p_stream;
  if not found then raise exception 'No proposal'; end if;
end $$;

-- ═══ 8. Смена партнёра ═══════════════════════════════════════════════════════
create or replace function public.assign_partner(p_order uuid, p_partner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if not exists (select 1 from public.partners p join public.profiles u on u.id = p.profile_id
                  where p.id = p_partner and u.role = 'partner') then
    raise exception 'Invalid partner';
  end if;
  if o.partner_id is distinct from p_partner then
    -- Неподтверждённый прогресс прежнего партнёра сбрасывается; факты подачи (order_milestones) остаются.
    delete from public.status_proposals where order_id = p_order;
    update public.orders set partner_id = p_partner, updated_at = now() where id = p_order;
  end if;
end $$;

-- ═══ 9. Отмена и возвраты ════════════════════════════════════════════════════
create function public.cancel_order(p_order uuid, p_reason text, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders; filed public.order_status[] :=
  array['filed_state','registered','ein_requested','ein_received','sent_irs','itin_received']::public.order_status[];
begin
  perform taxpasso_private.require_admin();
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if not taxpasso_private.claim_op(p_op, 'cancel_order', p_order) then return 'already_done'; end if;
  if o.cancelled_at is not null then return 'already_done'; end if;
  if o.closed_at is not null then raise exception 'Order closed'; end if;
  if exists (select 1 from public.order_milestones m where m.order_id = p_order)
     or o.status = any(filed) or o.itin_status = any(filed)
     or exists (select 1 from public.status_proposals sp where sp.order_id = p_order and sp.proposed_status = any(filed)) then
    raise exception 'Already filed';
  end if;
  perform set_config('taxpasso.reason', left(trim(p_reason), 1000), true);
  update public.orders
     set cancelled_at = clock_timestamp(), cancelled_by = (select auth.uid()), cancel_reason = left(trim(p_reason), 1000),
         closed_at = clock_timestamp(), service_until = null, updated_at = now()
   where id = p_order;
  delete from public.status_proposals where order_id = p_order;
  return 'ok';
end $$;

create function public.record_refund(p_order uuid, p_amount_cents integer, p_scope text, p_reason text, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'Order not found'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be positive'; end if;
  if p_scope not in ('order', 'llc', 'itin', 'other') then raise exception 'Invalid scope'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
  if not taxpasso_private.claim_op(p_op, 'record_refund', p_order) then return 'already_done'; end if;
  perform set_config('taxpasso.reason', left(trim(p_reason), 1000), true);
  insert into public.order_refunds(order_id, amount_cents, scope, reason, created_by)
  values (p_order, p_amount_cents, p_scope, left(trim(p_reason), 1000), (select auth.uid()));
  return 'ok';
end $$;

-- ═══ 10. Отказ по ITIN: в пакете останавливает только ITIN ════════════════════
create or replace function public.reject_eligibility(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if not coalesce(taxpasso_private.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Cannot reject: order not found, not ITIN, or already paid'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('bundle_wy', 'bundle_de') then
    if o.itin_status = 'itin_received' then raise exception 'ITIN already received'; end if;
  elsif o.product in ('itin_standard', 'itin_return') then
    if o.payment_status <> 'unpaid' then raise exception 'Cannot reject: order not found, not ITIN, or already paid'; end if;
  else
    raise exception 'Cannot reject: order not found, not ITIN, or already paid';
  end if;
  perform set_config('taxpasso.reason', left(p_reason, 1000), true);
  update public.orders
     set eligibility = 'rejected', eligibility_note = left(p_reason, 1000),
         eligibility_decided_by = (select auth.uid()), eligibility_decided_at = now(), updated_at = now()
   where id = p_order;
  delete from public.status_proposals where order_id = p_order and stream = 'itin';
  perform public.close_if_complete(p_order);
end $$;

-- ═══ 11. Версии документов клиента ═══════════════════════════════════════════
create function public.handle_document_replacement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare prev public.documents;
begin
  if new.replaces_document_id is null then return new; end if;
  select * into prev from public.documents where id = new.replaces_document_id for update;
  if not found or prev.order_id <> new.order_id then
    raise exception 'Replaced document must belong to the same order';
  end if;
  if prev.superseded_at is not null then raise exception 'Document already replaced'; end if;
  new.kind := prev.kind;
  new.member_id := coalesce(new.member_id, prev.member_id);
  update public.documents set superseded_at = clock_timestamp() where id = prev.id;
  return new;
end $$;
create trigger handle_document_replacement before insert on public.documents
  for each row execute function public.handle_document_replacement();

-- ═══ 12. Журнал: запись триггерами, изменение запрещено ══════════════════════
create function taxpasso_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_order uuid;
begin
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;
  if TG_TABLE_NAME = 'orders' then
    v_order := coalesce(v_new, v_old) ->> 'id';
    v_old := v_old - 'applicant';
    v_new := v_new - 'applicant';
  elsif TG_TABLE_NAME <> 'partner_applications' then
    v_order := coalesce(v_new, v_old) ->> 'order_id';
  end if;
  insert into public.audit_log(actor, actor_role, order_id, entity, action, old_value, new_value, reason)
  values ((select auth.uid()),
          (select role::text from public.profiles where id = (select auth.uid())),
          v_order, TG_TABLE_NAME, lower(TG_OP), v_old, v_new,
          nullif(current_setting('taxpasso.reason', true), ''));
  return null;
end $$;

create function taxpasso_private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit log is append-only';
end $$;

revoke all on function taxpasso_private.audit_row(), taxpasso_private.audit_immutable(),
  public.handle_document_replacement() from public, anon, authenticated;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function taxpasso_private.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function taxpasso_private.audit_immutable();

create trigger audit_orders_insert after insert on public.orders
  for each row execute function taxpasso_private.audit_row();
create trigger audit_orders_update after update on public.orders
  for each row when (
    old.status is distinct from new.status or old.itin_status is distinct from new.itin_status
    or old.partner_id is distinct from new.partner_id or old.payment_status is distinct from new.payment_status
    or old.eligibility is distinct from new.eligibility or old.cancelled_at is distinct from new.cancelled_at
    or old.service_years is distinct from new.service_years or old.closed_at is distinct from new.closed_at)
  execute function taxpasso_private.audit_row();
create trigger audit_proposals after insert or update or delete on public.status_proposals
  for each row execute function taxpasso_private.audit_row();
create trigger audit_partner_documents after insert or update on public.partner_documents
  for each row execute function taxpasso_private.audit_row();
create trigger audit_documents after insert or update on public.documents
  for each row execute function taxpasso_private.audit_row();
create trigger audit_companies after insert or update on public.companies
  for each row execute function taxpasso_private.audit_row();
create trigger audit_partner_applications after update on public.partner_applications
  for each row execute function taxpasso_private.audit_row();
create trigger audit_refunds after insert on public.order_refunds
  for each row execute function taxpasso_private.audit_row();
create trigger audit_milestones after insert on public.order_milestones
  for each row execute function taxpasso_private.audit_row();

-- ═══ 13. Права на новые функции ══════════════════════════════════════════════
revoke all on function
  public.propose_status(uuid, text, public.order_status, uuid),
  public.confirm_status(uuid, text, public.order_status, uuid),
  public.cancel_order(uuid, text, uuid),
  public.record_refund(uuid, integer, text, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.propose_status(uuid, text, public.order_status, uuid),
  public.confirm_status(uuid, text, public.order_status, uuid),
  public.cancel_order(uuid, text, uuid),
  public.record_refund(uuid, integer, text, text, uuid)
to authenticated;
