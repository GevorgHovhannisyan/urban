import { useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { Button, Input } from '../components/AdminLayout';

export default function AdminLogin() {
  const { login } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F3] flex items-center justify-center px-6 font-body">
      <form onSubmit={submit} className="w-full max-w-sm">
        <p className="font-display font-black tracking-[0.25em] uppercase text-xl text-center mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Urban Phoenix
        </p>
        <p className="text-[10px] font-mono text-white/40 tracking-[0.2em] uppercase text-center mb-10">Admin sign in</p>

        <div className="space-y-4">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
          <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>

        {error && <p className="text-sm text-[#e5484d] mt-4">{error}</p>}

        <Button type="submit" variant="primary" disabled={submitting} className="w-full mt-6 py-3">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
