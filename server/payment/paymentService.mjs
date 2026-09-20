// Provider-agnostic payment orchestration. This is the ONLY payment-related
// module order-api.mjs and server/app.mjs are allowed to import from —
// neither of them (nor any checkout/delivery/cart code) ever references a
// specific provider or the Stripe SDK directly. Swapping the payment
// provider later, or adding a second one, means writing a new module under
// server/payment/providers/ with the same shape as providers/stripe.mjs and
// pointing PROVIDERS/PROVIDER_NAME below at it — nothing in this file's
// callers has to change.
//
// Environment:
//   PAYMENT_PROVIDER — which provider module to use (default: 'stripe')
//   PAYMENT_ENV       — 'sandbox' (default) or 'production'; see
//                        server/payment-config-guard.mjs for the boot-time
//                        check that keeps this in sync with the actual
//                        provider credentials configured (e.g. refuses to
//                        boot with a live Stripe key while PAYMENT_ENV=sandbox,
//                        or a test key while PAYMENT_ENV=production).
import { randomUUID } from 'node:crypto';
import { get, run, toJson, fromJson } from '../db.mjs';
import { validateOrderDraft, completePayment as completeOrderPayment } from '../order-api.mjs';
import { validateGiftCardPurchaseDraft, completeGiftCardPurchase } from '../gift-card-api.mjs';
import { RATES } from '../../src/data/currency.js';
import * as stripeProvider from './providers/stripe.mjs';

