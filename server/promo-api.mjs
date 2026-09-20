import { randomUUID } from 'node:crypto';
import { all, get, run } from './db.mjs';

const clean = (value, max = 40) => String(value ?? '').trim().slice(0, max);
const normalizeCode = (code) => clean(code, 40).toUpperCase();

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    active: Boolean(row.active),
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    minSubtotal: Number(row.minSubtotal),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function computeDiscount(promo, subtotal) {
  if (promo.type === 'fixed') return Math.min(Number(promo.value), subtotal);
  const pct = Math.min(100, Math.max(0, Number(promo.value)));
  return Number(((subtotal * pct) / 100).toFixed(2));
}

// Checks a code against current rules and returns the discount it would apply.
// Does NOT increment usage — call recordPromoUsage() only after the order is saved.
export async function validatePromoCode(rawCode, subtotal) {
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, error: 'Enter a promo code.' };

  const promo = await get('SELECT * FROM promo_codes WHERE code = ?', [code]);
  if (!promo) return { valid: false, error: 'This promo code does not exist.' };
  if (!promo.active) return { valid: false, error: 'This promo code is no longer active.' };
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now()) {
    return { valid: false, error: 'This promo code has expired.' };
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return { valid: false, error: 'This promo code has reached its usage limit.' };
  }
  if (subtotal < Number(promo.minSubtotal)) {
    return { valid: false, error: `This code requires a minimum order of ${Number(promo.minSubtotal).toFixed(2)}.` };
  }

  const discountAmount = computeDiscount(promo, subtotal);
  return { valid: true, promo: serialize(promo), discountAmount };
}

export async function recordPromoUsage(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return;
  await run('UPDATE promo_codes SET usedCount = usedCount + 1 WHERE code = ?', [normalized]);
}

// validatePromoCode() checks maxUses, but createOrder() awaits other work
// (edition claiming) between that check and actually committing the order —
// two near-simultaneous checkouts using the same nearly-exhausted code could
// both pass the check-then-act gap. This folds the check and the increment
// into one atomic UPDATE so only as many requests as there is remaining
// quota can ever succeed, no matter how they interleave. Returns false if
// the code can no longer be used (limit hit, deactivated, or expired since
// the initial check) — the caller must not create the order in that case.
// Compensates tryCommitPromoUsage() when the order it was committed for
// turned out not to be created after all (e.g. it lost an idempotency-key
// race to a duplicate request that had already inserted the real order).
export async function revertPromoUsage(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return;
  await run('UPDATE promo_codes SET usedCount = GREATEST(0, usedCount - 1) WHERE code = ?', [normalized]);
}

export async function tryCommitPromoUsage(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return true;
  const result = await run(
    `UPDATE promo_codes SET usedCount = usedCount + 1
     WHERE code = ? AND active = 1
       AND (maxUses IS NULL OR usedCount < maxUses)
       AND (expiresAt IS NULL OR expiresAt > NOW())`,
    [normalized]
  );
  return result.changes > 0;
}

export async function listPromoCodes() {
  const rows = await all('SELECT * FROM promo_codes ORDER BY createdAt DESC');
  return rows.map(serialize);
}

function validatePayload(payload = {}, { partial = false } = {}) {
  const errors = [];
  const fields = {};

  if (!partial || payload.code !== undefined) {
    fields.code = normalizeCode(payload.code);
    if (!fields.code) errors.push('Code is required.');
  }
  if (!partial || payload.type !== undefined) {
    fields.type = clean(payload.type, 20);
    if (!['percentage', 'fixed'].includes(fields.type)) errors.push('Type must be "percentage" or "fixed".');
  }
  if (!partial || payload.value !== undefined) {
    fields.value = Number(payload.value);
    if (!Number.isFinite(fields.value) || fields.value <= 0) errors.push('Value must be a positive number.');
  }
  if (!partial || payload.active !== undefined) fields.active = payload.active !== false;
  if (!partial || payload.maxUses !== undefined) {
    const raw = payload.maxUses;
    fields.maxUses = raw === null || raw === '' || raw === undefined ? null : Number(raw);
    if (fields.maxUses !== null && (!Number.isInteger(fields.maxUses) || fields.maxUses < 1)) {
      errors.push('Max uses must be a positive whole number, or left blank for unlimited.');
    }
  }
  if (!partial || payload.minSubtotal !== undefined) {
    fields.minSubtotal = Number(payload.minSubtotal) || 0;
    if (fields.minSubtotal < 0) errors.push('Minimum order amount cannot be negative.');
  }
  if (!partial || payload.expiresAt !== undefined) {
    fields.expiresAt = payload.expiresAt ? clean(payload.expiresAt, 40) : null;
  }

  return { errors, fields };
}

export async function createPromoCode(payload = {}) {
  const { errors, fields } = validatePayload(payload, { partial: false });
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  const existing = await get('SELECT id FROM promo_codes WHERE code = ?', [fields.code]);
  if (existing) return { status: 409, body: { error: 'A promo code with this code already exists.' } };

  const id = randomUUID();
  await run(
    `INSERT INTO promo_codes (id, code, type, value, active, maxUses, minSubtotal, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, fields.code, fields.type, fields.value, fields.active ? 1 : 0, fields.maxUses ?? null, fields.minSubtotal ?? 0, fields.expiresAt]
  );

  const row = await get('SELECT * FROM promo_codes WHERE id = ?', [id]);
  return { status: 201, body: { promoCode: serialize(row) } };
}

export async function updatePromoCode(id, payload = {}) {
  const promoId = clean(id, 80);
  const existing = await get('SELECT * FROM promo_codes WHERE id = ?', [promoId]);
  if (!existing) return { status: 404, body: { error: 'Promo code not found.' } };

  const { errors, fields } = validatePayload(payload, { partial: true });
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };
  if (Object.keys(fields).length === 0) return { status: 400, body: { error: 'No changes provided.' } };

  if (fields.code && fields.code !== existing.code) {
    const clash = await get('SELECT id FROM promo_codes WHERE code = ? AND id != ?', [fields.code, promoId]);
    if (clash) return { status: 409, body: { error: 'A promo code with this code already exists.' } };
  }

  const columns = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    columns.push(`${key} = ?`);
    values.push(key === 'active' ? (value ? 1 : 0) : value);
  }
  values.push(promoId);

  await run(`UPDATE promo_codes SET ${columns.join(', ')} WHERE id = ?`, values);
  const row = await get('SELECT * FROM promo_codes WHERE id = ?', [promoId]);
  return { status: 200, body: { promoCode: serialize(row) } };
}

export async function deletePromoCode(id) {
  const promoId = clean(id, 80);
  const existing = await get('SELECT id FROM promo_codes WHERE id = ?', [promoId]);
  if (!existing) return { status: 404, body: { error: 'Promo code not found.' } };
  await run('DELETE FROM promo_codes WHERE id = ?', [promoId]);
  return { status: 200, body: { deleted: true } };
}
