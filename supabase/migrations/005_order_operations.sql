-- 005_order_operations.sql — выгружено из supabase_migrations.schema_migrations (version 20260925050905)
create type public.document_review_status as enum ('pending','accepted','rejected');

alter table public.documents
  add column review_status public.document_review_status not null default 'pending',
  add column review_comment text check (review_comment is null or length(review_comment) <= 1000),
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;

alter table public.orders
  add column payment_note text check (payment_note is null or length(payment_note) <= 1000),
  add column payment_marked_manually boolean not null default false,
  add column payment_marked_by uuid references public.profiles(id);

alter table public.order_status_history
  alter column created_at set default clock_timestamp();

create or replace function public.audit_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP='INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history(order_id,status,changed_by,created_at)
    values(new.id,new.status,auth.uid(),clock_timestamp());
  end if;
  if new.itin_status is not null and (TG_OP='INSERT' or new.itin_status is distinct from old.itin_status) then
    insert into public.order_status_history(order_id,status,changed_by,created_at)
    values(new.id,new.itin_status,auth.uid(),clock_timestamp());
  end if;
  return new;
end $$;

create or replace function public.mark_order_paid_manually(p_order uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_role() is distinct from 'admin' then raise exception 'Admin only'; end if;
  update public.orders
     set payment_status='paid', paid_at=clock_timestamp(),
         payment_marked_manually=true, payment_marked_by=auth.uid(),
         payment_note=left(nullif(trim(p_note),''),1000), updated_at=clock_timestamp()
   where id=p_order and payment_status <> 'paid';
  if not found then raise exception 'Order not found or already paid'; end if;
end $$;

create or replace function public.review_document(p_document uuid, p_status public.document_review_status, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id=p_document;
  if not found or not public.can_manage_order(d.order_id) then raise exception 'Not permitted'; end if;
  update public.documents
     set review_status=p_status, review_comment=left(nullif(trim(p_comment),''),1000),
         reviewed_by=auth.uid(), reviewed_at=clock_timestamp()
   where id=p_document;
end $$;

revoke all on function public.mark_order_paid_manually(uuid,text), public.review_document(uuid,public.document_review_status,text) from public, anon, authenticated;
grant execute on function public.mark_order_paid_manually(uuid,text), public.review_document(uuid,public.document_review_status,text) to authenticated;
