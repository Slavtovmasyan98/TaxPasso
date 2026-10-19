-- Catalog-only verification; safe on production. Never deletes application data.
begin transaction read only;
do $$
declare t text; matches integer;
begin
  foreach t in array array['orders','order_payment_lines','order_consents','order_company','order_members']
  loop
    select count(*) into matches
    from pg_catalog.pg_trigger tr
    join pg_catalog.pg_class c on c.oid = tr.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_proc p on p.oid = tr.tgfoid
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'public' and c.relname = t
      and tr.tgname = 'audit_' || t || '_delete'
      and not tr.tgisinternal and tr.tgenabled in ('O', 'A')
      and tr.tgtype = 9 -- ROW (1) + DELETE (8), AFTER, no other event
      and tr.tgqual is null and tr.tgnargs = 0
      and pn.nspname = 'taxpasso_private' and p.proname = 'audit_row';
    if matches <> 1 then
      raise exception 'Missing or invalid AFTER DELETE audit trigger on public.%', t;
    end if;
  end loop;
end $$;
select c.relname as table_name, tr.tgname, tr.tgenabled,
       pg_catalog.pg_get_triggerdef(tr.oid) as definition
from pg_catalog.pg_trigger tr
join pg_catalog.pg_class c on c.oid = tr.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('orders','order_payment_lines','order_consents','order_company','order_members')
  and tr.tgname = 'audit_' || c.relname || '_delete'
order by c.relname;
commit;
