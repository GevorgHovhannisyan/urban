import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ListRowsSkeleton } from '../Skeleton';
import CountrySelect from '../CountrySelect';
import { getCountryName, SUPPORTED_SHIPPING_COUNTRIES } from '../../data/countries';

const emptyForm = { firstName: '', lastName: '', phone: '', country: 'AM', city: '', postalCode: '', address: '', apartment: '' };

export default function AccountAddresses() {
  const { accountFetch } = useApp();
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = closed, 'new' = creating, id = editing
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    accountFetch('/addresses')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setAddresses(Array.isArray(d.addresses) ? d.addresses : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const startEdit = (address) => {
    setEditing(address.id);
    setForm({ ...address });
    setError('');
  };
  const startNew = () => {
    setEditing('new');
    setForm(emptyForm);
    setError('');
  };
  const cancel = () => { setEditing(null); setForm(emptyForm); setError(''); };

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const isNew = editing === 'new';
      const res = await accountFetch(isNew ? '/addresses' : `/addresses/${editing}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save address.');
      cancel();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this address?')) return;
    await accountFetch(`/addresses/${id}`, { method: 'DELETE' });
    load();
  };

  const makeDefault = async (id) => {
    await accountFetch(`/addresses/${id}/default`, { method: 'POST' });
    load();
  };

  if (loading) return <ListRowsSkeleton rows={2} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-display font-black uppercase">Addresses</h2>
        {editing === null && (
          <button onClick={startNew} className="border border-border px-5 py-2.5 text-[10px] font-mono uppercase tracking-widest hover:bg-fg/5">
            Add Address
          </button>
        )}
      </div>

      {editing !== null && (
        <form onSubmit={save} className="border border-border p-6 mb-8 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <input name="firstName" required placeholder="First name" value={form.firstName} onChange={update} className="up-input" />
            <input name="lastName" required placeholder="Last name" value={form.lastName} onChange={update} className="up-input" />
          </div>
          <input name="phone" required placeholder="Phone" value={form.phone} onChange={update} className="up-input" />
          <CountrySelect name="country" value={form.country} onChange={(code) => setForm((f) => ({ ...f, country: code }))} countries={SUPPORTED_SHIPPING_COUNTRIES} />
          <div className="grid sm:grid-cols-2 gap-4">
            <input name="city" required placeholder="City" value={form.city} onChange={update} className="up-input" />
            <input name="postalCode" required placeholder="Postal code" value={form.postalCode} onChange={update} className="up-input" />
          </div>
          <input name="address" required placeholder="Address" value={form.address} onChange={update} className="up-input" />
          <input name="apartment" placeholder="Apartment / Unit (optional)" value={form.apartment} onChange={update} className="up-input" />
          {error && <p className="text-sm status-error">{error}</p>}
          <div className="flex gap-3">
            <button disabled={saving} className="btn-primary px-6 py-3 text-[11px] font-mono uppercase tracking-widest disabled:opacity-50">
              {saving ? 'Saving…' : 'Save address'}
            </button>
            <button type="button" onClick={cancel} className="border border-border px-6 py-3 text-[11px] font-mono uppercase tracking-widest">
              Cancel
            </button>
          </div>
        </form>
      )}

      {addresses.length === 0 && editing === null && (
        <div className="flex flex-col items-center text-center gap-4 py-20 border border-border">
          <p className="font-display font-black uppercase text-2xl">No addresses yet.</p>
          <p className="text-sm text-muted max-w-xs">Add a shipping address to speed up checkout.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {addresses.map((a) => (
          <div key={a.id} className="border border-border p-5">
            {a.isDefault && <p className="text-[10px] font-mono text-accent tracking-widest uppercase mb-2">Default</p>}
            <p className="text-sm font-medium mb-1">{a.firstName} {a.lastName}</p>
            <p className="text-xs text-muted leading-relaxed mb-4">
              {a.address}{a.apartment ? `, ${a.apartment}` : ''}<br />
              {a.city}, {a.postalCode}<br />
              {getCountryName(a.country)}<br />
              {a.phone}
            </p>
            <div className="flex gap-4 text-[10px] font-mono uppercase tracking-widest">
              <button onClick={() => startEdit(a)} className="underline text-muted hover:text-fg">Edit</button>
              {!a.isDefault && <button onClick={() => makeDefault(a.id)} className="underline text-muted hover:text-fg">Set default</button>}
              <button onClick={() => remove(a.id)} className="underline text-muted hover:text-fg">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
