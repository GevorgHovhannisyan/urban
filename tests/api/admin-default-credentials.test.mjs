// Defense-in-depth: even if a process were already running (or an account
// was seeded insecurely) before NODE_ENV flipped to production,
// auth.mjs's login() itself refuses the literal documented default password
// in production. This is the layer BEHIND assertSecureAdminConfig() (the
// startup guard, tested in tests/unit/admin-config-guard.test.mjs) — that
// guard only runs once, from server.mjs, which startTestServer() below
// deliberately doesn't go through (it calls createApp() directly, the same
// way the Vite dev plugin does) — so this file exercises the second layer
// that's actually reachable from an HTTP request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';
import { KNOWN_DEFAULT_ADMIN_PASSWORD } from '../../server/admin-config-guard.mjs';

let server;
let BASE;

before(async () => {
  server = await startTestServer('admin-default-credentials');
  BASE = server.baseUrl;
});

after(async () => {
  await server.close();
});

async function login(email, password) {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

test('outside production: the documented default admin credentials work (matches local dev/preview today)', async () => {
  const original = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    const { status, body } = await login('admin@urbanphoenix.com', KNOWN_DEFAULT_ADMIN_PASSWORD);
    assert.equal(status, 200);
    assert.ok(body.token, 'a valid admin JWT is issued outside production');
  } finally {
    if (original !== undefined) process.env.NODE_ENV = original;
  }
});

test('in production: the documented default admin password is refused even though the stored hash matches', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { status, body } = await login('admin@urbanphoenix.com', KNOWN_DEFAULT_ADMIN_PASSWORD);
    assert.equal(status, 401);
    assert.equal(body.token, undefined, 'no token is issued for the default password in production');
    assert.equal(body.error, 'Invalid email or password.', 'the error is the same generic message as any wrong password — it must not reveal *why* this specific attempt failed');
  } finally {
    if (original !== undefined) process.env.NODE_ENV = original;
    else delete process.env.NODE_ENV;
  }
});

test('in production: a genuinely wrong password still gets the identical generic error (no distinguishable behavior)', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { status, body } = await login('admin@urbanphoenix.com', 'some-other-wrong-password');
    assert.equal(status, 401);
    assert.equal(body.error, 'Invalid email or password.');
  } finally {
    if (original !== undefined) process.env.NODE_ENV = original;
    else delete process.env.NODE_ENV;
  }
});
