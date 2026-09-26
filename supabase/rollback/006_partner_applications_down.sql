-- Откат 006 → состояние после 005. Удаляет заявки партнёров и документы партнёров (файлы в Storage остаются).
drop function if exists public.return_partner_doc(uuid, text);
drop function if exists public.publish_partner_doc(uuid);
drop function if exists public.submit_partner_doc_for_review(uuid);
drop table if exists public.partner_documents;
drop type if exists public.partner_doc_visibility;
drop function if exists public.reject_partner_application(uuid, text);
drop function if exists public.approve_partner_application(uuid);
drop table if exists public.partner_applications;
drop type if exists public.partner_app_status;
