import { query } from '../db.js';
import { readyToAssign, safeToSpend, pocketBalances } from '../lib/ledger.js';
import { lagosToday, daysLeftInMonth } from '../lib/bills.js';
import { requireMember, householdParams } from '../plugins/membership.js';

export default async function summaryRoutes(app) {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', requireMember);

  // Month totals plus spent-vs-budget per category.
  app.get(
    '/',
    {
      schema: {
        params: householdParams,
        querystring: {
          type: 'object',
          required: ['month', 'year'],
          properties: {
            month: { type: 'integer', minimum: 1, maximum: 12 },
            year: { type: 'integer', minimum: 2000, maximum: 2100 },
          },
        },
      },
    },
    async (request) => {
      const { householdId } = request.params;
      const { month, year } = request.query;

      const totals = await query(
        `select
           coalesce(sum(amount) filter (where type = 'income'), 0)::float8 as income,
           coalesce(sum(amount) filter (where type = 'expense'), 0)::float8 as expense
         from public.transactions
         where household_id = $1
           and extract(month from occurred_on) = $2 and extract(year from occurred_on) = $3`,
        [householdId, month, year],
      );

      const categories = await query(
        `select c.id as "categoryId", c.name,
                coalesce(s.spent, 0)::float8 as spent,
                b.amount::float8 as budget
           from public.categories c
           left join (
             select category_id, sum(amount) as spent
               from public.transactions
              where household_id = $1 and type = 'expense'
                and extract(month from occurred_on) = $2 and extract(year from occurred_on) = $3
              group by category_id
           ) s on s.category_id = c.id
           left join public.budgets b
             on b.category_id = c.id and b.household_id = $1 and b.month = $2 and b.year = $3
          where c.household_id = $1
          order by c.name`,
        [householdId, month, year],
      );

      const { income, expense } = totals.rows[0];
      const safe = await safeToSpend({ query }, householdId);
      const daysLeft = daysLeftInMonth(lagosToday());
      const overspent = (await pocketBalances({ query }, householdId))
        .filter((p) => p.balance < 0)
        .map(({ id, name, balance }) => ({ id, name, balance }));
      return {
        month,
        year,
        income,
        expense,
        balance: income - expense,
        readyToAssign: await readyToAssign({ query }, householdId),
        safeToSpend: safe,
        safePerDay: Math.max(0, Math.round((safe / daysLeft) * 100) / 100),
        daysLeft,
        overspent,
        categories: categories.rows,
      };
    },
  );
}
