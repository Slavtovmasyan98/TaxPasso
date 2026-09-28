-- Откат 019 → поведение после 018. Возвращает прежние (слабее защищённые) функции 011/014/015/017/018.
-- ВНИМАНИЕ: тексты функций восстанавливайте из migrations/011…018; здесь снимаются только новые объекты и политика.
drop trigger if exists orders_forbid_paying_cancelled on public.orders;
drop function if exists taxpasso_private.forbid_paying_cancelled();
drop function if exists public.set_order_setup_enforcement(boolean);
drop function if exists taxpasso_private.setup_complete(uuid);
drop function if exists taxpasso_private.partner_access_open(timestamptz, timestamptz);
drop function if exists taxpasso_private.order_accepts_files(text);
drop function if exists taxpasso_private.setting(text, text);
drop policy if exists taxpasso_storage_insert on storage.objects;
create policy taxpasso_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and taxpasso_private.can_access_object(name) and owner_id = (select auth.uid())::text);
grant execute on function public.applicant_is_flat(jsonb) to public;
delete from taxpasso_private.settings where key in ('partner_access_days_after_close', 'enforce_order_setup', 'enforce_order_setup_from');
-- Далее вручную: can_read_order / can_manage_order (без partner_access_open), partner_orders (с cancel_reason),
-- claim_op, cancel_order, assign_partner, next_status_checked, submit_order, record_consult_contact,
-- activate_checkout_addons, approve_company, publish_partner_doc, return_partner_doc, set_service_years,
-- approve_partner_application, reject_partner_application, order_setup_complete — из migrations/011…018.
-- Колонка order_addons.paid_with_order остаётся (безвредна).
