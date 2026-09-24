# Taxpasso

React + TypeScript + Vite, Tailwind CSS v4, shadcn-style Button (Radix Slot + CVA), React Router, Supabase Auth/Postgres/Storage, RU/EN and light/dark themes. Inter is bundled locally. The demo never stores uploaded documents or personal application data in localStorage.

## Project structure

```
src/
  main.tsx                    # BrowserRouter and route tree
  styles.css                  # responsive design tokens, light/dark
  components/Layout.tsx       # public shell, navigation and footer
  components/ui/button.tsx    # shadcn/ui Button primitive
  pages/Home.tsx              # hero, steps, comparison, review placeholder, FAQ
  pages/Pricing.tsx           # six plans, extras, 1/2/3-year calculator
  pages/Services.tsx          # LLC, ITIN quiz, FAQ, draft legal pages
  pages/Auth.tsx              # email/password + Google OAuth
  pages/Onboarding.tsx        # product → applicant → documents → payment placeholder
  pages/Dashboard.tsx         # order timeline, documents, deadlines; role-aware controls
  lib/supabase.ts             # optional client, upload, 60-second signed URLs
  lib/auth.tsx                # session and server-controlled role
  i18n/{index.tsx,ru.ts,en.ts} # language provider and complete copy
supabase/migrations/001_taxpasso.sql
.env.example
```

## Start

Node 22 or later:

```bash
npm ci
cp .env.example .env
npm run dev
npm run build
```

Leave env values empty for an explicitly labeled demo. Never put a service-role key in a VITE variable. Only the Supabase URL and publishable/anon key belong in the browser.

## Connect Supabase

1. Create a project and apply `supabase/migrations/001_taxpasso.sql` to a **new** database, using SQL editor or Supabase CLI.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and rebuild. These are build-time values.
3. Enable email and Google Auth; configure the Google OAuth client, Supabase callback and allowed application redirects (`https://taxpasso.com/app`, preview origin `/app`, local origin as needed). Enable confirmation emails. Use production SMTP before launch.
4. Sign up users. Profiles are created by trigger. Bootstrap the first admin with an explicit UUID in SQL editor: `update public.profiles set role='admin' where id='<verified-user-uuid>';`. Never derive roles from user-editable metadata.
5. Admins can use `set_user_role` to assign partner roles, create partner records, and call `assign_partner(order, partner)`. The MVP does not provide a full admin user-management console. Partners see only assigned orders and their documents; admins can see all orders. Clients can edit only applicant fields on their own drafts, and cannot set status, role, partner or eligibility.
6. Partners/admins advance orders sequentially with `advance_order` and confirm ITIN grounds with `approve_eligibility`. Direct status updates are not granted. Status history is append-only through a trigger. Actual expected dates can be added by trusted operations in SQL editor; no invented production ETAs are created.
7. Documents go to the private `documents` bucket under `<order-uuid>/<random-uuid>.<extension>`. RLS checks current assignment; links expire after 60 seconds. A previously issued signed URL remains usable for its short lifetime after access is revoked. Do not log these links. Registered files cannot be overwritten or deleted by browser clients. Retention and removal must be implemented as controlled server operations.
8. Create verified company records and deadline records using the partner/admin scoped tables. No due dates are guessed for live orders. Example dates only appear in demo mode.
9. Optionally enable the commented realtime publication statement. The tracker subscribes to orders and refreshes from RLS-filtered REST; it is not an IRS API integration.

## Payment boundary

Stripe Checkout is intentionally a **disabled placeholder**, per the brief. Saving/submitting an application does not take payment or start paid work. To enable payments, add a server-side Checkout endpoint using server-owned price IDs and verifying order ownership and, for ITIN/bundles, partner eligibility approval. Verify Stripe webhook signatures and use idempotency/event deduplication. Never accept a client-provided paid status or amount. Current schema intentionally has no client-writable payment status.

## Product boundaries and copy

- Quizzes are preliminary and cannot approve ITIN eligibility. The partner checks SSN ineligibility, the tax return or applicable exception and supporting evidence. Country does not establish eligibility.
- Bundles have independent LLC and ITIN status streams within one order. ITIN advances through `advance_bundle_itin` only after partner eligibility approval; both streams append history records.
- LLC prices include formation fees and year-one RA; recurring state obligations are separate. The calculator reserves one annual state obligation per ownership year, including the first year's accrual; actual due dates may fall in the next calendar year. It includes service renewals only from year two. Optional filing/address costs recur each modeled year. WY uses the minimum $60; higher in-state assets can increase it. Income taxes, shipping, individual advisory and other variable expenses are excluded. The total is a planning estimate, not an all-tax guarantee.
- Legal pages are clearly labeled drafts because the operator entity, address, contacts, governing law and retention policy were not supplied. Complete and have them reviewed before commercial use.
- There are no fabricated testimonials or unverified CAA identities. Telegram/WhatsApp links are not invented. Add verified team contacts before launch.
- All unit economics, partner wholesale rates, margin, CAC, LTV and internal research from the supplied document are excluded from the public bundle.

## References checked 2026-09-24

- Delaware annual LLC tax: https://corp.delaware.gov/alt-entitytaxinstructions/ ($400 on the current page; stale snippets can still show $300).
- Wyoming minimum annual report/license tax: https://sos.wyo.gov/business/docs/businessfees.pdf ($60, asset-based if greater).
- CAA possession of originals/issuing-agency-certified copies during video interview: https://www.irs.gov/individuals/itin-acceptance-agent-program
- Form 5472 applicability and initial $25,000 penalty: https://www.irs.gov/instructions/i5472
- Atlas fee: https://stripe.com/pricing
- Supabase storage RLS: https://supabase.com/docs/guides/storage/security/access-control

## Validation / production gates

Validation completed: TypeScript/Vite production build passes. The migration applied successfully in isolated PostgreSQL (PGlite) with mocked Supabase Auth/Storage schemas; 15 schema, RLS and workflow assertions passed. Hosted Auth, Storage APIs and signed URL expiration still require integration testing. Browser visual QA was blocked by the environment (`ERR_BLOCKED_BY_CLIENT`), so responsive behavior has not been visually verified.

Run `npm run build` for TypeScript and Vite validation. The supplied SQL is an initial migration, not an already-provisioned database. Before live documents, run the RLS scenarios in `supabase/SECURITY_TESTS.md` against a disposable Supabase project. Apply upload malware scanning, retention/deletion processes and audit monitoring appropriate to passport/tax data before operational use. Hosting this SPA does not connect `taxpasso.com` or provision Supabase, Stripe, CAA partners or messaging accounts.
