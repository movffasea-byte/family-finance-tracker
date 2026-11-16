import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money } from '../format.js';

export default function SplitRules() {
  const { household } = useAuth();
  const isAdmin = household.role === 'admin';
  const base = `/households/${household.id}`;
  const rulesLoad = useLoad(() => api(`${base}/split-rules`), [household.id]);
  const pocketsLoad = useLoad(() => api(`${base}/pockets`), [household.id]);

  const [rules, setRules] = useState([]);
  const [sample, setSample] = useState('100000');
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (rulesLoad.data) setRules(rulesLoad.data.rules.map((r) => ({ pocketId: r.pocketId, method: r.method, value: String(r.value) })));
  }, [rulesLoad.data]);

  // The preview shows what the SAVED rules would do with the sample amount.
  useEffect(() => {
    const amount = Number(sample);
    if (!(amount >= 0)) return;
    let live = true;
    api(`${base}/allocations/preview`, { method: 'POST', body: { amount } })
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [base, sample, rulesLoad.data]);

  const usedIds = rules.map((r) => r.pocketId);
  const free = pocketsLoad.data?.pockets.filter((p) => !usedIds.includes(p.id)) ?? [];
  const nameOf = (id) => pocketsLoad.data?.pockets.find((p) => p.id === id)?.name ?? 'Archived pocket';
  const percentTotal = rules.filter((r) => r.method === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0);

  const update = (i, patch) => {
    setSaved(false);
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const move = (i, d) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSaved(false);
    setRules(next);
  };
  const add = () => {
    if (!free.length) return;
    setSaved(false);
    setRules([...rules, { pocketId: free[0].id, method: 'percent', value: '' }]);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api(`${base}/split-rules`, {
        method: 'PUT',
        body: { rules: rules.map((r) => ({ pocketId: r.pocketId, method: r.method, value: Number(r.value) })) },
      });
      setSaved(true);
      rulesLoad.reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p><Link to="/pockets">‹ All pockets</Link></p>
      <h1>Split rules</h1>
      <p className="hint">
        When income arrives, fixed amounts are taken first, in order. Percentages then share what is left.
      </p>
      {(rulesLoad.loading || pocketsLoad.loading) && <Loading />}
      {rulesLoad.error && <ErrorNote message={rulesLoad.error} onRetry={rulesLoad.reload} />}
      {pocketsLoad.error && <ErrorNote message={pocketsLoad.error} onRetry={pocketsLoad.reload} />}

      {rulesLoad.data && pocketsLoad.data && (
        <form onSubmit={save}>
          {rules.length === 0 ? (
            <Empty>
              No rules yet. {isAdmin ? 'Add a rule to start splitting income automatically.' : 'An admin can add them.'}
            </Empty>
          ) : (
            <ul className="rows">
              {rules.map((r, i) => (
                <li key={r.pocketId} className="row">
                  {isAdmin ? (
                    <div className="budget-form">
                      <label>
                        {i + 1}. {nameOf(r.pocketId)}
                        <select value={r.method} onChange={(e) => update(i, { method: e.target.value })}>
                          <option value="fixed">Fixed amount (₦)</option>
                          <option value="percent">Percent of the rest (%)</option>
                        </select>
                      </label>
                      <label>
                        {r.method === 'fixed' ? 'Amount (₦)' : 'Percent (%)'}
                        <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={r.value}
                          max={r.method === 'percent' ? 100 : undefined}
                          onChange={(e) => update(i, { value: e.target.value })} />
                      </label>
                      <button type="button" className="btn-quiet" disabled={i === 0} onClick={() => move(i, -1)}
                        aria-label={`Move ${nameOf(r.pocketId)} up`}>↑</button>
                      <button type="button" className="btn-quiet" disabled={i === rules.length - 1} onClick={() => move(i, 1)}
                        aria-label={`Move ${nameOf(r.pocketId)} down`}>↓</button>
                      <button type="button" className="btn-quiet"
                        onClick={() => { setSaved(false); setRules(rules.filter((_, j) => j !== i)); }}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="row-main">
                      <span>{i + 1}. {nameOf(r.pocketId)}</span>
                      <span>{r.method === 'fixed' ? money(Number(r.value)) : `${r.value}%`}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <>
              <p className={percentTotal > 100 ? 'field-error' : 'hint'} role={percentTotal > 100 ? 'alert' : undefined}>
                Percentages add up to {percentTotal}%{percentTotal > 100 ? '. They cannot be more than 100%.' : '.'}
              </p>
              {formError && <p className="field-error" role="alert">{formError}</p>}
              {saved && <p className="hint" role="status">Saved.</p>}
              <button type="button" className="btn-quiet" onClick={add} disabled={!free.length}>Add a rule</button>{' '}
              <button type="submit" className="btn" disabled={busy || percentTotal > 100}>
                {busy ? 'Saving…' : 'Save rules'}
              </button>
            </>
          )}
        </form>
      )}

      <h2>Preview</h2>
      <label>
        If this much comes in (₦)
        <input type="number" inputMode="decimal" min="0" step="0.01" value={sample}
          onChange={(e) => setSample(e.target.value)} />
      </label>
      {preview && (
        <ul className="rows">
          {preview.lines.map((l) => (
            <li key={l.pocketId} className="row row-main">
              <span>{l.pocketName}</span>
              <span>{money(l.amount)}</span>
            </li>
          ))}
          <li className="row row-main">
            <span>Stays in Ready to assign</span>
            <span>{money(preview.unassigned)}</span>
          </li>
        </ul>
      )}
      <p className="hint">The preview uses your saved rules.</p>
    </>
  );
}
