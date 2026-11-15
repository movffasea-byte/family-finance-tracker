import { query } from '../db.js';
import { requireMember, householdParams, itemParams, uuid } from '../plugins/membership.js';

const cols = 'id, category_id as "categoryId", month, year, amount::float8 as amount';

export default async function budgetRoutes(app) {
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
            month: { type: 'integer', minimum: 1, maximum: 12 },
            year: { type: 'integer', minimum: 2000, maximum: 2100 },
          },
        },
      },
    },
    async (request) => {
      const { month, year } = request.query;
      const { rows } = await query(
        `select ${cols} from public.budgets
          where household_id = $1
            and ($2::int is null or month = $2)
            and ($3::int is null or year = $3)
          order by year desc, month desc`,
        [request.params.householdId, month ?? null, year ?? null],
      );
      return { budgets: rows };
    },
  );

  // One budget per category per month: posting again updates the amount.
  app.post(
    '/',
    {
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['categoryId', 'month', 'year', 'amount'],
          additionalProperties: false,
          properties: {
            categoryId: uuid,
            month: { type: 'integer', minimum: 1, maximum: 12 },
            year: { type: 'integer', minimum: 2000, maximum: 2100 },
            amount: { type: 'number', exclusiveMinimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const b = request.body;
      const cat = await query('select 1 from public.categories where id = $1 and household_id = $2', [
        b.categoryId,
        householdId,
      ]);
      if (!cat.rowCount) return reply.code(400).send({ error: 'Unknown category' });
      const { rows } = await query(
        `insert into public.budgets (household_id, category_id, month, year, amount)
         values ($1, $2, $3, $4, $5)
         on conflict (household_id, category_id, month, year) do update set amount = excluded.amount
         returning ${cols}`,
        [householdId, b.categoryId, b.month, b.year, b.amount],
      );
      return reply.code(201).send({ budget: rows[0] });
    },
  );

  app.delete('/:id', { schema: { params: itemParams } }, async (request, reply) => {
    const res = await query('delete from public.budgets where id = $2 and household_id = $1', [
      request.params.householdId,
      request.params.id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: 'Budget not found' });
    return reply.code(204).send();
  });
}
