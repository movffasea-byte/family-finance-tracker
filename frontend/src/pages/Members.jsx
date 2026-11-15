import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';

export default function Members() {
  const { household, user } = useAuth();
  const base = `/households/${household.id}/members`;
  const isAdmin = household.role === 'admin';
  const { data, error, loading, reload } = useLoad(() => api(base), [household.id]);
  const [form, setForm] = useState({ email: '', role: 'member' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api(base, { method: 'POST', body: form });
      setForm({ email: '', role: 'member' });
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name} from ${household.name}?`)) return;
    setFormError('');
    try {
      await api(`${base}/${m.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setFormError(err.message);
    }
  };

  return (
    <>
      <h1>Members</h1>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {formError && <p className="field-error" role="alert">{formError}</p>}
      {data && (
        <ul className="rows">
          {data.members.map((m) => (
            <li key={m.id} className="row tx">
              <div className="row-main">
                <span>
                  {m.name}{m.id === user.id ? ' (you)' : ''}
                  <span className="sub">{m.email}</span>
                </span>
                <span>{m.role === 'admin' ? 'Admin' : 'Member'}</span>
              </div>
              {isAdmin && m.id !== user.id && (
                <button type="button" className="btn-quiet" onClick={() => remove(m)}
                  aria-label={`Remove ${m.name}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin ? (
        <form className="entry" onSubmit={add}>
          <h2>Add a member</h2>
          <label>
            Their email
            <input type="email" required value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <span className="hint">They need to register first, then you add them here.</span>
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</button>
        </form>
      ) : (
        <p className="status">Only admins can add or remove members.</p>
      )}
    </>
  );
}
