-- 019_qa_hardening.sql — закрывает находки QA (docs/QA_STRESS_TEST_MATRIX.md): F-02…F-08, F-10, F-14…F-19.
-- Идемпотентна (create or replace / if not exists / drop … if exists), чтобы безопасно накатываться повторно.
--
-- F-06  claim_op хранит (действие, заказ, пользователь): тот же op_id для другого — ошибка «Operation id reused», а не молчаливый already_done
-- F-17  claim_op изредка чистит записи старше 90 дней
-- F-02  cancel_order отменяет неоплаченные и оплаченные доп. услуги заказа
-- F-03  оплата отменённого заказа (в т. ч. служебным путём/вебхуком) запрещена триггером; триггер активации не трогает отменённые
-- F-08  партнёр теряет доступ к отменённому заказу сразу, к завершённому — через N дней (settings.partner_access_days_after_close, по умолчанию 30)
-- F-04  partner_orders() не отдаёт cancel_reason (там бывают суммы)
-- F-05  смена партнёра сбрасывает и предложения по документам
-- F-07  полнота анкеты (владельцы, доли = 100%, ответственный, компания, паспорта) проверяется при переходе application → review.
--       ПЕРЕКЛЮЧАТЕЛЬ settings.enforce_order_setup, по умолчанию ВЫКЛ; при включении действует только для заказов,
--       созданных после включения (боевые заказы без владельцев не блокируются). Включает админ: set_order_setup_enforcement(true).
-- F-10  submit_order: имя ≤ 200, страна ≤ 100, компания ≤ 200, деятельность ≤ 1000 символов, без < >
-- F-14  устаревшие админ-функции говорят «MFA required», а не «Admin only»
-- F-15  клиент не может загружать файлы в папку отменённого заказа
-- F-16  approve_company / publish_partner_doc / set_service_years отклоняют отменённый заказ
-- F-18  контакт консультации: без < > и управляющих символов; изменение контакта пишется в журнал
-- F-19  applicant_is_flat недоступна анониму

insert into taxpasso_private.settings(key, value) values ('partner_access_days_after_close', '30'), ('enforce_order_setup', 'false')
on conflict (key) do nothing;

create or replace function taxpasso_private.setting(p_key text, p_default text default null) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value from taxpasso_private.settings s where s.key = p_key), p_default)
$$;
revoke all on function taxpasso_private.setting(text, text) from public, anon, authenticated;

