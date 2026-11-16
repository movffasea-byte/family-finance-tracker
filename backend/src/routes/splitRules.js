import { query, withTransaction } from '../db.js';
import { requireMember, requireAdmin, householdParams, uuid } from '../plugins/membership.js';
import { lockHousehold } from '../lib/ledger.js';

const ruleSchema = {
  type: 'object',
  required: ['pocketId', 'method', 'value'],
  additionalProperties: false,
  properties: {
    pocketId: uuid,
    method: { type: 'string', enum: ['fixed', 'percent'] },
    value: { type: 'number', exclusiveMinimum: 0 },
  },
};

export const loadRules = (db, householdId) =>
  db
    .query(
      `select r.pocket_id as "pocketId", p.name as "pocketName", r.method::text as method,
              r.value::float8 as value, r.priority
         from public.split_rules r
         join public.pockets p on p.id = r.pocket_id
        where r.household_id = $1 and p.archived_at is null
        order by r.priority`,
      [householdId],
    )
    .then((res) => res.rows);

export default async function splitRuleRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  app.get('/', { schema: { params: householdParams } }, async (request) => ({
    rules: await loadRules({ query }, request.params.householdId),
  }));

  // Replaces the whole rule set at once. Array order is the priority.
  app.put(
    '/',
    {
      preHandler: requireAdmin,
      schema: {
        params: householdParams,
        body: {
          type: 'object',
          required: ['rules'],
          additionalProperties: false,
          properties: { rules: { type: 'array', maxItems: 50, items: ruleSchema } },
        },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params;
      const { rules } = request.body;

      const ids = rules.map((r) => r.pocketId);
      if (new Set(ids).size !== ids.length)
        return reply.code(400).send({ error: 'Each pocket can only have one rule.' });
      const percents = rules.filter((r) => r.method === 'percent');
      if (percents.some((r) => r.value > 100))
        return reply.code(400).send({ error: 'A percentage cannot be more than 100.' });
      const totalHundredths = percents.reduce((s, r) => s + Math.round(r.value * 100), 0);
      if (totalHundredths > 10000)
        return reply.code(400).send({
          error: `Your percentages add up to ${totalHundredths / 100}%. They cannot be more than 100%.`,
        });
      if (rules.some((r) => Math.round(r.value * 100) / 100 !== r.value))
        return reply.code(400).send({ error: 'Use at most two decimal places for each value.' });

      return withTransaction(async (client) => {
        await lockHousehold(client, householdId);
        if (ids.length) {
          const { rowCount } = await client.query(
            'select 1 from public.pockets where household_id = $1 and archived_at is null and id = any($2::uuid[])',
            [householdId, ids],
          );
          if (rowCount !== ids.length)
            return reply.code(400).send({ error: 'One of those pockets was not found or is archived.' });
        }
        await client.query('delete from public.split_rules where household_id = $1', [householdId]);
        for (const [i, r] of rules.entries()) {
          await client.query(
            `insert into public.split_rules (household_id, pocket_id, method, value, priority)
             values ($1, $2, $3, $4, $5)`,
            [householdId, r.pocketId, r.method, r.value, i + 1],
          );
        }
        return { rules: await loadRules(client, householdId) };
      });
    },
  );
}
