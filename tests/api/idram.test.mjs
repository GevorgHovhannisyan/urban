// Integration tests for the Idram wallet flow (server/payment/idramService.mjs)
// against the real Express app + an isolated MySQL database. Idram itself is
// never contacted: the tests play Idram's part by POSTing the precheck and the
// signed confirmation to RESULT_URL, with the checksum computed here straight
// from the formula in Idram's merchant API document.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startTestServer } from '../helpers/test-server.mjs';

const REC_ACCOUNT = '100000114';
const SECRET = 'test-idram-secret-key';
const PRODUCT_ID = '_test_idram_product';
const EMAIL = 'qa-idram@example.com';

let server;
let BASE;

before(async () => {
  process.env.IDRAM_REC_ACCOUNT = REC_ACCOUNT;
  process.env.IDRAM_SECRET_KEY = SECRET;
  process.env.IDRAM_TEST_AMOUNT = '10';
  server = await startTestServer('idram');
  BASE = server.baseUrl;
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Idram Product', 80, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);
});

after(async () => {
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.close();
});

const orderPayload = () => ({
  customer: { firstName: 'QA', lastName: 'Idram', email: EMAIL, phone: '123', country: 'AM', city: 'Yerevan', postalCode: '0001', address: '1 St' },
  items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
  language: 'hy',
});

