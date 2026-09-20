// Integration tests against a real Express server + isolated temp database
// (see tests/helpers/test-server.mjs). Concurrency tests verify database
// state after requests complete, not just HTTP response codes — an HTTP 201
// alone doesn't prove stock wasn't oversold underneath it.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PRODUCT_ID = '_test_order_lifecycle_product';
const PRODUCT_ID_2 = '_test_order_lifecycle_product_2';
const EMAIL = 'qa-order-lifecycle@example.com';

async function seedProduct(id, stock, overrides = {}) {
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(id);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, ?, 100, '["Black"]', '["M"]', '[]', ?, 0)
  `).run(id, overrides.name || 'Test Lifecycle Product', server.jsonStock(stock));
}

before(async () => {
  server = await startTestServer('order-lifecycle');
  BASE = server.baseUrl;
  server.jsonStock = (stock) => JSON.stringify(stock ?? {});
  await seedProduct(PRODUCT_ID, {});
  await seedProduct(PRODUCT_ID_2, {}, { name: 'Test Lifecycle Product 2' });
});

beforeEach(async () => {
  await server.db.prepare("DELETE FROM orders WHERE customerEmail = ?").run(EMAIL);
});

after(async () => {
  await server.db.prepare("DELETE FROM orders WHERE customerEmail = ?").run(EMAIL);
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(PRODUCT_ID, PRODUCT_ID_2);
  await server.close();
});

// paypal/idram/telcell are unconnected manual placeholders — a direct order
// with one of these creates a 'payment_pending' order (see server/order-api.mjs's
// createOrder), never an immediately-'confirmed' order. Cash on Delivery
// ('cash_on_delivery') is the one exception: it's a real, permanent payment
// method that confirms immediately (see the dedicated tests further down) —
// tests below that need a genuinely 'confirmed', PAID order (loyalty
// granting) still go through the real Stripe webhook flow, since Cash on
// Delivery is deliberately never marked 'paid'.
const orderPayload = (idempotencyKey, overrides = {}) => ({
  customer: { firstName: 'QA', lastName: 'Lifecycle', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
  paymentMethod: 'paypal',
  idempotencyKey,
  ...overrides,
});

async function postOrder(payload) {
  return fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

test('duplicate submissions with the same idempotency key create only one order (concurrent double-click / retry protection)', async () => {
  const key = `qa-test-${Date.now()}`;
  const [r1, r2] = await Promise.all([postOrder(orderPayload(key)), postOrder(orderPayload(key))]);
  const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(b1.orderNumber, b2.orderNumber, 'both responses should reference the same order, not two separate ones');

  const row = await server.db.prepare('SELECT COUNT(*) c FROM orders WHERE customerEmail = ? AND idempotencyKey = ?').get(EMAIL, key);
  assert.equal(row.c, 1);
});

test('a SEQUENTIAL repeat request with the same idempotency key also returns the original order (not just the concurrent race)', async () => {
  const key = `qa-sequential-${Date.now()}`;
  const r1 = await postOrder(orderPayload(key));
  const b1 = await r1.json();
  assert.equal(r1.status, 201);

  const r2 = await postOrder(orderPayload(key));
  const b2 = await r2.json();
  assert.equal(r2.status, 201);
  assert.equal(b1.orderNumber, b2.orderNumber);

  const row = await server.db.prepare('SELECT COUNT(*) c FROM orders WHERE idempotencyKey = ?').get(key);
  assert.equal(row.c, 1);
});

test('a stock-tracked variant with only 1 unit available cannot be oversold by two different concurrent customers', async () => {
  await seedProduct(PRODUCT_ID, { 'M|Black': 1 });
  const buyerA = orderPayload(`qa-oversell-a-${Date.now()}`, {
    customer: { firstName: 'Buyer', lastName: 'A', email: 'qa-oversell-a@example.com', phone: '1', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  });
  const buyerB = orderPayload(`qa-oversell-b-${Date.now()}`, {
    customer: { firstName: 'Buyer', lastName: 'B', email: 'qa-oversell-b@example.com', phone: '2', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  });

  const [r1, r2] = await Promise.all([postOrder(buyerA), postOrder(buyerB)]);
  const succeeded = [r1.status, r2.status].filter((s) => s === 201).length;
  assert.equal(succeeded, 1, 'exactly one of the two concurrent orders from two different customers for the last unit should succeed');

  const stockRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const stock = stockRow.stock;
  assert.equal(stock['M|Black'], 0, 'stock should never go negative');
  assert.ok(stock['M|Black'] >= 0);

  const orderCountRow = await server.db.prepare("SELECT COUNT(*) c FROM orders WHERE customerEmail IN ('qa-oversell-a@example.com','qa-oversell-b@example.com')").get();
  assert.equal(orderCountRow.c, 1, 'exactly one order row should exist, not two');

  await server.db.prepare("DELETE FROM orders WHERE customerEmail IN ('qa-oversell-a@example.com','qa-oversell-b@example.com')").run();
  await seedProduct(PRODUCT_ID, {});
});

test('a request for a quantity greater than available stock is rejected with no side effects', async () => {
  await seedProduct(PRODUCT_ID, { 'M|Black': 2 });
  const res = await postOrder(orderPayload(`qa-too-many-${Date.now()}`, {
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 5 }],
  }));
  assert.equal(res.status, 400);

  const stockRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  assert.equal(stockRow.stock['M|Black'], 2, 'a rejected order must not touch stock at all');
  await seedProduct(PRODUCT_ID, {});
});

test('a sold-out variant (0 in stock) cannot be purchased', async () => {
  await seedProduct(PRODUCT_ID, { 'M|Black': 0 });
  const res = await postOrder(orderPayload(`qa-soldout-${Date.now()}`));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /sold out/i);
  await seedProduct(PRODUCT_ID, {});
});

test('ordering multiple units of the same variant decrements stock by the full quantity, not just 1', async () => {
  await seedProduct(PRODUCT_ID, { 'M|Black': 10 });
  const res = await postOrder(orderPayload(`qa-multi-qty-${Date.now()}`, {
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 4 }],
  }));
  assert.equal(res.status, 201);
  const stockRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  assert.equal(stockRow.stock['M|Black'], 6);
  await seedProduct(PRODUCT_ID, {});
});

test('an order with two different product variants decrements each one independently and correctly', async () => {
  await seedProduct(PRODUCT_ID, { 'M|Black': 5 });
  await seedProduct(PRODUCT_ID_2, { 'M|Black': 5 }, { name: 'Test Lifecycle Product 2' });
  const res = await postOrder(orderPayload(`qa-two-variants-${Date.now()}`, {
    items: [
      { productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 2 },
      { productId: PRODUCT_ID_2, size: 'M', color: 'Black', quantity: 3 },
    ],
  }));
  assert.equal(res.status, 201);
  const row1 = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const row2 = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID_2);
  const stock1 = row1.stock;
  const stock2 = row2.stock;
  assert.equal(stock1['M|Black'], 3);
  assert.equal(stock2['M|Black'], 2);
  await seedProduct(PRODUCT_ID, {});
  await seedProduct(PRODUCT_ID_2, {}, { name: 'Test Lifecycle Product 2' });
});

test('cancelling a confirmed stock-tracked order restores the inventory it reserved', async () => {
  await seedProduct(PRODUCT_ID, { 'M|Black': 5 });
  const orderRes = await postOrder(orderPayload(`qa-restock-${Date.now()}`, {
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 3 }],
  }));
  assert.equal(orderRes.status, 201);
  const afterOrderRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const afterOrder = afterOrderRow.stock;
  assert.equal(afterOrder['M|Black'], 2, 'sanity check: stock decremented on order creation');

  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  const adminToken = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json()).then((b) => b.token);

  const cancelRes = await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const afterCancelRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const afterCancel = afterCancelRow.stock;
  assert.equal(afterCancel['M|Black'], 5, 'cancelling the order should give the reserved units back to inventory');

  // Toggling cancelled -> cancelled again (e.g. a duplicate admin action)
  // must not double-restore stock.
  const cancelAgain = await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelAgain.status, 200);
  const afterSecondCancelRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const afterSecondCancel = afterSecondCancelRow.stock;
  assert.equal(afterSecondCancel['M|Black'], 5, 'a redundant cancel must not restore stock a second time');

  await seedProduct(PRODUCT_ID, {});
});

test('cancelling a confirmed order reverts the loyalty points it granted (regression: points previously stayed on the balance forever)', async () => {
  // Loyalty points are only ever granted at creation time for an order that
  // commits with status:'confirmed' (see server/order-api.mjs's
  // commitOrder). Now that cash on delivery is removed, createOrder() can
  // never produce a 'confirmed' order directly — the only path left is a
  // real Stripe-paid order via the webhook (order-api.mjs's completePayment), exactly
  // like tests/api/stripe-webhook.test.mjs. This is a real, verified
  // consequence of removing COD, documented in the QA report: manually
  // flipping a payment_pending paypal/idram/telcell order to 'confirmed'
  // via the admin panel does NOT retroactively grant loyalty points, since
  // granting only happens inside commitOrder(), not updateOrderStatus().
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_fake_lifecycle_0000000000';
  process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_fake_lifecycle_0000000000';
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fake_lifecycle_secret';
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Lifecycle', email: EMAIL, password: 'TestPass123', country: 'Armenia' }),
  });
  assert.equal(regRes.status, 201);
  const codeRow = await server.db.prepare('SELECT verificationToken FROM customers WHERE email = ?').get(EMAIL);
  const code = codeRow?.verificationToken;
  const verifyRes = await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, code }),
  });
  const { user } = await verifyRes.json();

  // Seed a pending_checkouts row the same shape createPaymentIntent() would
  // have produced (without an actual network call to Stripe) and drive it
  // through the real webhook signature-verification + commit path.
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const { toJson } = await import('../../server/db.mjs');
  const { randomUUID } = await import('node:crypto');
  const draftResult = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'Lifecycle', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'card',
    customerId: user.id,
  });
  assert.equal(draftResult.error, undefined);
  const pendingId = randomUUID();
  await server.db.prepare(`INSERT INTO pending_checkouts (id, draft, status) VALUES (?, ?, 'pending')`).run(pendingId, toJson(draftResult.value));

  const payload = JSON.stringify({
    id: `evt_test_${pendingId}`, object: 'event', type: 'payment_intent.succeeded',
    data: { object: { id: `pi_test_${pendingId}`, object: 'payment_intent', status: 'succeeded', metadata: { pendingCheckoutId: pendingId } } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const webhookRes = await fetch(`${BASE}/api/stripe/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload,
  });
  assert.equal(webhookRes.status, 200);

  const customerAfterOrder = await server.db.prepare('SELECT loyaltyPoints FROM customers WHERE id = ?').get(user.id);
  assert.ok(customerAfterOrder.loyaltyPoints > 0, 'a confirmed, Stripe-paid order should grant loyalty points');

  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingId}`);
  assert.ok(orderRow);
  const adminLoginRes = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  const { token: adminToken } = await adminLoginRes.json();
  const cancelRes = await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const customerAfterCancel = await server.db.prepare('SELECT loyaltyPoints FROM customers WHERE id = ?').get(user.id);
  assert.equal(customerAfterCancel.loyaltyPoints, 0, 'cancelling the order should claw back the loyalty points it granted');
});

test('14. Cash on Delivery is offered in the checkout UI\'s payment method list (source-level check)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../src/pages/CheckoutPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /value:\s*'cash_on_delivery'/, 'the paymentMethods list must offer a real Cash on Delivery option');
  assert.match(source, /label:\s*'Cash on Delivery'/, 'the Cash on Delivery option must be clearly labeled');
});

test('15. a legacy client request with the retired paymentMethod: "cash" is rejected by the API (only "cash_on_delivery" is a valid value)', async () => {
  const res = await postOrder(orderPayload(`qa-cod-rejected-${Date.now()}`, { paymentMethod: 'cash' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /valid payment method/i);

  const row = await server.db.prepare("SELECT COUNT(*) c FROM orders WHERE customerEmail = ? AND createdAt > DATE_SUB(NOW(), INTERVAL 1 MINUTE)").get(EMAIL);
  assert.equal(row.c, 0, 'a rejected legacy "cash" attempt must not create any order');
});

test('16. Cash on Delivery: a real order confirms immediately, is never marked paid, and grants no loyalty points until actually paid', async () => {
  const res = await postOrder(orderPayload(`qa-cod-${Date.now()}`, { paymentMethod: 'cash_on_delivery' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'confirmed', 'a Cash on Delivery order confirms immediately — there is no online payment step to wait for');
  assert.equal(body.paymentStatus, 'not_charged', 'Cash on Delivery must never be marked paid — no money has changed hands yet');

  const row = await server.db.prepare('SELECT * FROM orders WHERE orderNumber = ?').get(body.orderNumber);
  assert.equal(row.paymentMethod, 'cash_on_delivery');
  assert.equal(row.status, 'confirmed');
  assert.equal(row.paymentStatus, 'not_charged');
});

test('17. Cash on Delivery: server-side price/stock/delivery are authoritative, exactly like every other payment method', async () => {
  await server.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(server.jsonStock({ 'M|Black': 1 }), PRODUCT_ID);
  const res = await postOrder(orderPayload(`qa-cod-authoritative-${Date.now()}`, {
    paymentMethod: 'cash_on_delivery',
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1, unitPrice: 0.01, price: 0.01 }],
    subtotal: 0.01,
    total: 0.01,
  }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.subtotal, 100, 'the real server-side product price (100) must be used, never a client-supplied one');

  const tooMany = await postOrder(orderPayload(`qa-cod-stock-${Date.now()}`, { paymentMethod: 'cash_on_delivery', items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 5 }] }));
  assert.equal(tooMany.status, 400, 'Cash on Delivery must respect real stock the same as any other payment method');
  await server.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(server.jsonStock({}), PRODUCT_ID);
});

test('a request with an invalid promo code is rejected, not silently ignored', async () => {
  const res = await postOrder({ ...orderPayload(`qa-badpromo-${Date.now()}`), promoCode: 'THIS_CODE_DOES_NOT_EXIST' });
  assert.equal(res.status, 400);
});

test('an unknown product id in the cart is rejected', async () => {
  const res = await postOrder(orderPayload(`qa-unknown-product-${Date.now()}`, {
    items: [{ productId: '_totally_made_up_product_id', size: 'M', color: 'Black', quantity: 1 }],
  }));
  assert.equal(res.status, 400);
});

test('malformed JSON body does not crash the server', async () => {
  const raw = await fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not valid json' });
  assert.equal(raw.status, 400);
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'server should still be responsive after a malformed request');
});

test('an unknown API route returns a proper JSON 404, not the SPA HTML fallback', async () => {
  const res = await fetch(`${BASE}/api/this-route-does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /json/);
  const body = await res.json();
  assert.ok(body.error);
});

