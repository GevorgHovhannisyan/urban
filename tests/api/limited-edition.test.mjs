// Limited Edition Serial Number System — customer-chosen piece numbers, with
// the backend/database as the real source of truth (server/edition-api.mjs +
// server/order-api.mjs's validateItems/commitOrder). Covers: normal purchase
// gets no serial, a chosen number is honored, two customers can't collide on
// the same number, quantity > 1 needs that many distinct numbers, a taken
// number is rejected with the exact "no longer available" message, the
// edition can't oversell its configured total, concurrent orders for the
// same number never both succeed, cancellation releases/retains serials
// correctly, and normal checkout keeps working unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const LIMITED_PRODUCT_ID = '_test_limited_edition_product';
const NORMAL_PRODUCT_ID = '_test_normal_product';
const CONFLICT_MESSAGE = 'THIS PIECE IS NO LONGER AVAILABLE. PLEASE SELECT ANOTHER NUMBER.';

before(async () => {
  server = await startTestServer('limited-edition');
  BASE = server.baseUrl;
});

after(async () => {
  await server.db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(LIMITED_PRODUCT_ID, NORMAL_PRODUCT_ID);
  await server.db.prepare("DELETE FROM orders WHERE customerEmail LIKE 'edition-%@example.com'").run();
  await server.db.prepare('DELETE FROM edition_sales WHERE productId IN (?, ?)').run(LIMITED_PRODUCT_ID, NORMAL_PRODUCT_ID);
  await server.close();
});

async function seedProducts(total = 100) {
  const { toJson } = await import('../../server/db.mjs');
  await server.db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(LIMITED_PRODUCT_ID, NORMAL_PRODUCT_ID);
  await server.db.prepare('DELETE FROM edition_sales WHERE productId IN (?, ?)').run(LIMITED_PRODUCT_ID, NORMAL_PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew, isLimitedEdition, limitedEditionTotal)
    VALUES (?, 'Edition Test Hoodie', 100, '["Black"]', '["M"]', '[]', ?, 0, 1, ?)
  `).run(LIMITED_PRODUCT_ID, toJson({}), total);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew, isLimitedEdition, limitedEditionTotal)
    VALUES (?, 'Normal Test Tee', 40, '["Black"]', '["M"]', '[]', ?, 0, 0, NULL)
  `).run(NORMAL_PRODUCT_ID, toJson({}));
}

function orderPayload(email, productId, quantity, editionNumbers) {
  return {
    customer: { firstName: 'Edition', lastName: 'Test', email, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId, size: 'M', color: 'Black', quantity, ...(editionNumbers ? { editionNumbers } : {}) }],
    paymentMethod: 'cash_on_delivery',
  };
}

async function placeOrder(email, productId, quantity, editionNumbers) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(orderPayload(email, productId, quantity, editionNumbers)),
  });
  return { status: res.status, body: await res.json() };
}

async function trackOrder(orderNumber) {
  const res = await fetch(`${BASE}/api/orders/track/${orderNumber}`);
  return (await res.json()).order;
}

async function adminToken() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@urbanphoenix.com', password: 'ChangeMe123!' }),
  });
  return (await res.json()).token;
}

test('a normal (non-limited) purchase gets no serial', async () => {
  await seedProducts();
  const { status, body } = await placeOrder('edition-normal@example.com', NORMAL_PRODUCT_ID, 1);
  assert.equal(status, 201);
  const order = await trackOrder(body.orderNumber);
  assert.equal(order.items[0].isLimitedEdition, false);
  assert.deepEqual(order.items[0].editionNumbers, []);
});

test('a limited-edition purchase honors the customer-chosen serial', async () => {
  await seedProducts();
  const { status, body } = await placeOrder('edition-a@example.com', LIMITED_PRODUCT_ID, 1, [37]);
  assert.equal(status, 201);
  const order = await trackOrder(body.orderNumber);
  const item = order.items[0];
  assert.equal(item.isLimitedEdition, true);
  assert.equal(item.editionTotal, 100); // seeded total
  assert.deepEqual(item.editionNumbers, [37]);
});

