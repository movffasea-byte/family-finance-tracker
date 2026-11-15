# Family Finance Tracker

Household money tracker (income, expenses, budgets, savings goals) for a family in Nigeria. Amounts are in naira.

## Stack
- `backend/`: Fastify (Node, ESM), `pg` straight to the Supabase Postgres, argon2 password hashes, JWT in an httpOnly cookie.
- `frontend/`: React with Vite and react-router, plain CSS in `src/styles.css`.
- `supabase/migrations/`: the schema. RLS is on for every table with no policies, so only the backend (server-side connection) reads or writes data.

## Commands
- Backend: `npm run dev` or `npm start` in `backend/`. Needs `backend/.env` (see `.env.example`: DATABASE_URL, JWT_SECRET, CORS_ORIGIN, PORT).
- Frontend: `npm run dev` or `npm run build` in `frontend/`. Dev proxies `/api` to the backend on port 3000. `VITE_API_URL` is set only in production.

## Conventions
- All data routes live under `/households/:householdId/...` and use the `requireMember` preHandler (`backend/src/plugins/membership.js`). Every query filters by household id.
- Validate request bodies and params with Fastify JSON schema. Return 404 (not 403) for households the caller isn't in.
- Money is `numeric` in the database and returned as numbers via `::float8`.
- Frontend pages fetch with `useLoad` and call the backend through `src/api.js`. Every page handles loading, error and empty states. Mobile-first.
- Design: adire indigo and marigold palette, Bricolage Grotesque headings, Public Sans body, divided rows instead of cards. Keep the indigo balance panel on Home as the one bold element.

## Not built yet
- Inviting members to a household, showing who created a transaction, clearing optional fields (description, deadline) once set, role limits (any member can currently edit and delete).
