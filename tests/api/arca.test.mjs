// Integration tests for ArCa card payments (server/payment/arcaService.mjs)
// against the real Express app + an isolated MySQL database. ArCa itself is
// never contacted: a small local HTTP server plays the EPG gateway
// (register.do / getOrderStatusExtended.do, form-urlencoded in, JSON out, as
// in ArCa's "EPG – Merchant Integration Guide"), and ARCA_API_URL points at it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { startTestServer } from '../helpers/test-server.mjs';

const USER = 'test-arca-user';
const PASS = 'test-arca-password';
const PRODUCT_ID = '_test_arca_product';
const EMAIL = 'qa-arca@example.com';

let server;
let BASE;
let gateway;
let GATEWAY;

// ---- fake ArCa EPG gateway ----
const fake = { orders: new Map(), calls: [] };

function startFakeGateway() {
  gateway = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const params = Object.fromEntries(new URLSearchParams(raw));
    fake.calls.push({ url: req.url, params, contentType: req.headers['content-type'] });
    const send = (body) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (params.userName !== USER || params.password !== PASS) {
      return send({ errorCode: '5', errorMessage: 'Access denied' });
    }
    if (req.method === 'POST' && req.url === '/payment/rest/register.do') {
      const orderId = randomUUID();
      fake.orders.set(orderId, { ...params, orderStatus: 0 });
      return send({ orderId, formUrl: `${GATEWAY}/payment/merchants/test/payment_${params.language}.html?mdOrder=${orderId}` });
    }
    if (req.method === 'POST' && req.url === '/payment/rest/getOrderStatusExtended.do') {
      const order = fake.orders.get(params.orderId);
      if (!order) return send({ errorCode: '6', errorMessage: 'Order not found' });
      return send({
        errorCode: '0',
        errorMessage: 'Success',
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        actionCode: order.orderStatus === 2 ? 0 : -2007,
        amount: order.paidAmount ?? Number(order.amount),
        currency: order.currency,
        cardAuthInfo: { maskedPan: '411111**1111', approvalCode: '123456' },
      });
    }
    res.statusCode = 404;
    return send({ errorCode: '1', errorMessage: 'Unknown method' });
  });
  return new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
}

before(async () => {
  await startFakeGateway();
  GATEWAY = `http://127.0.0.1:${gateway.address().port}`;
  process.env.ARCA_API_URL = `${GATEWAY}/payment/rest`;
  process.env.ARCA_USERNAME = USER;
  process.env.ARCA_PASSWORD = PASS;
  process.env.ARCA_TEST_AMOUNT = '10';
  // The return URL is built from PUBLIC_URL, like in production.
  process.env.PUBLIC_URL = 'https://shop.example/';
  server = await startTestServer('arca');
  BASE = server.baseUrl;
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test ArCa Product', 80, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);
});

after(async () => {
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.close();
  await new Promise((resolve) => gateway.close(resolve));
});

const orderPayload = () => ({
  customer: { firstName: 'QA', lastName: 'Arca', email: EMAIL, phone: '123', country: 'AM', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
  language: 'hy',
});

async function startPayment() {
  const res = await fetch(`${BASE}/api/checkout/arca`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(orderPayload()),
  });
  const body = await res.json();
  const orderId = body.formUrl ? new URL(body.formUrl).searchParams.get('mdOrder') : null;
  return { status: res.status, body, orderId, registered: orderId ? fake.orders.get(orderId) : null };
}

async function returnFromArca(orderId) {
  const res = await fetch(`${BASE}/payment/arca/return?orderId=${encodeURIComponent(orderId)}&lang=hy`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') };
}

const ordersFor = (orderNumber) => server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').all(`arca:${orderNumber}`);
const statusUrl = (orderNumber, token) => `${BASE}/api/checkout/arca/${orderNumber}/status?token=${encodeURIComponent(token)}`;

test('config exposes arcaConfigured so checkout sends card payments to ArCa', async () => {
  const data = await (await fetch(`${BASE}/api/config`)).json();
  assert.equal(data.arcaConfigured, true);
});

test('starting a payment registers the TEST amount (10 AMD = 1000 minor units) with ArCa and creates no order yet', async () => {
  const { status, body, registered } = await startPayment();
  assert.equal(status, 200);
  assert.ok(body.formUrl.startsWith(`${GATEWAY}/payment/merchants/`));
  assert.match(body.orderNumber, /^\d{12}$/);
  assert.ok(body.statusToken);
  assert.ok(body.total > 10, 'the real order total is unchanged — only the charged amount is 10 AMD');

  assert.equal(registered.orderNumber, body.orderNumber);
  assert.equal(registered.amount, '1000');
  assert.equal(registered.currency, '051');
  assert.equal(registered.language, 'hy');
  assert.equal(registered.returnUrl, 'https://shop.example/payment/arca/return');
  assert.equal(registered.failUrl, 'https://shop.example/payment/arca/return');
  assert.equal(fake.calls.at(-1).contentType, 'application/x-www-form-urlencoded');

  assert.ok(!JSON.stringify(body).includes(PASS), 'the ArCa password never reaches the browser');
  assert.equal((await ordersFor(body.orderNumber)).length, 0);
});

test('coming back without paying goes to the fail page and creates no order', async () => {
  const { body, orderId } = await startPayment();
  const back = await returnFromArca(orderId);
  assert.equal(back.status, 303);
  assert.equal(back.location, `/payment/fail?via=arca&bill=${body.orderNumber}`);
  assert.equal((await ordersFor(body.orderNumber)).length, 0);
});

test('a paid order creates exactly one paid order with the REAL price; repeated returns are idempotent', async () => {
  const { body, orderId, registered } = await startPayment();
  registered.orderStatus = 2; // customer paid on ArCa's page

  const first = await returnFromArca(orderId);
  assert.equal(first.status, 303);
  assert.equal(first.location, `/payment/success?via=arca&bill=${body.orderNumber}`);
  const again = await returnFromArca(orderId);
  assert.equal(again.location, `/payment/success?via=arca&bill=${body.orderNumber}`);

  const rows = await ordersFor(body.orderNumber);
  assert.equal(rows.length, 1, 'never a second order for the same payment');
  const order = rows[0];
  assert.equal(order.status, 'confirmed');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.paymentMethod, 'card');
  assert.equal(order.paymentProvider, 'arca');
  assert.equal(order.providerTransactionId, orderId);
  assert.equal(Number(order.total), body.total, 'the order keeps the real total, not the 10 AMD test charge');
  assert.equal(order.paymentEnv, 'sandbox', 'test-amount payments are labeled in the admin panel');

  const done = await (await fetch(statusUrl(body.orderNumber, body.statusToken))).json();
  assert.equal(done.status, 'succeeded');
  assert.equal(done.order.orderNumber, order.orderNumber);
});

