import jwt from 'jsonwebtoken';
import { get } from './db.mjs';
import { verifyPassword, verifyPasswordConstantTime, JWT_SECRET } from './password.mjs';
import { isProduction } from './env.mjs';
import { KNOWN_DEFAULT_ADMIN_PASSWORD } from './admin-config-guard.mjs';

const TOKEN_TTL = '12h';

export async function login(email, password) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const admin = await get('SELECT * FROM admin_users WHERE email = ?', [normalizedEmail]);
  // Runs the same expensive hash comparison either way so a nonexistent
  // admin account can't be distinguished from a wrong password by response
  // time — see password.mjs's comment.
  if (!admin) { verifyPasswordConstantTime(password); return { error: 'Invalid email or password.' }; }
  if (!verifyPassword(password, admin.passwordHash)) return { error: 'Invalid email or password.' };
  // Defense-in-depth behind assertSecureAdminConfig()'s startup check (which
  // only covers a fresh boot): if this process was already running when
  // NODE_ENV flipped to production, or the account was seeded insecurely
  // before that guard existed, this still refuses the literal documented
  // default password in production — same generic error, so it doesn't leak
  // *why* the login failed.
  if (isProduction() && password === KNOWN_DEFAULT_ADMIN_PASSWORD) {
    return { error: 'Invalid email or password.' };
  }

  const token = jwt.sign({ sub: admin.id, email: admin.email, role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, email: admin.email };
}

export function requireAdmin(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') {
      res.status(401).json({ error: 'Authentication required.' });
      return null;
    }
    return payload;
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return null;
  }
}
