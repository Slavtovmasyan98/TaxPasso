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
