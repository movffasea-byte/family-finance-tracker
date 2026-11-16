import { query, withTransaction } from '../db.js';
import { requireMember, requireAdmin, householdParams, itemParams, uuid } from '../plugins/membership.js';
import { readyToAssign, hasFunds, lockHousehold } from '../lib/ledger.js';
import { proposeSplit } from '../lib/split.js';
import { loadRules } from './splitRules.js';

const naira = (n) => `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

const allocationSelect = `
  select a.id, a.status::text as status, a.income_transaction_id as "incomeTransactionId",
         a.created_at as "createdAt", a.decided_at as "decidedAt",
         (select name from public.users u where u.id = a.created_by) as "createdByName",
         (select name from public.users u where u.id = a.decided_by) as "decidedByName",
         t.amount::float8 as "incomeAmount", t.description as "incomeDescription",
         t.occurred_on::text as "incomeDate",
         (select coalesce(json_agg(json_build_object(
                   'pocketId', l.pocket_id, 'pocketName', p.name, 'amount', l.amount::float8
                 ) order by p.name), '[]'::json)
            from public.allocation_lines l join public.pockets p on p.id = l.pocket_id
           where l.allocation_id = a.id) as lines
    from public.allocations a
    left join public.transactions t on t.id = a.income_transaction_id`;

export default async function allocationRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  // Shows what the rules would do with an amount. Writes nothing.
  app.post(
    '/preview',
    {
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['amount'],
          additionalProperties: false,
          properties: { amount: { type: 'number', minimum: 0, maximum: 1e12 } },
        },
      },
    },
    async (request) => {
      const { householdId } = request.params;
      const rules = await loadRules({ query }, householdId);
      const split = proposeSplit(request.body.amount, rules);
      const names = Object.fromEntries(rules.map((r) => [r.pocketId, r.pocketName]));
      return {
        lines: split.lines.map((l) => ({ ...l, pocketName: names[l.pocketId] })),
        unassigned: split.unassigned,
        readyToAssign: await readyToAssign({ query }, householdId),
      };
    },
  );

  app.post(
    '/',
    {
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['lines'],
          additionalProperties: false,
          properties: {
            incomeTransactionId: uuid,
            lines: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: {
                type: 'object',
                required: ['pocketId', 'amount'],
                additionalProperties: false,
                properties: { pocketId: uuid, amount: { type: 'number', exclusiveMinimum: 0 } },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const { incomeTransactionId, lines } = request.body;

      const ids = lines.map((l) => l.pocketId);
      if (new Set(ids).size !== ids.length)
        return reply.code(400).send({ error: 'Each pocket can only appear once in a split.' });
      if (lines.some((l) => Math.round(l.amount * 100) / 100 !== l.amount))
        return reply.code(400).send({ error: 'Use at most two decimal places for each amount.' });

      return withTransaction(async (client) => {
        const pockets = await client.query(
          'select 1 from public.pockets where household_id = $1 and archived_at is null and id = any($2::uuid[])',
          [householdId, ids],
        );
        if (pockets.rowCount !== ids.length)
          return reply.code(400).send({ error: 'One of those pockets was not found or is archived.' });
        if (incomeTransactionId) {
          const tx = await client.query(
            "select 1 from public.transactions where id = $1 and household_id = $2 and type = 'income'",
            [incomeTransactionId, householdId],
          );
          if (!tx.rowCount) return reply.code(400).send({ error: 'That income was not found.' });
        }
        const { rows } = await client.query(
          `insert into public.allocations (household_id, income_transaction_id, created_by)
           values ($1, $2, $3) returning id`,
          [householdId, incomeTransactionId ?? null, request.user.sub],
        );
        for (const l of lines) {
          await client.query(
            'insert into public.allocation_lines (allocation_id, pocket_id, amount) values ($1, $2, $3)',
            [rows[0].id, l.pocketId, l.amount],
          );
        }
        const created = await client.query(`${allocationSelect} where a.id = $1`, [rows[0].id]);
        return reply.code(201).send({ allocation: created.rows[0] });
      });
    },
  );

  app.get(
    '/',
    {
      schema: {
        params: householdParams,
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['proposed', 'approved', 'discarded'] },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (request) => {
      const { status, limit } = request.query;
      const { rows } = await query(
        `${allocationSelect}
          where a.household_id = $1 and ($2::public.allocation_status is null or a.status = $2)
          order by a.created_at desc limit $3`,
        [request.params.householdId, status ?? null, limit],
      );
      return { allocations: rows };
    },
  );

  app.post('/:id/approve', { preHandler: requireAdmin, schema: { params: itemParams } }, async (request, reply) => {
    const { householdId, id } = request.params;
    return withTransaction(async (client) => {
      await lockHousehold(client, householdId);
      const found = await client.query(
        'select status::text as status from public.allocations where id = $2 and household_id = $1 for update',
        [householdId, id],
      );
      if (!found.rowCount) return reply.code(404).send({ error: 'Split not found' });
      if (found.rows[0].status !== 'proposed')
        return reply.code(409).send({ error: `This split was already ${found.rows[0].status}.` });

      const archived = await client.query(
        `select p.name from public.allocation_lines l join public.pockets p on p.id = l.pocket_id
          where l.allocation_id = $1 and p.archived_at is not null limit 1`,
        [id],
      );
      if (archived.rowCount)
        return reply.code(400).send({ error: `${archived.rows[0].name} is archived. Discard this split and make a new one.` });

      const { rows: sumRows } = await client.query(
        'select sum(amount)::text as total, sum(amount)::float8 as total_num from public.allocation_lines where allocation_id = $1',
        [id],
      );
      const funds = await hasFunds(client, householdId, null, sumRows[0].total);
      if (!funds.ok) {
        const short = sumRows[0].total_num - funds.balance;
        return reply.code(400).send({
          error: `Ready to assign only has ${naira(funds.balance)}, but this split needs ${naira(sumRows[0].total_num)}. You are short by ${naira(short)}.`,
        });
      }

      await client.query(
        `insert into public.pocket_moves
           (household_id, from_pocket_id, to_pocket_id, amount, kind, created_by, allocation_id)
         select $1, null, l.pocket_id, l.amount, 'allocation', $3, $2
           from public.allocation_lines l where l.allocation_id = $2`,
        [householdId, id, request.user.sub],
      );
      await client.query(
        "update public.allocations set status = 'approved', decided_by = $2, decided_at = now() where id = $1",
        [id, request.user.sub],
      );
      const done = await client.query(`${allocationSelect} where a.id = $1`, [id]);
      return { allocation: done.rows[0], readyToAssign: await readyToAssign(client, householdId) };
    });
  });

  app.post('/:id/discard', { preHandler: requireAdmin, schema: { params: itemParams } }, async (request, reply) => {
    const { householdId, id } = request.params;
    return withTransaction(async (client) => {
      await lockHousehold(client, householdId);
      const found = await client.query(
        'select status::text as status from public.allocations where id = $2 and household_id = $1 for update',
        [householdId, id],
      );
      if (!found.rowCount) return reply.code(404).send({ error: 'Split not found' });
      if (found.rows[0].status !== 'proposed')
        return reply.code(409).send({ error: `This split was already ${found.rows[0].status}.` });
      await client.query(
        "update public.allocations set status = 'discarded', decided_by = $2, decided_at = now() where id = $1",
        [id, request.user.sub],
      );
      const done = await client.query(`${allocationSelect} where a.id = $1`, [id]);
      return { allocation: done.rows[0] };
    });
  });
}
