// Integration tests against a real Express server + isolated temp database.
// Covers the "FREE U.S. SHIPPING ON ORDERS $150+" rule (server/delivery.mjs,
// called from server/order-api.mjs's validateOrderDraft): inclusive —
// subtotal >= $150.00 qualifies, not strictly greater-than. Shipping is a
// flat 10,000 AMD fee, stored/charged in the app's internal USD base via the
// existing AMD rate (390, shared with the frontend's AppContext.jsx currency
// model) — never a client-supplied value.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PRODUCT_ID = '_test_shipping_rule_product';
const EMAIL = 'qa-shipping@example.com';
// Same conversion the app itself uses (server/order-api.mjs, src/context/AppContext.jsx).
const AMD_SHIPPING_FEE_USD = Number((10000 / 390).toFixed(2));

async function seedProductAtPrice(price) {
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Shipping Product', ?, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID, price);
}

function usOrderPayload(idempotencyKey, overrides = {}) {
  return {
    region: 'US',
    regionalPricing: true,
    customer: { firstName: 'QA', lastName: 'Shipping', email: EMAIL, phone: '123', country: 'United States', city: 'New York', postalCode: '10001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'card',
    idempotencyKey,
    ...overrides,
  };
}

before(async () => {
  server = await startTestServer('shipping-rule');
  BASE = server.baseUrl;
});

beforeEach(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM pending_checkouts').run();
});

after(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.close();
});

// validateOrderDraft() applies a 1.15x US regional price multiplier before
// computing shipping eligibility (see server/order-api.mjs) — set each
// product's base price so the resulting US-adjusted subtotal lands exactly
// on the dollar amount each test needs to verify.
const priceForUsSubtotal = (targetSubtotal) => Number((targetSubtotal / 1.15).toFixed(4));

async function draftAtSubtotal(targetSubtotal) {
  await seedProductAtPrice(priceForUsSubtotal(targetSubtotal));
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  return validateOrderDraft(usOrderPayload(undefined));
}

test('1. US subtotal $149.99 -> 10,000 AMD shipping is charged', async () => {
  const result = await draftAtSubtotal(149.99);
  assert.equal(result.error, undefined);
  assert.ok(Math.abs(result.value.subtotal - 149.99) < 0.01, `test setup: subtotal should be ~149.99, got ${result.value.subtotal}`);
  assert.equal(result.value.shipping, AMD_SHIPPING_FEE_USD);
});

test('2. US subtotal $150.00 (exactly at threshold) -> FREE shipping (inclusive >=150)', async () => {
  // Deliberately bypasses draftAtSubtotal/priceForUsSubtotal's 1.15x regional-
  // pricing round-trip through the products table (DECIMAL(12,2) — a price
  // like 130.4348 gets stored as 130.43, then *1.15 lands on $149.99, one
  // cent short of $150.00, which would falsely fail this exact-boundary
  // check for a rounding reason that has nothing to do with the shipping
  // rule itself). The US *shipping* zone only cares about
  // customer.country (see server/delivery.mjs) — it's entirely independent
  // of the `region`/`regionalPricing` flags that drive the 1.15x price
  // multiplier, so omitting those here still exercises the real
  // shipping-zone code path with an exact, round-tripping $150.00 price.
  await seedProductAtPrice(150.00);
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const result = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'Shipping', email: EMAIL, phone: '123', country: 'United States', city: 'New York', postalCode: '10001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'card',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.subtotal, 150.00, `test setup: subtotal should be exactly 150.00, got ${result.value.subtotal}`);
  assert.equal(result.value.shipping, 0, 'a $150.00 order must qualify for free shipping — the rule is ">=150", not ">150"');
});

test('3. US subtotal $150.01 -> free shipping', async () => {
  const result = await draftAtSubtotal(150.01);
  assert.equal(result.error, undefined);
  assert.ok(Math.abs(result.value.subtotal - 150.01) < 0.01, `test setup: subtotal should be ~150.01, got ${result.value.subtotal}`);
  assert.equal(result.value.shipping, 0);
});

test('4. US subtotal $200.00 -> free shipping', async () => {
  const result = await draftAtSubtotal(200.00);
  assert.equal(result.error, undefined);
  assert.equal(result.value.shipping, 0);
});

