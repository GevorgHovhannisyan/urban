import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// A hardcoded fallback secret here would be a real auth bypass — anyone who
// deploys without setting JWT_SECRET could forge admin/customer tokens using
// a string visible in this public repo. Instead, generate a random secret
// once and persist it locally so tokens stay valid across restarts without
// requiring any manual setup.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const dataDir = path.resolve(process.cwd(), 'data');
  const secretPath = path.join(dataDir, '.jwt-secret');
  try {
    const existing = readFileSync(secretPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // File doesn't exist yet — generate and persist one below.
  }

  const generated = randomBytes(48).toString('hex');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(secretPath, generated, { mode: 0o600 });
    console.log('Generated a new JWT signing secret at data/.jwt-secret (set JWT_SECRET in .env to control this explicitly).');
  } catch (err) {
    console.warn('Could not persist a generated JWT secret to disk; a new one will be generated on every restart, invalidating existing sessions.', err.message);
  }
  return generated;
}

export const JWT_SECRET = resolveJwtSecret();

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Used by login flows to keep response time constant whether or not the
// account exists — without this, "no such account" returns near-instantly
// while "wrong password for a real account" takes as long as a scrypt hash
// (deliberately slow), letting an attacker enumerate valid emails purely by
// timing the response. Precomputed (not generated via hashPassword() at
// import time) so it's a fixed constant, not something that could vary.
const DUMMY_HASH = 'ebd3d3b979cff6fc74325a76eeffd5d0:2ab7956f743a1c155368d6a41a2a59acd10176dd94b274dc2dbe669d6b7ad2db538e1ea30801b57b84402b4a5b5ce94e1c6b4eb2763dc9e747c6623834f43250';
export function verifyPasswordConstantTime(password) {
  // Always returns false (there is no real account behind this hash) — the
  // point is purely to burn the same amount of CPU time a real verifyPassword
  // call would, so callers use this in place of skipping verifyPassword
  // entirely when no matching user was found.
  verifyPassword(String(password || ''), DUMMY_HASH);
  return false;
}

export function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const attempt = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (attempt.length !== expected.length) return false;
  return timingSafeEqual(attempt, expected);
}