test('requesting a nonexistent product by id returns 404', async () => {
  const res = await fetch(`${BASE}/api/products/_does_not_exist_at_all`);
  assert.equal(res.status, 404);
});

test('admin status transitions to shipped/cancelled/refunded succeed and repeating the same transition does not error (duplicate-email guard must not crash the request)', async () => {
  await seedProduct(PRODUCT_ID, {});
  const orderRes = await postOrder(orderPayload(`qa-status-email-${Date.now()}`));
  assert.equal(orderRes.status, 201);
  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);

  const adminToken = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json()).then((b) => b.token);

  const patchStatus = (body) => fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });

  const shippedRes = await patchStatus({ status: 'shipped' });
  assert.equal(shippedRes.status, 200);
  // Same status again — SMTP is unconfigured in this test process (see
  // startTestServer's comment) so sendOrderStatusEmail() only logs, but the
  // request itself must still succeed and must not fire a second time.
  const shippedAgain = await patchStatus({ status: 'shipped' });
  assert.equal(shippedAgain.status, 200);

  const refundedRes = await patchStatus({ paymentStatus: 'refunded' });
  assert.equal(refundedRes.status, 200);
  const refundedAgain = await patchStatus({ paymentStatus: 'refunded' });
  assert.equal(refundedAgain.status, 200);

  await seedProduct(PRODUCT_ID, {});
});
