import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money } from '../format.js';

export default function Approvals() {
  const { household } = useAuth();
  const isAdmin = household.role === 'admin';
  const base = `/households/${household.id}`;
  const { data, error, loading, reload } = useLoad(() => api(`${base}/allocations?status=proposed`), [household.id]);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const decide = async (id, action) => {
    setBusyId(id);
    setActionError('');
    try {
      await api(`${base}/allocations/${id}/${action}`, { method: 'POST' });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusyId(null);
      reload();
    }
  };

  return (
    <>
      <h1>Approvals</h1>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {actionError && <p className="field-error" role="alert">{actionError}</p>}
      {data && data.allocations.length === 0 && <Empty>No splits are waiting for approval.</Empty>}
      {data && data.allocations.length > 0 && (
        <ul className="rows">
          {data.allocations.map((a) => (
            <li key={a.id} className="row">
              <div className="row-main">
                <span>
                  {a.incomeAmount != null ? `Split of ${money(a.incomeAmount)} income` : 'Split'}
                  <span className="sub">
                    Proposed by {a.createdByName}
                    {a.incomeDescription ? ` · ${a.incomeDescription}` : ''}
                  </span>
                </span>
                <span>{money(a.lines.reduce((s, l) => s + l.amount, 0))}</span>
              </div>
              <ul className="rows">
                {a.lines.map((l) => (
                  <li key={l.pocketId} className="row row-main">
                    <span>{l.pocketName}</span>
                    <span>{money(l.amount)}</span>
                  </li>
                ))}
              </ul>
              {isAdmin && (
                <div className="budget-form">
                  <button type="button" className="btn-small" disabled={busyId === a.id}
                    onClick={() => decide(a.id, 'approve')}>Approve</button>
                  <button type="button" className="btn-quiet" disabled={busyId === a.id}
                    onClick={() => decide(a.id, 'discard')}>Discard</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
