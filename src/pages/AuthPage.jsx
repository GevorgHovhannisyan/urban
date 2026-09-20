import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { handleImgError } from '../utils/imageFallback';
import CountrySelect from '../components/CountrySelect';

function AuthImagePanel() {
  return (
    <div className="relative hidden lg:block lg:w-1/2 h-screen sticky top-0 overflow-hidden">
      <img
        src="https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=900&h=1200&fit=crop&auto=format&q=85"
        onError={handleImgError}
        alt="Urban Phoenix"
        loading="eager"
        decoding="async"
        className="up-photo absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/30" />
      {/* The above gradient is strongest at the bottom (protecting the
          caption) and weakest at the top — but the fixed transparent header
          sits at the top, over whatever the source photo happens to be
          there. A dedicated top-anchored overlay keeps header text legible
          regardless of the image's own contrast. */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-12">
        <p className="font-display font-black uppercase text-white text-3xl leading-none mb-3">Freedom To Become</p>
        <p className="text-sm text-white/70 max-w-sm leading-relaxed">
          Streetwear built for those who refuse to stay who they were.
        </p>
      </div>
    </div>
  );
}

function AuthLayout({ children }) {
  return (
    <main className="min-h-screen flex">
      <AuthImagePanel />
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-20 pt-[calc(var(--site-header-h,68px)+3rem)] lg:pt-20">
        {children}
      </div>
    </main>
  );
}

export default function AuthPage() {
  const { login, register, resendVerification, verifyCode, requestPasswordReset, navigate } = useApp();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'verify' | 'forgot' | 'forgot-sent'
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [devResetLink, setDevResetLink] = useState('');
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const [pendingEmail, setPendingEmail] = useState('');
  const [codeDigits, setCodeDigits] = useState('');
  const [registerCountry, setRegisterCountry] = useState('AM');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNeedsVerification(false);
    setIsSubmitting(true);
    const f = new FormData(e.currentTarget);
    const email = f.get('email');
    const password = f.get('password');

    try {
      if (mode === 'login') {
        await login({ email, password });
        navigate('account');
        return;
      }

      const confirmPassword = f.get('confirmPassword');
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        setIsSubmitting(false);
        return;
      }

      const data = await register({
        firstName: f.get('firstName'),
        lastName: f.get('lastName'),
        email,
        password,
        country: f.get('country'),
        phone: f.get('phone'),
      });
      setPendingEmail(data.email || email);
      setDevCode(data.devVerificationCode || '');
      setMode('verify');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setNeedsVerification(Boolean(err.needsVerification));
      if (err.needsVerification) {
        setPendingEmail(email);
        setMode('verify');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await verifyCode(pendingEmail, codeDigits);
      navigate('account');
    } catch (err) {
      setError(err.message || 'Invalid code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    const email = new FormData(e.currentTarget).get('email');
    try {
      const data = await requestPasswordReset(email);
      setDevResetLink(data.devResetLink || '');
      setMode('forgot-sent');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResendState('sending');
    try {
      const data = await resendVerification(pendingEmail);
      setDevCode(data.devVerificationCode || '');
      setResendState('sent');
      setError('');
    } catch {
      setResendState('idle');
    }
  };

  if (mode === 'forgot' || mode === 'forgot-sent') {
    return (
      <AuthLayout>
        <div className="w-full max-w-md">
          <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-4">Account access</p>
          <h1 className="text-4xl font-display font-black uppercase mb-6">Reset Password</h1>

          {mode === 'forgot' ? (
            <>
              <p className="text-sm text-muted mb-6 leading-relaxed">
                Enter the email on your account and we'll send you a link to choose a new password.
              </p>
              <form onSubmit={submitForgot} className="space-y-5">
                <input name="email" type="email" required placeholder="Email" className="up-input" autoComplete="email" autoFocus />
                {error && <p className="text-sm status-error">{error}</p>}
                <button disabled={isSubmitting} className="w-full btn-primary py-4 uppercase font-mono text-xs tracking-[.2em] disabled:opacity-50">
                  {isSubmitting ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          ) : (
            <div>
              <p className="text-sm text-muted mb-6 leading-relaxed">
                If an account exists for that email, we've sent a link to reset your password. It expires in 60 minutes.
              </p>
              {devResetLink && (
                <div className="border border-border p-4 mb-6 text-xs break-all">
                  <p className="text-muted mb-2 uppercase tracking-widest">Dev mode — no SMTP configured</p>
                  <a href={devResetLink} className="text-accent underline">{devResetLink}</a>
                </div>
              )}
            </div>
          )}

          <button onClick={() => { setMode('login'); setError(''); }} className="mt-6 text-sm text-muted underline block">
            Back to sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  if (mode === 'verify') {
    return (
      <AuthLayout>
        <div className="w-full max-w-md">
          <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-4">Almost there</p>
          <h1 className="text-4xl font-display font-black uppercase mb-6">Check your email</h1>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            We sent a 6-digit verification code to <strong className="text-fg">{pendingEmail}</strong>. Enter it
            below to activate your account.
          </p>

          {devCode && (
            <div className="border border-border p-4 mb-6 text-xs">
              <p className="text-muted mb-2 uppercase tracking-widest">Dev mode — no SMTP configured</p>
              <p className="text-2xl font-mono tracking-widest">{devCode}</p>
            </div>
          )}

          <form onSubmit={submitCode} className="space-y-5">
            <input
              name="code"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength="6"
              placeholder="000000"
              value={codeDigits}
              onChange={(e) => setCodeDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="up-input text-center text-2xl tracking-[0.4em] font-mono"
              autoFocus
            />
            {error && <p className="text-sm status-error">{error}</p>}
            <button disabled={isSubmitting || codeDigits.length !== 6} className="w-full btn-primary py-4 uppercase font-mono text-xs tracking-[.2em] disabled:opacity-50">
              {isSubmitting ? 'Verifying…' : 'Verify & sign in'}
            </button>
          </form>

          <button onClick={handleResend} disabled={resendState !== 'idle'} className="mt-6 text-sm text-muted underline disabled:opacity-50 block">
            {resendState === 'sent' ? 'New code sent' : resendState === 'sending' ? 'Sending…' : 'Resend code'}
          </button>
          <button onClick={() => { setMode('login'); setError(''); }} className="mt-3 text-sm text-muted underline block">
            Back to sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-4">Member access</p>
        <h1 key={mode} className="text-5xl font-display font-black uppercase mb-10">{mode === 'login' ? 'Sign In' : 'Join Urban Phoenix'}</h1>
        <form onSubmit={submit} className="space-y-5">
          {mode === 'register' && (
            <div className="grid grid-cols-2 gap-4">
              <input name="firstName" required placeholder="First name" className="up-input" />
              <input name="lastName" required placeholder="Last name" className="up-input" />
            </div>
          )}
          <input name="email" type="email" required placeholder="Email" className="up-input" autoComplete="email" />
          {mode === 'register' && (
            <>
              <CountrySelect name="country" value={registerCountry} onChange={setRegisterCountry} required />
              <input name="phone" type="tel" placeholder="Phone (optional)" className="up-input" autoComplete="tel" />
            </>
          )}
          {/* No minLength on login: an existing account's real password
              could be shorter than the current minimum if it was created
              before that minimum was raised — the server's stored hash is
              still what actually authenticates it, so client-side length
              validation must not block a legitimately-short existing
              password from even being submitted. */}
          <input name="password" type="password" required minLength={mode === 'register' ? '8' : undefined} placeholder="Password" className="up-input" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'register' && (
            <input name="confirmPassword" type="password" required minLength="8" placeholder="Confirm password" className="up-input" autoComplete="new-password" />
          )}
          {mode === 'login' && (
            <button type="button" onClick={() => { setMode('forgot'); setError(''); }} className="text-xs text-muted underline block -mt-2">
              Forgot password?
            </button>
          )}
          {error && (
            <div className="text-sm status-error space-y-2">
              <p>{error}</p>
              {needsVerification && <p className="text-muted">Enter the code we sent to continue.</p>}
            </div>
          )}
          <button key={`submit-${mode}-${isSubmitting}`} disabled={isSubmitting} className="w-full btn-primary py-4 uppercase font-mono text-xs tracking-[.2em] disabled:opacity-50">
            {isSubmitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button key={`toggle-${mode}`} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setNeedsVerification(false); }} className="mt-6 text-sm text-muted underline">
          {mode === 'login' ? 'Create a new account' : 'Already have an account'}
        </button>
      </div>
    </AuthLayout>
  );
}
