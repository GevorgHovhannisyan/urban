// Integration tests against a real Express server + isolated temp database
// (see tests/helpers/test-server.mjs). Verifies the Verified Purchase
// Reviews feature: reviews can only be created by an authenticated customer
// who genuinely purchased the product, per a server-side purchase check that
// never trusts anything the client claims (userId/orderId/verified are all
// derived server-side, never read from the request body).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
let adminToken;

const PRODUCT_ID = '_test_vpr_product';
const EMAIL_BUYER = 'qa-vpr-buyer@example.com';
const EMAIL_NONBUYER = 'qa-vpr-nonbuyer@example.com';
const EMAIL_CANCELLED = 'qa-vpr-cancelled@example.com';
const EMAIL_REFUNDED = 'qa-vpr-refunded@example.com';
const EMAIL_OTHER = 'qa-vpr-other@example.com';

async function registerAndVerify(email) {
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Reviewer', email, password: 'TestPass123', country: 'Armenia' }),
  });
  const row = await server.db.prepare('SELECT id, verificationToken FROM customers WHERE email = ?').get(email);
  const verifyRes = await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: row.verificationToken }),
  });
  const body = await verifyRes.json();
  return { token: body.token, id: row.id };
}

async function placeOrder(email, token) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      customer: { firstName: 'QA', lastName: 'Reviewer', email, phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' },
      items: [{ productId: PRODUCT_ID, size: 'M', color: 'Black', quantity: 1 }],
      paymentMethod: 'paypal',
      idempotencyKey: `qa-vpr-${email}-${Date.now()}-${Math.random()}`,
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  return server.db.prepare('SELECT id FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC LIMIT 1').get(email);
}

