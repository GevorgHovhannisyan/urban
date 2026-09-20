// Verifies the mailer's send-failure path is genuinely distinct from its
// unconfigured path, and never carries the verification code / reset link.
//
// SMTP_HOST/PORT/USER/PASS must be set BEFORE mailer.mjs is first imported
// in this process — isConfigured/transporter are computed once at module
// load time (see mailer.mjs), not re-evaluated per call. Pointing at
// 127.0.0.1:1 (nothing listens there) makes nodemailer attempt a real
// connection and fail fast with a genuine ECONNREFUSED — this is a real
// failure, not a mocked one.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1';
process.env.SMTP_USER = 'test@example.com';
process.env.SMTP_PASS = 'test-password';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sendVerificationCode, sendPasswordResetEmail } = await import('../../server/mailer.mjs');

test('SMTP configured but send fails: verification code reports send-failed and carries no previewCode', async () => {
  const result = await sendVerificationCode({ to: 'audit@example.com', name: 'Audit', code: '654321' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'send-failed');
  assert.equal(Object.hasOwn(result, 'previewCode'), false, 'a real send failure must never carry the verification code');
});

test('SMTP configured but send fails: password reset reports send-failed and carries no previewLink', async () => {
  const result = await sendPasswordResetEmail({ to: 'audit@example.com', name: 'Audit', link: 'http://localhost:4173/reset-password?token=abc' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'send-failed');
  assert.equal(Object.hasOwn(result, 'previewLink'), false, 'a real send failure must never carry the reset link');
});
