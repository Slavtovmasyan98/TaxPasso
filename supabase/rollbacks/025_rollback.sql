do $$
declare t text;
begin
  foreach t in array array['orders','order_payment_lines','order_consents','order_company','order_members']
  loop execute format('drop trigger if exists audit_%1$s_delete on public.%1$I', t); end loop;
end $$;