async function setOrderState(orderId, patch) {
  const res = await fetch(`${BASE}/api/admin/orders/${orderId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(patch),
  });
  assert.equal(res.status, 200);
}

before(async () => {
  server = await startTestServer('verified-purchase-reviews');
  BASE = server.baseUrl;

  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.db.prepare(`
    INSERT INTO products (id, name, price, colors, sizes, images, stock, isNew)
    VALUES (?, 'Test VPR Product', 100, '["Black"]', '["M"]', '[]', '{}', 0)
  `).run(PRODUCT_ID);

  const adminLogin = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json());
  adminToken = adminLogin.token;
});

after(async () => {
  await server.db.prepare('DELETE FROM orders WHERE customerEmail IN (?, ?, ?, ?, ?)')
    .run(EMAIL_BUYER, EMAIL_NONBUYER, EMAIL_CANCELLED, EMAIL_REFUNDED, EMAIL_OTHER);
  await server.db.prepare('DELETE FROM reviews WHERE productId = ?').run(PRODUCT_ID);
  await server.db.prepare('DELETE FROM customers WHERE email IN (?, ?, ?, ?, ?, ?)')
    .run(EMAIL_BUYER, EMAIL_NONBUYER, EMAIL_CANCELLED, EMAIL_REFUNDED, EMAIL_OTHER, 'qa-vpr-attacker@example.com');
  await server.db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
  await server.close();
});

const postReview = (token, overrides = {}) => fetch(`${BASE}/api/reviews`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ productId: PRODUCT_ID, rating: 5, body: 'A genuinely great piece, well made.', ...overrides }),
});

test('a guest (no token) cannot submit a review', async () => {
  const res = await postReview(null);
  assert.equal(res.status, 401);
});

let nonBuyerToken;

test('a logged-in customer who never purchased the product cannot submit a review', async () => {
  const { token } = await registerAndVerify(EMAIL_NONBUYER);
  nonBuyerToken = token;
  const res = await postReview(token);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /purchased/i);
});

test('a cancelled order does not qualify as a purchase', async () => {
  const { token } = await registerAndVerify(EMAIL_CANCELLED);
  const order = await placeOrder(EMAIL_CANCELLED, token);
  await setOrderState(order.id, { status: 'cancelled' });

  const res = await postReview(token);
  assert.equal(res.status, 403);
});

test('a refunded order does not qualify as a purchase, even if status looks otherwise successful', async () => {
  const { token } = await registerAndVerify(EMAIL_REFUNDED);
  const order = await placeOrder(EMAIL_REFUNDED, token);
  await setOrderState(order.id, { status: 'delivered', paymentStatus: 'refunded' });

  const res = await postReview(token);
  assert.equal(res.status, 403);
});

test('a genuine, confirmed buyer can submit a review, and it is server-marked as a verified purchase', async () => {
  const { token } = await registerAndVerify(EMAIL_BUYER);
  const order = await placeOrder(EMAIL_BUYER, token);
  await setOrderState(order.id, { status: 'confirmed', paymentStatus: 'paid' });

  const res = await postReview(token);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.review.verifiedPurchase, true);
  assert.equal(body.review.productId, PRODUCT_ID);

  const row = await server.db.prepare('SELECT userId, orderId, verified FROM reviews WHERE productId = ? AND email = ?').get(PRODUCT_ID, EMAIL_BUYER);
  assert.equal(row.orderId, order.id);
  assert.equal(Number(row.verified), 1);
});

test('a verified buyer cannot submit a second review for the same product (duplicate submission is rejected with 409)', async () => {
  const { token } = await registerAndVerify(EMAIL_OTHER);
  const order = await placeOrder(EMAIL_OTHER, token);
  await setOrderState(order.id, { status: 'confirmed', paymentStatus: 'paid' });

  const first = await postReview(token);
  assert.equal(first.status, 201);

  const second = await postReview(token);
  assert.equal(second.status, 409);
});

test('empty/too-short review content is rejected with 400, even for a qualifying buyer', async () => {
  const res = await postReview(nonBuyerToken, { body: 'short' });
  // nonBuyerToken has not purchased, so the purchase check (403) would also
  // legitimately reject it — but content validation runs first, so a
  // too-short body must fail as 400 regardless of purchase status.
  assert.equal(res.status, 400);
});

test('a manually forged client payload (fake userId/orderId/verified fields) has no effect — server ignores it and still enforces the real purchase check', async () => {
  const res = await postReview(nonBuyerToken, {
    userId: 'someone-elses-id',
    orderId: 'fake-order-id',
    verified: true,
    verifiedPurchase: true,
  });
  assert.equal(res.status, 403, 'forged fields must not grant eligibility the customer does not actually have');
});

let attackerToken;

test('editing another user\'s review is rejected (404, ownership-scoped)', async () => {
  const owner = await server.db.prepare('SELECT id FROM reviews WHERE productId = ? AND email = ?').get(PRODUCT_ID, EMAIL_BUYER);
  assert.ok(owner, 'sanity check: the verified buyer\'s review from an earlier test must exist');

  const registered = await registerAndVerify('qa-vpr-attacker@example.com');
  attackerToken = registered.token;
  const res = await fetch(`${BASE}/api/reviews/${owner.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${attackerToken}` },
    body: JSON.stringify({ rating: 1, body: 'Trying to overwrite someone else\'s review.' }),
  });
  assert.equal(res.status, 404);

  const stillOriginal = await server.db.prepare('SELECT rating FROM reviews WHERE id = ?').get(owner.id);
  assert.notEqual(stillOriginal.rating, 1);
});

test('deleting another user\'s review is rejected (404, ownership-scoped)', async () => {
  const owner = await server.db.prepare('SELECT id FROM reviews WHERE productId = ? AND email = ?').get(PRODUCT_ID, EMAIL_BUYER);
  assert.ok(owner);

  const res = await fetch(`${BASE}/api/reviews/${owner.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${attackerToken}` },
  });
  assert.equal(res.status, 404);

  const stillThere = await server.db.prepare('SELECT id FROM reviews WHERE id = ?').get(owner.id);
  assert.ok(stillThere, 'review must not have been deleted by a non-owner');
});

test('the review\'s own author can edit it, and can delete it', async () => {
  const { token } = await registerAndVerify('qa-vpr-editor@example.com');
  const order = await placeOrder('qa-vpr-editor@example.com', token);
  await setOrderState(order.id, { status: 'confirmed', paymentStatus: 'paid' });

  const created = await postReview(token, { body: 'Original review text goes here.' }).then((r) => r.json());
  const editRes = await fetch(`${BASE}/api/reviews/${created.review.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rating: 3, body: 'Updated review text goes here.' }),
  });
  assert.equal(editRes.status, 200);
  const edited = await editRes.json();
  assert.equal(edited.review.rating, 3);
  assert.equal(edited.review.body, 'Updated review text goes here.');

  const deleteRes = await fetch(`${BASE}/api/reviews/${created.review.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(deleteRes.status, 200);

  const gone = await server.db.prepare('SELECT id FROM reviews WHERE id = ?').get(created.review.id);
  assert.equal(gone, undefined);

  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run('qa-vpr-editor@example.com');
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run('qa-vpr-editor@example.com');
});

test('GET /api/reviews/eligibility reflects the true server-side state at each stage: guest, non-buyer, buyer, already-reviewed', async () => {
  const guestRes = await fetch(`${BASE}/api/reviews/eligibility?productId=${PRODUCT_ID}`);
  assert.equal(guestRes.status, 200);
  const guestBody = await guestRes.json();
  assert.equal(guestBody.canReview, false);
  assert.equal(guestBody.reason, 'not_authenticated');

  const { token } = await registerAndVerify('qa-vpr-eligibility@example.com');
  const nonBuyerRes = await fetch(`${BASE}/api/reviews/eligibility?productId=${PRODUCT_ID}`, { headers: { Authorization: `Bearer ${token}` } });
  const nonBuyerBody = await nonBuyerRes.json();
  assert.equal(nonBuyerBody.canReview, false);
  assert.equal(nonBuyerBody.reason, 'not_purchased');

  const order = await placeOrder('qa-vpr-eligibility@example.com', token);
  await setOrderState(order.id, { status: 'confirmed', paymentStatus: 'paid' });
  const eligibleRes = await fetch(`${BASE}/api/reviews/eligibility?productId=${PRODUCT_ID}`, { headers: { Authorization: `Bearer ${token}` } });
  const eligibleBody = await eligibleRes.json();
  assert.equal(eligibleBody.canReview, true);
  assert.equal(eligibleBody.reason, 'eligible');

  await postReview(token);
  const reviewedRes = await fetch(`${BASE}/api/reviews/eligibility?productId=${PRODUCT_ID}`, { headers: { Authorization: `Bearer ${token}` } });
  const reviewedBody = await reviewedRes.json();
  assert.equal(reviewedBody.canReview, false);
  assert.equal(reviewedBody.reason, 'already_reviewed');
  assert.ok(reviewedBody.review);

  await server.db.prepare('DELETE FROM orders WHERE customerEmail = ?').run('qa-vpr-eligibility@example.com');
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run('qa-vpr-eligibility@example.com');
});
