import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge } from '../components/AdminLayout';
import { getCountryName } from '../../data/countries';

export default function AdminCustomers({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch('/customers')
      .then((data) => setCustomers(data.customers))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminLayout section="customers" onNavigate={onNavigate} title="Customers" subtitle={`${customers.length} registered account(s)`}>
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Orders</th>
                <th className="px-4 py-3">Registered</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-white/40">No registered customers yet.</td></tr>
              )}
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-white/60">{c.email}</td>
                  <td className="px-4 py-3 text-white/60">{c.country ? getCountryName(c.country) : '—'}</td>
                  <td className="px-4 py-3 text-white/60">{c.phone || '—'}</td>
                  <td className="px-4 py-3"><Badge tone={c.emailVerified ? 'success' : 'warn'}>{c.emailVerified ? 'Verified' : 'Unverified'}</Badge></td>
                  <td className="px-4 py-3 font-mono">{c.orderCount}</td>
                  <td className="px-4 py-3 text-white/40 font-mono text-xs">{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
