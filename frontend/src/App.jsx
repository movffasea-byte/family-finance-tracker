import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import { Loading } from './components.jsx';
import { useLoad } from './hooks.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SplitRules from './pages/SplitRules.jsx';
import Bills from './pages/Bills.jsx';
import Approvals from './pages/Approvals.jsx';
import Pockets from './pages/Pockets.jsx';
import PocketDetail from './pages/PocketDetail.jsx';
import Transactions from './pages/Transactions.jsx';
import Budgets from './pages/Budgets.jsx';
import Goals from './pages/Goals.jsx';
import Members from './pages/Members.jsx';

// Nav link to Approvals with a count of splits waiting. Refreshes when the page changes.
function ApprovalsLink({ householdId }) {
  const { pathname } = useLocation();
  const { data } = useLoad(
    () => (householdId ? api(`/households/${householdId}/allocations?status=proposed`) : Promise.resolve(null)),
    [householdId, pathname],
  );
  const n = data?.allocations.length ?? 0;
  return <NavLink to="/approvals">Approvals{n > 0 ? ` (${n})` : ''}</NavLink>;
}

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
        <NavLink to="/pockets">Pockets</NavLink>
        <NavLink to="/transactions">Transactions</NavLink>
        <ApprovalsLink householdId={household?.id} />
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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="pockets" element={<Pockets />} />
        <Route path="split-rules" element={<SplitRules />} />
        <Route path="bills" element={<Bills />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="pockets/:id" element={<PocketDetail />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="goals" element={<Goals />} />
        <Route path="members" element={<Members />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
