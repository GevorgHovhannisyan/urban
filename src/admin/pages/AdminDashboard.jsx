import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import AdminLayout, { StatCard, Button } from '../components/AdminLayout';

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function AdminDashboard({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adminFetch('/overview')
      .then((data) => { if (!cancelled) setOverview(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminLayout section="dashboard" onNavigate={onNavigate} title="Dashboard" subtitle="Store overview">
      {loading || !overview ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <StatCard label="Revenue" value={fmtMoney(overview.revenue)} accent />
            <StatCard label="Orders" value={overview.orderCount} />
            <StatCard label="Pending Orders" value={overview.pendingOrders} />
            <StatCard label="Active Products" value={overview.productCount} />
            <StatCard label="Published Reviews" value={overview.reviewCount} />
            <StatCard label="Customers" value={overview.customerCount} />
            <StatCard label="Newsletter Subscribers" value={overview.subscriberCount} />
          </div>

          <div className="border border-white/8">
            <div className="px-5 py-4 border-b border-white/8 text-sm font-medium">Quick links</div>
            <div className="p-5 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => onNavigate('products')}>Manage products</Button>
              <Button variant="secondary" onClick={() => onNavigate('orders')}>View orders</Button>
              <Button variant="secondary" onClick={() => onNavigate('reviews')}>Moderate reviews</Button>
              <Button variant="secondary" onClick={() => onNavigate('content')}>Edit site content</Button>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
