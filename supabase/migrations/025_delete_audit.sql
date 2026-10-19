-- 025 (v2): no silent deletes. Orders and the tables that cascade with them now leave an
-- audit_log row on every DELETE, whoever performs it (dashboard SQL, service key, migration).
-- Clients and admins have no DELETE right on orders; this closes the privileged-access blind spot.
do $$
declare t text;
begin
  foreach t in array array['orders','order_payment_lines','order_consents','order_company','order_members']
  loop
    execute format('drop trigger if exists audit_%1$s_delete on public.%1$I', t);
    execute format('create trigger audit_%1$s_delete after delete on public.%1$I for each row execute function taxpasso_private.audit_row()', t);
  end loop;
end $$;
