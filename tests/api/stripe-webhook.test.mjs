// Integration tests for the Stripe payment/webhook flow, against a real
// Express server + isolated temp database. Uses Stripe's own
// `webhooks.generateTestHeaderString()` helper to produce a genuinely valid
// signature entirely locally (pure HMAC, no network call to Stripe) — this
// exercises the real signature-verification code path without needing real
// Stripe API credentials and WITHOUT ever calling Stripe's network API, so
// no real charge or live API request happens anywhere in this file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
let stripe;
const WEBHOOK_SECRET = 'whsec_test_fake_secret_for_local_signature_only';
const PRODUCT_ID = '_test_webhook_product';
const EMAIL = 'qa-webhook@example.com';

before(async () => {
  // Fake-but-well-formed keys: enough for the Stripe SDK to construct a
  // client and for local signature verification to run for real. No network
  // call in this file ever reaches Stripe with these keys.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_000000000000000000000000';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_000000000000000000000000';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  server = await startTestServer('stripe-webhook');
  BASE = server.baseUrl;
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Webhook Product', 80, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);
});

after(async () => {
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.close();
});

// Directly seeds a pending_checkouts row the same shape createPaymentIntent()
// would have produced, without actually calling Stripe's API (which
// createPaymentIntent does, over the network) — keeps this file 100% network-free.
async function seedPendingCheckout() {
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const { toJson } = await import('../../server/db.mjs');
  const { randomUUID } = await import('node:crypto');

  const draftResult = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'Webhook', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'card',
  });
  assert.equal(draftResult.error, undefined);

  const pendingId = randomUUID();
  await server.db.prepare(`INSERT INTO pending_checkouts (id, draft, status) VALUES (?, ?, 'pending')`).run(pendingId, toJson(draftResult.value));
  return pendingId;
}

function buildSucceededEventPayload(pendingCheckoutId, overrides = {}) {
  return JSON.stringify({
    id: `evt_test_${pendingCheckoutId}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_test_${pendingCheckoutId}`,
        object: 'payment_intent',
        status: 'succeeded',
        metadata: { pendingCheckoutId },
      },
    },
    ...overrides,
  });
}

async function postWebhook(payload, secret = WEBHOOK_SECRET) {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${BASE}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
}

test('an invalid webhook signature is rejected and creates no order', async () => {
  const pendingCheckoutId = await seedPendingCheckout();
  const payload = buildSucceededEventPayload(pendingCheckoutId);
  const res = await postWebhook(payload, 'whsec_totally_wrong_secret');
  assert.equal(res.status, 400);

  const order = await server.db.prepare('SELECT id FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingCheckoutId}`);
  assert.equal(order, undefined, 'a rejected/unsigned webhook must never create an order');
});

test('a valid payment_intent.succeeded webhook completes the pending checkout into a real order (the "frontend never got the response" path — no client confirmation call happens in this test at all)', async () => {
  const pendingCheckoutId = await seedPendingCheckout();
  const payload = buildSucceededEventPayload(pendingCheckoutId);
  const res = await postWebhook(payload);
  assert.equal(res.status, 200);

  const order = await server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingCheckoutId}`);
  assert.ok(order, 'the webhook alone should have created the order');
  assert.equal(order.status, 'confirmed');
  assert.equal(order.paymentStatus, 'paid');

  const pending = await server.db.prepare('SELECT status FROM pending_checkouts WHERE id = ?').get(pendingCheckoutId);
  assert.equal(pending.status, 'completed');
});

test('duplicate webhook delivery for the same PaymentIntent creates only one order (Stripe retries webhooks; this must be idempotent)', async () => {
  const pendingCheckoutId = await seedPendingCheckout();
  const payload = buildSucceededEventPayload(pendingCheckoutId);

  const [r1, r2] = await Promise.all([postWebhook(payload), postWebhook(payload)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);

  const row = await server.db.prepare('SELECT COUNT(*) c FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingCheckoutId}`);
  assert.equal(row.c, 1, 'two webhook deliveries for the same PaymentIntent must not create two orders');
});

test('a webhook event type this app does not act on (e.g. payment_intent.payment_failed) is acknowledged but creates no order', async () => {
  const pendingCheckoutId = await seedPendingCheckout();
  const payload = JSON.stringify({
    id: `evt_test_fail_${pendingCheckoutId}`,
    object: 'event',
    type: 'payment_intent.payment_failed',
    data: { object: { id: `pi_test_${pendingCheckoutId}`, object: 'payment_intent', status: 'requires_payment_method', metadata: { pendingCheckoutId } } },
  });
  const res = await postWebhook(payload);
  assert.equal(res.status, 200, 'unhandled event types should still be acknowledged (200) so Stripe does not keep retrying them');

  const order = await server.db.prepare('SELECT id FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingCheckoutId}`);
  assert.equal(order, undefined, 'a failed-payment event must never create an order');

  const pending = await server.db.prepare('SELECT status FROM pending_checkouts WHERE id = ?').get(pendingCheckoutId);
  assert.equal(pending.status, 'pending', 'the pending checkout should remain pending, not be silently completed');
});

test('a webhook referencing an unknown/already-cleaned-up pendingCheckoutId does not crash the server', async () => {
  const payload = buildSucceededEventPayload('does-not-exist-anywhere');
  const res = await postWebhook(payload);
  assert.equal(res.status, 200);
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);
});

