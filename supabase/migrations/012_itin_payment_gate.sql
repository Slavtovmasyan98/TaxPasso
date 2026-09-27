-- ═══ 12a. Оплата заказа с ITIN — только после одобрения основания ══════════════
-- Обещание на сайте «оплата после проверки основания» обеспечивается сервером:
-- ручная отметка оплаты для ITIN и пакетов невозможна, пока основание не одобрено.
create or replace function public.mark_order_paid_manually(p_order uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform taxpasso_private.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found or already paid'; end if;
  if o.cancelled_at is not null or o.closed_at is not null then raise exception 'Order closed'; end if;
  if o.product in ('itin_standard', 'itin_return', 'bundle_wy', 'bundle_de') and o.eligibility is distinct from 'approved' then
    raise exception 'Eligibility approval required';
  end if;
  update public.orders
     set payment_status = 'paid', paid_at = clock_timestamp(),
         payment_marked_manually = true, payment_marked_by = (select auth.uid()),
         payment_note = left(nullif(trim(p_note), ''), 1000), updated_at = clock_timestamp()
   where id = p_order and payment_status <> 'paid';
  if not found then raise exception 'Order not found or already paid'; end if;
end $$;
