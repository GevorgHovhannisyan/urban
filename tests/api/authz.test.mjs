// Integration tests against a real Express server + isolated temp database
// (see tests/helpers/test-server.mjs) — not a developer's running dev/prod
// server, and not the shared runtime data/urbanphoenix.db.
// Verifies role-based access control: admin routes must reject missing/
// invalid/expired tokens and, critically, must reject a *valid* token for
// the wrong role (a customer session must never be usable against admin
// endpoints), and a customer must never be able to reach another customer's
// protected resources.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
let customerToken;
let customerBId;
let adminToken;
let customerAAddressId;

const EMAIL_A = 'qa-authz-customer-a@example.com';
const EMAIL_B = 'qa-authz-customer-b@example.com';

async function registerAndVerify(email) {
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Authz', email, password: 'TestPass123', country: 'Armenia' }),
  });
  const row = await server.db.prepare('SELECT id, verificationToken FROM customers WHERE email = ?').get(email);
  const verifyRes = await fetch(`${BASE}/api/auth/verify-code`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: row.verificationToken }),
  });
  const body = await verifyRes.json();
  return { token: body.token, id: row.id };
}

before(async () => {
  server = await startTestServer('authz');
  BASE = server.baseUrl;

  await server.db.prepare('DELETE FROM customers WHERE email IN (?, ?)').run(EMAIL_A, EMAIL_B);

  const a = await registerAndVerify(EMAIL_A);
  customerToken = a.token;
  const address = await fetch(`${BASE}/api/account/addresses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ firstName: 'QA', lastName: 'A', phone: '123', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 St' }),
  }).then((r) => r.json());
  customerAAddressId = address.address.id;

  const b = await registerAndVerify(EMAIL_B);
  customerBId = b.id;

  const adminLogin = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  }).then((r) => r.json());
  adminToken = adminLogin.token;
});

after(async () => {
  await server.db.prepare('DELETE FROM customers WHERE email IN (?, ?)').run(EMAIL_A, EMAIL_B);
  await server.close();
});

test('admin API rejects requests with no Authorization header', async () => {
  const res = await fetch(`${BASE}/api/admin/products`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error);
});

test('admin API rejects a malformed/bogus bearer token', async () => {
  const res = await fetch(`${BASE}/api/admin/products`, { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.equal(res.status, 401);
});

test('admin API rejects an expired admin token', async () => {
  const expired = jwt.sign({ sub: 'admin-1', email: process.env.ADMIN_EMAIL, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: -10 });
  const res = await fetch(`${BASE}/api/admin/products`, { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(res.status, 401);
});

test('admin API rejects a valid customer-role token (no privilege escalation)', async () => {
  const res = await fetch(`${BASE}/api/admin/products`, { headers: { Authorization: `Bearer ${customerToken}` } });
  assert.equal(res.status, 401);
  const res2 = await fetch(`${BASE}/api/admin/overview`, { headers: { Authorization: `Bearer ${customerToken}` } });
  assert.equal(res2.status, 401);
});

test('a customer cannot write to admin-only mutation endpoints (products/orders) with their own token', async () => {
  const createRes = await fetch(`${BASE}/api/admin/products`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ name: 'Escalation Attempt', price: 1 }),
  });
  assert.equal(createRes.status, 401);

  const patchRes = await fetch(`${BASE}/api/admin/orders/does-not-matter`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(patchRes.status, 401);
});

test('a forged token payload claiming role "admin" but signed with the wrong secret is rejected', async () => {
  const forged = jwt.sign({ sub: 'attacker', email: 'attacker@example.com', role: 'admin' }, 'wrong-secret-guess');
  const res = await fetch(`${BASE}/api/admin/products`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 401);
});

test('a valid admin token works on admin endpoints', async () => {
  const res = await fetch(`${BASE}/api/admin/overview`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.productCount === 'number');
});

test('a customer token works correctly on their own account endpoints', async () => {
  const res = await fetch(`${BASE}/api/account/overview`, { headers: { Authorization: `Bearer ${customerToken}` } });
  assert.equal(res.status, 200);
});

test('account endpoints reject requests with no token', async () => {
  const res = await fetch(`${BASE}/api/account/overview`);
  assert.equal(res.status, 401);
});

test('account endpoints reject an expired customer token', async () => {
  const expired = jwt.sign({ sub: 'whoever', email: EMAIL_A, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: -10 });
  const res = await fetch(`${BASE}/api/account/overview`, { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(res.status, 401);
});

test('customer data isolation: customer B cannot read customer A\'s address by id', async () => {
  // customerToken belongs to customer A; sign a token for B and try to
  // reach A's address through B's own (legitimate) session.
  const tokenB = jwt.sign({ sub: customerBId, email: EMAIL_B, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch(`${BASE}/api/account/addresses/${customerAAddressId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ city: 'Hijacked' }),
  });
  assert.equal(res.status, 404, 'customer B must not be able to modify customer A\'s address, and the response must not distinguish "not yours" from "does not exist"');

  const deleteRes = await fetch(`${BASE}/api/account/addresses/${customerAAddressId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(deleteRes.status, 404, 'customer B must not be able to delete customer A\'s address');

  // Confirm A's address is genuinely untouched.
  const listRes = await fetch(`${BASE}/api/account/addresses`, { headers: { Authorization: `Bearer ${customerToken}` } });
  const list = await listRes.json();
  const stillThere = list.addresses.find((a) => a.id === customerAAddressId);
  assert.ok(stillThere, 'address must still exist for its real owner');
  assert.notEqual(stillThere.city, 'Hijacked');
});

test('customer data isolation: customer B\'s order list never includes customer A\'s orders', async () => {
  const res = await fetch(`${BASE}/api/orders/mine`, { headers: { Authorization: `Bearer ${customerToken}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.orders));
  assert.ok(body.orders.every((o) => o.customer.email === EMAIL_A));
});
