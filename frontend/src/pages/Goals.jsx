import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money, shortDate } from '../format.js';

function GoalRow({ goal, base, onChange, onError }) {
  const [saved, setSaved] = useState(String(goal.currentAmount));
  const [busy, setBusy] = useState(false);
  const pct = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);

  const update = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`${base}/goals/${goal.id}`, { method: 'PATCH', body: { currentAmount: Number(saved) } });
      onChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the goal "${goal.name}"?`)) return;
    try {
      await api(`${base}/goals/${goal.id}`, { method: 'DELETE' });
      onChange();
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <li className="row">
      <div className="row-main">
        <span>
          {goal.name}
          {goal.deadline && <span className="sub">By {shortDate(goal.deadline)}</span>}
        </span>
        <span>{money(goal.currentAmount)} of {money(goal.targetAmount)}</span>
      </div>
      <div className="bar" role="img" aria-label={`${Math.round(pct)}% saved for ${goal.name}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <form className="budget-form" onSubmit={update}>
        <label>
          Saved so far (₦)
          <input type="number" inputMode="decimal" min="0" step="0.01" required value={saved}
            onChange={(e) => setSaved(e.target.value)} />
        </label>
        <button type="submit" className="btn-small" disabled={busy}>Update</button>
        <button type="button" className="btn-quiet" onClick={remove}>Delete</button>
      </form>
    </li>
  );
}

export default function Goals() {
  const { household } = useAuth();
  const base = `/households/${household.id}`;
  const { data, error, loading, reload } = useLoad(() => api(`${base}/goals`), [household.id]);
  const [form, setForm] = useState({ name: '', targetAmount: '', deadline: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api(`${base}/goals`, {
        method: 'POST',
        body: {
          name: form.name.trim(),
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
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {formError && <p className="field-error" role="alert">{formError}</p>}
      {data?.goals.length === 0 && <Empty>No goals yet. Add one below, like a school fees fund or a new generator.</Empty>}
      {data && (
        <ul className="rows">
          {data.goals.map((g) => (
            <GoalRow key={`${g.id}-${g.currentAmount}`} goal={g} base={base} onChange={reload} onError={setFormError} />
          ))}
        </ul>
      )}

      <form className="entry" onSubmit={submit}>
        <h2>New goal</h2>
        <label>
          Name
          <input required maxLength={100} value={form.name} onChange={set('name')} />
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
    </>
  );
}
