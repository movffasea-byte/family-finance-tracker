import { query } from '../db.js';

export default async function householdRoutes(app) {
  app.addHook('onRequest', app.authenticate);

  // Households the current user belongs to, with their role.
  app.get('/', async (request) => {
    const { rows } = await query(
      `select h.id, h.name, m.role
         from public.memberships m
         join public.households h on h.id = m.household_id
        where m.user_id = $1
        order by h.created_at`,
      [request.user.sub],
    );
    return { households: rows };
  });

  // Members of a household the caller belongs to.
  app.get(
    '/:id/members',
    { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } } },
    async (request, reply) => {
      const { id } = request.params;
      const mine = await query(
        'select 1 from public.memberships where user_id = $1 and household_id = $2',
        [request.user.sub, id],
      );
      if (!mine.rowCount) return reply.code(404).send({ error: 'Household not found' });
      const { rows } = await query(
        `select u.id, u.name, u.email, m.role, m.joined_at
           from public.memberships m
           join public.users u on u.id = m.user_id
          where m.household_id = $1
          order by m.joined_at`,
        [id],
      );
      return { members: rows };
    },
  );

  const roleOf = async (userId, householdId) => {
    const { rows } = await query(
      'select role from public.memberships where user_id = $1 and household_id = $2',
      [userId, householdId],
    );
    return rows[0]?.role ?? null;
  };

  // Admin adds an already-registered user to the household by email.
  app.post(
    '/:id/members',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            role: { type: 'string', enum: ['admin', 'member'], default: 'member' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const mine = await roleOf(request.user.sub, id);
      if (!mine) return reply.code(404).send({ error: 'Household not found' });
      if (mine !== 'admin') return reply.code(403).send({ error: 'Only admins can add members' });

      const found = await query('select id, name, email from public.users where email = lower($1)', [
        request.body.email,
      ]);
      if (!found.rowCount)
        return reply.code(404).send({ error: 'No account with that email. Ask them to register first.' });

      const added = await query(
        `insert into public.memberships (user_id, household_id, role) values ($1, $2, $3)
         on conflict (user_id, household_id) do nothing returning role, joined_at`,
        [found.rows[0].id, id, request.body.role],
      );
      if (!added.rowCount) return reply.code(409).send({ error: 'They are already in this household' });
      return reply.code(201).send({ member: { ...found.rows[0], ...added.rows[0] } });
    },
  );

  // Admin removes a member. The last admin can't be removed.
  app.delete(
    '/:id/members/:userId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { id, userId } = request.params;
      const mine = await roleOf(request.user.sub, id);
      if (!mine) return reply.code(404).send({ error: 'Household not found' });
      if (mine !== 'admin') return reply.code(403).send({ error: 'Only admins can remove members' });

      const target = await roleOf(userId, id);
      if (!target) return reply.code(404).send({ error: 'Member not found' });
      if (target === 'admin') {
        const admins = await query(
          "select count(*)::int as n from public.memberships where household_id = $1 and role = 'admin'",
          [id],
        );
        if (admins.rows[0].n <= 1)
          return reply.code(400).send({ error: 'A household needs at least one admin' });
      }
      await query('delete from public.memberships where user_id = $1 and household_id = $2', [userId, id]);
      return reply.code(204).send();
    },
  );
}
