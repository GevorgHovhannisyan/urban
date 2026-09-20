import { useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button, Checkbox, Input, Select } from '../components/AdminLayout';
import {
  ARMENIA_LABEL,
  toArmeniaDatetimeLocal as toDatetimeLocal,
  fromArmeniaDatetimeLocal as toIso,
  armeniaInputFromNowPlusMs,
  formatArmeniaPreview,
  formatArmeniaInstant,
} from '../armeniaTime';

const PRESETS = [
  ['Now', 0],
  ['+1 Hour', 60 * 60 * 1000],
  ['Tomorrow', 24 * 60 * 60 * 1000],
  ['+3 Days', 3 * 24 * 60 * 60 * 1000],
  ['+1 Week', 7 * 24 * 60 * 60 * 1000],
];

// A native <input type="datetime-local"> renders as separate mm/dd/yyyy
// number segments — typing into the wrong one (easy to do, especially
// coming from Armenia's day-first date convention) silently produces a
// wildly different date with no warning. The preset buttons sidestep typing
// a date at all for the common cases; the preview line below the input
// makes whatever ends up in it impossible to misread before saving.
function ArmeniaDateField({ label, value, onChange }) {
  return (
    <div>
      <Input label={`${label} (${ARMENIA_LABEL})`} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-[11px] text-white/40 mt-1.5">{value ? `→ ${formatArmeniaPreview(value)}` : 'No date set'}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {PRESETS.map(([presetLabel, ms]) => (
          <button
            key={presetLabel}
            type="button"
            onClick={() => onChange(armeniaInputFromNowPlusMs(ms))}
            className="text-[11px] font-mono uppercase tracking-widest text-white/50 hover:text-white transition-colors underline underline-offset-4"
          >
            {presetLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

const STATUS_META = {
  upcoming: { tone: 'info', label: 'Upcoming' },
  'early-access': { tone: 'warn', label: 'Early Access' },
  'members-only': { tone: 'neutral', label: 'Members Only' },
  live: { tone: 'success', label: 'Live' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.live;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (!targetIso) return null;
  const remaining = Math.max(0, new Date(targetIso).getTime() - now);
  if (remaining <= 0) return 'Now';
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function DropRow({ product, onSave, onClear }) {
  const [editing, setEditing] = useState(false);
  const [releaseAt, setReleaseAt] = useState(toDatetimeLocal(product.releaseAt));
  const [earlyAccessAt, setEarlyAccessAt] = useState(toDatetimeLocal(product.earlyAccessAt));
  const [membersOnly, setMembersOnly] = useState(Boolean(product.membersOnly));
  const [saving, setSaving] = useState(false);
  const nextMilestone = product.dropStatus === 'upcoming' ? product.earlyAccessAt : product.releaseAt;
  const countdown = useCountdown(product.dropStatus === 'live' || product.dropStatus === 'members-only' ? null : nextMilestone);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(product.id, { releaseAt: toIso(releaseAt), earlyAccessAt: toIso(earlyAccessAt), membersOnly });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-white/8 p-4">
      <div className="flex items-start gap-4">
        {product.images?.[0] && <img src={product.images[0]} alt="" className="w-14 h-14 object-cover shrink-0 bg-white/5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm font-medium truncate">{product.name}</p>
            <StatusBadge status={product.dropStatus} />
            {product.membersOnly && product.dropStatus !== 'members-only' && <Badge tone="neutral">Members Only After Release</Badge>}
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap text-xs text-white/40 font-mono">
            {product.earlyAccessAt && <span>Early access: {formatArmeniaInstant(product.earlyAccessAt)}</span>}
            {product.releaseAt && <span>Public release: {formatArmeniaInstant(product.releaseAt)}</span>}
            {countdown && <span className="text-[#C65D1E]">Next milestone in {countdown}</span>}
            <span>{product.stockTracked ? (product.isSoldOut ? 'Sold out' : `${product.totalStock} in stock`) : 'Stock not tracked'}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</Button>
          <Button variant="danger" onClick={() => onClear(product.id)}>Make Live Now</Button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 pt-4 border-t border-white/8 grid sm:grid-cols-2 gap-4">
          <ArmeniaDateField label="Early access from" value={earlyAccessAt} onChange={setEarlyAccessAt} />
          <ArmeniaDateField label="Public release date/time" value={releaseAt} onChange={setReleaseAt} />
          <div className="sm:col-span-2 flex items-center justify-between">
            <Checkbox label="Members only after release (stays gated to signed-in customers)" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
            <Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleNewDrop({ candidates, onSchedule }) {
  const [productId, setProductId] = useState('');
  const [earlyAccessAt, setEarlyAccessAt] = useState('');
  const [releaseAt, setReleaseAt] = useState('');
  const [membersOnly, setMembersOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!productId || !releaseAt) return;
    setSaving(true);
    try {
      await onSchedule(productId, { releaseAt: toIso(releaseAt), earlyAccessAt: toIso(earlyAccessAt) || toIso(releaseAt), membersOnly });
      setProductId('');
      setEarlyAccessAt('');
      setReleaseAt('');
      setMembersOnly(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-white/8">
      <div className="px-5 py-4 border-b border-white/8">
        <p className="text-sm font-medium">Schedule A New Drop</p>
        <p className="text-xs text-white/40 mt-0.5">Pick any live product and give it a release date — it'll appear on the storefront's "New Drop" page and countdown automatically.</p>
      </div>
      <div className="p-5 space-y-4">
        <Select label="Product" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Select a product…</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="grid sm:grid-cols-2 gap-4">
          <ArmeniaDateField label="Early access from (optional — signed-in customers only)" value={earlyAccessAt} onChange={setEarlyAccessAt} />
          <ArmeniaDateField label="Public release date/time" value={releaseAt} onChange={setReleaseAt} />
        </div>
        <div className="flex items-center justify-between">
          <Checkbox label="Members only after release" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
          <Button variant="primary" disabled={saving || !productId || !releaseAt} onClick={submit}>{saving ? 'Scheduling…' : 'Schedule Drop'}</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminDrops({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminFetch('/products')
      .then((data) => setProducts(data.products || []))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduled = useMemo(
    () => (products || [])
      .filter((p) => p.releaseAt && (p.dropStatus === 'upcoming' || p.dropStatus === 'early-access'))
      .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt)),
    [products],
  );
  const membersOnly = useMemo(() => (products || []).filter((p) => p.dropStatus === 'members-only'), [products]);
  const candidates = useMemo(() => (products || []).filter((p) => !p.releaseAt && !p.archived), [products]);

  const patchProduct = async (id, fields) => {
    try {
      await adminFetch(`/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ...fields, partial: true }) });
      toast('Drop updated.');
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const clearDrop = (id) => patchProduct(id, { releaseAt: null, earlyAccessAt: null, membersOnly: false });

  return (
    <AdminLayout section="drops" onNavigate={onNavigate} title="Drops" subtitle="Schedule and monitor early-access and timed product releases">
      {loading || !products ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="space-y-8">
          <div>
            <h2 className="text-sm font-mono uppercase tracking-widest text-white/50 mb-3">Live On The New Drop Page ({scheduled.length})</h2>
            {scheduled.length === 0 ? (
              <p className="text-white/40 text-sm border border-white/8 p-5">Nothing scheduled — the storefront's "New Drop" page will show its empty state until you schedule one below.</p>
            ) : (
              <div className="space-y-3">
                {scheduled.map((p) => <DropRow key={p.id} product={p} onSave={patchProduct} onClear={clearDrop} />)}
              </div>
            )}
          </div>

          {membersOnly.length > 0 && (
            <div>
              <h2 className="text-sm font-mono uppercase tracking-widest text-white/50 mb-3">Members-Only ({membersOnly.length})</h2>
              <div className="space-y-3">
                {membersOnly.map((p) => <DropRow key={p.id} product={p} onSave={patchProduct} onClear={clearDrop} />)}
              </div>
            </div>
          )}

          <ScheduleNewDrop candidates={candidates} onSchedule={patchProduct} />
        </div>
      )}
    </AdminLayout>
  );
}
