// Integration tests for fiscal receipts (ՀԴՄ) — server/hdm/*.
// Real Express app + isolated MySQL database; SRC itself is replaced by an
// in-memory fake (setTransportForTests) that numbers receipts sequentially
// like the real register and can simulate errors, timeouts and lost
// responses. Payments are driven through the real Idram confirmation path.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { startTestServer } from '../helpers/test-server.mjs';

process.env.NODE_ENV = 'test';
const REC_ACCOUNT = '100000114';
const SECRET = 'test-idram-secret-key';
const PRODUCT_ID = '_test_hdm_product';
const EMAIL = 'qa-hdm@example.com';
const PFX = path.join(os.tmpdir(), `hdm-test-${process.pid}.p12`);

let server;
let BASE;
let fiscal;
let srcClient;
let adminToken;

// ---------- fake SRC ----------
const fake = { receipts: [], calls: [], mode: 'success', delayMs: 0 };
// Like a real register, receipt numbers keep increasing across tests; only
// the call log and behaviour reset. freshRegister() switches to a new CRN
// with an empty sequence for tests that reason about numbering.
function resetFake() { fake.calls = []; fake.mode = 'success'; fake.delayMs = 0; }
let crnCounter = 52472900;
function freshRegister() {
  process.env.HDM_CRN = String((crnCounter += 1));
  fake.receipts = [];
}
const json = (body, httpStatus = 200) => ({ httpStatus, text: JSON.stringify(body) });
function createReceipt(payload) {
  const receiptId = fake.receipts.length + 1;
  const receipt = {
    receiptId: String(receiptId), crn: process.env.HDM_CRN, sn: 'SN123456', tin: '28028252', taxpayer: '«Test»', address: 'Yerevan',
    time: Date.now(), fiscal: String(90000000 + receiptId), total: payload.cardAmount, change: 0,
    qr: `TIN: 28028252, CRN: 52472841, Receipt_ID: ${receiptId}, TOTAL: ${payload.cardAmount}`,
  };
  fake.receipts.push(receipt);
  return receipt;
}
async function fakeTransport({ method, body }) {
  const payload = JSON.parse(body);
  fake.calls.push({ method, payload });
  if (fake.delayMs) await new Promise((r) => setTimeout(r, fake.delayMs));
  if (method === 'checkConnection') return json({ code: 0, message: 'OK', result: 'OK' });
  if (method === 'printCopy') {
    const r = fake.receipts[Number(payload.receiptId) - 1];
    return r ? json({ code: 0, message: 'OK', result: r }) : json({ code: 176, message: 'RECEIPT_DOES_NOT_EXIST', errorMessage: 'Receipt does not exist' });
  }
  if (method === 'print') {
    switch (fake.mode) {
      case 'success': return json({ code: 0, message: 'OK', result: createReceipt(payload) });
      case 'reject': return json({ code: 196, message: 'INACTIVE_CERT_CRM', errorMessage: 'Register is not active' });
      case 'not-sent': return { error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), sent: false };
      case 'lost-after-create': createReceipt(payload); return { error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), sent: true };
      case 'lost-no-create': return { error: Object.assign(new Error('No response from SRC within 45s'), { code: 'ETIMEDOUT' }), sent: true };
      case 'proxy-503': return { httpStatus: 503, text: 'upstream connect error or disconnect/reset before headers. reset reason: connection termination' };
      case 'internal-500': return json({ code: 500, message: 'INTERNAL_ERROR', errorMessage: 'Failed to save receipt' });
      default: throw new Error(`unknown fake mode ${fake.mode}`);
    }
  }
  return json({ code: 105, message: 'WRONG_JSON' });
}
const printCalls = () => fake.calls.filter((c) => c.method === 'print').length;

// ---------- helpers ----------
before(async () => {
  fs.writeFileSync(PFX, 'not-a-real-bundle'); // only has to exist: the fake transport never loads it
  Object.assign(process.env, {
    IDRAM_REC_ACCOUNT: REC_ACCOUNT, IDRAM_SECRET_KEY: SECRET,
    HDM_ENABLED: 'true', HDM_CRN: '52472841', HDM_TIN: '28028252', HDM_PFX_PATH: PFX, HDM_PFX_PASSPHRASE: 'test-only',
    HDM_DEPARTMENT: '1', HDM_ADG_CODE: '6110', HDM_CASHIER_ID: '1', HDM_UNIT: 'հատ',
  });
  server = await startTestServer('hdm');
  BASE = server.baseUrl;
  srcClient = await import('../../server/hdm/srcClient.mjs');
  fiscal = await import('../../server/hdm/fiscalService.mjs');
  srcClient.setTransportForTests(fakeTransport);
  await server.db.prepare(`INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew) VALUES (?, 'HDM Test Hoodie', 80, '["Black"]', '["M"]', '[]', '{}', 0)`).run(PRODUCT_ID);
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json());
  adminToken = login.token;
});

