-- Откат 024: снимает анкету ITIN (W-7) и проверку анкеты перед этапом после «Документы».
-- ВНИМАНИЕ: таблица public.itin_applications удаляется вместе с анкетами клиентов. Сначала сохраните их:
--   copy (select * from public.itin_applications) to stdout with csv header;
-- next_status_checked возвращается к версии 019.

drop trigger if exists itin_applications_audit on public.itin_applications;
drop function if exists taxpasso_private.audit_itin_application();
drop function if exists public.return_itin_application(uuid, text);
drop function if exists public.submit_itin_application(uuid, jsonb);
drop function if exists public.save_itin_application(uuid, jsonb);
drop function if exists taxpasso_private.itin_application_problem(uuid, jsonb);
drop function if exists taxpasso_private.itin_application_order(uuid);
drop function if exists taxpasso_private.itin_application_clean(jsonb);
drop table if exists public.itin_applications;

create or replace function public.next_status_checked(p_order uuid, p_stream text, p_from public.order_status, p_for_admin boolean)
returns public.order_status language plpgsql security definer set search_path = '' as $$
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
  select t.to_status into nxt from taxpasso_private.transitions t where t.flow = v_flow and t.from_status = p_from;
  if nxt is null then raise exception 'Invalid transition'; end if;

  -- F-07: полнота анкеты перед началом работы партнёра (под переключателем, только для новых заказов)
  if v_flow = 'llc' and nxt = 'review'
     and taxpasso_private.setting('enforce_order_setup', 'false') = 'true'
     and o.created_at >= coalesce(nullif(taxpasso_private.setting('enforce_order_setup_from', ''), '')::timestamptz, 'infinity'::timestamptz)
     and not taxpasso_private.setup_complete(p_order) then
    raise exception 'Order setup incomplete';
  end if;

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
      if not exists (select 1 from public.order_itin i where i.order_id = p_order and i.approved) then raise exception 'ITIN required'; end if;
      if not exists (select 1 from public.partner_documents pd
                      where pd.order_id = p_order and pd.visibility = 'published' and pd.doc_type::text = 'itin_letter') then
        raise exception 'ITIN letter required';
      end if;
    else
      if not exists (select 1 from public.order_itin i where i.order_id = p_order) then raise exception 'Partner ITIN required'; end if;
      if not exists (select 1 from public.partner_documents pd
                      where pd.order_id = p_order and pd.visibility in ('admin_review', 'published') and pd.doc_type::text = 'itin_letter') then
        raise exception 'Partner ITIN letter required';
      end if;
    end if;
  end if;
  return nxt;
end $$;
