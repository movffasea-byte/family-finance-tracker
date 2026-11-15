import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="auth">
        <h1>Check your email</h1>
        <p role="status">
          If an account exists for {email}, we've sent a link to choose a new password. It works once and
          expires in 30 minutes.
        </p>
        <p className="auth-alt"><Link to="/login">Back to log in</Link></p>
      </div>
    );
  }

  return (
    <div className="auth">
      <h1>Forgot your password?</h1>
      <p className="auth-alt">Enter your email and we'll send you a link to choose a new one.</p>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <p className="auth-alt"><Link to="/login">Back to log in</Link></p>
    </div>
  );
}
