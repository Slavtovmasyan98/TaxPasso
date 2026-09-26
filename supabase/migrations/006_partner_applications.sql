-- 006_partner_applications.sql — выгружено из supabase_migrations.schema_migrations (version 20260925053603)
-- Заявки партнёров (CAA/CPA), документы партнёра с видимостью для клиента.

-- Заявки на вступление в Partners
create type public.partner_app_status as enum ('pending', 'approved', 'rejected');

create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null check (length(full_name) between 2 and 120),
  qualification text not null check (qualification in ('CAA','CPA','CAA/CPA')),
  bio text check (bio is null or length(bio) <= 500),
  status public.partner_app_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reject_reason text check (reject_reason is null or length(reject_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.partner_applications enable row level security;

-- Своя заявка
create policy pa_own on public.partner_applications for select to authenticated
  using (user_id = auth.uid());
-- Только свою заявку может создать/обновить до pending
create policy pa_insert on public.partner_applications for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
-- Только admin меняет статус
create policy pa_admin on public.partner_applications for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

revoke all on public.partner_applications from anon, authenticated;
grant select on public.partner_applications to authenticated;
grant insert(user_id, full_name, qualification, bio) on public.partner_applications to authenticated;

-- Функция одобрения: назначает роль partner + создаёт запись в partners
create function public.approve_partner_application(p_app uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare app public.partner_applications;
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  select * into app from public.partner_applications where id = p_app for update;
  if not found or app.status <> 'pending' then raise exception 'Not found or not pending'; end if;

  -- Назначить роль
  update public.profiles set role = 'partner' where id = app.user_id;

  -- Создать партнёрскую запись если нет
  insert into public.partners(profile_id, display_name, qualification)
  values (app.user_id, app.full_name, app.qualification)
  on conflict (profile_id) do update
    set display_name = excluded.display_name,
        qualification = excluded.qualification;

  -- Обновить заявку
  update public.partner_applications
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = clock_timestamp()
   where id = p_app;
end $$;

-- Функция отклонения
create function public.reject_partner_application(p_app uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  update public.partner_applications
     set status = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = clock_timestamp(),
         reject_reason = left(nullif(trim(coalesce(p_reason,'')), ''), 500)
   where id = p_app and status = 'pending';
  if not found then raise exception 'Not found or not pending'; end if;
end $$;

revoke all on function
  public.approve_partner_application(uuid),
  public.reject_partner_application(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.approve_partner_application(uuid),
  public.reject_partner_application(uuid, text)
to authenticated;

-- Документы партнёра: видимость controlled by admin
create type public.partner_doc_visibility as enum ('partner_only', 'admin_review', 'published');

create table public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  partner_id uuid not null references public.partners(id),
  uploaded_by uuid not null references public.profiles(id),
  path text not null unique check (split_part(path,'/',1) = order_id::text),
  name text not null check (length(name) <= 255),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  visibility public.partner_doc_visibility not null default 'partner_only',
  note text check (note is null or length(note) <= 500),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.partner_documents(order_id);

alter table public.partner_documents enable row level security;

-- Партнёр видит/загружает свои документы
create policy pd_partner on public.partner_documents for select to authenticated
  using (public.can_manage_order(order_id));
create policy pd_partner_insert on public.partner_documents for insert to authenticated
  with check (
    public.can_manage_order(order_id)
    and uploaded_by = auth.uid()
    and visibility = 'partner_only'
  );
-- Клиент видит только published
create policy pd_client on public.partner_documents for select to authenticated
  using (
    visibility = 'published'
    and exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
  );

revoke all on public.partner_documents from anon, authenticated;
grant select on public.partner_documents to authenticated;
grant insert(order_id, partner_id, uploaded_by, path, name, mime_type, size_bytes, note)
  on public.partner_documents to authenticated;

-- Функция «Отправить на проверку» (partner → admin)
create function public.submit_partner_doc_for_review(p_doc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.partner_documents;
begin
  select * into d from public.partner_documents where id = p_doc;
  if not found or not public.can_manage_order(d.order_id) then raise exception 'Not permitted'; end if;
  if d.visibility <> 'partner_only' then raise exception 'Already submitted'; end if;
  update public.partner_documents set visibility = 'admin_review' where id = p_doc;
end $$;

-- Функция «Передать клиенту» (admin only)
create function public.publish_partner_doc(p_doc uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  update public.partner_documents
     set visibility = 'published', published_by = auth.uid(), published_at = clock_timestamp()
   where id = p_doc and visibility = 'admin_review';
  if not found then raise exception 'Not found or not in review'; end if;
end $$;

-- Функция «Вернуть партнёру» (admin only)
create function public.return_partner_doc(p_doc uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  update public.partner_documents
     set visibility = 'partner_only',
         note = left(nullif(trim(coalesce(p_note,'')), ''), 500)
   where id = p_doc and visibility = 'admin_review';
  if not found then raise exception 'Not found or not in review'; end if;
end $$;

revoke all on function
  public.submit_partner_doc_for_review(uuid),
  public.publish_partner_doc(uuid),
  public.return_partner_doc(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.submit_partner_doc_for_review(uuid),
  public.publish_partner_doc(uuid),
  public.return_partner_doc(uuid, text)
to authenticated;
