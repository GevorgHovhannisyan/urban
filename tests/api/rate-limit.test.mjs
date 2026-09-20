// Confirms the real authLimiter (server/app.mjs, max 10 per 15-minute
// window) is actually wired up on a live auth endpoint — the boundary/reset
// *logic* itself is unit-tested in tests/unit/rate-limit.test.mjs with a
// short synthetic window; this only proves the real endpoint uses it.
// Doesn't wait for the real 15-minute window to reset (avoided per the
// "don't make these tests unnecessarily slow" guidance) — that reset
// behavior is already covered against a fast synthetic window elsewhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;

before(async () => {
  server = await startTestServer('rate-limit');
  BASE = server.baseUrl;
});

after(async () => {
  await server.close();
});

test('the admin login endpoint (authLimiter, max 10) accepts up to the limit and rejects the 11th request in the same window', async () => {
  const attempt = () => fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
  });

  const results = [];
  for (let i = 0; i < 11; i += 1) {
    results.push((await attempt()).status);
  }

  const first10 = results.slice(0, 10);
  const eleventh = results[10];
  assert.ok(first10.every((status) => status === 401), 'the first 10 (wrong-credential) attempts should all be rejected for being wrong, not for rate limiting');
  assert.equal(eleventh, 429, 'the 11th attempt in the same window must be rate-limited');
});
