import { monthName } from './format.js';

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
