import { useEffect, useRef, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { useApp } from '../context/AppContext';
import { handleImgError } from '../utils/imageFallback';
import { getStripePromise, getStripeAppearance } from '../utils/stripe';
import StripePaymentForm from '../components/StripePaymentForm';
import PaymentBadge from '../components/PaymentBadge';
import { useMagnetic } from '../hooks/useMagnetic';
import CountrySelect from '../components/CountrySelect';
import { getCountryName, getCountryCode, SUPPORTED_SHIPPING_COUNTRIES, isSupportedShippingCountry } from '../data/countries';

// A gift card's remaining balance is shown in its OWN currency here (not
// converted through the shopper's selected display currency/formatMoney) —
// the order summary's actual "Gift card" discount line below already shows
// the USD-equivalent amount being applied to this order, so this is purely
// "here's what's left on the card itself" context, not a second total.
function fmtGiftCardBalance(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'AMD' ? 0 : 2 }).format(Number(value) || 0);
  } catch {
    return `${Number(value || 0).toFixed(2)} ${currency}`;
  }
}

const initialForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  country: 'AM',
  city: '',
  postalCode: '',
  address: '',
  apartment: '',
  deliveryNotes: '',
  deliveryMethod: '',
  // Cash on delivery has been removed — every supported method is an online
  // payment flow, so the form defaults to the primary one (card).
  paymentMethod: 'card',
};

// Card (Stripe) and Cash on Delivery are both real, permanent, production
// payment methods. PayPal/Idram/Telcell remain implemented server-side
// (order-api.mjs still accepts them — see ALLOWED_PAYMENT_METHODS) so the
// backend work isn't thrown away, but they're intentionally not offered to
// customers here: selecting one used to create a real order that reads as
// "confirmed" with no money ever actually collected, which a customer could
// easily mistake for a working payment. Cash on Delivery does not have that
// problem — it never claims to be paid (see order-api.mjs's createOrder,
// which always commits it with paymentStatus 'not_charged') — so it's a
// genuine, always-available option, not a placeholder.
const paymentMethods = [
  { value: 'card', label: 'Visa / Mastercard / American Express', description: 'Pay securely — your card details are entered directly below and never touch our servers.', icon: (
    <span className="flex gap-1">
      <PaymentBadge name="visa" />
      <PaymentBadge name="mastercard" />
      <PaymentBadge name="amex" />
    </span>
  ) },
  { value: 'cash_on_delivery', label: 'Cash on Delivery', description: 'Pay when your order is delivered.', icon: null },
];

// Mirrors server/mailer.mjs's PAYMENT_METHOD_LABELS — used only for the
// order-confirmation screen below.
const PAYMENT_METHOD_DISPLAY_LABELS = {
  card: 'Card',
  cash_on_delivery: 'Cash on Delivery',
};

