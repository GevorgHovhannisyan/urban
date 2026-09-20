// Integration tests against a real Express server + isolated temp database.
// Covers server/returns-api.mjs (customer-facing /api/account/returns and
// admin-facing /api/admin/returns).
//
// IMPORTANT, verified finding: updateReturnStatus() (the admin action that
// moves a return to 'approved'/'refunded') does ONLY a status-field update —
// it does not restore inventory, and does not adjust loyalty points or
// gift-card balances. There is no code anywhere that ties a return's
// approval/refund to stock, loyalty, or gift cards. Per this task's
// instruction not to invent a business policy where the code doesn't define
// one, this file does NOT assert that those adjustments happen (they don't)
// — it instead has one test that documents the current (missing) behavior
// explicitly, the same way the Stripe stock-race finding was handled. See
// the QA report for the business decision this leaves open.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PRODUCT_ID = '_test_returns_product';
const EMAIL_A = 'qa-returns-a@example.com';
const EMAIL_B = 'qa-returns-b@example.com';

let adminToken;
let tokenA;
let tokenB;

async function registerAndVerify(email) {
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Returns', email, password: 'TestPass123', country: 'Armenia' }),
  });
  const row = await server.db.prepare('SELECT id, verificationToken FROM customers WHERE email = ?').get(email);
  const verifyRes = await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: row.verificationToken }),
  });
  const body = await verifyRes.json();
  return { token: body.token, id: row.id };
}

// createReturnRequest() requires the order to be in one of
// ['confirmed','processing','shipped','delivered'] (see
// server/returns-api.mjs). COD removed: a directly-created order now always
// commits as 'payment_pending' (see server/order-api.mjs's createOrder), so
// this helper admin-confirms it afterward — simulating a merchant manually
// verifying a PayPal/Idram/Telcell payment came through, which is now the
// only way (short of a real Stripe payment) such an order becomes eligible
// for a return in this app.
async function placeOrder(token, overrides = {}) {
  const email = overrides.email || EMAIL_A;
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      customer: { firstName: 'QA', lastName: 'Returns', email, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
      items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
      paymentMethod: 'paypal',
      idempotencyKey: overrides.idempotencyKey || `qa-returns-order-${Date.now()}-${Math.random()}`,
    }),
  });
  assert.equal(res.status, 201, 'test setup: order creation should succeed');
  const order = await server.db.prepare('SELECT * FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(email);

  const confirmRes = await fetch(`${BASE}/api/admin/orders/${order.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(confirmRes.status, 200, 'test setup: admin confirmation should succeed');
  return server.db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
}

before(async () => {
  server = await startTestServer('returns');
  BASE = server.baseUrl;
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Returns Product', 100, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);

  await server.db.prepare('DELETE FROM customers WHERE email IN (?, ?)').run(EMAIL_A, EMAIL_B);
  const a = await registerAndVerify(EMAIL_A);
  tokenA = a.token;
  const b = await registerAndVerify(EMAIL_B);
  tokenB = b.token;

  adminToken = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json()).then((b) => b.token);
});

beforeEach(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail IN (?, ?)').run(EMAIL_A, EMAIL_B);
  await server.db.prepare('DELETE FROM return_requests').run();
});

after(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail IN (?, ?)').run(EMAIL_A, EMAIL_B);
  await server.db.prepare('DELETE FROM return_requests').run();
  await server.db.prepare('DELETE FROM customers WHERE email IN (?, ?)').run(EMAIL_A, EMAIL_B);
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.close();
});

test('authorization: creating a return request requires a customer token', async () => {
  const res = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderNumber: 'UP-2026-DOESNOTMATTER' }),
  });
  assert.equal(res.status, 401);
});

test('authorization: listing "my returns" requires a customer token', async () => {
  const res = await fetch(`${BASE}/api/account/returns`);
  assert.equal(res.status, 401);
});

test('authorization: admin-only endpoints reject a customer token', async () => {
  const listRes = await fetch(`${BASE}/api/admin/returns`, { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(listRes.status, 401);
  const patchRes = await fetch(`${BASE}/api/admin/returns/whatever`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(patchRes.status, 401);
});

test('VALID flow: a customer can request a return for their own delivered/confirmed order', async () => {
  const order = await placeOrder(tokenA);
  const res = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber, reason: 'Wrong size' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.returnRequest.status, 'requested');
  assert.equal(body.returnRequest.orderNumber, order.orderNumber);
});

test('INVALID order/customer: requesting a return for an order number that does not exist is rejected', async () => {
  const res = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: 'UP-2026-NOT-REAL' }),
  });
  assert.equal(res.status, 404);
});

test('CROSS-CUSTOMER isolation: customer B cannot request a return for customer A\'s order', async () => {
  const order = await placeOrder(tokenA);
  const res = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  });
  assert.equal(res.status, 404, 'a return request scoped to another customer\'s order must not succeed, and must not leak whether the order exists');
});

test('CROSS-CUSTOMER isolation: customer B\'s "my returns" list never includes customer A\'s return requests', async () => {
  const order = await placeOrder(tokenA);
  await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  });

  const res = await fetch(`${BASE}/api/account/returns`, { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.returnRequests.length, 0);
});

test('ALREADY RETURNED: a second return request for the same order while the first is still active (requested/approved) is rejected', async () => {
  const order = await placeOrder(tokenA);
  const first = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  });
  assert.equal(first.status, 201);

  const second = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  });
  assert.equal(second.status, 409);
});

test('a return request can be resubmitted after the first one was rejected (rejected does not permanently block a new request)', async () => {
  const order = await placeOrder(tokenA);
  const first = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  }).then((r) => r.json());

  await fetch(`${BASE}/api/admin/returns/${first.returnRequest.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'rejected' }),
  });

  const second = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  });
  assert.equal(second.status, 201);
});

