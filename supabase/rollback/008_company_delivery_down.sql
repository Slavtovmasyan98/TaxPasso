-- Откат 008 → поведение после 007.
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
  update public.orders set status = p_status, updated_at = now() where id = p_order;
end $$;
drop function if exists public.record_company(uuid, text, text, date);
alter table public.companies drop constraint if exists companies_ein_format;
alter table public.partner_documents drop column if exists doc_type;
drop type if exists public.partner_doc_type;
