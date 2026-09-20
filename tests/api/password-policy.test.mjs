// Integration tests against a real Express server + isolated temp database.
// Regression/hardening: password minimum length raised from 6 to 8
// characters across registration, password reset, and change-password
// (server/customer-auth.mjs, server/account-api.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
const EMAIL = 'qa-password-policy@example.com';

before(async () => {
  server = await startTestServer('password-policy');
  BASE = server.baseUrl;
});

after(async () => {
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(EMAIL);
  await server.close();
});

test('registration rejects a 7-character password', async () => {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Policy', email: EMAIL, password: '1234567', country: 'Armenia' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /8 characters/i);

  const existing = await server.db.prepare('SELECT id FROM customers WHERE email = ?').get(EMAIL);
  assert.equal(existing, undefined, 'a rejected registration must not create an account');
});

test('registration accepts an 8-character password', async () => {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'QA', lastName: 'Policy', email: EMAIL, password: '12345678', country: 'Armenia' }),
  });
  assert.equal(res.status, 201);
});

test('an existing account with a legitimately shorter (pre-policy-change) password can still log in — server never re-validates password length at login time', async () => {
  // Simulates an account created before the minimum was raised: insert a
  // customer directly with a hash for a 5-character password, then confirm
  // login still succeeds (login only ever compares against the stored hash,
  // never re-checks the plaintext's length).
  const { hashPassword } = await import('../../server/password.mjs');
  const { randomUUID } = await import('node:crypto');
  const shortPasswordEmail = 'qa-legacy-short-password@example.com';
  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(shortPasswordEmail);
  await server.db.prepare(`
    INSERT INTO customers (id, name, firstName, lastName, email, passwordHash, country, phone, emailVerified)
    VALUES (?, 'Legacy User', 'Legacy', 'User', ?, ?, 'Armenia', '', 1)
  `).run(randomUUID(), shortPasswordEmail, hashPassword('abcde'));

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: shortPasswordEmail, password: 'abcde' }),
  });
  assert.equal(res.status, 200, 'an existing short password must still authenticate — only NEW passwords are held to the new minimum');

  await server.db.prepare('DELETE FROM customers WHERE email = ?').run(shortPasswordEmail);
});

test('password reset rejects a new password shorter than 8 characters', async () => {
  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('hex');
  await server.db.prepare('UPDATE customers SET resetToken = ?, resetExpires = ? WHERE email = ?')
    .run(token, new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '), EMAIL);

  const res = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, token, password: 'short1' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /8 characters/i);
});

test('change-password rejects a new password shorter than 8 characters', async () => {
  const codeRow = await server.db.prepare('SELECT verificationToken FROM customers WHERE email = ?').get(EMAIL);
  const code = codeRow?.verificationToken;
  await server.db.prepare('UPDATE customers SET emailVerified = 1 WHERE email = ?').run(EMAIL);
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: '12345678' }),
  });
  assert.equal(loginRes.status, 200, `test setup: login should succeed (code was: ${code})`);
  const { token } = await loginRes.json();

  const res = await fetch(`${BASE}/api/account/change-password`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: '12345678', newPassword: 'short1' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /8 characters/i);
});