const PROVIDERS = { stripe: stripeProvider };
const PROVIDER_NAME = (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase();
const provider = PROVIDERS[PROVIDER_NAME];
if (!provider) {
  throw new Error(`Unknown PAYMENT_PROVIDER "${PROVIDER_NAME}" — no provider module is registered for it in server/payment/paymentService.mjs.`);
}

export function getProviderName() {
  return PROVIDER_NAME;
}

export function getPaymentEnv() {
  const value = (process.env.PAYMENT_ENV || 'sandbox').toLowerCase();
  return value === 'production' ? 'production' : 'sandbox';
}

export function isPaymentConfigured() {
  return provider.isConfigured();
}

export function getPaymentPublicKey() {
  return provider.getPublishableKey();
}

export function describePaymentConfig() {
  return provider.describeConfig();
}

// Creates a PaymentIntent (or equivalent) for an embedded card form on our
// own checkout page — no redirect to the provider's site. The order is NOT
// created yet: only a `pending_checkouts` row holding the validated draft
// (real server-side prices, verified promo code, computed delivery cost).
// The order is only committed once the provider confirms the payment
// actually succeeded, via the webhook below (or its fallback verification
// path) — never from the client's confirmation call alone, which a modified
// client could fake.
export async function createPayment(payload) {
  if (!provider.isConfigured()) {
    // Deliberately does not suggest "choose another payment method" — the
    // other listed methods (PayPal/Idram/Telcell) are unconnected
    // placeholders, not real fallbacks. Failing clearly here, rather than
    // implying a working alternative exists, is the point.
    return { status: 503, body: { error: 'Online payment is not available right now. Please try again shortly.' } };
  }

  const draftResult = await validateOrderDraft({ ...payload, paymentMethod: 'card' });
  if (draftResult.error) return { status: 400, body: { error: draftResult.error } };
  const draft = draftResult.value;

  const amountInCents = Math.round(draft.total * 100);
  if (amountInCents < 50) {
    // Providers generally reject charges below ~$0.50; this is really just a
    // safety net — the storefront's minimum product price is well above this.
    return { status: 400, body: { error: 'Order total is too small to charge online. Please add another item.' } };
  }

  const pendingId = randomUUID();
  await run(`INSERT INTO pending_checkouts (id, draft, status) VALUES (?, ?, 'pending')`, [pendingId, toJson(draft)]);

  let intent;
  try {
    intent = await provider.createIntent({
      amountCents: amountInCents,
      currency: 'usd',
      metadata: { pendingCheckoutId: pendingId },
      receiptEmail: draft.customer.email,
    });
  } catch (error) {
    await run(`UPDATE pending_checkouts SET status = 'expired' WHERE id = ?`, [pendingId]);
    return { status: 502, body: { error: 'Could not start card checkout. Please try again.' } };
  }

  await run(`UPDATE pending_checkouts SET paymentIntentId = ? WHERE id = ?`, [intent.providerReference, pendingId]);
  return { status: 200, body: { clientSecret: intent.clientSecret, pendingCheckoutId: pendingId, total: draft.total } };
}

// Mirrors createPayment() above, but for a customer purchasing a gift card
// instead of checking out a cart — same "validate, stash a pending row,
// create the provider intent, only ever materialize the real record once the
// provider confirms payment" shape, just pointed at gift_cards instead of
// orders.
export async function createGiftCardPayment(payload) {
  if (!provider.isConfigured()) return { status: 503, body: { error: 'Card payments are not configured yet.' } };

  const draftResult = validateGiftCardPurchaseDraft(payload);
  if (draftResult.error) return { status: 400, body: { error: draftResult.error } };
  const draft = draftResult.value;

  // The provider is only ever charged in USD in this app — draft.amount is
  // in the gift card's OWN chosen currency (could be AMD/EUR), so it must be
  // converted to its USD equivalent before computing cents. Charging AMD
  // 40,000 as if it were $40,000.00 would be a massive overcharge; this is
  // the one place that conversion has to happen for the purchase itself
  // (redemption does its own equivalent conversion later, in
  // server/gift-card-api.mjs).
  const usdRate = RATES[draft.currency] || 1;
  const amountUsd = Number((draft.amount / usdRate).toFixed(2));
  const amountInCents = Math.round(amountUsd * 100);
  if (amountInCents < 50) {
    return { status: 400, body: { error: 'Gift card amount is too small to charge online.' } };
  }

  const pendingId = randomUUID();
  await run(`INSERT INTO pending_checkouts (id, draft, status, type) VALUES (?, ?, 'pending', 'gift-card')`, [pendingId, toJson(draft)]);

  let intent;
  try {
    intent = await provider.createIntent({
      amountCents: amountInCents,
      currency: 'usd',
      metadata: { type: 'gift-card', pendingCheckoutId: pendingId },
      receiptEmail: draft.purchaserEmail,
    });
  } catch (error) {
    await run(`UPDATE pending_checkouts SET status = 'expired' WHERE id = ?`, [pendingId]);
    return { status: 502, body: { error: 'Could not start card checkout. Please try again.' } };
  }

  await run(`UPDATE pending_checkouts SET paymentIntentId = ? WHERE id = ?`, [intent.providerReference, pendingId]);
  return { status: 200, body: { clientSecret: intent.clientSecret, pendingCheckoutId: pendingId, amount: draft.amount } };
}

// If cart/delivery selection changes after a PaymentIntent was already
// created (e.g. the shopper goes back and edits something), the amount must
// be kept in sync — otherwise the provider would charge a stale total. Safe
// to call repeatedly.
export async function updatePaymentAmount(pendingCheckoutId, payload) {
  if (!provider.isConfigured()) return { status: 503, body: { error: 'Card payments are not configured.' } };

  const pending = await get('SELECT * FROM pending_checkouts WHERE id = ?', [pendingCheckoutId]);
  if (!pending || !pending.paymentIntentId) return { status: 404, body: { error: 'Checkout not found.' } };
  if (pending.status !== 'pending') return { status: 409, body: { error: 'This checkout is no longer editable.' } };

  const draftResult = await validateOrderDraft({ ...payload, paymentMethod: 'card' });
  if (draftResult.error) return { status: 400, body: { error: draftResult.error } };
  const draft = draftResult.value;
  const amountInCents = Math.round(draft.total * 100);

  await run('UPDATE pending_checkouts SET draft = ? WHERE id = ?', [toJson(draft), pendingCheckoutId]);
  try {
    await provider.updateIntentAmount(pending.paymentIntentId, amountInCents);
  } catch (error) {
    return { status: 502, body: { error: 'Could not update the payment amount. Please try again.' } };
  }
  return { status: 200, body: { total: draft.total } };
}

// Idempotent: safe to call twice for the same pending checkout (e.g. the
// webhook and the client-facing fallback both racing to complete it) —
// completeOrderPayment()'s idempotencyKey means only the first call actually
// inserts an order; the second just returns it.
async function finalizePendingCheckout(pendingCheckoutId) {
  const pending = await get('SELECT * FROM pending_checkouts WHERE id = ?', [pendingCheckoutId]);
  if (!pending) return { status: 404, body: { error: 'Checkout not found.' } };

  const draft = fromJson(pending.draft, null);
  if (!draft) return { status: 500, body: { error: 'Checkout data was corrupted.' } };

  const result = await completeOrderPayment(draft, {
    provider: PROVIDER_NAME,
    providerTransactionId: pending.paymentIntentId,
    pendingCheckoutId,
    paymentEnv: getPaymentEnv(),
  });
  if (result.status === 201) {
    await run(`UPDATE pending_checkouts SET status = 'completed' WHERE id = ?`, [pendingCheckoutId]);
  }
  return result;
}

async function orderSummaryForPending(pendingCheckoutId) {
  // The order was created with idempotencyKey `${PROVIDER_NAME}:${pendingCheckoutId}` —
  // look it up the same way a duplicate-order-prevention check would.
  const row = await get('SELECT orderNumber, total FROM orders WHERE idempotencyKey = ?', [`${PROVIDER_NAME}:${pendingCheckoutId}`]);
  return row ? { orderNumber: row.orderNumber, total: Number(row.total) } : null;
}

// Mirrors finalizePendingCheckout() above for the gift-card purchase flow —
// idempotent via completeGiftCardPurchase()'s pendingPurchaseId lookup.
async function finalizeGiftCardPurchase(pendingCheckoutId) {
  const pending = await get('SELECT * FROM pending_checkouts WHERE id = ?', [pendingCheckoutId]);
  if (!pending) return { status: 404, body: { error: 'Checkout not found.' } };

  const draft = fromJson(pending.draft, null);
  if (!draft) return { status: 500, body: { error: 'Checkout data was corrupted.' } };

  const result = await completeGiftCardPurchase(draft, pendingCheckoutId);
  if (result.status === 201) {
    await run(`UPDATE pending_checkouts SET status = 'completed' WHERE id = ?`, [pendingCheckoutId]);
  }
  return result;
}

// POST /api/payments/webhook (mounted by app.mjs as the raw-body route) — the
// authoritative path for payment confirmation. Verifies the request really
// came from the configured provider (signature check) before trusting it at
// all, and is idempotent by construction: a duplicate delivery for the same
// PaymentIntent resolves to the same pending_checkouts row, whose
// completeOrderPayment()/completeGiftCardPurchase() call is itself guarded by
// a unique idempotency key / pendingPurchaseId lookup — so a retried webhook
// can never create a second order, charge twice, or send a second
// confirmation email.
export async function handleWebhook(rawBody, signature) {
  if (!provider.isConfigured() || !provider.isWebhookConfigured()) {
    return { status: 503, body: { error: 'Webhook not configured.' } };
  }

  let event;
  try {
    event = provider.constructWebhookEvent(rawBody, signature);
  } catch (error) {
    return { status: 400, body: { error: `Webhook signature verification failed: ${error.message}` } };
  }

  const succeeded = provider.parseSucceededEvent(event);
  if (succeeded?.providerReference) {
    const pendingCheckoutId = succeeded.metadata?.pendingCheckoutId;
    if (pendingCheckoutId) {
      if (succeeded.metadata?.type === 'gift-card') {
        await finalizeGiftCardPurchase(pendingCheckoutId);
      } else {
        await finalizePendingCheckout(pendingCheckoutId);
      }
    }
  }

  // Every other event type (payment_intent.payment_failed, etc.) is
  // acknowledged with 200 so the provider stops retrying it, but never acted
  // on — a failed/cancelled payment must never create or confirm an order.
  return { status: 200, body: { received: true } };
}

// GET /api/payments/:pendingCheckoutId/status — used by the checkout page
// right after the client-side confirmation call resolves. Webhooks are the
// primary path but can be slow (or, in local dev without the provider's CLI
// listener running, never arrive at all) — this independently asks the
// provider itself whether the payment actually succeeded before completing
// the order, so it's just as trustworthy as the webhook, only slower to fire
// in the worst case. It never trusts the client beyond "here's an id to
// look up."
export async function getPaymentStatus(pendingCheckoutId) {
  if (!provider.isConfigured()) return { status: 503, body: { error: 'Card payments are not configured.' } };

  const pending = await get('SELECT * FROM pending_checkouts WHERE id = ?', [pendingCheckoutId]);
  if (!pending || !pending.paymentIntentId) return { status: 404, body: { error: 'Checkout not found.' } };

  if (pending.status === 'completed') {
    return { status: 200, body: { status: 'succeeded', order: await orderSummaryForPending(pending.id) } };
  }

  let providerStatus;
  try {
    providerStatus = await provider.retrieveIntentStatus(pending.paymentIntentId);
  } catch {
    return { status: 502, body: { error: 'Could not verify payment status.' } };
  }

  if (providerStatus === 'succeeded') {
    const result = await finalizePendingCheckout(pending.id);
    if (result.status !== 201) return result;
    return { status: 200, body: { status: 'succeeded', order: await orderSummaryForPending(pending.id) } };
  }
  if (providerStatus === 'canceled') {
    return { status: 200, body: { status: 'canceled' } };
  }

  return { status: 200, body: { status: providerStatus } };
}

// GET /api/gift-cards/purchase/:pendingCheckoutId/status — mirrors
// getPaymentStatus() above for the gift-card purchase flow.
export async function getGiftCardPaymentStatus(pendingCheckoutId) {
  if (!provider.isConfigured()) return { status: 503, body: { error: 'Card payments are not configured.' } };

  const pending = await get('SELECT * FROM pending_checkouts WHERE id = ?', [pendingCheckoutId]);
  if (!pending || !pending.paymentIntentId) return { status: 404, body: { error: 'Checkout not found.' } };

  if (pending.status === 'completed') {
    const row = await get('SELECT * FROM gift_cards WHERE pendingPurchaseId = ?', [pending.id]);
    return { status: 200, body: { status: 'succeeded', giftCard: row ? { code: row.code, amount: Number(row.initialValue), currency: row.currency } : null } };
  }

  let providerStatus;
  try {
    providerStatus = await provider.retrieveIntentStatus(pending.paymentIntentId);
  } catch {
    return { status: 502, body: { error: 'Could not verify payment status.' } };
  }

  if (providerStatus === 'succeeded') {
    const result = await finalizeGiftCardPurchase(pending.id);
    if (result.status !== 201) return result;
    return { status: 200, body: { status: 'succeeded', giftCard: { code: result.body.giftCard.code, amount: result.body.giftCard.initialValue, currency: result.body.giftCard.currency } } };
  }
  if (providerStatus === 'canceled') {
    return { status: 200, body: { status: 'canceled' } };
  }

  return { status: 200, body: { status: providerStatus } };
}
