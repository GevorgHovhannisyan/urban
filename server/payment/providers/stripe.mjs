// Stripe payment provider — the ONLY file in this codebase that talks to the
// Stripe SDK directly. Every other module (paymentService.mjs, order-api.mjs,
// app.mjs) goes through server/payment/paymentService.mjs instead, so
// swapping or adding a payment provider later means writing one new file
// here with the same shape and pointing paymentService.mjs at it — nothing
// in checkout/order/delivery code has to change.
//
// PROVIDER INTERFACE — every provider module under server/payment/providers/
// must implement this same shape:
//   isConfigured(): boolean
//   isWebhookConfigured(): boolean
//   getPublishableKey(): string|null            — public-safe key sent to the browser
//   describeConfig(): { status: 'unconfigured'|'partial'|'configured', message }
//   createIntent({ amountCents, currency, metadata, receiptEmail }): Promise<{ providerReference, clientSecret }>
//   updateIntentAmount(providerReference, amountCents): Promise<void>
//   constructWebhookEvent(rawBody, signature): Event   — throws on an invalid/forged signature; reads its own webhook secret internally
//   parseSucceededEvent(event): { providerReference, metadata }|null — null if this event isn't a "payment succeeded" event
//   retrieveIntentStatus(providerReference): Promise<'requires_payment_method'|'requires_action'|'processing'|'succeeded'|'canceled'|string>
//
// Sandbox vs production is Stripe's own native distinction: an `sk_test_...`
// / `pk_test_...` key pair talks to Stripe's real test-mode API (no live
// charges are ever possible with a test key); an `sk_live_...` / `pk_live_...`
// pair talks to the real live API. There is no separate "fake" sandbox here —
// this is the exact same integration Stripe runs in both environments, which
// is what makes sandbox testing here representative of real production
// behavior. See server/payment-config-guard.mjs for the startup check that
// keeps PAYMENT_ENV and the configured key type from ever silently disagreeing.
import Stripe from 'stripe';

let stripeClient = null;
function getClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);
}

export function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}

// True for a live secret key (sk_live_...) — used only by the boot-time
// config guard to catch a sandbox/production key mismatch before it can ever
// cause a real charge during testing, or a test-mode-only charge in
// production. Never used to decide checkout behavior itself.
export function isLiveKey(key) {
  return /^sk_live_/.test(String(key || ''));
}
export function isTestKey(key) {
  return /^sk_test_/.test(String(key || ''));
}

// Diagnostic-only (never throws, never blocks startup by itself — see
// payment-config-guard.mjs for the boot-time check that does enforce this).
// Distinguishes "not set up at all" from "partially set up," since the
// latter is the more dangerous state to leave unnoticed: SECRET_KEY +
// PUBLISHABLE_KEY without WEBHOOK_SECRET means card checkouts can start
// (PaymentIntents get created) but the webhook that's supposed to confirm
// them can never verify its signature — the poll-fallback in paymentService's
// getPaymentStatus still covers that specific case, but it's worth surfacing
// at startup rather than only discovering it when a real order gets stuck.
export function describeConfig() {
  const hasSecret = Boolean(process.env.STRIPE_SECRET_KEY);
  const hasPublishable = Boolean(process.env.STRIPE_PUBLISHABLE_KEY);
  const hasWebhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  if (!hasSecret && !hasPublishable && !hasWebhookSecret) {
    return { status: 'unconfigured', message: 'Stripe is not configured — card payment is unavailable; checkout clearly reports this instead of silently falling back to another method.' };
  }
  const missing = [
    !hasSecret && 'STRIPE_SECRET_KEY',
    !hasPublishable && 'STRIPE_PUBLISHABLE_KEY',
    !hasWebhookSecret && 'STRIPE_WEBHOOK_SECRET',
  ].filter(Boolean);
  if (missing.length) {
    return { status: 'partial', message: `Stripe is partially configured — missing ${missing.join(', ')}. Card payment will not work correctly until all three are set.` };
  }
  const mode = isLiveKey(process.env.STRIPE_SECRET_KEY) ? 'live' : 'test';
  return { status: 'configured', message: `Stripe is fully configured (secret key, publishable key, webhook secret all present; key mode: ${mode}).` };
}

export async function createIntent({ amountCents, currency, metadata, receiptEmail }) {
  const stripe = getClient();
  if (!stripe) throw new Error('Stripe is not configured.');
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    automatic_payment_methods: { enabled: true },
    receipt_email: receiptEmail,
    metadata,
  });
  return { providerReference: intent.id, clientSecret: intent.client_secret };
}

export async function updateIntentAmount(providerReference, amountCents) {
  const stripe = getClient();
  if (!stripe) throw new Error('Stripe is not configured.');
  await stripe.paymentIntents.update(providerReference, { amount: amountCents });
}

export async function retrieveIntentStatus(providerReference) {
  const stripe = getClient();
  if (!stripe) throw new Error('Stripe is not configured.');
  const intent = await stripe.paymentIntents.retrieve(providerReference);
  return intent.status;
}

export function isWebhookConfigured() {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

// Throws on an invalid/forged signature — callers must not treat a thrown
// error as anything other than "reject this request," never fall back to
// trusting the unverified payload. The webhook secret is this provider's own
// concern (its own env var) — callers never read or pass it themselves.
export function constructWebhookEvent(rawBody, signature) {
  const stripe = getClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook is not configured.');
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

// Returns null for any event type this integration doesn't treat as "payment
// succeeded" (e.g. payment_intent.payment_failed) — the caller acknowledges
// those with 200 anyway (see paymentService.handleWebhook) so Stripe stops
// retrying them, but never acts on them.
export function parseSucceededEvent(event) {
  if (event.type !== 'payment_intent.succeeded') return null;
  const intent = event.data.object;
  return { providerReference: intent.id, metadata: intent.metadata || {} };
}
