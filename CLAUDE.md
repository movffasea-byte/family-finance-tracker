# Family Finance Tracker

Household money tracker (income, expenses, budgets, savings goals) for a family in Nigeria. Amounts are in naira.

## Stack
- `backend/`: Fastify (Node, ESM), `pg` straight to the Supabase Postgres, argon2 password hashes, JWT in an httpOnly cookie.
- `frontend/`: React with Vite and react-router, plain CSS in `src/styles.css`.
- `supabase/migrations/`: the schema. RLS is on for every table with no policies, so only the backend (server-side connection) reads or writes data.

## Commands
- Backend: `npm run dev` or `npm start` in `backend/`. Needs `backend/.env` (see `.env.example`: DATABASE_URL, JWT_SECRET, CORS_ORIGIN, PORT).
- Backend tests: `npm test` in `backend/`. Needs a local Postgres database ending in `_test`, set as DATABASE_URL in `backend/.env.test` (see `.env.test.example`). The tests wipe and rebuild its `public` schema, and refuse to run against anything else.
- Frontend: `npm run dev` or `npm run build` in `frontend/`. Dev proxies `/api` to the backend on port 3000. `VITE_API_URL` is set only in production.

## Conventions
- All data routes live under `/households/:householdId/...` and use the `requireMember` preHandler (`backend/src/plugins/membership.js`). Every query filters by household id.
- Validate request bodies and params with Fastify JSON schema. Return 404 (not 403) for households the caller isn't in.
- Money is `numeric` in the database and returned as numbers via `::float8`.
- Frontend pages fetch with `useLoad` and call the backend through `src/api.js`. Every page handles loading, error and empty states. Mobile-first.
- Design: adire indigo and marigold palette, Bricolage Grotesque headings, Public Sans body, divided rows instead of cards. Keep the indigo balance panel on Home as the one bold element.

## Envelope budgeting (plan: `docs/envelope-budgeting-plan.md`)
- Phase 1 (pockets and the ledger) is built. Pocket balances and Ready to assign are never stored: `backend/src/lib/ledger.js` computes them from `transactions` and `pocket_moves`. Income lands in Ready to assign; expenses may name a `pocketId`.
- Any write that touches more than one money row uses `withTransaction` (`backend/src/db.js`) plus `lockHousehold` (`lib/ledger.js`). Compare money in SQL as numeric, not as JS floats.
- Admin-only routes add `requireAdmin` (`plugins/membership.js`) after `requireMember`: members get 403, non-members still get 404.
- Migrations are applied to Finance DB by the owner, never by Claude.
- Phases 2 (split rules and approval), 3 (guardrails) and 4 (real-money research) are not built yet.

## Not built yet
- Inviting members to a household, showing who created a transaction, clearing optional fields (description, deadline) once set, role limits (any member can currently edit and delete).
