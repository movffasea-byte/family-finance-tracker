import { query } from '../db.js';
import { requireMember, householdParams, itemParams } from '../plugins/membership.js';

const body = {
  type: 'object',
  additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
};

export default async function categoryRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  app.get('/', { schema: { params: householdParams } }, async (request) => {
    const { rows } = await query(
      'select id, name from public.categories where household_id = $1 order by name',
      [request.params.householdId],
    );
    return { categories: rows };
  });

  app.post(
    '/',
    { schema: { params: householdParams, body: { ...body, required: ['name'] } } },
    async (request, reply) => {
      const { rows } = await query(
        'insert into public.categories (household_id, name) values ($1, $2) returning id, name',
        [request.params.householdId, request.body.name],
      );
      return reply.code(201).send({ category: rows[0] });
    },
  );

  app.patch(
    '/:id',
    { schema: { params: itemParams, body: { ...body, required: ['name'] } } },
    async (request, reply) => {
      const { rows } = await query(
        'update public.categories set name = $3 where id = $2 and household_id = $1 returning id, name',
        [request.params.householdId, request.params.id, request.body.name],
      );
      if (!rows.length) return reply.code(404).send({ error: 'Category not found' });
      return { category: rows[0] };
    },
  );

  app.delete('/:id', { schema: { params: itemParams } }, async (request, reply) => {
    const res = await query('delete from public.categories where id = $2 and household_id = $1', [
      request.params.householdId,
      request.params.id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: 'Category not found' });
    return reply.code(204).send();
  });
}
