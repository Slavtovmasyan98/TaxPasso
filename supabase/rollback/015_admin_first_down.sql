-- Откат 015 → поведение после 014 (партнёр снова может менять анкету и решать по документам сам).
drop trigger if exists audit_document_review_proposals on public.document_review_proposals;
drop function if exists public.return_document_review(uuid);
drop function if exists public.confirm_document_review(uuid, uuid);
drop function if exists public.propose_document_review(uuid, public.document_review_status, text, uuid);
drop table if exists public.document_review_proposals;
create or replace function public.review_document(p_document uuid, p_status public.document_review_status, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id=p_document;
  if not found or not public.can_manage_order(d.order_id) then raise exception 'Not permitted'; end if;
  update public.documents set review_status=p_status, review_comment=left(nullif(trim(p_comment),''),1000),
         reviewed_by=auth.uid(), reviewed_at=clock_timestamp() where id=p_document;
end $$;
create or replace function taxpasso_private.can_edit_setup(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = p_order and o.cancelled_at is null
                    and ((o.client_id = (select auth.uid()) and o.status in ('draft', 'application'))
                         or taxpasso_private.can_manage_order(o.id)))
$$;
