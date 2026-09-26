-- 010_partner_progress.sql — выгружено из supabase_migrations.schema_migrations (version 20260926015111)
-- 010: у партнёра свой прогресс (status_proposals = текущий этап партнёра), клиент видит orders.status,
-- админ подтверждает этапы клиенту по одному, пока не догонит партнёра.

create or replace function public.next_status_checked(p_order uuid, p_stream text, p_from public.order_status, p_for_admin boolean)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders; chain public.order_status[]; pos int; nxt public.order_status;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.payment_status <> 'paid' then raise exception 'Payment required'; end if;
  if p_stream = 'itin' then
    if o.product not in ('bundle_wy','bundle_de') then raise exception 'Invalid transition'; end if;
    chain := array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
    if o.eligibility <> 'approved' then raise exception 'Eligibility approval required'; end if;
  elsif o.product in ('itin_standard','itin_return') then
    chain := array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
    if o.eligibility <> 'approved' then raise exception 'Partner eligibility approval required'; end if;
  else
    chain := array['application','review','filed_state','registered','ein_requested','ein_received']::public.order_status[];
  end if;
  pos := array_position(chain, p_from);
  if pos is null or pos >= array_length(chain, 1) then raise exception 'Invalid transition'; end if;
  nxt := chain[pos + 1];
  if nxt = 'ein_received' then
    if p_for_admin then
      if not exists (select 1 from public.companies c where c.order_id = p_order and c.ein is not null and c.approved) then
        raise exception 'Company EIN required';
      end if;
      if (select count(distinct pd.doc_type) from public.partner_documents pd
           where pd.order_id = p_order and pd.visibility = 'published'
             and pd.doc_type in ('articles','ein_letter','operating_agreement')) < 3 then
        raise exception 'Final documents required';
      end if;
    else
      if not exists (select 1 from public.companies c where c.order_id = p_order and c.ein is not null) then
        raise exception 'Partner EIN required';
      end if;
      if (select count(distinct pd.doc_type) from public.partner_documents pd
           where pd.order_id = p_order and pd.visibility in ('admin_review','published')
             and pd.doc_type in ('articles','ein_letter','operating_agreement')) < 3 then
        raise exception 'Partner documents required';
      end if;
    end if;
  end if;
  return nxt;
end $$;
revoke all on function public.next_status_checked(uuid, text, public.order_status, boolean) from public, anon, authenticated;
drop function if exists public.next_status_checked(uuid, text);

-- Партнёр: «Следующий этап» двигает его собственный прогресс.
create or replace function public.propose_status(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; cur public.order_status; nxt public.order_status;
begin
  if not coalesce(public.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  select * into o from public.orders where id = p_order;
  select proposed_status into cur from public.status_proposals where order_id = p_order and stream = p_stream;
  cur := coalesce(cur, case when p_stream = 'itin' then o.itin_status else o.status end);
  nxt := public.next_status_checked(p_order, p_stream, cur, false);
  insert into public.status_proposals(order_id, stream, proposed_status, proposed_by)
  values (p_order, p_stream, nxt, auth.uid())
  on conflict (order_id, stream) do update
    set proposed_status = excluded.proposed_status, proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
end $$;

-- Админ: подтверждает клиенту следующий этап, если партнёр до него дошёл.
create or replace function public.confirm_status(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; pr public.status_proposals; cur public.order_status; nxt public.order_status;
  chain public.order_status[];
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  select * into o from public.orders where id = p_order for update;
  select * into pr from public.status_proposals where order_id = p_order and stream = p_stream;
  cur := case when p_stream = 'itin' then o.itin_status else o.status end;
  if o.partner_id is not null and (pr.order_id is null or pr.proposed_status = cur) then
    raise exception 'Waiting for partner';
  end if;
  nxt := public.next_status_checked(p_order, p_stream, cur, true);
  if p_stream = 'itin' then
    update public.orders set itin_status = nxt, updated_at = now() where id = p_order;
  else
    update public.orders set status = nxt, updated_at = now() where id = p_order;
  end if;
  if pr.order_id is not null and pr.proposed_status = nxt then
    delete from public.status_proposals where order_id = p_order and stream = p_stream;
  end if;
  perform public.close_if_complete(p_order);
end $$;

-- «Вернуть партнёру»: прогресс партнёра откатывается к статусу, который видит клиент.
create or replace function public.reject_status_proposal(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  delete from public.status_proposals where order_id = p_order and stream = p_stream;
  if not found then raise exception 'No proposal'; end if;
end $$;
