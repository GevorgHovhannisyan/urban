import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { getCountryName } from '../data/countries';

const STATUS_LABELS = {
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_STEPS = ['confirmed', 'processing', 'shipped', 'delivered'];

export default function TrackOrderPage() {
  const { formatMoney } = useApp();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submittedNumber, setSubmittedNumber] = useState('');
  const [prefillOrder] = useState(() => new URLSearchParams(window.location.search).get('order')?.trim().toUpperCase() || '');

  const lookupOrder = async (orderNumber) => {
    if (!orderNumber) return;
    setLoading(true);
    setError('');
    setOrder(null);
    setSubmittedNumber(orderNumber);
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(orderNumber)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'We could not find an order with that number.');
        return;
      }
      setOrder(data.order);
    } catch {
      setError('Something went wrong while looking up your order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // The order confirmation email's "View / Track Order" button links here
  // with ?order=UP-2026-XXXXXXXX — auto-run the same lookup the form does so
  // that link actually shows the order instead of landing on a blank form.
  useEffect(() => {
    if (prefillOrder) lookupOrder(prefillOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const orderNumber = new FormData(e.currentTarget).get('order').trim().toUpperCase();
    lookupOrder(orderNumber);
  };

  const stepIndex = order ? STATUS_STEPS.indexOf(order.status) : -1;

  return (
    <main className="pt-[var(--site-header-h,68px)] min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-20">
        <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-4">Order Status</p>
        <h1 className="font-display font-black text-5xl uppercase mb-5">Track Your Order</h1>
        <p className="text-muted mb-10">
          Enter the order number from your confirmation email — it looks like <strong className="text-fg">UP-2026-XXXXXXXX</strong>.
        </p>

        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
          <input name="order" required placeholder="Order number" defaultValue={prefillOrder} className="up-input flex-1" />
          <button disabled={loading} className="btn-primary px-8 uppercase text-xs tracking-widest py-3.5 sm:py-0 disabled:opacity-60">
            {loading ? 'Searching…' : 'Track'}
          </button>
        </form>

        {error && (
          <div className="mt-10 border border-border p-7">
            <p>{error}</p>
          </div>
        )}

        {order && (
          <div className="mt-10 border border-border p-7">
            <p className="text-xs text-muted uppercase tracking-widest">Order #{order.orderNumber}</p>
            <h2 className="text-2xl font-display font-bold uppercase mt-3">
              {STATUS_LABELS[order.status] || order.status}
            </h2>
            <p className="text-muted mt-3">
              Placed on {new Date(order.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            {order.status !== 'cancelled' && stepIndex >= 0 && (
              <div className="flex items-center gap-2 mt-8">
                {STATUS_STEPS.map((step, i) => (
                  <div key={step} className="flex items-center flex-1 last:flex-none">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${i <= stepIndex ? 'bg-accent' : 'bg-border'}`} />
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`h-px flex-1 mx-1.5 ${i < stepIndex ? 'bg-accent' : 'bg-border'}`} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 space-y-3 divide-y divide-border">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center gap-4 pt-3 first:pt-0">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-14 h-[72px] up-photo object-cover bg-card shrink-0" />
                  ) : (
                    <div className="w-14 h-[72px] bg-card shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted font-mono uppercase">{item.color} / {item.size} · Qty {item.quantity}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1">Shipping to</p>
              <p className="leading-relaxed text-sm">
                {order.customer.firstName} {order.customer.lastName}<br />
                {order.customer.address}<br />
                {order.customer.city}, {order.customer.postalCode}<br />
                {getCountryName(order.customer.country)}
              </p>
            </div>

            <div className="mt-6 pt-6 border-t border-border flex justify-between text-sm">
              <span className="text-muted">Total</span>
              <span className="font-mono">{formatMoney(order.total, { regional: false })}</span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
