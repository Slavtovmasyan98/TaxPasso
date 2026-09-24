-- Откат 003 → состояние после 002. Удаляет причины решений по ITIN.
begin;
drop function if exists public.reject_eligibility(uuid, text);

create or replace function public.approve_eligibility(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.can_manage_order(p_order), false) then raise exception 'Not permitted'; end if;
  update public.orders set eligibility = 'approved', updated_at = now()
   where id = p_order and product in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de');
end $$;

alter table public.orders
  drop column if exists eligibility_decided_at,
  drop column if exists eligibility_decided_by,
  drop column if exists eligibility_note,
  drop constraint if exists applicant_flat,
  drop constraint if exists applicant_size;
drop function if exists public.applicant_is_flat(jsonb);
commit;
