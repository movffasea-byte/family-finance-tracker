import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.email, form.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <h1>Log in</h1>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p className="auth-alt">New here? <Link to="/register">Create a household</Link></p>
    </div>
  );
}
