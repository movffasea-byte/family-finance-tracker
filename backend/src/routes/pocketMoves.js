import { query, withTransaction } from '../db.js';
import { requireMember, requireAdmin, householdParams, itemParams } from '../plugins/membership.js';
import { pocketBalances, readyToAssign, hasFunds, lockHousehold } from '../lib/ledger.js';

const naira = (n) => `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const readyTime = (d) =>
  d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
const moveCols = `id, from_pocket_id as "fromPocketId", to_pocket_id as "toPocketId",
  amount::float8 as amount, kind::text as kind, note, status::text as status,
  available_at as "availableAt", created_at as "createdAt"`;
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
            status: { type: 'string', enum: ['done', 'pending', 'cancelled'] },
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
                m.status::text as status, m.available_at as "availableAt",
                (select name from public.users u where u.id = m.created_by) as "createdByName",
                m.created_at as "createdAt"
           from public.pocket_moves m
           left join public.pockets f on f.id = m.from_pocket_id
           left join public.pockets t on t.id = m.to_pocket_id
          where m.household_id = $1 and ($4::public.move_status is null or m.status = $4)
          order by m.created_at desc
          limit $2 offset $3`,
        [request.params.householdId, request.query.limit, request.query.offset, request.query.status ?? null],
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
            kind: { type: 'string', enum: ['transfer', 'cover'], default: 'transfer' },
          },
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const from = request.body.fromPocketId ?? null;
      const to = request.body.toPocketId ?? null;
      const { amount, note, kind } = request.body;

      if (Math.round(amount * 100) / 100 !== amount)
        return reply.code(400).send({ error: 'Use at most two decimal places for the amount.' });
      if (from === null && to === null)
        return reply.code(400).send({ error: 'Pick a pocket to move money from or to.' });
      if (from === to)
        return reply.code(400).send({ error: 'Pick two different pockets.' });

      const out = await withTransaction(async (client) => {
        await lockHousehold(client, householdId);

        const ids = [from, to].filter(Boolean);
        const { rows: found } = await client.query(
          `select id, name, locked from public.pockets
            where household_id = $1 and archived_at is null and id = any($2::uuid[])`,
          [householdId, ids],
        );
        if (found.length !== ids.length)
          return { code: 400, body: { error: 'One of those pockets was not found or is archived.' } };

        const funds = await hasFunds(client, householdId, from, amount);
        if (!funds.ok) {
          const name = from === null ? 'Ready to assign' : found.find((p) => p.id === from).name;
          return { code: 400, body: {
            error: `${name} only has ${naira(funds.balance)}. Move less or pick another pocket.`,
          } };
        }

        // Money leaving a locked pocket waits 24 hours before it can be confirmed.
        const source = from === null ? null : found.find((p) => p.id === from);
        const pending = Boolean(source?.locked);
        const { rows } = await client.query(
          `insert into public.pocket_moves
             (household_id, from_pocket_id, to_pocket_id, amount, kind, note, created_by, status, available_at)
           values ($1, $2, $3, $4, $5, $6, $7,
                   (case when $8::boolean then 'pending' else 'done' end)::public.move_status,
                   case when $8::boolean then now() + interval '24 hours' end)
           returning ${moveCols}`,
          [householdId, from, to, amount, kind, note ?? null, request.user.sub, pending],
        );

        const balances = await pocketBalances(client, householdId);
        return { code: 201, body: {
          move: rows[0],
          ...(pending && {
            message: `${source.name} is locked. Your withdrawal will be ready to confirm tomorrow at ${readyTime(new Date(rows[0].availableAt))}.`,
          }),
          readyToAssign: await readyToAssign(client, householdId),
          pockets: balances.filter((p) => ids.includes(p.id)),
        } };
      });
      return reply.code(out.code ?? 200).send(out.body);
    },
  );

  const loadPending = async (client, householdId, id) =>
    (await client.query(
      `select ${moveCols} from public.pocket_moves where id = $2 and household_id = $1 for update`,
      [householdId, id],
    )).rows[0];

  // Admin confirms a withdrawal once its 24 hours are up. The balance is checked again.
  app.post('/:id/confirm', { preHandler: requireAdmin, schema: { params: itemParams } }, async (request, reply) => {
    const { householdId, id } = request.params;
    const out = await withTransaction(async (client) => {
      await lockHousehold(client, householdId);
      const move = await loadPending(client, householdId, id);
      if (!move) return { code: 404, body: { error: 'Withdrawal not found' } };
      if (move.status !== 'pending') return { code: 409, body: { error: `This withdrawal was already ${move.status}.` } };
      if (new Date(move.availableAt) > new Date())
        return { code: 400, body: {
          error: `This withdrawal can be confirmed from ${new Date(move.availableAt).toLocaleString('en-NG', {
            dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
          })}.`,
        } };

      const ids = [move.fromPocketId, move.toPocketId].filter(Boolean);
      const { rows: pockets } = await client.query(
        'select id, name from public.pockets where household_id = $1 and archived_at is null and id = any($2::uuid[])',
        [householdId, ids],
      );
      if (pockets.length !== ids.length)
        return { code: 400, body: { error: 'One of those pockets is archived. Cancel this withdrawal.' } };

      const funds = await hasFunds(client, householdId, move.fromPocketId, move.amount);
      if (!funds.ok) {
        const name = pockets.find((p) => p.id === move.fromPocketId).name;
        return { code: 400, body: {
          error: `${name} only has ${naira(funds.balance)} now. Cancel this withdrawal or move less.`,
        } };
      }
      await client.query("update public.pocket_moves set status = 'done' where id = $1", [id]);
      return {
        body: {
          move: { ...move, status: 'done' },
          readyToAssign: await readyToAssign(client, householdId),
          pockets: (await pocketBalances(client, householdId)).filter((p) => ids.includes(p.id)),
        },
      };
    });
    return reply.code(out.code ?? 200).send(out.body);
  });

  // Anyone in the household can cancel a pending withdrawal at any time.
  app.post('/:id/cancel', { schema: { params: itemParams } }, async (request, reply) => {
    const { householdId, id } = request.params;
    const out = await withTransaction(async (client) => {
      await lockHousehold(client, householdId);
      const move = await loadPending(client, householdId, id);
      if (!move) return { code: 404, body: { error: 'Withdrawal not found' } };
      if (move.status !== 'pending') return { code: 409, body: { error: `This withdrawal was already ${move.status}.` } };
      await client.query("update public.pocket_moves set status = 'cancelled' where id = $1", [id]);
      return { body: { move: { ...move, status: 'cancelled' } } };
    });
    return reply.code(out.code ?? 200).send(out.body);
  });
}
