// Product drop dates (releaseAt / earlyAccessAt): the admin sends ISO-8601
// UTC strings ("...Z"), which MySQL's DATETIME rejects in strict mode — so
// products-api.mjs must store them as "YYYY-MM-DD HH:MM:SS" UTC and return
// them as ISO UTC again, without any timezone drift, and compute the drop
// status from them correctly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDb } from '../helpers/test-db.mjs';

const testDb = useTestDb('drop-dates');
await testDb.ready;
const { run, get, initDb } = await import('../../server/db.mjs');
await initDb();
const { createProduct, updateProduct, getProduct } = await import('../../server/products-api.mjs');

let productId;
const base = { name: 'Drop Date Test', price: 100, colors: ['Black'], sizes: ['M'], images: [], stock: {} };

before(async () => {
  const res = await createProduct({ ...base });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  productId = res.body.product.id;
});

after(async () => {
  if (productId) await run('DELETE FROM products WHERE id = ?', [productId]);
  await testDb.cleanup();
});

test('ISO UTC dates are stored as MySQL DATETIME text and returned as the same instant', async () => {
  const releaseAt = '2099-10-20T08:00:00.000Z';
  const earlyAccessAt = '2099-10-19T08:00:00.000Z';
  const res = await updateProduct(productId, { ...base, releaseAt, earlyAccessAt });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const raw = await get('SELECT releaseAt, earlyAccessAt FROM products WHERE id = ?', [productId]);
  assert.equal(raw.releaseAt, '2099-10-20 08:00:00');
  assert.equal(raw.earlyAccessAt, '2099-10-19 08:00:00');

  const product = await getProduct(productId);
  assert.equal(product.releaseAt, releaseAt);
  assert.equal(product.earlyAccessAt, earlyAccessAt);
  assert.equal(product.dropStatus, 'upcoming');
});

test('a release date in the past with early access open makes the product live', async () => {
  const res = await updateProduct(productId, { ...base, releaseAt: '2020-01-01T00:00:00.000Z', earlyAccessAt: null });
  assert.equal(res.status, 200);
  assert.equal((await getProduct(productId)).dropStatus, 'live');
});

test('early-access window: after early access opens, before release', async () => {
  const now = Date.now();
  await updateProduct(productId, {
    ...base,
    earlyAccessAt: new Date(now - 3600e3).toISOString(),
    releaseAt: new Date(now + 3600e3).toISOString(),
  });
  assert.equal((await getProduct(productId)).dropStatus, 'early-access');
});

test('clearing the dates makes the product always live', async () => {
  const res = await updateProduct(productId, { ...base, releaseAt: null, earlyAccessAt: '' });
  assert.equal(res.status, 200);
  const product = await getProduct(productId);
  assert.equal(product.releaseAt, null);
  assert.equal(product.dropStatus, 'live');
});

test('invalid dates and early access after release are rejected', async () => {
  const bad = await updateProduct(productId, { ...base, releaseAt: 'not-a-date' });
  assert.equal(bad.status, 400);
  const order = await updateProduct(productId, { ...base, releaseAt: '2099-01-01T00:00:00.000Z', earlyAccessAt: '2099-02-01T00:00:00.000Z' });
  assert.equal(order.status, 400);
});
