import { query } from '../db.js';
import { requireMember, householdParams, itemParams } from '../plugins/membership.js';

const fields = {
  name: { type: 'string', minLength: 1, maxLength: 100 },
  targetAmount: { type: 'number', exclusiveMinimum: 0 },
  currentAmount: { type: 'number', minimum: 0 },
  deadline: { type: 'string', format: 'date' },
};

const cols = `id, name, target_amount::float8 as "targetAmount",
  current_amount::float8 as "currentAmount", deadline::text as deadline`;

export default async function goalRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  app.get('/', { schema: { params: householdParams } }, async (request) => {
    const { rows } = await query(
      `select ${cols} from public.savings_goals where household_id = $1 order by created_at`,
      [request.params.householdId],
    );
    return { goals: rows };
  });

  app.post(
    '/',
    {
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['name', 'targetAmount'],
          additionalProperties: false,
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const { rows } = await query(
        `insert into public.savings_goals (household_id, name, target_amount, current_amount, deadline)
         values ($1, $2, $3, coalesce($4, 0), $5::date)
         returning ${cols}`,
        [request.params.householdId, b.name, b.targetAmount, b.currentAmount ?? null, b.deadline ?? null],
      );
      return reply.code(201).send({ goal: rows[0] });
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: itemParams,
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const { rows } = await query(
        `update public.savings_goals set
           name = coalesce($3, name),
           target_amount = coalesce($4, target_amount),
           current_amount = coalesce($5, current_amount),
           deadline = coalesce($6::date, deadline)
         where id = $2 and household_id = $1
         returning ${cols}`,
        [request.params.householdId, request.params.id, b.name ?? null, b.targetAmount ?? null, b.currentAmount ?? null, b.deadline ?? null],
      );
      if (!rows.length) return reply.code(404).send({ error: 'Goal not found' });
      return { goal: rows[0] };
    },
  );

  app.delete('/:id', { schema: { params: itemParams } }, async (request, reply) => {
    const res = await query('delete from public.savings_goals where id = $2 and household_id = $1', [
      request.params.householdId,
      request.params.id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: 'Goal not found' });
    return reply.code(204).send();
  });
}
