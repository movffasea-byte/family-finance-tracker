import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, applyMigration, pool } from './helpers.js';

const GOALS = '20261201000100_goals_to_pockets.sql';

before(() => migrate({ before: GOALS }));
after(() => pool.end());

test('goals migration keeps every goal amount exactly, and the old table is kept', async () => {
  const { rows: [u] } = await pool.query(
    "insert into public.users (email, password_hash, name) values ('a@example.com', 'x', 'A') returning id",
  );
  const { rows: [h] } = await pool.query("insert into public.households (name) values ('The Gaba House') returning id");
  await pool.query("insert into public.memberships (user_id, household_id, role) values ($1, $2, 'admin')", [u.id, h.id]);
  // Includes a duplicate name, a name matching an existing pocket, and a goal with nothing saved yet.
  await pool.query(
    `insert into public.pockets (household_id, name, kind) values ($1, 'School fees', 'bill')`,
    [h.id],
  );
  const goals = [
    ['School fees', 500000, 123456.78, '2027-01-31'],
    ['Generator', 300000, 0.01, null],
    ['Generator', 80000, 80000, null],
    ['New phone', 150000, 0, null],
  ];
  for (const [name, target, current, deadline] of goals) {
    await pool.query(
      'insert into public.savings_goals (household_id, name, target_amount, current_amount, deadline) values ($1, $2, $3, $4, $5)',
      [h.id, name, target, current, deadline],
    );
  }
  const before = await pool.query('select id, current_amount::text as amt from public.savings_goals order by id');

  await applyMigration(GOALS);

  const after = await pool.query(
    `select g.id, g.current_amount::text as want,
            coalesce((select sum(m.amount) from public.pocket_moves m where m.to_pocket_id = g.id and m.kind = 'opening'), 0)::text as got
       from public.savings_goals_legacy g order by g.id`,
  );
  assert.equal(after.rowCount, before.rowCount);
  for (const r of after.rows) assert.equal(Number(r.got), Number(r.want));

  const pockets = await pool.query("select name, kind, locked, deadline::text as deadline from public.pockets where kind = 'goal' order by name");
  assert.equal(pockets.rowCount, 4);
  assert.deepEqual(pockets.rows.map((p) => p.name), ['Generator', 'Generator (goal 2)', 'New phone', 'School fees (goal 1)']);
  assert.ok(pockets.rows.every((p) => p.locked));
  assert.equal(pockets.rows.find((p) => p.name === 'School fees (goal 1)').deadline, '2027-01-31');

  // Opening moves do not change Ready to assign (no income was ever recorded for them).
  const rta = await pool.query(
    `select coalesce(sum(amount) filter (where from_pocket_id is null and kind <> 'opening'), 0)::int as assigned from public.pocket_moves`,
  );
  assert.equal(rta.rows[0].assigned, 0);
  const legacy = await pool.query("select to_regclass('public.savings_goals') as old, to_regclass('public.savings_goals_legacy') as kept");
  assert.equal(legacy.rows[0].old, null);
  assert.ok(legacy.rows[0].kept);
});
