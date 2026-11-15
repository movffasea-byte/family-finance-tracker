import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Register() {
  const { user, register } = useAuth();
  const [form, setForm] = useState({ name: '', householdName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <h1>Create a household</h1>
      <form onSubmit={submit}>
        <label>
          Your name
          <input autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} />
        </label>
        <label>
          Household name
          <input required maxLength={100} placeholder="The Yang family" value={form.householdName}
            onChange={set('householdName')} />
        </label>
        <label>
          Email
          <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="new-password" required minLength={8} value={form.password}
            onChange={set('password')} />
          <span className="hint">At least 8 characters.</span>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create household'}</button>
      </form>
      <p className="auth-alt">Already have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
}
