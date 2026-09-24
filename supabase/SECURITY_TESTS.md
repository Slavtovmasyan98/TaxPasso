# Required integration checks before production

Use a disposable Supabase project, never real identity documents. Create client A, client B, partner P, partner Q and an admin via Auth. Create one draft/order for each client and assign A's order to P. Test with each user's JWT through the Supabase API (not a service role).

| Scenario                                                                    | Expected                               |
| --------------------------------------------------------------------------- | -------------------------------------- |
| Anonymous selects any application table or storage object                   | Denied / no rows                       |
| A lists orders/documents/companies/deadlines/history                        | Only A's                               |
| B requests A's order by UUID                                                | No rows                                |
| A updates profiles.role or own orders.status / partner_id / eligibility     | Permission denied                      |
| A inserts an order for B, with approval or non-draft status                 | Permission denied / RLS error          |
| A edits own draft applicant                                                 | Succeeds                               |
| A edits applicant after submit_order                                        | No row updated                         |
| A calls advance_order / approve_eligibility / assign_partner                | Denied                                 |
| P lists orders and documents                                                | A's assigned order only                |
| Q requests A's order/documents                                              | No rows                                |
| Admin reassigns A's order from P to Q                                       | P loses access; Q gains access         |
| A uploads to own order prefix and inserts matching metadata                 | Succeeds                               |
| B uploads under A's order prefix                                            | Denied                                 |
| A inserts metadata for B's object, another order prefix or unsupported MIME | Denied                                 |
| Upload over 10 MB or unsupported MIME                                       | Denied by bucket                       |
| A / assigned partner requests 60-second signed URL                          | Succeeds                               |
| Anonymous / B / unassigned partner requests signed URL                      | Denied                                 |
| Signed URL accessed after expiry                                            | Denied                                 |
| Existing registered document overwritten or deleted by client               | Denied                                 |
| Failed metadata upload cleaned by uploader                                  | Allowed only while object is an orphan |
| Partner skips status or goes backwards                                      | Invalid transition                     |
| ITIN advanced before partner eligibility approval                           | Denied                                 |
| Status updated via allowed RPC                                              | One append-only history row            |
| Admin changes own role with set_user_role                                   | Denied                                 |
| Google Auth with unauthorized redirect                                      | Rejected by Auth configuration         |

Test bundle payment approval on the server when implementing Checkout. No active payment endpoint exists in this MVP.

## Шаг 1 (миграция 002)

| Scenario | Expected |
| --- | --- |
| A updates own orders.payment_status / paid_at / amount_cents | Permission denied |
| A or partner P calls mark_order_paid | Permission denied (service_role only) |
| P advances an unpaid order | "Payment required" |
| A calls record_consent on B's order | "Not permitted" |
| A calls record_consent on own draft | One consent row, readable by A and P |
| A inserts/edits members and company on own draft/application order | Succeeds |
| A edits members after status moved to review | No rows updated / RLS error |
| B inserts a member into A's order | RLS error |
| Two members with is_responsible = true in one order | Unique violation |
| A inserts document with member_id from another order | "Member does not belong to this order" |
| Member with citizenship RU or applicant.country "Russia" | order_reviews row created |
| A selects order_reviews | No rows |
| P selects order_reviews for assigned order | Row visible |
| A reads taxpasso_private.review_countries via API | Not exposed |
| order_payment_ready without consent / unresolved review / unapproved ITIN | false |
| Rollback 002_foundation_down.sql on a copy of the DB | Schema equals state after 001 |

## Шаг 2 (миграция 003)

| Scenario | Expected |
| --- | --- |
| A inserts order with applicant larger than 16 KB | Check violation applicant_size |
| A inserts applicant with nested object or number value | Check violation applicant_flat |
| A inserts normal applicant (string values) | Succeeds |
| A calls reject_eligibility | Not permitted |
| P rejects assigned unpaid ITIN order with empty reason | "Reason required" |
| P rejects assigned unpaid ITIN order with reason | eligibility = rejected, note, decided_by/at set |
| P rejects a paid order | Error, nothing changed |
| Build without Supabase keys and without VITE_DEMO_MODE=true | Maintenance screen, no forms |
| Submit application in UI | order_consents row with current LEGAL_VERSIONS, then status = application |
| Upload in onboarding | documents.kind = passport |
