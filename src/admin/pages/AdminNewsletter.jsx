import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button } from '../components/AdminLayout';
import { ConfirmModal } from '../components/Modal';

export default function AdminNewsletter({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/newsletter')
      .then((data) => setSubscribers(data.subscribers))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    try {
      await adminFetch(`/newsletter/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      toast('Subscriber removed.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const exportCsv = () => {
    const csv = ['email,subscribedAt', ...subscribers.map((s) => `${s.email},${s.subscribedAt}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'newsletter-subscribers.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout
      section="newsletter"
      onNavigate={onNavigate}
      title="Newsletter"
      subtitle={`${subscribers.length} subscriber(s)`}
      actions={<Button variant="secondary" onClick={exportCsv}>Export CSV</Button>}
    >
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Subscribed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {subscribers.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-white/40">No subscribers yet.</td></tr>
              )}
              {subscribers.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">{s.email}</td>
                  <td className="px-4 py-3 text-white/40 font-mono text-xs">{new Date(s.subscribedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right"><Button variant="danger" onClick={() => setDeleteTarget(s)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Remove subscriber"
        message={`Remove ${deleteTarget?.email} from the newsletter list?`}
      />
    </AdminLayout>
  );
}
