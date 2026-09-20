import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Block } from '../Skeleton';
import CountrySelect from '../CountrySelect';

export default function AccountProfile() {
  const { accountFetch, refreshUser } = useApp();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    accountFetch('/profile')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setForm(d.profile))
      .catch(() => setError('Could not load your profile.'))
      .finally(() => setLoading(false));
  }, []);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await accountFetch('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName, email: form.email,
          phone: form.phone, country: form.country,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update your profile.');
      setForm(data.profile);
      setMessage(data.message);
      refreshUser({ firstName: data.profile.firstName, lastName: data.profile.lastName, name: data.profile.name, email: data.profile.email, phone: data.profile.phone, country: data.profile.country });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg space-y-4">
        <Block className="h-10 w-40 mb-6" />
        <div className="grid grid-cols-2 gap-4">
          <Block className="h-11" /><Block className="h-11" />
        </div>
        <Block className="h-11" />
        <Block className="h-11" />
      </div>
    );
  }
  if (!form) return <p className="text-muted text-sm">{error || 'Could not load your profile.'}</p>;

  return (
    <div className="max-w-lg">
      <h2 className="text-2xl font-display font-black uppercase mb-8">Profile</h2>
      <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <input name="firstName" required placeholder="First name" value={form.firstName} onChange={update} className="up-input" />
          <input name="lastName" required placeholder="Last name" value={form.lastName} onChange={update} className="up-input" />
        </div>
        <input name="email" type="email" required placeholder="Email" value={form.email} onChange={update} className="up-input" />
        {!form.emailVerified && (
          <p className="text-xs text-[var(--warning)]">Your email is not verified yet. Check your inbox for the verification link.</p>
        )}
        <input name="phone" type="tel" placeholder="Phone" value={form.phone} onChange={update} className="up-input" />
        <CountrySelect name="country" value={form.country} onChange={(code) => setForm((f) => ({ ...f, country: code }))} />
        {error && <p className="text-sm status-error">{error}</p>}
        {message && <p className="text-sm text-accent">{message}</p>}
        <button disabled={saving} className="btn-primary px-6 py-3 text-[11px] font-mono uppercase tracking-widest disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
