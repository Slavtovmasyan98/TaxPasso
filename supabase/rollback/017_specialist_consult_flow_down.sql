-- Откат 017 → поведение после 015 (без учёта 016, значения enum остаются в типах, см. 016 rollback).
drop trigger if exists audit_orders_update on public.orders;
create trigger audit_orders_update after update on public.orders
  for each row when (
    old.status is distinct from new.status or old.itin_status is distinct from new.itin_status
    or old.partner_id is distinct from new.partner_id or old.payment_status is distinct from new.payment_status
    or old.eligibility is distinct from new.eligibility or old.cancelled_at is distinct from new.cancelled_at
    or old.service_years is distinct from new.service_years or old.closed_at is distinct from new.closed_at)
  execute function taxpasso_private.audit_row();

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

drop function if exists public.record_consult_contact(uuid, text, text, text);
drop function if exists public.reject_specialist_plan(uuid, text, uuid);
drop function if exists public.confirm_specialist_plan(uuid, uuid);
drop function if exists public.propose_specialist_plan(uuid, text, text, text, uuid);
drop table if exists public.specialist_proposals;

create or replace function public.submit_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.client_id is distinct from auth.uid() or o.status <> 'draft' then raise exception 'Not permitted'; end if;
  if coalesce(trim(o.applicant->>'name'), '') = '' or coalesce(trim(o.applicant->>'country'), '') = '' then
    raise exception 'Missing required fields';
  end if;
  if o.product not in ('itin_standard', 'itin_return')
     and (coalesce(trim(o.applicant->>'company'), '') = '' or coalesce(trim(o.applicant->>'activity'), '') = '') then
    raise exception 'Missing company details';
  end if;
  update public.orders
     set status = case when product in ('itin_standard', 'itin_return') then 'documents'::public.order_status
                       else 'application'::public.order_status end,
         itin_status = case when product in ('bundle_wy', 'bundle_de') then 'documents'::public.order_status else null end,
         updated_at = now()
   where id = p_order;
end $$;

alter table public.partners drop constraint if exists partners_qualification_check;
alter table public.partners add constraint partners_qualification_check
  check (qualification = any (array['CAA', 'CPA', 'CAA/CPA']));
-- Примечание: если к этому моменту есть партнёры с qualification='SPECIALIST' — сначала измените их
-- квалификацию или удалите записи, иначе ALTER TABLE ... ADD CONSTRAINT завершится ошибкой.
