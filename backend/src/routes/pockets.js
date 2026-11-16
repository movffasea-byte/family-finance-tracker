import { query, withTransaction } from '../db.js';
import { requireMember, requireAdmin, householdParams, itemParams } from '../plugins/membership.js';
import { pocketBalances, readyToAssign, hasFunds, lockHousehold } from '../lib/ledger.js';

const kinds = ['bill', 'savings', 'goal', 'emergency', 'spending'];
const fields = {
  name: { type: 'string', minLength: 1, maxLength: 60 },
  kind: { type: 'string', enum: kinds },
  targetAmount: { type: 'number', exclusiveMinimum: 0 },
  sortOrder: { type: 'integer', minimum: -100000, maximum: 100000 },
  deadline: { type: 'string', format: 'date' },
  locked: { type: 'boolean' },
};

// Savings, emergency and goal pockets start locked, so money can't leave them on impulse.
const lockedByDefault = (kind) => ['savings', 'emergency', 'goal'].includes(kind);
const returning = `returning id, name, kind, target_amount::float8 as "targetAmount", sort_order as "sortOrder",
  deadline::text as deadline, locked`;

const naira = (n) => `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const dupName = { error: 'You already have a pocket with that name. Pick another name.' };

export default async function pocketRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  app.get('/', { schema: { params: householdParams } }, async (request) => {
    const { householdId } = request.params;
    const [pockets, rta] = await Promise.all([
      pocketBalances({ query }, householdId),
      readyToAssign({ query }, householdId),
    ]);
    return { readyToAssign: rta, pockets };
  });

  app.post(
    '/',
    {
      preHandler: requireAdmin,
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['name', 'kind'],
          additionalProperties: false,
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      const b = request.body;
      try {
        const { rows } = await query(
          `insert into public.pockets (household_id, name, kind, target_amount, sort_order, deadline, locked)
           values ($1, $2, $3, $4, $5, $6::date, $7)
           ${returning}`,
          [request.params.householdId, b.name.trim(), b.kind, b.targetAmount ?? null, b.sortOrder ?? 0,
            b.deadline ?? null, b.locked ?? lockedByDefault(b.kind)],
        );
        return reply.code(201).send({ pocket: { ...rows[0], balance: 0 } });
      } catch (err) {
        if (err.code === '23505') return reply.code(409).send(dupName);
        throw err;
      }
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: requireAdmin,
      schema: {
        params: itemParams,
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields },
      },
    },
    async (request, reply) => {
      const { householdId, id } = request.params;
      const b = request.body;
      try {
        const { rows } = await query(
          `update public.pockets set
             name = coalesce($3, name),
             kind = coalesce($4::public.pocket_kind, kind),
             target_amount = coalesce($5, target_amount),
             sort_order = coalesce($6, sort_order),
             deadline = coalesce($7::date, deadline),
             locked = coalesce($8, locked)
           where id = $2 and household_id = $1 and archived_at is null
           ${returning}`,
          [householdId, id, b.name?.trim() ?? null, b.kind ?? null, b.targetAmount ?? null, b.sortOrder ?? null,
            b.deadline ?? null, b.locked ?? null],
        );
        if (!rows.length) return reply.code(404).send({ error: 'Pocket not found' });
        return { pocket: rows[0] };
      } catch (err) {
        if (err.code === '23505') return reply.code(409).send(dupName);
        throw err;
      }
    },
  );

  // Archive, never hard-delete. Only allowed when the pocket holds exactly nothing.
  app.delete('/:id', { preHandler: requireAdmin, schema: { params: itemParams } }, async (request, reply) => {
    const { householdId, id } = request.params;
    const out = await withTransaction(async (client) => {
      await lockHousehold(client, householdId);
      const found = await client.query(
        'select name from public.pockets where id = $2 and household_id = $1 and archived_at is null',
        [householdId, id],
      );
      if (!found.rowCount) return { code: 404, body: { error: 'Pocket not found' } };
      const { rows } = await client.query(
        `select (select coalesce(sum(amount), 0) from public.pocket_moves where to_pocket_id = $1 and status = 'done')
              - (select coalesce(sum(amount), 0) from public.pocket_moves where from_pocket_id = $1 and status = 'done')
              - (select coalesce(sum(amount), 0) from public.transactions where pocket_id = $1 and type = 'expense')
              as balance`,
        [id],
      );
      const balance = Number(rows[0].balance);
      if (balance !== 0) {
        return { code: 400, body: {
          error: `${found.rows[0].name} still holds ${naira(balance)}. Move it to another pocket before archiving.`,
        } };
      }
      await client.query('update public.pockets set archived_at = now() where id = $1', [id]);
      return { code: 204 };
    });
    return reply.code(out.code ?? 200).send(out.body);
  });

  app.get(
    '/:id/activity',
    {
      schema: {
        params: itemParams,
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { householdId, id } = request.params;
      const { limit, offset } = request.query;
      const pocket = await query(
        `select id, name, kind, target_amount::float8 as "targetAmount" from public.pockets
          where id = $2 and household_id = $1`,
        [householdId, id],
      );
      if (!pocket.rowCount) return reply.code(404).send({ error: 'Pocket not found' });

      const { balance } = await hasFunds({ query }, householdId, id, 0);

      const { rows } = await query(
        `select * from (
           select m.id, 'move' as source, m.kind::text as kind,
                  (case when m.to_pocket_id = $2 then m.amount else -m.amount end)::float8 as amount,
                  m.note,
                  coalesce((select name from public.pockets o
                             where o.id = case when m.to_pocket_id = $2 then m.from_pocket_id else m.to_pocket_id end),
                           'Ready to assign') as "otherPocket",
                  m.created_at as "createdAt"
             from public.pocket_moves m
            where m.household_id = $1 and m.status = 'done' and (m.to_pocket_id = $2 or m.from_pocket_id = $2)
           union all
           select t.id, 'expense', null, (-t.amount)::float8, t.description, null, t.created_at
             from public.transactions t
            where t.household_id = $1 and t.pocket_id = $2 and t.type = 'expense'
         ) a
         order by "createdAt" desc
         limit $3 offset $4`,
        [householdId, id, limit, offset],
      );
      return { pocket: { ...pocket.rows[0], balance }, activity: rows };
    },
  );
}
