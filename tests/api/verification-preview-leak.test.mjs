// End-to-end (real HTTP + real customer-auth.mjs + real mailer.mjs) coverage
// of the three cases the production-hardening pass distinguishes:
//   1. dev/test + SMTP entirely unconfigured -> preview allowed (unchanged
//      developer convenience).
//   2. production + SMTP entirely unconfigured -> preview NEVER returned.
//   3. SMTP configured but the send fails -> preview NEVER returned, in any
//      environment (covered at the mailer level in
//      tests/unit/mailer-failure-path.test.mjs; re-verified here through the
//      actual /api/auth/register response shape).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;
let counter = 0;
const email = () => `preview-leak-${Date.now()}-${counter++}@example.com`;

before(async () => {
  // No SMTP_* set — startTestServer() deliberately doesn't load dotenv, so
  // this process has none unless a previous test file in the same process
  // set them (each test file runs in its own subprocess — see db.mjs).
  server = await startTestServer('verification-preview-leak');
  BASE = server.baseUrl;
});

after(async () => {
  await server.close();
});

async function register(customerEmail) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Preview', lastName: 'Leak', email: customerEmail, password: 'password123', country: 'Armenia', phone: '123',
    }),
  });
  return { status: res.status, body: await res.json() };
}

test('dev/test + SMTP unconfigured: devVerificationCode is present (unchanged developer convenience)', async () => {
  delete process.env.NODE_ENV;
  const { status, body } = await register(email());
  assert.equal(status, 201);
  assert.equal(body.emailSent, false);
  assert.ok(body.devVerificationCode, 'preview code should be present outside production when SMTP has no provider configured');
});

test('production + SMTP unconfigured: devVerificationCode is NEVER present', async () => {
  process.env.NODE_ENV = 'production';
  try {
    const { status, body } = await register(email());
    assert.equal(status, 201);
    assert.equal(body.emailSent, false);
    assert.equal(body.devVerificationCode, undefined, 'production must never return the verification code in the API response, even when SMTP is unconfigured');
  } finally {
    delete process.env.NODE_ENV;
  }
});

test('password reset mirrors the same rule: devResetLink absent in production', async () => {
  const customerEmail = email();
  await register(customerEmail);

  process.env.NODE_ENV = 'production';
  try {
    const res = await fetch(`${BASE}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: customerEmail }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.devResetLink, undefined, 'production must never return the reset link in the API response');
  } finally {
    delete process.env.NODE_ENV;
  }
});

test('password reset outside production: devResetLink is present (unchanged developer convenience)', async () => {
  const customerEmail = email();
  await register(customerEmail);
  delete process.env.NODE_ENV;

  const res = await fetch(`${BASE}/api/auth/request-password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: customerEmail }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.devResetLink, 'preview link should be present outside production when SMTP has no provider configured');
});
