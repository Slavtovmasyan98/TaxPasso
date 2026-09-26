-- 009_two_key_workflow.sql — выгружено из supabase_migrations.schema_migrations (version 20260926013300)
-- 009: два ключа (партнёр предлагает → админ подтверждает), одобрение данных компании, закрытие и Operations.

-- ── Срок обслуживания и закрытие ─────────────────────────────────────────────
alter table public.orders
  add column service_years smallint not null default 1 check (service_years between 1 and 5),
  add column closed_at timestamptz,
  add column service_until date;

-- ── Данные компании: клиент видит только одобренные админом ─────────────────
alter table public.companies
  add column approved boolean not null default false,
  add column approved_by uuid references public.profiles(id),
  add column approved_at timestamptz;

drop policy companies_read on public.companies;
drop policy companies_manage on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (public.can_manage_order(order_id)
         or (approved and exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())));
revoke insert, update, delete on public.companies from authenticated;

-- Сроки клиенту пишет только админ (или функции).
drop policy deadlines_manage on public.deadlines;
create policy deadlines_manage on public.deadlines for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create function public.make_deadlines(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.companies;
begin
  select * into c from public.companies where order_id = p_order;
  if not found or c.registered_on is null then return; end if;
  delete from public.deadlines where order_id = p_order and not completed;
  insert into public.deadlines(order_id, kind, due_date) values
    (p_order, 'state_report',
      case when c.state = 'DE' then make_date(extract(year from c.registered_on)::int + 1, 6, 1)
           else (date_trunc('month', c.registered_on) + interval '1 year')::date end),
    (p_order, 'form_5472', make_date(extract(year from c.registered_on)::int + 1, 4, 15)),
    (p_order, 'ra_renewal', (c.registered_on + interval '1 year')::date)
  on conflict do nothing;
end $$;
revoke all on function public.make_deadlines(uuid) from public, anon, authenticated;

create or replace function public.record_company(p_order uuid, p_name text, p_ein text, p_registered_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; st text; reg date := p_registered_on; ein text := nullif(trim(coalesce(p_ein,'')), '');
  is_admin boolean := public.current_role() = 'admin';
begin
  if not coalesce(public.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  select * into o from public.orders where id = p_order;
  if o.product in ('itin_standard','itin_return') then raise exception 'Not an LLC order'; end if;
  if coalesce(length(trim(p_name)),0) < 2 or length(trim(p_name)) > 120 then raise exception 'Company name required'; end if;
  if ein is not null and ein !~ '^[0-9]{2}-[0-9]{7}$' then raise exception 'EIN format must be 12-3456789'; end if;
  if reg is null or reg > current_date then raise exception 'Invalid registration date'; end if;
  st := case when o.product in ('llc_de','bundle_de') then 'DE' else 'WY' end;
  insert into public.companies(order_id, name, state, ein, registered_on, approved, approved_by, approved_at)
  values (p_order, trim(p_name), st, ein, reg, is_admin,
          case when is_admin then auth.uid() end, case when is_admin then clock_timestamp() end)
  on conflict (order_id) do update
    set name = excluded.name, state = excluded.state, ein = excluded.ein, registered_on = excluded.registered_on,
        approved = excluded.approved, approved_by = excluded.approved_by, approved_at = excluded.approved_at;
  if is_admin then perform public.make_deadlines(p_order); end if;
end $$;

create function public.approve_company(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  update public.companies set approved = true, approved_by = auth.uid(), approved_at = clock_timestamp()
   where order_id = p_order;
  if not found then raise exception 'Company not found'; end if;
  perform public.make_deadlines(p_order);
end $$;

-- ── Предложения статуса (видны только партнёру и админу) ────────────────────
create table public.status_proposals (
  order_id uuid not null references public.orders(id) on delete cascade,
  stream text not null check (stream in ('main','itin')),
  proposed_status public.order_status not null,
  proposed_by uuid not null references public.profiles(id),
  proposed_at timestamptz not null default clock_timestamp(),
  primary key (order_id, stream)
);
alter table public.status_proposals enable row level security;
create policy proposals_read on public.status_proposals for select to authenticated
  using (public.can_manage_order(order_id));
revoke all on public.status_proposals from anon, authenticated;
grant select on public.status_proposals to authenticated;

-- Следующий статус + все проверки (оплата, ITIN, финальные документы).
create function public.next_status_checked(p_order uuid, p_stream text) returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders; chain public.order_status[]; cur public.order_status; pos int; nxt public.order_status;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.payment_status <> 'paid' then raise exception 'Payment required'; end if;
  if p_stream = 'itin' then
    if o.product not in ('bundle_wy','bundle_de') then raise exception 'Invalid transition'; end if;
    chain := array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
    cur := o.itin_status;
    if o.eligibility <> 'approved' then raise exception 'Eligibility approval required'; end if;
  elsif o.product in ('itin_standard','itin_return') then
    chain := array['documents','caa_interview','sent_irs','itin_received']::public.order_status[];
    cur := o.status;
    if o.eligibility <> 'approved' then raise exception 'Partner eligibility approval required'; end if;
  else
    chain := array['application','review','filed_state','registered','ein_requested','ein_received']::public.order_status[];
    cur := o.status;
  end if;
  pos := array_position(chain, cur);
  if pos is null or pos >= array_length(chain, 1) then raise exception 'Invalid transition'; end if;
  nxt := chain[pos + 1];
  if nxt = 'ein_received' then
    if not exists (select 1 from public.companies c where c.order_id = p_order and c.ein is not null and c.approved) then
      raise exception 'Company EIN required';
    end if;
    if (select count(distinct pd.doc_type) from public.partner_documents pd
         where pd.order_id = p_order and pd.visibility = 'published'
           and pd.doc_type in ('articles','ein_letter','operating_agreement')) < 3 then
      raise exception 'Final documents required';
    end if;
  end if;
  return nxt;
end $$;
revoke all on function public.next_status_checked(uuid, text) from public, anon, authenticated;

-- Партнёр нажимает «Следующий этап» → предложение админу.
create function public.propose_status(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
declare nxt public.order_status;
begin
  if not coalesce(public.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  nxt := public.next_status_checked(p_order, p_stream);
  insert into public.status_proposals(order_id, stream, proposed_status, proposed_by)
  values (p_order, p_stream, nxt, auth.uid())
  on conflict (order_id, stream) do update
    set proposed_status = excluded.proposed_status, proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
end $$;

-- Закрытие заказа, когда все потоки завершены.
create function public.close_if_complete(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; c public.companies; done boolean;
begin
  select * into o from public.orders where id = p_order;
  done := case
    when o.product in ('itin_standard','itin_return') then o.status = 'itin_received'
    when o.product in ('bundle_wy','bundle_de') then o.status = 'ein_received' and o.itin_status = 'itin_received'
    else o.status = 'ein_received' end;
  if not done or o.closed_at is not null then return; end if;
  select * into c from public.companies where order_id = p_order;
  update public.orders
     set closed_at = clock_timestamp(),
         service_until = case when o.product in ('itin_standard','itin_return') then null
                              else (coalesce(c.registered_on, current_date) + make_interval(years => o.service_years))::date end
   where id = p_order;
end $$;
revoke all on function public.close_if_complete(uuid) from public, anon, authenticated;

-- Админ подтверждает. Если партнёр назначен — только после его предложения.
create function public.confirm_status(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; pr public.status_proposals; nxt public.order_status;
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  select * into o from public.orders where id = p_order for update;
  select * into pr from public.status_proposals where order_id = p_order and stream = p_stream;
  if o.partner_id is not null and pr.order_id is null then raise exception 'Waiting for partner'; end if;
  nxt := public.next_status_checked(p_order, p_stream);
  if pr.order_id is not null and pr.proposed_status is distinct from nxt then raise exception 'Proposal outdated'; end if;
  if p_stream = 'itin' then
    update public.orders set itin_status = nxt, updated_at = now() where id = p_order;
  else
    update public.orders set status = nxt, updated_at = now() where id = p_order;
  end if;
  delete from public.status_proposals where order_id = p_order and stream = p_stream;
  perform public.close_if_complete(p_order);
end $$;

create function public.reject_status_proposal(p_order uuid, p_stream text default 'main') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  delete from public.status_proposals where order_id = p_order and stream = p_stream;
  if not found then raise exception 'No proposal'; end if;
end $$;

create function public.set_service_years(p_order uuid, p_years int) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.companies;
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  if p_years not between 1 and 5 then raise exception 'Years must be 1-5'; end if;
  select * into c from public.companies where order_id = p_order;
  update public.orders
     set service_years = p_years,
         service_until = case when closed_at is not null and product not in ('itin_standard','itin_return')
                              then (coalesce(c.registered_on, current_date) + make_interval(years => p_years))::date
                              else service_until end
   where id = p_order;
end $$;

-- Прямое продвижение статуса больше недоступно из API: только через propose/confirm.
revoke execute on function public.advance_order(uuid, public.order_status), public.advance_bundle_itin(uuid) from authenticated;

revoke all on function
  public.approve_company(uuid), public.propose_status(uuid, text), public.confirm_status(uuid, text),
  public.reject_status_proposal(uuid, text), public.set_service_years(uuid, int)
from public, anon, authenticated;
grant execute on function
  public.approve_company(uuid), public.propose_status(uuid, text), public.confirm_status(uuid, text),
  public.reject_status_proposal(uuid, text), public.set_service_years(uuid, int)
to authenticated;
