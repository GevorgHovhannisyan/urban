import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button, Input, Select, Checkbox } from '../components/AdminLayout';
import Modal, { ConfirmModal } from '../components/Modal';

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;

const EMPTY_PROMO = { code: '', type: 'percentage', value: '', active: true, maxUses: '', minSubtotal: '0', expiresAt: '' };

function toFormState(p) {
  if (!p) return EMPTY_PROMO;
  return {
    code: p.code,
    type: p.type,
    value: String(p.value ?? ''),
    active: p.active !== false,
    maxUses: p.maxUses === null || p.maxUses === undefined ? '' : String(p.maxUses),
    minSubtotal: String(p.minSubtotal ?? 0),
    expiresAt: p.expiresAt ? String(p.expiresAt).slice(0, 10) : '',
  };
}

function toPayload(form) {
  return {
    code: form.code,
    type: form.type,
    value: Number(form.value),
    minSubtotal: Number(form.minSubtotal) || 0,
    maxUses: form.maxUses === '' ? null : Number(form.maxUses),
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    active: form.active,
  };
}

export default function AdminPromoCodes({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_PROMO);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/promo-codes')
      .then((data) => setPromos(data.promoCodes))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm(EMPTY_PROMO); setEditing('new'); };
  const openEdit = (p) => { setForm(toFormState(p)); setEditing(p); };
  const close = () => setEditing(null);

  const save = async () => {
    const payload = toPayload(form);
    if (!payload.code || !Number.isFinite(payload.value) || payload.value <= 0) {
      toast('Code and a positive value are required.', true);
      return;
    }
    setSaving(true);
    try {
      if (editing === 'new') {
        await adminFetch('/promo-codes', { method: 'POST', body: JSON.stringify(payload) });
        toast('Promo code created.');
      } else {
        await adminFetch(`/promo-codes/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Promo code updated.');
      }
      close();
      load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await adminFetch(`/promo-codes/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      toast('Promo code deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  return (
    <AdminLayout
      section="promos"
      onNavigate={onNavigate}
      title="Promo Codes"
      subtitle={`${promos.length} code(s)`}
      actions={<Button variant="primary" onClick={openNew}>Add promo code</Button>}
    >
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {promos.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40">No promo codes yet.</td></tr>
              )}
              {promos.map((p) => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono">{p.code}</td>
                  <td className="px-4 py-3">{p.type === 'percentage' ? `${p.value}%` : fmtMoney(p.value)}</td>
                  <td className="px-4 py-3 font-mono">{p.usedCount}{p.maxUses ? ` / ${p.maxUses}` : ''}</td>
                  <td className="px-4 py-3 text-white/60">{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : 'Never'}</td>
                  <td className="px-4 py-3"><Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <Button variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
                    <Button variant="danger" onClick={() => setDeleteTarget(p)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={close}
        title={editing === 'new' ? 'Add promo code' : `Edit ${editing?.code || ''}`}
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER20" />
          <Select label="Discount type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="percentage">Percentage (%)</option>
            <option value="fixed">Fixed amount ($)</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Value" type="number" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="e.g. 20" />
          <Input label="Minimum order ($)" type="number" step="0.01" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Max uses (blank = unlimited)" type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          <Input label="Expires (blank = never)" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </div>
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        <p className="text-xs text-white/40">Percentage discounts apply to the order subtotal (before shipping). Fixed discounts are capped at the subtotal, so an order can never go negative.</p>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete promo code"
        message={`Delete "${deleteTarget?.code}" permanently?`}
      />
    </AdminLayout>
  );
}
