-- Откат 011 → поведение после 010.
-- ВНИМАНИЕ: удаляет журнал действий, возвраты, факты подачи, отметки отмены и версии документов.
-- Перед откатом: выгрузите audit_log и order_refunds. Интерфейсы, рассчитанные на 011, после отката работать не будут.

-- Триггеры
drop trigger if exists audit_milestones on public.order_milestones;
drop trigger if exists audit_refunds on public.order_refunds;
drop trigger if exists audit_partner_applications on public.partner_applications;
drop trigger if exists audit_companies on public.companies;
drop trigger if exists audit_documents on public.documents;
drop trigger if exists audit_partner_documents on public.partner_documents;
drop trigger if exists audit_proposals on public.status_proposals;
drop trigger if exists audit_orders_update on public.orders;
drop trigger if exists audit_orders_insert on public.orders;
drop trigger if exists handle_document_replacement on public.documents;

-- Новые функции
drop function if exists public.record_refund(uuid, integer, text, text, uuid);
drop function if exists public.cancel_order(uuid, text, uuid);
drop function if exists public.propose_status(uuid, text, public.order_status, uuid);
drop function if exists public.confirm_status(uuid, text, public.order_status, uuid);
drop function if exists public.handle_document_replacement();
drop function if exists taxpasso_private.audit_row();

-- Правила доступа обратно на публичные служебные функции
grant execute on function
  public.current_role(), public.can_read_order(uuid), public.can_manage_order(uuid),
  public.can_access_object(text), public.can_manage_object(text),
  public.is_published_for_client(text), public.can_edit_setup(uuid)
to authenticated;
do $$
declare p record; q text; w text; roles text; stmt text;
  pat constant text := 'taxpasso_private\.(current_role|can_read_order|can_manage_order|can_access_object|can_manage_object|is_published_for_client|can_edit_setup)\(';
begin
  for p in select * from pg_policies where schemaname in ('public','storage')
            and (coalesce(qual,'') ~ pat or coalesce(with_check,'') ~ pat) loop
    q := regexp_replace(p.qual, pat, 'public.\1(', 'g');
    w := regexp_replace(p.with_check, pat, 'public.\1(', 'g');
    select string_agg(quote_ident(r::text), ', ') into roles from unnest(p.roles) r;
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    stmt := format('create policy %I on %I.%I as %s for %s to %s', p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, roles);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
    execute stmt;
  end loop;
end $$;

-- Новые таблицы
drop table if exists public.audit_log;
drop table if exists public.order_refunds;
drop table if exists public.order_milestones;
drop table if exists taxpasso_private.operations;
drop table if exists taxpasso_private.transitions;

-- Публичные служебные функции: восстановить тела из 001/002/007 (без MFA), затем удалить закрытые версии.
create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path='' as $$ select role from public.profiles where id=(select auth.uid()) $$;
create or replace function public.can_read_order(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.orders o where o.id=p_order and (o.client_id=(select auth.uid()) or public.current_role()='admin' or (public.current_role()='partner' and exists(select 1 from public.partners p where p.id=o.partner_id and p.profile_id=(select auth.uid()))))) $$;
create or replace function public.can_manage_order(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$ select public.current_role()='admin' or (public.current_role()='partner' and exists(select 1 from public.orders o join public.partners p on p.id=o.partner_id where o.id=p_order and p.profile_id=(select auth.uid()))) $$;
create or replace function public.can_access_object(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.orders o where o.id::text=split_part(p_path,'/',1) and public.can_read_order(o.id)) $$;
create or replace function public.can_manage_object(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select exists (select 1 from public.orders o where o.id::text = split_part(p_path, '/', 1) and public.can_manage_order(o.id)) $$;
create or replace function public.is_published_for_client(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select exists (select 1 from public.partner_documents pd join public.orders o on o.id = pd.order_id where pd.path = p_path and pd.visibility = 'published' and o.client_id = (select auth.uid())) $$;
create or replace function public.can_edit_setup(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists (select 1 from public.orders o where o.id = p_order and ((o.client_id = (select auth.uid()) and o.status in ('draft', 'application')) or public.can_manage_order(o.id))) $$;
drop function if exists taxpasso_private.can_edit_setup(uuid);
drop function if exists taxpasso_private.is_published_for_client(text);
drop function if exists taxpasso_private.can_manage_object(text);
drop function if exists taxpasso_private.can_access_object(text);
drop function if exists taxpasso_private.can_manage_order(uuid);
drop function if exists taxpasso_private.can_read_order(uuid);
drop function if exists taxpasso_private.record_milestone(uuid, public.order_status, uuid);
drop function if exists taxpasso_private.claim_op(uuid, text, uuid);
drop function if exists taxpasso_private.require_admin();
drop function if exists taxpasso_private.current_role();
drop function if exists taxpasso_private.admin_mfa_ok();
drop function if exists taxpasso_private.audit_immutable();
drop table if exists taxpasso_private.settings;

-- Колонки
alter table public.documents drop column if exists superseded_at, drop column if exists replaces_document_id;
alter table public.orders drop column if exists cancel_reason, drop column if exists cancelled_by, drop column if exists cancelled_at;

-- Функции 009/010: восстановите propose_status(uuid,text), confirm_status(uuid,text), reject_status_proposal,
-- next_status_checked, close_if_complete, assign_partner, reject_eligibility из migrations/010, 009, 003, 001.
-- set_user_role восстановите из migrations/001 при необходимости.
