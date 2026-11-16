import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading, MonthNav } from '../components.jsx';
import { currentPeriod, useLoad } from '../hooks.js';
import { money, shortDate } from '../format.js';

export default function Dashboard() {
  const { household } = useAuth();
  const [period, setPeriod] = useState(currentPeriod);
  const { data, error, loading, reload } = useLoad(
    () => api(`/households/${household.id}/summary?month=${period.month}&year=${period.year}`),
    [household.id, period.month, period.year],
  );

  const waiting = useLoad(
    () => (household.role === 'admin' ? api(`/households/${household.id}/allocations?status=proposed`) : Promise.resolve(null)),
    [household.id],
  );
  const bills = useLoad(() => api(`/households/${household.id}/bills/upcoming?days=14`), [household.id]);
  const pending = waiting.data?.allocations.length ?? 0;

  const budgeted = data?.categories.filter((c) => c.budget != null) ?? [];
  const unbudgeted = data?.categories.filter((c) => c.budget == null && c.spent > 0) ?? [];

  return (
    <>
      <MonthNav period={period} onChange={setPeriod} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && (
        <>
          <section className="balance" aria-label="Month balance">
            <p className="balance-label">Left this month</p>
            <p className={`balance-figure ${data.balance < 0 ? 'neg' : ''}`}>{money(data.balance)}</p>
            <dl className="balance-split">
              <div>
                <dt>Came in</dt>
                <dd>{money(data.income)}</dd>
              </div>
              <div>
                <dt>Went out</dt>
                <dd>{money(data.expense)}</dd>
              </div>
            </dl>
            <p className="balance-label">
              Ready to assign: {money(data.readyToAssign)}
              {data.readyToAssign > 0 && (
                <>
                  {' '}
                  <Link to="/pockets" className="balance-link">Give it a job →</Link>
                </>
              )}
            </p>
          </section>

          <section aria-label="Safe to spend">
            <p className="row-main">
              <span>
                Safe to spend
                <span className="sub">What your spending pockets hold, spread over {data.daysLeft} {data.daysLeft === 1 ? 'day' : 'days'} left this month</span>
              </span>
              <span className={data.safeToSpend < 0 ? 'neg' : ''}>
                {money(data.safeToSpend)} · about {money(data.safePerDay)} a day
              </span>
            </p>
          </section>

          {data.overspent.length > 0 && (
            <section aria-label="Overspent pockets">
              <h2>Overspent</h2>
              <ul className="rows">
                {data.overspent.map((p) => (
                  <li key={p.id} className="row row-main">
                    <span><Link to="/pockets">{p.name}</Link></span>
                    <span className="neg">{money(p.balance)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {bills.data?.bills.length > 0 && (
            <section aria-label="Upcoming bills">
              <h2>Upcoming bills</h2>
              <ul className="rows">
                {bills.data.bills.map((b) => (
                  <li key={b.id} className="row row-main">
                    <span>
                      {b.name}
                      <span className={`sub ${b.funded ? '' : 'neg'}`}>
                        {shortDate(b.dueDate)}{b.funded ? ' · covered' : ' · not covered yet'}
                      </span>
                    </span>
                    <span>{money(b.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pending > 0 && (
            <p>
              <Link to="/approvals">{pending} {pending === 1 ? 'split is' : 'splits are'} waiting for approval →</Link>
            </p>
          )}

          <section>
            <h2>Budgets</h2>
            {budgeted.length === 0 ? (
              <Empty>
                No budgets set for this month. <Link to="/budgets">Set a budget</Link>
              </Empty>
            ) : (
              <ul className="rows">
                {budgeted.map((c) => {
                  const pct = Math.min(100, (c.spent / c.budget) * 100);
                  const over = c.spent > c.budget;
                  return (
                    <li key={c.categoryId} className="row">
                      <div className="row-main">
                        <span>{c.name}</span>
                        <span className={over ? 'neg' : ''}>
                          {money(c.spent)} of {money(c.budget)}
                        </span>
                      </div>
                      <div className="bar" role="img"
                        aria-label={`${Math.round(pct)}% of ${c.name} budget used`}>
                        <span className={over ? 'over' : ''} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {unbudgeted.length > 0 && (
            <section>
              <h2>Spent without a budget</h2>
              <ul className="rows">
                {unbudgeted.map((c) => (
                  <li key={c.categoryId} className="row row-main">
                    <span>{c.name}</span>
                    <span>{money(c.spent)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
