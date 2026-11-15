import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Loading } from './components.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Budgets from './pages/Budgets.jsx';
import Goals from './pages/Goals.jsx';
import Members from './pages/Members.jsx';

function Shell() {
  const { user, household, households, switchHousehold, loading, logout } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <p className="brand">Family Finance</p>
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/transactions">Transactions</NavLink>
        <NavLink to="/budgets">Budgets</NavLink>
        <NavLink to="/goals">Goals</NavLink>
        <NavLink to="/members">Members</NavLink>
      </nav>
      <main className="main">
        <header className="topbar">
          <div>
            {households.length > 1 ? (
              <select className="household-switch" aria-label="Household" value={household?.id ?? ''}
                onChange={(e) => switchHousehold(e.target.value)}>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            ) : (
              <p className="household">{household?.name ?? 'No household'}</p>
            )}
            <p className="who">{user.name}</p>
          </div>
          <button type="button" className="btn-quiet" onClick={logout}>
            Log out
          </button>
        </header>
        {household ? <Outlet /> : <p className="status">This account has no household yet.</p>}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="goals" element={<Goals />} />
        <Route path="members" element={<Members />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
