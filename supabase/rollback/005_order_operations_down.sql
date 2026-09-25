-- 005_order_operations_down.sql
begin;
drop function if exists public.mark_order_paid_manually(uuid,text);
drop function if exists public.review_document(uuid,public.document_review_status);
alter table public.documents drop column if exists review_status, drop column if exists review_comment, drop column if exists reviewed_by, drop column if exists reviewed_at;
alter table public.orders drop column if exists payment_note, drop column if exists payment_marked_manually, drop column if exists payment_marked_by;
alter table public.order_status_history alter column created_at set default now();
drop type if exists public.document_review_status;
commit;
