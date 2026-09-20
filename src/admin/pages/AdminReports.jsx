import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import AdminLayout, { StatCard } from '../components/AdminLayout';

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;

function BarRow({ label, value, max, formatValue = (v) => v }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-xs text-white/60 truncate">{label}</span>
      <div className="flex-1 h-6 bg-white/5 relative">
        <div className="h-full bg-[#C65D1E]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right text-xs font-mono text-white/80">{formatValue(value)}</span>
    </div>
  );
}

function RevenueChart({ series }) {
  const max = Math.max(1, ...series.map((s) => s.revenue));
  return (
    <div className="flex items-end gap-[2px] h-40 border-b border-white/10 pb-1">
      {series.map((point) => (
        <div
          key={point.date}
          className="flex-1 bg-[#C65D1E]/70 hover:bg-[#C65D1E] transition-colors"
          style={{ height: `${Math.max(2, (point.revenue / max) * 100)}%` }}
          title={`${point.date}: ${fmtMoney(point.revenue)} (${point.orders} order${point.orders === 1 ? '' : 's'})`}
        />
      ))}
    </div>
  );
}

export default function AdminReports({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const [summary, setSummary] = useState(null);
  const [revenue, setRevenue] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      adminFetch('/reports/summary'),
      adminFetch(`/reports/revenue?days=${days}`),
      adminFetch('/reports/top-products?limit=8'),
      adminFetch('/reports/sales-by-category'),
    ])
      .then(([s, r, p, c]) => {
        if (cancelled) return;
        setSummary(s);
        setRevenue(r.series);
        setTopProducts(p.products);
        setCategories(c.categories);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxProductRevenue = Math.max(1, ...topProducts.map((p) => p.revenue));
  const maxCategoryRevenue = Math.max(1, ...categories.map((c) => c.revenue));

  return (
    <AdminLayout section="reports" onNavigate={onNavigate} title="Reports" subtitle="Real sales analytics, computed from order history">
      {loading || !summary ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <StatCard label="Total Revenue" value={fmtMoney(summary.totalRevenue)} accent />
            <StatCard label="Total Orders" value={summary.totalOrders} />
            <StatCard label="Avg Order Value" value={fmtMoney(summary.averageOrderValue)} />
            <StatCard label="Revenue (30d)" value={fmtMoney(summary.revenueLast30Days)} />
          </div>

          <div className="border border-white/8 mb-8">
            <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
              <span className="text-sm font-medium">Revenue over time</span>
              <div className="flex gap-1">
                {[14, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest border ${days === d ? 'border-[#C65D1E] text-[#C65D1E]' : 'border-white/15 text-white/50'}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              {revenue.length === 0 ? (
                <p className="text-white/40 text-sm">No orders in this period yet.</p>
              ) : (
                <RevenueChart series={revenue} />
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="border border-white/8">
              <div className="px-5 py-4 border-b border-white/8 text-sm font-medium">Top products by revenue</div>
              <div className="p-5 space-y-3">
                {topProducts.length === 0 && <p className="text-white/40 text-sm">No sales yet.</p>}
                {topProducts.map((p) => (
                  <BarRow key={p.productId} label={p.name || p.productId} value={p.revenue} max={maxProductRevenue} formatValue={fmtMoney} />
                ))}
              </div>
            </div>

            <div className="border border-white/8">
              <div className="px-5 py-4 border-b border-white/8 text-sm font-medium">Sales by category</div>
              <div className="p-5 space-y-3">
                {categories.length === 0 && <p className="text-white/40 text-sm">No sales yet.</p>}
                {categories.map((c) => (
                  <BarRow key={c.category} label={c.category} value={c.revenue} max={maxCategoryRevenue} formatValue={fmtMoney} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
