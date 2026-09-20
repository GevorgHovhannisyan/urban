// Unit tests for the admin credential guard (server/admin-config-guard.mjs).
// Pure function tests — no HTTP server needed, since assertSecureAdminConfig()
// only reads process.env and either throws or doesn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSecureAdminConfig, isDefaultAdminPasswordConfigured, KNOWN_DEFAULT_ADMIN_PASSWORD } from '../../server/admin-config-guard.mjs';

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('production + ADMIN_PASSWORD unset (would seed the documented default) refuses to start', () => {
  withEnv({ NODE_ENV: 'production', ADMIN_PASSWORD: undefined }, () => {
    assert.throws(() => assertSecureAdminConfig(), /Refusing to start in production/);
  });
});

test('production + ADMIN_PASSWORD explicitly set to the documented default refuses to start', () => {
  withEnv({ NODE_ENV: 'production', ADMIN_PASSWORD: KNOWN_DEFAULT_ADMIN_PASSWORD }, () => {
    assert.throws(() => assertSecureAdminConfig(), /Refusing to start in production/);
  });
});

test('production + a real, non-default ADMIN_PASSWORD starts normally', () => {
  withEnv({ NODE_ENV: 'production', ADMIN_PASSWORD: 'a-strong-unique-password-24601' }, () => {
    assert.doesNotThrow(() => assertSecureAdminConfig());
  });
});

test('non-production (dev/test) with the default password never blocks startup', () => {
  withEnv({ NODE_ENV: 'test', ADMIN_PASSWORD: undefined }, () => {
    assert.doesNotThrow(() => assertSecureAdminConfig());
  });
  withEnv({ NODE_ENV: undefined, ADMIN_PASSWORD: KNOWN_DEFAULT_ADMIN_PASSWORD }, () => {
    assert.doesNotThrow(() => assertSecureAdminConfig());
  });
});

test('isDefaultAdminPasswordConfigured() reflects the resolved (env-or-fallback) password, matching seed.mjs', () => {
  withEnv({ ADMIN_PASSWORD: undefined }, () => {
    assert.equal(isDefaultAdminPasswordConfigured(), true, 'unset ADMIN_PASSWORD resolves to the same default seed.mjs would use');
  });
  withEnv({ ADMIN_PASSWORD: 'something-else-entirely' }, () => {
    assert.equal(isDefaultAdminPasswordConfigured(), false);
  });
});