test('the status endpoint needs the per-payment token, and confirms a payment even without the return redirect', async () => {
  const { body, registered } = await startPayment();

  assert.equal((await fetch(statusUrl(body.orderNumber, 'wrong-token'))).status, 404);
  assert.equal((await (await fetch(statusUrl(body.orderNumber, body.statusToken))).json()).status, 'pending');

  registered.orderStatus = 2;
  const done = await (await fetch(statusUrl(body.orderNumber, body.statusToken))).json();
  assert.equal(done.status, 'succeeded');
  assert.match(done.order.orderNumber, /^UP-/);
  assert.equal((await ordersFor(body.orderNumber)).length, 1);
});

test('a declined payment goes to the fail page, reports failed, and creates no order', async () => {
  const { body, orderId, registered } = await startPayment();
  registered.orderStatus = 6;

  const back = await returnFromArca(orderId);
  assert.equal(back.location, `/payment/fail?via=arca&bill=${body.orderNumber}`);
  const status = await (await fetch(statusUrl(body.orderNumber, body.statusToken))).json();
  assert.equal(status.status, 'failed');
  assert.equal((await ordersFor(body.orderNumber)).length, 0);
});

test('a payment ArCa reports for a different amount is never turned into an order', async () => {
  const { body, orderId, registered } = await startPayment();
  registered.orderStatus = 2;
  registered.paidAmount = 500;

  const back = await returnFromArca(orderId);
  assert.equal(back.location, `/payment/fail?via=arca&bill=${body.orderNumber}`);
  assert.equal((await ordersFor(body.orderNumber)).length, 0);
});

test('an unknown orderId on the return URL is refused without calling ArCa', async () => {
  const callsBefore = fake.calls.length;
  const back = await returnFromArca(randomUUID());
  assert.equal(back.status, 303);
  assert.equal(back.location, '/payment/fail?via=arca');
  assert.equal(fake.calls.length, callsBefore);
});

test('the reconciliation sweep creates the order for a customer who paid but never came back', async () => {
  const { body, registered } = await startPayment();
  registered.orderStatus = 2;

  const { reconcilePendingArcaPayments } = await import('../../server/payment/arcaService.mjs');
  const result = await reconcilePendingArcaPayments({ minAgeSeconds: 0 });
  assert.ok(result.succeeded >= 1);
  assert.equal((await ordersFor(body.orderNumber)).length, 1);
});

test('an ArCa error while registering (e.g. wrong credentials) returns 502 and creates no order', async () => {
  process.env.ARCA_PASSWORD = 'wrong-password';
  try {
    const { status, body } = await startPayment();
    assert.equal(status, 502);
    assert.equal(body.error, 'Could not start card checkout. Please try again.');
    assert.equal(body.formUrl, undefined);
  } finally {
    process.env.ARCA_PASSWORD = PASS;
  }
});

test('without ARCA_TEST_AMOUNT the real total is charged, converted to AMD minor units', async () => {
  delete process.env.ARCA_TEST_AMOUNT;
  try {
    const { status, body, registered } = await startPayment();
    assert.equal(status, 200);
    assert.equal(registered.amount, String(Math.round(body.total * 390) * 100));
  } finally {
    process.env.ARCA_TEST_AMOUNT = '10';
  }
});

test('without ArCa credentials the card endpoint is unavailable', async () => {
  delete process.env.ARCA_USERNAME;
  try {
    const res = await fetch(`${BASE}/api/checkout/arca`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(orderPayload()),
    });
    assert.equal(res.status, 503);
    assert.equal((await (await fetch(`${BASE}/api/config`)).json()).arcaConfigured, false);
  } finally {
    process.env.ARCA_USERNAME = USER;
  }
});
