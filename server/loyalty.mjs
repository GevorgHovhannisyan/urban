import { get, run, fromJson } from './db.mjs';

// Simple, transparent scheme: 1 point per whole dollar spent on products
// (after promo discounts and points redeemed, shipping excluded — money paid
// with a gift card counts as spent), 100 points redeemable for $5 off a
// future order. Kept in one small module so the earn/redeem math only lives
// in one place.
//
// Points are only ever earned on a PAID order (Stripe-paid at checkout, or
// an admin marking a cash-on-delivery/manual order "Paid") — never on an
// unpaid, cancelled or refunded one. orders.loyaltyPointsGranted records
// what an order earned and orders.loyaltyPointsRevoked what has since been
// taken back (cancellation, refund, returned items), so every grant and
// reversal is idempotent and can never double-count.
export const POINTS_PER_DOLLAR = 1;
export const POINTS_PER_REDEMPTION_UNIT = 100;
export const REDEMPTION_UNIT_VALUE = 5;

export function pointsValueInDollars(points) {
  return Math.floor(Math.max(0, points) / POINTS_PER_REDEMPTION_UNIT) * REDEMPTION_UNIT_VALUE;
}

// Points an order earns: whole dollars spent on products after discounts.
export function pointsEarnedForOrder(order) {
  const spent = Number(order.subtotal || 0) - Number(order.discountAmount || 0) - Number(order.loyaltyDiscount || 0);
  return Math.floor(Math.max(0, spent) * POINTS_PER_DOLLAR);
}

// Grants an order's points once it is paid. Safe to call on every status
// change: the conditional UPDATE claims the grant, so it happens at most once.
export async function awardOrderPoints(orderId) {
  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order?.customerId || order.paymentStatus !== 'paid' || order.status === 'cancelled') return 0;
  if (order.loyaltyPointsGranted > 0 || order.loyaltyPointsRevoked > 0) return 0;
  const points = pointsEarnedForOrder(order);
  if (points <= 0) return 0;
  const claimed = await run(
    'UPDATE orders SET loyaltyPointsGranted = ? WHERE id = ? AND loyaltyPointsGranted = 0 AND loyaltyPointsRevoked = 0',
    [points, orderId],
  );
  if (!claimed.changes) return 0;
  await run('UPDATE customers SET loyaltyPoints = loyaltyPoints + ? WHERE id = ?', [points, order.customerId]);
  return points;
}

// Takes back up to `points` of what this order earned (never more than it
// earned in total, never below a 0 balance).
async function revokeOrderPoints(order, points) {
  const n = Math.min(Math.floor(points), order.loyaltyPointsGranted - order.loyaltyPointsRevoked);
  if (!order.customerId || !(n > 0)) return 0;
  const claimed = await run(
    'UPDATE orders SET loyaltyPointsRevoked = loyaltyPointsRevoked + ? WHERE id = ? AND loyaltyPointsRevoked + ? <= loyaltyPointsGranted',
    [n, order.id, n],
  );
  if (!claimed.changes) return 0;
  await revokeLoyaltyPoints(order.customerId, n);
  return n;
}

// Cancelled or fully refunded order: remove the points it earned and give
// back the points the customer spent on it. Idempotent.
export async function reverseOrderLoyalty(orderId) {
  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order?.customerId) return;
  await revokeOrderPoints(order, order.loyaltyPointsGranted);
  if (order.loyaltyPointsUsed > 0) {
    const claimed = await run('UPDATE orders SET loyaltyPointsReturned = 1 WHERE id = ? AND loyaltyPointsReturned = 0', [order.id]);
    if (claimed.changes) {
      await run('UPDATE customers SET loyaltyPoints = loyaltyPoints + ? WHERE id = ?', [order.loyaltyPointsUsed, order.customerId]);
    }
  }
}

// Refunded return: remove the share of the order's points that the returned
// items earned (all of them when everything was returned).
export async function revokePointsForReturnedItems(orderId, returnedItems) {
  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order?.customerId || !(order.loyaltyPointsGranted > 0)) return 0;
  const items = fromJson(order.items, []);
  const orderValue = items.reduce((sum, i) => sum + Number(i.lineTotal || 0), 0);
  const returnedValue = (returnedItems || []).reduce((sum, i) => sum + Number(i.lineTotal || 0), 0);
  if (!(orderValue > 0) || !(returnedValue > 0)) return 0;
  const share = Math.min(1, returnedValue / orderValue);
  const points = share >= 1 ? order.loyaltyPointsGranted : Math.round(order.loyaltyPointsGranted * share);
  return revokeOrderPoints(order, points);
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
