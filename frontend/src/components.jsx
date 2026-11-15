import { useId, useState } from 'react';
import { monthName } from './format.js';

// Password input with a Show/Hide toggle.
export function PasswordField({ label, value, onChange, autoComplete, minLength, hint }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="pw">
        <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} required
          minLength={minLength} value={value} onChange={onChange} />
        <button type="button" className="btn-quiet pw-toggle" aria-pressed={show}
          aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export const Loading = ({ label = 'Loading…' }) => (
  <p className="status" role="status">
    {label}
  </p>
);

export const ErrorNote = ({ message, onRetry }) => (
  <div className="status error" role="alert">
    <p>{message}</p>
    {onRetry && (
      <button type="button" className="btn-quiet" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

export const Empty = ({ children }) => <p className="status empty">{children}</p>;

export function MonthNav({ period, onChange }) {
  const shift = (delta) => {
    const d = new Date(period.year, period.month - 1 + delta, 1);
    onChange({ month: d.getMonth() + 1, year: d.getFullYear() });
  };
  return (
    <div className="month-nav">
      <button type="button" className="btn-quiet" onClick={() => shift(-1)} aria-label="Previous month">
        ‹
      </button>
      <span aria-live="polite">{monthName(period.month, period.year)}</span>
      <button type="button" className="btn-quiet" onClick={() => shift(1)} aria-label="Next month">
        ›
      </button>
    </div>
  );
}
