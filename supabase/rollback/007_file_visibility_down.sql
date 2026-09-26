-- Откат 007 → поведение после 006 (ВНИМАНИЕ: возвращает найденные уязвимости T2/T3/T4).
drop policy pd_partner_insert on public.partner_documents;
create policy pd_partner_insert on public.partner_documents for insert to authenticated
  with check (public.can_manage_order(order_id) and uploaded_by = auth.uid() and visibility = 'partner_only');
drop policy documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_read_order(order_id) and uploaded_by = auth.uid()
    and exists (select 1 from storage.objects s where s.bucket_id='documents' and s.name=path and s.owner_id=auth.uid()::text));
drop policy taxpasso_storage_read on storage.objects;
create policy taxpasso_storage_read on storage.objects for select to authenticated
  using (bucket_id='documents' and public.can_access_object(name));
drop function if exists public.is_published_for_client(text);
drop function if exists public.can_manage_object(text);
