-- 014_itin_process_partner_privacy.sql
-- Правила (утверждены 27.09.2026):
--  1. Всё через админа: партнёр ПРЕДЛАГАЕТ решение по основанию ITIN, клиент видит его после подтверждения админа.
--  2. ITIN Standard / ITIN + декларация: 100% вперёд, только после одобрения основания.
--     LLC и пакеты LLC+ITIN: полная оплата сразу, без ожидания проверки ITIN.
--     Отказ IRS → повторная подача бесплатно (счётчик попыток). Пакет: при отказе в основании ITIN — возврат $100 (фиксирует админ).
--  3. Партнёр не видит ничего о деньгах: нет прямого доступа к orders; заказы — через partner_orders() без денежных полей.
-- Плюс: процесс «ITIN + подготовка декларации», номер ITIN с одобрением, проверка квалификации партнёра при назначении.

-- ═══ 0. Счётчик попыток ITIN (нужен до partner_orders) ════════════════════════
alter table public.orders
  add column itin_attempt smallint not null default 1 check (itin_attempt between 1 and 10);

-- ═══ 1. Партнёр не видит денег ════════════════════════════════════════════════
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (client_id = (select auth.uid()) or taxpasso_private.current_role() = 'admin');

create function public.partner_orders()
returns table (
  id uuid, product public.product_type, status public.order_status, itin_status public.order_status,
  eligibility public.eligibility_status, eligibility_note text, applicant jsonb,
  created_at timestamptz, updated_at timestamptz, partner_id uuid,
  in_work boolean, itin_attempt smallint, closed_at timestamptz, cancelled_at timestamptz, cancel_reason text
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.product, o.status, o.itin_status, o.eligibility, o.eligibility_note, o.applicant,
         o.created_at, o.updated_at, o.partner_id,
         o.payment_status = 'paid', o.itin_attempt, o.closed_at, o.cancelled_at, o.cancel_reason
    from public.orders o
   where taxpasso_private.current_role() = 'partner'
     and exists (select 1 from public.partners p where p.id = o.partner_id and p.profile_id = (select auth.uid()))
   order by o.created_at desc
$$;

-- ═══ 2. Счётчик попыток ITIN и события IRS ════════════════════════════════════
create table public.itin_irs_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('request', 'rejection')),
  note text not null check (length(note) between 3 and 1000),
  attempt smallint not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index on public.itin_irs_events(order_id);
alter table public.itin_irs_events enable row level security;
create policy irs_events_read on public.itin_irs_events for select to authenticated
  using (taxpasso_private.can_manage_order(order_id)
         or exists (select 1 from public.orders o where o.id = order_id and o.client_id = (select auth.uid())));
revoke all on public.itin_irs_events from anon, authenticated;
grant select on public.itin_irs_events to authenticated;