export default function CheckoutPage() {
  const { cart, cartTotal, formatMoney, clearCart, navigate, visitorCountry, isUnitedStates, updateQuantity, removeFromCart, user, accountFetch, promo, discountAmount, giftCard, giftCardAmount, applyGiftCard, removeGiftCard, theme } = useApp();
  const [form, setForm] = useState(initialForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [order, setOrder] = useState(null);
  const [stripeStatus, setStripeStatus] = useState(null); // 'confirming' | 'failed' | null
  const [clientSecret, setClientSecret] = useState('');
  const [pendingCheckoutId, setPendingCheckoutId] = useState('');
  const submitBtnRef = useMagnetic(3);
  const stripePromiseRef = useRef(null);
  if (!stripePromiseRef.current) stripePromiseRef.current = getStripePromise();
  const countryTouched = useRef(false);

  // The exact text server/order-api.mjs's validateItems() and
  // server/edition-api.mjs's claimEditions() throw when a customer's chosen
  // piece number was taken by someone else's order in the meantime — the
  // backend is the only source of truth for this (see those files' own
  // comments), this is purely how the checkout page reacts once it happens.
  // Since the piece selector itself lives on the product page, "reopening"
  // it here means: drop the now-invalid selection from the cart and send
  // the shopper back to that product to pick a fresh number, rather than
  // silently retrying with a selection that's already known to be gone.
  const EDITION_CONFLICT_MESSAGE = 'THIS PIECE IS NO LONGER AVAILABLE. PLEASE SELECT ANOTHER NUMBER.';
  const [editionConflictProduct, setEditionConflictProduct] = useState(null);
  const handleEditionConflict = () => {
    const affected = cart.filter((item) => item.product?.isLimitedEdition && item.editionNumbers?.length);
    affected.forEach((item) => removeFromCart(item.product.id, item.size, item.color, item.editionNumbers));
    setRequestError(EDITION_CONFLICT_MESSAGE);
    // Stay on this page with the message visible — reopening the selector is
    // a deliberate next click (below), not a silent redirect that could
    // whisk the shopper away before they even read why their cart changed.
    setEditionConflictProduct(affected.length === 1 ? affected[0].product : null);
  };

  // Card is an online payment method that depends on Stripe actually being
  // configured — surfaced clearly up front rather than only after a
  // customer fills in the whole form and submits, and only ever affects the
  // "card" option (Cash on Delivery never needs a payment provider at all,
  // see order-api.mjs's createOrder). `null` = not checked yet (render
  // nothing conclusive), true/false once /api/config has answered.
  // paymentEnv drives a small, honest "Sandbox" indicator only — never fake
  // payment UI — that disappears entirely once the server is configured with
  // PAYMENT_ENV=production (see server/payment-config-guard.mjs).
  const [stripeConfigured, setStripeConfigured] = useState(null);
  const [paymentEnv, setPaymentEnv] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        setStripeConfigured(Boolean(data.stripeConfigured));
        setPaymentEnv(data.paymentEnv || null);
        // Card can't actually be used yet — default to the one payment
        // method that always works, rather than leaving the customer
        // stuck on a selection they can't complete. Only switches the
        // untouched default, never overrides an explicit choice.
        if (!data.stripeConfigured) {
          setForm((prev) => (prev.paymentMethod === 'card' ? { ...prev, paymentMethod: 'cash_on_delivery' } : prev));
        }
      })
      .catch(() => { if (!cancelled) setStripeConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  // Urban Phoenix currently ships only to Armenia and the United States
  // (SUPPORTED_SHIPPING_COUNTRIES) — the country field defaults to the
  // detected visitor's country only when that's actually one of the two we
  // serve; a visitor detected anywhere else keeps the form's own initial
  // default (Armenia) rather than being defaulted into a country we can't
  // ship to. visitorCountry is the same real, already-detected region
  // signal (a real ISO code, or the 'OTHER' sentinel when detection failed
  // entirely — see AppContext.jsx) the announcement bar and free-shipping
  // logic use; this only ever sets the untouched default, never overrides
  // an explicit selection (same guard the saved-address prefill below
  // already uses).
  useEffect(() => {
    if (!visitorCountry || countryTouched.current) return;
    if (!isSupportedShippingCountry(visitorCountry)) return; // not AM/US — nothing real to default to
    setForm((prev) => (countryTouched.current ? prev : { ...prev, country: visitorCountry }));
  }, [visitorCountry]);

  // One key per checkout attempt — a double-click or a client retry after a
  // dropped response reuses this same key so the server can no-op instead of
  // creating a second order. Only used for the direct (non-card) flow — the
  // card flow gets equivalent protection from pendingCheckoutId instead.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  // Redeeming points is opt-in (a checkbox, not automatic) even though the
  // Rewards page advertises it as "applied automatically" — a discount that
  // silently spends a customer's points without them choosing to would be
  // the wrong kind of automatic.
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [useLoyaltyPoints, setUseLoyaltyPoints] = useState(false);
  useEffect(() => {
    if (!user) return;
    accountFetch('/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setLoyaltyPoints(data.loyaltyPoints || 0))
      .catch(() => {});
  }, [user]);

  // Delivery methods (and their prices) are always fetched from the server
  // (server/delivery.mjs, the single centralized source of delivery pricing)
  // — this component never hardcodes a zone rule or a price itself. This is
  // a live preview only; the order itself is priced again, independently,
  // from the same module at order-creation time — a tampered client-side
  // value here can never change what actually gets charged.
  const [deliveryMethods, setDeliveryMethods] = useState([]);
  const [deliveryMethodsLoading, setDeliveryMethodsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setDeliveryMethodsLoading(true);
    const params = new URLSearchParams({ country: form.country, city: form.city, subtotal: String(cartTotal) });
    fetch(`/api/delivery-methods?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const methods = data.methods || [];
        setDeliveryMethods(methods);
        // Keep the current selection if it's still offered for this
        // address/subtotal; otherwise fall back to the zone's first
        // (standard) method rather than leaving nothing selected.
        setForm((prev) => (methods.some((m) => m.id === prev.deliveryMethod) ? prev : { ...prev, deliveryMethod: methods[0]?.id || '' }));
      })
      .catch(() => { if (!cancelled) setDeliveryMethods([]); })
      .finally(() => { if (!cancelled) setDeliveryMethodsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.country, form.city, cartTotal]);

  const selectedDeliveryMethod = deliveryMethods.find((m) => m.id === form.deliveryMethod) || null;
  const shipping = selectedDeliveryMethod?.cost || 0;
  // Client-side preview only — mirrors server/loyalty.mjs's redemption math
  // exactly (100 points per $5, rounded down to a whole unit), but the
  // server is authoritative on both the customer's real balance and the
  // final charge.
  const loyaltyPointsValue = Math.floor(loyaltyPoints / 100) * 5;
  const preLoyaltyTotal = Math.max(0, cartTotal - discountAmount - giftCardAmount) + shipping;
  const loyaltyDiscount = useLoyaltyPoints
    ? Math.min(loyaltyPointsValue, Math.floor(preLoyaltyTotal / 5) * 5)
    : 0;
  const total = preLoyaltyTotal - loyaltyDiscount;

  const buildOrderPayload = () => ({
    region: visitorCountry,
    regionalPricing: isUnitedStates,
    customer: {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      country: form.country,
      city: form.city,
      postalCode: form.postalCode,
      address: form.address,
      apartment: form.apartment || undefined,
      deliveryNotes: form.deliveryNotes || undefined,
    },
    deliveryMethod: form.deliveryMethod,
    paymentMethod: form.paymentMethod,
    promoCode: promo?.code || undefined,
    giftCardCode: giftCard?.code || undefined,
    useLoyaltyPoints,
    items: cart.map((item) => ({
      productId: item.product.id,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      editionNumbers: item.editionNumbers || [],
    })),
  });

  // If the shopper edits their cart/promo/shipping-affecting fields after
  // the embedded card form is already showing, the PaymentIntent's amount
  // must be kept in sync — otherwise Stripe would charge a stale total.
  useEffect(() => {
    if (!clientSecret || !pendingCheckoutId) return;
    const controller = new AbortController();
    fetch(`/api/checkout/payment-intent/${encodeURIComponent(pendingCheckoutId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOrderPayload()),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSecret, pendingCheckoutId, cartTotal, discountAmount, giftCardAmount, shipping, form.deliveryMethod, useLoyaltyPoints]);

  // Returning from a 3D-Secure redirect (return_url points back here with
  // ?stripe=return&pendingCheckoutId=...). Most cards never need this —
  // stripe.confirmPayment() resolves inline — but some do require leaving
  // the page. The order itself is only real once this (or the webhook)
  // independently confirms the PaymentIntent with Stripe, never from the
  // redirect alone.
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
        const res = await fetch(`/api/checkout/payment-intent/${encodeURIComponent(id)}/status`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not confirm payment.');
        if (data.status === 'succeeded') {
          clearCart();
          setStripeStatus(null);
          const orderNumber = data.order?.orderNumber || '';
          if (orderNumber) await fetchOrderForDisplay(orderNumber, 'Your payment was successful and your order has been confirmed.');
          else setOrder({ orderNumber: '', message: 'Your payment was successful and your order has been confirmed.' });
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

  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      firstName: prev.firstName || user.firstName || '',
      lastName: prev.lastName || user.lastName || '',
      email: user.email,
      phone: prev.phone || user.phone || '',
    }));
    // Prefill delivery details from the customer's default saved address, if any.
    accountFetch('/addresses')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const defaultAddress = (data.addresses || []).find((a) => a.isDefault);
        if (!defaultAddress) return;
        setForm((prev) => ({
          ...prev,
          firstName: prev.firstName || defaultAddress.firstName,
          lastName: prev.lastName || defaultAddress.lastName,
          phone: prev.phone || defaultAddress.phone,
          // defaultAddress.country is a real ISO code for any address saved
          // since CountrySelect replaced the old 5-option list — but an
          // address saved before that is still a full-name string (e.g.
          // "Armenia", or even a since-unsupported one like "France"), never
          // rewritten. Resolve either shape to a code, but only actually use
          // it as the checkout default when it's one of the countries we
          // still ship to — a saved address for a country we no longer
          // serve must not silently become the checkout default.
          country: (() => {
            if (countryTouched.current) return prev.country;
            const resolved = isSupportedShippingCountry(defaultAddress.country)
              ? (defaultAddress.country.length === 2 ? defaultAddress.country.toUpperCase() : getCountryCode(defaultAddress.country))
              : null;
            return resolved || prev.country;
          })(),
          city: prev.city || defaultAddress.city,
          postalCode: prev.postalCode || defaultAddress.postalCode,
          address: prev.address || defaultAddress.address,
          apartment: prev.apartment || defaultAddress.apartment || '',
        }));
      })
      .catch(() => {});
  }, [user]);
  const [giftCardInput, setGiftCardInput] = useState('');
  const [giftCardError, setGiftCardError] = useState('');
  const [giftCardChecking, setGiftCardChecking] = useState(false);

  const applyGiftCardCode = async () => {
    if (!giftCardInput.trim() || giftCardChecking) return;
    setGiftCardChecking(true);
    setGiftCardError('');
    const result = await applyGiftCard(giftCardInput);
    if (!result.ok) setGiftCardError(result.error);
    setGiftCardChecking(false);
  };

  const removeGiftCardCode = () => {
    removeGiftCard();
    setGiftCardInput('');
    setGiftCardError('');
  };

  const update = (event) => {
    const { name, value } = event.target;
    if (name === 'country') countryTouched.current = true;
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: '' }));
    setRequestError('');
    setEditionConflictProduct(null);
    // Switching payment method away from a started card form discards it —
    // switching back later starts a fresh PaymentIntent with current totals.
    if (name === 'paymentMethod' && value !== 'card') {
      setClientSecret('');
      setPendingCheckoutId('');
    }
  };

  const validate = () => {
    const errors = {};
    // postalCode is optional (not every address needs one — see server/
    // order-api.mjs's validateCustomer, which matches this exactly).
    ['firstName', 'lastName', 'email', 'phone', 'country', 'city', 'address'].forEach((name) => {
      if (!form[name].trim()) errors[name] = 'Required';
    });
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Enter a valid email';
    }
    if (!form.deliveryMethod) errors.deliveryMethod = 'Please select a delivery method';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Fetches the full, server-authoritative order (items, delivery, totals —
  // the same shape TrackOrderPage already renders from, see order-api.mjs's
  // trackOrder/serializeOrder) for the confirmation screen below, rather than
  // relying on local cart/form state — which may be stale or already cleared
  // by the time a 3D-Secure redirect brings the shopper back to this page.
  const fetchOrderForDisplay = async (orderNumber, message) => {
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(orderNumber)}`);
      const data = await res.json();
      if (res.ok && data.order) {
        setOrder({ ...data.order, message });
        return;
      }
    } catch {
      // fall through to the minimal fallback below
    }
    setOrder({ orderNumber, message });
  };

  const handleStripeSuccess = async () => {
    // The PaymentIntent just succeeded client-side; ask our own backend to
    // independently verify with the payment provider and commit the order
    // (same endpoint the 3DS-return flow uses) rather than trusting the
    // client alone — the order is only ever shown as confirmed once this
    // server-side verification has actually happened.
    try {
      const res = await fetch(`/api/checkout/payment-intent/${encodeURIComponent(pendingCheckoutId)}/status`);
      const data = await res.json();
      clearCart();
      const orderNumber = data.order?.orderNumber || '';
      if (orderNumber) await fetchOrderForDisplay(orderNumber, 'Your payment was successful and your order has been confirmed.');
      else setOrder({ orderNumber: '', message: 'Your payment was successful. Your order confirmation will follow shortly.' });
    } catch {
      clearCart();
      setOrder({ orderNumber: '', message: 'Your payment was successful. Your order confirmation will follow shortly.' });
    }
  };

  const startCardPayment = async () => {
    setIsSubmitting(true);
    setRequestError('');
    setEditionConflictProduct(null);
    try {
      const response = await fetch('/api/checkout/payment-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {}),
        },
        body: JSON.stringify(buildOrderPayload()),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === EDITION_CONFLICT_MESSAGE) { handleEditionConflict(); return; }
        throw new Error(data.error || 'Could not start card checkout.');
      }
      setClientSecret(data.clientSecret);
      setPendingCheckoutId(data.pendingCheckoutId);
    } catch (error) {
      setRequestError(error.message || 'Could not start card checkout. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    // The stripeConfigured check only ever blocks the "card" method —
    // defense-in-depth alongside the disabled submit button below (e.g. a
    // form-level Enter-key submit); the real enforcement is server-side
    // (createPayment returns 503 when Stripe isn't configured). Cash on
    // Delivery never depends on Stripe at all and must never be blocked by
    // this check.
    const cardUnavailable = form.paymentMethod === 'card' && stripeConfigured === false;
    if (!validate() || isSubmitting || !cart.length || cardUnavailable) return;

    if (form.paymentMethod === 'card') {
      // The embedded Stripe form (rendered once clientSecret is set) has its
      // own submit button that actually confirms the payment — this button's
      // only job is to validate the order details first and reveal it.
      if (!clientSecret) await startCardPayment();
      return;
    }

    setIsSubmitting(true);
    setRequestError('');
    setEditionConflictProduct(null);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {}),
        },
        body: JSON.stringify({ ...buildOrderPayload(), idempotencyKey: idempotencyKeyRef.current }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (data.error === EDITION_CONFLICT_MESSAGE) { handleEditionConflict(); return; }
        throw new Error(data.error || 'Order could not be completed.');
      }

      clearCart();
      // Fetch the full, server-authoritative order (items, delivery,
      // payment method) for the confirmation screen — successBody() (what
      // `data` is here) only carries totals, not line items/customer, since
      // it's also used for orders that aren't confirmed yet.
      await fetchOrderForDisplay(data.orderNumber, data.message);
      idempotencyKeyRef.current = crypto.randomUUID();
    } catch (error) {
      setRequestError(error.message || 'Order could not be completed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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

  if (order) {
    return (
      <main className="pt-[var(--site-header-h,68px)] min-h-screen">
        <section className="max-w-3xl mx-auto px-6 py-16">
          <div className="checkout-success text-center mb-12" role="status">
            <p className="text-accent font-mono uppercase tracking-widest mb-5">Order confirmed</p>
            <h1 className="font-display font-black text-5xl uppercase mb-4">Thank You</h1>
            <p className="text-muted mb-2">
              {order.orderNumber ? <>Order <strong className="text-fg">{order.orderNumber}</strong> has been created successfully.</> : 'Your order has been created successfully.'}
            </p>
            <p className="text-sm text-muted">{order.message}</p>
          </div>

          {Array.isArray(order.items) && order.items.length > 0 && (
            <div className="border border-border p-6 space-y-6">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-widest text-muted mb-3">Items</p>
                <div className="space-y-3">
                  {order.items.map((item, index) => (
                    <div key={`${item.productId}-${item.size}-${index}`} className="flex gap-4">
                      {item.image && <img src={item.image} onError={handleImgError} alt="" className="w-14 h-18 up-photo object-cover" />}
                      <div className="flex-1">
                        <p className="text-sm">{item.name}</p>
                        <p className="text-xs text-muted">Size: {item.size} · Qty {item.quantity}</p>
                        {item.isLimitedEdition && item.editionNumbers?.length > 0 && (
                          <p className="text-xs font-mono uppercase tracking-widest text-accent mt-1">
                            {item.editionNumbers.length > 1
                              ? `You Own ${item.editionNumbers.map((n) => `${String(n).padStart(3, '0')}/${String(item.editionTotal || 100).padStart(3, '0')}`).join(', ')}`
                              : `You Own ${String(item.editionNumbers[0]).padStart(3, '0')}/${String(item.editionTotal || 100).padStart(3, '0')}.`}
                          </p>
                        )}
                      </div>
                      <p className="text-sm">{formatMoney(item.lineTotal, { regional: false })}</p>
                    </div>
                  ))}
                </div>
              </div>

              {order.deliveryMethod && (
                <div className="border-t border-border pt-5">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-muted mb-2">Delivery</p>
                  <p className="text-sm">
                    {order.customer?.address}{order.customer?.apartment ? `, ${order.customer.apartment}` : ''}<br />
                    {order.customer?.city}{order.customer?.postalCode ? `, ${order.customer.postalCode}` : ''}<br />
                    {getCountryName(order.customer?.country)}
                  </p>
                  {/* The exact estimate this order was actually promised at
                      checkout (server/order-api.mjs snapshots it at commit
                      time) — never re-derived here, so it can't drift from
                      what the customer was told when they placed the order. */}
                  {order.deliveryEstimate && (
                    <p className="text-sm text-accent mt-2">{order.deliveryEstimate}</p>
                  )}
                </div>
              )}

              {order.paymentMethod && (
                <div className="border-t border-border pt-5">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-muted mb-2">Payment method</p>
                  <p className="text-sm">{PAYMENT_METHOD_DISPLAY_LABELS[order.paymentMethod] || order.paymentMethod}</p>
                </div>
              )}

              <div className="border-t border-border pt-5 flex justify-between text-xl">
                <span>Total</span>
                <span>{formatMoney(order.total, { regional: false })}</span>
              </div>
            </div>
          )}

          <div className="text-center mt-10">
            <button onClick={() => navigate('shop')} className="btn-primary px-8 py-4 uppercase text-xs tracking-widest">
              Continue Shopping
            </button>
          </div>
        </section>
      </main>
    );
  }

  const showEmbeddedCardForm = form.paymentMethod === 'card' && clientSecret;

  return (
    <main className="pt-[var(--site-header-h,68px)] min-h-screen">
      <section className="max-w-7xl mx-auto px-6 py-16">
        <h1 className="font-display font-black text-5xl uppercase mb-12">Checkout</h1>

        {stripeStatus === 'failed' && (
          <div className="checkout-error mb-8" role="alert">
            We couldn't confirm your payment. If you were charged, contact us with your bank statement — otherwise, please try again.
          </div>
        )}

        {/* Only relevant while "card" is selected — Cash on Delivery is
            always available regardless of Stripe's configuration state. Told
            up front, not discovered only after filling in the whole form —
            and the submit button below is disabled for the same reason, so
            this can't be missed and clicked through anyway. */}
        {form.paymentMethod === 'card' && stripeConfigured === false && (
          <div className="checkout-error mb-8" role="alert">
            Online card payment isn't available right now. Please select Cash on Delivery, or check back shortly.
          </div>
        )}

        {/* Honest, non-fake indicator only — reflects the server's actual
            PAYMENT_ENV, never a simulated/fake payment path. Automatically
            disappears once the server is configured with PAYMENT_ENV=production. */}
        {paymentEnv === 'sandbox' && (
          <div className="sandbox-banner mb-8">Sandbox payment environment — no real charge will occur</div>
        )}

        {/* Rendered here (outside the cart-empty/form branch below) because a
            piece-number conflict removes the now-invalid item from the cart
            as part of surfacing this error — if the cart was down to just
            that one item, it goes empty at the same moment, and this message
            must still be visible rather than getting replaced by the
            "cart is empty" view below. */}
        {requestError && (
          <div className="checkout-error mb-8" role="alert">
            <p>{requestError}</p>
            {editionConflictProduct && (
              <button
                type="button"
                onClick={() => navigate('product', editionConflictProduct)}
                className="mt-2 text-[11px] font-mono uppercase tracking-widest text-accent underline underline-offset-2"
              >
                Select another number →
              </button>
            )}
          </div>
        )}

        {!cart.length ? (
          <button onClick={() => navigate('shop')} className="underline">
            Your cart is empty — continue shopping
          </button>
        ) : (
          <form onSubmit={submit} noValidate className="grid lg:grid-cols-[1fr_420px] gap-12">
            <div className="space-y-10">
              <fieldset>
                <legend className="text-sm font-mono uppercase tracking-widest mb-5">Contact</legend>
                <div className="grid sm:grid-cols-2 gap-4">
                  <CheckoutInput name="firstName" placeholder="First name" value={form.firstName} error={fieldErrors.firstName} onChange={update} />
                  <CheckoutInput name="lastName" placeholder="Last name" value={form.lastName} error={fieldErrors.lastName} onChange={update} />
                  <CheckoutInput name="email" type="email" placeholder="Email" value={form.email} error={fieldErrors.email} onChange={update} className="sm:col-span-2" disabled={Boolean(user)} />
                  {user && <p className="text-xs text-muted sm:col-span-2 -mt-3">Signed in as {user.email}. Orders placed with this email appear in your account.</p>}
                  <CheckoutInput name="phone" type="tel" placeholder="Phone" value={form.phone} error={fieldErrors.phone} onChange={update} className="sm:col-span-2" />
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-mono uppercase tracking-widest mb-5">Delivery address</legend>
                <div className="grid sm:grid-cols-2 gap-4">
                  <label className="sm:col-span-2">
                    <span className="sr-only">Country</span>
                    <CountrySelect
                      name="country"
                      value={form.country}
                      onChange={(code) => update({ target: { name: 'country', value: code } })}
                      countries={SUPPORTED_SHIPPING_COUNTRIES}
                    />
                  </label>
                  <CheckoutInput name="city" placeholder="City" value={form.city} error={fieldErrors.city} onChange={update} />
                  <CheckoutInput name="postalCode" placeholder="Postal code (optional)" value={form.postalCode} error={fieldErrors.postalCode} onChange={update} />
                  <CheckoutInput name="address" placeholder="Street address" value={form.address} error={fieldErrors.address} onChange={update} className="sm:col-span-2" />
                  <CheckoutInput name="apartment" placeholder="Apartment / building (optional)" value={form.apartment} onChange={update} />
                  <CheckoutInput name="deliveryNotes" placeholder="Delivery notes (optional)" value={form.deliveryNotes} onChange={update} />
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-mono uppercase tracking-widest mb-5">Delivery method</legend>
                {fieldErrors.deliveryMethod && <p className="checkout-field-error mb-3">{fieldErrors.deliveryMethod}</p>}
                <div className="space-y-3">
                  {deliveryMethodsLoading && !deliveryMethods.length && (
                    <p className="text-sm text-muted">Loading delivery options…</p>
                  )}
                  {deliveryMethods.map((method) => (
                    <label key={method.id} className={`checkout-delivery-option ${form.deliveryMethod === method.id ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="deliveryMethod"
                        checked={form.deliveryMethod === method.id}
                        onChange={() => setForm((prev) => ({ ...prev, deliveryMethod: method.id }))}
                        disabled={isSubmitting}
                      />
                      <span className="flex-1">
                        <strong className="block text-sm font-medium">{method.label}</strong>
                        <small className="block mt-1 text-xs text-muted">{method.description}</small>
                      </span>
                      <span className="text-sm font-mono">{method.cost ? formatMoney(method.cost, { regional: false }) : 'Free'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-mono uppercase tracking-widest mb-5">Payment method</legend>
                <div className="space-y-3">
                  {paymentMethods.map((method) => (
                    <label key={method.value} className={`checkout-payment ${form.paymentMethod === method.value ? 'is-selected' : ''}`}>
                      <input type="radio" name="paymentMethod" value={method.value} checked={form.paymentMethod === method.value} onChange={update} disabled={isSubmitting} />
                      <span className="checkout-payment__icon" aria-hidden="true">{method.icon}</span>
                      <span>
                        <strong>{method.label}</strong>
                        <small>{method.description}</small>
                      </span>
                    </label>
                  ))}
                </div>

                {showEmbeddedCardForm && (
                  <div className="mt-5 border border-border p-5">
                    <Elements stripe={stripePromiseRef.current} options={{ clientSecret, appearance: getStripeAppearance(theme) }}>
                      <StripePaymentForm
                        pendingCheckoutId={pendingCheckoutId}
                        total={total}
                        formatMoney={formatMoney}
                        onSuccess={handleStripeSuccess}
                        onError={setRequestError}
                      />
                    </Elements>
                  </div>
                )}
              </fieldset>
            </div>

            <aside className="border border-border p-6 h-fit lg:sticky lg:top-24">
              <h2 className="font-display font-bold uppercase text-xl mb-6">Order summary</h2>
              <div className="space-y-4">
                {cart.map((item) => (
                  <div key={`${item.product.id}-${item.size}-${item.color}-${(item.editionNumbers || []).join(',')}`} className="flex gap-4">
                    <img src={item.product.images[0]} onError={handleImgError} alt="" className="w-16 h-20 up-photo object-cover" />
                    <div className="flex-1">
                      <p>{item.product.name}</p>
                      <p className="text-xs text-muted">{item.size} / {item.color}</p>
                      {item.editionNumbers?.length > 0 && (
                        <p className="checkout-editions">Piece {item.editionNumbers.map((number) => String(number).padStart(3, '0')).join(', ')} / {String(item.product.limitedEditionTotal || 100).padStart(3, '0')}</p>
                      )}
                      {item.editionNumbers?.length > 0 ? (
                        <p className="text-xs text-muted mt-1">Qty {item.quantity} — fixed for limited editions</p>
                      ) : (
                        <div className="checkout-quantity">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.product.id, item.size, item.color, item.quantity - 1, item.editionNumbers)}
                            aria-label={`Decrease ${item.product.name} quantity`}
                          >−</button>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={item.quantity}
                            onChange={(event) => updateQuantity(
                              item.product.id,
                              item.size,
                              item.color,
                              Math.min(100, Math.max(1, Number(event.target.value) || 1)),
                              item.editionNumbers,
                            )}
                            aria-label={`${item.product.name} quantity`}
                          />
                          <button
                            type="button"
                            disabled={item.quantity >= 100}
                            onClick={() => updateQuantity(item.product.id, item.size, item.color, item.quantity + 1, item.editionNumbers)}
                            aria-label={`Increase ${item.product.name} quantity`}
                          >+</button>
                        </div>
                      )}
                    </div>
                    <p>{formatMoney(item.product.price * item.quantity)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-border mt-6 pt-5">
                {/* Promo code entry lives on the Cart page only (avoids a
                    second, redundant entry point and any risk of applying
                    two codes) — an already-applied promo's discount still
                    flows through from AppContext into the totals below and
                    the order payload untouched. */}
                {giftCard ? (
                  <div className="checkout-promo-applied flex items-center justify-between text-sm mb-4">
                    <span>
                      Gift card <strong>{giftCard.code}</strong> applied
                      {giftCard.currency && giftCard.balance != null && (
                        <span className="text-muted"> ({fmtGiftCardBalance(giftCard.balance, giftCard.currency)} balance)</span>
                      )}
                    </span>
                    <button type="button" onClick={removeGiftCardCode} className="underline text-muted hover:text-fg">Remove</button>
                  </div>
                ) : (
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={giftCardInput}
                      onChange={(event) => { setGiftCardInput(event.target.value); setGiftCardError(''); }}
                      placeholder="Gift card code"
                      className="up-input flex-1"
                      style={{ textTransform: 'uppercase' }}
                    />
                    <button
                      type="button"
                      onClick={applyGiftCardCode}
                      disabled={giftCardChecking || !giftCardInput.trim()}
                      className="border border-border px-5 uppercase text-xs tracking-widest disabled:opacity-50"
                    >
                      {giftCardChecking ? '…' : 'Apply'}
                    </button>
                  </div>
                )}
                {giftCardError && <p className="checkout-error mb-4" role="alert">{giftCardError}</p>}

                {user && loyaltyPointsValue > 0 && (
                  <label className="flex items-center justify-between gap-3 text-sm cursor-pointer mb-4">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={useLoyaltyPoints}
                        onChange={(event) => setUseLoyaltyPoints(event.target.checked)}
                        className="accent-accent"
                      />
                      Use my {loyaltyPoints} points for {formatMoney(loyaltyPointsValue, { regional: false })} off
                    </span>
                  </label>
                )}
              </div>

              <div className="border-t border-border pt-5 space-y-3">
                <div key={`subtotal-${cartTotal}`} className="flex justify-between text-muted"><span>Subtotal</span><span>{formatMoney(cartTotal, { regional: false })}</span></div>
                {discountAmount > 0 && (
                  <div key={`discount-${discountAmount}`} className="flex justify-between text-accent"><span>Discount</span><span>−{formatMoney(discountAmount, { regional: false })}</span></div>
                )}
                {giftCardAmount > 0 && (
                  <div key={`giftcard-${giftCardAmount}`} className="flex justify-between text-accent"><span>Gift card</span><span>−{formatMoney(giftCardAmount, { regional: false })}</span></div>
                )}
                {loyaltyDiscount > 0 && (
                  <div key={`loyalty-${loyaltyDiscount}`} className="flex justify-between text-accent"><span>Rewards points</span><span>−{formatMoney(loyaltyDiscount, { regional: false })}</span></div>
                )}
                <div key={`shipping-${shipping}`} className="flex justify-between text-muted">
                  <span>
                    {selectedDeliveryMethod?.label || 'Delivery'}
                    {selectedDeliveryMethod?.description && (
                      <span className="block text-xs text-muted/70 mt-0.5">{selectedDeliveryMethod.description}</span>
                    )}
                  </span>
                  <span>{shipping ? formatMoney(shipping, { regional: false }) : 'FREE'}</span>
                </div>
                {/* key={total}: this row's text silently failed to commit
                    DOM updates on state-driven re-renders (isolated and
                    confirmed via the same pattern on ShopPage's result count)
                    even though render always computed the right total —
                    forcing a remount when the value changes sidesteps it. */}
                <div key={total} className="flex justify-between text-xl"><span>Total</span><span>{formatMoney(total, { regional: false })}</span></div>
              </div>

              {/* requestError itself is surfaced once, above (outside this
                  form) — see that block's own comment for why it has to live
                  there instead of here. */}

              {!showEmbeddedCardForm && (
                <button
                  ref={submitBtnRef}
                  type="submit"
                  disabled={isSubmitting || (form.paymentMethod === 'card' && stripeConfigured === false)}
                  className={`checkout-submit magnetic-btn w-full btn-primary py-4 uppercase text-xs tracking-[.2em] mt-7 disabled:opacity-50 ${isSubmitting ? 'is-processing' : ''}`}
                >
                  {isSubmitting ? 'Processing…' : form.paymentMethod === 'card' ? 'Continue to Payment' : 'Complete order'}
                </button>
              )}
            </aside>
          </form>
        )}
      </section>
    </main>
  );
}

function CheckoutInput({ name, value, error, onChange, className = '', type = 'text', placeholder, disabled = false }) {
  return (
    <label className={className}>
      <span className="sr-only">{placeholder}</span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`up-input ${error ? 'has-error' : ''} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error && <span id={`${name}-error`} className="checkout-field-error">{error}</span>}
    </label>
  );
}
