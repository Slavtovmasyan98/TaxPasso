-- 015_admin_first.sql
-- Правило: админ всегда первый. Ничего из действий партнёра не доходит до клиента и не меняет заказ без админа.
-- Закрывает две лазейки:
--  1. Партнёр напрямую принимал/отклонял документы клиента → теперь только ПРЕДЛАГАЕТ, админ подтверждает.
--  2. Партнёр мог менять владельцев и данные компании в анкете клиента → теперь только клиент (пока анкета открыта) и админ.

-- ═══ 1. Анкета клиента: партнёр больше не редактирует ═══════════════════════
create or replace function taxpasso_private.can_edit_setup(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.id = p_order and o.cancelled_at is null
                    and ((o.client_id = (select auth.uid()) and o.status in ('draft', 'application'))
                         or taxpasso_private.current_role() = 'admin'))
$$;

-- ═══ 2. Проверка документов клиента: партнёр предлагает, админ решает ═══════
create table public.document_review_proposals (
  document_id uuid primary key references public.documents(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.document_review_status not null check (status in ('accepted', 'rejected')),
  comment text check (comment is null or length(comment) <= 1000),
  proposed_by uuid references public.profiles(id),
  proposed_at timestamptz not null default clock_timestamp()
);
create index on public.document_review_proposals(order_id);
alter table public.document_review_proposals enable row level security;
create policy doc_review_proposals_read on public.document_review_proposals for select to authenticated
  using (taxpasso_private.can_manage_order(order_id));
revoke all on public.document_review_proposals from anon, authenticated;
grant select on public.document_review_proposals to authenticated;

create function public.propose_document_review(p_document uuid, p_status public.document_review_status, p_comment text, p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_document;
  if not found or not coalesce(taxpasso_private.can_manage_order(d.order_id), false) then raise exception 'Not permitted'; end if;
  if p_status not in ('accepted', 'rejected') then raise exception 'Invalid status'; end if;
  if p_status = 'rejected' and coalesce(length(trim(p_comment)), 0) < 3 then raise exception 'Reason required'; end if;
  if d.superseded_at is not null then raise exception 'Document replaced'; end if;
  if not taxpasso_private.claim_op(p_op, 'propose_document_review', d.order_id) then return 'already_done'; end if;
  insert into public.document_review_proposals(document_id, order_id, status, comment, proposed_by)
  values (p_document, d.order_id, p_status, nullif(left(trim(coalesce(p_comment, '')), 1000), ''), (select auth.uid()))
  on conflict (document_id) do update
    set status = excluded.status, comment = excluded.comment,
        proposed_by = excluded.proposed_by, proposed_at = clock_timestamp();
  return 'ok';
end $$;

-- Решение по документу принимает только админ (сам или подтверждая предложение партнёра).
create or replace function public.review_document(p_document uuid, p_status public.document_review_status, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  update public.documents
     set review_status = p_status, review_comment = left(nullif(trim(p_comment), ''), 1000),
         reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp()
   where id = p_document;
  if not found then raise exception 'Not permitted'; end if;
  delete from public.document_review_proposals where document_id = p_document;
end $$;

create function public.confirm_document_review(p_document uuid, p_op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare pr public.document_review_proposals;
begin
  perform taxpasso_private.require_admin();
  select * into pr from public.document_review_proposals where document_id = p_document for update;
  if not found then raise exception 'No proposal'; end if;
  if not taxpasso_private.claim_op(p_op, 'confirm_document_review', pr.order_id) then return 'already_done'; end if;
  perform public.review_document(p_document, pr.status, pr.comment);
  return 'ok';
end $$;

create function public.return_document_review(p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform taxpasso_private.require_admin();
  delete from public.document_review_proposals where document_id = p_document;
  if not found then raise exception 'No proposal'; end if;
end $$;

create trigger audit_document_review_proposals after insert or update or delete on public.document_review_proposals
  for each row execute function taxpasso_private.audit_row();

revoke all on function
  public.propose_document_review(uuid, public.document_review_status, text, uuid),
  public.confirm_document_review(uuid, uuid),
  public.return_document_review(uuid)
from public, anon, authenticated;
grant execute on function
  public.propose_document_review(uuid, public.document_review_status, text, uuid),
  public.confirm_document_review(uuid, uuid),
  public.return_document_review(uuid)
to authenticated;
