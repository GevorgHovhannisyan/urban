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

// Fiscal receipt (ՀԴՄ) status — separate from payment and email status.
const FISCAL_STYLES = {
  issued: ['Issued', 'border-emerald-400/50 text-emerald-400'],
  pending: ['Pending', 'border-white/30 text-white/60'],
  processing: ['Sending', 'border-white/30 text-white/60'],
  blocked: ['Blocked', 'border-amber-400/50 text-amber-400'],
  failed: ['Failed', 'border-red-400/50 text-red-400'],
  unknown: ['Unknown', 'border-orange-400/60 text-orange-400'],
};
const utcLocal = (value) => new Date(`${String(value).replace(' ', 'T')}Z`).toLocaleString();

function FiscalBadge({ receipt }) {
  if (!receipt) return <span className="text-white/25 text-xs">—</span>;
  const [label, cls] = FISCAL_STYLES[receipt.status] || [receipt.status, 'border-white/30 text-white/60'];
  return <span className={`inline-block px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest border ${cls}`}>{label}</span>;
}

function HdmStatusBar({ adminFetch, toast }) {
  const [status, setStatus] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminFetch('/hdm/status').then(setStatus).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!status) return null;
  const runCheck = async () => {
    setBusy(true);
    try {
      setCheck(await adminFetch('/hdm/check-connection', { method: 'POST', body: '{}' }));
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };
  const counts = Object.entries(status.counts || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return (
    <div className="border border-white/8 px-4 py-3 mb-4 text-xs flex flex-wrap items-center gap-3">
      <span className="font-mono uppercase tracking-widest text-white/40">ՀԴՄ</span>
      <span className="text-white/70 flex-1 min-w-[240px]">{status.config.message}{counts ? ` — ${counts}` : ''}</span>
      {check && (
        <span className={check.ok ? 'text-emerald-400' : 'text-red-400'}>
          checkConnection: {check.ok ? 'OK' : `failed (HTTP ${check.httpStatus ?? '–'}, code ${check.code ?? '–'}) ${check.message || ''}`}
        </span>
      )}
      <Button variant="secondary" onClick={runCheck} disabled={busy}>{busy ? 'Checking…' : 'Check connection'}</Button>
    </div>
  );
}

// Accounting check: paid online orders (ArCa + Idram) vs. issued fiscal
// receipts for a date range (Armenia time). Compare its totals with the SRC
// portal's receipt report for the register and with the ArCa/Idram payouts.
const amdFmt = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ֏`);
function ymd(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function FiscalReport({ adminFetch, toast }) {
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(ymd(today));
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setReport(await adminFetch(`/hdm/report?from=${from}&to=${to}`));
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };
  const downloadCsv = () => {
    const cols = ['orderNumber', 'createdAt', 'provider', 'providerTransactionId', 'paymentStatus', 'paidAmountAmd', 'fiscalStatus', 'receiptId', 'fiscal', 'crn', 'receiptTotalAmd', 'issuedAt', 'receiptEmailSent', 'problem'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...report.lines.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fiscal-report_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const s = report?.summary;
  return (
    <div className="border border-white/8 px-4 py-3 mb-4 text-xs">
      <button type="button" className="font-mono uppercase tracking-widest text-white/60 hover:text-white" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Fiscal report (accounting check)
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-white/50">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent border border-white/15 px-2 py-1 ml-1" /></label>
            <label className="text-white/50">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-transparent border border-white/15 px-2 py-1 ml-1" /></label>
            <Button variant="secondary" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Run report'}</Button>
            {report && report.lines.length > 0 && <Button variant="secondary" onClick={downloadCsv}>Download CSV</Button>}
          </div>
          {s && (
            <>
              <p className={s.balanced ? 'text-emerald-400' : 'text-amber-400'}>
                {s.balanced ? 'Balanced: every paid online order has an issued receipt for exactly the amount charged.' : `${s.problems} order(s) need attention; difference ${amdFmt(s.differenceAmd)}.`}
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="border border-white/8 p-3">
                  <p className="text-white/40 uppercase tracking-widest text-[10px]">Paid online (money received)</p>
                  <p className="text-white text-base font-mono mt-1">{amdFmt(s.paidOnline.amountAmd)}</p>
                  <p className="text-white/50">{s.paidOnline.count} order(s){Object.entries(s.byProvider).map(([k, v]) => ` · ${k}: ${amdFmt(v.amountAmd)} (${v.count})`).join('')}</p>
                </div>
                <div className="border border-white/8 p-3">
                  <p className="text-white/40 uppercase tracking-widest text-[10px]">Receipts issued (ՀԴՄ)</p>
                  <p className="text-white text-base font-mono mt-1">{amdFmt(s.receiptsIssued.amountAmd)}</p>
                  <p className="text-white/50">{s.receiptsIssued.count} receipt(s)</p>
                </div>
                <div className="border border-white/8 p-3">
                  <p className="text-white/40 uppercase tracking-widest text-[10px]">Not fiscalized online</p>
                  <p className="text-white text-base font-mono mt-1">{s.cashOnDelivery.count}</p>
                  <p className="text-white/50">cash-on-delivery order(s) — receipt at delivery</p>
                </div>
              </div>
              {report.lines.filter((l) => l.problem).length > 0 && (
                <div>
                  <p className="text-white/40 uppercase tracking-widest text-[10px] mb-1">Needs attention</p>
                  <ul className="space-y-1">
                    {report.lines.filter((l) => l.problem).map((l) => (
                      <li key={l.orderNumber} className="text-red-300"><span className="font-mono text-white/80">{l.orderNumber}</span> — {l.problem}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FiscalPanel({ order, adminFetch, toast, onChanged }) {
  const r = order.fiscalReceipt;
  const [busy, setBusy] = useState(false);
  const act = async (path, body, success) => {
    setBusy(true);
    try {
      await adminFetch(`/orders/${encodeURIComponent(order.id)}/fiscal/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
      toast(success);
      onChanged();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };
  const link = () => {
    const receiptId = window.prompt('Receipt number from the SRC portal for this payment:');
    if (receiptId) act('link', { receiptId: receiptId.trim() }, 'Receipt linked.');
  };
  const notIssued = () => {
    const ok = window.confirm('Only continue if you checked the SRC portal and NO receipt exists for this payment. A new receipt will be sent. Continue?');
    if (ok) act('confirm-not-issued', { confirm: true }, 'Marked as not issued — sending again.');
  };
  if (!r) {
    return (
      <p className="text-sm text-white/50">
        No fiscal receipt for this order{order.paymentStatus === 'paid' ? ' (HDM was off, or this payment method is not fiscalized online).' : '.'}
      </p>
    );
  }
  return (
    <div className="text-sm space-y-1.5">
      <p>
        <FiscalBadge receipt={r} /> <span className="font-mono ml-2">{r.amount} {r.currency}</span>
        {r.resolvedBy && r.resolvedBy !== 'print' ? <span className="text-white/40 text-xs ml-2">(resolved by {r.resolvedBy})</span> : null}
      </p>
      {r.status === 'issued' && (
        <p className="text-white/70 font-mono text-xs">
          Receipt {r.receiptId} · Fiscal {r.fiscal || '—'} · CRN {r.crn}{r.receiptTime ? ` · ${new Date(r.receiptTime).toLocaleString()}` : ''}
        </p>
      )}
      {r.status === 'unknown' && (
        <p className="text-orange-400 text-xs">
          The request reached SRC but no answer came back — a receipt may exist. It is never resent automatically; reconciliation checks every minute.
          If it stays unknown, look it up in the SRC portal, then link it or confirm none exists.
        </p>
      )}
      {r.lastError && <p className="text-xs text-red-300 break-all">{r.lastError}</p>}
      <p className="text-xs text-white/50">Attempts: {r.attempts}{r.nextAttemptAt ? ` · next try ${utcLocal(r.nextAttemptAt)}` : ''}</p>
      {r.status === 'issued' && (
        <p className="text-xs text-white/50">
          Receipt email: {r.email.sentAt ? `sent ${utcLocal(r.email.sentAt)}` : `not sent${r.email.attempts ? ` (${r.email.attempts} attempt${r.email.attempts === 1 ? '' : 's'})` : ''}`}
          {!r.email.sentAt && r.email.error ? ` — ${r.email.error}` : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        {['failed', 'blocked'].includes(r.status) && <Button variant="secondary" disabled={busy} onClick={() => act('retry', {}, 'Queued again.')}>Retry</Button>}
        {['unknown', 'failed'].includes(r.status) && <Button variant="secondary" disabled={busy} onClick={link}>Link SRC receipt…</Button>}
        {r.status === 'unknown' && <Button variant="secondary" disabled={busy} onClick={notIssued}>Confirm not issued</Button>}
        {r.status === 'issued' && <Button variant="secondary" disabled={busy} onClick={() => act('resend-email', {}, 'Receipt email sent.')}>Resend receipt email</Button>}
        {r.receiptUrl && <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="text-xs underline text-white/70 self-center">Open receipt</a>}
        {r.invoicePdfUrl && <a href={r.invoicePdfUrl} className="text-xs underline text-white/70 self-center">Download PDF</a>}
      </div>
    </div>
  );
}

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

  // Reload the list and keep the open details modal in sync after a fiscal action.
  const reloadKeepingDetail = () => {
    adminFetch('/orders')
      .then((data) => {
        setOrders(data.orders);
        setDetailOrder((current) => (current ? data.orders.find((o) => o.id === current.id) || null : null));
      })
      .catch((err) => toast(err.message, true));
  };

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
      <HdmStatusBar adminFetch={adminFetch} toast={toast} />
      <FiscalReport adminFetch={adminFetch} toast={toast} />
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
                    {o.fiscalReceipt && <div className="mt-1.5" title="Fiscal receipt (ՀԴՄ)"><FiscalBadge receipt={o.fiscalReceipt} /></div>}
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
              <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[420px]" data-keep-table>
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
              <br />Confirmation email: <span className="font-mono">{detailOrder.confirmationEmailSentAt ? `sent ${new Date(detailOrder.confirmationEmailSentAt).toLocaleString()}` : `not sent${detailOrder.confirmationEmailAttempts ? ` (${detailOrder.confirmationEmailAttempts} attempt${detailOrder.confirmationEmailAttempts === 1 ? '' : 's'})` : ''}`}</span>
              {!detailOrder.confirmationEmailSentAt && detailOrder.confirmationEmailError && <><br />Email error: <span className="font-mono text-red-300 break-all">{detailOrder.confirmationEmailError}</span></>}
            </div>
            <div>
              <p className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-1.5">Fiscal receipt (ՀԴՄ)</p>
              <FiscalPanel order={detailOrder} adminFetch={adminFetch} toast={toast} onChanged={reloadKeepingDetail} />
            </div>
          </>
        )}
      </Modal>
    </AdminLayout>
  );
}