async function startPayment() {
  const res = await fetch(`${BASE}/api/checkout/idram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(orderPayload()),
  });
  return { status: res.status, body: await res.json() };
}

async function postResult(fields) {
  const res = await fetch(`${BASE}/payment/idram-result`, {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
  return { status: res.status, text: await res.text() };
}

function confirmation(billNo, amount, overrides = {}) {
  const fields = {
    EDP_BILL_NO: billNo,
    EDP_REC_ACCOUNT: REC_ACCOUNT,
    EDP_PAYER_ACCOUNT: '100000999',
    EDP_AMOUNT: amount,
    EDP_TRANS_ID: `T${billNo}`.slice(0, 14),
    EDP_TRANS_DATE: '16/11/2026',
    ...overrides,
  };
  const text = [fields.EDP_REC_ACCOUNT, fields.EDP_AMOUNT, SECRET, fields.EDP_BILL_NO, fields.EDP_PAYER_ACCOUNT, fields.EDP_TRANS_ID, fields.EDP_TRANS_DATE].join(':');
  fields.EDP_CHECKSUM = createHash('md5').update(text).digest('hex').toUpperCase();
  return fields;
}

const orderFor = (billNo) => server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').get(`idram:${billNo}`);

test('config exposes idramConfigured so checkout can show the option', async () => {
  const data = await (await fetch(`${BASE}/api/config`)).json();
  assert.equal(data.idramConfigured, true);
});

test('starting a payment returns the Idram form with the TEST amount (10 AMD) and creates no order yet', async () => {
  const { status, body } = await startPayment();
  assert.equal(status, 200);
  assert.equal(body.action, 'https://banking.idram.am/Payment/GetPayment');
  assert.equal(body.fields.EDP_REC_ACCOUNT, REC_ACCOUNT);
  assert.equal(body.fields.EDP_AMOUNT, '10');
  assert.equal(body.fields.EDP_LANGUAGE, 'AM');
  assert.match(body.fields.EDP_BILL_NO, /^\d{12}$/);
  assert.equal(body.fields.EDP_BILL_NO, body.billNo);
  assert.ok(body.total > 10, 'the real order total is unchanged — only the charged amount is 10 AMD');
  assert.ok(body.statusToken);
  assert.equal(body.fields.EDP_CHECKSUM, undefined, 'the secret never reaches the browser');
  assert.equal(await orderFor(body.billNo), undefined);
});

test('precheck answers OK for a real bill and refuses a wrong amount, account or unknown bill', async () => {
  const { body } = await startPayment();
  const base = { EDP_PRECHECK: 'YES', EDP_BILL_NO: body.billNo, EDP_REC_ACCOUNT: REC_ACCOUNT, EDP_AMOUNT: '10' };

  assert.deepEqual(await postResult(base), { status: 200, text: 'OK' });
  assert.equal((await postResult({ ...base, EDP_AMOUNT: '10.00' })).text, 'OK', 'fraction formatting is accepted');
  assert.notEqual((await postResult({ ...base, EDP_AMOUNT: String(Math.round(body.total * 390)) })).text, 'OK');
  assert.notEqual((await postResult({ ...base, EDP_REC_ACCOUNT: '999' })).text, 'OK');
  assert.notEqual((await postResult({ ...base, EDP_BILL_NO: '123456789012' })).text, 'OK');
});

test('a confirmation with a bad checksum is rejected and creates no order', async () => {
  const { body } = await startPayment();
  const fields = { ...confirmation(body.billNo, '10.00'), EDP_CHECKSUM: '0'.repeat(32) };
  const res = await postResult(fields);
  assert.notEqual(res.text, 'OK');
  assert.equal(await orderFor(body.billNo), undefined);
});

test('a confirmation for the wrong amount is rejected even with a valid checksum', async () => {
  const { body } = await startPayment();
  const res = await postResult(confirmation(body.billNo, '5.00'));
  assert.notEqual(res.text, 'OK');
  assert.equal(await orderFor(body.billNo), undefined);
});

test('a valid signed confirmation creates exactly one paid order with the REAL price; repeats are idempotent', async () => {
  const { body } = await startPayment();
  const fields = confirmation(body.billNo, '10.00');

  assert.deepEqual(await postResult(fields), { status: 200, text: 'OK' });
  assert.deepEqual(await postResult(fields), { status: 200, text: 'OK' }, 'a repeated confirmation still answers OK');

  const rows = await server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').all(`idram:${body.billNo}`);
  assert.equal(rows.length, 1, 'never a second order for the same bill');
  const order = rows[0];
  assert.equal(order.status, 'confirmed');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.paymentMethod, 'idram');
  assert.equal(order.paymentProvider, 'idram');
  assert.equal(order.providerTransactionId, fields.EDP_TRANS_ID);
  assert.equal(Number(order.total), body.total, 'the order keeps the real total, not the 10 AMD test charge');
  assert.equal(order.paymentEnv, 'sandbox', 'test-amount payments are labeled in the admin panel');

  // A paid bill can't be paid again.
  const again = await postResult({ EDP_PRECHECK: 'YES', EDP_BILL_NO: body.billNo, EDP_REC_ACCOUNT: REC_ACCOUNT, EDP_AMOUNT: '10' });
  assert.notEqual(again.text, 'OK');
});

test('the status endpoint needs the per-bill token and reports the order once confirmed', async () => {
  const { body } = await startPayment();
  const statusUrl = (token) => `${BASE}/api/checkout/idram/${body.billNo}/status?token=${encodeURIComponent(token)}`;

  assert.equal((await fetch(statusUrl('wrong-token'))).status, 404);
  assert.equal((await (await fetch(statusUrl(body.statusToken))).json()).status, 'pending');

  await postResult(confirmation(body.billNo, '10'));
  const done = await (await fetch(statusUrl(body.statusToken))).json();
  assert.equal(done.status, 'succeeded');
  assert.match(done.order.orderNumber, /^UP-/);
});

test('an Idram order can no longer be created unpaid through POST /api/orders', async () => {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...orderPayload(), paymentMethod: 'idram', idempotencyKey: `qa-idram-direct-${Date.now()}` }),
  });
  assert.equal(res.status, 400);
});

test('a POST to the success URL is redirected to the storefront page with the bill number', async () => {
  const res = await fetch(`${BASE}/payment/success`, {
    method: 'POST',
    body: new URLSearchParams({ EDP_BILL_NO: '123456789012' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/payment/success?bill=123456789012');
});

test('without IDRAM_TEST_AMOUNT the real total is charged, converted to AMD', async () => {
  delete process.env.IDRAM_TEST_AMOUNT;
  try {
    const { status, body } = await startPayment();
    assert.equal(status, 200);
    assert.equal(body.fields.EDP_AMOUNT, String(Math.round(body.total * 390)));
  } finally {
    process.env.IDRAM_TEST_AMOUNT = '10';
  }
});

test('CSP allows the checkout form to post to Idram', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.match(res.headers.get('content-security-policy'), /form-action 'self' https:\/\/banking\.idram\.am/);
});
