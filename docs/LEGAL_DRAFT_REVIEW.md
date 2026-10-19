# Legal pages: preliminary review, 2026-10-03

Status: draft only; not effective terms. No approval for a production legal launch.
The client routes /terms, /privacy and /refund render the RU/EN draft.
No database, payment gate, role permissions, intake decisions or price changes.

## Verified source and scope
Read the current main docs/PROCESS_RULES.md and Services.tsx on 2026-10-03.
The existing Legal export is replaced by a dedicated LegalDraft component.
All quiz and service logic before that export is preserved byte-for-byte.
This is a copy/UI change, not a security audit or a legal opinion.

## Decisions still needed before live use
- Identify the contracting operator and data controller, address and monitored contact.
- Determine whether Taxpasso contracts as provider with subcontractors or intermediary;
  align customer and provider contracts with actual responsibility.
- Counsel must review the SPECIALIST interview/eligibility scope and professional oversight.
  Current rules permit specialist proposal + admin approval before CAA/CPA assignment.
  This PR does NOT claim a CAA/CPA review already takes place before payment.
- Agree LLC refund rights/deductions: PROCESS_RULES currently marks no-refund as draft.
  Do not infer legal no-refund rights from cancellation RPC restrictions.
- Confirm handling of tax-return work already performed, provider errors, missing basis,
  repeat applications, add-ons, future periods and unremitted fees.
- Preserve bundle $100 for unconfirmed basis; do not equate it to any IRS rejection.
- Define refund request contact, response/transfer timing and method.
- Inventory processors (including auth email, hosting, communications), data locations,
  analytics/cookies, controller/processor roles and transfers; assess applicable laws.
- Specify retention by category, legal holds, deletion/request handling, and copies held
  independently by professionals. Do not promise 30-day automatic erasure.
- Verify production access policies, MFA enforcement, database AND file backups,
  restoration and incident handling; the current draft makes no completed-audit claim.
- Review acceptance/version recording and notices where real data is collected.
  A draft banner does not authorize real processing or make the legal terms sufficient.

## Review scenarios
1. /terms, /privacy, /refund render in RU and EN; navigation retains language.
2. Each page shows Draft / Not effective, date and unresolved operator details.
3. Mobile width 320/375 and desktop; long paragraphs wrap; keyboard links visible.
4. No broken links; active document has aria-current; headings form h1/h2 hierarchy.
5. Quiz, checkout, documents and partner permission logic are unchanged.
6. Review final content with counsel before promotion to main; remove draft status only
   once operator/contact and mandatory disclosures are complete.
7. Use fictional data in staging.

## Official background used
- IRS: preparer credentials and distinct representation rights:
  https://www.irs.gov/tax-professionals/understanding-tax-return-preparer-credentials-and-qualifications
- IRS: CAA/AA functions:
  https://www.irs.gov/tin/itin/itin-acceptance-agents
- FTC: data inventory, minimisation, access and retention:
  https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business
- Supabase: database backups exclude Storage object bytes:
  https://supabase.com/docs/guides/platform/backups

These references inform the review checklist; they do not determine the operator's
jurisdiction-specific obligations or establish that controls are already implemented.
