import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money } from '../format.js';

export const KINDS = [
  ['bill', 'Bill'],
  ['savings', 'Savings'],
  ['goal', 'Goal'],
  ['emergency', 'Emergency'],
  ['spending', 'Spending'],
];
const kindLabel = (k) => KINDS.find(([v]) => v === k)?.[1] ?? k;

export default function Pockets() {
  const { household } = useAuth();
  const isAdmin = household.role === 'admin';
  const base = `/households/${household.id}`;
  const { data, error, loading, reload } = useLoad(() => api(`${base}/pockets`), [household.id]);

  const [newForm, setNewForm] = useState({ name: '', kind: 'bill', targetAmount: '' });
  const [moveForm, setMoveForm] = useState({ from: '', to: '', amount: '', note: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`${base}/pockets`, {
        method: 'POST',
        body: {
          name: newForm.name.trim(),
          kind: newForm.kind,
          ...(newForm.targetAmount && { targetAmount: Number(newForm.targetAmount) }),
        },
      });
      setNewForm({ name: '', kind: newForm.kind, targetAmount: '' });
    });
  };

  const move = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`${base}/pocket-moves`, {
        method: 'POST',
        body: {
          fromPocketId: moveForm.from || null,
          toPocketId: moveForm.to || null,
          amount: Number(moveForm.amount),
          ...(moveForm.note.trim() && { note: moveForm.note.trim() }),
        },
      });
      setMoveForm({ from: '', to: '', amount: '', note: '' });
    });
  };

  const archive = (p) => {
    if (!window.confirm(`Archive the pocket "${p.name}"?`)) return;
    run(() => api(`${base}/pockets/${p.id}`, { method: 'DELETE' }));
  };

  const pocketOptions = (
    <>
      <option value="">Ready to assign</option>
      {data?.pockets.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </>
  );

  return (
    <>
      <h1>Pockets</h1>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && (
        <>
          <section aria-label="Ready to assign">
            <h2>Ready to assign</h2>
            <p className="row-main">
              <span>Money that has come in but has no job yet</span>
              <span className={data.readyToAssign < 0 ? 'neg' : ''}>{money(data.readyToAssign)}</span>
            </p>
          </section>

          {formError && <p className="field-error" role="alert">{formError}</p>}

          <section>
            <h2>Your pockets</h2>
            {data.pockets.length === 0 ? (
              <Empty>
                No pockets yet.{' '}
                {isAdmin ? 'Add one below, such as Rent or Savings.' : 'An admin can add them.'}
              </Empty>
            ) : (
              <ul className="rows">
                {data.pockets.map((p) => {
                  const pct = p.targetAmount ? Math.max(0, Math.min(100, (p.balance / p.targetAmount) * 100)) : null;
                  return (
                    <li key={p.id} className="row">
                      <div className="row-main">
                        <span>
                          <Link to={`/pockets/${p.id}`}>{p.name}</Link>
                          <span className="sub">
                            {kindLabel(p.kind)}
                            {p.targetAmount ? ` · target ${money(p.targetAmount)}` : ''}
                          </span>
                        </span>
                        <span className={p.balance < 0 ? 'neg' : ''}>{money(p.balance)}</span>
                      </div>
                      {pct !== null && (
                        <div className="bar" role="img" aria-label={`${Math.round(pct)}% of target for ${p.name}`}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {isAdmin && (
                        <button type="button" className="btn-quiet" disabled={busy} onClick={() => archive(p)}
                          aria-label={`Archive ${p.name}`}>
                          Archive
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {isAdmin && (
            <>
              <form className="entry" onSubmit={move}>
                <h2>Move money</h2>
                <label>
                  From
                  <select value={moveForm.from} onChange={(e) => setMoveForm({ ...moveForm, from: e.target.value })}>
                    {pocketOptions}
                  </select>
                </label>
                <label>
                  To
                  <select value={moveForm.to} onChange={(e) => setMoveForm({ ...moveForm, to: e.target.value })}>
                    {pocketOptions}
                  </select>
                </label>
                <label>
                  Amount (₦)
                  <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={moveForm.amount}
                    onChange={(e) => setMoveForm({ ...moveForm, amount: e.target.value })} />
                </label>
                <label>
                  Note
                  <input maxLength={200} value={moveForm.note}
                    onChange={(e) => setMoveForm({ ...moveForm, note: e.target.value })} />
                </label>
                <button type="submit" className="btn" disabled={busy}>{busy ? 'Moving…' : 'Move money'}</button>
              </form>

              <form className="entry" onSubmit={create}>
                <h2>New pocket</h2>
                <label>
                  Name
                  <input required maxLength={60} value={newForm.name}
                    onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} />
                </label>
                <label>
                  Kind
                  <select value={newForm.kind} onChange={(e) => setNewForm({ ...newForm, kind: e.target.value })}>
                    {KINDS.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Target (₦, optional)
                  <input type="number" inputMode="decimal" min="0.01" step="0.01" value={newForm.targetAmount}
                    onChange={(e) => setNewForm({ ...newForm, targetAmount: e.target.value })} />
                </label>
                <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Add pocket'}</button>
              </form>
            </>
          )}
        </>
      )}
    </>
  );
}
