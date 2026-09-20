import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function ResetPasswordPage() {
  const { resetPassword, navigate } = useApp();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const email = params.get('email') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const invalidLink = !token || !email;

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await resetPassword({ email, token, password });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not reset your password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="pt-[var(--site-header-h,68px)] min-h-screen flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-4">Account access</p>
        <h1 className="text-4xl font-display font-black uppercase mb-6">Choose New Password</h1>

        {invalidLink ? (
          <div>
            <p className="text-sm text-muted mb-6 leading-relaxed">
              This reset link is missing information and can't be used. Request a new one from the sign-in page.
            </p>
            <button onClick={() => navigate('login')} className="w-full btn-primary py-4 uppercase font-mono text-xs tracking-[.2em]">
              Back to sign in
            </button>
          </div>
        ) : done ? (
          <div>
            <p className="text-sm text-muted mb-6 leading-relaxed">
              Your password has been updated and you're signed in.
            </p>
            <button onClick={() => navigate('account')} className="w-full btn-primary py-4 uppercase font-mono text-xs tracking-[.2em]">
              Go to my account
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <input
              type="password"
              required
              minLength="8"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="up-input"
              autoComplete="new-password"
              autoFocus
            />
            <input
              type="password"
              required
              minLength="8"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="up-input"
              autoComplete="new-password"
            />
            {error && <p className="text-sm status-error">{error}</p>}
            <button disabled={isSubmitting} className="w-full btn-primary py-4 uppercase font-mono text-xs tracking-[.2em] disabled:opacity-50">
              {isSubmitting ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
