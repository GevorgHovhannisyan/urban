// Integration tests against a real Express server + isolated temp database.
// Covers server/promo-api.mjs both directly (POST /api/promo/validate) and
// through the real order-creation endpoint, since usage-count commitment
// only happens as part of committing an order (validatePromoCode() alone
// never increments usedCount — see tryCommitPromoUsage()).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PRODUCT_ID = '_test_promo_product';
const EMAIL = 'qa-promo@example.com';

async function seedPromo(code, overrides = {}) {
  await server.db.prepare('DELETE FROM promo_codes WHERE code = ?').run(code);
  await server.db.prepare(`
    INSERT INTO promo_codes (id, code, type, value, active, maxUses, usedCount, minSubtotal, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), code,
    overrides.type ?? 'percentage',
    overrides.value ?? 10,
    overrides.active ?? 1,
    overrides.maxUses ?? null,
    overrides.usedCount ?? 0,
    overrides.minSubtotal ?? 0,
    overrides.expiresAt ?? null
  );
}

function orderPayload(idempotencyKey, overrides = {}) {
  return {
    customer: { firstName: 'QA', lastName: 'Promo', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
    idempotencyKey,
    ...overrides,
  };
}

async function postOrder(payload) {
  return fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

before(async () => {
  server = await startTestServer('promo-codes');
  BASE = server.baseUrl;
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Promo Product', 100, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);
});

beforeEach(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
});

after(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare("DELETE FROM promo_codes WHERE code LIKE 'QA-PROMO-%'").run();
  await server.close();
});

test('validate: an unknown promo code is invalid', async () => {
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-NOPE', subtotal: 100 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.valid, false);
});

test('validate: a deactivated promo code is invalid', async () => {
  await seedPromo('QA-PROMO-INACTIVE', { active: 0 });
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-INACTIVE', subtotal: 100 }),
  });
  assert.equal(res.status, 400);
});

test('validate: an expired promo code is invalid', async () => {
  await seedPromo('QA-PROMO-EXPIRED', { expiresAt: new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ') });
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-EXPIRED', subtotal: 100 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /expired/i);
});

test('validate: a promo code that already reached its usage limit is invalid', async () => {
  await seedPromo('QA-PROMO-MAXED', { maxUses: 3, usedCount: 3 });
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-MAXED', subtotal: 100 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /usage limit/i);
});

test('validate: a promo code below its minimum-order requirement is invalid', async () => {
  await seedPromo('QA-PROMO-MINORDER', { minSubtotal: 200 });
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-MINORDER', subtotal: 100 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /minimum order/i);
});

test('validate: a promo code that meets its minimum-order requirement is valid', async () => {
  await seedPromo('QA-PROMO-MINORDER-OK', { minSubtotal: 50, type: 'fixed', value: 15 });
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-MINORDER-OK', subtotal: 100 }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.valid, true);
  assert.equal(body.discountAmount, 15);
});

test('validate: a valid percentage promo computes the correct discount', async () => {
  await seedPromo('QA-PROMO-PCT', { type: 'percentage', value: 20 });
  const res = await fetch(`${BASE}/api/promo/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-PROMO-PCT', subtotal: 100 }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.discountAmount, 20);
});

test('order creation: an order with a nonexistent promo code is rejected, not silently ignored', async () => {
  const res = await postOrder(orderPayload(`qa-promo-bad-${Date.now()}`, { promoCode: 'QA-PROMO-DOES-NOT-EXIST' }));
  assert.equal(res.status, 400);
});

