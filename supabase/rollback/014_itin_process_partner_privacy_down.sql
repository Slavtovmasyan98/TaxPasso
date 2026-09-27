-- Откат 014 → поведение после 012.
-- ВНИМАНИЕ: удаляет номера ITIN, события IRS, предложения по основанию и счётчик попыток.
drop trigger if exists audit_irs_events on public.itin_irs_events;
drop trigger if exists audit_order_itin on public.order_itin;
drop trigger if exists audit_eligibility_proposals on public.eligibility_proposals;

drop function if exists public.record_irs_event(uuid, text, text, text, uuid);
drop function if exists public.approve_itin(uuid);
drop function if exists public.record_itin(uuid, text, date);
drop function if exists public.return_eligibility_proposal(uuid);
drop function if exists public.confirm_eligibility(uuid, uuid);
drop function if exists public.propose_eligibility(uuid, text, text, uuid);
drop function if exists public.partner_orders();

drop table if exists public.eligibility_proposals;
drop table if exists public.order_itin;
drop table if exists public.itin_irs_events;

delete from taxpasso_private.transitions where flow = 'itin_return';
alter table taxpasso_private.transitions drop constraint if exists transitions_flow_check;
alter table taxpasso_private.transitions add constraint transitions_flow_check check (flow in ('llc', 'itin'));

-- Партнёр снова читает orders напрямую
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (client_id = (select auth.uid()) or taxpasso_private.current_role() = 'admin'
         or taxpasso_private.can_manage_order(id));

alter table public.orders drop column if exists itin_attempt;

-- Функции next_status_checked, mark_order_paid_manually, order_payment_ready, approve_eligibility,
-- reject_eligibility, assign_partner восстановите из migrations/011_workflow_security.sql и 012_itin_payment_gate.sql.
