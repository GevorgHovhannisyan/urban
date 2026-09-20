import { randomUUID, randomInt } from 'node:crypto';
import { all, get, run } from './db.mjs';
import { sendGiftCardEmail } from './mailer.mjs';
import { RATES, GIFT_CARD_LIMITS, isSupportedCurrency } from '../src/data/currency.js';

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const normalizeCode = (code) => clean(code, 24).toUpperCase().replace(/\s+/g, '');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const round2 = (value) => Number((Number(value) || 0).toFixed(2));

// USD-equivalent balance is computed on every read (never stored) — it's
// derived, so there's no risk of it drifting out of sync with the
// authoritative native balance the way a cached column could.
function toUsd(amount, currency) {
  const rate = RATES[currency] || 1;
  return round2(amount / rate);
}
function fromUsd(amountUsd, currency) {
  const rate = RATES[currency] || 1;
  return round2(amountUsd * rate);
}

function serialize(row) {
  if (!row) return null;
  const currency = row.currency || 'USD';
  return {
    id: row.id,
    code: row.code,
    currency,
    initialValue: Number(row.initialValue),
    balance: Number(row.balance),
    balanceUsd: toUsd(Number(row.balance), currency),
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    senderName: row.senderName,
    message: row.message,
    active: Boolean(row.active),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    purchaserEmail: row.purchaserEmail,
    source: row.source,
    emailSentAt: row.emailSentAt || null,
    emailError: row.emailError || null,
  };
}

function serializeTransaction(row) {
  return {
    id: row.id,
    giftCardId: row.giftCardId,
    orderId: row.orderId,
    amountApplied: Number(row.amountApplied),
    currency: row.currency,
    balanceBefore: Number(row.balanceBefore),
    balanceAfter: Number(row.balanceAfter),
    createdAt: row.createdAt,
  };
}

