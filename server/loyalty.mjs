import { get, run } from './db.mjs';

// Simple, transparent scheme: 1 point per whole dollar spent (post-discount,
// pre-shipping), 100 points redeemable for $5 off a future order. Kept in
// one small module so the earn/redeem math only lives in one place.
export const POINTS_PER_DOLLAR = 1;
export const POINTS_PER_REDEMPTION_UNIT = 100;
export const REDEMPTION_UNIT_VALUE = 5;

export function pointsValueInDollars(points) {
  return Math.floor(Math.max(0, points) / POINTS_PER_REDEMPTION_UNIT) * REDEMPTION_UNIT_VALUE;
}

export async function grantLoyaltyPoints(customerId, amountSpent) {
  if (!customerId || !Number.isFinite(amountSpent) || amountSpent <= 0) return;
  const points = Math.floor(amountSpent * POINTS_PER_DOLLAR);
  if (points <= 0) return;
  await run('UPDATE customers SET loyaltyPoints = loyaltyPoints + ? WHERE id = ?', [points, customerId]);
}

export async function getLoyaltyPoints(customerId) {
  const row = await get('SELECT loyaltyPoints FROM customers WHERE id = ?', [customerId]);
  return row?.loyaltyPoints || 0;
}

// Atomically deducts the points needed for `dollarsRequested` (rounded down
// to the nearest redemption unit), returning the dollar amount actually
// redeemed — 0 if the customer doesn't have enough points.
export async function tryRedeemLoyaltyPoints(customerId, dollarsRequested) {
  if (!customerId || !Number.isFinite(dollarsRequested) || dollarsRequested <= 0) return 0;
  const row = await get('SELECT loyaltyPoints FROM customers WHERE id = ?', [customerId]);
  if (!row) return 0;

  const affordableDollars = pointsValueInDollars(row.loyaltyPoints);
  const dollarsToRedeem = Math.min(affordableDollars, Math.floor(dollarsRequested / REDEMPTION_UNIT_VALUE) * REDEMPTION_UNIT_VALUE);
  if (dollarsToRedeem <= 0) return 0;

  const pointsToSpend = (dollarsToRedeem / REDEMPTION_UNIT_VALUE) * POINTS_PER_REDEMPTION_UNIT;
  const result = await run('UPDATE customers SET loyaltyPoints = loyaltyPoints - ? WHERE id = ? AND loyaltyPoints >= ?', [pointsToSpend, customerId, pointsToSpend]);
  return result.changes > 0 ? dollarsToRedeem : 0;
}

export async function refundLoyaltyPoints(customerId, dollarsRefunded) {
  if (!customerId || !Number.isFinite(dollarsRefunded) || dollarsRefunded <= 0) return;
  const points = (dollarsRefunded / REDEMPTION_UNIT_VALUE) * POINTS_PER_REDEMPTION_UNIT;
  await run('UPDATE customers SET loyaltyPoints = loyaltyPoints + ? WHERE id = ?', [points, customerId]);
}

// Claws back points earned from an order that's since been cancelled — the
// counterpart to grantLoyaltyPoints(), clamped so it can never take a
// customer's balance negative (e.g. if they already spent some of it).
export async function revokeLoyaltyPoints(customerId, points) {
  if (!customerId || !Number.isFinite(points) || points <= 0) return;
  await run('UPDATE customers SET loyaltyPoints = GREATEST(0, loyaltyPoints - ?) WHERE id = ?', [points, customerId]);
}
