-- 004_revoke_trigger_functions.sql
-- Найдено советником безопасности Supabase после применения 001–003.
-- Триггерные функции не должны вызываться через API (/rest/v1/rpc).
-- В 001 права отозваны только у public и anon; Supabase по умолчанию выдаёт их и authenticated.
-- Откат: supabase/rollback/004_revoke_trigger_functions_down.sql
revoke execute on function public.audit_order(), public.on_signup() from authenticated;
