import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button } from '../components/AdminLayout';
import { ConfirmModal } from '../components/Modal';

export default function AdminReviews({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/reviews')
      .then((data) => setReviews(data.reviews))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (review) => {
    const next = review.status === 'published' ? 'hidden' : 'published';
    try {
      await adminFetch(`/reviews/${encodeURIComponent(review.id)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      toast('Review updated.');
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const remove = async () => {
    try {
      await adminFetch(`/reviews/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      toast('Review deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  return (
    <AdminLayout section="reviews" onNavigate={onNavigate} title="Reviews" subtitle={`${reviews.length} review(s)`}>
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Comment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40">No reviews yet.</td></tr>
              )}
              {reviews.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] align-top">
                  <td className="px-4 py-3 font-mono text-white/40 whitespace-nowrap">{r.productId}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.author}<div className="text-white/40 text-xs">{r.email}</div></td>
                  <td className="px-4 py-3 whitespace-nowrap">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</td>
                  <td className="px-4 py-3 max-w-md">{r.body}</td>
                  <td className="px-4 py-3"><Badge tone={r.status === 'published' ? 'success' : 'neutral'}>{r.status}</Badge></td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <Button variant="secondary" onClick={() => toggle(r)}>{r.status === 'published' ? 'Hide' : 'Publish'}</Button>
                    <Button variant="danger" onClick={() => setDeleteTarget(r)}>Delete</Button>
                  </td>
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
        title="Delete review"
        message="Delete this review permanently?"
      />
    </AdminLayout>
  );
}
