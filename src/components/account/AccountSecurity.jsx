import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import PasswordInput from '../PasswordInput';

export default function AccountSecurity() {
  const { accountFetch, logout, navigate } = useApp();
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

  // Permanent account deletion — password + typing DELETE (server re-checks both).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteForm, setDeleteForm] = useState({ password: '', confirm: '' });
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deleteReady = deleteForm.password && deleteForm.confirm.trim().toUpperCase() === 'DELETE';

  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!deleteReady) return;
    setDeleteError('');
    setDeleting(true);
    try {
      const res = await accountFetch('', { method: 'DELETE', body: JSON.stringify(deleteForm) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete your account.');
      logout();
      navigate('home');
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  };

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
        <PasswordInput name="currentPassword" required placeholder="Current password" value={form.currentPassword} onChange={update} className="up-input" autoComplete="current-password" />
        <PasswordInput name="newPassword" required minLength="8" placeholder="New password" value={form.newPassword} onChange={update} className="up-input" autoComplete="new-password" />
        <PasswordInput name="confirmPassword" required minLength="8" placeholder="Confirm new password" value={form.confirmPassword} onChange={update} className="up-input" autoComplete="new-password" />
        {error && <p className="text-sm status-error">{error}</p>}
        {message && <p className="text-sm text-accent">{message}</p>}
        <button disabled={saving} className="btn-primary px-6 py-3 text-[11px] font-mono uppercase tracking-widest disabled:opacity-50">
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <section className="border border-error/40 p-5 space-y-4" aria-labelledby="delete-account-title">
        <div>
          <p id="delete-account-title" className="text-[10px] font-mono tracking-widest uppercase text-error mb-2">Delete Account</p>
          <p className="text-sm text-muted leading-6">Permanently delete your Urban Phoenix account. This cannot be undone.</p>
        </div>

        {!deleteOpen ? (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="px-6 py-3 text-[11px] font-mono uppercase tracking-widest border border-error text-error hover:bg-error hover:text-white transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-4">
            <ul className="text-sm text-muted leading-6 list-disc pl-5 space-y-1">
              <li>Your profile, saved addresses, wishlist and preferences will be deleted.</li>
              <li>Your UP Society points will be lost.</li>
              <li>You will be signed out and will no longer be able to sign in with this account.</li>
              <li>Records of orders you placed are kept for accounting and legal purposes, but will no longer be linked to an account.</li>
            </ul>
            <PasswordInput
              name="password"
              required
              placeholder="Your password"
              value={deleteForm.password}
              onChange={(e) => setDeleteForm((f) => ({ ...f, password: e.target.value }))}
              className="up-input"
              autoComplete="current-password"
            />
            <label className="block">
              <span className="block text-xs text-muted mb-2">Type DELETE to confirm</span>
              <input
                name="confirm"
                required
                value={deleteForm.confirm}
                onChange={(e) => setDeleteForm((f) => ({ ...f, confirm: e.target.value }))}
                className="up-input"
                autoComplete="off"
                translate="no"
              />
            </label>
            {deleteError && <p className="text-sm status-error">{deleteError}</p>}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={!deleteReady || deleting}
                className="px-6 py-3 text-[11px] font-mono uppercase tracking-widest bg-error text-white disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Permanently delete account'}
              </button>
              <button
                type="button"
                onClick={() => { setDeleteOpen(false); setDeleteForm({ password: '', confirm: '' }); setDeleteError(''); }}
                className="px-6 py-3 text-[11px] font-mono uppercase tracking-widest border border-border"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
