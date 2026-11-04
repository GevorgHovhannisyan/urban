// Permanent account deletion (DELETE /api/account), against a real Express
// server + isolated temp database: checks the confirmations, and what is
// deleted vs. kept in the database afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const PASSWORD = 'TestPass123';

const json = (method, body, token) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function registerCustomer(email) {
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(email);
  await fetch(`${BASE}/api/auth/register`, json('POST', { firstName: 'QA', lastName: 'Delete', email, password: PASSWORD, country: 'Armenia' }));
  const row = await server.db.prepare('SELECT id, verificationToken FROM customers WHERE email = ?').get(email);
  const verified = await fetch(`${BASE}/api/auth/verify-code`, json('POST', { email, code: row.verificationToken })).then((r) => r.json());
  return { id: row.id, token: verified.token, email };
}

before(async () => {
  server = await startTestServer('account-deletion');
  BASE = server.baseUrl;
});

after(async () => {
  await server.close();
});

test('requires sign-in', async () => {
  const res = await fetch(`${BASE}/api/account`, json('DELETE', { password: PASSWORD, confirm: 'DELETE' }));
  assert.equal(res.status, 401);
});

test('requires typing DELETE and the correct password — nothing is deleted otherwise', async () => {
  const c = await registerCustomer(`qa-delete-guard-${randomUUID().slice(0, 8)}@example.com`);
  const noConfirm = await fetch(`${BASE}/api/account`, json('DELETE', { password: PASSWORD, confirm: 'delet' }, c.token));
  assert.equal(noConfirm.status, 400);
  const wrongPassword = await fetch(`${BASE}/api/account`, json('DELETE', { password: 'WrongPass999', confirm: 'DELETE' }, c.token));
  assert.equal(wrongPassword.status, 401);
  assert.ok(await server.db.prepare('SELECT id FROM customers WHERE id = ?').get(c.id), 'account must still exist');
});

test('deletes the account and its personal data, keeps orders (unlinked) and anonymises reviews', async () => {
  const c = await registerCustomer(`qa-delete-${randomUUID().slice(0, 8)}@example.com`);

  // Data that belongs to the account.
  await server.db.prepare(`INSERT INTO customer_addresses (id, customerId, firstName, lastName, phone, country, city, postalCode, address, isDefault)
    VALUES (?, ?, 'QA', 'Delete', '123', 'AM', 'Yerevan', '0001', '1 St', 1)`).run(randomUUID(), c.id);
  await server.db.prepare(`INSERT INTO customer_wishlist (customerId, productId) VALUES (?, 'some-product')`).run(c.id);
  await server.db.prepare(`INSERT INTO newsletter_subscribers (id, email) VALUES (?, ?)`).run(randomUUID(), c.email);
  const orderId = randomUUID();
  await server.db.prepare(`INSERT INTO orders (id, orderNumber, createdAt, status, paymentMethod, paymentStatus, currency, region, priceMultiplier,
      customerFirstName, customerLastName, customerEmail, customerPhone, customerCountry, customerCity, customerPostalCode, customerAddress,
      items, subtotal, shipping, total, customerId)
    VALUES (?, ?, NOW(), 'delivered', 'card', 'paid', 'USD', 'OTHER', 1, 'QA', 'Delete', ?, '123', 'AM', 'Yerevan', '0001', '1 St', '[]', 100, 0, 100, ?)`)
    .run(orderId, `UP-TEST-${randomUUID().slice(0, 6)}`, c.email, c.id);
  const reviewId = randomUUID();
  await server.db.prepare(`INSERT INTO reviews (id, productId, userId, author, email, rating, body, createdAt, verified)
    VALUES (?, 'some-product', ?, 'QA Delete', ?, 5, 'Great hoodie', NOW(), 1)`).run(reviewId, c.id, c.email);

  const res = await fetch(`${BASE}/api/account`, json('DELETE', { password: PASSWORD, confirm: 'DELETE' }, c.token));
  assert.equal(res.status, 200, await res.text());

  assert.equal(await server.db.prepare('SELECT id FROM customers WHERE id = ?').get(c.id), undefined, 'account row deleted');
  assert.equal((await server.db.prepare('SELECT COUNT(*) n FROM customer_addresses WHERE customerId = ?').get(c.id)).n, 0, 'addresses deleted');
  assert.equal((await server.db.prepare('SELECT COUNT(*) n FROM customer_wishlist WHERE customerId = ?').get(c.id)).n, 0, 'wishlist deleted');
  assert.equal((await server.db.prepare('SELECT COUNT(*) n FROM newsletter_subscribers WHERE email = ?').get(c.email)).n, 0, 'newsletter subscription removed');

  const order = await server.db.prepare('SELECT customerId FROM orders WHERE id = ?').get(orderId);
  assert.ok(order, 'order record kept for accounting');
  assert.equal(order.customerId, null, 'order no longer linked to the account');

  const review = await server.db.prepare('SELECT userId, email, author, body FROM reviews WHERE id = ?').get(reviewId);
  assert.equal(review.userId, null);
  assert.equal(review.email, null);
  assert.equal(review.author, 'Former customer');
  assert.equal(review.body, 'Great hoodie', 'review text stays published');

  // The old session no longer works, and the account can't sign in again.
  const profile = await fetch(`${BASE}/api/account/profile`, { headers: { Authorization: `Bearer ${c.token}` } });
  assert.equal(profile.status, 404);
  const login = await fetch(`${BASE}/api/auth/login`, json('POST', { email: c.email, password: PASSWORD }));
  assert.notEqual(login.status, 200);
});

test('deleting one account never touches another customer', async () => {
  const a = await registerCustomer(`qa-delete-a-${randomUUID().slice(0, 8)}@example.com`);
  const b = await registerCustomer(`qa-delete-b-${randomUUID().slice(0, 8)}@example.com`);
  const res = await fetch(`${BASE}/api/account`, json('DELETE', { password: PASSWORD, confirm: 'DELETE' }, a.token));
  assert.equal(res.status, 200);
  assert.ok(await server.db.prepare('SELECT id FROM customers WHERE id = ?').get(b.id));
});
