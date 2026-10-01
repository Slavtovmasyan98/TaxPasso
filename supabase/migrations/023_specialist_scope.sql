-- 023_specialist_scope.sql — специалист работает только с консультациями.
-- До 023: после confirm_specialist_plan (approve) консультация становилась обычным ITIN-заказом, а специалист
-- оставался назначенным, пока админ не передаст заказ CAA/CPA. Проверки партнёра (can_read_order,
-- can_manage_order, partner_orders) смотрят только «назначен ли партнёр», поэтому в это окно специалист
-- мог читать документы клиента (паспорт), двигать этапы ITIN, предлагать решения по документам и вносить ITIN.
-- 023:
--   1) confirm_specialist_plan при одобрении снимает специалиста с заказа (partner_id = null);
--   2) партнёр с квалификацией SPECIALIST читает и ведёт только заказы itin_consult — даже если окажется
--      назначен на другой заказ (защита на будущее);
--   3) уже переведённые заказы, где всё ещё назначен специалист, освобождаются.
-- Идемпотентна.

-- 2) Общие проверки доступа партнёра: все политики RLS, хранилище и функции партнёра идут через них.
create or replace function taxpasso_private.can_read_order(p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id = p_order
                    and (o.client_id = (select auth.uid())
                         or taxpasso_private.current_role() = 'admin'
                         or (taxpasso_private.current_role() = 'partner'
                             and taxpasso_private.partner_access_open(o.cancelled_at, o.closed_at)
                             and exists (select 1 from public.partners p
                                          where p.id = o.partner_id and p.profile_id = (select auth.uid())
                                            and (p.qualification <> 'SPECIALIST' or o.product = 'itin_consult')))))
$$;

create or replace function taxpasso_private.can_manage_order(p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(taxpasso_private.current_role() = 'admin', false)
      or (coalesce(taxpasso_private.current_role() = 'partner', false)
          and exists (select 1 from public.orders o join public.partners p on p.id = o.partner_id
                       where o.id = p_order and p.profile_id = (select auth.uid())
                         and (p.qualification <> 'SPECIALIST' or o.product = 'itin_consult')
                         and taxpasso_private.partner_access_open(o.cancelled_at, o.closed_at)))
$$;

create or replace function public.partner_orders()
returns table(id uuid, product public.product_type, status public.order_status, itin_status public.order_status,
              eligibility public.eligibility_status, eligibility_note text, applicant jsonb,
              created_at timestamptz, updated_at timestamptz, partner_id uuid, in_work boolean,
              itin_attempt smallint, closed_at timestamptz, cancelled_at timestamptz, cancel_reason text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.product, o.status, o.itin_status, o.eligibility, o.eligibility_note, o.applicant,
         o.created_at, o.updated_at, o.partner_id,
         o.payment_status = 'paid', o.itin_attempt, o.closed_at, o.cancelled_at,
         null::text                                   -- cancel_reason партнёру не отдаём
    from public.orders o
   where taxpasso_private.current_role() = 'partner'
     and taxpasso_private.partner_access_open(o.cancelled_at, o.closed_at)
     and exists (select 1 from public.partners p where p.id = o.partner_id and p.profile_id = (select auth.uid())
                    and (p.qualification <> 'SPECIALIST' or o.product = 'itin_consult'))
   order by o.created_at desc
$$;

-- 1) Одобрение плана снимает специалиста: заказ ждёт назначения CAA/CPA администратором.
create or replace function public.confirm_specialist_plan(p_order uuid, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
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
           eligibility_decided_at = clock_timestamp(), partner_id = null, updated_at = now()
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

-- 3) Заказы, уже переведённые из консультации, где специалист всё ещё назначен.
update public.orders o
   set partner_id = null, updated_at = now()
  from public.partners p
 where p.id = o.partner_id and p.qualification = 'SPECIALIST' and o.product <> 'itin_consult';
