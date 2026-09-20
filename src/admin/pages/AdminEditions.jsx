import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button } from '../components/AdminLayout';
import { ConfirmModal } from '../components/Modal';

export default function AdminEditions({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [editions, setEditions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [releaseTarget, setReleaseTarget] = useState(null); // { productId, number }

  const load = () => {
    setLoading(true);
    adminFetch('/editions')
      .then((data) => setEditions(data.editions))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const release = async () => {
    const { productId, number } = releaseTarget;
    try {
      await adminFetch(`/editions/${encodeURIComponent(productId)}/${encodeURIComponent(number)}`, { method: 'DELETE' });
      toast('Edition number released.');
      setReleaseTarget(null);
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  return (
    <AdminLayout section="editions" onNavigate={onNavigate} title="Limited Editions" subtitle="Numbered pieces sold, by product">
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : editions.length === 0 ? (
        <div className="border border-white/8 px-4 py-10 text-center text-white/40">No limited-edition numbers have been sold yet.</div>
      ) : (
        <div className="space-y-4">
          {editions.map((group) => (
            <div key={group.productId} className="border border-white/8">
              <div className="px-5 py-3 border-b border-white/8 flex justify-between text-sm">
                <span>{group.productName || group.productId} <span className="font-mono text-white/40">({group.productId})</span></span>
                <span className="text-white/40">{group.sold.length} / {group.total || '—'} sold</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                    <th className="px-5 py-2">Number</th><th className="px-5 py-2">Order</th><th className="px-5 py-2">Sold at</th><th className="px-5 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {group.sold.map((s) => (
                    <tr key={s.number} className="border-t border-white/5">
                      <td className="px-5 py-2 font-mono">#{String(s.number).padStart(3, '0')}</td>
                      <td className="px-5 py-2 font-mono text-white/40">{s.orderId || '—'}</td>
                      <td className="px-5 py-2 text-white/60">{new Date(s.soldAt).toLocaleString()}</td>
                      <td className="px-5 py-2 text-right"><Button variant="secondary" onClick={() => setReleaseTarget({ productId: group.productId, number: s.number })}>Release</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(releaseTarget)}
        onClose={() => setReleaseTarget(null)}
        onConfirm={release}
        title="Release edition number"
        message={releaseTarget ? `Release edition #${String(releaseTarget.number).padStart(3, '0')} for ${releaseTarget.productId}? It will become available for purchase again.` : ''}
        confirmLabel="Release"
      />
    </AdminLayout>
  );
}