test('KNOWN RISK (documented, not silently hidden): stock sold out by another order between PaymentIntent creation and webhook completion does not block the Stripe order from being committed', async () => {
  // This intentionally does NOT assert "stock never goes negative == order
  // rejected" — it documents actual current behavior so it's a verified
  // fact, not a guess, for the QA report. See that report for the
  // reasoning on why this wasn't silently "fixed" as part of this pass:
  // the customer has already been charged by the time the webhook fires,
  // so rejecting the order at that point would require a refund/cancel
  // policy decision this task wasn't scoped to make.
  const { toJson, fromJson } = await import('../../server/db.mjs');
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Webhook Product', 80, '["Black"]', '["M"]', '[]', ?, 0)
  `).run(PRODUCT_ID, toJson({ 'M|Black': 1 }));

  // 1. Card checkout starts: PaymentIntent + pending_checkouts row created
  //    while 1 unit is still in stock (draft validation passes).
  const pendingCheckoutId = await seedPendingCheckout();

  // 2. Before the webhook arrives, a different customer buys the last unit
  //    through a different (non-card) payment method — a real, immediate
  //    stock decrement. Cash on delivery has been removed, so this uses
  //    paypal — any non-card method behaves identically here, since
  //    decrementVariantStock() runs regardless of payment method.
  const otherOrderRes = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: { firstName: 'Other', lastName: 'Buyer', email: 'qa-webhook-other-buyer@example.com', phone: '1', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
      items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
      paymentMethod: 'paypal',
    }),
  });
  assert.equal(otherOrderRes.status, 201);
  const stockAfterOtherRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const stockAfterOther = fromJson(stockAfterOtherRow.stock, {});
  assert.equal(stockAfterOther['M|Black'], 0, 'sanity check: the other order consumed the last unit');

  // 3. The card payment's webhook now arrives, for a unit that no longer exists in stock.
  const payload = buildSucceededEventPayload(pendingCheckoutId);
  const res = await postWebhook(payload);
  assert.equal(res.status, 200);

  const cardOrder = await server.db.prepare('SELECT id FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingCheckoutId}`);
  const stockAfterCardRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const stockAfterCard = fromJson(stockAfterCardRow.stock, {});

  // Documenting actual behavior: the paid order IS committed (payment
  // already happened) and stock is clamped at 0, never negative — but this
  // means both customers now hold an order for the same single physical
  // unit (the card order 'confirmed'; the other, still 'payment_pending'
  // since COD removal means a direct order never auto-confirms — but it
  // already claimed the physical unit of stock regardless). See report.
  assert.ok(cardOrder, 'current behavior: a webhook-completed paid order is committed even if stock sold out in the meantime');
  assert.equal(stockAfterCard['M|Black'], 0, 'stock is clamped at 0, not negative, but this does not prevent the overcommit above');

  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run('qa-webhook-other-buyer@example.com');
  await server.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run('{}', PRODUCT_ID);
});

test('KNOWN RISK, part 2 (documented, not silently hidden): the same gap exists between two competing card checkouts, not just card-vs-other-method — commitOrder() never re-validates stock at webhook time for ANY payment method', async () => {
  // Isolates the mechanism from the scenario above: two Stripe checkouts for
  // the same last unit, with no other order involved at all. Both
  // PaymentIntents are created while 1 unit is in stock (both drafts
  // validate successfully), both "payments succeed", both webhooks arrive.
  // If this only failed card-vs-another-method, that would suggest the fix
  // belongs in that other method's path; the fact that it also happens
  // card-vs-card confirms the gap is specifically "commitOrder() has no
  // stock re-check", not anything about how the competing order was paid for.
  const { toJson, fromJson } = await import('../../server/db.mjs');
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Webhook Product', 80, '["Black"]', '["M"]', '[]', ?, 0)
  `).run(PRODUCT_ID, toJson({ 'M|Black': 1 }));

  const pendingA = await seedPendingCheckout();
  const pendingB = await seedPendingCheckout();

  const resA = await postWebhook(buildSucceededEventPayload(pendingA));
  const resB = await postWebhook(buildSucceededEventPayload(pendingB));
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200, 'the webhook endpoint itself always acks 200 to Stripe regardless of what commitOrder does internally');

  const orderA = await server.db.prepare('SELECT id FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingA}`);
  const orderB = await server.db.prepare('SELECT id FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingB}`);
  const stockAfterRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const stockAfter = fromJson(stockAfterRow.stock, {});

  assert.ok(orderA, 'current behavior: the first webhook commits its order');
  assert.ok(orderB, 'current behavior: the second webhook ALSO commits its order — two confirmed, paid orders for one physical unit');
  assert.equal(stockAfter['M|Black'], 0, 'stock is still clamped at 0, not negative — the overcommit is invisible in the stock number itself');

  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Webhook Product', 80, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);
});

test('the order created from a webhook uses server-computed pricing, not anything from the webhook payload itself (the event carries no price data at all)', async () => {
  const pendingCheckoutId = await seedPendingCheckout();
  const payload = buildSucceededEventPayload(pendingCheckoutId);
  await postWebhook(payload);

  const order = await server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingCheckoutId}`);
  assert.equal(order.total, order.subtotal + order.shipping - (order.discountAmount || 0) - (order.giftCardAmount || 0) - (order.loyaltyDiscount || 0));
  assert.equal(order.subtotal, 80, 'subtotal must match the real server-side product price (80), never a client/event-supplied value');
});
