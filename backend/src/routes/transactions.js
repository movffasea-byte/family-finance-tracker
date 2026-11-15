import { query } from '../db.js';
import { requireMember, householdParams, itemParams, uuid } from '../plugins/membership.js';

const fields = {
  type: { type: 'string', enum: ['income', 'expense'] },
  amount: { type: 'number', exclusiveMinimum: 0 },
  categoryId: uuid,
  description: { type: 'string', maxLength: 300 },
  occurredOn: { type: 'string', format: 'date' },
};

const cols = `id, category_id as "categoryId", created_by as "createdBy",
  (select name from public.users u where u.id = created_by) as "createdByName", type,
  amount::float8 as amount, description, occurred_on::text as "occurredOn"`;

export default async function transactionRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  // The category, if given, must belong to the same household.
  const categoryOk = async (householdId, categoryId) => {
    if (!categoryId) return true;
    const { rowCount } = await query(
      'select 1 from public.categories where id = $1 and household_id = $2',
      [categoryId, householdId],
    );
    return rowCount > 0;
  };

  app.get(
    '/',
    {
      schema: {
        params: householdParams,
        querystring: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            type: fields.type,
            categoryId: uuid,
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request) => {
      const { from, to, type, categoryId, limit, offset } = request.query;
      const { rows } = await query(
        `select ${cols} from public.transactions
          where household_id = $1
            and ($2::date is null or occurred_on >= $2)
            and ($3::date is null or occurred_on <= $3)
            and ($4::public.transaction_type is null or type = $4)
            and ($5::uuid is null or category_id = $5)
          order by occurred_on desc, created_at desc
          limit $6 offset $7`,
        [request.params.householdId, from ?? null, to ?? null, type ?? null, categoryId ?? null, limit, offset],
      );
      return { transactions: rows };
    },
  );

  app.post(
    '/',
    {
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['type', 'amount'],
          additionalProperties: false,
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const b = request.body;
      if (!(await categoryOk(householdId, b.categoryId)))
        return reply.code(400).send({ error: 'Unknown category' });
      const { rows } = await query(
        `insert into public.transactions
           (household_id, category_id, created_by, type, amount, description, occurred_on)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::date, current_date))
         returning ${cols}`,
        [householdId, b.categoryId ?? null, request.user.sub, b.type, b.amount, b.description ?? null, b.occurredOn ?? null],
      );
      return reply.code(201).send({ transaction: rows[0] });
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
      const { householdId, id } = request.params;
      const b = request.body;
      if (!(await categoryOk(householdId, b.categoryId)))
        return reply.code(400).send({ error: 'Unknown category' });
      const { rows } = await query(
        `update public.transactions set
           type = coalesce($3, type),
           amount = coalesce($4, amount),
           category_id = coalesce($5, category_id),
           description = coalesce($6, description),
           occurred_on = coalesce($7::date, occurred_on)
         where id = $2 and household_id = $1
         returning ${cols}`,
        [householdId, id, b.type ?? null, b.amount ?? null, b.categoryId ?? null, b.description ?? null, b.occurredOn ?? null],
      );
      if (!rows.length) return reply.code(404).send({ error: 'Transaction not found' });
      return { transaction: rows[0] };
    },
  );

  app.delete('/:id', { schema: { params: itemParams } }, async (request, reply) => {
    const res = await query('delete from public.transactions where id = $2 and household_id = $1', [
      request.params.householdId,
      request.params.id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: 'Transaction not found' });
    return reply.code(204).send();
  });
}