async function recordTransaction({ giftCardId, orderId, amountApplied, currency, balanceBefore, balanceAfter }) {
  await run(
    `INSERT INTO gift_card_transactions (id, giftCardId, orderId, amountApplied, currency, balanceBefore, balanceAfter)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), giftCardId, orderId || null, amountApplied, currency, balanceBefore, balanceAfter]
  );
}

export async function listGiftCardTransactions(giftCardId) {
  const rows = await all('SELECT * FROM gift_card_transactions WHERE giftCardId = ? ORDER BY createdAt DESC', [clean(giftCardId, 80)]);
  return rows.map(serializeTransaction);
}

// Server-authoritative validation for a customer-purchased gift card — mirrors
// validateOrderDraft()'s shape (a { value } or { error } result) so callers in
// server/payment/paymentService.mjs can use the same pattern as the order-purchase flow.
// Never trusts the browser's math: currency must be one this app supports,
// and the amount is checked against THAT currency's own min/max, not USD's.
export function validateGiftCardPurchaseDraft(payload = {}) {
  const currency = clean(payload.currency, 3).toUpperCase() || 'USD';
  if (!isSupportedCurrency(currency)) {
    return { error: 'Please choose a supported gift card currency.' };
  }

  const limits = GIFT_CARD_LIMITS[currency];
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount < limits.min || amount > limits.max) {
    return { error: `Gift card amount must be between ${limits.min} and ${limits.max} ${currency}.` };
  }

  const purchaserEmail = clean(payload.purchaserEmail, 120).toLowerCase();
  const recipientEmail = clean(payload.recipientEmail, 120).toLowerCase();
  if (!purchaserEmail || !emailPattern.test(purchaserEmail)) {
    return { error: 'Please enter a valid email address for yourself.' };
  }
  if (!recipientEmail || !emailPattern.test(recipientEmail)) {
    return { error: "Please enter a valid recipient's email address." };
  }

  const senderName = clean(payload.senderName, 80);
  const recipientName = clean(payload.recipientName, 80);
  const message = clean(payload.message, 500);

  return {
    value: {
      amount: round2(amount),
      currency,
      purchaserEmail,
      recipientEmail,
      senderName,
      recipientName,
      message,
    },
  };
}

// Idempotent — safe to call twice for the same pendingPurchaseId (webhook and
// client-facing status-poll fallback can both race to complete it), mirroring
// commitOrder()'s idempotencyKey discipline in order-api.mjs. This is also
// the ONLY place a gift card becomes real: it only ever runs after Stripe
// (or another payment method's equivalent confirmation step) has confirmed
// the charge succeeded — never from the client alone.
export async function completeGiftCardPurchase(draft, pendingPurchaseId) {
  const existing = await get('SELECT * FROM gift_cards WHERE pendingPurchaseId = ?', [pendingPurchaseId]);
  if (existing) return { status: 201, body: { giftCard: serialize(existing) } };

  let code = generateCode();
  while (await get('SELECT id FROM gift_cards WHERE code = ?', [code])) {
    code = generateCode();
  }

  const id = randomUUID();
  await run(
    `INSERT INTO gift_cards (
      id, code, initialValue, balance, currency, recipientEmail, active,
      purchaserEmail, senderName, recipientName, message, source, pendingPurchaseId
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'purchase', ?)`,
    [id, code, draft.amount, draft.amount, draft.currency, draft.recipientEmail, draft.purchaserEmail, draft.senderName, draft.recipientName, draft.message, pendingPurchaseId]
  );

  const row = await get('SELECT * FROM gift_cards WHERE id = ?', [id]);
  await deliverGiftCardEmail(row);

  return { status: 201, body: { giftCard: serialize(await get('SELECT * FROM gift_cards WHERE id = ?', [id])) } };
}

// Sends (or re-sends) the recipient email for an existing card and records
// the outcome on the row itself — a payment that already succeeded must
// never be "lost" just because SMTP hiccuped, so this is deliberately
// callable again later (from the admin panel) without touching balance,
// status, or generating a new code.
export async function deliverGiftCardEmail(row) {
  const result = await sendGiftCardEmail({
    to: row.recipientEmail,
    code: row.code,
    amount: row.initialValue,
    currency: row.currency || 'USD',
    senderName: row.senderName,
    recipientName: row.recipientName,
    message: row.message,
    purchaserEmail: row.purchaserEmail,
  });
  if (result.sent) {
    await run('UPDATE gift_cards SET emailSentAt = CURRENT_TIMESTAMP, emailError = NULL WHERE id = ?', [row.id]);
  } else {
    await run('UPDATE gift_cards SET emailError = ? WHERE id = ?', [clean(result.error || 'Email delivery failed.', 300), row.id]);
  }
  return result;
}

export async function resendGiftCardEmail(id) {
  const row = await get('SELECT * FROM gift_cards WHERE id = ?', [clean(id, 80)]);
  if (!row) return { status: 404, body: { error: 'Gift card not found.' } };
  if (!row.recipientEmail) return { status: 400, body: { error: 'This gift card has no recipient email on file.' } };
  const result = await deliverGiftCardEmail(row);
  if (!result.sent) return { status: 502, body: { error: 'Could not send the email. Check the mail server configuration and try again.' } };
  // Real SMTP-relay diagnostics (not just true/false) — "sent" only ever
  // means the relay (Brevo) accepted the message for delivery, same as any
  // SMTP integration; it is not proof of inbox arrival, which this API has
  // no way to observe.
  return { status: 200, body: { sent: true, messageId: result.messageId, accepted: result.accepted, rejected: result.rejected, response: result.response } };
}

// UP-XXXX-XXXX-XXXX — three groups (not two) for extra margin against brute
// force, avoiding visually-ambiguous characters (0/O, 1/I). Generated with
// crypto.randomInt (a CSPRNG), not Math.random — a gift card code is a
// bearer instrument (whoever has it can spend the balance), so it needs to
// be infeasible to guess, not merely "look random."
function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `UP-${part()}-${part()}-${part()}`;
}

export async function createGiftCard(payload = {}) {
  const value = Number(payload.value);
  if (!Number.isFinite(value) || value <= 0) return { status: 400, body: { error: 'Value must be a positive number.' } };

  const currency = clean(payload.currency, 3).toUpperCase() || 'USD';
  if (!isSupportedCurrency(currency)) return { status: 400, body: { error: 'Unsupported currency.' } };

  const recipientEmail = clean(payload.recipientEmail, 120).toLowerCase();
  const expiresAt = payload.expiresAt ? clean(payload.expiresAt, 40) : null;

  let code = normalizeCode(payload.code) || generateCode();
  // Extremely unlikely to collide, but guarantee uniqueness rather than trust luck.
  while (await get('SELECT id FROM gift_cards WHERE code = ?', [code])) {
    code = generateCode();
  }

  const id = randomUUID();
  await run(
    `INSERT INTO gift_cards (id, code, initialValue, balance, currency, recipientEmail, active, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, code, round2(value), round2(value), currency, recipientEmail, expiresAt]
  );

  const row = await get('SELECT * FROM gift_cards WHERE id = ?', [id]);
  return { status: 201, body: { giftCard: serialize(row) } };
}

export async function listGiftCards() {
  const rows = await all('SELECT * FROM gift_cards ORDER BY createdAt DESC');
  return rows.map(serialize);
}

export async function getGiftCard(id) {
  const row = await get('SELECT * FROM gift_cards WHERE id = ?', [clean(id, 80)]);
  return serialize(row);
}

export async function setGiftCardActive(id, active) {
  const giftCardId = clean(id, 80);
  const existing = await get('SELECT id FROM gift_cards WHERE id = ?', [giftCardId]);
  if (!existing) return { status: 404, body: { error: 'Gift card not found.' } };
  await run('UPDATE gift_cards SET active = ? WHERE id = ?', [active ? 1 : 0, giftCardId]);
  const row = await get('SELECT * FROM gift_cards WHERE id = ?', [giftCardId]);
  return { status: 200, body: { giftCard: serialize(row) } };
}

