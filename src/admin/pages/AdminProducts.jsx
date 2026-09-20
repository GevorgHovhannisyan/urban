import { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useToast } from '../context/ToastContext';
import AdminLayout, { Badge, Button, Input, Textarea, Checkbox } from '../components/AdminLayout';
import Modal, { ConfirmModal } from '../components/Modal';
import { ARMENIA_LABEL, toArmeniaDatetimeLocal as toDatetimeLocal, fromArmeniaDatetimeLocal } from '../armeniaTime';

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;

// One blank hotspot row for "Add hotspot" — x/y default to the center-ish
// so a freshly-added point is at least visible on the image before the
// admin drags the numbers to the real position.
const EMPTY_HOTSPOT = () => ({ id: '', view: 'front', x: 50, y: 50, label: '', title: '', description: '', material: '', specs: '' });
const EMPTY_GARMENT_EXPLORER = { enabled: true, frontImage: '', backImage: '', hotspots: [] };

const EMPTY_PRODUCT = {
  name: '', price: '', compareAtPrice: '', category: '', garmentType: '', subtitle: '', collection: '',
  colors: '', sizes: '', images: '', description: '', materials: '', care: '',
  shipping: 'Free shipping within Armenia. Orders dispatched within 1–2 business days.',
  returns: 'Free returns within 14 days of delivery. Items must be unworn with original tags attached.',
  isNew: false, isFeatured: false, isLimitedEdition: false, limitedEditionTotal: '', archived: false,
  stock: {}, releaseAt: '', earlyAccessAt: '', membersOnly: false,
  garmentExplorer: EMPTY_GARMENT_EXPLORER,
};

function toFormState(p) {
  if (!p) return EMPTY_PRODUCT;
  const ge = p.garmentExplorer;
  return {
    ...p,
    price: String(p.price ?? ''),
    compareAtPrice: p.compareAtPrice ? String(p.compareAtPrice) : '',
    limitedEditionTotal: p.limitedEditionTotal != null ? String(p.limitedEditionTotal) : '',
    colors: (p.colors || []).join(', '),
    sizes: (p.sizes || []).join(', '),
    images: (p.images || []).join('\n'),
    stock: p.stock || {},
    releaseAt: toDatetimeLocal(p.releaseAt),
    earlyAccessAt: toDatetimeLocal(p.earlyAccessAt),
    membersOnly: Boolean(p.membersOnly),
    // specs (array on the server) become a comma-separated string here, the
    // same "one text field, split on save" pattern already used for
    // colors/sizes above — turned back into an array by toPayload().
    garmentExplorer: ge ? {
      enabled: ge.enabled !== false,
      frontImage: ge.frontImage || '',
      backImage: ge.backImage || '',
      hotspots: (ge.hotspots || []).map((h) => ({ ...h, specs: (h.specs || []).join(', ') })),
    } : EMPTY_GARMENT_EXPLORER,
  };
}

