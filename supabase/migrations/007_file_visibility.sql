-- 007_file_visibility.sql (применена в Supabase 26.09.2026)
-- Клиент видит в Storage только свои файлы и опубликованные файлы партнёра.
-- Документы клиента добавляет только клиент (или админ). Партнёр подписывает файлы только своей записью.
create function public.can_manage_object(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id::text = split_part(p_path, '/', 1) and public.can_manage_order(o.id))
$$;
create function public.is_published_for_client(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.partner_documents pd join public.orders o on o.id = pd.order_id
                  where pd.path = p_path and pd.visibility = 'published' and o.client_id = (select auth.uid()))
$$;
revoke all on function public.can_manage_object(text), public.is_published_for_client(text) from public, anon;
grant execute on function public.can_manage_object(text), public.is_published_for_client(text) to authenticated;

drop policy taxpasso_storage_read on storage.objects;
create policy taxpasso_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    public.can_manage_object(name)
    or (owner_id = (select auth.uid())::text and public.can_access_object(name))
    or public.is_published_for_client(name)));

drop policy documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (uploaded_by = auth.uid()
    and exists (select 1 from public.orders o where o.id = order_id
                 and (o.client_id = auth.uid() or public.current_role() = 'admin'))
    and exists (select 1 from storage.objects s
                 where s.bucket_id = 'documents' and s.name = path and s.owner_id = auth.uid()::text));

drop policy pd_partner_insert on public.partner_documents;
create policy pd_partner_insert on public.partner_documents for insert to authenticated
  with check (public.can_manage_order(order_id) and uploaded_by = auth.uid() and visibility = 'partner_only'
    and exists (select 1 from public.partners p where p.id = partner_id and p.profile_id = auth.uid()));