-- ═══ F-06, F-17: идемпотентность привязана к действию, заказу и пользователю ═══
create or replace function taxpasso_private.claim_op(p_op uuid, p_action text, p_order uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ex taxpasso_private.operations;
begin
  if p_op is null then raise exception 'Operation id required'; end if;
  insert into taxpasso_private.operations(op_id, action, order_id, actor)
  values (p_op, p_action, p_order, (select auth.uid()))
  on conflict (op_id) do nothing;
  if found then
    if random() < 0.01 then
      delete from taxpasso_private.operations where created_at < clock_timestamp() - interval '90 days';
    end if;
    return true;
  end if;
  select * into ex from taxpasso_private.operations where op_id = p_op;
  if ex.action is distinct from p_action or ex.order_id is distinct from p_order
     or ex.actor is distinct from (select auth.uid()) then
    raise exception 'Operation id reused';
  end if;
  return false;
end $$;

-- ═══ F-02, F-03: отмена заказа и доп. услуги ═══
alter table public.order_addons add column if not exists paid_with_order boolean not null default false;

create or replace function taxpasso_private.activate_checkout_addons() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null then return null; end if;
  update public.order_addons oa
     set status = 'active', paid_at = clock_timestamp(), paid_marked_by = new.payment_marked_by, paid_with_order = true,
         period_start = current_date,
         period_end = case when (select ad.billing_type from public.addons ad where ad.id = oa.addon_id) = 'yearly'
                           then (current_date + interval '1 year')::date end
   where oa.order_id = new.id and oa.status = 'pending_payment';
  return null;
end $$;

create or replace function taxpasso_private.forbid_paying_cancelled() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cancelled_at is not null and new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    raise exception 'Cannot mark a cancelled order as paid';
  end if;
  return new;
end $$;
drop trigger if exists orders_forbid_paying_cancelled on public.orders;
create trigger orders_forbid_paying_cancelled before update of payment_status on public.orders
  for each row execute function taxpasso_private.forbid_paying_cancelled();

create or replace function public.cancel_order(p_order uuid, p_reason text, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.orders; filed public.order_status[] :=
  array['filed_state','registered','ein_requested','ein_received','sent_irs','itin_received']::public.order_status[];
begin
  perform taxpasso_private.require_admin();
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Reason required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if not taxpasso_private.claim_op(p_op, 'cancel_order', p_order) then return 'already_done'; end if;
  if o.cancelled_at is not null then return 'already_done'; end if;
  if o.closed_at is not null then raise exception 'Order closed'; end if;
  if exists (select 1 from public.order_milestones m where m.order_id = p_order)
     or o.status = any(filed) or o.itin_status = any(filed)
     or exists (select 1 from public.status_proposals sp where sp.order_id = p_order and sp.proposed_status = any(filed)) then
    raise exception 'Already filed';
  end if;
  perform set_config('taxpasso.reason', left(trim(p_reason), 1000), true);
  update public.orders
     set cancelled_at = clock_timestamp(), cancelled_by = (select auth.uid()), cancel_reason = left(trim(p_reason), 1000),
         closed_at = clock_timestamp(), service_until = null, updated_at = now()
   where id = p_order;
  update public.order_addons set status = 'cancelled' where order_id = p_order and status in ('pending_payment', 'active');
  delete from public.status_proposals where order_id = p_order;
  return 'ok';
end $$;

-- уже отменённые заказы: погасить их услуги
update public.order_addons oa set status = 'cancelled'
 where oa.status in ('pending_payment', 'active')
   and exists (select 1 from public.orders o where o.id = oa.order_id and o.cancelled_at is not null);

-- ═══ F-08, F-04: доступ партнёра и что он видит ═══
create or replace function taxpasso_private.partner_access_open(p_cancelled timestamptz, p_closed timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_cancelled is null
     and (p_closed is null or p_closed > clock_timestamp()
            - make_interval(days => coalesce(nullif(taxpasso_private.setting('partner_access_days_after_close', '30'), '')::int, 30)))
$$;
revoke all on function taxpasso_private.partner_access_open(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function taxpasso_private.can_read_order(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id = p_order
                    and (o.client_id = (select auth.uid())
                         or taxpasso_private.current_role() = 'admin'
                         or (taxpasso_private.current_role() = 'partner'
                             and taxpasso_private.partner_access_open(o.cancelled_at, o.closed_at)
                             and exists (select 1 from public.partners p
                                          where p.id = o.partner_id and p.profile_id = (select auth.uid())))))
$$;

create or replace function taxpasso_private.can_manage_order(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(taxpasso_private.current_role() = 'admin', false)
      or (coalesce(taxpasso_private.current_role() = 'partner', false)
          and exists (select 1 from public.orders o join public.partners p on p.id = o.partner_id
                       where o.id = p_order and p.profile_id = (select auth.uid())
                         and taxpasso_private.partner_access_open(o.cancelled_at, o.closed_at)))
$$;

create or replace function public.partner_orders()
returns table (id uuid, product public.product_type, status public.order_status, itin_status public.order_status,
  eligibility public.eligibility_status, eligibility_note text, applicant jsonb, created_at timestamptz, updated_at timestamptz,
  partner_id uuid, in_work boolean, itin_attempt smallint, closed_at timestamptz, cancelled_at timestamptz, cancel_reason text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.product, o.status, o.itin_status, o.eligibility, o.eligibility_note, o.applicant,
         o.created_at, o.updated_at, o.partner_id,
         o.payment_status = 'paid', o.itin_attempt, o.closed_at, o.cancelled_at,
         null::text                                   -- cancel_reason партнёру не отдаём
    from public.orders o
   where taxpasso_private.current_role() = 'partner'
     and taxpasso_private.partner_access_open(o.cancelled_at, o.closed_at)
     and exists (select 1 from public.partners p where p.id = o.partner_id and p.profile_id = (select auth.uid()))
   order by o.created_at desc
$$;

-- ═══ F-05: смена партнёра сбрасывает все его предложения ═══
create or replace function public.assign_partner(p_order uuid, p_partner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; q text;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  select p.qualification into q from public.partners p join public.profiles u on u.id = p.profile_id
   where p.id = p_partner and u.role = 'partner';
  if q is null then raise exception 'Invalid partner'; end if;
  if o.product = 'itin_consult' then
    if q <> 'SPECIALIST' then raise exception 'Partner must be a Specialist'; end if;
  else
    if q = 'SPECIALIST' then raise exception 'Invalid partner'; end if;
    if o.product = 'itin_return' and q <> 'CAA/CPA' then raise exception 'Partner must be CAA/CPA'; end if;
    if o.product in ('itin_standard', 'bundle_wy', 'bundle_de') and q not in ('CAA', 'CAA/CPA') then
      raise exception 'Partner must be CAA';
    end if;
  end if;
  if o.partner_id is distinct from p_partner then
    delete from public.status_proposals where order_id = p_order;
    delete from public.eligibility_proposals where order_id = p_order;
    delete from public.specialist_proposals where order_id = p_order;
    delete from public.document_review_proposals where order_id = p_order;
    update public.orders set partner_id = p_partner, updated_at = now() where id = p_order;
  end if;
end $$;

-- ═══ F-07: полнота анкеты (под переключателем) ═══
create or replace function taxpasso_private.setup_complete(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.order_members where order_id = p_order)
    and (select sum(ownership_pct) from public.order_members where order_id = p_order) = 100
    and (select count(*) from public.order_members where order_id = p_order and is_responsible) = 1
    and exists (select 1 from public.order_company c
                 where c.order_id = p_order and c.activity_category is not null
                   and coalesce(trim(c.activity_description), '') <> ''
                   and (c.activity_category <> 'other' or coalesce(trim(c.activity_other), '') <> ''))
    and not exists (select 1 from public.order_members m
                     where m.order_id = p_order
                       and not exists (select 1 from public.documents d
                                        where d.member_id = m.id and d.kind = 'passport'
                                          and d.superseded_at is null and d.review_status <> 'rejected'))
$$;
revoke all on function taxpasso_private.setup_complete(uuid) from public, anon, authenticated;

create or replace function public.order_setup_complete(p_order uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_order(p_order) then raise exception 'Not permitted'; end if;
  return taxpasso_private.setup_complete(p_order);
end $$;

create or replace function public.set_order_setup_enforcement(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  insert into taxpasso_private.settings(key, value) values ('enforce_order_setup', case when p_on then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value;
  if p_on then
    insert into taxpasso_private.settings(key, value) values ('enforce_order_setup_from', clock_timestamp()::text)
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;
revoke all on function public.set_order_setup_enforcement(boolean) from public, anon, authenticated;
grant execute on function public.set_order_setup_enforcement(boolean) to authenticated;

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

-- ═══ F-10: пределы полей анкеты ═══
create or replace function public.submit_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.client_id is distinct from auth.uid() or o.status <> 'draft' then raise exception 'Not permitted'; end if;
  if coalesce(trim(o.applicant->>'name'), '') = '' or coalesce(trim(o.applicant->>'country'), '') = '' then
    raise exception 'Missing required fields';
  end if;
  if o.product not in ('itin_standard', 'itin_return', 'itin_consult')
     and (coalesce(trim(o.applicant->>'company'), '') = '' or coalesce(trim(o.applicant->>'activity'), '') = '') then
    raise exception 'Missing company details';
  end if;
  if length(trim(o.applicant->>'name')) > 200 or length(trim(o.applicant->>'country')) > 100
     or length(coalesce(o.applicant->>'company', '')) > 200 or length(coalesce(o.applicant->>'activity', '')) > 1000 then
    raise exception 'Field too long';
  end if;
  if (o.applicant->>'name') ~ '[<>]' or (o.applicant->>'country') ~ '[<>]' or coalesce(o.applicant->>'company', '') ~ '[<>]' then
    raise exception 'Invalid characters';
  end if;
  update public.orders
     set status = case when product = 'itin_consult' then 'consult_interview'::public.order_status
                       when product in ('itin_standard', 'itin_return') then 'documents'::public.order_status
                       else 'application'::public.order_status end,
         itin_status = case when product in ('bundle_wy', 'bundle_de') then 'documents'::public.order_status else null end,
         updated_at = now()
   where id = p_order;
end $$;

-- ═══ F-14, F-16: устаревшие админ-функции ═══
create or replace function public.approve_company(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  if exists (select 1 from public.orders o where o.id = p_order and o.cancelled_at is not null) then raise exception 'Order cancelled'; end if;
  update public.companies set approved = true, approved_by = auth.uid(), approved_at = clock_timestamp() where order_id = p_order;
  if not found then raise exception 'Company not found'; end if;
  perform public.make_deadlines(p_order);
end $$;

create or replace function public.publish_partner_doc(p_doc uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ord uuid;
begin
  perform taxpasso_private.require_admin();
  select order_id into ord from public.partner_documents where id = p_doc;
  if ord is not null and exists (select 1 from public.orders o where o.id = ord and o.cancelled_at is not null) then
    raise exception 'Order cancelled';
  end if;
  update public.partner_documents set visibility = 'published', published_by = auth.uid(), published_at = clock_timestamp()
   where id = p_doc and visibility = 'admin_review';
  if not found then raise exception 'Not found or not in review'; end if;
end $$;

create or replace function public.return_partner_doc(p_doc uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  update public.partner_documents set visibility = 'partner_only', note = left(nullif(trim(coalesce(p_note, '')), ''), 500)
   where id = p_doc and visibility = 'admin_review';
  if not found then raise exception 'Not found or not in review'; end if;
end $$;

create or replace function public.set_service_years(p_order uuid, p_years integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.companies;
begin
  perform taxpasso_private.require_admin();
  if p_years not between 1 and 5 then raise exception 'Years must be 1-5'; end if;
  if exists (select 1 from public.orders o where o.id = p_order and o.cancelled_at is not null) then raise exception 'Order cancelled'; end if;
  select * into c from public.companies where order_id = p_order;
  update public.orders
     set service_years = p_years,
         service_until = case when closed_at is not null and product not in ('itin_standard', 'itin_return')
                              then (coalesce(c.registered_on, current_date) + make_interval(years => p_years))::date
                              else service_until end
   where id = p_order;
end $$;

create or replace function public.approve_partner_application(p_app uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare app public.partner_applications;
begin
  perform taxpasso_private.require_admin();
  select * into app from public.partner_applications where id = p_app for update;
  if not found or app.status <> 'pending' then raise exception 'Not found or not pending'; end if;
  update public.profiles set role = 'partner' where id = app.user_id;
  insert into public.partners(profile_id, display_name, qualification) values (app.user_id, app.full_name, app.qualification)
  on conflict (profile_id) do update set display_name = excluded.display_name, qualification = excluded.qualification;
  update public.partner_applications set status = 'approved', reviewed_by = auth.uid(), reviewed_at = clock_timestamp() where id = p_app;
end $$;

create or replace function public.reject_partner_application(p_app uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  update public.partner_applications
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
         reject_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 500)
   where id = p_app and status = 'pending';
  if not found then raise exception 'Not found or not pending'; end if;
end $$;

-- ═══ F-15: файлы в отменённый заказ не загружаются ═══
create or replace function taxpasso_private.order_accepts_files(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.orders o where o.id::text = split_part(p_path, '/', 1) and o.cancelled_at is not null)
$$;
revoke all on function taxpasso_private.order_accepts_files(text) from public, anon, authenticated;
grant execute on function taxpasso_private.order_accepts_files(text) to authenticated;

drop policy if exists taxpasso_storage_insert on storage.objects;
create policy taxpasso_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and taxpasso_private.can_access_object(name)
              and owner_id = (select auth.uid())::text and taxpasso_private.order_accepts_files(name));

-- ═══ F-18: контакт консультации ═══
create or replace function public.record_consult_contact(p_order uuid, p_method text, p_value text, p_preferred_time text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.client_id <> (select auth.uid()) then raise exception 'Not permitted'; end if;
  if o.product <> 'itin_consult' then raise exception 'Not a consult order'; end if;
  if o.status not in ('draft', 'consult_interview') or o.cancelled_at is not null or o.closed_at is not null then
    raise exception 'Order closed';
  end if;
  if p_method not in ('telegram', 'whatsapp') then raise exception 'Invalid contact method'; end if;
  if length(trim(coalesce(p_value, ''))) not between 2 and 200 or coalesce(p_value, '') ~ '[<>[:cntrl:]]' then
    raise exception 'Invalid contact value';
  end if;
  if length(trim(coalesce(p_preferred_time, ''))) > 200 or coalesce(p_preferred_time, '') ~ '[<>[:cntrl:]]' then
    raise exception 'Invalid preferred time';
  end if;
  update public.orders
     set applicant = applicant || jsonb_build_object('contact_method', p_method, 'contact_value', trim(p_value),
                                                       'preferred_time', nullif(trim(coalesce(p_preferred_time, '')), '')),
         updated_at = now()
   where id = p_order;
  insert into public.audit_log(actor, actor_role, order_id, entity, action, old_value, new_value, reason)
  values ((select auth.uid()), 'client', p_order, 'order_contact', 'update', null, jsonb_build_object('contact_method', p_method), null);
end $$;

-- ═══ F-19 ═══
revoke execute on function public.applicant_is_flat(jsonb) from public, anon;
grant execute on function public.applicant_is_flat(jsonb) to authenticated, service_role;
