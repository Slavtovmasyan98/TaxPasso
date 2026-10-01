-- 024_itin_application.sql — анкета ITIN (данные для формы IRS W-7).
-- До 024 заказ ITIN собирал только имя, страну и паспорт; после одобрения основания (в том числе после
-- консультации специалиста) данных для W-7 не было. 024:
--   * public.itin_applications — анкета W-7 по заказу (ITIN, ITIN + 1040-NR, пакеты LLC + ITIN);
--   * клиент заполняет её после одобрения основания ITIN: save_itin_application (черновик, можно по шагам),
--     submit_itin_application (проверка обязательных полей и паспорта, анкета блокируется);
--   * администратор возвращает анкету на исправление с комментарием: return_itin_application;
--   * читают клиент, администратор и назначенный партнёр CAA/CPA (через can_read_order; специалист — нет, 023);
--   * этап ITIN после «Документы» открывается только с отправленной анкетой (next_status_checked).
-- Идемпотентна.

create table if not exists public.itin_applications (
  order_id uuid primary key references public.orders(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned')),
  submitted_at timestamptz,
  returned_note text,
  returned_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.itin_applications enable row level security;
revoke all on public.itin_applications from anon, authenticated;
grant select on public.itin_applications to authenticated;
drop policy if exists itin_applications_read on public.itin_applications;
create policy itin_applications_read on public.itin_applications for select to authenticated
  using (taxpasso_private.can_read_order(order_id));

-- Допустимые поля анкеты. Значения — строки до 200 символов; лишние ключи отбрасываются.
create or replace function taxpasso_private.itin_application_clean(p_data jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; out jsonb := '{}'::jsonb;
  allowed text[] := array[
    'reason', 'exception_code', 'exception_detail', 'treaty_country', 'treaty_article', 'relationship', 'us_person_name', 'us_person_tin',
    'first_name', 'middle_name', 'last_name', 'birth_first_name', 'birth_last_name',
    'dob', 'birth_country', 'birth_city', 'gender', 'citizenship', 'citizenship2', 'foreign_tin',
    'home_street', 'home_city', 'home_region', 'home_postal', 'home_country',
    'mail_same', 'mail_street', 'mail_city', 'mail_region', 'mail_postal', 'mail_country', 'phone',
    'passport_country', 'passport_number', 'passport_expiry', 'us_entry_date',
    'visa_type', 'visa_number', 'visa_expiry', 'prev_itin', 'prev_irsn', 'prev_name',
    'school_name', 'school_city', 'stay_length'];
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid application'; end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k = any (allowed) and jsonb_typeof(v) = 'string' and length(v #>> '{}') > 0 then
      if length(v #>> '{}') > 200 then raise exception 'Field too long'; end if;
      if (v #>> '{}') ~ '[<>]' then raise exception 'Invalid characters'; end if;
      out := out || jsonb_build_object(k, trim(v #>> '{}'));
    end if;
  end loop;
  return out;
end $$;
revoke all on function taxpasso_private.itin_application_clean(jsonb) from public, anon, authenticated;

-- Заказ, по которому клиент может заполнять анкету: свой, с ITIN, основание одобрено, не закрыт.
create or replace function taxpasso_private.itin_application_order(p_order uuid) returns public.orders
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.client_id is distinct from (select auth.uid()) then raise exception 'Not permitted'; end if;
  if o.product not in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de') then raise exception 'Not an ITIN order'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.eligibility <> 'approved' then raise exception 'Eligibility approval required'; end if;
  return o;
end $$;
revoke all on function taxpasso_private.itin_application_order(uuid) from public, anon, authenticated;

create or replace function public.save_itin_application(p_order uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.itin_applications; clean jsonb;
begin
  perform taxpasso_private.itin_application_order(p_order);
  clean := taxpasso_private.itin_application_clean(p_data);
  select * into a from public.itin_applications where order_id = p_order for update;
  if found and a.status = 'submitted' then raise exception 'Application submitted'; end if;
  insert into public.itin_applications(order_id, data) values (p_order, clean)
  on conflict (order_id) do update set data = excluded.data, updated_at = now();
end $$;
revoke all on function public.save_itin_application(uuid, jsonb) from public, anon;
grant execute on function public.save_itin_application(uuid, jsonb) to authenticated;

-- Проверка полноты: возвращает код первого незаполненного/неверного поля или null.
create or replace function taxpasso_private.itin_application_problem(p_order uuid, d jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare latin text := '^[A-Za-z][A-Za-z ''.-]*$'; iso_date text := '^\d{4}-\d{2}-\d{2}$'; cc text := '^[A-Z]{2}$';
  r text := d->>'reason';
begin
  if r is null or r not in ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h') then return 'reason'; end if;
  if r = 'a' and (d->>'treaty_country' is null or d->>'treaty_country' !~ cc or d->>'treaty_article' is null) then return 'treaty'; end if;
  if r in ('d', 'e', 'g') and (d->>'relationship' is null or d->>'us_person_name' is null) then return 'relationship'; end if;
  if r = 'h' and (d->>'exception_code' is null or d->>'exception_code' not in ('1', '2', '3', '4', '5', 'other')) then return 'exception_code'; end if;
  if r = 'h' and d->>'exception_code' = 'other' and d->>'exception_detail' is null then return 'exception_code'; end if;
  if r = 'f' and (d->>'school_name' is null or d->>'school_city' is null) then return 'school'; end if;
  if coalesce(d->>'first_name', '') !~ latin or coalesce(d->>'last_name', '') !~ latin then return 'name'; end if;
  if d->>'middle_name' is not null and d->>'middle_name' !~ latin then return 'name'; end if;
  if coalesce(d->>'dob', '') !~ iso_date then return 'dob'; end if;
  begin
    if (d->>'dob')::date >= current_date or (d->>'dob')::date < date '1900-01-01' then return 'dob'; end if;
    if d->>'passport_expiry' is not null and (d->>'passport_expiry')::date <= current_date then return 'passport_expired'; end if;
  exception when others then return 'date';
  end;
  if coalesce(d->>'birth_country', '') !~ cc or d->>'birth_city' is null then return 'birth'; end if;
  if coalesce(d->>'gender', '') not in ('male', 'female') then return 'gender'; end if;
  if coalesce(d->>'citizenship', '') !~ cc then return 'citizenship'; end if;
  if d->>'home_street' is null or d->>'home_city' is null or coalesce(d->>'home_country', '') !~ cc then return 'home_address'; end if;
  if (d->>'home_country') = 'US' then return 'home_address'; end if;  -- строка 3 W-7: адрес за пределами США
  if coalesce(d->>'mail_same', 'yes') <> 'yes'
     and (d->>'mail_street' is null or d->>'mail_city' is null or coalesce(d->>'mail_country', '') !~ cc) then return 'mail_address'; end if;
  if coalesce(d->>'passport_country', '') !~ cc or d->>'passport_number' is null or coalesce(d->>'passport_expiry', '') !~ iso_date then return 'passport'; end if;
  if not exists (select 1 from public.documents doc where doc.order_id = p_order and doc.kind = 'passport'
                  and doc.superseded_at is null and doc.review_status <> 'rejected') then return 'passport_file'; end if;
  return null;
end $$;
revoke all on function taxpasso_private.itin_application_problem(uuid, jsonb) from public, anon, authenticated;

create or replace function public.submit_itin_application(p_order uuid, p_data jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.itin_applications; clean jsonb; problem text;
begin
  perform taxpasso_private.itin_application_order(p_order);
  clean := taxpasso_private.itin_application_clean(p_data);
  select * into a from public.itin_applications where order_id = p_order for update;
  if found and a.status = 'submitted' then
    if a.data = clean then return 'already_done'; end if;
    raise exception 'Application submitted';
  end if;
  problem := taxpasso_private.itin_application_problem(p_order, clean);
  if problem is not null then raise exception 'Application incomplete' using detail = 'field=' || problem; end if;
  insert into public.itin_applications(order_id, data, status, submitted_at)
  values (p_order, clean, 'submitted', clock_timestamp())
  on conflict (order_id) do update
    set data = excluded.data, status = 'submitted', submitted_at = clock_timestamp(), updated_at = now();
  return 'ok';
end $$;
revoke all on function public.submit_itin_application(uuid, jsonb) from public, anon;
grant execute on function public.submit_itin_application(uuid, jsonb) to authenticated;

create or replace function public.return_itin_application(p_order uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.itin_applications; o public.orders;
begin
  perform taxpasso_private.require_admin();
  if p_note is null or length(trim(p_note)) < 3 or length(p_note) > 1000 then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  select * into a from public.itin_applications where order_id = p_order for update;
  if not found or a.status <> 'submitted' then raise exception 'Application not submitted'; end if;
  -- После подачи в IRS анкету не возвращают: исправления — через запрос IRS / повторную подачу.
  if (case when o.product in ('bundle_wy', 'bundle_de') then o.itin_status else o.status end)
       not in ('documents', 'return_prep', 'client_signed', 'caa_interview') then
    raise exception 'Already filed';
  end if;
  update public.itin_applications
     set status = 'returned', returned_note = trim(p_note), returned_at = clock_timestamp(), updated_at = now()
   where order_id = p_order;
end $$;
revoke all on function public.return_itin_application(uuid, text) from public, anon;
grant execute on function public.return_itin_application(uuid, text) to authenticated;

-- Журнал: изменения анкеты попадают в audit_log без содержимого (персональные данные не дублируем).
create or replace function taxpasso_private.audit_itin_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(actor, actor_role, order_id, entity, action, old_value, new_value, reason)
  values ((select auth.uid()), taxpasso_private.current_role(), new.order_id, 'itin_applications',
          case when tg_op = 'INSERT' then 'insert' else 'update' end,
          case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) end,
          jsonb_build_object('status', new.status), new.returned_note);
  return new;
end $$;
revoke all on function taxpasso_private.audit_itin_application() from public, anon, authenticated;
drop trigger if exists itin_applications_audit on public.itin_applications;
create trigger itin_applications_audit after insert or update of status on public.itin_applications
  for each row execute function taxpasso_private.audit_itin_application();

-- Этап ITIN после «Документы» — только с отправленной анкетой W-7 (как в 019, плюс одна проверка).
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

  -- 024: работа по ITIN начинается только с отправленной клиентом анкетой W-7.
  if v_flow in ('itin', 'itin_return') and p_from = 'documents'
     and not exists (select 1 from public.itin_applications a where a.order_id = p_order and a.status = 'submitted') then
    raise exception 'ITIN application required';
  end if;

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
