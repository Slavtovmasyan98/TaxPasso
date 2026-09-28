-- 017_specialist_consult_flow.sql
-- Консультация специалиста для опросника: исходы "Не знаю" и "Налоговой причины, похоже, нет".
-- Правила (подтверждены 28.09.2026):
--  1. Specialist — новая квалификация партнёра, отдельная от CAA/CPA. Назначается только на itin_consult.
--  2. Специалист только ПРЕДЛАГАЕТ план (одобрить + рекомендуемый продукт, или отклонить с причиной).
--     Админ подтверждает (выполняет предложение как есть) или отклоняет сам (переопределяет, с любой причиной).
--     Отказ — в любом случае: клиент видит отказ, заказ закрывается.
--  3. Одобрение переводит заказ в itin_standard/itin_return, eligibility='approved', этап 'documents'.
--     Оплата остаётся недоступна, пока заказ на itin_consult — старое правило "оплата после
--     одобрения основания" не нарушается: к моменту одобрения продукт уже meняется вместе с eligibility.
--  4. Назначение CAA/CPA — отдельное действие админа ПОСЛЕ одобрения (обычный assign_partner).
--     Specialist на это не влияет: как только продукт сменился, assign_partner проверяет
--     квалификацию уже под новый продукт, и специалист теряет право быть партнёром заказа.
--  5. Контакт клиента (Telegram/WhatsApp, удобное время) хранится в orders.applicant, как quiz_ssn/quiz_basis.

-- ═══ 1. Квалификация Specialist ══════════════════════════════════════════════
alter table public.partners drop constraint if exists partners_qualification_check;
alter table public.partners add constraint partners_qualification_check
  check (qualification = any (array['CAA', 'CPA', 'CAA/CPA', 'SPECIALIST']));

