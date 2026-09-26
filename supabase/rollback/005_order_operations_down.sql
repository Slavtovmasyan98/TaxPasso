-- Откат 005 → состояние после 004. Удаляет данные ручной оплаты и проверки документов.
drop function if exists public.review_document(uuid, public.document_review_status, text);
drop function if exists public.mark_order_paid_manually(uuid, text);
create or replace function public.audit_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history(order_id,status,changed_by) values(new.id,new.status,auth.uid());
  end if;
  if new.itin_status is not null and (TG_OP='INSERT' or new.itin_status is distinct from old.itin_status) then
    insert into public.order_status_history(order_id,status,changed_by) values(new.id,new.itin_status,auth.uid());
  end if;
  return new;
end $$;
alter table public.order_status_history alter column created_at set default now();
alter table public.orders drop column if exists payment_marked_by, drop column if exists payment_marked_manually, drop column if exists payment_note;
alter table public.documents drop column if exists reviewed_at, drop column if exists reviewed_by,
  drop column if exists review_comment, drop column if exists review_status;
drop type if exists public.document_review_status;