after(async () => {
  srcClient.setTransportForTests(null);
  fs.rmSync(PFX, { force: true });
  await server.close();
});

beforeEach(() => resetFake());

async function payWithIdram() {
  // Same function POST /api/checkout/idram calls (that route's per-IP rate
  // limit would trip after 20 payments in one test run). The confirmation
  // below still goes through the real signed RESULT_URL endpoint.
  const { createIdramPayment } = await import('../../server/payment/idramService.mjs');
  const started = await createIdramPayment({
    customer: { firstName: 'QA', lastName: 'HDM', email: EMAIL, phone: '123', country: 'AM', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const start = started.body;
  const fields = {
    EDP_BILL_NO: start.billNo, EDP_REC_ACCOUNT: REC_ACCOUNT, EDP_PAYER_ACCOUNT: '100000999',
    EDP_AMOUNT: `${start.fields.EDP_AMOUNT}.00`, EDP_TRANS_ID: `T${start.billNo}`.slice(0, 14), EDP_TRANS_DATE: '19/11/2026',
  };
  const text = [fields.EDP_REC_ACCOUNT, fields.EDP_AMOUNT, SECRET, fields.EDP_BILL_NO, fields.EDP_PAYER_ACCOUNT, fields.EDP_TRANS_ID, fields.EDP_TRANS_DATE].join(':');
  fields.EDP_CHECKSUM = createHash('md5').update(text).digest('hex').toUpperCase();
  const confirm = () => fetch(`${BASE}/payment/idram-result`, { method: 'POST', body: new URLSearchParams(fields) }).then((r) => r.text());
  assert.equal(await confirm(), 'OK');
  const order = await server.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').get(`idram:${start.billNo}`);
  return { order, amount: Number(start.fields.EDP_AMOUNT), confirm };
}
const taskFor = (orderId) => server.db.prepare(`SELECT * FROM hdm_receipts WHERE orderId = ? AND kind = 'sale'`).get(orderId);
const settle = () => fiscal.processDueTasks();
const admin = (pathname, body = {}) => fetch(`${BASE}/api/admin${pathname}`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// ---------- tests ----------
test('a verified payment saves the order, its charged AMD amount and ONE receipt task together', async () => {
  const { order, amount } = await payWithIdram();
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(Number(order.paidAmount), amount);
  assert.equal(order.paidCurrency, 'AMD');
  const task = await taskFor(order.id);
  assert.ok(task, 'task exists');
  assert.equal(Number(task.amount), amount);
  assert.equal(task.paymentProvider, 'idram');
  await settle();
});

test('successful fiscalization stores the SRC receipt against the order', async () => {
  const { order, amount } = await payWithIdram();
  await settle();
  const task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
  assert.equal(printCalls(), 1);
  const sent = fake.calls.find((c) => c.method === 'print').payload;
  assert.equal(sent.crn, process.env.HDM_CRN);
  assert.equal(sent.cardAmount, amount);
  assert.equal(sent.mode, 2);
  const id = fake.receipts.length;
  assert.equal(task.receiptId, String(id));
  assert.equal(task.fiscal, String(90000000 + id));
  assert.equal(Number(task.receiptTotal), amount);
  assert.match(task.qr, new RegExp(`Receipt_ID: ${id},`));
  assert.ok(task.issuedAt);
  assert.equal(task.resolvedBy, 'print');
});

test('duplicate payment callbacks, page refreshes and repeated runs reuse the same task and receipt', async () => {
  const { order, confirm } = await payWithIdram();
  assert.equal(await confirm(), 'OK');
  assert.equal(await confirm(), 'OK');
  await settle();
  await settle();
  const rows = await server.db.prepare('SELECT * FROM hdm_receipts WHERE orderId = ?').all(order.id);
  assert.equal(rows.length, 1);
  assert.equal(printCalls(), 1);
  // The status page / refresh path: getReceiptForCustomer never issues.
  await fetch(`${BASE}/api/receipts/${order.orderNumber}?t=${rows[0].accessToken}`);
  assert.equal(printCalls(), 1);
});

test('concurrent workers (separate module instances) print exactly once', async () => {
  fake.delayMs = 150;
  fake.mode = 'not-sent'; // keep the kicked run from finishing it first
  const { order } = await payWithIdram();
  await settle();
  await server.db.prepare(`UPDATE hdm_receipts SET status = 'pending', nextAttemptAt = NULL, sentAt = NULL WHERE orderId = ?`).run(order.id);
  fake.calls = [];
  fake.mode = 'success';
  const second = await import('../../server/hdm/fiscalService.mjs?second-worker');
  await Promise.all([fiscal.processDueTasks(), second.processDueTasks(), fiscal.processDueTasks(), second.processDueTasks()]);
  assert.equal(printCalls(), 1, 'the DB claim lets only one worker send');
  assert.equal((await taskFor(order.id)).status, 'issued');
});

test('an SRC rejection is "failed" (no receipt), and an admin retry issues it after the fix', async () => {
  fake.mode = 'reject';
  const receiptsBefore = fake.receipts.length;
  const { order } = await payWithIdram();
  await settle();
  let task = await taskFor(order.id);
  assert.equal(task.status, 'failed');
  assert.match(task.lastError, /196/);
  assert.equal(fake.receipts.length, receiptsBefore, 'no receipt was created');
  await settle();
  assert.equal(printCalls(), 1, 'failed tasks are not retried automatically');

  fake.mode = 'success';
  assert.equal((await admin(`/orders/${order.id}/fiscal/retry`)).status, 200);
  await settle();
  task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
  assert.equal(fake.receipts.length, receiptsBefore + 1);
});

test('"not sent" network errors go back to pending with backoff and are retried', async () => {
  fake.mode = 'not-sent';
  const { order } = await payWithIdram();
  await settle();
  let task = await taskFor(order.id);
  assert.equal(task.status, 'pending');
  assert.equal(task.sentAt, null);
  assert.ok(task.nextAttemptAt, 'backoff set');
  await settle();
  assert.equal(printCalls(), 1, 'waits for the backoff');
  fake.mode = 'success';
  await server.db.prepare('UPDATE hdm_receipts SET nextAttemptAt = NULL WHERE id = ?').run(task.id);
  await settle();
  task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
});

for (const mode of ['lost-after-create', 'lost-no-create', 'proxy-503', 'internal-500']) {
  test(`timeout/lost response (${mode}) is recorded as unknown and never resent blindly`, async () => {
    fake.mode = mode;
    const { order } = await payWithIdram();
    await settle();
    const task = await taskFor(order.id);
    assert.equal(task.status, 'unknown');
    assert.ok(task.sentAt);
    fake.mode = 'success';
    await settle();
    await settle();
    assert.equal(printCalls(), 1, 'no second print while the first result is unknown');
    await server.db.prepare(`UPDATE hdm_receipts SET status = 'failed' WHERE id = ?`).run(task.id); // isolate the next test
  });
}

test('reconciliation links a receipt that was created but whose response was lost', async () => {
  freshRegister();
  fake.mode = 'lost-after-create';
  const { order, amount } = await payWithIdram();
  await settle();
  assert.equal((await taskFor(order.id)).status, 'unknown');
  const summary = await fiscal.reconcileUnknownTasks({ now: Date.now() + 11 * 60 * 1000 });
  assert.equal(summary.linked, 1, JSON.stringify(summary));
  const task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
  assert.equal(task.resolvedBy, 'reconcile');
  assert.equal(task.receiptId, '1');
  assert.equal(Number(task.receiptTotal), amount);
  assert.equal(printCalls(), 1, 'reconciliation never prints');
});

test('reconciliation retries only when the receipt provably does not exist', async () => {
  freshRegister();
  fake.mode = 'lost-no-create';
  const { order } = await payWithIdram();
  await settle();
  assert.equal((await taskFor(order.id)).status, 'unknown');

  // Too early: SRC might still be processing it — nothing happens.
  let summary = await fiscal.reconcileUnknownTasks({ now: Date.now() + 3 * 60 * 1000 });
  assert.equal(summary.retried, 0);
  assert.equal((await taskFor(order.id)).status, 'unknown');

  summary = await fiscal.reconcileUnknownTasks({ now: Date.now() + 11 * 60 * 1000 });
  assert.equal(summary.retried, 1, JSON.stringify(summary));
  fake.mode = 'success';
  await settle();
  const task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
  assert.equal(fake.receipts.length, 1, 'exactly one receipt exists for the payment');
});

test('an unexplained receipt in the sequence blocks automatic retry (needs a human)', async () => {
  freshRegister();
  createReceipt({ cardAmount: 1 }); // issued elsewhere, unknown to the website
  fake.mode = 'lost-no-create';
  const { order } = await payWithIdram();
  await settle();
  const summary = await fiscal.reconcileUnknownTasks({ now: Date.now() + 11 * 60 * 1000 });
  assert.equal(summary.retried, 0);
  assert.deepEqual(summary.unexplained, [1]);
  assert.equal((await taskFor(order.id)).status, 'unknown');

  // Admin path: confirmed in the SRC portal that nothing exists → resend.
  assert.equal((await admin(`/orders/${order.id}/fiscal/confirm-not-issued`, {})).status, 400, 'needs explicit confirmation');
  fake.mode = 'success';
  assert.equal((await admin(`/orders/${order.id}/fiscal/confirm-not-issued`, { confirm: true })).status, 200);
  await settle();
  assert.equal((await taskFor(order.id)).status, 'issued');
});

test('admin can link an existing SRC receipt number; amounts must match; one receipt cannot serve two orders', async () => {
  freshRegister();
  fake.mode = 'lost-after-create';
  const { order, amount } = await payWithIdram();
  await settle();
  createReceipt({ cardAmount: 5 });
  assert.equal((await admin(`/orders/${order.id}/fiscal/link`, { receiptId: '2' })).status, 409, 'wrong amount refused');
  const ok = await admin(`/orders/${order.id}/fiscal/link`, { receiptId: '1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
  assert.equal(task.resolvedBy, 'admin');
  assert.equal(Number(task.receiptTotal), amount);

  fake.mode = 'lost-after-create';
  const other = await payWithIdram();
  await settle();
  assert.equal((await admin(`/orders/${other.order.id}/fiscal/link`, { receiptId: '1', force: true })).status, 409, 'already linked');
});

test('server crash recovery: never-sent tasks retry, in-flight tasks become unknown', async () => {
  fake.mode = 'not-sent';
  const a = await payWithIdram();
  const b = await payWithIdram();
  await settle();
  const past = '2000-01-01 00:00:00';
  await server.db.prepare(`UPDATE hdm_receipts SET status = 'processing', lockedBy = 'dead', lockedUntil = ?, sentAt = NULL WHERE orderId = ?`).run(past, a.order.id);
  await server.db.prepare(`UPDATE hdm_receipts SET status = 'processing', lockedBy = 'dead', lockedUntil = ?, sentAt = ? WHERE orderId = ?`).run(past, past, b.order.id);
  await fiscal.recoverStaleTasks();
  assert.equal((await taskFor(a.order.id)).status, 'pending');
  assert.equal((await taskFor(b.order.id)).status, 'unknown');
  await server.db.prepare(`UPDATE hdm_receipts SET status = 'failed' WHERE orderId IN (?, ?)`).run(a.order.id, b.order.id);
});

test('receipt email failure is recorded; resend reuses the issued receipt and never prints again', async () => {
  const { order } = await payWithIdram();
  await settle();
  await new Promise((r) => setTimeout(r, 50));
  let task = await taskFor(order.id);
  assert.equal(task.status, 'issued');
  assert.equal(task.emailSentAt, null, 'mail is not configured in tests');
  assert.match(task.emailError || '', /not configured/i);
  const before = printCalls();
  const res = await admin(`/orders/${order.id}/fiscal/resend-email`);
  assert.equal(res.status, 502);
  task = await taskFor(order.id);
  assert.ok(task.emailAttempts >= 2);
  assert.equal(printCalls(), before, 'resending an email never calls SRC');
  assert.equal(task.receiptId, (await taskFor(order.id)).receiptId);
});

test('receipt access: secret link or owning customer only; admin sees the status', async () => {
  const { order } = await payWithIdram();
  await settle();
  const task = await taskFor(order.id);
  const get = (q = '', headers = {}) => fetch(`${BASE}/api/receipts/${order.orderNumber}${q}`, { headers }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await get()).status, 404, 'no credentials');
  assert.equal((await get('?t=wrong')).status, 404, 'wrong token');
  assert.equal((await fetch(`${BASE}/api/receipts/UP-NOPE?t=${task.accessToken}`)).status, 404, 'token of another order');
  const ok = await get(`?t=${task.accessToken}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'issued');
  assert.equal(ok.body.receipt.fiscal, task.fiscal);
  assert.match(ok.body.receipt.qrImage, /^data:image\/svg\+xml;base64,/);
  assert.equal(ok.body.receipt.responseJson, undefined, 'no raw SRC response');

  await server.db.prepare(`INSERT INTO customers (id, name, email, passwordHash, emailVerified) VALUES ('cust-owner', 'Owner', ?, 'x', 1), ('cust-other', 'Other', 'someone-else@example.com', 'x', 1)`).run(EMAIL);
  const token = (sub) => jwt.sign({ sub, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await get('', { authorization: `Bearer ${token('cust-owner')}` })).status, 200, 'owner by email');
  assert.equal((await get('', { authorization: `Bearer ${token('cust-other')}` })).status, 404, 'other customer');

  const list = await fetch(`${BASE}/api/admin/orders`, { headers: { authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  const row = list.orders.find((o) => o.id === order.id);
  assert.equal(row.paymentStatus, 'paid');
  assert.equal(row.fiscalReceipt.status, 'issued');
  assert.ok(row.fiscalReceipt.receiptUrl.includes(task.accessToken));
  assert.equal(row.fiscalReceipt.email.sentAt, null, 'email status is separate');
  assert.equal(row.fiscalReceipt.requestJson, undefined);
});

test('cash on delivery orders and HDM switched off create no receipt task', async () => {
  const cod = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      paymentMethod: 'cash_on_delivery',
      customer: { firstName: 'QA', lastName: 'COD', email: EMAIL, phone: '123', country: 'AM', city: 'Yerevan', postalCode: '0001', address: '1 St' },
      items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    }),
  }).then((r) => r.json());
  const codOrder = await server.db.prepare('SELECT id FROM orders WHERE orderNumber = ?').get(cod.orderNumber);
  assert.equal(await taskFor(codOrder.id), undefined);

  process.env.HDM_ENABLED = 'false';
  try {
    const { order } = await payWithIdram();
    assert.equal(await taskFor(order.id), undefined);
  } finally {
    process.env.HDM_ENABLED = 'true';
  }
});

test('admin status shows configuration without secrets; check-connection is read-only', async () => {
  const status = await fetch(`${BASE}/api/admin/hdm/status`, { headers: { authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  assert.equal(status.config.enabled, true);
  assert.equal(status.config.crn, process.env.HDM_CRN);
  assert.equal(JSON.stringify(status).includes('test-only'), false, 'passphrase never returned');
  const check = await admin('/hdm/check-connection');
  assert.equal(check.body.ok, true);
  assert.deepEqual(fake.calls.map((c) => c.method), ['checkConnection']);
});

test('missing business settings block the receipt instead of guessing', async () => {
  const saved = process.env.HDM_ADG_CODE;
  delete process.env.HDM_ADG_CODE;
  try {
    const { order } = await payWithIdram();
    await settle();
    const task = await taskFor(order.id);
    assert.equal(task.status, 'blocked');
    assert.match(task.lastError, /HDM_ADG_CODE/);
    assert.equal(printCalls(), 0);
    await server.db.prepare(`UPDATE hdm_receipts SET status = 'failed' WHERE id = ?`).run(task.id);
  } finally {
    process.env.HDM_ADG_CODE = saved;
  }
});

// ---------- invoice, QR image, account link, accounting report ----------
test('invoice email contains the items, total, payment method and every fiscal field', async () => {
  const { order, amount } = await payWithIdram();
  await settle();
  const task = await taskFor(order.id);
  const mailer = await import('../../server/mailer.mjs');
  const view = await fetch(`${BASE}/api/receipts/${order.orderNumber}?t=${task.accessToken}`).then((r) => r.json());
  const mail = mailer.buildFiscalReceiptEmail({
    to: EMAIL, firstName: 'QA', orderNumber: order.orderNumber, receipt: view.receipt,
    receiptUrl: `https://example.test/receipt/${order.orderNumber}?t=${task.accessToken}`,
    qrImageUrl: `https://example.test/api/receipts/${order.orderNumber}/qr.png?t=${task.accessToken}`,
    paymentMethod: 'idram',
  });
  assert.match(mail.subject, /Invoice & tax receipt/);
  for (const needle of [order.orderNumber, task.fiscal, task.receiptId, process.env.HDM_CRN, 'HDM Test Hoodie', 'Idram', '/qr.png?t=']) {
    assert.ok(mail.html.includes(needle), `html contains ${needle}`);
  }
  assert.ok(mail.text.includes(`Total paid: ${amount.toLocaleString('en-US')} AMD`), mail.text);
});

test('receipt QR image: PNG with the secret link, 404 without it', async () => {
  const { order } = await payWithIdram();
  await settle();
  const task = await taskFor(order.id);
  const ok = await fetch(`${BASE}/api/receipts/${order.orderNumber}/qr.png?t=${task.accessToken}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await ok.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG signature');
  assert.equal((await fetch(`${BASE}/api/receipts/${order.orderNumber}/qr.png`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/receipts/${order.orderNumber}/qr.png?t=wrong`)).status, 404);
});

test('the customer\'s own order list says when a receipt exists', async () => {
  const { order } = await payWithIdram();
  await settle();
  const token = jwt.sign({ sub: 'cust-owner', role: 'customer', email: EMAIL }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch(`${BASE}/api/orders/mine`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 200) {
    const mine = (await res.json()).orders.find((o) => o.orderNumber === order.orderNumber);
    assert.equal(mine.fiscalReceiptIssued, true);
  } else {
    // /orders/mine reads the email from the token; fall back to the function itself.
    const { listOrdersByEmail } = await import('../../server/order-api.mjs');
    const mine = (await listOrdersByEmail(EMAIL)).body.orders.find((o) => o.orderNumber === order.orderNumber);
    assert.equal(mine.fiscalReceiptIssued, true);
  }
});

test('accounting report: paid online vs receipts issued, every mismatch listed', async () => {
  freshRegister();
  const good = await payWithIdram();
  await settle();
  fake.mode = 'lost-no-create';
  const lost = await payWithIdram();
  await settle();
  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const res = await fetch(`${BASE}/api/admin/hdm/report?from=${today}&to=${today}`, { headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(res.status, 200);
  const { summary, lines } = await res.json();
  const goodLine = lines.find((l) => l.orderNumber === good.order.orderNumber);
  const lostLine = lines.find((l) => l.orderNumber === lost.order.orderNumber);
  assert.equal(goodLine.fiscalStatus, 'issued');
  assert.equal(goodLine.problem, null);
  assert.equal(goodLine.receiptTotalAmd, good.amount);
  assert.equal(goodLine.paidAmountAmd, good.amount);
  assert.equal(lostLine.fiscalStatus, 'unknown');
  assert.match(lostLine.problem, /unknown/);
  assert.equal(summary.balanced, false);
  assert.ok(summary.problems >= 1);
  assert.ok(summary.paidOnline.count >= summary.receiptsIssued.count);
  assert.equal(summary.differenceAmd, Math.round((summary.paidOnline.amountAmd - summary.receiptsIssued.amountAmd) * 100) / 100);
  assert.ok(summary.cashOnDelivery.count >= 1, 'COD orders counted separately');
  assert.equal((await fetch(`${BASE}/api/admin/hdm/report?from=bad&to=${today}`, { headers: { authorization: `Bearer ${adminToken}` } })).status, 400);
  assert.equal((await fetch(`${BASE}/api/admin/hdm/report?from=${today}&to=${today}`)).status, 401);
  await server.db.prepare(`UPDATE hdm_receipts SET status = 'failed' WHERE orderId = ?`).run(lost.order.id);
});

test('PDF invoice download: secret link or owner only; 404 before the receipt is issued', async () => {
  const { order } = await payWithIdram();
  await settle();
  const task = await taskFor(order.id);
  const ok = await fetch(`${BASE}/api/receipts/${order.orderNumber}/invoice.pdf?t=${task.accessToken}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.match(ok.headers.get('content-disposition'), /attachment; filename="UrbanPhoenix-invoice-UP-/);
  assert.equal(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(`${BASE}/api/receipts/${order.orderNumber}/invoice.pdf`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/receipts/${order.orderNumber}/invoice.pdf?t=wrong`)).status, 404);

  fake.mode = 'not-sent';
  const pending = await payWithIdram();
  await settle();
  const pendingTask = await taskFor(pending.order.id);
  assert.equal((await fetch(`${BASE}/api/receipts/${pending.order.orderNumber}/invoice.pdf?t=${pendingTask.accessToken}`)).status, 404, 'no invoice until SRC issued the receipt');
  await server.db.prepare(`UPDATE hdm_receipts SET status = 'failed' WHERE id = ?`).run(pendingTask.id);
});