-- ═══ 2. Предложение плана специалистом ═══════════════════════════════════════
create table public.specialist_proposals (
  order_id uuid primary key references public.orders(id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject')),
  recommended_product public.product_type
    check (recommended_product is null or recommended_product in ('itin_standard', 'itin_return')),
  reason text check (reason is null or length(reason) <= 1000),
  proposed_by uuid references public.profiles(id),
  proposed_at timestamptz not null default clock_timestamp(),
  constraint specialist_proposals_shape check (
    (decision = 'approve' and recommended_product is not null)
    or (decision = 'reject' and reason is not null and length(reason) >= 3)
  )
);
alter table public.specialist_proposals enable row level security;
create policy specialist_proposals_read on public.specialist_proposals for select to authenticated
  using (taxpasso_private.can_manage_order(order_id));
revoke all on public.specialist_proposals from anon, authenticated;
grant select on public.specialist_proposals to authenticated;

create trigger audit_specialist_proposals after insert or update or delete on public.specialist_proposals
  for each row execute function taxpasso_private.audit_row();

-- ═══ 3. Партнёр (Specialist): предложить план ════════════════════════════════
create function public.propose_specialist_plan(
  p_order uuid, p_decision text, p_recommended_product text, p_reason text, p_op uuid
) returns text language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if not coalesce(taxpasso_private.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid decision'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found or o.product <> 'itin_consult' then raise exception 'Not a consult order'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if not taxpasso_private.claim_op(p_op, 'propose_specialist_plan', p_order) then return 'already_done'; end if;
  if p_decision = 'approve' then
    if p_recommended_product not in ('itin_standard', 'itin_return') then
      raise exception 'Recommended product must be itin_standard or itin_return';
    end if;
    insert into public.specialist_proposals(order_id, decision, recommended_product, reason, proposed_by)
    values (p_order, 'approve', p_recommended_product::public.product_type, nullif(trim(coalesce(p_reason, '')), ''), (select auth.uid()))
    on conflict (order_id) do update
      set decision = excluded.decision, recommended_product = excluded.recommended_product,
          reason = excluded.reason, proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
  else
    if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
    insert into public.specialist_proposals(order_id, decision, recommended_product, reason, proposed_by)
    values (p_order, 'reject', null, left(trim(p_reason), 1000), (select auth.uid()))
    on conflict (order_id) do update
      set decision = excluded.decision, recommended_product = null,
          reason = excluded.reason, proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
  end if;
  return 'ok';
end $$;

-- ═══ 4. Админ: подтвердить план как есть ═════════════════════════════════════
create function public.confirm_specialist_plan(p_order uuid, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare pr public.specialist_proposals; o public.orders;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.product <> 'itin_consult' then raise exception 'Not a consult order'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if not taxpasso_private.claim_op(p_op, 'confirm_specialist_plan', p_order) then return 'already_done'; end if;
  select * into pr from public.specialist_proposals where order_id = p_order;
  if not found then raise exception 'No proposal'; end if;
  if pr.decision = 'approve' then
    update public.orders
       set product = pr.recommended_product, status = 'documents', eligibility = 'approved',
           eligibility_note = null, eligibility_decided_by = (select auth.uid()),
           eligibility_decided_at = clock_timestamp(), updated_at = now()
     where id = p_order;
  else
    perform set_config('taxpasso.reason', pr.reason, true);
    update public.orders
       set eligibility = 'rejected', eligibility_note = pr.reason,
           eligibility_decided_by = (select auth.uid()), eligibility_decided_at = clock_timestamp(),
           closed_at = clock_timestamp(), updated_at = now()
     where id = p_order;
  end if;
  delete from public.specialist_proposals where order_id = p_order;
  return 'ok';
end $$;

-- ═══ 5. Админ: отклонить самостоятельно (переопределить специалиста) ═════════
create function public.reject_specialist_plan(p_order uuid, p_reason text, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform taxpasso_private.require_admin();
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.product <> 'itin_consult' then raise exception 'Not a consult order'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if not taxpasso_private.claim_op(p_op, 'reject_specialist_plan', p_order) then return 'already_done'; end if;
  perform set_config('taxpasso.reason', left(trim(p_reason), 1000), true);
  update public.orders
     set eligibility = 'rejected', eligibility_note = left(trim(p_reason), 1000),
         eligibility_decided_by = (select auth.uid()), eligibility_decided_at = clock_timestamp(),
         closed_at = clock_timestamp(), updated_at = now()
   where id = p_order;
  delete from public.specialist_proposals where order_id = p_order;
  return 'ok';
end $$;

-- ═══ 6. Контакт клиента (Telegram/WhatsApp + удобное время) ══════════════════
create function public.record_consult_contact(p_order uuid, p_method text, p_value text, p_preferred_time text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.client_id <> (select auth.uid()) then raise exception 'Not permitted'; end if;
  if o.product <> 'itin_consult' then raise exception 'Not a consult order'; end if;
  if o.status not in ('draft', 'consult_interview') or o.cancelled_at is not null or o.closed_at is not null then
    raise exception 'Order closed';
  end if;
  if p_method not in ('telegram', 'whatsapp') then raise exception 'Invalid contact method'; end if;
  if length(trim(coalesce(p_value, ''))) not between 2 and 200 then raise exception 'Invalid contact value'; end if;
  if length(trim(coalesce(p_preferred_time, ''))) > 200 then raise exception 'Invalid preferred time'; end if;
  update public.orders
     set applicant = applicant
           || jsonb_build_object('contact_method', p_method, 'contact_value', trim(p_value),
                                  'preferred_time', nullif(trim(coalesce(p_preferred_time, '')), '')),
         updated_at = now()
   where id = p_order;
end $$;

-- ═══ 6a. submit_order: itin_consult освобождён от данных компании, стартует на consult_interview ═
create or replace function public.submit_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.client_id is distinct from auth.uid() or o.status <> 'draft' then raise exception 'Not permitted'; end if;
  if coalesce(trim(o.applicant->>'name'), '') = '' or coalesce(trim(o.applicant->>'country'), '') = '' then
    raise exception 'Missing required fields';
  end if;
  if o.product not in ('itin_standard', 'itin_return', 'itin_consult')
     and (coalesce(trim(o.applicant->>'company'), '') = '' or coalesce(trim(o.applicant->>'activity'), '') = '') then
    raise exception 'Missing company details';
  end if;
  update public.orders
     set status = case
           when product = 'itin_consult' then 'consult_interview'::public.order_status
           when product in ('itin_standard', 'itin_return') then 'documents'::public.order_status
           else 'application'::public.order_status end,
         itin_status = case when product in ('bundle_wy', 'bundle_de') then 'documents'::public.order_status else null end,
         updated_at = now()
   where id = p_order;
end $$;

-- ═══ 7. Назначение: Specialist только на itin_consult ════════════════════════
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
  if o.product = 'itin_consult' then
    if q <> 'SPECIALIST' then raise exception 'Partner must be a Specialist'; end if;
  else
    if q = 'SPECIALIST' then raise exception 'Invalid partner'; end if;
    if o.product = 'itin_return' and q <> 'CAA/CPA' then raise exception 'Partner must be CAA/CPA'; end if;
    if o.product in ('itin_standard', 'bundle_wy', 'bundle_de') and q not in ('CAA', 'CAA/CPA') then
      raise exception 'Partner must be CAA';
    end if;
  end if;
  if o.partner_id is distinct from p_partner then
    delete from public.status_proposals where order_id = p_order;
    delete from public.eligibility_proposals where order_id = p_order;
    delete from public.specialist_proposals where order_id = p_order;
    update public.orders set partner_id = p_partner, updated_at = now() where id = p_order;
  end if;
end $$;

-- ═══ 8. Оплата: itin_consult всегда заблокирован (в паре с существующим правилом) ═
create or replace function public.mark_order_paid_manually(p_order uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found or already paid'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('itin_standard', 'itin_return', 'itin_consult') and o.eligibility <> 'approved' then
    raise exception 'Eligibility approval required';
  end if;
  update public.orders
     set payment_status = 'paid', paid_at = clock_timestamp(),
         payment_marked_manually = true, payment_marked_by = (select auth.uid()),
         payment_note = left(nullif(trim(p_note), ''), 1000), updated_at = clock_timestamp()
   where id = p_order and payment_status <> 'paid';
  if not found then raise exception 'Order not found or already paid'; end if;
end $$;

-- ═══ 9. Журнал: учитывать смену продукта ═════════════════════════════════════
drop trigger if exists audit_orders_update on public.orders;
create trigger audit_orders_update after update on public.orders
  for each row when (
    old.status is distinct from new.status or old.itin_status is distinct from new.itin_status
    or old.partner_id is distinct from new.partner_id or old.payment_status is distinct from new.payment_status
    or old.eligibility is distinct from new.eligibility or old.cancelled_at is distinct from new.cancelled_at
    or old.service_years is distinct from new.service_years or old.closed_at is distinct from new.closed_at
    or old.product is distinct from new.product)
  execute function taxpasso_private.audit_row();

-- ═══ 10. Права ═══════════════════════════════════════════════════════════════
revoke all on function
  public.propose_specialist_plan(uuid, text, text, text, uuid),
  public.confirm_specialist_plan(uuid, uuid),
  public.reject_specialist_plan(uuid, text, uuid),
  public.record_consult_contact(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.propose_specialist_plan(uuid, text, text, text, uuid),
  public.confirm_specialist_plan(uuid, uuid),
  public.reject_specialist_plan(uuid, text, uuid),
  public.record_consult_contact(uuid, text, text, text)
to authenticated;
