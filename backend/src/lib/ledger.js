// Pocket balances and Ready to assign are always computed from transactions and
// pocket_moves. Nothing stores a balance. `db` is the pool or a transaction client.

const POCKET_BALANCE = `(
    coalesce((select sum(m.amount) from public.pocket_moves m where m.to_pocket_id = p.id), 0)
  - coalesce((select sum(m.amount) from public.pocket_moves m where m.from_pocket_id = p.id), 0)
  - coalesce((select sum(t.amount) from public.transactions t
               where t.pocket_id = p.id and t.type = 'expense'), 0)
)`;

const READY_TO_ASSIGN = `(
    coalesce((select sum(t.amount) from public.transactions t
               where t.household_id = $1 and t.type = 'income'), 0)
  - coalesce((select sum(m.amount) from public.pocket_moves m
               where m.household_id = $1 and m.from_pocket_id is null), 0)
  + coalesce((select sum(m.amount) from public.pocket_moves m
               where m.household_id = $1 and m.to_pocket_id is null), 0)
  - coalesce((select sum(t.amount) from public.transactions t
               where t.household_id = $1 and t.type = 'expense' and t.pocket_id is null), 0)
)`;

export async function pocketBalances(db, householdId) {
  const { rows } = await db.query(
    `select p.id, p.name, p.kind, p.target_amount::float8 as "targetAmount",
            p.sort_order as "sortOrder", ${POCKET_BALANCE}::float8 as balance
       from public.pockets p
      where p.household_id = $1 and p.archived_at is null
      order by p.sort_order, p.name`,
    [householdId],
  );
  return rows;
}

export async function readyToAssign(db, householdId) {
  const { rows } = await db.query(`select ${READY_TO_ASSIGN}::float8 as value`, [householdId]);
  return rows[0].value;
}

// Does the source (a pocket, or Ready to assign when pocketId is null) hold at least `amount`?
// Compared as exact numeric in SQL, never as floats. Also returns the current balance.
export async function hasFunds(db, householdId, pocketId, amount) {
  if (pocketId === null) {
    const { rows } = await db.query(
      `select ${READY_TO_ASSIGN} >= $2::numeric as ok, ${READY_TO_ASSIGN}::float8 as balance`,
      [householdId, amount],
    );
    return rows[0];
  }
  const { rows } = await db.query(
    `select ${POCKET_BALANCE} >= $3::numeric as ok, ${POCKET_BALANCE}::float8 as balance
       from public.pockets p where p.id = $2 and p.household_id = $1`,
    [householdId, pocketId, amount],
  );
  return rows[0];
}

// Serialises money writes per household so two approvals or moves can't race.
export async function lockHousehold(client, householdId) {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [householdId]);
}
