import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money, shortDate } from '../format.js';

// Goals are goal-kind pockets: they hold real money, show progress, and can have a deadline.
export default function Goals() {
  const { household } = useAuth();
  const isAdmin = household.role === 'admin';
  const base = `/households/${household.id}`;
  const { data, error, loading, reload } = useLoad(() => api(`${base}/pockets`), [household.id]);
  const [form, setForm] = useState({ name: '', targetAmount: '', deadline: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const goals = data?.pockets.filter((p) => p.kind === 'goal') ?? [];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api(`${base}/pockets`, {
        method: 'POST',
        body: {
          name: form.name.trim(),
          kind: 'goal',
          targetAmount: Number(form.targetAmount),
          ...(form.deadline && { deadline: form.deadline }),
        },
      });
      setForm({ name: '', targetAmount: '', deadline: '' });
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Savings goals</h1>
      <p className="hint">
        Each goal is a pocket. Give it money from <Link to="/pockets">Pockets</Link> or through a split rule.
      </p>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && goals.length === 0 && <Empty>No goals yet. Add one below, like a school fees fund or a new generator.</Empty>}
      {goals.length > 0 && (
        <ul className="rows">
          {goals.map((g) => {
            const pct = Math.max(0, Math.min(100, (g.balance / g.targetAmount) * 100));
            return (
              <li key={g.id} className="row">
                <div className="row-main">
                  <span>
                    <Link to={`/pockets/${g.id}`}>{g.name}</Link>
                    {g.deadline && <span className="sub">By {shortDate(g.deadline)}</span>}
                  </span>
                  <span>{money(g.balance)}{g.targetAmount ? ` of ${money(g.targetAmount)}` : ''}</span>
                </div>
                {g.targetAmount && (
                  <div className="bar" role="img" aria-label={`${Math.round(pct)}% saved for ${g.name}`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin && (
        <form className="entry" onSubmit={submit}>
          <h2>New goal</h2>
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <label>
            Name
            <input required maxLength={60} value={form.name} onChange={set('name')} />
          </label>
          <label>
            Target (₦)
            <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.targetAmount}
              onChange={set('targetAmount')} />
          </label>
          <label>
            Deadline (optional)
            <input type="date" value={form.deadline} onChange={set('deadline')} />
          </label>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Add goal'}</button>
        </form>
      )}
    </>
  );
}
