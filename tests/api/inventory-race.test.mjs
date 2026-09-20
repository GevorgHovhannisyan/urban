// Concurrency test for the atomic stock decrement fix
// (server/products-api.mjs's tryDecrementVariantStock, wired into
// server/order-api.mjs's commitOrder). Two genuinely concurrent orders
// (fired via Promise.all — both requests in flight before either resolves)
// for the last unit of a size/color: exactly one must succeed, the other
// must get a clean rejection, and stock must never go negative.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PRODUCT_ID = '_test_inventory_race_product';

before(async () => {
  server = await startTestServer('inventory-race');
  BASE = server.baseUrl;
});

after(async () => {
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare("DELETE FROM orders WHERE customerEmail LIKE 'race-%@example.com'").run();
  await server.close();
});

async function orderPayload(email) {
  return {
    customer: { firstName: 'Race', lastName: 'Test', email, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'idram',
  };
}

async function placeOrder(email) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await orderPayload(email)),
  });
  return { status: res.status, body: await res.json() };
}

test('two simultaneous orders for the last unit of a variant: exactly one succeeds, the other gets a clean out-of-stock response, stock never goes negative', async () => {
  const { toJson, fromJson } = await import('../../server/db.mjs');
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Race Test Product', 50, '["Black"]', '["M"]', '[]', ?, 0)
  `).run(PRODUCT_ID, toJson({ 'M|Black': 1 }));

  // Both requests are started before either is awaited — genuinely
  // concurrent from the server's point of view, not sequential.
  const [a, b] = await Promise.all([
    placeOrder('race-a@example.com'),
    placeOrder('race-b@example.com'),
  ]);

  const results = [a, b];
  const succeeded = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status !== 201);

  assert.equal(succeeded.length, 1, 'exactly one of the two concurrent orders must succeed');
  assert.equal(rejected.length, 1, 'exactly one of the two concurrent orders must be rejected');
  // Which layer catches the loser depends on exact interleaving: if the
  // winner's atomic commit finishes before the loser's own pre-check runs,
  // validateItems() catches it early (400, "Only 0 left"/"sold out"); if
  // both pre-checks pass before either commits, the atomic
  // tryDecrementVariantStock in commitOrder catches it instead (409). Both
  // are the "clean rejection" this test cares about — neither is a crash or
  // an oversell — so this only asserts the outcome, not which layer named it.
  assert.ok([400, 409].includes(rejected[0].status), `expected a clean 400 or 409 rejection, got ${rejected[0].status}`);
  assert.match(rejected[0].body.error, /sold out|left of/i);

  const row = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const finalStock = fromJson(row.stock, {});
  assert.equal(finalStock['M|Black'], 0, 'stock lands at exactly 0');
  assert.ok(finalStock['M|Black'] >= 0, 'stock must never go negative');
});

test('sanity check against the old bug: three concurrent orders for a variant with stock 1 never produce more than one confirmed order', async () => {
  const { toJson, fromJson } = await import('../../server/db.mjs');
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Race Test Product 2', 50, '["Black"]', '["M"]', '[]', ?, 0)
  `).run(PRODUCT_ID, toJson({ 'M|Black': 1 }));

  const results = await Promise.all([
    placeOrder('race-c@example.com'),
    placeOrder('race-d@example.com'),
    placeOrder('race-e@example.com'),
  ]);

  const succeeded = results.filter((r) => r.status === 201);
  assert.equal(succeeded.length, 1, 'exactly one of three concurrent orders for a single unit succeeds');

  const row = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const finalStock = fromJson(row.stock, {});
  assert.equal(finalStock['M|Black'], 0);
});

test('cancelling the winning order restores the unit to purchasable stock (existing restoration behavior preserved)', async () => {
  const { toJson, fromJson } = await import('../../server/db.mjs');
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Race Test Product 3', 50, '["Black"]', '["M"]', '[]', ?, 0)
  `).run(PRODUCT_ID, toJson({ 'M|Black': 1 }));

  const { status, body } = await placeOrder('race-f@example.com');
  assert.equal(status, 201);

  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE orderNumber = ?').get(body.orderNumber);
  const adminToken = await (async () => {
    const res = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@urbanphoenix.com', password: 'ChangeMe123!' }),
    });
    return (await res.json()).token;
  })();

  const cancelRes = await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const row = await server.db.prepare('SELECT stock FROM products WHERE id = ?').get(PRODUCT_ID);
  const finalStock = fromJson(row.stock, {});
  assert.equal(finalStock['M|Black'], 1, 'cancelling restores the unit to stock');
});
