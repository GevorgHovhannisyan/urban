import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';

export default function AccountSecurity() {
  const { accountFetch } = useApp();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    accountFetch('/profile')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setProfile(d.profile))
      .catch(() => {});
  }, []);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const res = await accountFetch('/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update your password.');
      setMessage('Password updated.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-10">
      <h2 className="text-2xl font-display font-black uppercase">Security</h2>

      {profile && (
        <div className="grid sm:grid-cols-2 gap-4 border border-border p-5">
          <div>
            <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1">Email Status</p>
            <p className={`text-sm font-mono uppercase ${profile.emailVerified ? 'text-accent' : 'text-[var(--warning)]'}`}>
              {profile.emailVerified ? 'Verified' : 'Not verified'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1">Account Created</p>
            <p className="text-sm font-mono">{new Date(profile.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <p className="text-[10px] font-mono text-muted tracking-widest uppercase">Change Password</p>
        <input name="currentPassword" type="password" required placeholder="Current password" value={form.currentPassword} onChange={update} className="up-input" autoComplete="current-password" />
        <input name="newPassword" type="password" required minLength="8" placeholder="New password" value={form.newPassword} onChange={update} className="up-input" autoComplete="new-password" />
        <input name="confirmPassword" type="password" required minLength="8" placeholder="Confirm new password" value={form.confirmPassword} onChange={update} className="up-input" autoComplete="new-password" />
        {error && <p className="text-sm status-error">{error}</p>}
        {message && <p className="text-sm text-accent">{message}</p>}
        <button disabled={saving} className="btn-primary px-6 py-3 text-[11px] font-mono uppercase tracking-widest disabled:opacity-50">
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
