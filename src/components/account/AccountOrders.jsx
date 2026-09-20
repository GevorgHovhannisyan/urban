import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ListRowsSkeleton } from '../Skeleton';
import Icon from '../Icon';
import { getCountryName } from '../../data/countries';

const STATUS_LABELS = {
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const RETURN_ELIGIBLE_STATUSES = new Set(['confirmed', 'processing', 'shipped', 'delivered']);
const RETURN_WINDOW_DAYS = 30;

export default function AccountOrders({ onNavigate }) {
  const { accountFetch, formatMoney, navigate, user } = useApp();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [returnRequests, setReturnRequests] = useState([]);
  const [returnFormOrder, setReturnFormOrder] = useState(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnStatus, setReturnStatus] = useState('');

  useEffect(() => {
    accountFetch('/returns').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setReturnRequests(d.returnRequests || []);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const returnForOrder = (orderNumber) => returnRequests.find((r) => r.orderNumber === orderNumber && r.status !== 'rejected');

  const submitReturn = async (order) => {
    setReturnStatus('submitting');
    try {
      const res = await accountFetch('/returns', {
        method: 'POST',
        body: JSON.stringify({ orderNumber: order.orderNumber, reason: returnReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit return request.');
      setReturnRequests((prev) => [data.returnRequest, ...prev]);
      setReturnFormOrder(null);
      setReturnReason('');
      setReturnStatus('');
    } catch (err) {
      setReturnStatus(err.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Reuse the existing token-secured order-history endpoint.
    fetch('/api/orders/mine', { headers: { Authorization: `Bearer ${user?.sessionToken}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setOrders(Array.isArray(d.orders) ? d.orders : []); })
      .catch(() => { if (!cancelled) setError('Could not load your orders right now.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <ListRowsSkeleton rows={3} />;
  if (error) return <p className="text-muted text-sm">{error}</p>;

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet."
        body="Your Urban Phoenix orders will appear here."
        cta="Shop Collection"
        onCta={() => navigate('shop')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-display font-black uppercase mb-2">My Orders</h2>
      <div className="divide-y divide-border border-t border-b border-border">
        {orders.map((order) => {
          const isOpen = expanded === order.id;
          return (
            <div key={order.id} className="py-6">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <p className="font-mono text-sm mb-1">ORDER #{order.orderNumber}</p>
                  <p className="text-[11px] font-mono text-muted uppercase tracking-widest">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs uppercase tracking-widest border border-border px-3 py-1.5">
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                  <span className="font-mono text-sm">{formatMoney(order.total, { regional: false })}</span>
                </div>
              </div>

              <div className="space-y-3">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-4">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-14 h-[72px] up-photo object-cover bg-card shrink-0" />
                    ) : (
                      <div className="w-14 h-[72px] bg-card shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted font-mono uppercase">{item.color} / {item.size} · Qty {item.quantity}</p>
                      {item.editionNumbers?.length > 0 && (
                        <p className="text-xs font-mono text-accent uppercase">
                          Piece {item.editionNumbers.map((n) => `${String(n).padStart(3, '0')}/${String(item.editionTotal || 100).padStart(3, '0')}`).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-5 mt-4">
                <button
                  onClick={() => setExpanded(isOpen ? null : order.id)}
                  className="text-[11px] font-mono uppercase tracking-widest underline text-muted hover:text-fg"
                >
                  {isOpen ? 'Hide details' : 'View order'}
                </button>
                {(() => {
                  const existingReturn = returnForOrder(order.orderNumber);
                  const daysSince = (Date.now() - new Date(order.createdAt).getTime()) / 86400000;
                  const eligible = RETURN_ELIGIBLE_STATUSES.has(order.status) && daysSince <= RETURN_WINDOW_DAYS;
                  if (existingReturn) {
                    return <span className="text-[11px] font-mono uppercase tracking-widest text-accent">Return: {existingReturn.status}</span>;
                  }
                  if (eligible) {
                    return (
                      <button
                        onClick={() => { setReturnFormOrder(order); setReturnReason(''); setReturnStatus(''); }}
                        className="text-[11px] font-mono uppercase tracking-widest underline text-muted hover:text-fg"
                      >
                        Request return
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>

              {returnFormOrder?.id === order.id && (
                <div className="mt-4 border border-border p-5 space-y-3">
                  <p className="text-[11px] font-mono text-muted uppercase tracking-widest">Request a return for #{order.orderNumber}</p>
                  <textarea
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="Reason for return (optional)"
                    rows={3}
                    className="up-input w-full"
                  />
                  {returnStatus && returnStatus !== 'submitting' && (
                    <p className="status-error text-xs">{returnStatus}</p>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={() => submitReturn(order)}
                      disabled={returnStatus === 'submitting'}
                      className="btn-primary px-6 py-2.5 text-[11px] font-mono uppercase tracking-widest disabled:opacity-50"
                    >
                      {returnStatus === 'submitting' ? 'Submitting…' : 'Submit request'}
                    </button>
                    <button
                      onClick={() => setReturnFormOrder(null)}
                      className="text-[11px] font-mono uppercase tracking-widest text-muted hover:text-fg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {isOpen && (
                <div className="mt-4 border border-border p-5 text-sm space-y-4">
                  <div>
                    <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1 flex items-center gap-1.5"><Icon name="truck" size={12} />Shipping to</p>
                    <p className="leading-relaxed">
                      {order.customer.firstName} {order.customer.lastName}<br />
                      {order.customer.address}<br />
                      {order.customer.city}, {order.customer.postalCode}<br />
                      {getCountryName(order.customer.country)}
                    </p>
                    {/* The real estimate this order was promised at checkout
                        (snapshotted, not re-derived) — absent only for an
                        order placed before delivery estimates existed. */}
                    {order.deliveryEstimate && (
                      <p className="text-accent mt-1">{order.deliveryEstimate}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1 flex items-center gap-1.5"><Icon name="wallet" size={12} />Payment</p>
                    <p>{order.paymentMethod.toUpperCase()} · {order.paymentStatus.replace(/_/g, ' ')}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs font-mono text-muted max-w-[240px]">
                    <span>Subtotal</span><span className="text-right">{formatMoney(order.subtotal, { regional: false })}</span>
                    {order.discountAmount > 0 && (<><span>Discount</span><span className="text-right">−{formatMoney(order.discountAmount, { regional: false })}</span></>)}
                    {order.giftCardAmount > 0 && (<><span>Gift card</span><span className="text-right">−{formatMoney(order.giftCardAmount, { regional: false })}</span></>)}
                    {order.loyaltyDiscount > 0 && (<><span>Rewards points</span><span className="text-right">−{formatMoney(order.loyaltyDiscount, { regional: false })}</span></>)}
                    <span>Shipping</span><span className="text-right">{formatMoney(order.shipping, { regional: false })}</span>
                    <span className="text-fg">Total</span><span className="text-right text-fg">{formatMoney(order.total, { regional: false })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, cta, onCta }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-20 border border-border">
      <p className="font-display font-black uppercase text-2xl">{title}</p>
      <p className="text-sm text-muted max-w-xs">{body}</p>
      {cta && (
        <button onClick={onCta} className="mt-2 btn-primary px-8 py-3 text-[11px] font-mono uppercase tracking-widest">
          {cta}
        </button>
      )}
    </div>
  );
}
