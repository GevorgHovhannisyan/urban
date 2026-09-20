import { useEffect, useMemo, useRef, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useApp } from '../context/AppContext';
import { getStripePromise, getStripeAppearance } from '../utils/stripe';
import StripePaymentForm from '../components/StripePaymentForm';
import GiftCardVisual from '../components/GiftCardVisual';
import { handleImgError } from '../utils/imageFallback';
import ScrollReveal from '../components/ScrollReveal';
import Icon from '../components/Icon';
import { CURRENCIES, GIFT_CARD_PRESETS, GIFT_CARD_LIMITS } from '../data/currency';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_CODE = 'UP-XXXX-XXXX-XXXX';

// Formats an amount in the gift card's OWN chosen currency — deliberately
// not the site's shared formatMoney(), which converts through the
// *visitor's* separately-selected display currency and applies the US
// regional price markup. Neither applies here: a gift card's value is
// exactly what the customer picked, in exactly the currency they picked.
function fmtGiftCardAmount(value, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'AMD' ? 0 : 2,
  }).format(Number(value) || 0);
}

const initialForm = {
  currency: 'USD',
  amount: GIFT_CARD_PRESETS.USD[1],
  customAmount: '',
  recipientEmail: '',
  recipientName: '',
  senderName: '',
  message: '',
  purchaserEmail: '',
};

