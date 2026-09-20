// Integration tests against a real Express server + isolated temp database.
// Covers the gift card redemption path (server/gift-card-api.mjs) both in
// isolation (checkGiftCard) and through the real order-creation endpoint
// (server/order-api.mjs's validateOrderDraft/commitOrder), since redemption
// only actually happens as part of committing an order.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PRODUCT_ID = '_test_gift_card_product';
const EMAIL = 'qa-giftcard@example.com';

async function seedGiftCard(code, { balance = 50, initialValue = 50, active = 1, expiresAt = null } = {}) {
  await server.db.prepare('DELETE FROM gift_cards WHERE code = ?').run(code);
  await server.db.prepare(`
    INSERT INTO gift_cards (id, code, initialValue, balance, recipientEmail, active, expiresAt)
    VALUES (?, ?, ?, ?, '', ?, ?)
  `).run(`gc_${code}`, code, initialValue, balance, active, expiresAt);
}

function orderPayload(idempotencyKey, overrides = {}) {
  return {
    customer: { firstName: 'QA', lastName: 'GiftCard', email: EMAIL, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
    paymentMethod: 'paypal',
    idempotencyKey,
    ...overrides,
  };
}

async function postOrder(payload) {
  return fetch(`${BASE}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

before(async () => {
  server = await startTestServer('gift-cards');
  BASE = server.baseUrl;
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test Gift Card Product', 100, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);
});

beforeEach(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
});

after(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run(EMAIL);
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare("DELETE FROM gift_cards WHERE code LIKE 'QA-TEST-%'").run();
  await server.close();
});

test('checkGiftCard: an unknown code is invalid', async () => {
  const res = await fetch(`${BASE}/api/gift-cards/check`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-TEST-DOES-NOT-EXIST' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.valid, false);
});

test('checkGiftCard: an expired card is invalid', async () => {
  await seedGiftCard('QA-TEST-EXPIRED', { expiresAt: new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ') });
  const res = await fetch(`${BASE}/api/gift-cards/check`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-TEST-EXPIRED' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /expired/i);
});

test('checkGiftCard: a deactivated card is invalid', async () => {
  await seedGiftCard('QA-TEST-INACTIVE', { active: 0 });
  const res = await fetch(`${BASE}/api/gift-cards/check`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-TEST-INACTIVE' }),
  });
  assert.equal(res.status, 400);
});

test('checkGiftCard: a zero-balance card is invalid', async () => {
  await seedGiftCard('QA-TEST-EMPTY', { balance: 0 });
  const res = await fetch(`${BASE}/api/gift-cards/check`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-TEST-EMPTY' }),
  });
  assert.equal(res.status, 400);
});

test('checkGiftCard: a valid active card with balance is valid', async () => {
  await seedGiftCard('QA-TEST-VALID', { balance: 30 });
  const res = await fetch(`${BASE}/api/gift-cards/check`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'QA-TEST-VALID' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.valid, true);
  assert.equal(body.balance, 30);
});

test('an order with an invalid gift card code is rejected', async () => {
  const res = await postOrder(orderPayload(`qa-gc-bad-${Date.now()}`, { giftCardCode: 'QA-TEST-NOPE' }));
  assert.equal(res.status, 400);
});

test('PARTIAL balance usage: a gift card worth less than the order total covers part of it, remainder still charged', async () => {
  await seedGiftCard('QA-TEST-PARTIAL', { balance: 20 }); // product costs 100
  const res = await postOrder(orderPayload(`qa-gc-partial-${Date.now()}`, { giftCardCode: 'QA-TEST-PARTIAL' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.giftCardAmount, 20);
  assert.equal(body.total, 100 - 20); // shipping is 0 for Armenia

  const card = await server.db.prepare('SELECT balance FROM gift_cards WHERE code = ?').get('QA-TEST-PARTIAL');
  assert.equal(card.balance, 0, 'the full $20 balance should have been consumed');
});

test('FULL balance usage: a gift card worth more than the order total covers it entirely, leftover balance remains on the card', async () => {
  await seedGiftCard('QA-TEST-FULL', { balance: 500 }); // product costs 100
  const res = await postOrder(orderPayload(`qa-gc-full-${Date.now()}`, { giftCardCode: 'QA-TEST-FULL' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.giftCardAmount, 100, 'should only apply what the order actually costs, not the whole balance');
  assert.equal(body.total, 0);

  const card = await server.db.prepare('SELECT balance FROM gift_cards WHERE code = ?').get('QA-TEST-FULL');
  assert.equal(card.balance, 400, 'unused balance (500 - 100) must remain on the card');
});

test('an order that fully covers its total with a gift card still commits successfully (a real $0-due order, not an error)', async () => {
  await seedGiftCard('QA-TEST-ZERO-DUE', { balance: 100 });
  const res = await postOrder(orderPayload(`qa-gc-zero-${Date.now()}`, { giftCardCode: 'QA-TEST-ZERO-DUE' }));
  assert.equal(res.status, 201);
  const order = await server.db.prepare('SELECT * FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  // COD removed: a directly-created order always commits as
  // 'payment_pending' now (see server/order-api.mjs's createOrder), even
  // when the gift card covers the entire total — the point under test is
  // that it commits successfully with total:0, not that it auto-confirms.
  assert.equal(order.status, 'payment_pending');
  assert.equal(order.total, 0);
});

test('DUPLICATE/REPLAYED usage: a sequential replay with the same idempotency key returns the same order and only spends the balance once', async () => {
  await seedGiftCard('QA-TEST-REPLAY2', { balance: 60 });
  const key = `qa-gc-replay2-${Date.now()}`;
  const r1 = await postOrder(orderPayload(key, { giftCardCode: 'QA-TEST-REPLAY2' }));
  assert.equal(r1.status, 201);
  const r2 = await postOrder(orderPayload(key, { giftCardCode: 'QA-TEST-REPLAY2' }));
  assert.equal(r2.status, 201);

  const card = await server.db.prepare('SELECT balance FROM gift_cards WHERE code = ?').get('QA-TEST-REPLAY2');
  assert.equal(card.balance, 0, 'the $60 balance should be spent exactly once (fully, since the order costs more) — a replay must not spend it twice');
  const orderCountRow = await server.db.prepare('SELECT COUNT(*) c FROM orders WHERE idempotencyKey = ?').get(key);
  assert.equal(orderCountRow.c, 1);
});

test('CONCURRENT redemption: two concurrent orders racing to spend the same nearly-exhausted gift card cannot together overdraw it', async () => {
  await seedGiftCard('QA-TEST-CONCURRENT', { balance: 100 });
  const [r1, r2] = await Promise.all([
    postOrder(orderPayload(`qa-gc-race-a-${Date.now()}`, {
      giftCardCode: 'QA-TEST-CONCURRENT',
      customer: { firstName: 'A', lastName: 'Race', email: 'qa-giftcard-race-a@example.com', phone: '1', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    })),
    postOrder(orderPayload(`qa-gc-race-b-${Date.now()}`, {
      giftCardCode: 'QA-TEST-CONCURRENT',
      customer: { firstName: 'B', lastName: 'Race', email: 'qa-giftcard-race-b@example.com', phone: '2', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
    })),
  ]);

  // Both requests validate against the same full $100 balance (each order
  // costs $100, so each expects to redeem the whole thing) before either
  // commits. commitOrder() re-checks atomically at commit time: whichever
  // request wins the race actually redeems the $100 and succeeds; the loser
  // finds the balance already spent and is correctly REJECTED (400) rather
  // than silently proceeding with $0 gift-card credit and charging the
  // customer the full amount without their consent — the same
  // recheck-at-commit pattern used for stock and promo codes.
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 400], 'exactly one order should succeed (winning the redemption) and the other should be rejected, not silently overcharged');

  const rejected = r1.status === 400 ? r1 : r2;
  const rejectedBody = await rejected.json();
  // Depending on exact event-loop interleaving, the loser is caught either
  // by its own draft validation (checkGiftCard sees the balance already
  // spent) or by commitOrder's atomic recheck — both are correct, safe
  // outcomes; which one fires is a timing detail, not the behavior under test.
  assert.match(rejectedBody.error, /balance just changed|no remaining balance/i);

  const card = await server.db.prepare('SELECT balance FROM gift_cards WHERE code = ?').get('QA-TEST-CONCURRENT');
  assert.equal(card.balance, 0, 'the winning order should have spent the entire balance');
  assert.ok(card.balance >= 0, 'gift card balance must never go negative');

  const orderCountRow = await server.db.prepare("SELECT COUNT(*) c FROM orders WHERE customerEmail IN ('qa-giftcard-race-a@example.com','qa-giftcard-race-b@example.com')").get();
  assert.equal(orderCountRow.c, 1, 'only the winning order should exist');

  await server.db.prepare("DELETE FROM orders WHERE customerEmail IN ('qa-giftcard-race-a@example.com','qa-giftcard-race-b@example.com')").run();
});

test('ROLLBACK on cancellation: cancelling an order restores the gift card balance it spent', async () => {
  await seedGiftCard('QA-TEST-CANCEL', { balance: 40 });
  const res = await postOrder(orderPayload(`qa-gc-cancel-${Date.now()}`, { giftCardCode: 'QA-TEST-CANCEL' }));
  assert.equal(res.status, 201);
  const afterOrder = await server.db.prepare('SELECT balance FROM gift_cards WHERE code = ?').get('QA-TEST-CANCEL');
  assert.equal(afterOrder.balance, 0, 'sanity check: balance was spent');

  const orderRow = await server.db.prepare('SELECT id FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(EMAIL);
  const adminToken = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json()).then((b) => b.token);

  const cancelRes = await fetch(`${BASE}/api/admin/orders/${orderRow.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const afterCancel = await server.db.prepare('SELECT balance FROM gift_cards WHERE code = ?').get('QA-TEST-CANCEL');
  assert.equal(afterCancel.balance, 40, 'cancelling the order should restore the gift card balance it spent');
});