test('two customers choosing different numbers both succeed', async () => {
  await seedProducts();
  const first = await placeOrder('edition-b1@example.com', LIMITED_PRODUCT_ID, 1, [1]);
  const second = await placeOrder('edition-b2@example.com', LIMITED_PRODUCT_ID, 1, [2]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const orderA = await trackOrder(first.body.orderNumber);
  const orderB = await trackOrder(second.body.orderNumber);
  assert.deepEqual(orderA.items[0].editionNumbers, [1]);
  assert.deepEqual(orderB.items[0].editionNumbers, [2]);
});

test('a second customer choosing an already-taken number is rejected with the exact conflict message', async () => {
  await seedProducts();
  const first = await placeOrder('edition-c1@example.com', LIMITED_PRODUCT_ID, 1, [5]);
  assert.equal(first.status, 201);

  const second = await placeOrder('edition-c2@example.com', LIMITED_PRODUCT_ID, 1, [5]);
  assert.notEqual(second.status, 201);
  assert.equal(second.body.error, CONFLICT_MESSAGE);
});

test('quantity 2 requires two distinct chosen numbers', async () => {
  await seedProducts();
  const rejected = await placeOrder('edition-d1@example.com', LIMITED_PRODUCT_ID, 2, [7]);
  assert.notEqual(rejected.status, 201, 'choosing fewer numbers than the quantity must be rejected');

  const { status, body } = await placeOrder('edition-d2@example.com', LIMITED_PRODUCT_ID, 2, [7, 8]);
  assert.equal(status, 201);
  const order = await trackOrder(body.orderNumber);
  assert.deepEqual(order.items[0].editionNumbers, [7, 8]);
});

test('a chosen number outside the product\'s real run size is rejected', async () => {
  await seedProducts(3); // only numbers 1-3 exist
  const { status, body } = await placeOrder('edition-e@example.com', LIMITED_PRODUCT_ID, 1, [99]);
  assert.notEqual(status, 201);
  assert.ok(body.error);
});

test('an edition cannot sell beyond its configured limitedEditionTotal', async () => {
  await seedProducts(2); // only 2 pieces total
  const first = await placeOrder('edition-f1@example.com', LIMITED_PRODUCT_ID, 1, [1]);
  const second = await placeOrder('edition-f2@example.com', LIMITED_PRODUCT_ID, 1, [2]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const third = await placeOrder('edition-f3@example.com', LIMITED_PRODUCT_ID, 1, [1]);
  assert.notEqual(third.status, 201, 'the only two numbers are already taken');
  assert.equal(third.body.error, CONFLICT_MESSAGE);

  const rows = await server.db.prepare('SELECT number FROM edition_sales WHERE productId = ?').all(LIMITED_PRODUCT_ID);
  assert.equal(rows.length, 2, 'never more edition_sales rows than the configured total');
});

test('two customers simultaneously choosing the SAME number: exactly one succeeds, never both', async () => {
  await seedProducts();
  const results = await Promise.all([
    placeOrder('edition-g1@example.com', LIMITED_PRODUCT_ID, 1, [42]),
    placeOrder('edition-g2@example.com', LIMITED_PRODUCT_ID, 1, [42]),
    placeOrder('edition-g3@example.com', LIMITED_PRODUCT_ID, 1, [42]),
  ]);
  const succeeded = results.filter((r) => r.status === 201);
  assert.equal(succeeded.length, 1, 'exactly one of three concurrent orders for the same chosen number succeeds');
  const rejected = results.filter((r) => r.status !== 201);
  for (const r of rejected) assert.equal(r.body.error, CONFLICT_MESSAGE);

  const rows = await server.db.prepare('SELECT number FROM edition_sales WHERE productId = ? AND number = ?').all(LIMITED_PRODUCT_ID, 42);
  assert.equal(rows.length, 1);
});

test('cancelling a limited-edition order before it ships releases its serial back to the pool', async () => {
  await seedProducts(1);
  const { status, body } = await placeOrder('edition-h@example.com', LIMITED_PRODUCT_ID, 1, [1]);
  assert.equal(status, 201);
  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE orderNumber = ?').get(body.orderNumber);

  const token = await adminToken();
  const cancelRes = await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const rows = await server.db.prepare('SELECT number FROM edition_sales WHERE productId = ?').all(LIMITED_PRODUCT_ID);
  assert.equal(rows.length, 0, 'cancelling a pre-fulfillment order releases its serial');

  // The freed serial is available to a new order again.
  const retry = await placeOrder('edition-h2@example.com', LIMITED_PRODUCT_ID, 1, [1]);
  assert.equal(retry.status, 201);
});

test('a shipped order that is later cancelled never releases its serial back to the pool', async () => {
  await seedProducts(1);
  const { status, body } = await placeOrder('edition-i@example.com', LIMITED_PRODUCT_ID, 1, [1]);
  assert.equal(status, 201);
  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE orderNumber = ?').get(body.orderNumber);

  const token = await adminToken();
  await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'shipped' }),
  });
  await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });

  const rows = await server.db.prepare('SELECT number FROM edition_sales WHERE productId = ?').all(LIMITED_PRODUCT_ID);
  assert.equal(rows.length, 1, 'a shipped piece stays permanently retired even after cancellation');
});

test('normal (non-limited) checkout still works exactly as before', async () => {
  await seedProducts();
  const { status, body } = await placeOrder('edition-normal-2@example.com', NORMAL_PRODUCT_ID, 2);
  assert.equal(status, 201);
  assert.equal(body.status, 'confirmed');
});