test('6. the 10,000 AMD shipping fee (USD-equivalent) is included in the final Total when charged', async () => {
  const result = await draftAtSubtotal(149.99);
  const expectedTotal = Number((result.value.subtotal + AMD_SHIPPING_FEE_USD).toFixed(2));
  assert.equal(result.value.total, expectedTotal);
});

test('7. shipping is excluded from the final Total when free', async () => {
  const result = await draftAtSubtotal(200.00);
  assert.equal(result.value.total, result.value.subtotal);
});

test('8. dynamic recalculation: subtotal moving from above the threshold to below it brings shipping back', async () => {
  const above = await draftAtSubtotal(160);
  assert.equal(above.value.shipping, 0);
  const below = await draftAtSubtotal(140);
  assert.equal(below.value.shipping, AMD_SHIPPING_FEE_USD);
});

test('9. dynamic recalculation: subtotal moving from below the threshold to above it removes shipping', async () => {
  const below = await draftAtSubtotal(120);
  assert.equal(below.value.shipping, AMD_SHIPPING_FEE_USD);
  const above = await draftAtSubtotal(180);
  assert.equal(above.value.shipping, 0);
});

test('10. SERVER AUTHORITY: a client sending shipping:0 in the payload cannot force free shipping on a non-qualifying order', async () => {
  await seedProductAtPrice(priceForUsSubtotal(100)); // well under $150
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...usOrderPayload(`qa-ship-forge-${Date.now()}`, { paymentMethod: 'paypal' }), shipping: 0, internationalSurcharge: 0 }),
  });
  assert.equal(res.status, 201);
  const order = await server.db.prepare('SELECT shipping FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  assert.equal(order.shipping, AMD_SHIPPING_FEE_USD, 'the server must compute shipping itself and ignore a client-supplied shipping:0');
  await seedProductAtPrice(100);
});

test('11. SERVER AUTHORITY: a client sending a fake, inflated subtotal cannot manufacture free shipping or a fake charge amount', async () => {
  await seedProductAtPrice(priceForUsSubtotal(50)); // real US-adjusted subtotal ~$50, well under $150
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...usOrderPayload(`qa-subtotal-forge-${Date.now()}`, { paymentMethod: 'paypal' }), subtotal: 200, total: 200 }),
  });
  assert.equal(res.status, 201);
  const order = await server.db.prepare('SELECT subtotal, shipping, total FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  assert.ok(Math.abs(order.subtotal - 50) < 0.5, `subtotal must be computed from the real product price (~50), not the client-supplied 200 — got ${order.subtotal}`);
  assert.equal(order.shipping, AMD_SHIPPING_FEE_USD, 'a real ~$50 subtotal does not qualify for free shipping regardless of what the client claimed the subtotal was');
  assert.notEqual(order.total, 200);
});

test('12. Stripe PaymentIntent amount equals the authoritative backend-computed total', async () => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_fake_shipping_rule_0000000000';
  process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_fake_shipping_rule_0000000000';
  await seedProductAtPrice(priceForUsSubtotal(140)); // under threshold -> shipping charged
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const draft = await validateOrderDraft(usOrderPayload(undefined, { paymentMethod: 'card' }));
  assert.equal(draft.error, undefined);

  // createPaymentIntent() itself calls Stripe's real API (network) — instead,
  // verify the exact same computation it performs (Math.round(total*100))
  // against the same authoritative draft, which is what tests/api/
  // stripe-webhook.test.mjs already proves end-to-end without live keys for
  // the webhook side. This confirms the shipping-inclusive total is what
  // would be sent to Stripe in cents, matching the persisted order exactly.
  const expectedAmountInCents = Math.round(draft.value.total * 100);
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(usOrderPayload(`qa-stripe-parity-${Date.now()}`, { paymentMethod: 'paypal' })),
  });
  assert.equal(res.status, 201);
  const order = await server.db.prepare('SELECT total FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  assert.equal(Math.round(order.total * 100), expectedAmountInCents, 'the persisted order total (in cents) must equal what would be sent to Stripe as the PaymentIntent amount');
  await seedProductAtPrice(100);
});

