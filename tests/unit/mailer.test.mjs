import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../server/mailer.mjs';

// Regression: server/mailer.mjs used to interpolate user-supplied text
// (account name, gift card sender/recipient name, personal message) directly
// into HTML email bodies with no escaping. The gift card purchase flow lets
// a purchaser choose an arbitrary recipientEmail, so unescaped input there
// could inject HTML/script into a third party's inbox, not just the
// purchaser's own. Fixed by routing every such value through escapeHtml()
// before it reaches an `html:` template.

test('escapeHtml neutralizes script tags', () => {
  const result = escapeHtml('<script>alert(1)</script>');
  assert.ok(!result.includes('<script>'));
  assert.equal(result, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapeHtml neutralizes an img-onerror injection attempt', () => {
  const result = escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!result.includes('<img'));
});

test('escapeHtml escapes quotes (prevents breaking out of an HTML attribute)', () => {
  const result = escapeHtml(`"><a href="//evil.example">click</a>`);
  assert.ok(!result.includes('"><a'));
});

test('escapeHtml leaves ordinary text untouched', () => {
  assert.equal(escapeHtml('Congrats on the new place!'), 'Congrats on the new place!');
});

test('escapeHtml handles null/undefined safely', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
