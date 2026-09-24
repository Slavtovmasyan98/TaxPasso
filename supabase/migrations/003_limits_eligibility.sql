-- 003_limits_eligibility.sql
-- Откат: supabase/rollback/003_limits_eligibility_down.sql
begin;

-- Анкета в orders.applicant: не больше 16 КБ и только плоский объект со строками.
-- Защищает базу от записи произвольных больших данных через API.
alter table public.orders
  add constraint applicant_size check (pg_column_size(applicant) <= 16384);

create function public.applicant_is_flat(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select not exists (select 1 from jsonb_each(p) e
                      where jsonb_typeof(e.value) not in ('string', 'null')
                         or length(e.key) > 40)
$$;
alter table public.orders
  add constraint applicant_flat check (public.applicant_is_flat(applicant));

-- Решение по ITIN: кто, когда и почему. Теперь можно отказать с причиной.
alter table public.orders
  add column eligibility_note text check (eligibility_note is null or length(eligibility_note) <= 1000),
  add column eligibility_decided_by uuid references public.profiles(id),
  add column eligibility_decided_at timestamptz;

create or replace function public.approve_eligibility(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.can_manage_order(p_order), false) then
    raise exception 'Not permitted';
  end if;
  update public.orders
     set eligibility = 'approved', eligibility_note = null,
         eligibility_decided_by = auth.uid(), eligibility_decided_at = now(),
         updated_at = now()
   where id = p_order
     and product in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de');
end $$;

create function public.reject_eligibility(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.can_manage_order(p_order), false) then
    raise exception 'Not permitted';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Reason required';
  end if;
  update public.orders
     set eligibility = 'rejected', eligibility_note = left(p_reason, 1000),
         eligibility_decided_by = auth.uid(), eligibility_decided_at = now(),
         updated_at = now()
   where id = p_order
     and product in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de')
     and payment_status = 'unpaid';
  if not found then
    raise exception 'Cannot reject: order not found, not ITIN, or already paid';
  end if;
end $$;

revoke all on function public.reject_eligibility(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_eligibility(uuid, text) to authenticated;
-- applicant_is_flat используется в CHECK-ограничении, поэтому право на выполнение
-- остаётся у всех ролей: иначе вставка заказа клиентом упадёт с ошибкой прав.

commit;
