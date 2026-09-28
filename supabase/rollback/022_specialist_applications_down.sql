-- Откат 022. Сначала решите, что делать с заявками SPECIALIST: откат упадёт, пока они есть.
--   select id, full_name, status from public.partner_applications where qualification = 'SPECIALIST';
alter table public.partner_applications drop constraint if exists partner_applications_qualification_check;
alter table public.partner_applications add constraint partner_applications_qualification_check
  check (qualification = any (array['CAA', 'CPA', 'CAA/CPA']));
