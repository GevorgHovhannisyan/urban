// Tests createRateLimiter() directly against a tiny throwaway Express app
// with a deliberately short window (200ms) so boundary + reset behavior can
// be verified in well under a second, instead of waiting out any of the
// real app's 15-minute windows (see server/app.mjs's authLimiter/
// writeLimiter/readLimiter, which this same middleware backs).
//
// Each test hits its own route rather than spoofing X-Forwarded-For: the
// real app never calls `app.set('trust proxy', ...)`, so req.ip always
// resolves to the raw socket address and ignores that header — spoofing it
// here would test behavior the real app doesn't have. Separate routes give
// independent buckets instead (the limiter keys on `${path}:${ip}`), which
// exercises the exact same boundary/reset logic without relying on
// trust-proxy handling this app doesn't opt into (see the QA report for the
// trust-proxy gap itself, which is a separate, real finding).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createRateLimiter } from '../../server/rate-limit.mjs';

let server;
let BASE;
const WINDOW_MS = 200;
const MAX = 3;

before(async () => {
  const app = express();
  const limiter = createRateLimiter({ windowMs: WINDOW_MS, max: MAX, message: 'Too many requests in this test.' });
  for (const route of ['below-limit', 'boundary', 'stays-blocked', 'resets', 'independent-a', 'independent-b']) {
    app.get(`/${route}`, limiter, (req, res) => res.json({ ok: true }));
  }
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test(`requests below the limit (1..${MAX}) all succeed`, async () => {
  for (let i = 0; i < MAX; i += 1) {
    const res = await fetch(`${BASE}/below-limit`);
    assert.equal(res.status, 200, `request #${i + 1} of ${MAX} should succeed`);
  }
});

test('the exact boundary: the request one past the limit is rejected with 429', async () => {
  for (let i = 0; i < MAX; i += 1) {
    const res = await fetch(`${BASE}/boundary`);
    assert.equal(res.status, 200);
  }
  const res = await fetch(`${BASE}/boundary`);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.match(body.error, /too many/i);
  assert.ok(res.headers.get('retry-after'), 'a 429 should tell the client how long to wait');
});

test('requests over the limit continue to be rejected until the window resets', async () => {
  for (let i = 0; i < MAX; i += 1) {
    await fetch(`${BASE}/stays-blocked`);
  }
  const overLimit1 = await fetch(`${BASE}/stays-blocked`);
  const overLimit2 = await fetch(`${BASE}/stays-blocked`);
  assert.equal(overLimit1.status, 429);
  assert.equal(overLimit2.status, 429);
});

test('the limit resets after the configured window elapses', async () => {
  for (let i = 0; i < MAX; i += 1) {
    await fetch(`${BASE}/resets`);
  }
  const blocked = await fetch(`${BASE}/resets`);
  assert.equal(blocked.status, 429);

  await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 60));

  const afterReset = await fetch(`${BASE}/resets`);
  assert.equal(afterReset.status, 200, 'a request after the window has elapsed should succeed again');
});

test('different routes get independent limit buckets for the same client', async () => {
  for (let i = 0; i < MAX; i += 1) {
    const res = await fetch(`${BASE}/independent-a`);
    assert.equal(res.status, 200);
  }
  // Exhausting /independent-a's bucket must not affect /independent-b.
  const otherRoute = await fetch(`${BASE}/independent-b`);
  assert.equal(otherRoute.status, 200);
});

test('auth/write/read limits in the real app use different thresholds (not one shared policy)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../server/app.mjs', import.meta.url), 'utf8');
  const authMax = Number(source.match(/authLimiter = createRateLimiter\(\{[^}]*max:\s*(\d+)/)?.[1]);
  const writeMax = Number(source.match(/writeLimiter = createRateLimiter\(\{[^}]*max:\s*(\d+)/)?.[1]);
  const readMax = Number(source.match(/readLimiter = createRateLimiter\(\{[^}]*max:\s*(\d+)/)?.[1]);
  assert.ok(authMax > 0 && writeMax > 0 && readMax > 0, 'expected all three limiters to be found in server/app.mjs');
  assert.ok(authMax < writeMax, 'auth (brute-force-sensitive) should be stricter than general writes');
  assert.ok(writeMax < readMax, 'writes should be stricter than reads');
});