// Per-size/color inventory. Leaving every cell blank keeps this product
// "untracked" (always purchasable, matching the storefront's pre-inventory
// behavior) — stock only starts being enforced once at least one cell here
// has a real number in it.
function StockGrid({ form, setForm }) {
  const sizes = form.sizes.split(',').map((s) => s.trim()).filter(Boolean);
  const colors = form.colors.split(',').map((s) => s.trim()).filter(Boolean);
  if (sizes.length === 0 || colors.length === 0) {
    return <p className="text-xs text-white/35">Enter sizes and colors above to set inventory per variant.</p>;
  }
  const setQty = (key, value) => {
    const stock = { ...(form.stock || {}) };
    if (value === '') delete stock[key];
    else stock[key] = Math.max(0, Number(value) || 0);
    setForm({ ...form, stock });
  };
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-white/45 mb-2">Inventory (units per size / color — leave blank for untracked)</p>
      <div className="overflow-x-auto border border-white/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-2 py-1.5 text-left text-white/45"></th>
              {colors.map((color) => <th key={color} className="px-2 py-1.5 text-left text-white/45">{color}</th>)}
            </tr>
          </thead>
          <tbody>
            {sizes.map((size) => (
              <tr key={size} className="border-b border-white/5 last:border-b-0">
                <td className="px-2 py-1.5 text-white/60">{size}</td>
                {colors.map((color) => {
                  const key = `${size}|${color}`;
                  return (
                    <td key={color} className="px-2 py-1">
                      <input
                        type="number"
                        min="0"
                        value={form.stock?.[key] ?? ''}
                        onChange={(e) => setQty(key, e.target.value)}
                        className="w-16 bg-white/5 border border-white/10 px-2 py-1 text-white/85 focus:outline-none focus:border-white/30"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function toPayload(form) {
  return {
    name: form.name,
    price: Number(form.price),
    compareAtPrice: form.compareAtPrice !== '' ? Number(form.compareAtPrice) : null,
    category: form.category,
    garmentType: form.garmentType,
    subtitle: form.subtitle,
    collection: form.collection,
    colors: form.colors.split(',').map((s) => s.trim()).filter(Boolean),
    sizes: form.sizes.split(',').map((s) => s.trim()).filter(Boolean),
    images: form.images.split('\n').map((s) => s.trim()).filter(Boolean),
    description: form.description,
    materials: form.materials,
    care: form.care,
    shipping: form.shipping,
    returns: form.returns,
    isNew: Boolean(form.isNew),
    isFeatured: Boolean(form.isFeatured),
    isLimitedEdition: Boolean(form.isLimitedEdition),
    limitedEditionTotal: form.isLimitedEdition && form.limitedEditionTotal !== '' ? Number(form.limitedEditionTotal) : null,
    archived: Boolean(form.archived),
    stock: form.stock || {},
    releaseAt: fromArmeniaDatetimeLocal(form.releaseAt),
    earlyAccessAt: fromArmeniaDatetimeLocal(form.earlyAccessAt),
    membersOnly: Boolean(form.membersOnly),
    garmentExplorer: garmentExplorerPayload(form.garmentExplorer),
  };
}

// Sends null (not an empty/half-filled object) when there's nothing real to
// show — the server treats null as "no override, auto-generate instead"
// (see products-api.mjs's sanitizeGarmentExplorer), same rule the frontend
// itself already used before this was admin-editable. Front image is the
// one genuinely required field; a hotspot needs at least a label to be
// worth keeping (x/y always have a numeric value from the form, even if
// never dragged from the default 50/50).
function garmentExplorerPayload(ge) {
  if (!ge || !ge.enabled || !clean(ge.frontImage)) return null;
  const hotspots = (ge.hotspots || [])
    .filter((h) => clean(h.label))
    .map((h) => ({
      id: clean(h.id),
      view: h.view === 'back' ? 'back' : 'front',
      x: Number(h.x) || 0,
      y: Number(h.y) || 0,
      label: clean(h.label),
      title: clean(h.title),
      description: clean(h.description),
      material: clean(h.material),
      specs: String(h.specs || '').split(',').map((s) => s.trim()).filter(Boolean),
    }));
  if (hotspots.length === 0) return null;
  return { enabled: true, frontImage: clean(ge.frontImage), backImage: clean(ge.backImage) || null, hotspots };
}
const clean = (v) => String(v ?? '').trim();

// Editable version of the Garment Explorer config every product carries
// (src/data/garmentExplorer.js / server/products-api.mjs's
// sanitizeGarmentExplorer). Left disabled or with no front image + at least
// one labeled hotspot, the storefront falls back to its own
// auto-generated-from-garmentType default instead — so this never needs to
// be filled in for every product, only the ones worth curating by hand.
function GarmentExplorerEditor({ form, setForm }) {
  const ge = form.garmentExplorer || EMPTY_GARMENT_EXPLORER;
  const setGe = (patch) => setForm({ ...form, garmentExplorer: { ...ge, ...patch } });
  const setHotspot = (index, patch) => {
    const hotspots = ge.hotspots.map((h, i) => (i === index ? { ...h, ...patch } : h));
    setGe({ hotspots });
  };
  const removeHotspot = (index) => setGe({ hotspots: ge.hotspots.filter((_, i) => i !== index) });
  const addHotspot = () => setGe({ hotspots: [...ge.hotspots, EMPTY_HOTSPOT()] });

  return (
    <div className="border-t border-white/10 pt-4 mt-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white/85">Garment Explorer</p>
        <Checkbox label="Enabled" checked={ge.enabled !== false} onChange={(e) => setGe({ enabled: e.target.checked })} />
      </div>
      <p className="text-[11px] text-white/35 mb-3">
        Leave the front image blank (or disable) to let the storefront auto-generate a default explorer
        from this product's category/garment type and materials instead. Only fill this in to hand-curate
        real hotspot positions and copy — never invent technical specs here; leave a hotspot's spec/material
        blank if there's no verified fact to put there.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="Front image URL" value={ge.frontImage} onChange={(e) => setGe({ frontImage: e.target.value })} />
        <Input label="Back image URL (optional — enables FRONT/BACK toggle)" value={ge.backImage} onChange={(e) => setGe({ backImage: e.target.value })} />
      </div>

      <div className="space-y-3">
        {ge.hotspots.map((h, i) => (
          <div key={i} className="border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide text-white/45">Hotspot {i + 1}</p>
              <Button variant="danger" onClick={() => removeHotspot(i)}>Remove</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Label (short, e.g. Cuff)" value={h.label} onChange={(e) => setHotspot(i, { label: e.target.value })} />
              <Input label="Title (defaults to label)" value={h.title} onChange={(e) => setHotspot(i, { title: e.target.value })} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <label className="text-xs text-white/60">
                View
                <select
                  value={h.view}
                  onChange={(e) => setHotspot(i, { view: e.target.value })}
                  className="mt-1 w-full bg-white/5 border border-white/10 px-2 py-2 text-white/85 focus:outline-none focus:border-white/30"
                >
                  <option value="front">Front</option>
                  <option value="back">Back</option>
                </select>
              </label>
              <Input label="X %" type="number" min="0" max="100" value={h.x} onChange={(e) => setHotspot(i, { x: e.target.value })} />
              <Input label="Y %" type="number" min="0" max="100" value={h.y} onChange={(e) => setHotspot(i, { y: e.target.value })} />
              <Input label="Material (real fact only)" value={h.material} onChange={(e) => setHotspot(i, { material: e.target.value })} />
            </div>
            <Textarea label="Description" rows={2} value={h.description} onChange={(e) => setHotspot(i, { description: e.target.value })} />
            <Input label="Technical spec (comma separated, real facts only — leave blank if unverified)" value={h.specs} onChange={(e) => setHotspot(i, { specs: e.target.value })} />
          </div>
        ))}
      </div>
      <Button variant="secondary" onClick={addHotspot} className="mt-3">Add hotspot</Button>
    </div>
  );
}

export default function AdminProducts({ onNavigate }) {
  const { adminFetch } = useAdminAuth();
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // product object | 'new' | null
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch('/products')
      .then((data) => setProducts(data.products))
      .catch((err) => toast(err.message, true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm(EMPTY_PRODUCT); setEditing('new'); };
  const openEdit = (p) => { setForm(toFormState(p)); setEditing(p); };
  const close = () => setEditing(null);

  const save = async () => {
    if (!form.name || !Number.isFinite(Number(form.price))) {
      toast('Name and a valid price are required.', true);
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (editing === 'new') {
        await adminFetch('/products', { method: 'POST', body: JSON.stringify(payload) });
        toast('Product created.');
      } else {
        await adminFetch(`/products/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Product updated.');
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
      await adminFetch(`/products/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      toast('Product deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  return (
    <AdminLayout
      section="products"
      onNavigate={onNavigate}
      title="Products"
      subtitle={`${products.length} product(s)`}
      actions={<Button variant="primary" onClick={openNew}>Add product</Button>}
    >
      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : (
        <div className="border border-white/8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-[11px] font-mono uppercase tracking-widest text-white/40">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40">No products yet.</td></tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-white/40">{p.id}</td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 font-mono">
                    {fmtMoney(p.price)}
                    {p.compareAtPrice > p.price && (
                      <span className="ml-2 text-white/35 line-through">{fmtMoney(p.compareAtPrice)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/60">{p.category}</td>
                  <td className="px-4 py-3 space-x-1.5">
                    {p.isLimitedEdition && <Badge tone="warn">Limited</Badge>}
                    {p.dropStatus === 'upcoming' && <Badge tone="warn">Upcoming</Badge>}
                    {p.dropStatus === 'early-access' && <Badge tone="warn">Early Access</Badge>}
                    {p.dropStatus === 'members-only' && <Badge tone="warn">Members Only</Badge>}
                    <Badge tone={p.archived ? 'neutral' : 'success'}>{p.archived ? 'Archived' : 'Live'}</Badge>
                  </td>
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
        title={editing === 'new' ? 'Add product' : `Edit ${editing?.name || ''}`}
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Price (USD)" type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Compare-at price (USD)" placeholder="Leave blank for no sale" type="number" step="0.01" min="0" value={form.compareAtPrice} onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Category" placeholder="hoodies, tops, bottoms, outerwear, accessories…" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label="Garment type" placeholder="tshirt, hoodie…" value={form.garmentType} onChange={(e) => setForm({ ...form, garmentType: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Subtitle" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
          <Input label="Collection" value={form.collection} onChange={(e) => setForm({ ...form, collection: e.target.value })} />
        </div>
        <Input label="Colors (comma separated)" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} />
        <Input label="Sizes (comma separated)" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} />
        <StockGrid form={form} setForm={setForm} />
        <Textarea label="Image URLs (one per line)" rows={3} value={form.images} onChange={(e) => setForm({ ...form, images: e.target.value })} />
        <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Textarea label="Materials" rows={2} value={form.materials} onChange={(e) => setForm({ ...form, materials: e.target.value })} />
          <Textarea label="Care" rows={2} value={form.care} onChange={(e) => setForm({ ...form, care: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Textarea label="Shipping" rows={2} value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} />
          <Textarea label="Returns" rows={2} value={form.returns} onChange={(e) => setForm({ ...form, returns: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={`Release date/time (${ARMENIA_LABEL})`} type="datetime-local" value={form.releaseAt} onChange={(e) => setForm({ ...form, releaseAt: e.target.value })} />
          <Input label={`Early access from (${ARMENIA_LABEL})`} type="datetime-local" value={form.earlyAccessAt} onChange={(e) => setForm({ ...form, earlyAccessAt: e.target.value })} />
        </div>
        <p className="text-[11px] text-white/35 -mt-1">Leave both blank for an always-live product. Early access (signed-in customers only) opens before the release date; after release, "Members only" keeps it gated to signed-in customers permanently.</p>
        <div className="space-y-2 pt-1">
          <Checkbox label="New arrival" checked={form.isNew} onChange={(e) => setForm({ ...form, isNew: e.target.checked })} />
          <Checkbox label="Featured" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
          <Checkbox label="Limited edition (each unit sold gets a unique numbered serial)" checked={form.isLimitedEdition} onChange={(e) => setForm({ ...form, isLimitedEdition: e.target.checked })} />
          {form.isLimitedEdition && (
            <Input
              label="Limited edition run size (total pieces, e.g. 100)"
              type="number"
              min="1"
              value={form.limitedEditionTotal}
              onChange={(e) => setForm({ ...form, limitedEditionTotal: e.target.value })}
            />
          )}
          <Checkbox label="Members only (signed-in customers only, even after release)" checked={form.membersOnly} onChange={(e) => setForm({ ...form, membersOnly: e.target.checked })} />
          <Checkbox label="Archived (hidden from storefront)" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} />
        </div>

        <GarmentExplorerEditor form={form} setForm={setForm} />
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete product"
        message={`Delete "${deleteTarget?.name}" permanently? This can't be undone.`}
      />
    </AdminLayout>
  );
}
