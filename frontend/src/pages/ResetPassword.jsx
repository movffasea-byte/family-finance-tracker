import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { PasswordField } from '../components.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className="auth">
        <h1>Link not valid</h1>
        <p>This reset link is missing its code. <Link to="/forgot-password">Request a new link</Link>.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth">
        <h1>Password updated</h1>
        <p role="status">You can now log in with your new password.</p>
        <p className="auth-alt"><Link to="/login">Log in</Link></p>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <h1>Choose a new password</h1>
      <form onSubmit={submit}>
        <PasswordField label="New password" autoComplete="new-password" minLength={8} value={password}
          onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters." />
        {error && (
          <p className="field-error" role="alert">
            {error} <Link to="/forgot-password">Request a new link</Link>
          </p>
        )}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}
