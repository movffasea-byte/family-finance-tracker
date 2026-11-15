import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money, shortDate } from '../format.js';

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ type: 'expense', amount: '', categoryId: '', description: '', occurredOn: today() });

export default function Transactions() {
  const { household } = useAuth();
  const base = `/households/${household.id}`;
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const cats = useLoad(() => api(`${base}/categories`), [household.id]);
  const txs = useLoad(
    () => api(`${base}/transactions?limit=100${filter ? `&type=${filter}` : ''}`),
    [household.id, filter],
  );
  const catName = (id) => cats.data?.categories.find((c) => c.id === id)?.name;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api(`${base}/transactions`, {
        method: 'POST',
        body: {
          type: form.type,
          amount: Number(form.amount),
          occurredOn: form.occurredOn,
          ...(form.categoryId && { categoryId: form.categoryId }),
          ...(form.description.trim() && { description: form.description.trim() }),
        },
      });
      setForm({ ...blank(), type: form.type });
      txs.reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this transaction?')) return;
    try {
      await api(`${base}/transactions/${id}`, { method: 'DELETE' });
      txs.reload();
    } catch (err) {
      setFormError(err.message);
    }
  };

  return (
    <>
      <h1>Transactions</h1>

      <form className="entry" onSubmit={submit}>
        <div className="seg" role="group" aria-label="Type">
          {['expense', 'income'].map((t) => (
            <button key={t} type="button" aria-pressed={form.type === t}
              onClick={() => setForm({ ...form, type: t })}>
              {t === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>
        <label>
          Amount (₦)
          <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.amount}
            onChange={set('amount')} />
        </label>
        <label>
          Category
          <select value={form.categoryId} onChange={set('categoryId')}>
            <option value="">No category</option>
            {cats.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {cats.data?.categories.length === 0 && (
            <span className="hint">No categories yet. <Link to="/budgets">Add one under Budgets</Link>.</span>
          )}
        </label>
        <label>
          Note
          <input maxLength={300} value={form.description} onChange={set('description')} />
        </label>
        <label>
          Date
          <input type="date" required value={form.occurredOn} onChange={set('occurredOn')} />
        </label>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : `Add ${form.type}`}
        </button>
      </form>

      <div className="seg seg-filter" role="group" aria-label="Filter">
        {[['', 'All'], ['expense', 'Expenses'], ['income', 'Income']].map(([v, label]) => (
          <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>
            {label}
          </button>
        ))}
      </div>

      {txs.loading && <Loading />}
      {txs.error && <ErrorNote message={txs.error} onRetry={txs.reload} />}
      {txs.data && txs.data.transactions.length === 0 && <Empty>Nothing recorded yet. Add your first transaction above.</Empty>}
      {txs.data && txs.data.transactions.length > 0 && (
        <ul className="rows">
          {txs.data.transactions.map((t) => (
            <li key={t.id} className="row tx">
              <div className="row-main">
                <span>
                  {t.description || catName(t.categoryId) || (t.type === 'income' ? 'Income' : 'Expense')}
                  <span className="sub">
                    {shortDate(t.occurredOn)}
                    {catName(t.categoryId) && t.description ? ` · ${catName(t.categoryId)}` : ''}
                    {t.createdByName ? ` · ${t.createdByName}` : ''}
                  </span>
                </span>
                <span className={t.type === 'income' ? 'pos' : 'neg'}>
                  {t.type === 'income' ? '+' : '−'}{money(t.amount)}
                </span>
              </div>
              <button type="button" className="btn-quiet" onClick={() => remove(t.id)}
                aria-label={`Delete transaction of ${money(t.amount)}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
