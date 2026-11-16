# Envelope Budgeting — Implementation Plan

**Project:** Family Finance Tracker (`movffasea-byte/family-finance-tracker`)
**Owner:** Abraham "Cartel" Gaba
**Status:** Approved for Phase 1. Later phases start only after the previous phase has been reviewed.
**Audience:** Claude Code (CLI). Read `CLAUDE.md` first; this plan builds on its conventions and does not replace them.

---

## 0. Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md and docs/envelope-budgeting-plan.md in full.
Implement Phase 1 only, following the plan exactly.
Before writing code, list the files you will create or change and wait for my "sail on".
When Phase 1 is done, run the tests, summarise what changed, and stop.
Do not start Phase 2.
```

---

## 1. Goal

Today the app records money **after** it moves. This feature makes the app decide **where money goes when it arrives**.

When income is logged, the app proposes how to split it into **pockets** (Bills, Savings, Emergency, Goals, Spending) using the household's **split rules**. An admin reviews the split and approves it. Spending then comes out of a pocket. Every pocket has a balance, and the household can always see:

- **Ready to assign:** money that has come in but has not yet been given a job.
- **Pocket balances:** what is set aside for each purpose.
- **Safe to spend** (Phase 3): what can be spent today without touching bills or savings.

The person using this has said they struggle with money discipline. Design choices should favour **clarity and friction where it protects them** (for example, approval before money moves, and a cooling-off period before raiding savings) over speed.

### What "move money" means here

All moves in Phases 1–3 happen **inside the app's records only**. The app never touches a real bank account. The user copies the approved split into their bank or savings app by hand. Real-money integration is Phase 4, and it is a research task only (see §8).

---

## 2. Current state (baseline)

- **Backend:** Fastify 5 (ESM), `pg` straight to the Supabase Postgres ("Finance DB"), argon2 hashes, JWT in an httpOnly cookie.
- **Routes:** everything under `/households/:householdId/...` uses `requireMember` (`backend/src/plugins/membership.js`), which already sets `request.role` (`'admin' | 'member'`).
- **Existing tables:** `users`, `households`, `memberships`, `categories`, `transactions`, `budgets`, `savings_goals`, `password_resets`.
- **Frontend:** React + Vite + react-router. Pages use `useLoad` (`src/hooks.js`) and `api()` (`src/api.js`). Every page handles loading, error and empty states. Mobile-first, adire indigo and marigold palette, divided rows instead of cards.
- **Tests:** `backend/package.json` has `"test": "node --test"`, but there are no test files yet. The frontend has no test runner.
- **Known gaps (from the README):** role limits (any member can edit or delete anything), invites, clearing optional fields.

---

## 3. Design principles (non-negotiable)

1. **A ledger, not stored balances.** Pocket balances and Ready to assign are always **computed** from `transactions` and `pocket_moves`. No `balance` column is ever updated in place. This gives a full audit trail, and balances can never drift.
2. **Money moves are atomic.** Any operation that writes more than one money row runs inside a single DB transaction (`BEGIN … COMMIT`). It also takes a per-household advisory lock, so two approvals can't race each other.
3. **Exact arithmetic.** Money stays `numeric` in Postgres. Any split maths in JS is done in **integer kobo** (`Math.round(naira * 100)`) and converted back at the end. Never sum floats.
4. **Pockets roll over.** Balances are all-time, not per month. Unspent money stays in its pocket.
5. **Household isolation.** Every query filters by `household_id`. Every referenced id (pocket, rule, allocation, transaction) is checked against the household. Foreign households return 404, as they do now.
6. **Roles mean something.** Approving allocations, moving money between pockets, and editing pockets or rules are **admin-only** (403 for members). Members can log income and expenses and can see everything.
7. **Additive migrations.** Never edit an existing migration file. New files go in `supabase/migrations/` with a timestamp prefix. Each one ends by enabling RLS on new tables (no policies), matching the existing convention.
8. **No new dependencies** without asking first.

---

## 4. Data model

### Phase 1 migration: `supabase/migrations/20261117000000_pockets.sql`

```sql
create type public.pocket_kind as enum ('bill', 'savings', 'goal', 'emergency', 'spending');
create type public.move_kind   as enum ('allocation', 'transfer', 'cover', 'opening');

create table public.pockets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  kind          public.pocket_kind not null,
  target_amount numeric check (target_amount is null or target_amount > 0),
  sort_order    integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- Pocket names are unique among a household's active pockets.
