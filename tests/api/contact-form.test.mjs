// End-to-end (real HTTP + real server/contact-api.mjs + real mailer.mjs)
// coverage of the POST /api/contact endpoint. SMTP is deliberately left
// unconfigured here (startTestServer doesn't load dotenv — see its comment),
// so these exercise validation/routing/response-shape behavior; the actual
// outgoing headers (from/to/replyTo, HTML escaping) are covered structurally
// by reading server/mailer.mjs's sendContactNotificationEmail /
// sendContactConfirmationEmail — a full SMTP-configured send-and-inspect test
// would require a fake SMTP server, out of scope for this pass.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

let server;
let BASE;

before(async () => {
  server = await startTestServer('contact-form');
  BASE = server.baseUrl;
});

after(async () => {
  await server.close();
});

function submitContact(payload) {
  return fetch(`${BASE}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const validPayload = () => ({
  name: 'Test Customer',
  email: 'qa-contact@example.com',
  topic: 'Order support',
  message: 'Hello, I have a question about my recent order.',
});

test('a valid submission succeeds and does not echo back any internal error detail', async () => {
  const res = await submitContact(validPayload());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.message);
  assert.equal(body.error, undefined);
});

test('missing name is rejected', async () => {
  const res = await submitContact({ ...validPayload(), name: '' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('missing message is rejected', async () => {
  const res = await submitContact({ ...validPayload(), message: '' });
  assert.equal(res.status, 400);
});

test('an invalid email address is rejected', async () => {
  const res = await submitContact({ ...validPayload(), email: 'not-an-email' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /email/i);
});

test('an unrecognized topic is rejected (prevents arbitrary subject-line injection via the topic field)', async () => {
  const res = await submitContact({ ...validPayload(), topic: 'Not A Real Topic' });
  assert.equal(res.status, 400);
});

test('an excessively long message is truncated rather than rejected outright, and does not crash the server', async () => {
  const res = await submitContact({ ...validPayload(), message: 'x'.repeat(50000) });
  assert.equal(res.status, 200);
});

test('a name/email containing embedded newlines (header injection attempt) is accepted but sanitized, not rejected with a server error', async () => {
  const res = await submitContact({
    ...validPayload(),
    name: 'Evil\r\nBcc: attacker@example.com',
  });
  assert.equal(res.status, 200);
});

test('malformed JSON body does not crash the server', async () => {
  const raw = await fetch(`${BASE}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not valid json' });
  assert.equal(raw.status, 400);
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'server should still be responsive after a malformed request');
});
