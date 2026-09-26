-- Откат 010 → логика 009: партнёр предлагает только следующий этап, админ подтверждает его.
-- Перед откатом очистите предложения, ушедшие вперёд больше чем на один этап.
delete from public.status_proposals;
drop function if exists public.next_status_checked(uuid, text, public.order_status, boolean);
-- Восстановите функции next_status_checked(uuid,text), propose_status, confirm_status, reject_status_proposal
-- из migrations/009_two_key_workflow.sql (разделы «Следующий статус», «Партнёр нажимает», «Админ подтверждает»).
