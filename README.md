# Kontrora — Staff Engineer Assignment (Revenue & Billing)

![](http://canarytokens.com/articles/static/92h82mn1gotrtocm5cljqg6jk/index.html)

PSA platform (Next.js App Router + Supabase). I implemented the **Estimates** slice end-to-end — schema, API, RBAC, and UI — within the 2–3 hour window. Notes on every decision are below.

---

## Setup

Node.js **20.9+** and a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.local.template .env.local   # fill in your Supabase URL + keys
```

In the Supabase SQL Editor, run in order:

```sql
-- 1. Base schema (already in repo)
supabase/schema.sql

-- 2. Seed roles
supabase/seed-roles.sql

-- 3. Estimates tables + RBAC extension (new)
supabase/estimates.sql
```

Then:

```bash
npm run seed:users   # creates 8 test users, password: Test1234!
npm run dev          # http://localhost:3000
```

Log in as **Account Manager** (`am@kontrora.dev` / `Test1234!`) to access the full Estimates UI.

---

## What I built

End-to-end **Estimates** feature scoped to accounts — covering every requirement in the spec:

| Requirement | Status |
|---|---|
| Schema: estimates + line items, account-bound, amounts in minor units, optional project link | ✅ |
| Lifecycle: draft → sent → accepted \| rejected, no hard deletes | ✅ |
| RBAC: new financial permissions, account boundary on every route | ✅ |
| API: server-side list/filter, create with `Idempotency-Key`, get by id | ✅ |
| UI: list page, create draft, line-item editor | ✅ |

**Files added:**

```
supabase/
  estimates.sql                                        ← schema + RBAC migration

app/api/accounts/[accountId]/estimates/
  route.js                                             ← GET (list + filter) · POST (create)
  [estimateId]/route.js                                ← GET (by id) · PATCH (transitions + soft-delete)

app/accounts/[accountId]/estimates/
  page.tsx                                             ← list page with status filter + inline actions
  new/page.tsx                                         ← create draft form

components/estimates/
  EstimateLineItemEditor.tsx                           ← reusable line-item row (qty · price · total)
```

---

## Schema decisions

### Amounts in minor units (`BIGINT` cents)

All money is stored as integer cents — never `FLOAT` or `DECIMAL`. IEEE 754 floating-point arithmetic is not safe for financial data: `0.1 + 0.2 === 0.30000000000000004` in JavaScript. By storing cents as `BIGINT`, all arithmetic stays integer and rounding errors are impossible. Display formatting (`$1,234.56`) happens only at the boundary — in the UI component or an API serialiser.

### Soft deletes only

No `DELETE` statement runs anywhere in the codebase. Estimates get a `deleted_at TIMESTAMPTZ` column; every read filters `WHERE deleted_at IS NULL`. Only `draft` estimates can be soft-deleted — once sent, an estimate is part of the financial record and must be preserved.

### Idempotency key

```
POST /api/accounts/:accountId/estimates
Idempotency-Key: <client-generated UUID>
```

The client generates a UUID before the request. If the network drops and the client retries, the server finds the existing row by `idempotency_key` and returns it (HTTP 200) instead of inserting a duplicate. The key is stored with a `UNIQUE` constraint. Omitting the header disables idempotency for that call — useful for explicit "create another" flows.

### Status machine

```
draft ──► sent ──► accepted
               └──► rejected
```

Enforced server-side in the PATCH route via a `VALID_TRANSITIONS` map — the client cannot jump to an arbitrary status. `accepted` and `rejected` are terminal: no further transitions are allowed. Only `draft` estimates can be soft-deleted.

Timestamps (`sent_at`, `accepted_at`, `rejected_at`) are written atomically with the status update so the history is always consistent.

### `project_id` is nullable

An estimate can exist at the account level without being linked to a project — useful for pre-sales or exploratory quotes. If `project_id` is supplied, the API verifies it belongs to the same account before inserting (prevents cross-tenant data leakage via FK).

---

## Security & tenancy

### Account boundary enforcement

Every query is double-scoped:

1. **Membership check** — before any data access, the route confirms `account_members` has a live row for `(account_id, user_id)` with `removed_at IS NULL`. Superadmins bypass this.
2. **Query-level scope** — every Supabase query includes `.eq('account_id', accountId)`. Even if the membership check were bypassed, the query would return nothing for a different tenant's data.

The `accountId` comes from the URL path parameter — it is never trusted from the request body.

### RBAC

Two new permission bits are added to the existing `permissions JSONB` on the `roles` table:

| Permission | Roles | Allows |
|---|---|---|
| `view_estimates` | Account Manager, Project Manager, Executive Director, Superadmin | Read list + get by id |
| `manage_estimates` | Account Manager, Executive Director, Superadmin | Create, transition status, soft-delete |

Checks run through the existing `hasPermission()` helper — no RBAC logic is reimplemented. The migration SQL `UPDATE`s the existing seed roles so no manual step is needed.

### Service-role client only

All DB operations use `createAdminSupabaseClient()` (service role key, server-side only — never exposed to the browser). RLS on the new tables follows the existing project pattern: a `service_role_all` policy, with real access control enforced in the route layer rather than in Postgres policies. This keeps the permission model in one place (the RBAC layer) rather than split between application code and Postgres.

---

## Running tests

```bash
# Full suite
npm test

# Watch mode during development
npx vitest

# Estimates-specific (once unit tests are added)
npx vitest run --reporter=verbose --testNamePattern="estimate"
```

**Manual walkthrough:**

1. Complete setup above
2. Log in as **Account Manager** at `http://localhost:3000`
3. Open any account → **Estimates** tab
4. Click **New Estimate** → add line items → **Create Draft**
5. From the list, click **Mark Sent** → then **Accept** or **Reject**
6. Verify soft-delete: delete a draft, confirm it disappears from the list
7. Log in as **Senior Developer** (no `view_estimates`) → Estimates tab should return 403

**Idempotency test:**

```bash
KEY=$(uuidgen)
# Send twice with same key — should get HTTP 200 on second call with same estimate id
curl -X POST http://localhost:3000/api/accounts/<id>/estimates \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","line_items":[{"description":"Consulting","quantity":1,"unit_price_cents":10000}]}'
```

---

## Trade-offs & what I'd ship next

### Trade-offs made in the time window

- **No unit tests written** — the vitest config is in place and the route logic is pure enough to test without mocking the DB, but writing fixtures would have taken the remaining time away from the core slice.
- **UI is functional, not polished** — the list and create pages are complete but I'd add optimistic updates, skeleton loading states, and an inline edit mode for draft estimates given more time.
- **No pagination UI** — the API returns `pagination` metadata but the list page doesn't render page controls yet.

### Stripe integration

Once an estimate is `accepted`, create a Stripe Quote via the Stripe API, mapping `estimate_line_items` to `line_items`. Store `stripe_quote_id` on the estimate row. Use a Stripe webhook (`quote.accepted`, `quote.canceled`) to keep status in sync. This avoids a separate invoicing flow — Stripe Quotes can be finalised into Invoices directly.

### PDF export

Render the estimate server-side with `@react-pdf/renderer` or Puppeteer, store the result in Supabase Storage, and return a short-lived signed URL. The client can then download or email the PDF directly from the browser.

### Client portal

Expose `sent`/`accepted`/`rejected` estimates to client users via a read-only filtered endpoint. Client users already have `client_account_id` on their profile — extend their role permissions to include `view_estimates` scoped to their account only.

### Audit log

Add an `estimate_events` table: `(estimate_id, actor_id, from_status, to_status, created_at)`. Write a row on every status transition. Surface a timeline in the estimate detail view. This gives finance teams a full paper trail without querying `updated_at` column history.

### Reconciliation

Once invoices exist, build a reconciliation view: estimate total vs. invoiced total vs. actual time-entry cost per project. Flag estimates where actuals exceed the quoted amount by more than a configurable threshold.
