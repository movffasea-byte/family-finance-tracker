import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading, MonthNav } from '../components.jsx';
import { currentPeriod, useLoad } from '../hooks.js';

function BudgetRow({ category, budget, period, base, onChange, onError }) {
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`${base}/budgets`, {
        method: 'POST',
        body: { categoryId: category.id, month: period.month, year: period.year, amount: Number(amount) },
      });
      onChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api(`${base}/budgets/${budget.id}`, { method: 'DELETE' });
      setAmount('');
      onChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="row">
      <form className="budget-form" onSubmit={save}>
        <label>
          {category.name}
          <input type="number" inputMode="decimal" min="0.01" step="0.01" required placeholder="₦ per month"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="submit" className="btn-small" disabled={busy}>{budget ? 'Update' : 'Set'}</button>
        {budget && (
          <button type="button" className="btn-quiet" disabled={busy} onClick={clear}
            aria-label={`Remove ${category.name} budget`}>
            Remove
          </button>
        )}
      </form>
    </li>
  );
}

export default function Budgets() {
  const { household } = useAuth();
  const base = `/households/${household.id}`;
  const [period, setPeriod] = useState(currentPeriod);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const cats = useLoad(() => api(`${base}/categories`), [household.id]);
  const budgets = useLoad(
    () => api(`${base}/budgets?month=${period.month}&year=${period.year}`),
    [household.id, period.month, period.year],
  );

  const addCategory = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`${base}/categories`, { method: 'POST', body: { name: newName.trim() } });
      setNewName('');
      cats.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1>Budgets</h1>
      <MonthNav period={period} onChange={setPeriod} />
      {error && <p className="field-error" role="alert">{error}</p>}

      {(cats.loading || budgets.loading) && <Loading />}
      {cats.error && <ErrorNote message={cats.error} onRetry={cats.reload} />}
      {budgets.error && <ErrorNote message={budgets.error} onRetry={budgets.reload} />}
      {cats.data?.categories.length === 0 && <Empty>Add a category below, like Food or School fees, then give it a monthly budget.</Empty>}

      {cats.data && budgets.data && (
        <ul className="rows">
          {cats.data.categories.map((c) => (
            <BudgetRow
              key={`${c.id}-${period.month}-${period.year}`}
              category={c}
              budget={budgets.data.budgets.find((b) => b.categoryId === c.id)}
              period={period}
              base={base}
              onChange={budgets.reload}
              onError={setError}
            />
          ))}
        </ul>
      )}

      <form className="inline-add" onSubmit={addCategory}>
        <label>
          New category
          <input required maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button type="submit" className="btn-small">Add category</button>
      </form>
    </>
  );
}
