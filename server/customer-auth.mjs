import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { all, get, run } from './db.mjs';
import { hashPassword, verifyPassword, verifyPasswordConstantTime, JWT_SECRET } from './password.mjs';
import { sendVerificationCode, sendPasswordResetEmail, getPublicUrl } from './mailer.mjs';
import { isProduction } from './env.mjs';

// The dev-preview code/link is only ever safe to hand back to the client
// when BOTH are true: SMTP genuinely has no provider configured on this
// machine (not "configured but the send failed" — see mailer.mjs's `reason`
// field), AND this isn't a production run. A configured-provider failure
// never qualifies, in any environment — that's a real operational problem,
// not a "let me test the flow without SMTP" convenience.
function canExposeDevPreview(emailResult) {
  return emailResult.reason === 'unconfigured' && !isProduction();
}

const TOKEN_TTL = '30d';
const VERIFICATION_TTL_MINUTES = 30;
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESET_TTL_MINUTES = 60;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max);

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    name: row.name,
    email: row.email,
    country: row.country,
    phone: row.phone,
    emailVerified: Boolean(row.emailVerified),
    createdAt: row.createdAt,
  };
}

function issueToken(customer) {
  return jwt.sign({ sub: customer.id, email: customer.email, role: 'customer' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function generateCode() {
  return String(randomInt(100000, 1000000)); // 6 digits, zero-padded by range
}

function toMysqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function issueVerificationCode(customer, { isResend = false } = {}) {
  const code = generateCode();
  const expires = toMysqlDatetime(new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60 * 1000));
  await run('UPDATE customers SET verificationToken = ?, verificationExpires = ?, verificationAttempts = 0 WHERE id = ?', [code, expires, customer.id]);
  const emailResult = await sendVerificationCode({ to: customer.email, name: customer.firstName || customer.name, code });
  return {
    message: isResend
      ? 'A new verification code has been sent to your email.'
      : 'Account created. Enter the verification code we sent to your email.',
    emailSent: emailResult.sent,
    // Only present in local/dev when SMTP has no provider configured at all
    // — never when a configured provider failed to send, and never in
    // production either way. See canExposeDevPreview() above.
    devVerificationCode: canExposeDevPreview(emailResult) ? emailResult.previewCode : undefined,
  };
}

export async function registerCustomer({ firstName, lastName, email, password, country, phone }) {
  const cleanFirstName = clean(firstName, 60);
  const cleanLastName = clean(lastName, 60);
  const cleanEmail = clean(email, 120).toLowerCase();
  const cleanCountry = clean(country, 80);
  const cleanPhone = clean(phone, 40);

  if (!cleanFirstName) return { status: 400, body: { error: 'Please enter your first name.' } };
  if (!cleanLastName) return { status: 400, body: { error: 'Please enter your last name.' } };
  if (!cleanCountry) return { status: 400, body: { error: 'Please select your country.' } };
  if (!emailPattern.test(cleanEmail)) return { status: 400, body: { error: 'Please enter a valid email address.' } };
  if (!password || String(password).length < 8) return { status: 400, body: { error: 'Password must be at least 8 characters.' } };

  const existing = await get('SELECT id FROM customers WHERE email = ?', [cleanEmail]);
  if (existing) return { status: 409, body: { error: 'An account with this email already exists. Try signing in instead.' } };

  const id = randomUUID();
  const name = `${cleanFirstName} ${cleanLastName}`.trim();

  await run(
    `INSERT INTO customers (id, name, firstName, lastName, email, passwordHash, country, phone, emailVerified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, name, cleanFirstName, cleanLastName, cleanEmail, hashPassword(String(password)), cleanCountry, cleanPhone]
  );

  const customer = await get('SELECT * FROM customers WHERE id = ?', [id]);
  const result = await issueVerificationCode(customer);
  return { status: 201, body: { ...result, email: cleanEmail } };
}

export async function verifyCode(email, code) {
  const cleanEmail = clean(email, 120).toLowerCase();
  const cleanCode = clean(code, 10);
  const customer = await get('SELECT * FROM customers WHERE email = ?', [cleanEmail]);

  if (!customer) return { status: 400, body: { error: 'Invalid email or code.' } };
  if (customer.emailVerified) return { status: 400, body: { error: 'This account is already verified. Please sign in.' } };
  if (!customer.verificationToken) return { status: 400, body: { error: 'No verification code is pending. Request a new one.' } };
  if (customer.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { status: 429, body: { error: 'Too many incorrect attempts. Request a new code.' } };
  }
  if (customer.verificationExpires && new Date(customer.verificationExpires).getTime() < Date.now()) {
    return { status: 400, body: { error: 'This code has expired. Request a new one.' } };
  }
  if (cleanCode !== customer.verificationToken) {
    await run('UPDATE customers SET verificationAttempts = verificationAttempts + 1 WHERE id = ?', [customer.id]);
    const remaining = MAX_VERIFICATION_ATTEMPTS - (customer.verificationAttempts + 1);
    return { status: 400, body: { error: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Incorrect code. Request a new one.' } };
  }

  await run('UPDATE customers SET emailVerified = 1, verificationToken = NULL, verificationExpires = NULL, verificationAttempts = 0 WHERE id = ?', [customer.id]);
  const updated = await get('SELECT * FROM customers WHERE id = ?', [customer.id]);
  // Verifying logs the customer in immediately — no need to re-enter their password.
  return { status: 200, body: { token: issueToken(updated), user: serialize(updated) } };
}

export async function resendVerification(email) {
  const cleanEmail = clean(email, 120).toLowerCase();
  const customer = await get('SELECT * FROM customers WHERE email = ?', [cleanEmail]);
  // Don't reveal whether the account exists.
  const generic = { message: 'If that account needs verification, a new code has been sent.' };
  if (!customer || customer.emailVerified) return { status: 200, body: generic };

  const result = await issueVerificationCode(customer, { isResend: true });
  return { status: 200, body: { ...generic, emailSent: result.emailSent, devVerificationCode: result.devVerificationCode } };
}

export async function loginCustomer({ email, password }) {
  const cleanEmail = clean(email, 120).toLowerCase();
  const customer = await get('SELECT * FROM customers WHERE email = ?', [cleanEmail]);
  // Runs the same expensive hash comparison either way (verifyPasswordConstantTime
  // below) so a nonexistent account can't be distinguished from a wrong
  // password by response time — see password.mjs's comment.
  if (!customer) { verifyPasswordConstantTime(password); return { status: 401, body: { error: 'Invalid email or password.' } }; }
  if (!verifyPassword(String(password || ''), customer.passwordHash)) {
    return { status: 401, body: { error: 'Invalid email or password.' } };
  }
  if (!customer.emailVerified) {
    return { status: 403, body: { error: 'Please verify your email before signing in. Check your inbox for the verification code.', needsVerification: true } };
  }
  return { status: 200, body: { token: issueToken(customer), user: serialize(customer) } };
}

// Always returns a generic message regardless of whether the account exists —
// same email-enumeration protection resendVerification() already uses.
export async function requestPasswordReset(email) {
  const cleanEmail = clean(email, 120).toLowerCase();
  const generic = { message: 'If an account exists for that email, a password reset link has been sent.' };
  const customer = await get('SELECT * FROM customers WHERE email = ?', [cleanEmail]);
  if (!customer) return { status: 200, body: generic };

  const token = randomBytes(32).toString('hex');
  const expires = toMysqlDatetime(new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000));
  await run('UPDATE customers SET resetToken = ?, resetExpires = ? WHERE id = ?', [token, expires, customer.id]);

  const link = `${getPublicUrl()}/reset-password?token=${token}&email=${encodeURIComponent(customer.email)}`;
  const emailResult = await sendPasswordResetEmail({ to: customer.email, name: customer.firstName || customer.name, link });

  return {
    status: 200,
    body: {
      ...generic,
      emailSent: emailResult.sent,
      // Same rule as devVerificationCode above — see canExposeDevPreview().
      devResetLink: canExposeDevPreview(emailResult) ? emailResult.previewLink : undefined,
    },
  };
}

export async function resetPassword({ email, token, password }) {
  const cleanEmail = clean(email, 120).toLowerCase();
  const cleanToken = clean(token, 128);
  if (!cleanToken) return { status: 400, body: { error: 'Invalid or expired reset link.' } };
  if (!password || String(password).length < 8) return { status: 400, body: { error: 'Password must be at least 8 characters.' } };

  const customer = await get('SELECT * FROM customers WHERE email = ?', [cleanEmail]);
  if (!customer || !customer.resetToken || customer.resetToken !== cleanToken) {
    return { status: 400, body: { error: 'Invalid or expired reset link.' } };
  }
  if (!customer.resetExpires || new Date(customer.resetExpires).getTime() < Date.now()) {
    return { status: 400, body: { error: 'This reset link has expired. Request a new one.' } };
  }

  await run('UPDATE customers SET passwordHash = ?, resetToken = NULL, resetExpires = NULL WHERE id = ?', [hashPassword(String(password)), customer.id]);

  const updated = await get('SELECT * FROM customers WHERE id = ?', [customer.id]);
  // Resetting logs the customer in immediately, same as email verification does.
  return { status: 200, body: { token: issueToken(updated), user: serialize(updated) } };
}

export function requireCustomer(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Please sign in.' });
    return null;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'customer') {
      res.status(401).json({ error: 'Please sign in.' });
      return null;
    }
    return payload;
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return null;
  }
}

// ---- Admin: view the customer registry ----
export async function listCustomers() {
  const rows = await all(`
    SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customerEmail = c.email) AS orderCount
    FROM customers c
    ORDER BY c.createdAt DESC
  `);
  return rows.map((row) => ({ ...serialize(row), orderCount: row.orderCount }));
}
