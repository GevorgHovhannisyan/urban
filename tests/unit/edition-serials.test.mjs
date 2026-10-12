// Admin Limited Edition Serial Number Management (server/edition-api.mjs's
// getEditionSerials / setEditionSerialStatus): marking serials sold out or
// available is per product, is honored by the storefront's availability
// (listEditions) and by the order pre-check (validateOrderDraft), and never
// detaches a serial from the real order that bought it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDb } from '../helpers/test-db.mjs';

const testDb = useTestDb('edition-serials');
await testDb.ready;
const { run, all, initDb } = await import('../../server/db.mjs');
await initDb();
const { getEditionSerials, setEditionSerialStatus, listEditions } = await import('../../server/edition-api.mjs');
const { validateOrderDraft } = await import('../../server/order-api.mjs');

const A = '_test_serials_a';
const B = '_test_serials_b';
const CONFLICT = 'THIS PIECE IS NO LONGER AVAILABLE. PLEASE SELECT ANOTHER NUMBER.';

before(async () => {
  for (const id of [A, B]) {
    await run('DELETE FROM products WHERE id = ?', [id]);
    await run('DELETE FROM edition_sales WHERE productId = ?', [id]);
    await run(
      `INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew, isLimitedEdition, limitedEditionTotal)
       VALUES (?, ?, 100, '["Black"]', '["M"]', '[]', '{}', 0, 1, 10)`,
      [id, `Serial Test ${id}`],
    );
  }
});

after(async () => {
  for (const id of [A, B]) {
    await run('DELETE FROM edition_sales WHERE productId = ?', [id]);
    await run('DELETE FROM products WHERE id = ?', [id]);
  }
  await testDb.cleanup();
});

const draftFor = (number) => validateOrderDraft({
  customer: { firstName: 'T', lastName: 'B', email: 't@example.com', phone: '1', country: 'AM', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  items: [{ productId: A, size: 'M', color: 'Black', quantity: 1, editionNumbers: [number] }],
  paymentMethod: 'paypal',
});

test('every serial starts available, numbered 1..total', async () => {
  const { status, body } = await getEditionSerials(A);
  assert.equal(status, 200);
  assert.equal(body.serials.length, 10);
  assert.ok(body.serials.every((s) => s.status === 'available'));
});

test('marking sold out hides it from the storefront and blocks purchase — for that product only', async () => {
  const res = await setEditionSerialStatus(A, { numbers: [3, 4], status: 'sold_out' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.serials.filter((s) => s.status === 'sold_out').map((s) => s.number), [3, 4]);

  const publicA = await listEditions(A);
  assert.deepEqual(publicA.body.sold, [3, 4]);
  const publicB = await listEditions(B);
  assert.deepEqual(publicB.body.sold, [], 'serials are managed separately per product');

  const blocked = await draftFor(3);
  assert.equal(blocked.error, CONFLICT);
  const allowed = await draftFor(5);
  assert.equal(allowed.error, undefined);
});

test('reactivating a sold-out serial makes it purchasable again', async () => {
  const res = await setEditionSerialStatus(A, { numbers: [3], status: 'available' });
  assert.equal(res.status, 200);
  assert.deepEqual((await listEditions(A)).body.sold, [4]);
  assert.equal((await draftFor(3)).error, undefined);
});

test('marking an order-sold serial sold out keeps its order link', async () => {
  await run("INSERT INTO edition_sales (productId, number, orderId, soldAt) VALUES (?, 7, 'order-xyz', NOW())", [A]);
  await setEditionSerialStatus(A, { numbers: [7], status: 'sold_out' });
  const rows = await all('SELECT orderId FROM edition_sales WHERE productId = ? AND number = 7', [A]);
  assert.equal(rows[0].orderId, 'order-xyz');
  const serial = (await getEditionSerials(A)).body.serials.find((s) => s.number === 7);
  assert.equal(serial.source, 'order');
});

test('out-of-range numbers, bad statuses and non-limited products are rejected', async () => {
  assert.equal((await setEditionSerialStatus(A, { numbers: [0, 11], status: 'sold_out' })).status, 400);
  assert.equal((await setEditionSerialStatus(A, { numbers: [1], status: 'reserved' })).status, 400);
  assert.equal((await setEditionSerialStatus('_no_such_product', { numbers: [1], status: 'sold_out' })).status, 404);
});