test('PARTIAL return: requesting a return for a specific item still present on the order only includes that item', async () => {
  // Seed a second product so the order has two distinct line items.
  const PRODUCT_ID_2 = '_test_returns_product_2';
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID_2);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Returns Product 2', 50, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID_2);

  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      customer: { firstName: 'QA', lastName: 'Returns', email: EMAIL_A, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
      items: [
        { productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 },
        { productId: PRODUCT_ID_2, size: 'M', color: 'Black', quantity: 1 },
      ],
      paymentMethod: 'paypal',
      idempotencyKey: `qa-returns-partial-${Date.now()}`,
    }),
  });
  assert.equal(res.status, 201);
  const order = await server.db.prepare('SELECT * FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL_A);
  // A return can only be requested against a confirmed order — see the
  // placeOrder() helper's comment for why this admin step is now needed.
  await fetch(`${BASE}/api/admin/orders/${order.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'confirmed' }),
  });

  const returnRes = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber, items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black' }] }),
  });
  assert.equal(returnRes.status, 201);
  const body = await returnRes.json();
  assert.equal(body.returnRequest.items.length, 1, 'a partial return should only include the requested item, not the whole order');
  assert.equal(body.returnRequest.items[0].productId, PRODUCT_ID);

  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID_2);
});

test('DUPLICATE refund request idempotency: marking an already-refunded return as refunded again does not error or duplicate anything', async () => {
  const order = await placeOrder(tokenA);
  const created = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  }).then((r) => r.json());

  const first = await fetch(`${BASE}/api/admin/returns/${created.returnRequest.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'refunded' }),
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${BASE}/api/admin/returns/${created.returnRequest.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'refunded' }),
  });
  assert.equal(second.status, 200);

  const row = await server.db.prepare('SELECT COUNT(*) c FROM return_requests WHERE id = ?').get(created.returnRequest.id);
  assert.equal(row.c, 1, 'there is still exactly one return_requests row — no duplication');
});

test('an invalid status transition value is rejected', async () => {
  const order = await placeOrder(tokenA);
  const created = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  }).then((r) => r.json());

  const res = await fetch(`${BASE}/api/admin/returns/${created.returnRequest.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'not-a-real-status' }),
  });
  assert.equal(res.status, 400);
});

test('KNOWN GAP (documented, not silently hidden): marking a return "refunded" does NOT restore inventory or adjust loyalty/gift-card state — no such wiring exists in the codebase', async () => {
  await server.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(JSON.stringify({ 'M|Black': 5 }), PRODUCT_ID);
  const order = await placeOrder(tokenA);
  const stockAfterOrderRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const stockAfterOrder = stockAfterOrderRow.stock;
  assert.equal(stockAfterOrder['M|Black'], 4, 'sanity check: placing the order decremented stock');

  const loyaltyBeforeRow = await server.db.prepare('SELECT loyaltyPoints FROM customers WHERE email = ?').get(EMAIL_A);
  const loyaltyBefore = loyaltyBeforeRow.loyaltyPoints;

  const created = await fetch(`${BASE}/api/account/returns`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderNumber: order.orderNumber }),
  }).then((r) => r.json());

  const refundRes = await fetch(`${BASE}/api/admin/returns/${created.returnRequest.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'refunded' }),
  });
  assert.equal(refundRes.status, 200);

  const stockAfterRefundRow = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const stockAfterRefund = stockAfterRefundRow.stock;
  const loyaltyAfterRow = await server.db.prepare('SELECT loyaltyPoints FROM customers WHERE email = ?').get(EMAIL_A);
  const loyaltyAfter = loyaltyAfterRow.loyaltyPoints;
  const orderStatusRow = await server.db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id);
  const orderStatus = orderStatusRow.status;

  // These document ACTUAL current behavior — none of this is desired
  // end-state, it is what the code does today. See the QA report.
  assert.equal(stockAfterRefund['M|Black'], 4, 'KNOWN GAP: refunding a return does not restore the stock the order consumed');
  assert.equal(loyaltyAfter, loyaltyBefore, 'KNOWN GAP: refunding a return does not adjust loyalty points earned on the original order');
  assert.equal(orderStatus, 'confirmed', 'KNOWN GAP: the underlying order status is never updated when its return is refunded (stays "confirmed", not e.g. "returned"/"refunded")');

  await server.db.prepare('UPDATE products SET stock = ? WHERE id = ?').run('{}', PRODUCT_ID);
});
