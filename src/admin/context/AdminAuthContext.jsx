import { createContext, useContext, useState } from 'react';

const AdminAuthContext = createContext(null);

const read = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };

export function AdminAuthProvider({ children }) {
  const [token, setToken] = useState(() => read('up_admin_token'));
  const [email, setEmail] = useState(() => read('up_admin_email'));

  const login = async (loginEmail, password) => {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign in failed.');
    localStorage.setItem('up_admin_token', data.token);
    localStorage.setItem('up_admin_email', data.email);
    setToken(data.token);
    setEmail(data.email);
  };

  const logout = () => {
    localStorage.removeItem('up_admin_token');
    localStorage.removeItem('up_admin_email');
    setToken('');
    setEmail('');
  };

  // Every admin API call goes through here — attaches the bearer token and
  // auto-logs-out on a 401 (expired/invalid session) so a stale token never
  // just sits there silently failing every request.
  const adminFetch = async (path, options = {}) => {
    const res = await fetch(`/api/admin${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      logout();
      throw new Error('Your session has expired. Please sign in again.');
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  };

  return (
    <AdminAuthContext.Provider value={{ token, email, isAuthenticated: Boolean(token), login, logout, adminFetch }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const value = useContext(AdminAuthContext);
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return value;
}