test('order creation: a valid promo code applies the discount and commits usage', async () => {
  await seedPromo('QA-PROMO-APPLY', { type: 'fixed', value: 25 });
  const res = await postOrder(orderPayload(`qa-promo-apply-${Date.now()}`, { promoCode: 'QA-PROMO-APPLY' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.discountAmount, 25);
  assert.equal(body.total, 100 - 25);

  const promo = await server.db.prepare('SELECT usedCount FROM promo_codes WHERE code = ?').get('QA-PROMO-APPLY');
  assert.equal(promo.usedCount, 1, 'a committed order should increment usedCount');
});

test('DUPLICATE application: applying the same promo code to two separate orders increments usage twice (not a dedup bug — two real, distinct purchases)', async () => {
  await seedPromo('QA-PROMO-TWICE', { type: 'fixed', value: 10 });
  const r1 = await postOrder(orderPayload(`qa-promo-twice-a-${Date.now()}`, { promoCode: 'QA-PROMO-TWICE' }));
  assert.equal(r1.status, 201);
  const r2 = await postOrder(orderPayload(`qa-promo-twice-b-${Date.now()}`, { promoCode: 'QA-PROMO-TWICE' }));
  assert.equal(r2.status, 201);

  const promo = await server.db.prepare('SELECT usedCount FROM promo_codes WHERE code = ?').get('QA-PROMO-TWICE');
  assert.equal(promo.usedCount, 2);
});

test('REPLAYED application: the same idempotency key applied twice does not double-count usage', async () => {
  await seedPromo('QA-PROMO-REPLAY', { type: 'fixed', value: 10 });
  const key = `qa-promo-replay-${Date.now()}`;
  const r1 = await postOrder(orderPayload(key, { promoCode: 'QA-PROMO-REPLAY' }));
  assert.equal(r1.status, 201);
  const r2 = await postOrder(orderPayload(key, { promoCode: 'QA-PROMO-REPLAY' }));
  assert.equal(r2.status, 201);

  const promo = await server.db.prepare('SELECT usedCount FROM promo_codes WHERE code = ?').get('QA-PROMO-REPLAY');
  assert.equal(promo.usedCount, 1, 'a replayed request with the same idempotency key must not double-count usage');
  const orderCountRow = await server.db.prepare('SELECT COUNT(*) c FROM orders WHERE idempotencyKey = ?').get(key);
  assert.equal(orderCountRow.c, 1);
});

test('ROLLBACK on cancellation: cancelling an order reverts the promo code usage it committed', async () => {
  await seedPromo('QA-PROMO-CANCEL', { type: 'fixed', value: 10, maxUses: 1 });
  const res = await postOrder(orderPayload(`qa-promo-cancel-${Date.now()}`, { promoCode: 'QA-PROMO-CANCEL' }));
  assert.equal(res.status, 201);
  const afterOrder = await server.db.prepare('SELECT usedCount FROM promo_codes WHERE code = ?').get('QA-PROMO-CANCEL');
  assert.equal(afterOrder.usedCount, 1);

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

  const afterCancel = await server.db.prepare('SELECT usedCount FROM promo_codes WHERE code = ?').get('QA-PROMO-CANCEL');
  assert.equal(afterCancel.usedCount, 0, 'cancelling the order should revert the promo usage it committed');

  // The freed-up usage should be usable again since maxUses was 1.
  const secondRes = await postOrder(orderPayload(`qa-promo-cancel-reuse-${Date.now()}`, { promoCode: 'QA-PROMO-CANCEL' }));
  assert.equal(secondRes.status, 201, 'after the reverting cancellation, the single-use code should be usable again');
});

test('CONCURRENT use near the usage limit: two concurrent orders competing for the last use of a maxUses=1 code — only one wins', async () => {
  await seedPromo('QA-PROMO-LASTUSE', { type: 'fixed', value: 10, maxUses: 1 });
  const [r1, r2] = await Promise.all([
    postOrder(orderPayload(`qa-promo-last-a-${Date.now()}`, {
      promoCode: 'QA-PROMO-LASTUSE',
      customer: { firstName: 'A', lastName: 'Race', email: 'qa-promo-race-a@example.com', phone: '1', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    })),
    postOrder(orderPayload(`qa-promo-last-b-${Date.now()}`, {
      promoCode: 'QA-PROMO-LASTUSE',
      customer: { firstName: 'B', lastName: 'Race', email: 'qa-promo-race-b@example.com', phone: '2', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    })),
  ]);

  const succeeded = [r1.status, r2.status].filter((s) => s === 201).length;
  const rejected = [r1.status, r2.status].filter((s) => s === 400).length;
  assert.equal(succeeded, 1, 'exactly one of the two concurrent orders should win the last use');
  assert.equal(rejected, 1, 'the other must be rejected, not silently given the discount for free');

  const promo = await server.db.prepare('SELECT usedCount, maxUses FROM promo_codes WHERE code = ?').get('QA-PROMO-LASTUSE');
  assert.equal(promo.usedCount, 1, 'usedCount must never exceed maxUses');
  assert.ok(promo.usedCount <= promo.maxUses);

  await server.db.prepare("DELETE FROM orders WHERE customerEmail IN ('qa-promo-race-a@example.com','qa-promo-race-b@example.com')").run();
});

test('NOTE (not implemented): promo codes have no per-customer usage restriction in this codebase', async () => {
  // server/promo-api.mjs's promo_codes table has no per-customer scoping
  // column, and validatePromoCode()/tryCommitPromoUsage() never look at
  // customerId — a single-use-per-customer restriction (as opposed to
  // maxUses being a global cap) is not supported. This test documents that
  // as a verified fact (two DIFFERENT customers can both use a maxUses=2
  // code) rather than silently skipping the requirement.
  await seedPromo('QA-PROMO-NO-PERCUSTOMER', { type: 'fixed', value: 5, maxUses: 2 });
  const r1 = await postOrder(orderPayload(`qa-promo-percust-a-${Date.now()}`, {
    promoCode: 'QA-PROMO-NO-PERCUSTOMER',
    customer: { firstName: 'A', lastName: 'X', email: 'qa-promo-percust-a@example.com', phone: '1', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  }));
  const r2 = await postOrder(orderPayload(`qa-promo-percust-b-${Date.now()}`, {
    promoCode: 'QA-PROMO-NO-PERCUSTOMER',
    customer: { firstName: 'A', lastName: 'X', email: 'qa-promo-percust-a@example.com', phone: '1', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  }));
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201, 'the SAME customer can use the same code twice, up to the global maxUses — there is no per-customer limit');

  await server.db.prepare("DELETE FROM orders WHERE customerEmail = 'qa-promo-percust-a@example.com'").run();
});
