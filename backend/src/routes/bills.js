import { query } from '../db.js';
import { requireMember, requireAdmin, householdParams, itemParams, uuid } from '../plugins/membership.js';
import { pocketBalances } from '../lib/ledger.js';
import { monthlyReserve, nextDueDate, daysBetween, lagosToday, isoDate } from '../lib/bills.js';

const fields = {
  pocketId: uuid,
  name: { type: 'string', minLength: 1, maxLength: 100 },
  amount: { type: 'number', exclusiveMinimum: 0 },
  frequency: { type: 'string', enum: ['monthly', 'yearly'] },
  dueDay: { type: 'integer', minimum: 1, maximum: 31 },
  dueMonth: { type: 'integer', minimum: 1, maximum: 12 },
  active: { type: 'boolean' },
};

const cols = `b.id, b.pocket_id as "pocketId", p.name as "pocketName", b.name, b.amount::float8 as amount,
  b.frequency::text as frequency, b.due_day as "dueDay", b.due_month as "dueMonth", b.active`;

const withReserve = (b) => ({ ...b, monthlyReserve: monthlyReserve(b) });
const badPocket = { error: 'That pocket was not found or is archived. Pick another pocket.' };
const needMonth = { error: 'A yearly bill needs the month it falls due.' };

export default async function billRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  const pocketOk = async (householdId, pocketId) =>
    (await query('select 1 from public.pockets where id = $1 and household_id = $2 and archived_at is null', [
      pocketId,
      householdId,
    ])).rowCount > 0;

  const one = async (householdId, id) =>
    (await query(
      `select ${cols} from public.bills b join public.pockets p on p.id = b.pocket_id
        where b.id = $2 and b.household_id = $1`,
      [householdId, id],
    )).rows[0];

  app.get('/', { schema: { params: householdParams } }, async (request) => {
    const { rows } = await query(
      `select ${cols} from public.bills b join public.pockets p on p.id = b.pocket_id
        where b.household_id = $1 order by b.active desc, b.name`,
      [request.params.householdId],
    );
    return { bills: rows.map(withReserve) };
  });

  // Active bills falling due in the next N days, with whether their pocket already holds enough.
  app.get(
    '/upcoming',
    {
      schema: {
        params: householdParams,
        querystring: {
          type: 'object',
          properties: { days: { type: 'integer', minimum: 1, maximum: 366, default: 30 } },
        },
      },
    },
    async (request) => {
      const { householdId } = request.params;
      const today = lagosToday();
      const [{ rows }, pockets] = await Promise.all([
        query(`select ${cols} from public.bills b join public.pockets p on p.id = b.pocket_id
                where b.household_id = $1 and b.active`, [householdId]),
        pocketBalances({ query }, householdId),
      ]);
      const balances = Object.fromEntries(pockets.map((p) => [p.id, p.balance]));
      const bills = rows
        .map((b) => {
          const due = nextDueDate(b, today);
          const pocketBalance = balances[b.pocketId] ?? 0;
          return {
            ...withReserve(b),
            dueDate: isoDate(due),
            daysUntil: daysBetween(today, due),
            pocketBalance,
            funded: pocketBalance >= b.amount,
          };
        })
        .filter((b) => b.daysUntil <= request.query.days)
        .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
      return { bills };
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
          required: ['pocketId', 'name', 'amount', 'frequency', 'dueDay'],
          additionalProperties: false,
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const b = request.body;
      if (b.frequency === 'yearly' && !b.dueMonth) return reply.code(400).send(needMonth);
      if (!(await pocketOk(householdId, b.pocketId))) return reply.code(400).send(badPocket);
      const { rows } = await query(
        `insert into public.bills (household_id, pocket_id, name, amount, frequency, due_day, due_month)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [householdId, b.pocketId, b.name.trim(), b.amount, b.frequency, b.dueDay,
          b.frequency === 'yearly' ? b.dueMonth : null],
      );
      return reply.code(201).send({ bill: withReserve(await one(householdId, rows[0].id)) });
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
      const existing = await one(householdId, id);
      if (!existing) return reply.code(404).send({ error: 'Bill not found' });
      if (b.pocketId && !(await pocketOk(householdId, b.pocketId))) return reply.code(400).send(badPocket);
      const frequency = b.frequency ?? existing.frequency;
      const dueMonth = frequency === 'yearly' ? (b.dueMonth ?? existing.dueMonth) : null;
      if (frequency === 'yearly' && !dueMonth) return reply.code(400).send(needMonth);
      await query(
        `update public.bills set
           pocket_id = coalesce($3, pocket_id), name = coalesce($4, name), amount = coalesce($5, amount),
           frequency = $6, due_day = coalesce($7, due_day), due_month = $8, active = coalesce($9, active)
         where id = $2 and household_id = $1`,
        [householdId, id, b.pocketId ?? null, b.name?.trim() ?? null, b.amount ?? null, frequency,
          b.dueDay ?? null, dueMonth, b.active ?? null],
      );
      return { bill: withReserve(await one(householdId, id)) };
    },
  );

  app.delete('/:id', { preHandler: requireAdmin, schema: { params: itemParams } }, async (request, reply) => {
    const res = await query('delete from public.bills where id = $2 and household_id = $1', [
      request.params.householdId,
      request.params.id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: 'Bill not found' });
    return reply.code(204).send();
  });
}
