-- 008_company_delivery.sql (применена в Supabase 26.09.2026). Откат: 008_company_delivery_down.sql
create type public.partner_doc_type as enum ('articles','ein_letter','operating_agreement','other');
alter table public.partner_documents add column doc_type public.partner_doc_type not null default 'other';
grant insert(doc_type) on public.partner_documents to authenticated;
alter table public.companies
  add constraint companies_ein_format check (ein is null or ein ~ '^[0-9]{2}-[0-9]{7}$');

create function public.record_company(p_order uuid, p_name text, p_ein text, p_registered_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; st text; reg date := p_registered_on; ein text := nullif(trim(coalesce(p_ein,'')), '');
begin
  if not coalesce(public.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  select * into o from public.orders where id = p_order;
  if o.product in ('itin_standard','itin_return') then raise exception 'Not an LLC order'; end if;
  if coalesce(length(trim(p_name)),0) < 2 or length(trim(p_name)) > 120 then raise exception 'Company name required'; end if;
  if ein is not null and ein !~ '^[0-9]{2}-[0-9]{7}$' then raise exception 'EIN format must be 12-3456789'; end if;
  if reg is null or reg > current_date then raise exception 'Invalid registration date'; end if;
  st := case when o.product in ('llc_de','bundle_de') then 'DE' else 'WY' end;
  insert into public.companies(order_id, name, state, ein, registered_on)
  values (p_order, trim(p_name), st, ein, reg)
  on conflict (order_id) do update
    set name = excluded.name, state = excluded.state, ein = excluded.ein, registered_on = excluded.registered_on;
  delete from public.deadlines where order_id = p_order and not completed;
  insert into public.deadlines(order_id, kind, due_date) values
    (p_order, 'state_report',
      case when st = 'DE' then make_date(extract(year from reg)::int + 1, 6, 1)
           else (date_trunc('month', reg) + interval '1 year')::date end),
    (p_order, 'form_5472', make_date(extract(year from reg)::int + 1, 4, 15)),
    (p_order, 'ra_renewal', (reg + interval '1 year')::date)
  on conflict do nothing;
end $$;
revoke all on function public.record_company(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.record_company(uuid, text, text, date) to authenticated;

create or replace function public.advance_order(p_order uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; chain public.order_status[]; pos int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not coalesce(public.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  if o.payment_status <> 'paid' then raise exception 'Payment required'; end if;
  if o.product in ('itin_standard', 'itin_return') then
    chain = array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
    if o.eligibility <> 'approved' then raise exception 'Partner eligibility approval required'; end if;
  else
    chain = array['application','review','filed_state','registered','ein_requested','ein_received']::public.order_status[];
  end if;
  pos = array_position(chain, o.status);
  if pos is null or pos >= array_length(chain, 1) or p_status is distinct from chain[pos + 1] then
    raise exception 'Invalid transition';
  end if;
  if p_status = 'ein_received' then
    if not exists (select 1 from public.companies c where c.order_id = p_order and c.ein is not null) then
      raise exception 'Company EIN required';
    end if;
    if (select count(distinct pd.doc_type) from public.partner_documents pd
         where pd.order_id = p_order and pd.visibility = 'published'
           and pd.doc_type in ('articles','ein_letter','operating_agreement')) < 3 then
      raise exception 'Final documents required';
    end if;
  end if;
  update public.orders set status = p_status, updated_at = now() where id = p_order;
end $$;
