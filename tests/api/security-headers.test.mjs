// Integration test against a real Express server + isolated temp database.
// Regression: responses had no security headers at all and leaked the
// backend framework via X-Powered-By: Express. Fixed in server/app.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;

before(async () => {
  server = await startTestServer('security-headers');
  BASE = server.baseUrl;
});

after(async () => {
  await server.close();
});

test('API responses do not leak the backend framework via X-Powered-By', async () => {
  const res = await fetch(`${BASE}/api/products`);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('API responses set X-Content-Type-Options: nosniff', async () => {
  const res = await fetch(`${BASE}/api/products`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('API responses set a Referrer-Policy', async () => {
  const res = await fetch(`${BASE}/api/products`);
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('security headers are present on error responses too, not just successful ones', async () => {
  const res = await fetch(`${BASE}/api/admin/products`); // 401, no token
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('security headers are present on the unmatched-route 404 response too', async () => {
  const res = await fetch(`${BASE}/api/definitely-not-a-real-route`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('a Content-Security-Policy is set and allows exactly the external origins this app actually uses', async () => {
  const res = await fetch(`${BASE}/api/products`);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'expected a Content-Security-Policy header');
  assert.match(csp, /script-src[^;]*'self'/);
  assert.match(csp, /script-src[^;]*https:\/\/js\.stripe\.com/, 'Stripe.js must be allowed to load');
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'inline scripts should never be allowed — no legitimate use in this app');
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
  assert.match(csp, /img-src[^;]*https:\/\/images\.unsplash\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.stripe\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/ipapi\.co/);
  assert.match(csp, /frame-src[^;]*https:\/\/js\.stripe\.com/);
  assert.match(csp, /object-src[^;]*'none'/);
});

test('the default (production) app locks down framing via both frame-ancestors and X-Frame-Options', async () => {
  const res = await fetch(`${BASE}/api/products`);
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('a dev-preview app (allowFraming: true) does not set X-Frame-Options and relaxes frame-ancestors', async () => {
  const { createApp } = await import('../../server/app.mjs');
  const http = await import('node:http');
  const devApp = createApp({ allowFraming: true });
  const devServer = http.createServer(devApp);
  await new Promise((resolve) => devServer.listen(0, '127.0.0.1', resolve));
  const port = devServer.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/products`);
    assert.equal(res.headers.get('x-frame-options'), null);
    assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors \*/);
  } finally {
    await new Promise((resolve) => devServer.close(resolve));
  }
});

test('HSTS (Strict-Transport-Security) is set', async () => {
  const res = await fetch(`${BASE}/api/products`);
  const hsts = res.headers.get('strict-transport-security');
  assert.ok(hsts);
  assert.match(hsts, /max-age=\d+/);
  assert.match(hsts, /includeSubDomains/);
});

test('a restrictive Permissions-Policy is set (no camera/mic/geolocation for a storefront that never uses them)', async () => {
  const res = await fetch(`${BASE}/api/products`);
  const pp = res.headers.get('permissions-policy');
  assert.ok(pp);
  assert.match(pp, /camera=\(\)/);
  assert.match(pp, /microphone=\(\)/);
  assert.match(pp, /geolocation=\(\)/);
});
