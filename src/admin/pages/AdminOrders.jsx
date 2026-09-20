import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Button, Select } from '../components/AdminLayout';
import Modal from '../components/Modal';
import { getCountryName } from '../../data/countries';

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;
const ORDER_STATUSES = ['payment_pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
// 'pay_on_delivery' intentionally excluded — cash on delivery was removed
// and the backend no longer accepts it as an assignable status (see
// server/order-api.mjs's updateOrderStatus). A historical order that
// already has this value keeps it; it just isn't offered as a new choice.
const PAYMENT_STATUSES = ['not_charged', 'paid', 'refunded'];
// Display-only labels — the <option value> stays the real backend value
// (server/order-api.mjs's updateOrderStatus) so saving a selection still
// sends the right thing; this just makes the dropdown/detail view read
// clearly instead of a literal "not charged".
const PAYMENT_STATUS_LABELS = { not_charged: 'Pending / Unpaid', paid: 'Paid', refunded: 'Refunded' };
const PAYMENT_METHOD_LABELS = {
  card: 'Card',
  cash_on_delivery: 'Cash on Delivery',
  paypal: 'PayPal',
  idram: 'Idram',
  telcell: 'Telcell',
};

export default function AdminOrders({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailOrder, setDetailOrder] = useState(null);
  // Tracks in-flight status updates per order so a failed request can revert
  // the <select> to its last-known-good value instead of showing a status
  // the server never actually applied.
  const [pendingValues, setPendingValues] = useState({});

  const load = () => {
    setLoading(true);
    adminFetch('/orders')
      .then((data) => setOrders(data.orders))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = async (order, field, value) => {
    const key = `${order.id}:${field}`;
    setPendingValues((prev) => ({ ...prev, [key]: value }));
    try {
      await adminFetch(`/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      toast(`${field === 'status' ? 'Order' : 'Payment'} status updated.`);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, [field]: value } : o)));
    } catch (err) {
      toast(err.message, true);
      setPendingValues((prev) => ({ ...prev, [key]: order[field] }));
    }
  };

  return (
    <AdminLayout section="orders" onNavigate={onNavigate} title="Orders" subtitle={`${orders.length} order(s)`}>
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Placed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-white/40">No orders yet.</td></tr>
              )}
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono">
                    {o.orderNumber}
                    {o.paymentEnv === 'sandbox' && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest border border-orange-400/50 text-orange-400 align-middle" title="Processed by the payment provider's sandbox/test environment — no real charge occurred.">
                        Sandbox
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {o.customer.firstName} {o.customer.lastName}
                    <div className="text-white/40 text-xs">{o.customer.email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(o.total)}</td>
                  <td className="px-4 py-3">
                    <Select value={pendingValues[`${o.id}:status`] ?? o.status} onChange={(e) => updateStatus(o, 'status', e.target.value)}>
                      {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-white/60">{PAYMENT_METHOD_LABELS[o.paymentMethod] || o.paymentMethod}</td>
                  <td className="px-4 py-3">
                    <Select value={pendingValues[`${o.id}:paymentStatus`] ?? o.paymentStatus} onChange={(e) => updateStatus(o, 'paymentStatus', e.target.value)}>
                      {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s] || s}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-white/40 font-mono text-xs">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" onClick={() => setDetailOrder(o)}>Details</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(detailOrder)} onClose={() => setDetailOrder(null)} title={`Order ${detailOrder?.orderNumber || ''}`}>
        {detailOrder && (
          <>
            {detailOrder.paymentEnv === 'sandbox' && (
              <div className="border border-orange-400/50 bg-orange-400/10 text-orange-400 text-xs font-mono uppercase tracking-widest px-3 py-2">
                Sandbox order — processed by the {detailOrder.paymentProvider || 'payment provider'}'s test environment, no real charge occurred
              </div>
            )}
            <div>
              <p className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">Shipping address</p>
              <p className="text-sm leading-relaxed">
                {detailOrder.customer.firstName} {detailOrder.customer.lastName}<br />
                {detailOrder.customer.address}{detailOrder.customer.apartment ? `, ${detailOrder.customer.apartment}` : ''}<br />
                {detailOrder.customer.city}{detailOrder.customer.postalCode ? `, ${detailOrder.customer.postalCode}` : ''}<br />
                {getCountryName(detailOrder.customer.country)}
              </p>
              {/* The real estimate quoted to this customer at checkout,
                  snapshotted onto the order (server/order-api.mjs) — not
                  re-derived, so fulfillment always sees exactly what was
                  promised even if delivery.mjs's stated estimates change
                  later. Absent only for an order placed before this existed. */}
              {detailOrder.deliveryEstimate && (
                <p className="text-sm text-amber-400 mt-2">{detailOrder.deliveryEstimate}</p>
              )}
              {detailOrder.customer.deliveryNotes && (
                <p className="text-sm text-white/60 mt-2">Delivery notes: {detailOrder.customer.deliveryNotes}</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">Contact</p>
              <p className="text-sm leading-relaxed">Email: {detailOrder.customer.email}<br />Phone: {detailOrder.customer.phone}</p>
            </div>
            <div>
              <p className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-2">Items</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/40 text-xs"><th className="pb-2">Product</th><th className="pb-2">Variant</th><th className="pb-2">Qty</th><th className="pb-2 text-right">Total</th></tr>
                </thead>
                <tbody>
                  {detailOrder.items.map((item, i) => (
                    <tr key={i} className="border-t border-white/8">
                      <td className="py-2">{item.name}</td>
                      <td className="py-2 text-white/60">
                        {item.color} / {item.size}
                        {item.editionNumbers?.length ? (
                          <span className="text-amber-400"> · Serial: {item.editionNumbers.map((n) => `${String(n).padStart(3, '0')}/${String(item.editionTotal || 100).padStart(3, '0')}`).join(', ')}</span>
                        ) : ''}
                      </td>
                      <td className="py-2 font-mono">{item.quantity}</td>
                      <td className="py-2 font-mono text-right">{fmtMoney(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-sm text-white/60 pt-3 border-t border-white/8">
              Subtotal {fmtMoney(detailOrder.subtotal)} · Discount {fmtMoney(detailOrder.discountAmount || 0)} · Gift card {fmtMoney(detailOrder.giftCardAmount || 0)} · Rewards {fmtMoney(detailOrder.loyaltyDiscount || 0)} · Shipping {fmtMoney(detailOrder.shipping)} · Total <strong className="text-white">{fmtMoney(detailOrder.total)}</strong>
              {detailOrder.deliveryMethod && <><br />Delivery method: <span className="font-mono">{detailOrder.deliveryMethod}</span></>}
              {detailOrder.promoCode && <><br />Promo code: <span className="font-mono">{detailOrder.promoCode}</span></>}
              {detailOrder.loyaltyPointsUsed > 0 && <><br />Points redeemed: <span className="font-mono">{detailOrder.loyaltyPointsUsed}</span></>}
              <br />Payment method: <span className="font-mono">{PAYMENT_METHOD_LABELS[detailOrder.paymentMethod] || detailOrder.paymentMethod}</span>
              <br />Payment status: <span className="font-mono">{PAYMENT_STATUS_LABELS[detailOrder.paymentStatus] || detailOrder.paymentStatus}</span>
              {detailOrder.paymentProvider && <><br />Payment provider: <span className="font-mono">{detailOrder.paymentProvider}</span></>}
              {detailOrder.providerTransactionId && <><br />Provider reference: <span className="font-mono">{detailOrder.providerTransactionId}</span></>}
              <br />Confirmation email: <span className="font-mono">{detailOrder.confirmationEmailSentAt ? `sent ${new Date(detailOrder.confirmationEmailSentAt).toLocaleString()}` : 'not sent'}</span>
            </div>
          </>
        )}
      </Modal>
    </AdminLayout>
  );
}
