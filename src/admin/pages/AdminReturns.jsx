import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button } from '../components/AdminLayout';
import Modal from '../components/Modal';

const STATUS_TONE = { requested: 'warn', approved: 'success', rejected: 'neutral', refunded: 'success' };

export default function AdminReturns({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/returns')
      .then((data) => setReturns(data.returnRequests))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (id, status) => {
    try {
      await adminFetch(`/returns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast('Return request updated.');
      setReturns((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      setDetail((prev) => (prev?.id === id ? { ...prev, status } : prev));
    } catch (err) {
      toast(err.message, true);
    }
  };

  return (
    <AdminLayout section="returns" onNavigate={onNavigate} title="Returns" subtitle={`${returns.length} request(s)`}>
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {returns.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40">No return requests yet.</td></tr>
              )}
              {returns.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono">{r.orderNumber}</td>
                  <td className="px-4 py-3 text-white/70">{r.customerEmail}</td>
                  <td className="px-4 py-3 text-white/60">{r.items.length} item(s)</td>
                  <td className="px-4 py-3 text-white/60">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" onClick={() => setDetail(r)}>Review</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Return — Order ${detail.orderNumber}` : ''}
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/45 mb-1">Customer</p>
              <p className="text-sm">{detail.customerEmail}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/45 mb-1">Items</p>
              <ul className="text-sm space-y-1">
                {detail.items.map((item, i) => (
                  <li key={i} className="text-white/80">{item.name} — {item.size} / {item.color} × {item.quantity}</li>
                ))}
              </ul>
            </div>
            {detail.reason && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/45 mb-1">Reason</p>
                <p className="text-sm text-white/80">{detail.reason}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/45 mb-2">Update status</p>
              <div className="flex flex-wrap gap-2">
                {['requested', 'approved', 'rejected', 'refunded'].map((s) => (
                  <Button key={s} variant={detail.status === s ? 'primary' : 'secondary'} onClick={() => setStatus(detail.id, s)}>
                    {s}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-white/40 mt-2 leading-relaxed">
                Marking a request "refunded" only updates this label — it does not automatically restore
                inventory, reverse loyalty points, or issue a payment refund. Handle the actual product,
                loyalty, and payment-provider refund separately.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