export default function GiftCardPage() {
  const { user, navigate, theme } = useApp();
  const [form, setForm] = useState(() => ({ ...initialForm, purchaserEmail: user?.email || '' }));
  const [useCustomAmount, setUseCustomAmount] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [pendingCheckoutId, setPendingCheckoutId] = useState('');
  const [result, setResult] = useState(null); // { code, amount, currency }
  const [copied, setCopied] = useState(false);
  const [stripeStatus, setStripeStatus] = useState(null); // 'confirming' | 'failed' | null
  const stripePromiseRef = useRef(null);
  if (!stripePromiseRef.current) stripePromiseRef.current = getStripePromise();

  const limits = GIFT_CARD_LIMITS[form.currency];
  const presets = GIFT_CARD_PRESETS[form.currency];
  const amount = useCustomAmount ? Number(form.customAmount) || 0 : form.amount;

  // Switching currency mid-form: presets are currency-specific, so a
  // preset amount picked in USD doesn't carry over to AMD — reset to that
  // currency's default preset rather than leaving a stale/mismatched number.
  const changeCurrency = (nextCurrency) => {
    setForm((current) => ({ ...current, currency: nextCurrency, amount: GIFT_CARD_PRESETS[nextCurrency][1] }));
    setUseCustomAmount(false);
    setFieldErrors((current) => ({ ...current, amount: '' }));
  };

  // Returning from a 3D-Secure redirect (return_url points back here with
  // ?stripe=return&pendingCheckoutId=...) — mirrors CheckoutPage.jsx's
  // identical handling for the cart-order flow.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') !== 'return') return;
    const id = params.get('pendingCheckoutId');
    window.history.replaceState({}, '', window.location.pathname);
    if (!id) return;

    setStripeStatus('confirming');
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await fetch(`/api/gift-cards/purchase/${encodeURIComponent(id)}/status`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not confirm payment.');
        if (data.status === 'succeeded') {
          setResult(data.giftCard || null);
          setStripeStatus(null);
          return;
        }
        if (data.status === 'canceled') {
          setStripeStatus('failed');
          return;
        }
      } catch {
        // Transient — keep polling until the attempt cap below.
      }
      if (attempts < 12 && !cancelled) setTimeout(poll, 1500);
      else if (!cancelled) setStripeStatus('failed');
    };
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: '' }));
    setRequestError('');
  };

  const buildPayload = () => ({
    amount,
    currency: form.currency,
    recipientEmail: form.recipientEmail.trim().toLowerCase(),
    recipientName: form.recipientName.trim(),
    senderName: form.senderName.trim(),
    message: form.message.trim(),
    purchaserEmail: form.purchaserEmail.trim().toLowerCase(),
  });

  const validate = () => {
    const errors = {};
    if (!amount || amount < limits.min || amount > limits.max) {
      errors.amount = `Enter an amount between ${fmtGiftCardAmount(limits.min, form.currency)} and ${fmtGiftCardAmount(limits.max, form.currency)}`;
    }
    if (!form.recipientEmail.trim() || !emailPattern.test(form.recipientEmail.trim())) errors.recipientEmail = 'Enter a valid recipient email';
    if (!form.purchaserEmail.trim() || !emailPattern.test(form.purchaserEmail.trim())) errors.purchaserEmail = 'Enter a valid email';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const startCardPayment = async () => {
    if (!validate() || isSubmitting) return;
    setIsSubmitting(true);
    setRequestError('');
    try {
      const response = await fetch('/api/gift-cards/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start checkout.');
      setClientSecret(data.clientSecret);
      setPendingCheckoutId(data.pendingCheckoutId);
    } catch (error) {
      setRequestError(error.message || 'Could not start checkout. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStripeSuccess = async () => {
    try {
      const res = await fetch(`/api/gift-cards/purchase/${encodeURIComponent(pendingCheckoutId)}/status`);
      const data = await res.json();
      setResult(data.giftCard || null);
    } catch {
      setResult(null);
    }
  };

  const copyCode = async () => {
    if (!result?.code) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — the code is still visible on-screen (and
      // marked select-all via GiftCardVisual) to copy manually.
    }
  };

  const resetForm = () => {
    setForm({ ...initialForm, purchaserEmail: user?.email || '' });
    setUseCustomAmount(false);
    setClientSecret('');
    setPendingCheckoutId('');
    setResult(null);
    setRequestError('');
  };

  if (stripeStatus === 'confirming') {
    return (
      <main className="pt-[var(--site-header-h,68px)] min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-xl" role="status">
          <p className="text-accent font-mono uppercase tracking-widest mb-5">Confirming payment</p>
          <h1 className="font-display font-black text-4xl uppercase mb-5">Just a moment</h1>
          <p className="text-muted">We're confirming your payment with Stripe — this page will update automatically.</p>
        </div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="pt-[var(--site-header-h,68px)] min-h-screen flex items-center justify-center px-6 py-16">
        <div className="text-center max-w-lg w-full" role="status">
          <p className="text-accent font-mono uppercase tracking-widest mb-5">Gift card purchased</p>
          <h1 className="font-display font-black text-5xl uppercase mb-5">Thank You</h1>
          <p className="text-muted mb-8">
            A {fmtGiftCardAmount(result.amount, result.currency || 'USD')} gift card has been sent to {form.recipientEmail}.
          </p>
          {result.code && (
            <div className="mb-8">
              <GiftCardVisual
                amountLabel={fmtGiftCardAmount(result.amount, result.currency || 'USD')}
                currency={result.currency || 'USD'}
                code={result.code}
                revealed
              />
              <button onClick={copyCode} className="btn-primary w-full py-4 mt-5 uppercase text-xs tracking-widest">
                {copied ? 'Copied' : 'Copy Code'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-center gap-4">
            <button onClick={resetForm} className="underline text-sm">Buy another</button>
            <button onClick={() => navigate('home')} className="btn-primary px-8 py-4 uppercase text-xs tracking-widest">
              Return home
            </button>
          </div>
        </div>
      </main>
    );
  }

  const showEmbeddedCardForm = Boolean(clientSecret);

  return (
    <main className="pt-[var(--site-header-h,68px)] min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-16">
        <ScrollReveal>
        <div className="relative overflow-hidden bg-card border border-border mb-12" style={{ aspectRatio: '21/9' }}>
          <img
            src="https://images.unsplash.com/photo-1512909006721-3d6018887383?w=1600&h=686&fit=crop&auto=format&q=85"
            onError={handleImgError}
            alt="Urban Phoenix gift card"
            className="up-photo absolute inset-0 w-full h-full object-cover"
          />
          {/* Literal black/text-white, not bg-bg/text-fg: sits on top of
              photography, not page chrome, so it must not flip with theme. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
            <p className="text-[10px] font-mono text-accent-light tracking-[0.3em] uppercase mb-2">Give Freedom To Become</p>
            <p className="font-display font-black uppercase text-white leading-none" style={{ fontSize: 'clamp(28px, 6vw, 48px)', letterSpacing: '-0.02em' }}>
              Urban Phoenix
            </p>
          </div>
        </div>

        <h1 className="font-display font-black text-5xl uppercase mb-3">Gift Cards</h1>
        <p className="text-muted mb-12 flex items-center gap-2"><Icon name="envelope" size={16} className="shrink-0" />Give the freedom to choose. Delivered by email, redeemable at checkout.</p>
        </ScrollReveal>

        {stripeStatus === 'failed' && (
          <div className="checkout-error mb-8" role="alert">
            We couldn't confirm your payment. If you were charged, contact us with your bank statement — otherwise, please try again.
          </div>
        )}

        {!showEmbeddedCardForm ? (
          <div className="grid lg:grid-cols-[1fr,minmax(280px,340px)] gap-10 items-start">
            <form
              onSubmit={(e) => { e.preventDefault(); startCardPayment(); }}
              // Without this, the browser's own native min/max constraint
              // validation on the custom-amount input intercepts submission
              // before validate() ever runs — blocking out-of-range values
              // correctly, but with a generic unstyled browser tooltip
              // instead of the site's own branded error message below.
              // validate() (and the server) remain the real authority either
              // way; this just makes the UI consistent with how every other
              // form on the site (Checkout, Cart, Auth) reports errors.
              noValidate
              className="space-y-8"
            >
              <div>
                <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-4">Gift Card Currency</p>
                <div className="grid grid-cols-3 gap-3">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => changeCurrency(c.code)}
                      aria-pressed={form.currency === c.code}
                      className={`border py-3 text-sm font-mono uppercase tracking-wide transition-colors ${form.currency === c.code ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg hover:border-[var(--text-secondary)]'}`}
                    >
                      {c.symbol} {c.code}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-2">This gift card will be issued in <strong className="text-fg">{form.currency} — {CURRENCIES.find((c) => c.code === form.currency)?.label}</strong>.</p>
              </div>

              <div>
                <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-4">Amount</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => { setUseCustomAmount(false); update('amount', preset); }}
                      className={`border py-4 text-sm font-mono uppercase tracking-wide transition-colors ${!useCustomAmount && form.amount === preset ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg hover:border-[var(--text-secondary)]'}`}
                    >
                      {fmtGiftCardAmount(preset, form.currency)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setUseCustomAmount(true)}
                  className={`border py-3 px-4 text-sm font-mono uppercase tracking-wide w-full text-left transition-colors ${useCustomAmount ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg hover:border-[var(--text-secondary)]'}`}
                >
                  Custom amount
                </button>
                {useCustomAmount && (
                  <input
                    type="number"
                    min={limits.min}
                    max={limits.max}
                    step="1"
                    value={form.customAmount}
                    onChange={(e) => update('customAmount', e.target.value)}
                    placeholder={`Enter amount (${fmtGiftCardAmount(limits.min, form.currency)}–${fmtGiftCardAmount(limits.max, form.currency)})`}
                    className="mt-3 w-full bg-transparent border border-border px-4 py-3 text-sm"
                  />
                )}
                {fieldErrors.amount && <p className="checkout-error mt-2 text-xs">{fieldErrors.amount}</p>}
              </div>

              <div>
                <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-4">Recipient</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <input
                      type="email"
                      value={form.recipientEmail}
                      onChange={(e) => update('recipientEmail', e.target.value)}
                      placeholder="Recipient email"
                      className="w-full bg-transparent border border-border px-4 py-3 text-sm"
                    />
                    {fieldErrors.recipientEmail && <p className="checkout-error mt-2 text-xs">{fieldErrors.recipientEmail}</p>}
                  </div>
                  <input
                    type="text"
                    value={form.recipientName}
                    onChange={(e) => update('recipientName', e.target.value)}
                    placeholder="Recipient name (optional)"
                    className="w-full bg-transparent border border-border px-4 py-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-4">From</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <input
                      type="email"
                      value={form.purchaserEmail}
                      onChange={(e) => update('purchaserEmail', e.target.value)}
                      placeholder="Your email"
                      className="w-full bg-transparent border border-border px-4 py-3 text-sm"
                    />
                    {fieldErrors.purchaserEmail && <p className="checkout-error mt-2 text-xs">{fieldErrors.purchaserEmail}</p>}
                  </div>
                  <input
                    type="text"
                    value={form.senderName}
                    onChange={(e) => update('senderName', e.target.value)}
                    placeholder="Your name (optional)"
                    className="w-full bg-transparent border border-border px-4 py-3 text-sm"
                  />
                </div>
                <textarea
                  value={form.message}
                  onChange={(e) => update('message', e.target.value)}
                  placeholder="Personal message (optional)"
                  rows={3}
                  maxLength={500}
                  className="mt-4 w-full bg-transparent border border-border px-4 py-3 text-sm resize-none"
                />
              </div>

              {requestError && <p className="checkout-error" role="alert">{requestError}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full py-4 uppercase text-xs tracking-[.2em] disabled:opacity-50"
              >
                {isSubmitting ? 'Starting checkout…' : `Continue to payment — ${fmtGiftCardAmount(amount || 0, form.currency)}`}
              </button>
            </form>

            {/* Live preview — updates as currency/amount change. The code
                shown here is always a non-functional placeholder; the real,
                unique code is generated server-side only after payment
                succeeds (see server/gift-card-api.mjs). */}
            <div className="lg:sticky lg:top-24">
              <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-4">Preview</p>
              <GiftCardVisual
                amountLabel={fmtGiftCardAmount(amount || 0, form.currency)}
                currency={form.currency}
                code={PLACEHOLDER_CODE}
              />
            </div>
          </div>
        ) : (
          <div className="border border-border p-5">
            <Elements stripe={stripePromiseRef.current} options={{ clientSecret, appearance: getStripeAppearance(theme) }}>
              <StripePaymentForm
                pendingCheckoutId={pendingCheckoutId}
                total={amount}
                formatMoney={(value) => fmtGiftCardAmount(value, form.currency)}
                onSuccess={handleStripeSuccess}
                onError={setRequestError}
                returnPath="/gift-cards"
              />
            </Elements>
          </div>
        )}
      </section>
    </main>
  );
}