// Checks a code and reports how much of it could be applied — does not
// touch the balance. Mirrors validatePromoCode()'s check-then-commit split.
// balanceUsd is what order-api.mjs compares against the order total (which
// is always USD-denominated internally, same as every product price and
// Stripe charge in this app) — see the module doc in src/data/currency.js.
//
// KNOWN EDGE CASE (documented, not silently hidden): a non-USD card can be
// left with sub-cent "dust" — e.g. 1.6 AMD (balanceUsd rounds to $0.00) —
// after a redemption that used almost all of it. Dust like this stays
// `active` and technically `valid` here (balance > 0), but tryRedeemGiftCard
// will never actually apply it to a future order (min(balanceUsd, total) is
// $0.00), so it's inert rather than exploitable — no double-spend or
// negative-balance risk, just a card that can't be fully closed out to
// exactly zero. Same tradeoff class as the documented stock-race risk in
// server/order-api.mjs.
export async function checkGiftCard(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, error: 'Enter a gift card code.' };

  const card = await get('SELECT * FROM gift_cards WHERE code = ?', [code]);
  if (!card) return { valid: false, error: 'This gift card code does not exist.' };
  if (!card.active) return { valid: false, error: 'This gift card is no longer active.' };
  if (card.expiresAt && new Date(card.expiresAt).getTime() < Date.now()) {
    return { valid: false, error: 'This gift card has expired.' };
  }
  if (Number(card.balance) <= 0) return { valid: false, error: 'This gift card has no remaining balance.' };

  return { valid: true, giftCard: serialize(card) };
}

// Atomically deducts up to the USD-equivalent of `amountUsd` from the card's
// NATIVE balance, returning the amount actually applied IN USD (so callers —
// order-api.mjs — never need to know or convert currencies themselves; the
// conversion happens once, here, against the same authoritative rate table
// checkGiftCard() used to compute balanceUsd for the pre-check).
//
// The check-then-deduct is folded into one atomic UPDATE (native units,
// guarded by `balance >= ?`) so two near-simultaneous checkouts can't both
// spend the same last few units of balance — identical concurrency
// discipline to the original single-currency version, just operating on
// native units instead of assuming native === USD.
export async function tryRedeemGiftCard(rawCode, amountUsd, orderId) {
  const code = normalizeCode(rawCode);
  if (!code || amountUsd <= 0) return 0;

  const card = await get(
    `SELECT * FROM gift_cards WHERE code = ? AND active = 1
       AND (expiresAt IS NULL OR expiresAt > NOW()) AND balance > 0`,
    [code]
  );
  if (!card) return 0;

  const currency = card.currency || 'USD';
  const cardBalance = Number(card.balance);
  const neededNative = fromUsd(amountUsd, currency);
  const appliedNative = round2(Math.min(cardBalance, neededNative));
  if (appliedNative <= 0) return 0;

  // ROUND(...,2) at write time, not just in the JS values computed above —
  // floating point (DECIMAL arithmetic is exact in MySQL, but the JS side
  // above is still IEEE754) means raw `balance - ?` could otherwise drift by
  // a fraction of a cent across repeated partial redemptions; rounding on
  // every write stops that dust from ever being stored.
  const result = await run('UPDATE gift_cards SET balance = ROUND(balance - ?, 2) WHERE code = ? AND balance >= ?', [appliedNative, code, appliedNative]);
  if (result.changes === 0) return 0;

  await recordTransaction({
    giftCardId: card.id,
    orderId,
    amountApplied: appliedNative,
    currency,
    balanceBefore: cardBalance,
    balanceAfter: round2(cardBalance - appliedNative),
  });

  return toUsd(appliedNative, currency);
}

// Counterpart to tryRedeemGiftCard() — amountUsd is converted back to the
// card's native currency the same way, using the same fixed rate table, so
// a revert always restores exactly what was taken (no drift from
// re-deriving the conversion at a different moment).
export async function revertGiftCardRedemption(rawCode, amountUsd) {
  const code = normalizeCode(rawCode);
  if (!code || amountUsd <= 0) return;
  const card = await get('SELECT id, currency, balance FROM gift_cards WHERE code = ?', [code]);
  if (!card) return;
  const amountNative = fromUsd(amountUsd, card.currency || 'USD');
  await run('UPDATE gift_cards SET balance = ROUND(balance + ?, 2) WHERE code = ?', [amountNative, code]);
  await recordTransaction({
    giftCardId: card.id,
    orderId: null,
    amountApplied: -amountNative,
    currency: card.currency || 'USD',
    balanceBefore: Number(card.balance),
    balanceAfter: round2(Number(card.balance) + amountNative),
  });
}
