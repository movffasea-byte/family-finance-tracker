import { query } from '../db.js';

// preHandler for routes under /households/:householdId. Returns 404 for non-members
// so household ids can't be probed.
export async function requireMember(request, reply) {
  const { rows } = await query(
    'select role from public.memberships where user_id = $1 and household_id = $2',
    [request.user.sub, request.params.householdId],
  );
  if (!rows.length) return reply.code(404).send({ error: 'Household not found' });
  request.role = rows[0].role;
}

// preHandler used after requireMember for admin-only routes.
export async function requireAdmin(request, reply) {
  if (request.role !== 'admin') return reply.code(403).send({ error: 'Only admins can do this' });
}

export const uuid = { type: 'string', format: 'uuid' };
export const householdParams = {
  type: 'object',
  required: ['householdId'],
  properties: { householdId: uuid },
};
export const itemParams = {
  type: 'object',
  required: ['householdId', 'id'],
  properties: { householdId: uuid, id: uuid },
};
