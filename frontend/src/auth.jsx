import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, households: [], household: null, loading: true });

  const pick = (households) => {
    let saved = null;
    try {
      saved = localStorage.getItem('householdId');
    } catch {
      /* storage unavailable */
    }
    return households.find((h) => h.id === saved) ?? households[0] ?? null;
  };

  const loadSession = async () => {
    try {
      const { user } = await api('/auth/me');
      const { households } = await api('/households');
      setState({ user, households, household: pick(households), loading: false });
    } catch {
      setState({ user: null, households: [], household: null, loading: false });
    }
  };

  const switchHousehold = (id) => {
    try {
      localStorage.setItem('householdId', id);
    } catch {
      /* storage unavailable */
    }
    setState((s) => ({ ...s, household: s.households.find((h) => h.id === id) ?? s.household }));
  };

  useEffect(() => {
    loadSession();
  }, []);

  const login = async (email, password) => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    await loadSession();
  };

  const register = async (fields) => {
    await api('/auth/register', { method: 'POST', body: fields });
    await loadSession();
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setState({ user: null, households: [], household: null, loading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, switchHousehold }}>{children}</AuthContext.Provider>
  );
}
