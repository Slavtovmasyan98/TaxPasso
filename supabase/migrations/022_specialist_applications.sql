-- 022_specialist_applications.sql — специалист может подать заявку в Partners.
-- С 017 квалификация SPECIALIST есть у партнёров (консультации itin_consult), но заявка через форму Partners
-- допускала только CAA / CPA / CAA/CPA, и специалиста можно было добавить лишь SQL-запросом.
-- approve_partner_application копирует квалификацию из заявки в partners — там SPECIALIST уже разрешён.
-- Идемпотентна.

alter table public.partner_applications drop constraint if exists partner_applications_qualification_check;
alter table public.partner_applications add constraint partner_applications_qualification_check
  check (qualification = any (array['CAA', 'CPA', 'CAA/CPA', 'SPECIALIST']));
