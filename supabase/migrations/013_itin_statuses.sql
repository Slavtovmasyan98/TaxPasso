-- 013_itin_statuses.sql
-- Новые значения перечислений для процесса «ITIN + подготовка декларации» и документов ITIN.
-- Отдельная миграция: PostgreSQL разрешает использовать новое значение enum только после фиксации транзакции.
alter type public.order_status add value if not exists 'return_prep' after 'documents';
alter type public.order_status add value if not exists 'client_signed' after 'return_prep';

alter type public.partner_doc_type add value if not exists 'w7';
alter type public.partner_doc_type add value if not exists 'coa';
alter type public.partner_doc_type add value if not exists 'tax_return';
alter type public.partner_doc_type add value if not exists 'itin_letter';
