import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { ErrorNote, Loading } from './components.jsx';
import { money } from './format.js';

// Shown after income is saved: proposes a split, lets the user edit it, then sends it for
// approval (members) or approves it straight away (admins).
export default function SplitSheet({ income, onDone }) {
  const { household } = useAuth();
  const isAdmin = household.role === 'admin';
  const base = `/households/${household.id}`;
  const [lines, setLines] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    api(`${base}/allocations/preview`, { method: 'POST', body: { amount: income.amount } })
      .then((p) => live && setLines(p.lines.map((l) => ({ pocketId: l.pocketId, name: l.pocketName, amount: String(l.amount) }))))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [base, income.amount]);

  const total = (lines ?? []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const left = Math.round((income.amount - total) * 100) / 100;
  const edit = (i, v) => setLines(lines.map((l, j) => (j === i ? { ...l, amount: v } : l)));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = lines.filter((l) => Number(l.amount) > 0).map((l) => ({ pocketId: l.pocketId, amount: Number(l.amount) }));
      const { allocation } = await api(`${base}/allocations`, {
        method: 'POST',
        body: { incomeTransactionId: income.id, lines: payload },
      });
      if (isAdmin) {
        await api(`${base}/allocations/${allocation.id}/approve`, { method: 'POST' });
        setNote('Split approved. Remember to move the money in your bank or savings app.');
      } else {
        setNote('Sent for approval. An admin will review it.');
      }
      setLines(null);
      setTimeout(onDone, 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="entry" aria-label="Split this income">
      <h2>Split this income</h2>
      <p className="hint">{money(income.amount)} came in. Give it a job.</p>
      {!lines && !error && !note && <Loading />}
      {note && <p role="status">{note}</p>}
      {error && <ErrorNote message={error} />}
      {lines && lines.length === 0 && (
        <p className="hint">No split rules are set up yet. <Link to="/split-rules">Add split rules</Link>, or skip for now.</p>
      )}
      {lines && lines.length > 0 && (
        <>
          {lines.map((l, i) => (
            <label key={l.pocketId}>
              {l.name} (₦)
              <input type="number" inputMode="decimal" min="0" step="0.01" value={l.amount}
                onChange={(e) => edit(i, e.target.value)} />
            </label>
          ))}
          <p className={left < 0 ? 'field-error' : 'hint'} role={left < 0 ? 'alert' : undefined}>
            {left < 0 ? `This is ${money(-left)} more than came in.` : `${money(left)} stays in Ready to assign.`}
          </p>
          <button type="button" className="btn" disabled={busy || left < 0 || total <= 0} onClick={submit}>
            {busy ? 'Saving…' : isAdmin ? 'Approve split' : 'Send for approval'}
          </button>{' '}
        </>
      )}
      {!note && <button type="button" className="btn-quiet" onClick={onDone}>Skip for now</button>}
    </section>
  );
}