-- ═══ 3. Номер ITIN: партнёр вносит, админ одобряет, клиент видит одобренный ═══
create table public.order_itin (
  order_id uuid primary key references public.orders(id) on delete cascade,
  itin text not null check (itin ~ '^9[0-9]{2}-[0-9]{2}-[0-9]{4}$'),
  assigned_on date,
  approved boolean not null default false,
  entered_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.order_itin enable row level security;
create policy order_itin_read on public.order_itin for select to authenticated
  using (taxpasso_private.can_manage_order(order_id)
         or (approved and exists (select 1 from public.orders o where o.id = order_id and o.client_id = (select auth.uid()))));
revoke all on public.order_itin from anon, authenticated;
grant select on public.order_itin to authenticated;

-- ═══ 4. Предложения партнёра по основанию ITIN ════════════════════════════════
create table public.eligibility_proposals (
  order_id uuid primary key references public.orders(id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject')),
  reason text check (reason is null or length(reason) <= 1000),
  proposed_by uuid references public.profiles(id),
  proposed_at timestamptz not null default clock_timestamp()
);
alter table public.eligibility_proposals enable row level security;
create policy eligibility_proposals_read on public.eligibility_proposals for select to authenticated
  using (taxpasso_private.can_manage_order(order_id));
revoke all on public.eligibility_proposals from anon, authenticated;
grant select on public.eligibility_proposals to authenticated;

-- ═══ 5. Переходы «ITIN + подготовка декларации» ════════════════════════════════
alter table taxpasso_private.transitions drop constraint if exists transitions_flow_check;
alter table taxpasso_private.transitions add constraint transitions_flow_check
  check (flow in ('llc', 'itin', 'itin_return'));
insert into taxpasso_private.transitions(flow, from_status, to_status) values
  ('itin_return', 'documents', 'return_prep'),
  ('itin_return', 'return_prep', 'client_signed'),
  ('itin_return', 'client_signed', 'caa_interview'),
  ('itin_return', 'caa_interview', 'sent_irs'),
  ('itin_return', 'sent_irs', 'itin_received');

create or replace function public.next_status_checked(p_order uuid, p_stream text, p_from public.order_status, p_for_admin boolean)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_flow text; nxt public.order_status;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.cancelled_at is not null then raise exception 'Order cancelled'; end if;
  if o.closed_at is not null then raise exception 'Order closed'; end if;
  -- Нейтральное сообщение: партнёр не должен видеть ничего о деньгах.
  if o.payment_status <> 'paid' then raise exception 'Not released'; end if;
  if p_stream = 'itin' then
    if o.product not in ('bundle_wy', 'bundle_de') then raise exception 'Invalid transition'; end if;
    if o.eligibility <> 'approved' then raise exception 'Eligibility approval required'; end if;
    v_flow := 'itin';
  elsif o.product = 'itin_return' then
    if o.eligibility <> 'approved' then raise exception 'Partner eligibility approval required'; end if;
    v_flow := 'itin_return';
  elsif o.product = 'itin_standard' then
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

  if nxt = 'itin_received' then
    if p_for_admin then
      if not exists (select 1 from public.order_itin i where i.order_id = p_order and i.approved) then
        raise exception 'ITIN required';
      end if;
      if not exists (select 1 from public.partner_documents pd
                      where pd.order_id = p_order and pd.visibility = 'published' and pd.doc_type::text = 'itin_letter') then
        raise exception 'ITIN letter required';
      end if;
    else
      if not exists (select 1 from public.order_itin i where i.order_id = p_order) then
        raise exception 'Partner ITIN required';
      end if;
      if not exists (select 1 from public.partner_documents pd
                      where pd.order_id = p_order and pd.visibility in ('admin_review', 'published')
                        and pd.doc_type::text = 'itin_letter') then
        raise exception 'Partner ITIN letter required';
      end if;
    end if;
  end if;
  return nxt;
end $$;

-- ═══ 6. Оплата: ITIN — после одобрения основания; LLC и пакеты — сразу ═══════════
create or replace function public.mark_order_paid_manually(p_order uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found or already paid'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('itin_standard', 'itin_return') and o.eligibility <> 'approved' then
    raise exception 'Eligibility approval required';
  end if;
  update public.orders
     set payment_status = 'paid', paid_at = clock_timestamp(),
         payment_marked_manually = true, payment_marked_by = (select auth.uid()),
         payment_note = left(nullif(trim(p_note), ''), 1000), updated_at = clock_timestamp()
   where id = p_order and payment_status <> 'paid';
  if not found then raise exception 'Order not found or already paid'; end if;
end $$;

create or replace function public.order_payment_ready(p_order uuid, p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order and o.client_id = p_user
       and o.payment_status = 'unpaid' and o.cancelled_at is null
       and o.status in ('draft', 'application', 'documents')
       and exists (select 1 from public.order_consents c where c.order_id = o.id)
       and (o.product in ('llc_wy', 'llc_de', 'bundle_wy', 'bundle_de') or o.eligibility = 'approved')
       and not exists (select 1 from public.order_reviews r where r.order_id = o.id and not r.resolved))
$$;

-- ═══ 7. Основание ITIN: партнёр предлагает, админ решает ═══════════════════════
create function public.propose_eligibility(p_order uuid, p_decision text, p_reason text, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if not coalesce(taxpasso_private.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid decision'; end if;
  if p_decision = 'reject' and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not taxpasso_private.claim_op(p_op, 'propose_eligibility', p_order) then return 'already_done'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('itin_standard', 'itin_return') then
    if o.eligibility <> 'pending' then raise exception 'Eligibility already decided'; end if;
  elsif o.product in ('bundle_wy', 'bundle_de') then
    if o.eligibility = 'rejected' or o.itin_status = 'itin_received' then raise exception 'Eligibility already decided'; end if;
    if o.eligibility = 'approved' and p_decision = 'approve' then raise exception 'Eligibility already decided'; end if;
  else
    raise exception 'Not an ITIN order';
  end if;
  insert into public.eligibility_proposals(order_id, decision, reason, proposed_by)
  values (p_order, p_decision, nullif(left(trim(coalesce(p_reason, '')), 1000), ''), (select auth.uid()))
  on conflict (order_id) do update
    set decision = excluded.decision, reason = excluded.reason,
        proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
  return 'ok';
end $$;

create or replace function public.approve_eligibility(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  update public.orders
     set eligibility = 'approved', eligibility_note = null,
         eligibility_decided_by = (select auth.uid()), eligibility_decided_at = now(), updated_at = now()
   where id = p_order and cancelled_at is null and closed_at is null
     and product in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de');
  if not found then raise exception 'Not an ITIN order or closed'; end if;
  delete from public.eligibility_proposals where order_id = p_order;
end $$;

create or replace function public.reject_eligibility(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform taxpasso_private.require_admin();
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
  delete from public.eligibility_proposals where order_id = p_order;
  delete from public.status_proposals where order_id = p_order and stream = 'itin';
  perform public.close_if_complete(p_order);
end $$;

-- Подтвердить предложение партнёра (или вернуть его партнёру).
create function public.confirm_eligibility(p_order uuid, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare pr public.eligibility_proposals;
begin
  perform taxpasso_private.require_admin();
  if not taxpasso_private.claim_op(p_op, 'confirm_eligibility', p_order) then return 'already_done'; end if;
  select * into pr from public.eligibility_proposals where order_id = p_order for update;
  if not found then raise exception 'No proposal'; end if;
  if pr.decision = 'approve' then perform public.approve_eligibility(p_order);
  else perform public.reject_eligibility(p_order, coalesce(pr.reason, 'Основание не подтверждено специалистом'));
  end if;
  return 'ok';
end $$;

create function public.return_eligibility_proposal(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  delete from public.eligibility_proposals where order_id = p_order;
  if not found then raise exception 'No proposal'; end if;
end $$;

-- ═══ 8. Номер ITIN ═══════════════════════════════════════════════════════════
create function public.record_itin(p_order uuid, p_itin text, p_assigned_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; is_admin boolean := taxpasso_private.current_role() = 'admin';
begin
  if not coalesce(taxpasso_private.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  select * into o from public.orders where id = p_order;
  if o.product not in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de') then raise exception 'Not an ITIN order'; end if;
  if trim(coalesce(p_itin, '')) !~ '^9[0-9]{2}-[0-9]{2}-[0-9]{4}$' then raise exception 'ITIN format must be 9XX-XX-XXXX'; end if;
  if p_assigned_on is not null and p_assigned_on > current_date then raise exception 'Invalid assignment date'; end if;
  insert into public.order_itin(order_id, itin, assigned_on, approved, entered_by, approved_by, approved_at)
  values (p_order, trim(p_itin), p_assigned_on, is_admin, (select auth.uid()),
          case when is_admin then (select auth.uid()) end, case when is_admin then clock_timestamp() end)
  on conflict (order_id) do update
    set itin = excluded.itin, assigned_on = excluded.assigned_on, approved = excluded.approved,
        entered_by = excluded.entered_by, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        updated_at = clock_timestamp();
end $$;

create function public.approve_itin(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  update public.order_itin
     set approved = true, approved_by = (select auth.uid()), approved_at = clock_timestamp(), updated_at = clock_timestamp()
   where order_id = p_order;
  if not found then raise exception 'ITIN not found'; end if;
end $$;

-- ═══ 9. Запрос и отказ IRS; повторная подача бесплатно ════════════════════════
create function public.record_irs_event(p_order uuid, p_stream text, p_kind text, p_note text, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orders; cur public.order_status;
begin
  perform taxpasso_private.require_admin();
  if p_kind not in ('request', 'rejection') then raise exception 'Invalid kind'; end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if not taxpasso_private.claim_op(p_op, 'record_irs_event', p_order) then return 'already_done'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if p_stream = 'itin' and o.product in ('bundle_wy', 'bundle_de') then cur := o.itin_status;
  elsif p_stream = 'main' and o.product in ('itin_standard', 'itin_return') then cur := o.status;
  else raise exception 'Invalid stream';
  end if;
  if cur is distinct from 'sent_irs' then raise exception 'Not at IRS stage'; end if;
  perform set_config('taxpasso.reason', left(trim(p_note), 1000), true);
  insert into public.itin_irs_events(order_id, kind, note, attempt, created_by)
  values (p_order, p_kind, left(trim(p_note), 1000), o.itin_attempt, (select auth.uid()));
  if p_kind = 'rejection' then
    if o.itin_attempt >= 10 then raise exception 'Too many attempts'; end if;
    -- Повторная подача бесплатно: поток ITIN возвращается к документам, попытка +1, оплата сохраняется.
    if p_stream = 'itin' then
      update public.orders set itin_status = 'documents', itin_attempt = itin_attempt + 1, updated_at = now() where id = p_order;
    else
      update public.orders set status = 'documents', itin_attempt = itin_attempt + 1, updated_at = now() where id = p_order;
    end if;
    delete from public.status_proposals where order_id = p_order and stream = p_stream;
  end if;
  return 'ok';
end $$;

-- ═══ 10. Назначение партнёра: проверка квалификации ═══════════════════════════
create or replace function public.assign_partner(p_order uuid, p_partner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; q text;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  select p.qualification into q from public.partners p join public.profiles u on u.id = p.profile_id
   where p.id = p_partner and u.role = 'partner';
  if q is null then raise exception 'Invalid partner'; end if;
  if o.product = 'itin_return' and q <> 'CAA/CPA' then raise exception 'Partner must be CAA/CPA'; end if;
  if o.product in ('itin_standard', 'bundle_wy', 'bundle_de') and q not in ('CAA', 'CAA/CPA') then
    raise exception 'Partner must be CAA';
  end if;
  if o.partner_id is distinct from p_partner then
    delete from public.status_proposals where order_id = p_order;
    delete from public.eligibility_proposals where order_id = p_order;
    update public.orders set partner_id = p_partner, updated_at = now() where id = p_order;
  end if;
end $$;

-- ═══ 11. Журнал для новых таблиц ══════════════════════════════════════════════
create trigger audit_eligibility_proposals after insert or update or delete on public.eligibility_proposals
  for each row execute function taxpasso_private.audit_row();
create trigger audit_order_itin after insert or update on public.order_itin
  for each row execute function taxpasso_private.audit_row();
create trigger audit_irs_events after insert on public.itin_irs_events
  for each row execute function taxpasso_private.audit_row();

-- ═══ 12. Права ═══════════════════════════════════════════════════════════════
revoke all on function
  public.partner_orders(),
  public.propose_eligibility(uuid, text, text, uuid),
  public.confirm_eligibility(uuid, uuid),
  public.return_eligibility_proposal(uuid),
  public.record_itin(uuid, text, date),
  public.approve_itin(uuid),
  public.record_irs_event(uuid, text, text, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.partner_orders(),
  public.propose_eligibility(uuid, text, text, uuid),
  public.confirm_eligibility(uuid, uuid),
  public.return_eligibility_proposal(uuid),
  public.record_itin(uuid, text, date),
  public.approve_itin(uuid),
  public.record_irs_event(uuid, text, text, text, uuid)
to authenticated;
