// UP Society rewards, end to end against a real Express server + isolated
// temp database: earning (1 point per $1 on products, only once paid),
// redeeming (100 points = $5 at checkout), and reversal on cancellation,
// refund and returned items — checking the database after every step, not
// just HTTP responses.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from '../helpers/test-server.mjs';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_fake_loyalty_0000000000';
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_fake_loyalty_0000000000';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fake_loyalty_secret';

let server;
let BASE;
let adminToken;
let customer; // { token, id }
const EMAIL = 'qa-loyalty@example.com';
const PRODUCT_ID = '_test_loyalty_product';     // $100
const PRODUCT_ID_2 = '_test_loyalty_product_2'; // $50
const ADDRESS = { firstName: 'QA', lastName: 'Loyalty', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' };

const json = (method, body, token) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const balance = async () => (await server.db.prepare('SELECT loyaltyPoints FROM customers WHERE id = ?').get(customer.id)).loyaltyPoints;
const setBalance = (points) => server.db.prepare('UPDATE customers SET loyaltyPoints = ? WHERE id = ?').run(points, customer.id);
const orderRow = (id) => server.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

async function placeOrder({ paymentMethod = 'cash_on_delivery', items, useLoyaltyPoints = false, token = customer.token, promoCode } = {}) {
  const res = await fetch(`${BASE}/api/orders`, json('POST', {
    customer: ADDRESS,
    items: items || [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod,
    useLoyaltyPoints,
    promoCode,
    idempotencyKey: `qa-loyalty-${randomUUID()}`,
  }, token));
  const body = await res.json();
  assert.equal(res.status, 201, `order should be created: ${JSON.stringify(body)}`);
  return server.db.prepare('SELECT * FROM orders WHERE orderNumber = ?').get(body.orderNumber);
}

// A real Stripe-paid order: validated draft → pending checkout → signed
// webhook → commitOrder, exactly as production.
async function placeStripeOrder({ items, useLoyaltyPoints = false } = {}) {
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const { toJson } = await import('../../server/db.mjs');
  const { default: Stripe } = await import('stripe');
  const draft = await validateOrderDraft({
    customer: ADDRESS,
    items: items || [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'card',
    useLoyaltyPoints,
    customerId: customer.id,
  });
  assert.equal(draft.error, undefined);
  const pendingId = randomUUID();
  await server.db.prepare(`INSERT INTO pending_checkouts (id, draft, status) VALUES (?, ?, 'pending')`).run(pendingId, toJson(draft.value));
  const payload = JSON.stringify({
    id: `evt_test_${pendingId}`, object: 'event', type: 'payment_intent.succeeded',
    data: { object: { id: `pi_test_${pendingId}`, object: 'payment_intent', status: 'succeeded', metadata: { pendingCheckoutId: pendingId } } },
  });
  const header = new Stripe(process.env.STRIPE_SECRET_KEY).webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  assert.equal(res.status, 200);
  return server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').get(`stripe:${pendingId}`);
}

async function adminUpdate(orderId, changes) {
  const res = await fetch(`${BASE}/api/admin/orders/${orderId}`, json('PATCH', changes, adminToken));
  assert.equal(res.status, 200);
  return orderRow(orderId);
}

before(async () => {
  server = await startTestServer('loyalty');
  BASE = server.baseUrl;
  for (const [id, price] of [[PRODUCT_ID, 100], [PRODUCT_ID_2, 50]]) {
    await server.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    await server.db.prepare(`INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew) VALUES (?, ?, ?, '["Black"]', '["M"]', '[]', '{}', 0)`)
      .run(id, `Loyalty Product ${price}`, price);
  }
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  await fetch(`${BASE}/api/auth/register`, json('POST', { firstName: 'QA', lastName: 'Loyalty', email: EMAIL, password: 'TestPass123', country: 'Armenia' }));
  const row = await server.db.prepare('SELECT id, verificationToken FROM customers WHERE email = ?').get(EMAIL);
  const verified = await fetch(`${BASE}/api/auth/verify-code`, json('POST', { email: EMAIL, code: row.verificationToken })).then((r) => r.json());
  customer = { token: verified.token, id: row.id };
  adminToken = await fetch(`${BASE}/api/admin/login`, json('POST', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }))
    .then((r) => r.json()).then((b) => b.token);
});

beforeEach(async () => {
  await server.db.prepare('DELETE FROM return_requests WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await setBalance(0);
});

after(async () => {
  await server.db.prepare('DELETE FROM return_requests WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(PRODUCT_ID, PRODUCT_ID_2);
  await server.close();
});

// ---------------------------------------------------------------- earning

test('EARN: a Stripe-paid order earns 1 point per $1 spent on products', async () => {
  const order = await placeStripeOrder({ items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 2 }] });
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.subtotal, 200);
  assert.equal(order.loyaltyPointsGranted, 200);
  assert.equal(await balance(), 200);
});

test('EARN: shipping does not earn points (international order with a delivery fee)', async () => {
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const draft = await validateOrderDraft({
    customer: { ...ADDRESS, country: 'US', city: 'New York', postalCode: '10001' },
    items: [{ productId: PRODUCT_ID_2, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'card', customerId: customer.id, region: 'US',
  });
  assert.equal(draft.error, undefined);
  assert.ok(draft.value.shipping > 0, 'sanity check: this order has a delivery fee');
  const { pointsEarnedForOrder } = await import('../../server/loyalty.mjs');
  assert.equal(pointsEarnedForOrder(draft.value), Math.floor(draft.value.subtotal), 'points come from products only, never shipping');
});

test('EARN: cash on delivery earns nothing while unpaid, shows as pending, and earns exactly once when marked Paid', async () => {
  const order = await placeOrder({ paymentMethod: 'cash_on_delivery' });
  assert.equal(order.status, 'confirmed');
  assert.equal(order.paymentStatus, 'not_charged');
  assert.equal(order.loyaltyPointsGranted, 0, 'an unpaid order must not grant points');
  assert.equal(await balance(), 0);

  const overview = await fetch(`${BASE}/api/account/overview`, { headers: { Authorization: `Bearer ${customer.token}` } }).then((r) => r.json());
  assert.equal(overview.loyaltyPoints, 0);
  assert.equal(overview.pendingPoints, 100, 'the account shows the points this order will earn once paid');

  await adminUpdate(order.id, { status: 'delivered', paymentStatus: 'paid' });
  assert.equal(await balance(), 100);
  await adminUpdate(order.id, { paymentStatus: 'paid' });
  await adminUpdate(order.id, { status: 'delivered' });
  assert.equal(await balance(), 100, 're-saving a paid order must never grant twice');
  assert.equal((await orderRow(order.id)).loyaltyPointsGranted, 100);
});

test('EARN: a manual-payment order confirmed by an admin earns only once it is marked Paid', async () => {
  const order = await placeOrder({ paymentMethod: 'paypal' });
  assert.equal(order.status, 'payment_pending');
  await adminUpdate(order.id, { status: 'confirmed' });
  assert.equal(await balance(), 0, 'confirmed but not paid → no points');
  await adminUpdate(order.id, { paymentStatus: 'paid' });
  assert.equal(await balance(), 100);
});

test('EARN: a guest order never earns points (nobody to credit)', async () => {
  const order = await placeOrder({ token: null });
  assert.equal(order.customerId, null);
  await adminUpdate(order.id, { paymentStatus: 'paid' });
  assert.equal(await balance(), 0);
  assert.equal((await orderRow(order.id)).loyaltyPointsGranted, 0);
});

// ---------------------------------------------------------------- redeeming

test('REDEEM: 250 points → $10 off (whole $5 steps), 200 points deducted, earning based on what was paid', async () => {
  await setBalance(250);
  const order = await placeOrder({ useLoyaltyPoints: true });
  assert.equal(order.subtotal, 100);
  assert.equal(order.loyaltyDiscount, 10);
  assert.equal(order.loyaltyPointsUsed, 200);
  assert.equal(order.total, 90, 'total = 100 − $10 points (Yerevan delivery is free)');
  assert.equal(await balance(), 50, '250 − 200 redeemed');

  await adminUpdate(order.id, { paymentStatus: 'paid' });
  assert.equal(await balance(), 140, '50 left + 90 earned on the $90 actually spent on products');
});

test('REDEEM: not opting in keeps the points untouched', async () => {
  await setBalance(300);
  const order = await placeOrder({ useLoyaltyPoints: false });
  assert.equal(order.loyaltyDiscount, 0);
  assert.equal(order.loyaltyPointsUsed, 0);
  assert.equal(order.total, 100);
  assert.equal(await balance(), 300);
});

test('REDEEM: fewer than 100 points cannot be redeemed', async () => {
  await setBalance(99);
  const order = await placeOrder({ useLoyaltyPoints: true });
  assert.equal(order.loyaltyDiscount, 0);
  assert.equal(order.total, 100);
  assert.equal(await balance(), 99);
});

test('REDEEM: the discount never exceeds the order total', async () => {
  await setBalance(5000); // worth $250
  const order = await placeOrder({ useLoyaltyPoints: true, items: [{ productId: PRODUCT_ID_2, size: 'M', color: 'Black', quantity: 1 }] });
  assert.equal(order.subtotal, 50);
  assert.equal(order.loyaltyDiscount, 50);
  assert.equal(order.total, 0);
  assert.equal(order.loyaltyPointsUsed, 1000);
  assert.equal(await balance(), 4000);
});

test('REDEEM: a guest cannot redeem points, even when asking to', async () => {
  const order = await placeOrder({ token: null, useLoyaltyPoints: true });
  assert.equal(order.loyaltyDiscount, 0);
  assert.equal(order.total, 100);
});

test('REDEEM: Stripe card checkout applies the points discount to the charge and deducts the points', async () => {
  await setBalance(120);
  const order = await placeStripeOrder({ useLoyaltyPoints: true });
  assert.equal(order.loyaltyDiscount, 5);
  assert.equal(order.loyaltyPointsUsed, 100);
  assert.equal(order.total, 95);
  assert.equal(order.loyaltyPointsGranted, 95);
  assert.equal(await balance(), 120 - 100 + 95);
});

test('REDEEM (regression): updating a card checkout\'s amount never drops the account or its points discount', async () => {
  // The checkout re-sends the order whenever the delivery method etc.
  // changes; this request used to go out without the session token, which
  // silently re-priced the checkout as a guest (full price, no points, order
  // not linked to the account).
  await setBalance(200);
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const { toJson, fromJson } = await import('../../server/db.mjs');
  const orderInput = { customer: ADDRESS, items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }], useLoyaltyPoints: true };
  const draft = await validateOrderDraft({ ...orderInput, paymentMethod: 'card', customerId: customer.id });
  assert.equal(draft.value.loyaltyDiscount, 10);
  const pendingId = randomUUID();
  await server.db.prepare(`INSERT INTO pending_checkouts (id, draft, status, paymentIntentId) VALUES (?, ?, 'pending', 'pi_test_fake')`).run(pendingId, toJson(draft.value));

  // No Authorization header, like the old client. The provider call itself
  // fails with the fake test key — the saved draft is what matters here.
  await fetch(`${BASE}/api/checkout/payment-intent/${pendingId}`, json('PATCH', orderInput));
  const saved = fromJson((await server.db.prepare('SELECT draft FROM pending_checkouts WHERE id = ?').get(pendingId)).draft, null);
  assert.equal(saved.customerId, customer.id);
  assert.equal(saved.loyaltyDiscount, 10);
  assert.equal(saved.total, 90);
});

// ---------------------------------------------------------------- reversals

test('CANCEL: earned points are removed and redeemed points returned — exactly once', async () => {
  await setBalance(200);
  const order = await placeStripeOrder({ useLoyaltyPoints: true }); // −200 redeemed ($10), +90 earned
  assert.equal(await balance(), 90);

  await adminUpdate(order.id, { status: 'cancelled' });
  assert.equal(await balance(), 200, 'back to where the customer started');
  await adminUpdate(order.id, { status: 'cancelled' });
  await adminUpdate(order.id, { paymentStatus: 'refunded' });
  assert.equal(await balance(), 200, 'repeating cancel/refund never double-reverses');
  await adminUpdate(order.id, { paymentStatus: 'paid' });
  assert.equal(await balance(), 200, 'a cancelled order can never earn again');
});

test('REFUND: marking a paid order Refunded takes back its points', async () => {
  const order = await placeStripeOrder();
  assert.equal(await balance(), 100);
  await adminUpdate(order.id, { paymentStatus: 'refunded' });
  assert.equal(await balance(), 0);
  const row = await orderRow(order.id);
  assert.equal(row.loyaltyPointsGranted, 100, 'history of what was earned is kept');
  assert.equal(row.loyaltyPointsRevoked, 100);
});

test('REVERSAL never takes a balance below zero (points already spent elsewhere)', async () => {
  const order = await placeStripeOrder();
  await setBalance(30);
  await adminUpdate(order.id, { status: 'cancelled' });
  assert.equal(await balance(), 0);
});

test('RETURN: refunding a partial return removes only the returned items\' share of points, once', async () => {
  const order = await placeStripeOrder({ items: [
    { productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 },
    { productId: PRODUCT_ID_2, size: 'M', color: 'Black', quantity: 1 },
  ] });
  assert.equal(await balance(), 150);
  await adminUpdate(order.id, { status: 'delivered' });

  const created = await fetch(`${BASE}/api/account/returns`, json('POST', {
    orderNumber: order.orderNumber,
    items: [{ productId: PRODUCT_ID_2, size: 'M', color: 'Black' }],
  }, customer.token)).then((r) => r.json());
  assert.ok(created.returnRequest, JSON.stringify(created));

  const patch = (status) => fetch(`${BASE}/api/admin/returns/${created.returnRequest.id}`, json('PATCH', { status }, adminToken));
  assert.equal((await patch('approved')).status, 200);
  assert.equal(await balance(), 150, 'approving alone changes nothing');
  assert.equal((await patch('refunded')).status, 200);
  assert.equal(await balance(), 100, 'the $50 item\'s 50 points are removed');
  await patch('approved');
  await patch('refunded');
  assert.equal(await balance(), 100, 'toggling the return status never removes points twice');

  await adminUpdate(order.id, { paymentStatus: 'refunded' });
  assert.equal(await balance(), 0, 'a later full refund removes only the remaining 100');
});
