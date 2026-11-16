import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading, MonthNav } from '../components.jsx';
import { currentPeriod, useLoad } from '../hooks.js';
import { money } from '../format.js';

export default function Dashboard() {
  const { household } = useAuth();
  const [period, setPeriod] = useState(currentPeriod);
  const { data, error, loading, reload } = useLoad(
    () => api(`/households/${household.id}/summary?month=${period.month}&year=${period.year}`),
    [household.id, period.month, period.year],
  );

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
