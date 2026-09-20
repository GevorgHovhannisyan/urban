// Verifies describeSmtpConfig()'s three-way status (unconfigured / partial /
// configured) and that its message never contains a credential value — only
// presence/absence and the non-secret host/user fields. Each case needs a
// fresh module instance (mailer.mjs computes isConfigured/EMAIL_SENDERS once
// at import time), so this appends a unique query string per import to
// bypass Node's ESM module cache rather than spawning a subprocess per case.
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function freshMailer(env) {
  const saved = { SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS };
  for (const key of Object.keys(saved)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return await import(`../../server/mailer.mjs?t=${Date.now()}-${Math.random()}`);
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('describeSmtpConfig: no SMTP_* vars set at all reports unconfigured', async () => {
  const { describeSmtpConfig } = await freshMailer({});
  const result = describeSmtpConfig();
  assert.equal(result.status, 'unconfigured');
});

test('describeSmtpConfig: some but not all SMTP_* vars set reports partial and names only the missing ones', async () => {
  const { describeSmtpConfig } = await freshMailer({ SMTP_HOST: 'smtp.zoho.eu', SMTP_USER: 'admin@urbanphoenix.am' });
  const result = describeSmtpConfig();
  assert.equal(result.status, 'partial');
  assert.match(result.message, /missing SMTP_PORT, SMTP_PASS/, 'the missing-vars list must name exactly PORT and PASS, in that order, and nothing else');
});

test('describeSmtpConfig: all four SMTP_* vars set reports configured, without ever including the password value', async () => {
  const { describeSmtpConfig } = await freshMailer({
    SMTP_HOST: 'smtp.zoho.eu', SMTP_PORT: '465', SMTP_USER: 'admin@urbanphoenix.am', SMTP_PASS: 'super-secret-app-password',
  });
  const result = describeSmtpConfig();
  assert.equal(result.status, 'configured');
  assert.doesNotMatch(result.message, /super-secret-app-password/, 'the configured message must never leak the SMTP password');
});