test('13. persisted order total equals the authoritative backend-computed total, including the shipping charge', async () => {
  await seedProductAtPrice(priceForUsSubtotal(130));
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(usOrderPayload(`qa-persisted-total-${Date.now()}`, { paymentMethod: 'paypal' })),
  });
  assert.equal(res.status, 201);
  const order = await server.db.prepare('SELECT subtotal, shipping, total FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  assert.equal(order.shipping, AMD_SHIPPING_FEE_USD);
  assert.equal(Number(order.total.toFixed(2)), Number((order.subtotal + order.shipping).toFixed(2)));
  await seedProductAtPrice(100);
});

test('14. the checkout delivery address overrides detected/claimed region — a visitor detected as Armenia but shipping to a U.S. address gets the U.S. rule, not Armenia-free', async () => {
  await seedProductAtPrice(priceForUsSubtotal(100)); // well under $150 -> should be charged if the US rule correctly applies
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const result = await validateOrderDraft({
    // Claims to be an Armenian visitor (this is what visitorCountry/region
    // detection would send) — but the real delivery address is the U.S.
    region: 'AM',
    customer: { firstName: 'QA', lastName: 'Mismatch', email: EMAIL, phone: '123', country: 'United States', city: 'New York', postalCode: '10001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.shipping, AMD_SHIPPING_FEE_USD, 'the real United States delivery address must be charged the US under-$150 rate, never treated as Armenia-free just because region detection claimed Armenia');
});

test('Armenia orders are unaffected by the US $150 rule (existing Armenia-free behavior preserved)', async () => {
  await seedProductAtPrice(50);
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const armeniaDraft = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'Armenia', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.equal(armeniaDraft.value.shipping, 0, 'Armenia orders remain free-shipping regardless of subtotal — unchanged by this rule');
});

test('16. SUPPORTED COUNTRIES: an order to a country other than Armenia/United States is rejected outright, by full name or ISO code', async () => {
  await seedProductAtPrice(50);
  const { validateOrderDraft } = await import('../../server/order-api.mjs');
  const expectedError = 'We currently ship only to Armenia and the United States. Please select one of those as your delivery country.';

  const franceDraft = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'France', email: EMAIL, phone: '123', country: 'France', city: 'Paris', postalCode: '75001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.equal(franceDraft.error, expectedError, 'France is no longer a supported shipping destination — the order must be rejected, not silently priced at the flat international rate');

  const germanyByCode = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'CodeDE', email: EMAIL, phone: '123', country: 'DE', city: 'Berlin', postalCode: '10115', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.equal(germanyByCode.error, expectedError, 'the ISO code form ("DE") must be rejected identically to the full name ("Germany")');

  // SERVER AUTHORITY: confirm the same rejection happens through the real
  // HTTP endpoint, not just the internal validateOrderDraft() helper — a
  // forged/tampered request naming an unsupported country must never reach
  // order creation.
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: { firstName: 'QA', lastName: 'Forge', email: EMAIL, phone: '123', country: 'Japan', city: 'Tokyo', postalCode: '100-0001', address: '1 St' },
      items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
      paymentMethod: 'paypal',
      idempotencyKey: `qa-unsupported-country-${Date.now()}`,
    }),
  });
  assert.equal(res.status, 400, 'an order naming an unsupported country must be rejected by the API, not created');
  const body = await res.json();
  assert.equal(body.error, expectedError);
});

test('15. ISO 3166-1 alpha-2 country codes resolve identically to the historical full-name strings (new CountrySelect stores codes; old orders/addresses still have full names)', async () => {
  const { validateOrderDraft } = await import('../../server/order-api.mjs');

  await seedProductAtPrice(50);
  const armeniaByCode = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'CodeAM', email: EMAIL, phone: '123', country: 'AM', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.equal(armeniaByCode.value.shipping, 0, 'country: "AM" (code) must ship free, same as "Armenia" (legacy full name)');

  await seedProductAtPrice(priceForUsSubtotal(100)); // under $150
  const usByCode = await validateOrderDraft({
    customer: { firstName: 'QA', lastName: 'CodeUS', email: EMAIL, phone: '123', country: 'US', city: 'New York', postalCode: '10001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
  });
  assert.equal(usByCode.value.shipping, AMD_SHIPPING_FEE_USD, 'country: "US" (code), under $150, must be charged — same as "United States" (legacy full name)');
  await seedProductAtPrice(100);
});
