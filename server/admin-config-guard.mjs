import { isProduction } from './env.mjs';

// The literal values documented in .env.example / seed.mjs's fallback — not
// a secret, just the known public placeholder every clone of this repo
// starts with. Detecting it is how we catch "still running the documented
// default" without needing to store or compare against anything sensitive.
export const KNOWN_DEFAULT_ADMIN_EMAIL = 'admin@urbanphoenix.com';
export const KNOWN_DEFAULT_ADMIN_PASSWORD = 'ChangeMe123!';

// Mirrors seed.mjs's own fallback exactly — this must resolve the same
// email/password seed.mjs would actually create the account with, or this
// guard could pass while a fresh install still seeds the insecure default.
export function resolvedAdminEmail() {
  return (process.env.ADMIN_EMAIL || KNOWN_DEFAULT_ADMIN_EMAIL).toLowerCase().trim();
}
export function isDefaultAdminPasswordConfigured() {
  const password = process.env.ADMIN_PASSWORD || KNOWN_DEFAULT_ADMIN_PASSWORD;
  return password === KNOWN_DEFAULT_ADMIN_PASSWORD;
}

// Called once at server startup (server.mjs) — throws rather than returning
// a boolean, so a production boot with an unset/default ADMIN_PASSWORD can't
// accidentally be ignored by a caller that forgets to check a return value.
// Never logs or includes the actual password value, configured or default.
export function assertSecureAdminConfig() {
  if (!isProduction()) return;
  if (!isDefaultAdminPasswordConfigured()) return;
  throw new Error(
    'Refusing to start in production: ADMIN_PASSWORD is unset or still the documented default. ' +
    'Set a strong, unique ADMIN_PASSWORD (and ADMIN_EMAIL) in your environment before starting the server in production. ' +
    'See .env.example for the variable names.'
  );
}
