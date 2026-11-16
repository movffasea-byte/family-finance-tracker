import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Empty, ErrorNote, Loading } from '../components.jsx';
import { useLoad } from '../hooks.js';
import { money } from '../format.js';

const when = (iso) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

export default function PocketDetail() {
  const { id } = useParams();
  const { household } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => api(`/households/${household.id}/pockets/${id}/activity?limit=100`),
    [household.id, id],
  );

  return (
    <>
      <p><Link to="/pockets">‹ All pockets</Link></p>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && (
        <>
          <h1>{data.pocket.name}</h1>
          <p className="row-main">
            <span>Balance</span>
            <span className={data.pocket.balance < 0 ? 'neg' : ''}>{money(data.pocket.balance)}</span>
          </p>
          <h2>Activity</h2>
          {data.activity.length === 0 ? (
            <Empty>Nothing has moved in or out of this pocket yet.</Empty>
          ) : (
            <ul className="rows">
              {data.activity.map((a) => (
                <li key={`${a.source}-${a.id}`} className="row row-main">
                  <span>
                    {a.source === 'expense'
                      ? a.note || 'Expense'
                      : a.amount > 0
                        ? `From ${a.otherPocket}`
                        : `To ${a.otherPocket}`}
                    <span className="sub">
                      {when(a.createdAt)}
                      {a.source === 'move' && a.note ? ` · ${a.note}` : ''}
                    </span>
                  </span>
                  <span className={a.amount < 0 ? 'neg' : 'pos'}>
                    {a.amount < 0 ? '−' : '+'}{money(Math.abs(a.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