create unique index uq_pockets_household_name_active
  on public.pockets (household_id, lower(name)) where archived_at is null;
create index idx_pockets_household on public.pockets (household_id);

-- A null from_pocket_id means the money came from "Ready to assign".
-- A null to_pocket_id means the money went back to "Ready to assign".
create table public.pocket_moves (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  from_pocket_id  uuid references public.pockets(id) on delete restrict,
  to_pocket_id    uuid references public.pockets(id) on delete restrict,
  amount          numeric not null check (amount > 0),
  kind            public.move_kind not null,
  note            text check (note is null or length(note) <= 200),
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  check (from_pocket_id is not null or to_pocket_id is not null),
  check (from_pocket_id is distinct from to_pocket_id)
);
create index idx_pocket_moves_household on public.pocket_moves (household_id, created_at desc);
create index idx_pocket_moves_from on public.pocket_moves (from_pocket_id);
create index idx_pocket_moves_to   on public.pocket_moves (to_pocket_id);

-- Expenses may be paid from a pocket. Income always lands in Ready to assign.
alter table public.transactions
  add column pocket_id uuid references public.pockets(id) on delete restrict;
alter table public.transactions
  add constraint transactions_income_has_no_pocket check (type = 'expense' or pocket_id is null);
create index idx_transactions_pocket on public.transactions (pocket_id);

alter table public.pockets      enable row level security;
alter table public.pocket_moves enable row level security;
```

### Balance formulas (implement once, in SQL, in `backend/src/lib/ledger.js`)

```
pocket_balance(p) =
    Σ pocket_moves.amount where to_pocket_id   = p
  − Σ pocket_moves.amount where from_pocket_id = p
  − Σ transactions.amount where type = 'expense' and pocket_id = p

ready_to_assign(h) =
    Σ transactions.amount where type = 'income'
  − Σ pocket_moves.amount where from_pocket_id is null    -- assigned out of RTA
  + Σ pocket_moves.amount where to_pocket_id   is null    -- returned to RTA
  − Σ transactions.amount where type = 'expense' and pocket_id is null
```

All values are scoped to the household and returned as `::float8`, matching existing routes.

### Phase 2 migration: `supabase/migrations/20261124000000_split_rules_allocations.sql`

```sql
create type public.split_method      as enum ('fixed', 'percent');
create type public.allocation_status as enum ('proposed', 'approved', 'discarded');

create table public.split_rules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pocket_id    uuid not null references public.pockets(id) on delete cascade,
  method       public.split_method not null,
  value        numeric not null check (value > 0),
  priority     integer not null,
  unique (household_id, pocket_id),
  check (method = 'fixed' or value <= 100)
);

create table public.allocations (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  income_transaction_id uuid references public.transactions(id) on delete set null,
  status                public.allocation_status not null default 'proposed',
  created_by            uuid not null references public.users(id),
  decided_by            uuid references public.users(id),
  decided_at            timestamptz,
  created_at            timestamptz not null default now()
);
create index idx_allocations_household_status on public.allocations (household_id, status);

create table public.allocation_lines (
  id            uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.allocations(id) on delete cascade,
  pocket_id     uuid not null references public.pockets(id) on delete restrict,
  amount        numeric not null check (amount > 0),
  unique (allocation_id, pocket_id)
);

alter table public.pocket_moves
  add column allocation_id uuid references public.allocations(id) on delete restrict;

