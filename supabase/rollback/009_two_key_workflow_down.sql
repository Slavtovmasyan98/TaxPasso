-- Откат 009 → поведение после 008. ВНИМАНИЕ: удаляет предложения статусов, сроки пакета и отметки закрытия.
grant execute on function public.advance_order(uuid, public.order_status), public.advance_bundle_itin(uuid) to authenticated;
drop function if exists public.set_service_years(uuid, int);
drop function if exists public.reject_status_proposal(uuid, text);
drop function if exists public.confirm_status(uuid, text);
drop function if exists public.close_if_complete(uuid);
drop function if exists public.propose_status(uuid, text);
drop function if exists public.next_status_checked(uuid, text);
drop table if exists public.status_proposals;
drop function if exists public.approve_company(uuid);
drop policy deadlines_manage on public.deadlines;
create policy deadlines_manage on public.deadlines for all to authenticated
  using (public.can_manage_order(order_id)) with check (public.can_manage_order(order_id));
drop policy companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated using (public.can_read_order(order_id));
create policy companies_manage on public.companies for all to authenticated
  using (public.can_manage_order(order_id)) with check (public.can_manage_order(order_id));
grant insert, update, delete on public.companies to authenticated;
-- record_company вернуть из 008_company_delivery.sql (без approved) при необходимости
drop function if exists public.make_deadlines(uuid);
alter table public.companies drop column if exists approved_at, drop column if exists approved_by, drop column if exists approved;
alter table public.orders drop column if exists service_until, drop column if exists closed_at, drop column if exists service_years;
