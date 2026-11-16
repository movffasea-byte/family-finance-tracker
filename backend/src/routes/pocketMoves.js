import { query, withTransaction } from '../db.js';
import { requireMember, requireAdmin, householdParams } from '../plugins/membership.js';
import { pocketBalances, readyToAssign, hasFunds, lockHousehold } from '../lib/ledger.js';

const naira = (n) => `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const nullableUuid = { type: ['string', 'null'], format: 'uuid' };

export default async function pocketMoveRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  app.get(
    '/',
    {
      schema: {
        params: householdParams,
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request) => {
      const { rows } = await query(
        `select m.id, m.from_pocket_id as "fromPocketId", m.to_pocket_id as "toPocketId",
                coalesce(f.name, 'Ready to assign') as "fromName",
                coalesce(t.name, 'Ready to assign') as "toName",
                m.amount::float8 as amount, m.kind::text as kind, m.note,
                (select name from public.users u where u.id = m.created_by) as "createdByName",
                m.created_at as "createdAt"
           from public.pocket_moves m
           left join public.pockets f on f.id = m.from_pocket_id
           left join public.pockets t on t.id = m.to_pocket_id
          where m.household_id = $1
          order by m.created_at desc
          limit $2 offset $3`,
        [request.params.householdId, request.query.limit, request.query.offset],
      );
      return { moves: rows };
    },
  );

  app.post(
    '/',
    {
      preHandler: requireAdmin,
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['amount'],
          additionalProperties: false,
          properties: {
            fromPocketId: nullableUuid,
            toPocketId: nullableUuid,
            amount: { type: 'number', exclusiveMinimum: 0 },
            note: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const from = request.body.fromPocketId ?? null;
      const to = request.body.toPocketId ?? null;
      const { amount, note } = request.body;

      if (Math.round(amount * 100) / 100 !== amount)
        return reply.code(400).send({ error: 'Use at most two decimal places for the amount.' });
      if (from === null && to === null)
        return reply.code(400).send({ error: 'Pick a pocket to move money from or to.' });
      if (from === to)
        return reply.code(400).send({ error: 'Pick two different pockets.' });

      return withTransaction(async (client) => {
        await lockHousehold(client, householdId);

        const ids = [from, to].filter(Boolean);
        const { rows: found } = await client.query(
          `select id, name from public.pockets
            where household_id = $1 and archived_at is null and id = any($2::uuid[])`,
          [householdId, ids],
        );
        if (found.length !== ids.length)
          return reply.code(400).send({ error: 'One of those pockets was not found or is archived.' });

        const funds = await hasFunds(client, householdId, from, amount);
        if (!funds.ok) {
          const name = from === null ? 'Ready to assign' : found.find((p) => p.id === from).name;
          return reply.code(400).send({
            error: `${name} only has ${naira(funds.balance)}. Move less or pick another pocket.`,
          });
        }

        const { rows } = await client.query(
          `insert into public.pocket_moves
             (household_id, from_pocket_id, to_pocket_id, amount, kind, note, created_by)
           values ($1, $2, $3, $4, 'transfer', $5, $6)
           returning id, from_pocket_id as "fromPocketId", to_pocket_id as "toPocketId",
                     amount::float8 as amount, kind::text as kind, note, created_at as "createdAt"`,
          [householdId, from, to, amount, note ?? null, request.user.sub],
        );

        const balances = await pocketBalances(client, householdId);
        return reply.code(201).send({
          move: rows[0],
          readyToAssign: await readyToAssign(client, householdId),
          pockets: balances.filter((p) => ids.includes(p.id)),
        });
      });
    },
  );
}