alter table public.split_rules      enable row level security;
alter table public.allocations      enable row level security;
alter table public.allocation_lines enable row level security;
```

Phase 3 schema is described in §7.

---

## 5. Phase 1 — Pockets and the ledger

### Backend

- **`backend/src/db.js`:** add `withTransaction(fn)`. It checks out a client from `pool`, runs `BEGIN`, calls `fn(client)`, then `COMMIT`, or `ROLLBACK` on error, and always releases the client.
- **`backend/src/plugins/membership.js`:** add `requireAdmin`, a preHandler used after `requireMember`. It returns 403 `{ error: 'Only admins can do this' }` when `request.role !== 'admin'`.
- **`backend/src/lib/ledger.js`:** `pocketBalances(db, householdId)` and `readyToAssign(db, householdId)`, using the formulas in §4. Both take a client so they work inside transactions. Also `lockHousehold(client, householdId)`, which runs `select pg_advisory_xact_lock(hashtext($1))`.
- **`backend/src/routes/pockets.js`**, registered at `/households/:householdId/pockets`:

| Method & path | Who | Behaviour |
|---|---|---|
| `GET /` | member | `{ readyToAssign, pockets: [{ id, name, kind, targetAmount, sortOrder, balance }] }`. Active pockets only, ordered by `sort_order, name`. |
| `POST /` | admin | Create a pocket. Body: `name`, `kind`, optional `targetAmount`, `sortOrder`. 409 on a duplicate active name. |
| `PATCH /:id` | admin | Update `name`, `kind`, `targetAmount`, `sortOrder`. |
| `DELETE /:id` | admin | **Archive** (sets `archived_at`). Rejected with 400 unless the balance is exactly 0. Never hard-delete. |
| `GET /:id/activity` | member | Moves in and out plus expenses for this pocket, newest first, with `limit`/`offset` (default 50, max 200). |

- **`backend/src/routes/pocketMoves.js`**, registered at `/households/:householdId/pocket-moves`:

| Method & path | Who | Behaviour |
|---|---|---|
| `POST /` | admin | Body: `fromPocketId` (nullable = Ready to assign), `toPocketId` (nullable = Ready to assign), `amount`, optional `note`. Inside `withTransaction` and `lockHousehold`: check both pockets belong to the household and are active, check the source (pocket or Ready to assign) has enough money, then insert with `kind = 'transfer'`. Returns the new balances for the affected pockets and Ready to assign. |
| `GET /` | member | Recent moves, paginated. |

- **`backend/src/routes/transactions.js`:** accept an optional `pocketId` on POST and PATCH.
  - Return 400 if `type = 'income'` and `pocketId` is set.
  - Return 400 if the pocket is not in the household or is archived.
  - **Allow** a pocket to go negative in Phase 1. Phase 3 adds the cover flow.
  - Include `pocketId` and `pocketName` in the returned columns.
- **`backend/src/routes/summary.js`:** add `readyToAssign` to the response. Existing fields stay unchanged.
- **Register the new routes** in `backend/src/app.js` with the existing `scoped` prefix.

### Frontend

- **`src/pages/Pockets.jsx`:** Ready to assign shown at the top, then a divided-row list of pockets. Each row shows the name, kind, balance, and a progress bar against the target where a target exists. Admins see "New pocket", "Move money" (from/to selects that include "Ready to assign", plus amount and note) and an archive action. Members see a read-only view.
- **`src/pages/PocketDetail.jsx`** at `/pockets/:id`: the pocket's balance and activity list.
- **`src/pages/Transactions.jsx`:** add an optional "Paid from" pocket select for expenses only, hidden for income.
- **`src/pages/Dashboard.jsx`:** add a Ready to assign line to the indigo balance panel. When it is above 0, show a link: "Give it a job →" to `/pockets`. The indigo panel stays the only bold element.
- **`src/App.jsx`:** add the routes and a "Pockets" nav item between Home and Transactions.
- Use `money()` from `format.js`, `useLoad`, and the existing `Loading`/`ErrorNote`/`Empty` components.

### Phase 1 acceptance criteria

- [ ] An admin can create, rename and archive pockets. Archiving a pocket that still has money is refused with a clear message.
- [ ] Logging ₦100,000 income raises Ready to assign by ₦100,000.
- [ ] Moving ₦30,000 from Ready to assign to "Rent" makes Ready to assign ₦70,000 and Rent ₦30,000.
- [ ] A ₦5,000 expense paid from Rent leaves Rent at ₦25,000. An expense with no pocket reduces Ready to assign.
- [ ] Moving more than the source holds is rejected with 400 and nothing is written.
- [ ] A member gets 403 on every admin endpoint. A non-member gets 404 on everything.
- [ ] Income with a `pocketId` is rejected.
- [ ] All tests in §9 for Phase 1 pass.

---

## 6. Phase 2 — Split rules and approval

### Split algorithm: `backend/src/lib/split.js` (pure function, no DB)

```
proposeSplit(incomeNaira, rules) -> { lines: [{ pocketId, amount }], unassigned }
```

1. Convert to kobo: `remaining = round(income * 100)`.
2. **Fixed rules**, in ascending `priority`: `line = min(valueKobo, remaining)`; `remaining -= line`.
3. **Percent rules**, in ascending `priority`: take `base = remaining` once, after all fixed rules. Each line is `floor(base * pct / 100)`, capped at `remaining`.
4. Skip any zero lines. `unassigned = remaining`, which stays in Ready to assign.
5. Convert back to naira. The lines plus `unassigned` must equal the income exactly (assert this).

Fixed rules come first so that bills are always covered before percentages are taken. When the total of the percentages is 100, every naira after the fixed amounts is allocated, and rounding leftovers stay in Ready to assign.

### Endpoints

| Method & path | Who | Behaviour |
|---|---|---|
| `GET /split-rules` | member | Rules with pocket names, ordered by priority. |
| `PUT /split-rules` | admin | Replaces the **whole** rule set atomically. Validates: pockets belong to the household and are active, no duplicate pockets, and percent values total ≤ 100. |
| `POST /allocations/preview` | member | Body `{ amount }`. Returns `proposeSplit` output plus the current Ready to assign. **Writes nothing.** |
| `POST /allocations` | member | Body `{ incomeTransactionId?, lines: [{ pocketId, amount }] }`. Creates a `proposed` allocation. The lines may differ from the preview, because the user can edit them. |
| `GET /allocations?status=proposed` | member | Lists allocations with lines, creator and income details. |
| `POST /allocations/:id/approve` | admin | Inside `withTransaction` and `lockHousehold`: `SELECT … FOR UPDATE` the allocation, require `status = 'proposed'` (otherwise 409), require that the sum of the lines ≤ the current Ready to assign (otherwise 400 with the shortfall), require all pockets to be active, insert one `pocket_moves` row per line (`kind = 'allocation'`, `allocation_id` set), then mark it `approved` with `decided_by` and `decided_at`. |
| `POST /allocations/:id/discard` | admin | Marks a `proposed` allocation as `discarded`. Nothing moves. |

### Frontend

- **`src/pages/SplitRules.jsx`** (linked from Pockets): an ordered list of rules with a fixed/percent toggle and a value. It shows a **live preview** for a sample amount (default ₦100,000) using `/allocations/preview`. Saving uses `PUT`.
- **Income flow:** after saving an income transaction, show a "Split this income" sheet with the proposed lines, each editable. "Send for approval" creates the allocation. For an admin, the button reads "Approve split", which creates the allocation and approves it in sequence.
- **`src/pages/Approvals.jsx`:** proposed allocations. Admins see Approve and Discard. The nav shows a count badge when any are pending.
- **Dashboard:** "N splits waiting for approval" link for admins.

### Phase 2 acceptance criteria

- [ ] With rules Rent fixed ₦50,000, Savings 20%, Emergency 10% and Spending 70%, an income of ₦200,000 previews as Rent 50,000, Savings 30,000, Emergency 15,000, Spending 105,000, unassigned 0.
- [ ] The same rules on ₦40,000 give Rent 40,000 and everything else 0.
- [ ] Approving twice returns 409 on the second attempt, and no duplicate moves exist.
- [ ] Two simultaneous approvals that together exceed Ready to assign: exactly one succeeds.
- [ ] Percent totals above 100 are rejected on save.
- [ ] A member can propose but not approve or discard.
- [ ] Split unit tests cover rounding, caps, empty rules and a zero-amount remainder.

---

## 7. Phase 3 — Guardrails

### 7.1 Bills
- New table `bills`: `id, household_id, pocket_id, name, amount, frequency ('monthly' | 'yearly'), due_day (1–31), due_month (1–12, yearly only), active, created_at`.
- **Monthly reserve:** for a monthly bill it is the amount; for a yearly bill it is `amount / 12`, so a ₦1,200,000 yearly rent reserves ₦100,000 a month.
- `GET /bills/upcoming?days=30`: bills due soon, with the bill pocket's balance and a `funded` flag.
- The split preview **suggests** each bill pocket's monthly reserve as a fixed line when no rule covers that pocket. The user still approves.
- Dashboard: an "Upcoming bills" section that shows unfunded bills in the warning colour.

### 7.2 Safe to spend
- `safeToSpend = Σ balances of 'spending' pockets`. `perDay = safeToSpend / days left in the month, including today`.
- Shown on the Dashboard under the balance panel: "₦X safe to spend · about ₦Y a day".

### 7.3 Overspending must be covered
- Pockets with a negative balance appear at the top of Pockets and on the Dashboard with a **Cover** action.
- Cover is a move (`kind = 'cover'`) from another pocket or Ready to assign. The UI pre-fills the shortfall.

### 7.4 Locked pockets (cooling-off)
- Add `locked boolean not null default false` to `pockets` (default true for kinds `savings`, `emergency` and `goal` when they are created).
- Add `status ('done' | 'pending' | 'cancelled') default 'done'` and `available_at timestamptz` to `pocket_moves`. Pending moves are **excluded** from balances until they are confirmed.
- A move **out of** a locked pocket is created as `pending` with `available_at = now() + 24 hours`. After that time an admin can **Confirm** it, or anyone can **Cancel** it at any time. Confirm re-checks the balance inside a transaction.
- UI copy should be calm and plain: "This pocket is locked. Your withdrawal will be ready to confirm tomorrow at 14:05."

### 7.5 Goals become pockets
- A migration creates one `goal` pocket per `savings_goals` row (name, target) and an `opening` move for its `current_amount`. The `created_by` is the household's first admin.
- The Goals page is replaced by goal-kind pockets, which show target progress and a deadline. **Do not drop `savings_goals`** in this phase; it is renamed `savings_goals_legacy`. Dropping it is a separate, later decision.

### Phase 3 acceptance criteria
- [ ] Bill reserves calculate correctly for monthly and yearly bills.
- [ ] Safe to spend matches the spending pocket balances.
- [ ] A withdrawal from a locked pocket can't be confirmed before 24 hours and is not counted until it is confirmed.
- [ ] The goals migration keeps every goal's amount exactly. Write a check query that compares before and after.

---

## 8. Phase 4 — Real money (research only, no code)

Write `docs/real-money-research.md` covering:

- The Nigerian options: payment-provider transfer APIs (for example Paystack Transfers) and open-banking or direct-debit providers (for example Mono). For each, cover what it can do, its requirements (business registration, KYC, where funds must sit), fees, and whether it can move money **between the user's own accounts**.
- The regulatory considerations (CBN) for an app that initiates transfers.
- Security requirements: secrets handling, webhook signature checks, idempotency keys, and two-person approval for transfers.
- A recommendation and an estimate of the work.

**No provider SDKs, keys or transfer code are added to the repo until the owner signs off on that document.**

---

## 9. Testing

**Backend:** `node:test` (already wired up as `npm test`) with Fastify's `app.inject()`. No new dependencies.

- **Test database:** a local Postgres database named `finance_app_test`, set through `DATABASE_URL` in `backend/.env.test`. Apply every migration in `supabase/migrations/` in order. Never point tests at the Supabase project.
- **Helpers in `backend/test/helpers.js`:**
  - `buildTestApp()`
  - `resetDb()`, which truncates all tables
  - `signupAndLogin(name)`, which returns the cookie and household id
  - `addMember(householdId, role)`
- **Unit tests:** `split.test.js`, run as a pure function.
- **Integration tests, one file per route group:**
  - household isolation (404)
  - roles (403)
  - ledger maths
  - insufficient-funds rejection
  - double-approve 409
  - a concurrent approve race (fire two `inject` calls with `Promise.all`)
- Test household fixtures use the name **"The Gaba House"**.

**Frontend:** no runner yet, so verify each phase manually against its acceptance list in the browser at a phone width (375px). Adding Vitest is a separate, optional task; ask first.

---

## 10. Working rules for Claude Code

1. **One phase at a time.** Before coding, list the files you will create or change and wait for "sail on".
2. **Read before you change.** Match the existing style: Fastify JSON schemas on every route, `additionalProperties: false` on bodies, `::float8` for money, and camelCase JSON in and out.
3. **Show migrations before applying them.** After review, the owner applies them to the Supabase project ("Finance DB"). Do not apply migrations to the live database yourself.
4. **Never weaken existing checks** (household isolation, the error handler that hides internals, cookie auth).
5. **Error messages** are plain sentences a family member can act on. For example, write "Rent only has ₦12,000. Move less or pick another pocket.", not "Insufficient balance".
6. **At the end of each phase:**
   - Run the backend tests.
   - Update `README.md` ("Not built yet") and `CLAUDE.md` (new conventions: ledger, `requireAdmin`, `withTransaction`).
   - Post a short summary of the files changed, migrations to apply, and anything that needs a decision.
   - Stop.
7. **Commit messages:** use conventional commits (`feat(pockets): …`, `test(ledger): …`). Make one commit per logical step, and don't push unless asked.

---

## 11. Open decisions (the owner decides; Claude Code asks, it doesn't assume)

- Whether members may move money between non-locked pockets, or only admins (the default here is admins only).
- Whether an expense should be **blocked** when its pocket would go negative, or allowed and flagged (the default here is allow and flag).
- Whether to keep the per-category monthly **Budgets** feature alongside pockets or retire it after Phase 3. They overlap: budgets are spending limits, while pockets hold money.
