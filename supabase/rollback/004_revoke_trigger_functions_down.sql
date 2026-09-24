-- Откат 004 → состояние после 003.
grant execute on function public.audit_order(), public.on_signup() to authenticated;
