import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button } from '../components/AdminLayout';
import { ConfirmModal } from '../components/Modal';

const pad = (n) => String(n).padStart(3, '0');
const REFRESH_MS = 15000;

// Limited Edition Serial Number Management — every serial of every
// limited-edition product, managed individually and per product. "Sold Out"
// covers both numbers claimed by a real order and numbers an admin marked
// sold out by hand (server/edition-api.mjs's setEditionSerialStatus); the
// product page and checkout read the same data, so changes here apply to the
// storefront immediately.
export default function AdminEditions({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [productId, setProductId] = useState('');
  const [data, setData] = useState(null); // { productName, total, serials }
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { numbers, status }
  const lastClicked = useRef(null);

  const loadProducts = () =>
    adminFetch('/edition-serials')
      .then((d) => {
        setProducts(d.products);
        setProductId((current) => (current && d.products.some((p) => p.productId === current) ? current : d.products[0]?.productId || ''));
      })
      .catch((err) => toast(err.message, true));

  const loadSerials = (id = productId) => {
    if (!id) return Promise.resolve();
    return adminFetch(`/edition-serials/${encodeURIComponent(id)}`)
      .then((d) => setData(d))
      .catch((err) => toast(err.message, true));
  };

  useEffect(() => { loadProducts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setData(null);
    setSelected(new Set());
    lastClicked.current = null;
    loadSerials(productId);
    // Picks up numbers sold through new orders while this page stays open.
    const timer = setInterval(() => { loadSerials(productId); loadProducts(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const serials = data?.serials || [];
  const byNumber = useMemo(() => new Map(serials.map((s) => [s.number, s])), [serials]);
  const availableCount = serials.filter((s) => s.status === 'available').length;
  const soldCount = serials.length - availableCount;
  const visible = serials.filter((s) => filter === 'all' || s.status === filter);
  const selectedList = [...selected].sort((a, b) => a - b);
  const single = selectedList.length === 1 ? byNumber.get(selectedList[0]) : null;

  // Click toggles one number; Shift+click selects the whole range since the
  // last click — quick for runs like 050–100.
  const toggle = (number, event) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (event?.shiftKey && lastClicked.current != null) {
        const [from, to] = [Math.min(lastClicked.current, number), Math.max(lastClicked.current, number)];
        for (let n = from; n <= to; n += 1) if (byNumber.has(n)) next.add(n);
      } else if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
    lastClicked.current = number;
  };

  const apply = async (numbers, status) => {
    setSaving(true);
    try {
      const d = await adminFetch(`/edition-serials/${encodeURIComponent(productId)}`, {
        method: 'PUT',
        body: JSON.stringify({ numbers, status }),
      });
      setData(d);
      setSelected(new Set());
      setConfirm(null);
      loadProducts();
      toast(`${numbers.length === 1 ? `#${pad(numbers[0])}` : `${numbers.length} serial numbers`} ${status === 'available' ? 'now available' : 'marked sold out'}.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const requestStatus = (status) => {
    const numbers = selectedList;
    if (!numbers.length) return;
    // Reactivating a number a real customer bought means someone else could
    // buy the same serial — always confirm that explicitly.
    const fromOrders = status === 'available' && numbers.some((n) => byNumber.get(n)?.source === 'order');
    if (fromOrders) setConfirm({ numbers, status });
    else apply(numbers, status);
  };

  const orderLinked = confirm ? confirm.numbers.filter((n) => byNumber.get(n)?.source === 'order') : [];

  return (
    <AdminLayout section="editions" onNavigate={onNavigate} title="Limited Edition Serials" subtitle="Manage each serial number's availability, per product">
      {products === null ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : products.length === 0 ? (
        <div className="border border-white/8 px-4 py-10 text-center text-white/40">
          No limited-edition products yet. Turn on “Limited edition” for a product in Products to manage its serial numbers here.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Product picker — serials are managed separately per design */}
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <button
                key={p.productId}
                type="button"
                onClick={() => setProductId(p.productId)}
                className={`text-left border px-4 py-3 transition-colors ${p.productId === productId ? 'border-[#C65D1E] bg-[#C65D1E]/10' : 'border-white/10 hover:border-white/25'}`}
              >
                <span className="block text-sm text-white/85">{p.productName}</span>
                <span className="block text-[11px] font-mono text-white/40 mt-0.5">{p.available} / {p.total} available</span>
              </button>
            ))}
          </div>

          {!data ? (
            <p className="text-white/40 text-sm">Loading serial numbers…</p>
          ) : (
            <div className="border border-white/8">
              {/* Summary + filter */}
              <div className="px-5 py-4 border-b border-white/8 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-5 text-sm">
                  <span className="flex items-center gap-2"><i className="w-2.5 h-2.5 inline-block bg-emerald-400/80" /> Available <strong className="font-mono">{availableCount}</strong></span>
                  <span className="flex items-center gap-2"><i className="w-2.5 h-2.5 inline-block bg-[#e5484d]/80" /> Sold Out <strong className="font-mono">{soldCount}</strong></span>
                  <span className="text-white/35">of {data.total}</span>
                </div>
                <div className="flex border border-white/10">
                  {[['all', 'All'], ['available', 'Available'], ['sold_out', 'Sold Out']].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={`text-[11px] font-mono uppercase tracking-widest px-3 py-2 transition-colors ${filter === id ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action bar */}
              <div className="px-5 py-3 border-b border-white/8 flex flex-wrap items-center gap-3 bg-white/[0.02]">
                <span className="text-sm text-white/60 mr-auto">
                  {selectedList.length
                    ? `${selectedList.length} selected`
                    : 'Click a number to select it · Shift+click to select a range'}
                </span>
                <Button variant="secondary" onClick={() => setSelected(new Set(visible.map((s) => s.number)))} disabled={!visible.length}>Select all shown</Button>
                {selectedList.length > 0 && <Button variant="secondary" onClick={() => setSelected(new Set())}>Clear</Button>}
                <Button variant="primary" onClick={() => requestStatus('available')} disabled={saving || !selectedList.length}>Make Available</Button>
                <Button variant="danger" onClick={() => requestStatus('sold_out')} disabled={saving || !selectedList.length}>Mark Sold Out</Button>
              </div>

              {/* Single-number details */}
              {single && (
                <div className="px-5 py-3 border-b border-white/8 text-sm flex flex-wrap gap-x-6 gap-y-1">
                  <span className="font-mono">#{pad(single.number)} / {pad(data.total)}</span>
                  <span className={single.status === 'available' ? 'text-emerald-400' : 'text-[#e5484d]'}>
                    {single.status === 'available' ? 'Available' : 'Sold Out'}
                  </span>
                  {single.source === 'order' && <span className="text-white/60">Sold in order <span className="font-mono">{single.orderNumber || single.orderId}</span></span>}
                  {single.source === 'manual' && <span className="text-white/60">Marked sold out by admin</span>}
                  {single.soldAt && <span className="text-white/40">{new Date(single.soldAt).toLocaleString()}</span>}
                </div>
              )}

              {/* Serial grid */}
              <div className="p-5 grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-10 gap-2">
                {visible.map((s) => {
                  const isSel = selected.has(s.number);
                  const available = s.status === 'available';
                  return (
                    <button
                      key={s.number}
                      type="button"
                      onClick={(e) => toggle(s.number, e)}
                      aria-pressed={isSel}
                      title={available ? 'Available' : s.source === 'order' ? `Sold — order ${s.orderNumber || s.orderId}` : 'Sold out (set by admin)'}
                      className={`relative py-3 font-mono text-sm border transition-colors ${
                        available
                          ? 'border-emerald-400/30 text-emerald-300 bg-emerald-400/[0.06] hover:border-emerald-400/60'
                          : 'border-[#e5484d]/30 text-[#e5484d]/80 bg-[#e5484d]/[0.06] hover:border-[#e5484d]/60'
                      } ${isSel ? 'ring-2 ring-[#C65D1E] ring-offset-1 ring-offset-black' : ''}`}
                    >
                      {pad(s.number)}
                      <span className="block text-[9px] uppercase tracking-wider mt-0.5 opacity-70">
                        {available ? 'Available' : s.source === 'order' ? 'Sold' : 'Sold Out'}
                      </span>
                    </button>
                  );
                })}
                {visible.length === 0 && <p className="col-span-full text-sm text-white/40 py-6 text-center">No serial numbers match this filter.</p>}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => apply(confirm.numbers, confirm.status)}
        title="Make sold serials available again?"
        message={confirm
          ? `${orderLinked.map((n) => `#${pad(n)}`).join(', ')} ${orderLinked.length === 1 ? 'was' : 'were'} bought in a real order. Making ${orderLinked.length === 1 ? 'it' : 'them'} available lets another customer buy the same serial number. Continue?`
          : ''}
        confirmLabel="Make Available"
      />
    </AdminLayout>
  );
}
