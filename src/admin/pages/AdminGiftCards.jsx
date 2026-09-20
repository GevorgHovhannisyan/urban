import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button, Input, Select } from '../components/AdminLayout';
import Modal from '../components/Modal';
import { CURRENCIES } from '../../data/currency';

const fmtMoney = (n, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'AMD' ? 0 : 2 }).format(Number(n) || 0);
  } catch {
    return `${Number(n || 0).toFixed(2)} ${currency}`;
  }
};
const fmtDateTime = (iso) => (iso ? new Date(iso.includes('Z') || iso.includes('T') ? iso : `${iso}Z`).toLocaleString() : '—');

const EMPTY_CARD = { value: '100', currency: 'USD', recipientEmail: '', expiresAt: '' };

export default function AdminGiftCards({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_CARD);
  const [saving, setSaving] = useState(false);
  const [historyCard, setHistoryCard] = useState(null); // gift card object | null
  const [transactions, setTransactions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/gift-cards')
      .then((data) => setCards(data.giftCards))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm(EMPTY_CARD); setCreating(true); };
  const close = () => setCreating(false);

  const save = async () => {
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      toast('Enter a positive value.', true);
      return;
    }
    setSaving(true);
    try {
      await adminFetch('/gift-cards', {
        method: 'POST',
        body: JSON.stringify({
          value,
          currency: form.currency,
          recipientEmail: form.recipientEmail,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        }),
      });
      toast('Gift card issued.');
      close();
      load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (card) => {
    try {
      await adminFetch(`/gift-cards/${encodeURIComponent(card.id)}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active: !card.active }),
      });
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const openHistory = async (card) => {
    setHistoryCard(card);
    setHistoryLoading(true);
    try {
      const data = await adminFetch(`/gift-cards/${encodeURIComponent(card.id)}/transactions`);
      setTransactions(data.transactions || []);
    } catch (err) {
      toast(err.message, true);
      setTransactions([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const resendEmail = async (card) => {
    setResendingId(card.id);
    try {
      await adminFetch(`/gift-cards/${encodeURIComponent(card.id)}/resend-email`, { method: 'POST' });
      toast(`Email resent to ${card.recipientEmail}.`);
      load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setResendingId(null);
    }
  };

  return (
    <AdminLayout
      section="gift-cards"
      onNavigate={onNavigate}
      title="Gift Cards"
      subtitle={`${cards.length} card(s)`}
      actions={<Button variant="primary" onClick={openNew}>Issue gift card</Button>}
    >
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cards.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-white/40">No gift cards issued yet.</td></tr>
              )}
              {cards.map((c) => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono">{c.code}</td>
                  <td className="px-4 py-3 font-mono">
                    {fmtMoney(c.balance, c.currency)} <span className="text-white/35">/ {fmtMoney(c.initialValue, c.currency)}</span>
                  </td>
                  <td className="px-4 py-3 text-white/60 font-mono">{c.currency || 'USD'}</td>
                  <td className="px-4 py-3 text-white/60" title={c.source === 'purchase' && c.purchaserEmail ? `Purchased by ${c.purchaserEmail}` : undefined}>
                    {c.recipientEmail || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={c.source === 'purchase' ? 'info' : 'neutral'}>
                      {c.source === 'purchase' ? 'Customer purchase' : 'Issued by admin'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {c.emailSentAt ? (
                      <span title={fmtDateTime(c.emailSentAt)}><Badge tone="success">Sent</Badge></span>
                    ) : c.emailError ? (
                      <span title={c.emailError}><Badge tone="danger">Failed</Badge></span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/60">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'Never'}</td>
                  <td className="px-4 py-3"><Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                    <Button variant="secondary" onClick={() => openHistory(c)}>History</Button>
                    {c.recipientEmail && (
                      <Button variant="secondary" disabled={resendingId === c.id} onClick={() => resendEmail(c)}>
                        {resendingId === c.id ? 'Sending…' : 'Resend email'}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => toggleActive(c)}>{c.active ? 'Deactivate' : 'Activate'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={creating}
        onClose={close}
        title="Issue gift card"
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Issue'}</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Value" type="number" step="0.01" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          <Select label="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </Select>
        </div>
        <Input label="Expires (blank = never)" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        <Input label="Recipient email (optional)" type="email" value={form.recipientEmail} onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })} />
        <p className="text-xs text-white/40">A code is generated automatically (e.g. UP-XXXX-XXXX-XXXX). Customers redeem it at checkout — it can be split across multiple orders until the balance reaches zero. No purchase email is sent automatically for admin-issued cards; use "Resend email" from the list once a recipient is set, if needed.</p>
      </Modal>

      <Modal
        open={Boolean(historyCard)}
        onClose={() => setHistoryCard(null)}
        title={historyCard ? `Redemption history — ${historyCard.code}` : ''}
      >
        {historyLoading ? (
          <p className="text-white/40 text-sm">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="text-white/40 text-sm">No redemptions yet.</p>
        ) : (
          <div className="border border-white/8 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 text-left font-mono uppercase tracking-widest text-white/40">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-white/5">
                    <td className="px-3 py-2 text-white/60">{fmtDateTime(t.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-white/60">{t.orderId ? t.orderId.slice(0, 8) : '—'}</td>
                    <td className={`px-3 py-2 font-mono ${t.amountApplied < 0 ? 'text-emerald-400' : 'text-white'}`}>
                      {t.amountApplied < 0 ? '+' : '−'}{fmtMoney(Math.abs(t.amountApplied), t.currency)}
                    </td>
                    <td className="px-3 py-2 font-mono text-white/60">{fmtMoney(t.balanceAfter, t.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
