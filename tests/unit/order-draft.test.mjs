import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDb } from '../helpers/test-db.mjs';

// Must run before any server/*.mjs import — db.mjs reads DB_NAME at import
// time, so the env var has to be set (and the database created) first. See
// tests/helpers/test-db.mjs.
const testDb = useTestDb('order-draft');
await testDb.ready;
const { run, toJson, initDb } = await import('../../server/db.mjs');
await initDb();
const { validateOrderDraft, FREE_US_SHIPPING_THRESHOLD } = await import('../../server/order-api.mjs');

const PRODUCT_ID = '_test_order_draft_product';
const CHEAP_PRICE = 50; // below the US free-shipping threshold
const EXPENSIVE_PRICE = 200; // above it

before(async () => {
  await run('DELETE FROM products WHERE id = ?', [PRODUCT_ID]);
  await run(
    `INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
     VALUES (?, 'Test Draft Product', ?, '["Black"]', '["M"]', '[]', '{}', 0)`,
    [PRODUCT_ID, CHEAP_PRICE]
  );
});

after(async () => {
  await run('DELETE FROM products WHERE id = ?', [PRODUCT_ID]);
  await testDb.cleanup();
});

const baseCustomer = (country) => ({
  firstName: 'Test', lastName: 'Buyer', email: 'test@example.com', phone: '123',
  country, city: 'City', postalCode: '0001', address: '1 St',
});

const draftFor = async (country, isUS = false, priceOverride) => {
  if (priceOverride !== undefined) {
    await run('UPDATE products SET price = ? WHERE id = ?', [priceOverride, PRODUCT_ID]);
  }
  return validateOrderDraft({
    customer: baseCustomer(country),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
    region: isUS ? 'US' : undefined,
  });
};

test('Armenia orders are always free shipping', async () => {
  const result = await draftFor('Armenia', false, CHEAP_PRICE);
  assert.equal(result.error, undefined);
  assert.equal(result.value.shipping, 0);
});

test('US orders under the free-shipping threshold are charged the international surcharge', async () => {
  const result = await draftFor('United States', true, CHEAP_PRICE * 1); // subtotal well under $150 after 1.15x multiplier
  assert.equal(result.error, undefined);
  assert.ok(result.value.subtotal < FREE_US_SHIPPING_THRESHOLD, 'test setup should keep subtotal under the threshold');
  assert.ok(result.value.shipping > 0, 'expected a non-zero shipping charge below the free-shipping threshold');
});

test('US orders at/above the free-shipping threshold ship for free', async () => {
  const result = await draftFor('United States', true, EXPENSIVE_PRICE);
  assert.equal(result.error, undefined);
  assert.ok(result.value.subtotal >= FREE_US_SHIPPING_THRESHOLD);
  assert.equal(result.value.shipping, 0);
});

test('US subtotal at exactly $150.00 ships for free (inclusive >=150 boundary)', async () => {
  // isUS=false here (no region:'US') deliberately — the shipping zone only
  // cares about customer.country (server/delivery.mjs), which is
  // independent of the region/regionalPricing flags that drive the 1.15x
  // US price multiplier. Skipping that multiplier means this $150.00 price
  // round-trips through the DECIMAL(12,2) products column exactly, instead
  // of landing one rounding cent short the way price/1.15*1.15 could.
  const result = await draftFor('United States', false, FREE_US_SHIPPING_THRESHOLD);
  assert.equal(result.error, undefined);
  assert.equal(result.value.subtotal, FREE_US_SHIPPING_THRESHOLD, `subtotal should be exactly 150, got ${result.value.subtotal}`);
  assert.equal(result.value.shipping, 0, 'exactly $150.00 must qualify for free shipping — the rule is >=150, not >150');
});

test('a country other than Armenia/United States is rejected outright — Urban Phoenix currently ships only to those two', async () => {
  const result = await draftFor('France', false, EXPENSIVE_PRICE);
  assert.equal(result.error, 'We currently ship only to Armenia and the United States. Please select one of those as your delivery country.');
});

test('an invalid/unknown product id is rejected, not silently priced at $0', async () => {
  const result = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: '_does_not_exist', size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.ok(result.error, 'expected a validation error for a nonexistent product');
});

test('quantity of 0 is rejected', async () => {
  const result = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 0 }],
    paymentMethod: 'paypal',
  });
  assert.ok(result.error);
});

test('an invalid payment method is rejected', async () => {
  const result = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'bitcoin',
  });
  assert.ok(result.error);
});

test('14/15. cash on delivery has been removed — a legacy "cash" payment method is rejected, same as any other invalid value', async () => {
  const result = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'cash',
  });
  assert.ok(result.error, 'a request with paymentMethod: "cash" must be rejected, not silently accepted');
  assert.match(result.error, /valid payment method/i);
});

test('an unavailable size/color combination is rejected', async () => {
  const result = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'XXXL', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.ok(result.error);
});

test('stock-tracked variant rejects a quantity exceeding available stock', async () => {
  await run('UPDATE products SET stock = ? WHERE id = ?', [toJson({ 'M|Black': 2 }), PRODUCT_ID]);
  const ok = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 2 }],
    paymentMethod: 'paypal',
  });
  assert.equal(ok.error, undefined, 'requesting exactly the available quantity should succeed');

  const tooMany = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 3 }],
    paymentMethod: 'paypal',
  });
  assert.ok(tooMany.error, 'requesting more than available stock should be rejected');
  await run('UPDATE products SET stock = ? WHERE id = ?', ['{}', PRODUCT_ID]);
});

test('a tampered/forged unit price in the item payload is ignored — price always comes from the server-side product record', async () => {
  await run('UPDATE products SET price = ? WHERE id = ?', [CHEAP_PRICE, PRODUCT_ID]);
  const result = await validateOrderDraft({
    customer: baseCustomer('Armenia'),
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1, price: 0.01, unitPrice: 0.01 }],
    paymentMethod: 'paypal',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.items[0].unitPrice, CHEAP_PRICE, 'client-supplied price fields must be ignored');
  assert.equal(result.value.subtotal, CHEAP_PRICE);
});
