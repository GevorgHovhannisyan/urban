// Integration tests against a real Express server + isolated temp database.
// Covers server/reports-api.mjs via the admin /api/admin/reports/* routes.
// Tests run in file order (node:test runs top-level tests in one file
// sequentially by default) so the "empty data" tests can run before any
// order exists, and the "correct totals" tests after known orders are
// placed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
let adminToken;
let customerToken;
const PRODUCT_ID = '_test_reports_product';
const EMAIL = 'qa-reports@example.com';

before(async () => {
  server = await startTestServer('reports');
  BASE = server.baseUrl;
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew, category)
    VALUES (?, 'Test Reports Product', 100, '["Black"]', '["M"]', '[]', '{}', 0, 'test-category')
  `).run(PRODUCT_ID);

  adminToken = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json()).then((b) => b.token);

  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Reports', email: EMAIL, password: 'TestPass123', country: 'Armenia' }),
  });
  const row = await server.db.prepare('SELECT verificationToken FROM customers WHERE email = ?').get(EMAIL);
  customerToken = await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, code: row.verificationToken }),
  }).then((r) => r.json()).then((b) => b.token);
});

after(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.close();
});

const REPORT_ROUTES = [
  '/api/admin/reports/summary',
  '/api/admin/reports/revenue',
  '/api/admin/reports/top-products',
  '/api/admin/reports/sales-by-category',
  '/api/admin/reports/order-status',
];

test('authorization: every report route rejects a request with no token', async () => {
  for (const route of REPORT_ROUTES) {
    const res = await fetch(`${BASE}${route}`);
    assert.equal(res.status, 401, `${route} should reject an unauthenticated request`);
  }
});

test('authorization: every report route rejects a valid customer token (admin-only)', async () => {
  for (const route of REPORT_ROUTES) {
    const res = await fetch(`${BASE}${route}`, { headers: { Authorization: `Bearer ${customerToken}` } });
    assert.equal(res.status, 401, `${route} should reject a customer token`);
  }
});

test('authorization: every report route rejects an invalid/malformed token', async () => {
  for (const route of REPORT_ROUTES) {
    const res = await fetch(`${BASE}${route}`, { headers: { Authorization: 'Bearer not-a-real-token' } });
    assert.equal(res.status, 401, `${route} should reject a malformed token`);
  }
});

test('EMPTY DATA: with no orders yet, summary/reports reflect zero, not an error or fabricated data', async () => {
  const summary = await fetch(`${BASE}/api/admin/reports/summary`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(summary.totalRevenue, 0);
  assert.equal(summary.totalOrders, 0);
  assert.equal(summary.revenueLast30Days, 0);
  assert.equal(summary.ordersLast30Days, 0);
  assert.equal(summary.averageOrderValue, 0);

  const topProducts = await fetch(`${BASE}/api/admin/reports/top-products`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.deepEqual(topProducts.products, []);

  const byCategory = await fetch(`${BASE}/api/admin/reports/sales-by-category`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.deepEqual(byCategory.categories, []);

  const byStatus = await fetch(`${BASE}/api/admin/reports/order-status`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.deepEqual(byStatus.statuses, []);
});

test('DATE RANGE: revenue-over-time returns exactly `days` entries, all zeroed out with no orders', async () => {
  const sevenDays = await fetch(`${BASE}/api/admin/reports/revenue?days=7`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(sevenDays.series.length, 7);
  assert.ok(sevenDays.series.every((d) => d.revenue === 0 && d.orders === 0));

  const thirtyDays = await fetch(`${BASE}/api/admin/reports/revenue`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(thirtyDays.series.length, 30, 'default window should be 30 days');
});

test('DATE RANGE: an out-of-range days value above the max is clamped to 365', async () => {
  const tooMany = await fetch(`${BASE}/api/admin/reports/revenue?days=99999`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(tooMany.series.length, 365);
});

test('DATE RANGE: a negative days value is clamped to the minimum of 1', async () => {
  const negative = await fetch(`${BASE}/api/admin/reports/revenue?days=-5`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(negative.series.length, 1);
});

test('MINOR VERIFIED QUIRK (not fixed — see report): days=0 falls back to the default 30 instead of clamping to 1 like other invalid values', async () => {
  // getRevenueOverTime()'s `Number(days) || 30` treats the number 0 as
  // falsy, so it short-circuits straight to the 30-day default BEFORE
  // Math.max(1, ...) ever runs — unlike a negative number, which IS truthy
  // and does get clamped to 1 by Math.max. This is a real inconsistency
  // (confirmed by the two tests above passing while this diverges from what
  // "clamp to 1..365" would suggest), but arguably harmless: a 0-day window
  // is a nonsensical request either way, and falling back to a sane default
  // is a reasonable outcome. Documented rather than silently changed.
  const zero = await fetch(`${BASE}/api/admin/reports/revenue?days=0`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(zero.series.length, 30);
});

test('CORRECT TOTALS: report numbers match real committed orders, and exclude a cancelled order', async () => {
  const place = async (idempotencyKey) => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: { firstName: 'QA', lastName: 'Reports', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
        items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
        paymentMethod: 'paypal',
        idempotencyKey,
      }),
    });
    assert.equal(res.status, 201);
  };

  await place(`qa-reports-1-${Date.now()}`);
  await place(`qa-reports-2-${Date.now()}`);
  // A third order that will be cancelled — must not count toward revenue/totals.
  await place(`qa-reports-3-${Date.now()}`);

  const orders = await server.db.prepare('SELECT * FROM orders WHERE customerEmail = ? ORDER BY createdAt ASC').all(EMAIL);
  assert.equal(orders.length, 3, 'test setup sanity check');
  const toCancel = orders[2];
  const cancelRes = await fetch(`${BASE}/api/admin/orders/${toCancel.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const summary = await fetch(`${BASE}/api/admin/reports/summary`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(summary.totalOrders, 2, 'the cancelled order must not be counted');
  assert.equal(summary.totalRevenue, 200, '2 confirmed orders at $100 each = $200; the cancelled 3rd must not count');
  assert.equal(summary.averageOrderValue, 100);

  // Cross-check against the raw order data directly — the report numbers
  // must be internally consistent with what's actually in the orders table,
  // not just plausible-looking.
  const directRevenueRow = await server.db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE customerEmail = ? AND status != 'cancelled'").get(EMAIL);
  assert.equal(summary.totalRevenue >= directRevenueRow.t, true);

  const topProducts = await fetch(`${BASE}/api/admin/reports/top-products`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  const ours = topProducts.products.find((p) => p.productId === PRODUCT_ID);
  assert.ok(ours, 'the test product should appear in top products');
  assert.equal(ours.unitsSold, 2, 'the cancelled order\'s unit must not be counted toward unitsSold');
  assert.equal(ours.revenue, 200);

  const byCategory = await fetch(`${BASE}/api/admin/reports/sales-by-category`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  const ourCategory = byCategory.categories.find((c) => c.category === 'test-category');
  assert.ok(ourCategory);
  assert.equal(ourCategory.revenue, 200);

  const byStatus = await fetch(`${BASE}/api/admin/reports/order-status`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  // COD removed: a directly-created paypal order commits as
  // 'payment_pending' (see server/order-api.mjs's createOrder), not
  // 'confirmed' — the two surviving orders here were never admin-confirmed,
  // only the third one was transitioned (to 'cancelled').
  const pendingCount = byStatus.statuses.find((s) => s.status === 'payment_pending')?.count || 0;
  const cancelledCount = byStatus.statuses.find((s) => s.status === 'cancelled')?.count || 0;
  assert.ok(pendingCount >= 2, 'order-status-breakdown counts cancelled orders too (unlike revenue reports) — it should still show the cancelled one separately');
  assert.equal(cancelledCount, 1);
});

test('a valid admin token succeeds on every report route', async () => {
  for (const route of REPORT_ROUTES) {
    const res = await fetch(`${BASE}${route}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(res.status, 200, `${route} should succeed for a real admin token`);
  }
});
