// EMAIL_SENDERS routing: dedicated env vars (SUPPORT_EMAIL/ORDERS_EMAIL/ADMIN_EMAIL)
// take priority; a deployment that only set the legacy SMTP_FROM keeps working
// unchanged. Fresh module instance per case for the same reason as
// tests/unit/smtp-config.test.mjs (env is read once at import time).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const VARS = ['SUPPORT_EMAIL', 'ORDERS_EMAIL', 'ADMIN_EMAIL', 'SMTP_FROM', 'SMTP_USER'];

async function freshMailer(env) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const key of VARS) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return await import(`../../server/mailer.mjs?t=${Date.now()}-${Math.random()}`);
  } finally {
    for (const key of VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('EMAIL_SENDERS: dedicated SUPPORT_EMAIL/ORDERS_EMAIL/ADMIN_EMAIL are used when set', async () => {
  const { EMAIL_SENDERS } = await freshMailer({
    SUPPORT_EMAIL: 'support@urbanphoenix.am',
    ORDERS_EMAIL: 'orders@urbanphoenix.am',
    ADMIN_EMAIL: 'admin@urbanphoenix.am',
    SMTP_USER: 'admin@urbanphoenix.am',
  });
  assert.equal(EMAIL_SENDERS.support.email, 'support@urbanphoenix.am');
  assert.equal(EMAIL_SENDERS.orders.email, 'orders@urbanphoenix.am');
  assert.equal(EMAIL_SENDERS.admin.email, 'admin@urbanphoenix.am');
});

test('EMAIL_SENDERS: falls back to the legacy SMTP_FROM address when no dedicated vars are set (pre-Zoho deployments keep working)', async () => {
  const { EMAIL_SENDERS } = await freshMailer({
    SMTP_FROM: 'Urban Phoenix <legacy@example.com>',
    SMTP_USER: 'legacy-auth@example.com',
  });
  assert.equal(EMAIL_SENDERS.support.email, 'legacy@example.com');
  assert.equal(EMAIL_SENDERS.orders.email, 'legacy@example.com');
  assert.equal(EMAIL_SENDERS.admin.email, 'legacy@example.com');
});

test('EMAIL_SENDERS: falls back to SMTP_USER when neither dedicated vars nor SMTP_FROM are set', async () => {
  const { EMAIL_SENDERS } = await freshMailer({ SMTP_USER: 'only-auth@example.com' });
  assert.equal(EMAIL_SENDERS.support.email, 'only-auth@example.com');
  assert.equal(EMAIL_SENDERS.orders.email, 'only-auth@example.com');
  assert.equal(EMAIL_SENDERS.admin.email, 'only-auth@example.com');
});
