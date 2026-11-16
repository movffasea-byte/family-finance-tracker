import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money, shortDate } from '../format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const blank = { pocketId: '', name: '', amount: '', frequency: 'monthly', dueDay: '1', dueMonth: '1' };

export default function Bills() {
  const { household } = useAuth();
  const isAdmin = household.role === 'admin';
  const base = `/households/${household.id}`;
  const bills = useLoad(() => api(`${base}/bills`), [household.id]);
  const upcoming = useLoad(() => api(`${base}/bills/upcoming?days=30`), [household.id]);
  const pockets = useLoad(() => api(`${base}/pockets`), [household.id]);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    bills.reload();
    upcoming.reload();
  };
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const run = async (fn) => {
    setBusy(true);
    setFormError('');
    try {
      await fn();
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`${base}/bills`, {
        method: 'POST',
        body: {
          pocketId: form.pocketId || pockets.data?.pockets[0]?.id,
          name: form.name.trim(),
          amount: Number(form.amount),
          frequency: form.frequency,
          dueDay: Number(form.dueDay),
          ...(form.frequency === 'yearly' && { dueMonth: Number(form.dueMonth) }),
        },
      });
      setForm({ ...blank, pocketId: form.pocketId });
    });
  };

  const remove = (b) => {
    if (!window.confirm(`Delete the bill "${b.name}"?`)) return;
    run(() => api(`${base}/bills/${b.id}`, { method: 'DELETE' }));
  };

  return (
    <>
      <p><Link to="/pockets">‹ All pockets</Link></p>
      <h1>Bills</h1>

      <section>
        <h2>Due in the next 30 days</h2>
        {upcoming.loading && <Loading />}
        {upcoming.error && <ErrorNote message={upcoming.error} onRetry={upcoming.reload} />}
        {upcoming.data?.bills.length === 0 && <Empty>No bills are due in the next 30 days.</Empty>}
        {upcoming.data?.bills.length > 0 && (
          <ul className="rows">
            {upcoming.data.bills.map((b) => (
              <li key={b.id} className="row row-main">
                <span>
                  {b.name}
                  <span className={`sub ${b.funded ? '' : 'neg'}`}>
                    {shortDate(b.dueDate)} · {b.pocketName} has {money(b.pocketBalance)}
                    {b.funded ? ' · covered' : ' · not covered yet'}
                  </span>
                </span>
                <span>{money(b.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>All bills</h2>
        {bills.loading && <Loading />}
        {bills.error && <ErrorNote message={bills.error} onRetry={bills.reload} />}
        {formError && <p className="field-error" role="alert">{formError}</p>}
        {bills.data?.bills.length === 0 && (
          <Empty>No bills yet. {isAdmin ? 'Add one below, such as rent or electricity.' : 'An admin can add them.'}</Empty>
        )}
        {bills.data?.bills.length > 0 && (
          <ul className="rows">
            {bills.data.bills.map((b) => (
              <li key={b.id} className="row">
                <div className="row-main">
                  <span>
                    {b.name}
                    <span className="sub">
                      {b.frequency === 'yearly' ? `Yearly, ${MONTHS[b.dueMonth - 1]} ${b.dueDay}` : `Monthly, day ${b.dueDay}`}
                      {' · '}pocket {b.pocketName} · sets aside {money(b.monthlyReserve)} a month
                    </span>
                  </span>
                  <span>{money(b.amount)}</span>
                </div>
                {isAdmin && (
                  <button type="button" className="btn-quiet" disabled={busy} onClick={() => remove(b)}>Delete</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin && (
        <form className="entry" onSubmit={submit}>
          <h2>New bill</h2>
          <label>
            Name
            <input required maxLength={100} value={form.name} onChange={set('name')} />
          </label>
          <label>
            Amount (₦)
            <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.amount}
              onChange={set('amount')} />
          </label>
          <label>
            Pocket that pays it
            <select value={form.pocketId || pockets.data?.pockets[0]?.id || ''} onChange={set('pocketId')} required>
              {pockets.data?.pockets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {pockets.data?.pockets.length === 0 && (
              <span className="hint">Create a pocket first on the <Link to="/pockets">Pockets page</Link>.</span>
            )}
          </label>
          <label>
            How often
            <select value={form.frequency} onChange={set('frequency')}>
              <option value="monthly">Every month</option>
              <option value="yearly">Once a year</option>
            </select>
          </label>
          {form.frequency === 'yearly' && (
            <label>
              Month due
              <select value={form.dueMonth} onChange={set('dueMonth')}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Day of the month due
            <input type="number" min="1" max="31" required value={form.dueDay} onChange={set('dueDay')} />
          </label>
          <button type="submit" className="btn" disabled={busy || !pockets.data?.pockets.length}>
            {busy ? 'Saving…' : 'Add bill'}
          </button>
        </form>
      )}
    </>
  );
}
